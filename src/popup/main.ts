import "./style.css";
import {
  derivePopupView,
  type PopupAction,
  type PopupInput,
  type PopupView,
} from "./view-model";

const app = document.querySelector<HTMLElement>("#app")!;
const labels: Record<PopupAction, string> = {
  login: "连接 Auth",
  open_settings: "前往 Auth",
  resume: "恢复快捷登录",
  switch_managed: "切换到快捷登录",
  retry: "重试",
  retry_local: "重新同步",
  update: "更新插件",
  fix_permissions: "检查浏览器权限",
  manual_login: "手动登录",
};

async function send(message: Record<string, unknown>) {
  return chrome.runtime.sendMessage(message);
}

async function act(action: PopupAction): Promise<void> {
  if (action === "login") await send({ type: "LOGIN" });
  if (action === "open_settings") await send({ type: "OPEN_SETTINGS" });
  if (action === "resume") await send({ type: "RESUME" });
  if (action === "switch_managed") await send({ type: "SWITCH_TO_MANAGED" });
  if (action === "retry") await send({ type: "SYNC" });
  if (action === "retry_local") await send({ type: "RETRY_LOCAL" });
  if (action === "update" || action === "fix_permissions") await send({ type: "OPEN_EXTENSION_SETTINGS" });
  if (action === "manual_login") await send({ type:"OPEN_SCHOOL_MANUAL" });
  await render();
}

function pendingView(heading: string, switchChecked: boolean): PopupView {
  return {
    heading,
    description: "",
    tone: "busy",
    switchEnabled: false,
    switchChecked,
    actions: [],
  };
}

function renderView(view: PopupView): void {
  const signature=JSON.stringify(view);
  if (app.dataset.view === signature) return;
  const focused=(document.activeElement as HTMLElement | null)?.dataset.control;
  app.dataset.view=signature;
  app.replaceChildren();

  const header = document.createElement("header");
  header.className = "brand";
  const mark = document.createElement("span");
  mark.className = "brand-mark";
  mark.setAttribute("aria-hidden", "true");
  const brand = document.createElement("strong");
  brand.textContent = "QuickLogin";
  header.append(mark, brand);

  const status = document.createElement("section");
  status.className = "status";
  status.dataset.tone = view.tone;
  const statusIcon = document.createElement("span");
  statusIcon.className = "status-icon";
  statusIcon.setAttribute("aria-hidden", "true");
  const kicker = document.createElement("p");
  kicker.className = "status-kicker";
  kicker.textContent = "当前状态";
  const heading = document.createElement("h1");
  heading.textContent = view.heading;
  status.append(statusIcon, kicker, heading);
  if (view.description) {
    const description = document.createElement("p");
    description.className = "status-description";
    description.textContent = view.description;
    status.append(description);
  }

  const controls = document.createElement("footer");
  controls.className = "controls";
  const action = view.actions[0];
  if (action) {
    const button = document.createElement("button");
    button.dataset.control="primary";
    button.type = "button";
    button.textContent = labels[action];
    button.addEventListener("click", async () => {
      const heading = action === "login" ? "正在连接" :
        action === "open_settings" ? "正在打开 Auth" : "正在同步";
      renderView(pendingView(heading, view.switchChecked));
      try { await act(action); } catch { await render(); }
    });
    controls.append(button);
  }
  if (view.switchVisible ?? !action) {
    const control = document.createElement("label");
    control.className = "switch-control";
    const label = document.createElement("span");
    label.className = "sr-only";
    label.textContent = "开启 QuickLogin";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.control="switch";
    checkbox.checked = view.switchChecked;
    checkbox.disabled = !view.switchEnabled;
    checkbox.addEventListener("change", async () => {
      const enabled = checkbox.checked;
      renderView(pendingView(enabled ? "正在同步" : "正在关闭", enabled));
      try {
        await send({ type: "SET_ENABLED", enabled });
      } finally {
        await render();
      }
    });
    const track = document.createElement("span");
    track.className = "switch-track";
    track.setAttribute("aria-hidden", "true");
    track.append(document.createElement("span"));
    control.append(label, checkbox, track);
    controls.append(control);
  }

  app.append(header, status, controls);
  if (focused) app.querySelector<HTMLElement>(`[data-control="${focused}"]`)?.focus();
}

let renderSequence=0;
async function render(): Promise<void> {
  const sequence=++renderSequence;
  const input = await send({ type: "GET_UI_STATE" }) as PopupInput;
  if (sequence !== renderSequence) return;
  renderView(derivePopupView(input));
}

renderView(pendingView("正在检查", false));
void render().then(() => send({type:"CHECK_STATE"}));
chrome.storage.onChanged.addListener((_changes,areaName) => {
  if (areaName === "local") void render();
});
const foregroundTimer=window.setInterval(() => {
  if (document.visibilityState === "visible") void send({type:"CHECK_STATE"});
},5_000);
window.addEventListener("pagehide",() => window.clearInterval(foregroundTimer),{once:true});
