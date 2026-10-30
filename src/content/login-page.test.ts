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

  it("accepts a button with omitted type but rejects explicit non-submit and disabled buttons", () => {
    const url = new URL("https://sso.cqu.edu.cn/login");
    expect(detectLoginForm(page(`
      <form><input name="username"><input type="password"><button>登录</button></form>
    `), url)).toBe(true);
    expect(detectLoginForm(page(`
      <form><input name="username"><input type="password"><button type="button">登录</button></form>
    `), url)).toBe(false);
    expect(detectLoginForm(page(`
      <form><input name="username"><input type="password"><button disabled>登录</button></form>
    `), url)).toBe(false);
  });

  it("does not infer QR entry from unrelated text or an unselected QR tab", () => {
    const url = new URL("https://sso.cqu.edu.cn/login");
    expect(detectLoginForm(page(`
      <div class="ruleList"><div class="showName">微信扫码</div><div class="showName">用户名密码</div></div>
      <div>请使用微信扫描二维码</div>
      <form id="normalLoginForm" style="visibility:hidden">
        <input name="username"><input type="password"><button>立即登录</button>
      </form>
    `), url)).toBe(false);
    expect(detectLoginForm(page(`
      <nz-tabset>
        <div role="tab" aria-selected="false">微信扫码</div>
        <div role="tab" aria-selected="true">用户名密码</div>
        <div class="ant-tabs-tabpane ant-tabs-tabpane-active" aria-hidden="false">
          <app-login-by-single-wechat><div class="scanBox">
            <span class="qrscantips">请使用微信扫描二维码</span>
          </div></app-login-by-single-wechat>
        </div>
      </nz-tabset>
      <div class="ant-tabs-tabpane" aria-hidden="true">
        <form id="normalLoginForm"><input name="username"><input type="password"><button>立即登录</button></form>
      </div>
    `), url)).toBe(false);
    expect(detectLoginForm(page(`
      <nz-tabset>
        <div role="tab" aria-selected="true">微信扫码</div>
        <div role="tab" aria-selected="false">用户名密码</div>
        <div class="ant-tabs-tabpane ant-tabs-tabpane-active" aria-hidden="false">
          <app-login-by-single-wechat><div class="scanBox">
            <span class="qrscantips">请使用微信扫描二维码</span>
          </div></app-login-by-single-wechat>
        </div>
      </nz-tabset>
      <div class="ant-tabs-tabpane" aria-hidden="true">
        <form id="normalLoginForm"><input name="username"><input type="password"><button>立即登录</button></form>
      </div>
    `), url)).toBe(false);
  });
});
