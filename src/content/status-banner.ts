import type { ContentAction, LoginRecoveryResult } from "../shared/messages";

const BANNER_ID = "cqu-quicklogin-status";

type ActionSpec = { type: ContentAction; label: string };
type ProvidedAction = ActionSpec | null | undefined;

export function renderStatusBanner(
  document: Document,
  result: LoginRecoveryResult,
  send: (type: ContentAction) => void
): void {
  const existing = document.getElementById(BANNER_ID);
  if (result.kind === "idle") { existing?.remove(); return; }
  const message = result.kind === "navigating" ? "正在恢复快捷登录，请稍候。" : result.message;
  const primary: ProvidedAction = result.kind === "recovering" || result.kind === "manual_required"
    ? result.action
    : undefined;
  const primarySpec = primary ?? { type: "ENTER_MANUAL" as ContentAction, label: "手动登录" };
  const secondarySpec = secondaryAction(result, primary);
  if (existing) {
    const text = existing.querySelector("span")!;
    if (text.textContent !== message) text.textContent = message;
    syncAction(existing.querySelector<HTMLButtonElement>("button:nth-child(1)")!, primarySpec);
    const secondary = existing.querySelector<HTMLButtonElement>("button:nth-child(2)")!;
    if (secondarySpec) syncAction(secondary, secondarySpec);
    else secondary.hidden = true;
    if (document.activeElement instanceof HTMLButtonElement && document.activeElement.hidden) {
      existing.querySelector<HTMLButtonElement>("button:not([hidden])")?.focus({ preventScroll: true });
    }
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
  const button = (spec: ActionSpec, hidden = false) => {
    const control = document.createElement("button");
    control.type = "button";
    control.dataset.action = spec.type;
    control.textContent = spec.label;
    control.hidden = hidden;
    control.style.cssText = [
      "min-height:44px", "padding:8px 12px", "border:1px solid #b8bec6",
      "border-radius:6px", "background:#f7f8f9", "color:#202326",
      "font:600 14px/1 system-ui,sans-serif", "touch-action:manipulation", "cursor:pointer",
    ].join(";");
    control.addEventListener("click", () => send(control.dataset.action as ContentAction));
    return control;
  };
  actions.append(
    button(primarySpec),
    button(secondarySpec ?? { type: "RETRY_AUTOMATIC" as ContentAction, label: "重试快捷登录" }, !secondarySpec)
  );
  banner.append(actions);

  const form = document.querySelector("form");
  form?.parentElement?.insertBefore(banner, form);
}

function secondaryAction(result: LoginRecoveryResult, primary: ProvidedAction): ActionSpec | undefined {
  if (primary === null) return undefined;
  if (primary?.type === "RETRY_AUTOMATIC") return undefined;
  if (primary?.type === "ENTER_MANUAL") return { type: "RETRY_AUTOMATIC", label: "恢复快捷登录" };
  if (primary) return { type: "ENTER_MANUAL", label: "手动登录" };
  return result.kind === "manual_required" ? { type: "RETRY_AUTOMATIC", label: "重试快捷登录" } : undefined;
}

function syncAction(button: HTMLButtonElement, spec: ActionSpec): void {
  button.dataset.action = spec.type;
  if (button.textContent !== spec.label) button.textContent = spec.label;
  button.hidden = false;
}
