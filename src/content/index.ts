import { detectLoginForm } from "./login-page";
import { renderStatusBanner } from "./status-banner";
import { sendUiMessage } from "../shared/ui-message";
import type { ContentMessage, LoginRecoveryResult } from "../shared/messages";

const CHECK_INTERVAL = 5_000;
let pending = false;
let userEditing = false;
let navigating = false;
let stopped = false;
let active = false;
let generation = 0;
let lastCheck = -Infinity;
let debounce = 0;
let waitingCheck = 0;
let lifetime = new AbortController();
let request: AbortController | undefined;

function setPending(value: boolean): void {
  pending = value;
  const banner = document.getElementById("cqu-quicklogin-status");
  banner?.setAttribute("aria-busy", String(value));
  banner?.querySelectorAll("button").forEach(button => button.setAttribute("aria-disabled", String(value)));
}
function present(result: LoginRecoveryResult): void {
  navigating = result.kind === "navigating";
  stopped = result.kind === "manual_required";
  renderStatusBanner(document, result, act);
}
async function send(message: ContentMessage): Promise<void> {
  request?.abort();
  const current = ++generation;
  const controller = new AbortController();
  request = controller;
  const abort = () => controller.abort();
  const lifecycle = lifetime.signal;
  lifecycle.addEventListener("abort", abort, { once: true });
  setPending(true);
  try {
    const result = await sendUiMessage<LoginRecoveryResult>(message, controller.signal);
    if (current === generation && active) present(result);
  } catch {
    if (current === generation && active && !controller.signal.aborted) {
      present({ kind: "manual_required", message: "暂时无法连接插件，可手动登录或重试。" });
    }
  } finally {
    lifecycle.removeEventListener("abort", abort);
    if (current === generation) {
      setPending(false);
      request = undefined;
    }
  }
}
function act(type: "ENTER_MANUAL" | "RETRY_AUTOMATIC"): void {
  if (!active || pending) return;
  userEditing = type === "ENTER_MANUAL";
  stopped = userEditing;
  navigating = false;
  void send({ type });
}
function check(): void {
  if (!active || pending || userEditing || navigating || stopped || document.hidden ||
      Date.now() - lastCheck < CHECK_INTERVAL || !detectLoginForm(document, new URL(location.href))) return;
  lastCheck = Date.now();
  void send({ type: "LOGIN_FORM_VISIBLE" });
}
function noticeManualEdit(event: Event): void {
  if (userEditing || !(event.target instanceof HTMLInputElement) ||
      !["text", "email", "password"].includes(event.target.type)) return;
  userEditing = true;
  stopped = true;
  navigating = false;
  // Explicit typing supersedes an automatic check, including any late response.
  void send({ type: "ENTER_MANUAL" });
}
const observer = new MutationObserver(records => {
  if (pending || userEditing || navigating || stopped || document.hidden) return;
  const banner = document.getElementById("cqu-quicklogin-status");
  if (banner && records.every(record => banner.contains(record.target))) return;
  // A fixed trailing timer cannot be starved by a continuously changing host page.
  if (!debounce) debounce = window.setTimeout(() => { debounce = 0; check(); }, 150);
});
function onVisibility(): void { if (!document.hidden) check(); }
function start(): void {
  if (active) return;
  active = true;
  lifetime = new AbortController();
  lastCheck = -Infinity;
  navigating = false;
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("input", noticeManualEdit);
  document.addEventListener("visibilitychange", onVisibility);
  waitingCheck = window.setInterval(check, CHECK_INTERVAL);
  check();
}
function stop(event: PageTransitionEvent): void {
  active = false;
  generation++;
  lifetime.abort();
  setPending(false);
  window.clearInterval(waitingCheck);
  window.clearTimeout(debounce);
  debounce = 0;
  observer.disconnect();
  document.removeEventListener("input", noticeManualEdit);
  document.removeEventListener("visibilitychange", onVisibility);
  if (!event.persisted) {
    window.removeEventListener("pagehide", stop);
    window.removeEventListener("pageshow", onPageShow);
  }
}
function onPageShow(event: PageTransitionEvent): void { if (event.persisted) start(); }
window.addEventListener("pagehide", stop);
window.addEventListener("pageshow", onPageShow);
start();
