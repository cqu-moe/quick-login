const LOGIN_PATHS = new Set(["/login", "/authserver/login"]);

function visible(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (current.hidden || style.display === "none" || style.visibility === "hidden" ||
        style.opacity === "0" || current.getAttribute("aria-hidden") === "true") return false;
  }
  return true;
}

function currentQrLoginShell(document: Document): boolean {
  const tip = document.querySelector<HTMLElement>("app-login-by-single-wechat .qrscantips");
  if (!tip || tip.textContent?.trim() !== "请使用微信扫描二维码" || !visible(tip)) return false;
  const activePane = tip.closest<HTMLElement>(".ant-tabs-tabpane");
  if (!activePane || !activePane.classList.contains("ant-tabs-tabpane-active") ||
      activePane.getAttribute("aria-hidden") !== "false" || !visible(activePane)) return false;
  const tabset = activePane.closest<HTMLElement>("nz-tabset");
  if (!tabset || !visible(tabset)) return false;
  const tabs = [...tabset.querySelectorAll<HTMLElement>("[role=tab][aria-selected]")]
    .filter(visible)
    .map(tab => ({ selected: tab.getAttribute("aria-selected") === "true", label: tab.textContent?.trim() }));
  if (!tabs.some(tab => tab.selected && tab.label === "微信扫码") ||
      !tabs.some(tab => !tab.selected && tab.label === "用户名密码")) return false;
  const form = tabset.querySelector("#normalLoginForm");
  const inactivePane = form?.closest<HTMLElement>(".ant-tabs-tabpane");
  return form instanceof HTMLFormElement && !visible(form) &&
    inactivePane?.getAttribute("aria-hidden") === "true";
}

export function detectLoginForm(document: Document, url: URL): boolean {
  if (url.protocol !== "https:" || url.hostname !== "sso.cqu.edu.cn" ||
      !LOGIN_PATHS.has(url.pathname)) return false;
  for (const form of document.querySelectorAll("form")) {
    if (!(form instanceof HTMLFormElement) || !visible(form)) continue;
    const username = form.querySelector<HTMLInputElement>(
      'input[type="text"], input[type="email"], input[name="username"]'
    );
    const password = form.querySelector<HTMLInputElement>('input[type="password"]');
    const submit = [...form.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")]
      .find(control => control.type === "submit");
    if (username && password && submit && !username.disabled && !password.disabled &&
        !submit.disabled && visible(username) && visible(password) && visible(submit)) return true;
  }
  return currentQrLoginShell(document);
}
