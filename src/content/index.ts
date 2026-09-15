import { detectLoginForm } from "./login-page";
import { renderStatusBanner } from "./status-banner";
import type { ContentMessage, LoginRecoveryResult } from "../shared/messages";

let pending = false;
let userEditing = false;
let navigating = false;
let stopped = false;

function send(message: ContentMessage): Promise<LoginRecoveryResult> {
  return chrome.runtime.sendMessage(message) as Promise<LoginRecoveryResult>;
}

function present(result: LoginRecoveryResult): void {
  navigating=result.kind === "navigating";
  stopped=result.kind === "manual_required";
  renderStatusBanner(document,result,act);
}

function act(type: "ENTER_MANUAL" | "RETRY_AUTOMATIC"): void {
  if (pending) return;
  userEditing=type === "ENTER_MANUAL";
  stopped=userEditing;
  navigating=false;
  pending=true;
  void send({type}).then(present).catch(()=>{
    present({kind:"manual_required",message:"暂时无法连接插件，可手动登录或重试。"});
  }).finally(()=>{pending=false;});
}

async function check(): Promise<void> {
  if (pending || userEditing || navigating || stopped || document.hidden || !detectLoginForm(document,new URL(location.href))) return;
  pending=true;
  try {
    present(await send({type:"LOGIN_FORM_VISIBLE"}));
  } catch {
    present({kind:"manual_required",message:"暂时无法连接插件，可手动登录或重试。"});
  } finally {pending=false;}
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
const waitingCheck=window.setInterval(() => { void check(); },5_000);
document.addEventListener("visibilitychange",()=>{ if (!document.hidden) void check(); });
window.addEventListener("pagehide",()=>{
  window.clearInterval(waitingCheck);window.clearTimeout(debounce);observer.disconnect();
},{once:true});
