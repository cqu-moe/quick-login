import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import {
  account, assertOfficialClient, beginConnection, captureArtifacts, completeLogin, connectExtensionBrowser,
  corruptPendingState, hasTokens, openPopup, serverState, setOAuthClient,
  hasPendingPkce, invalidateRegistrationMetadata, networkEvents, recordEvent, waitForUiState,
} from "./helpers.ts";

type AuthPage = Awaited<ReturnType<typeof beginConnection>>["authPage"];

test("the real popup completes Auth PKCE login and device registration", { tags: ["auth-device-registration"] }, async ({ app, screen, browser }) => {
  await app.open("/");
  const identity = await account("success");
  await assertOfficialClient();
  const { context } = await connectExtensionBrowser();
  const tlsProbe = await context.newPage();
  const health = await tlsProbe.goto("https://auth.cqu.moe/api/v1/health");
  expect(health?.status()).toBe(200);
  const healthText = await tlsProbe.textContent("body");
  if (typeof healthText !== "string") throw new Error("Auth TLS health response was empty");
  const healthBody = JSON.parse(healthText) as { data?: { status?: string } };
  expect(healthBody.data?.status).toBe("ok");
  await tlsProbe.close();
  const popup = await openPopup(context);
  let authPage: AuthPage | undefined;
  try {
    const networkStart = (await networkEvents()).length;
    const connection = await beginConnection(popup, context, () => screen.getByRole("button", { name: "连接 Auth" }).click());
    authPage = connection.authPage;
    expect(await browser.url()).toBe(popup.url());
    await recordEvent("tester-army-oauth-window", { followsNativeWindow: false, activePageRemainsPopup: true });
    await completeLogin(authPage, "success");
    const state = await waitForUiState(popup, value => value?.deviceId && value?.local?.authorization === "authorized");
    const server = await serverState(identity.userId);
    expect(server.devices.length).toBe(1);
    expect(server.devices[0]?.deviceId).toBe(state.deviceId);
    expect(server.devices[0]?.revokedAt).toBe(null);
    expect(server.refreshTokens).toBeGreaterThanOrEqual(1);
    expect(state.snapshot?.identity?.deviceId).toBe(state.deviceId);
    expect(state.snapshot?.authorization?.state).toBe("authorized");
    expect((await networkEvents()).slice(networkStart).some(event =>
      event.path === "/api/v1/cqu/quicklogin/registrations" && event.status === 200)).toBe(true);
    expect(await hasTokens(popup)).toBe(true);
    await expect(screen.getByRole("heading", { name: "快捷登录已暂停", exact: true })).toBeVisible();
    await expect(screen.getByRole("button", { name: "前往 Auth", exact: true })).toBeVisible();
    await expect(screen.getByRole("button", { name: "连接 Auth" })).not.toBeVisible();

    const settings = await context.newPage();
    await settings.goto("https://auth.cqu.moe/settings");
    const session = await settings.evaluate(async () => await (await fetch("/api/v1/auth/get-session")).json());
    expect(session?.user?.id).toBe(identity.userId);
    const sourceProbe = await context.newPage();
    await sourceProbe.goto("https://auth.cqu.moe/");
    const external = await sourceProbe.evaluate(async ({ id, expiresAt }) => {
      return await chrome.runtime.sendMessage(id, {
        type: "RESUME_DEVICE",
        deviceId: "source-rejected",
        resumeTicket: "source-rejected",
        expiresAt,
      });
    }, { id: "igfidegfgfoofnoncpmbcokbffjmmook", expiresAt: Date.now() + 300_000 });
    expect(external).toEqual({ accepted: false });
    const stateAfterExternal = await waitForUiState(popup, value =>
      value?.deviceId === state.deviceId && value?.local?.authorization === "authorized");
    expect(stateAfterExternal.snapshot?.authorization?.state).toBe("authorized");
    expect(context.pages().some(page => {
      try {
        return new URL(page.url()).origin === "https://auth.cqu.moe" &&
          page !== sourceProbe && page !== settings && page !== authPage;
      } catch { return false; }
    })).toBe(false);

    const disallowed = await context.newPage();
    await disallowed.goto(app.baseUrl ?? "http://127.0.0.1:9");
    expect(await disallowed.evaluate(() => typeof chrome.runtime?.sendMessage)).toBe("undefined");
    await captureArtifacts("success-popup", [popup]);
    await Promise.allSettled([authPage.close(), settings.close(), sourceProbe.close(), disallowed.close()]);
  } catch (error) {
    await captureArtifacts("success-failure", [popup, authPage]);
    throw error;
  } finally {
    await popup.close();
  }
});

