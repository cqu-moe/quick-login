import "./style.css";
import { sendUiMessage } from "../shared/ui-message";
import { ACTION_LABELS, derivePopupView, type PopupAction, type PopupInput, type PopupView } from "./view-model";
import type { ExtensionUpdateStatus } from "../background/updates";

const app = document.querySelector<HTMLElement>("#app")!;
const messages: Record<PopupAction, string> = {
  login: "LOGIN", open_settings: "OPEN_SETTINGS", resume: "RESUME",
  switch_managed: "SWITCH_TO_MANAGED", retry: "SYNC", retry_local: "RETRY_LOCAL",
  update: "CHECK_EXTENSION_UPDATE", fix_permissions: "OPEN_EXTENSION_SETTINGS", manual_login: "OPEN_SCHOOL_MANUAL",
};
const updateNotices: Record<ExtensionUpdateStatus, string> = {
  update_available: "新版已下载，当前操作完成后会自动更新。",
  no_update: "商店暂未提供可用更新，Chrome 会继续自动检查。",
  throttled: "刚刚检查过更新，Chrome 会继续自动检查，请稍后再试。",
  failed: "暂时无法检查更新，请确认网络可以访问 Chrome 应用商店后重试。",
  manual_update: "当前为开发版，请更新安装目录并重新加载。",
};

// Mount once: refreshing state must not replace the focused control or restart a spinner.
app.innerHTML = `
  <header class="brand"><picture class="brand-mark">
    <source srcset="/brand/logo-dark.svg" media="(prefers-color-scheme: dark)">
    <img class="brand-mark-image" src="/brand/logo.svg" width="28" height="28" alt="">
  </picture><strong>QuickLogin</strong></header>
  <section class="status" role="status" aria-live="polite" aria-atomic="true">
    <span class="status-icon" aria-hidden="true"></span>
    <p class="status-kicker">当前状态</p><h1></h1><p class="status-description" hidden></p>
  </section>
  <footer class="controls">
    <button type="button" data-control="primary" hidden></button>
    <label class="switch-control" hidden><span class="switch-label">此浏览器快捷登录</span>
      <input type="checkbox" data-control="switch">
      <span class="switch-track" aria-hidden="true"><span></span></span>
    </label>
  </footer>`;
app.removeAttribute("aria-live");
const status = app.querySelector<HTMLElement>(".status")!;
const title = app.querySelector("h1")!;
const description = app.querySelector<HTMLElement>(".status-description")!;
const button = app.querySelector<HTMLButtonElement>("button")!;
const control = app.querySelector<HTMLElement>(".switch-control")!;
const checkbox = app.querySelector<HTMLInputElement>("input")!;
let view: PopupView;
let readRetry = false;
let actionPending = false;
let revision = 0;
let active = false;
let lifetime = new AbortController();
let readPending = false;
let readAgain = false;
let readTimer = 0;
let checkPending = false;
let foregroundTimer = 0;
let updateNotice = "";

function setText(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}
function renderView(next: PopupView): void {
  const focused = document.activeElement;
  view = next;
  if (!next.actions.includes("update")) updateNotice = "";
  status.dataset.tone = next.tone;
  setText(title, next.heading);
  const detail = updateNotice || next.description;
  setText(description, detail);
  description.hidden = !detail;
  const action = next.actions[0];
  button.hidden = !action && !readRetry;
  setText(button, readRetry ? "重新检查" : action ? next.actionLabel ?? ACTION_LABELS[action] : "");
  button.setAttribute("aria-disabled", String(actionPending));
  control.hidden = !(next.switchVisible ?? !action);
  checkbox.checked = next.switchChecked;
  checkbox.setAttribute("aria-disabled", String(!next.switchEnabled || actionPending));
  if (focused === checkbox && control.hidden && !button.hidden) button.focus({ preventScroll: true });
  if (focused === button && button.hidden && !control.hidden) checkbox.focus({ preventScroll: true });
}
function pendingView(heading: string, checked: boolean): PopupView {
  return { heading, description: "正在处理，请稍候。", tone: "busy", switchEnabled: false, switchChecked: checked,
    switchVisible: view?.switchVisible ?? false, actions: view?.actions ?? [] };
}
function showError(action: boolean): void {
  readRetry = true;
  renderView({ heading: action ? "操作暂未确认" : "暂时无法读取状态",
    description: action ? "操作可能仍在后台进行，请重新检查状态。" : "请重新检查；若仍无响应，请重新打开插件。",
    tone: "attention", switchEnabled: false, switchChecked: view.switchChecked, switchVisible: false, actions: [] });
}

