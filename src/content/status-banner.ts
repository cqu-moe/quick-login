import type { LoginRecoveryResult } from "../shared/messages";

const BANNER_ID = "cqu-quicklogin-status";

export function renderStatusBanner(
  document: Document,
  result: LoginRecoveryResult,
  send: (type: "ENTER_MANUAL" | "RETRY_AUTOMATIC") => void
): void {
  const existing = document.getElementById(BANNER_ID);
  if (result.kind === "idle") { existing?.remove(); return; }
  const message = result.kind === "navigating" ? "正在恢复快捷登录，请稍候。" : result.message;
  if (existing) {
    const text = existing.querySelector("span")!;
    if (text.textContent !== message) text.textContent = message;
    const retry = existing.querySelector<HTMLButtonElement>('[data-action="RETRY_AUTOMATIC"]')!;
    if (result.kind !== "manual_required" && document.activeElement === retry) {
      existing.querySelector<HTMLButtonElement>('[data-action="ENTER_MANUAL"]')!.focus({ preventScroll: true });
    }
    retry.hidden = result.kind !== "manual_required";
    return;
  }

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
  text.textContent = message;
  const style = document.createElement("style");
  style.textContent = `
    #${BANNER_ID} button { transition: transform 150ms cubic-bezier(.25,.46,.45,.94); }
    #${BANNER_ID} button[hidden] { display: none !important; }
    #${BANNER_ID} button[aria-disabled="true"] { opacity: .65; cursor: wait !important; }
    #${BANNER_ID} button:active:not(:focus-visible) { transform: scale(.97); }
    #${BANNER_ID} button:focus-visible { outline: 2px solid #1f6f55; outline-offset: 3px; transition: none; }
    @media (prefers-reduced-motion: reduce) {
      #${BANNER_ID} button { transition: none; }
      #${BANNER_ID} button:active:not(:focus-visible) { transform: none; }
    }
  `;
  banner.append(style, text);

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px";
  const button = (label: string, type: "ENTER_MANUAL" | "RETRY_AUTOMATIC") => {
    const control = document.createElement("button");
    control.type = "button";
    control.dataset.action = type;
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
  const retry = button("重试快捷登录", "RETRY_AUTOMATIC");
  retry.hidden = result.kind !== "manual_required";
  actions.append(retry);
  banner.append(actions);

  const form = document.querySelector("form");
  form?.parentElement?.insertBefore(banner, form);
}