test("canceling the real Auth login does not connect the device", async ({ app, screen }) => {
  await app.open("/");
  const identity = await account("negative-controls");
  const { context } = await connectExtensionBrowser();
  const popup = await openPopup(context);
  let authPage: AuthPage | undefined;
  try {
    const connection = await beginConnection(popup, context, () => screen.getByRole("button", { name: "连接 Auth" }).click());
    authPage = connection.authPage;
    await authPage.close();
    const state = await waitForUiState(popup, value => value?.local?.authorization === "disconnected");
    const server = await serverState(identity.userId);
    expect(state.deviceId ?? null).toBe(null);
    expect(server.devices.length).toBe(0);
    expect(server.refreshTokens).toBe(0);
    expect(await hasTokens(popup)).toBe(false);
    await expect(screen.getByRole("heading", { name: "未连接 Auth", exact: true })).toBeVisible();
  } catch (error) {
    await captureArtifacts("cancel-failure", [popup, authPage]);
    throw error;
  } finally {
    await popup.close();
  }
});

test("a real callback with the wrong pending state is rejected", async ({ app, screen }) => {
  await app.open("/");
  const identity = await account("negative-controls");
  const { context } = await connectExtensionBrowser();
  const popup = await openPopup(context);
  let authPage: AuthPage | undefined;
  try {
    const networkStart = (await networkEvents()).length;
    const connection = await beginConnection(popup, context, () => screen.getByRole("button", { name: "连接 Auth" }).click());
    authPage = connection.authPage;
    await corruptPendingState(popup);
    await completeLogin(authPage, "negative-controls");
    const state = await waitForUiState(popup, value => value?.local?.authorization === "disconnected");
    const server = await serverState(identity.userId);
    expect(state.deviceId ?? null).toBe(null);
    expect(server.devices.length).toBe(0);
    expect(server.refreshTokens).toBe(0);
    expect(await hasTokens(popup)).toBe(false);
    expect(await hasPendingPkce(popup)).toBe(false);
    const network = (await networkEvents()).slice(networkStart);
    expect(network.some(event => event.codeIssued)).toBe(true);
    expect(network.some(event => event.path === "/api/v1/auth/oauth2/token")).toBe(false);
    await expect(screen.getByRole("heading", { name: "未连接 Auth", exact: true })).toBeVisible();
  } catch (error) {
    await captureArtifacts("wrong-state-failure", [popup, authPage]);
    throw error;
  } finally {
    await popup.close();
  }
});

test("a callback outside the registered extension redirect is rejected", async ({ app, screen }) => {
  await app.open("/");
  const identity = await account("negative-controls");
  const { context } = await connectExtensionBrowser();
  const popup = await openPopup(context);
  let authPage: AuthPage | undefined;
  try {
    const networkStart = (await networkEvents()).length;
    await setOAuthClient("wrong_redirect");
    const connection = await beginConnection(popup, context, () => screen.getByRole("button", { name: "连接 Auth" }).click());
    authPage = connection.authPage;
    await authPage.waitForURL(url => url.origin === "https://auth.cqu.moe" && url.pathname === "/auth/error");
    expect((await networkEvents()).slice(networkStart).some(event =>
      event.path === "/api/v1/auth/oauth2/authorize" && event.status === 302 && event.oauthError === "invalid_redirect")).toBe(true);
    await recordEvent("wrong-callback", { authError: "invalid_redirect", rejectedBeforeWindowClosed: true });
    await authPage.close();
    const state = await waitForUiState(popup, value => value?.local?.authorization === "disconnected");
    const server = await serverState(identity.userId);
    expect(state.deviceId ?? null).toBe(null);
    expect(server.devices.length).toBe(0);
    expect(server.refreshTokens).toBe(0);
    expect(await hasTokens(popup)).toBe(false);
    await expect(screen.getByRole("heading", { name: "未连接 Auth", exact: true })).toBeVisible();
  } catch (error) {
    await captureArtifacts("wrong-callback-failure", [popup, authPage]);
    throw error;
  } finally {
    await setOAuthClient("official");
    await popup.close();
  }
});

test("real device registration rejection does not display a connected device", async ({ app, screen }) => {
  await app.open("/");
  const identity = await account("negative-controls");
  const { context } = await connectExtensionBrowser();
  const popup = await openPopup(context);
  let authPage: AuthPage | undefined;
  try {
    const networkStart = (await networkEvents()).length;
    await invalidateRegistrationMetadata(popup);
    const connection = await beginConnection(popup, context, () => screen.getByRole("button", { name: "连接 Auth" }).click());
    authPage = connection.authPage;
    await completeLogin(authPage, "negative-controls");
    const state = await waitForUiState(popup, value => value?.local?.authorization === "disconnected");
    const server = await serverState(identity.userId);
    expect(state.deviceId ?? null).toBe(null);
    expect(server.devices.length).toBe(0);
    expect(server.refreshTokens).toBeGreaterThanOrEqual(1);
    expect(state.snapshot ?? null).toBe(null);
    expect((await networkEvents()).slice(networkStart).some(event =>
      event.path === "/api/v1/cqu/quicklogin/registrations" && event.status === 422)).toBe(true);
    await expect(screen.getByRole("heading", { name: "未连接 Auth", exact: true })).toBeVisible();
  } catch (error) {
    await captureArtifacts("registration-rejection-failure", [popup, authPage]);
    throw error;
  } finally {
    await popup.close();
  }
});
