const LOGIN_PATHS = new Set(["/login", "/authserver/login"]);

function visible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return !element.hidden && style.display !== "none" &&
    style.visibility !== "hidden" && style.opacity !== "0";
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
    const submit = form.querySelector<HTMLElement>('button[type="submit"], input[type="submit"]');
    if (username && password && submit && !username.disabled && !password.disabled &&
        visible(username) && visible(password) && visible(submit)) return true;
  }
  return false;
}
