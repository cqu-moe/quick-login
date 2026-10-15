import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { observeWebViewport, prepareWebViewport } from "./web-viewport.ts";
import { popupViewport } from "./viewport.ts";

export const extensionId = "igfidegfgfoofnoncpmbcokbffjmmook";
export const extensionOrigin = `chrome-extension://${extensionId}`;
const authOrigin = "https://auth.cqu.moe";
const identityPromises = new Map<string, Promise<{ email: string; password: string; userId: string }>>();

export function requiredControl() {
  const value = process.env.QUICKLOGIN_E2E_CONTROL;
  if (!value || !/^http:\/\/127\.0\.0\.1:\d+$/.test(value)) throw new Error("Missing isolated Auth control origin");
  return value;
}

export function account(key: string) {
  if (!/^[a-z0-9-]{1,64}$/.test(key)) throw new Error("Invalid isolated identity key");
  let promise = identityPromises.get(key);
  if (!promise) {
    promise = (async () => {
      const response = await fetch(`${requiredControl()}/identity`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({ error: "INVALID_RESPONSE" })) as { error?: string };
        throw new Error(`Synthetic identity preparation failed (${response.status}: ${detail.error ?? "unknown"})`);
      }
      const identity = await response.json() as { email?: string; password?: string; userId?: string };
      if (!identity.email || !identity.password || !identity.userId) {
        throw new Error("Synthetic identity readback failed");
      }
      return identity as { email: string; password: string; userId: string };
    })();
    identityPromises.set(key, promise);
  }
  return promise;
}

export async function serverState(userId: string) {
  const response = await fetch(`${requiredControl()}/state?userId=${encodeURIComponent(userId)}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Auth state readback failed (${response.status})`);
  return await response.json() as Promise<{
    devices: Array<{ deviceId: string; enabled: boolean | null; revokedAt: number | string | null }>;
    refreshTokens: number;
  }>;
}

