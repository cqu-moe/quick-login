import { detectLoginForm } from "./login-page";
import { renderStatusBanner } from "./status-banner";
import type { ContentMessage, LoginRecoveryResult } from "../shared/messages";

let pending = false;
let userEditing = false;

function send(message: ContentMessage): Promise<LoginRecoveryResult> {
  return chrome.runtime.sendMessage(message) as Promise<LoginRecoveryResult>;
}

async function check(): Promise<void> {
  if (pending || userEditing || !detectLoginForm(document, new URL(location.href))) return;
  pending = true;
  try {
    const result = await send({ type: "LOGIN_FORM_VISIBLE" });
    renderStatusBanner(document, result, (type) => {
      if (type === "ENTER_MANUAL") {
        userEditing = true;
        void send({ type });
      } else {
        userEditing = false;
        void send({ type }).then((next) => renderStatusBanner(document, next, () => undefined));
      }
    });
  } finally {
    pending = false;
  }
}

const noticeManualEdit = (event: Event) => {
  if (event.target instanceof HTMLInputElement &&
      (event.target.type === "text" || event.target.type === "email" || event.target.type === "password")) {
    userEditing = true;
    document.removeEventListener("input", noticeManualEdit);
    void send({ type: "ENTER_MANUAL" });
  }
};
document.addEventListener("input", noticeManualEdit);

let debounce = 0;
const observer = new MutationObserver(() => {
  clearTimeout(debounce);
  debounce = window.setTimeout(() => { void check(); }, 150);
});
observer.observe(document.documentElement, { childList: true, subtree: true });
void check();
