import "./style.css";
import { derivePopupView, type PopupAction, type PopupInput } from "./view-model";

const app = document.querySelector<HTMLElement>("#app")!;
const labels: Record<PopupAction, string> = {
  login: "登录 Auth",
  open_settings: "管理设备",
  resume: "恢复自动登录",
  switch_managed: "切换为快捷登录",
  retry: "立即重试",
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
  await render();
}

async function render(): Promise<void> {
  const input = await send({ type: "GET_UI_STATE" }) as PopupInput;
  const view = derivePopupView(input);
  app.replaceChildren();

  const header = document.createElement("header");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "CQU 快捷登录";
  const heading = document.createElement("h1");
  heading.textContent = view.heading;
  const description = document.createElement("p");
  description.className = "description";
  description.textContent = view.description;
  header.append(eyebrow, heading, description);

  const control = document.createElement("label");
  control.className = "switch-row";
  const copy = document.createElement("span");
  const deviceLabel = document.createElement("strong");
  deviceLabel.textContent = "此设备";
  const deviceDetail = document.createElement("small");
  deviceDetail.textContent = "独立学校会话";
  copy.append(deviceLabel, deviceDetail);
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = view.switchChecked;
  checkbox.disabled = !view.switchEnabled;
  checkbox.setAttribute("aria-label", "启用此设备的快捷登录");
  checkbox.addEventListener("change", async () => {
    checkbox.disabled = true;
    try {
      await send({ type: "SET_ENABLED", enabled: checkbox.checked });
    } finally {
      await render();
    }
  });
  control.append(copy, checkbox);

  const actions = document.createElement("div");
  actions.className = "actions";
  view.actions.forEach((action, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = index === 0 ? "primary" : "secondary";
    button.textContent = labels[action];
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "处理中…";
      try { await act(action); } catch { await render(); }
    });
    actions.append(button);
  });
  app.append(header, control, actions);
}

void render();
