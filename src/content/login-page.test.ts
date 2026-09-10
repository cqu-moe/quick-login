import { describe, expect, it } from "vitest";
import { detectLoginForm } from "./login-page";

function page(body: string): Document {
  return new DOMParser().parseFromString(body, "text/html");
}

describe("school login form detection", () => {
  it("requires the exact SSO login path and an interactive credential form", () => {
    const document = page(`
      <form><label>账号<input name="username"></label>
      <label>密码<input type="password"></label><button type="submit">登录</button></form>
    `);
    expect(detectLoginForm(document, new URL("https://sso.cqu.edu.cn/login?service=synthetic"))).toBe(true);
    expect(detectLoginForm(document, new URL("https://portal.cqu.edu.cn/login"))).toBe(false);
    expect(detectLoginForm(document, new URL("https://sso.cqu.edu.cn/challenge"))).toBe(false);
  });

  it("rejects hidden templates and password-free challenge pages", () => {
    expect(detectLoginForm(page(`
      <form hidden><input name="username"><input type="password"><button type="submit">登录</button></form>
    `), new URL("https://sso.cqu.edu.cn/login"))).toBe(false);
    expect(detectLoginForm(page(`
      <form><input name="code"><button type="submit">验证</button></form>
    `), new URL("https://sso.cqu.edu.cn/login"))).toBe(false);
  });
});