export async function setOAuthClient(mode: "official" | "wrong_redirect") {
  const response = await fetch(`${requiredControl()}/oauth-client`, {
    method: "POST",
    body: JSON.stringify({ mode }),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 204) throw new Error(`OAuth client mode update failed (${response.status})`);
}

export async function networkEvents() {
  const response = await fetch(`${requiredControl()}/network`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Auth network evidence was unavailable");
  return await response.json() as Array<{ method: string; path: string; status: number; oauthError: string | null; codeIssued: boolean }>;
}

export async function assertOfficialClient() {
  const response = await fetch(`${requiredControl()}/oauth-client`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`OAuth client readback failed (${response.status})`);
  const raw = await response.json() as Record<string, string | number>;
  const registration = {
    clientId: raw.clientId,
    redirectUris: JSON.parse(String(raw.redirectUris)) as string[],
    scopes: JSON.parse(String(raw.scopes)) as string[],
    grantTypes: JSON.parse(String(raw.grantTypes)) as string[],
    responseTypes: JSON.parse(String(raw.responseTypes)) as string[],
    tokenEndpointAuthMethod: raw.tokenEndpointAuthMethod,
    requirePKCE: Number(raw.requirePKCE),
    disabled: Number(raw.disabled),
    metadata: JSON.parse(String(raw.metadata)) as { quickloginOfficial?: boolean; extensionOrigin?: string },
  };
  if (registration.clientId !== "cqu-quicklogin-chrome" ||
      registration.redirectUris.length !== 1 ||
      registration.redirectUris[0] !== `https://${extensionId}.chromiumapp.org/` ||
      registration.tokenEndpointAuthMethod !== "none" ||
      registration.requirePKCE !== 1 ||
      registration.disabled !== 0 ||
      registration.metadata.quickloginOfficial !== true ||
      registration.metadata.extensionOrigin !== extensionOrigin) {
    throw new Error("Official extension OAuth registration mismatch");
  }
  return registration;
}

export async function connectExtensionBrowser() {
  const endpoint = (globalThis as typeof globalThis & { __QUICKLOGIN_CDP_ENDPOINT__?: string }).__QUICKLOGIN_CDP_ENDPOINT__;
  if (!endpoint) throw new Error("Extension browser CDP endpoint is not active");
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  if (!context) throw new Error("Persistent extension browser context is missing");
  for (let attempt = 0; attempt < 50 && !context.serviceWorkers().length; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const worker = context.serviceWorkers().find(worker => worker.url() === `${extensionOrigin}/background.js`);
  if (!worker) {
    throw new Error(`Expected MV3 worker missing (${context.serviceWorkers().map(item => item.url()).join(", ")})`);
  }
  return { context };
}

export async function openPopup(context: BrowserContext) {
  const page = context.pages().find(candidate => /^http:\/\/127\.0\.0\.1:\d+\/$/.test(candidate.url()));
  if (!page) throw new Error("The tester-army active app page is missing");
  await page.goto(`${extensionOrigin}/popup.html`);
  await page.setViewportSize(popupViewport);
  await page.getByRole("button", { name: "连接 Auth" }).waitFor({ state: "visible" });
  await observeWebViewport(page);
  return page;
}

export function uiState(page: Page) {
  return page.evaluate(async () => await chrome.runtime.sendMessage({ type: "GET_UI_STATE" }));
}

export async function waitForUiState(page: Page, predicate: (value: any) => boolean, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let failure: unknown;
  let lastValue: unknown;
  do {
    try {
      const value = await uiState(page);
      lastValue = value;
      if (predicate(value)) return value;
    } catch (error) {
      failure = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  if (failure) throw failure;
  const state = lastValue as { deviceId?: unknown; snapshot?: unknown; local?: { authorization?: unknown; protocolSupport?: unknown } } | null;
  throw new Error(`Popup state was not reached (${JSON.stringify({
    hasDeviceId: Boolean(state?.deviceId),
    hasSnapshot: Boolean(state?.snapshot),
    authorization: state?.local?.authorization ?? null,
    protocolSupport: state?.local?.protocolSupport ?? null,
  })})`);
}

export async function hasTokens(page: Page) {
  return await page.evaluate(async () => {
    const values = await chrome.storage.local.get("quicklogin.tokens");
    return Boolean(values["quicklogin.tokens"]);
  });
}

export async function beginConnection(page: Page, context: BrowserContext, click: () => Promise<void>) {
  await click();
  let authPage: Page | undefined;
  const windowDeadline = Date.now() + 20_000;
  while (!authPage && Date.now() < windowDeadline) {
    authPage = context.pages().find(candidate => {
      try {
        return new URL(candidate.url()).origin === authOrigin;
      } catch {
        return false;
      }
    });
    if (!authPage) await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!authPage) {
    throw new Error("Real Auth interaction window was not opened");
  }
  await authPage.waitForURL(url => url.origin === authOrigin, { timeout: 20_000 });
  await prepareWebViewport(authPage);
  await recordEvent("oauth-window", { distinctFromPopup: authPage !== page });
  return { authPage };
}

export async function completeLogin(page: Page, key: string) {
  const identity = await account(key);
  await page.getByLabel("邮箱", { exact: true }).fill(identity.email);
  await page.locator("#password").fill(identity.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
}

export async function corruptPendingState(page: Page) {
  await page.evaluate(async () => {
    const key = "quicklogin.pkce";
    const values = await chrome.storage.local.get(key);
    const pending = values[key] as { state: string };
    await chrome.storage.local.set({ [key]: { ...pending, state: `${pending.state}-corrupted` } });
  });
}

export async function invalidateRegistrationMetadata(page: Page) {
  await page.evaluate(async () => {
    const key = "quicklogin.state.v2";
    const values = await chrome.storage.local.get(key);
    const state = values[key] as { installationId: string };
    await chrome.storage.local.set({ [key]: { ...state, installationId: "invalid registration" } });
  });
}

export async function hasPendingPkce(page: Page) {
  return await page.evaluate(async () => Boolean((await chrome.storage.local.get("quicklogin.pkce"))["quicklogin.pkce"]));
}

export async function captureArtifacts(name: string, pages: Array<Page | undefined>) {
  const output = process.env.QUICKLOGIN_E2E_ARTIFACTS;
  if (!output) return;
  const directory = join(output, "artifacts");
  await mkdir(directory, { recursive: true });
  const active = pages.filter((page): page is Page => Boolean(page));
  const lines = [`${new Date().toISOString()} ${name}`];
  for (const [index, page] of active.entries()) {
    await observeWebViewport(page);
    const url = new URL(page.url());
    lines.push(`page ${index + 1}: ${url.origin}${url.pathname}`);
    try {
      await page.screenshot({
        path: join(directory, `${name}-${index + 1}.png`),
        mask: [page.locator("input, textarea, [contenteditable='true']")],
        animations: "disabled",
      });
    } catch {
      lines.push(`page ${index + 1}: screenshot unavailable`);
    }
  }
  await appendFile(join(directory, "events.log"), `${lines.join("\n")}\n`);
}

export async function recordEvent(event: string, evidence: Record<string, string | number | boolean>) {
  const output = process.env.QUICKLOGIN_E2E_ARTIFACTS;
  if (!output) throw new Error("Missing isolated artifact directory");
  const directory = join(output, "artifacts");
  await mkdir(directory, { recursive: true });
  await appendFile(join(directory, "events.log"), `${JSON.stringify({ event, ...evidence })}\n`);
}
