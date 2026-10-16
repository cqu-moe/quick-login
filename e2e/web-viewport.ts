import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { popupViewport, webViewport, viewportName } from "./viewport.ts";

export async function observeWebViewport(page: Page) {
  const url = new URL(page.url());
  const role = url.protocol === "chrome-extension:" ? "popup"
    : url.origin === "https://auth.cqu.moe" ? "auth"
      : url.origin === "https://sso.cqu.edu.cn" ? "school" : "other";
  if (role === "other") return;
  const expected = role === "popup" ? popupViewport : webViewport;
  const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    visualWidth: visualViewport?.width, visualHeight: visualViewport?.height }));
  const output = process.env.QUICKLOGIN_E2E_ARTIFACTS;
  if (!output) throw new Error("Missing viewport evidence directory");
  await mkdir(join(output, "artifacts"), { recursive: true });
  const attemptId = (globalThis as typeof globalThis & { __QUICKLOGIN_ATTEMPT_ID__?: string }).__QUICKLOGIN_ATTEMPT_ID__;
  if (!attemptId) throw new Error("Viewport observation is missing its actual attempt ID");
  await appendFile(join(output, "artifacts/viewports.jsonl"), JSON.stringify({ viewport: viewportName,
    attemptId, role, origin: role === "popup" ? "chrome-extension:" : url.origin, path: url.pathname, expected, actual }) + "\n");
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(`Actual Web viewport mismatch: expected ${expected.width}x${expected.height}, observed ${actual.width}x${actual.height}`);
  }
}

export async function prepareWebViewport(page: Page) {
  await page.setViewportSize(webViewport);
  await observeWebViewport(page);
}

export async function openWebPage(context: BrowserContext, url: string) {
  const page = await context.newPage();
  await page.setViewportSize(webViewport);
  await page.goto(url);
  await observeWebViewport(page);
  return page;
}