async function refresh(): Promise<void> {
  if (!active || document.hidden) return;
  if (readPending || actionPending) { readAgain = true; return; }
  window.clearTimeout(readTimer);
  readTimer = 0;
  readPending = true;
  readAgain = false;
  if (readRetry) { setText(button, "正在检查…"); button.setAttribute("aria-busy", "true"); }
  const current = revision;
  const signal = lifetime.signal;
  try {
    const input = await sendUiMessage<PopupInput>({ type: "GET_UI_STATE" }, signal);
    if (signal.aborted || current !== revision) return;
    const next = derivePopupView(input);
    readRetry = false;
    renderView(next);
  } catch {
    if (!signal.aborted && current === revision) showError(false);
  } finally {
    if (!signal.aborted) {
      readPending = false;
      button.removeAttribute("aria-busy");
      if (readAgain && !actionPending) scheduleRefresh();
    }
  }
}
function scheduleRefresh(): void {
  if (!active || document.hidden) return;
  if (readPending || actionPending) { readAgain = true; return; }
  if (!readTimer) readTimer = window.setTimeout(() => { readTimer = 0; void refresh(); }, 100);
}
async function checkState(): Promise<void> {
  if (!active || document.hidden || checkPending || actionPending || readRetry) return;
  checkPending = true;
  const signal = lifetime.signal;
  try { await sendUiMessage({ type: "CHECK_STATE" }, signal); }
  catch { /* The next state read exposes worker failure without replacing useful state. */ }
  finally { if (!signal.aborted) checkPending = false; }
}
async function runAction(message: Record<string, unknown>, heading: string, checked = view.switchChecked): Promise<void> {
  if (!active || actionPending) return;
  actionPending = true;
  readRetry = false;
  revision++;
  window.clearTimeout(readTimer);
  readTimer = 0;
  const signal = lifetime.signal;
  renderView(pendingView(heading, checked));
  try {
    const response = await sendUiMessage<{ accepted?: boolean; ok?: boolean; updateStatus?: ExtensionUpdateStatus } | undefined>(message, signal);
    if (signal.aborted) return;
    if (response?.accepted !== true && response?.ok !== true) throw new Error("ACTION_NOT_ACCEPTED");
    if (response.updateStatus) updateNotice = updateNotices[response.updateStatus];
    actionPending = false;
    await refresh();
  } catch {
    if (!signal.aborted) {
      actionPending = false;
      readAgain = false;
      showError(true);
    }
  }
}
button.addEventListener("click", () => {
  if (button.getAttribute("aria-disabled") === "true" || (readRetry && readPending)) return;
  if (readRetry) { void refresh().then(checkState); return; }
  const action = view.actions[0];
  if (!action) return;
  const heading = action === "login" ? "正在连接 Auth" : action === "open_settings" ? "正在打开 Auth" :
    action === "update" ? "正在检查更新" : action === "fix_permissions" ? "正在打开扩展设置" :
    action === "manual_login" ? "正在打开学校登录" : "正在准备学校登录";
  void runAction({ type: messages[action] }, heading);
});
checkbox.addEventListener("click", event => {
  if (actionPending || !view.switchEnabled) event.preventDefault();
});
checkbox.addEventListener("change", () => {
  const enabled = checkbox.checked;
  void runAction({ type: "SET_ENABLED", enabled }, enabled ? "正在准备学校登录" : "正在关闭", enabled);
});
function onStorage(_changes: Record<string, chrome.storage.StorageChange>, area: string): void {
  if (area === "local") scheduleRefresh();
}
function onVisibility(): void {
  app.dataset.hidden = String(document.hidden);
  if (!document.hidden) { void refresh(); void checkState(); }
}
function start(): void {
  if (active) return;
  active = true;
  lifetime = new AbortController();
  chrome.storage.onChanged.addListener(onStorage);
  document.addEventListener("visibilitychange", onVisibility);
  void refresh().then(checkState);
  foregroundTimer = window.setInterval(() => { void checkState(); }, 5_000);
}
function stop(event: PageTransitionEvent): void {
  active = false;
  revision++;
  lifetime.abort();
  readPending = readAgain = actionPending = checkPending = false;
  window.clearTimeout(readTimer);
  readTimer = 0;
  window.clearInterval(foregroundTimer);
  chrome.storage.onChanged.removeListener(onStorage);
  document.removeEventListener("visibilitychange", onVisibility);
  if (!event.persisted) {
    window.removeEventListener("pagehide", stop);
    window.removeEventListener("pageshow", onPageShow);
  }
}
function onPageShow(event: PageTransitionEvent): void { if (event.persisted) start(); }
renderView(pendingView("正在检查", false));
window.addEventListener("pagehide", stop);
window.addEventListener("pageshow", onPageShow);
start();
