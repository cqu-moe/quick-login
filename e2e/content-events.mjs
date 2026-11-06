import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
try {
  const context = await browser.newContext();
  await context.route("**/*", route => route.request().url() === "https://sso.cqu.edu.cn/login"
    ? route.fulfill({ contentType: "text/html; charset=utf-8", body: '<form><input type="text" aria-label="账号"><input type="password"><button>登录</button></form>' })
    : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  await page.goto("https://sso.cqu.edu.cn/login");
  const cdp = await context.newCDPSession(page);
  const { frameTree } = await cdp.send("Page.getFrameTree");
  const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
    frameId: frameTree.frame.id, worldName: "quicklogin-content-test",
  });
  async function isolated(expression) {
    const result = await cdp.send("Runtime.evaluate", { expression, contextId: executionContextId,
      returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  await isolated(`globalThis.sent = []; globalThis.chrome = { runtime: {
    id: 'test-extension', onMessage: { addListener() {}, removeListener() {} },
    async sendMessage(message) {
      sent.push(message.type);
      if (message.type === 'RETRY_AUTOMATIC') return { kind: 'navigating' };
      return { kind: 'manual_required', message: '请重试。' };
    }
  } };`);
  await isolated(await readFile("dist/content.js", "utf8"));
  const retry = page.getByRole("button", { name: "重试快捷登录", exact: true });
  await retry.waitFor();
  await page.evaluate(() => {
    for (const button of document.querySelectorAll("#cqu-quicklogin-status button")) {
      button.dataset.action = "SWITCH_TO_MANAGED";
      button.click();
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    document.querySelector("input").dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.deepEqual(await isolated("sent"), ["LOGIN_FORM_VISIBLE"]);
  await retry.click();
  await page.getByText("正在恢复快捷登录，请稍候。", { exact: true }).waitFor();
  assert.deepEqual(await isolated("sent"), ["LOGIN_FORM_VISIBLE", "RETRY_AUTOMATIC"]);
  await page.getByRole("button", { name: "手动登录", exact: true }).press("Enter");
  await retry.waitFor();
  assert.equal(await isolated("sent.at(-1)"), "ENTER_MANUAL");
  await retry.click();
  await page.getByText("正在恢复快捷登录，请稍候。", { exact: true }).waitFor();
  await page.getByLabel("账号", { exact: true }).fill("synthetic-user");
  await retry.waitFor();
  assert.deepEqual(await isolated("sent"), ["LOGIN_FORM_VISIBLE", "RETRY_AUTOMATIC", "ENTER_MANUAL", "RETRY_AUTOMATIC", "ENTER_MANUAL"]);
  console.log("PASS: page-world action tampering and synthetic events blocked; trusted mouse, keyboard and typing preserved");
} finally {
  await browser.close();
}
