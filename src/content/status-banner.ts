import type { LoginRecoveryResult } from "../shared/messages";

const BANNER_ID = "cqu-quicklogin-status";

export function renderStatusBanner(
  document: Document,
  result: LoginRecoveryResult,
  send: (type: "ENTER_MANUAL" | "RETRY_AUTOMATIC") => void
): void {
  document.getElementById(BANNER_ID)?.remove();
  if (result.kind === "idle") return;

  const banner = document.createElement("section");
  banner.id = BANNER_ID;
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");
  banner.style.cssText = [
    "box-sizing:border-box", "margin:12px 0", "padding:12px 14px",
    "border:1px solid #d6d9de", "border-left:3px solid #1f6f55",
    "background:#fff", "color:#202326", "font:14px/1.5 system-ui,sans-serif",
  ].join(";");

  const text = document.createElement("span");
  text.textContent = result.kind === "navigating"
    ? "正在恢复快捷登录，请稍候。"
    : result.message;
  banner.append(text);

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px";
  const button = (label: string, type: "ENTER_MANUAL" | "RETRY_AUTOMATIC") => {
    const control = document.createElement("button");
    control.type = "button";
    control.textContent = label;
    control.style.cssText = [
      "min-height:44px", "padding:8px 12px", "border:1px solid #b8bec6",
      "border-radius:6px", "background:#f7f8f9", "color:#202326",
      "font:600 14px/1 system-ui,sans-serif", "touch-action:manipulation", "cursor:pointer",
    ].join(";");
    control.addEventListener("click", () => send(type));
    return control;
  };
  actions.append(button("手动登录", "ENTER_MANUAL"));
  if (result.kind === "manual_required") {
    actions.append(button("重试快捷登录", "RETRY_AUTOMATIC"));
  }
  banner.append(actions);

  const form = document.querySelector("form");
  form?.parentElement?.insertBefore(banner, form);
}
