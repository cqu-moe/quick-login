import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { connectExtensionBrowser, extensionId, extensionOrigin, openPopup, recordEvent } from "./helpers.ts";

test("tester-army rides a persistent Chromium context and loads the real MV3 extension", async ({ app, browser, screen }) => {
  await app.open("/");
  const { context } = await connectExtensionBrowser();
  let navigation = "supported";
  try {
    await browser.goto(`${extensionOrigin}/popup.html`);
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    if (failure.code !== "POLICY_DENIED" || !failure.message?.includes("forbidden URL scheme: chrome-extension:")) throw error;
    navigation = "POLICY_DENIED: chrome-extension:";
  }
  await recordEvent("tester-army-capability", { persistentContext: true, extensionNavigation: navigation });
  const popup = await openPopup(context);
  await expect(screen.getByRole("button", { name: "连接 Auth" })).toBeVisible();
  expect(await popup.evaluate(() => chrome.runtime.id)).toBe(extensionId);
  if (process.env.QUICKLOGIN_E2E_BREAK_ASSERTION === "1") {
    expect("forced-negative-control").toBe("expected-failure");
  }
});
