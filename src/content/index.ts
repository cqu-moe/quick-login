import { detectLoginForm } from "./login-page";
import { renderStatusBanner } from "./status-banner";
import { sendUiMessage } from "../shared/ui-message";
import type { ContentAction, ContentMessage, LoginRecoveryResult } from "../shared/messages";

const CHECK_INTERVAL = 5_000;
const STATE_REFRESH_DEBOUNCE_MS = 150;
const STATE_REFRESH_MIN_INTERVAL_MS = 1_000;
let pending = false;
let userEditing = false;
let navigating = false;
let recovering = false;
let stopped = false;
let active = false;
let generation = 0;
let lastCheck = -Infinity;
let debounce = 0;
let stateDebounce = 0;
let lastStateRefresh = -Infinity;
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
  recovering = result.kind === "recovering";
  navigating = result.kind === "navigating";
  stopped = result.kind === "manual_required";
  if (navigating || result.kind === "idle" || userEditing) clearStateRefresh();
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
const MANUAL_MODE: LoginRecoveryResult = {
  kind: "manual_required",
  message: "已切换为手动登录，可直接在下方输入。",
  action: { type: "RETRY_AUTOMATIC", label: "恢复快捷登录" },
};

function act(type: ContentAction): void {
  if (!active || pending) return;
  userEditing = type === "ENTER_MANUAL";
  stopped = type === "RETRY_AUTOMATIC" ? false : userEditing || stopped;
  navigating = false;
  clearStateRefresh();
  if (type === "ENTER_MANUAL") present(MANUAL_MODE);
  void send({ type });
}
function clearStateRefresh(): void {
  window.clearTimeout(stateDebounce);
  stateDebounce = 0;
}
function scheduleStateRefresh(): void {
  if (!active || userEditing || navigating || document.hidden) return;
  // A stopped automatic recovery can observe a successful popup retry; direct editing cannot.
  if (!recovering && !(stopped && !userEditing)) return;
  if (stateDebounce) return;
  const wait = Math.max(
    STATE_REFRESH_DEBOUNCE_MS,
    lastStateRefresh + STATE_REFRESH_MIN_INTERVAL_MS - Date.now()
  );
  stateDebounce = window.setTimeout(() => {
    stateDebounce = 0;
    if (!active || userEditing || navigating || document.hidden ||
        (!recovering && !(stopped && !userEditing))) return;
    if (pending) {
      scheduleStateRefresh();
      return;
    }
    lastStateRefresh = Date.now();
    void send({ type: "GET_UI_STATE" });
  }, wait);
}
function check(): void {
  if (!active || pending || userEditing || navigating || stopped || document.hidden ||
      Date.now() - lastCheck < CHECK_INTERVAL) return;
  if (recovering) {
    lastCheck = Date.now();
    void send({ type: "CHECK_STATE" });
    return;
  }
  if (!detectLoginForm(document, new URL(location.href))) return;
  lastCheck = Date.now();
  void send({ type: "LOGIN_FORM_VISIBLE" });
}
function noticeManualEdit(event: Event): void {
  if (userEditing || !(event.target instanceof HTMLInputElement) ||
      !["text", "email", "password"].includes(event.target.type)) return;
  userEditing = true;
  stopped = true;
  navigating = false;
  recovering = false;
  clearStateRefresh();
  present(MANUAL_MODE);
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
function onVisibility(): void {
  if (document.hidden) return;
  scheduleStateRefresh();
  check();
}
function onRuntimeMessage(message: unknown, sender: chrome.runtime.MessageSender): void {
  if (typeof message === "object" && message !== null &&
      (message as { type?: unknown }).type === "QUICKLOGIN_STATE_CHANGED" &&
      sender.id === chrome.runtime.id) {
    scheduleStateRefresh();
  }
}
function start(): void {
  if (active) return;
  active = true;
  lifetime = new AbortController();
  lastCheck = -Infinity;
  navigating = false;
  recovering = false;
  clearStateRefresh();
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("input", noticeManualEdit);
  document.addEventListener("visibilitychange", onVisibility);
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
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
  clearStateRefresh();
  debounce = 0;
  observer.disconnect();
  document.removeEventListener("input", noticeManualEdit);
  document.removeEventListener("visibilitychange", onVisibility);
  chrome.runtime.onMessage.removeListener(onRuntimeMessage);
  if (!event.persisted) {
    window.removeEventListener("pagehide", stop);
    window.removeEventListener("pageshow", onPageShow);
  }
}
function onPageShow(event: PageTransitionEvent): void { if (event.persisted) start(); }
window.addEventListener("pagehide", stop);
window.addEventListener("pageshow", onPageShow);
start();
