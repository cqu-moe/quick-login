import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { captureArtifacts, networkEvents, recordEvent, serverState } from './helpers.ts';
import { localState, relay, until } from './school-helpers.ts';
import { connectDevice, control, expireLocalAccess, nativeAlarmRestart, quiet, reconnect } from './device-helpers.ts';
import { stopExtensionWorker } from './worker-debugger.ts';
import { chromium } from 'playwright-core';
import { extensionBrowser } from './browser.ts';
import { extensionOrigin } from './helpers.ts';
import { authorize, revoke } from './device-helpers.ts';

test('QUICKLOGIN-03 native alarm wakes a stopped MV3 worker after token transport 503 and rotates the real Auth refresh token', { timeout: 180_000 }, async ({ app }) => {
  const { popup, context, identity } = await connectDevice(app, 'alarm-refresh');
  try {
    const before = await localState(popup);
    const previous = await popup.evaluate(async () => {
      const token = (await chrome.storage.local.get('quicklogin.tokens'))['quicklogin.tokens'] as { accessToken: string; refreshToken: string };
      return { access: await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token.accessToken)).then(value => [...new Uint8Array(value)].join(',')), refresh: await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token.refreshToken)).then(value => [...new Uint8Array(value)].join(',')) };
    });
    await control('/token-transport', { unavailable: true });
    await expireLocalAccess(popup);
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CHECK_STATE' }));
    await until(() => localState(popup), state => state.observation === 'unreachable' && state.nextAttemptAt !== null);
    const failed = await localState(popup);
    expect(failed.deviceId).toBe(before.deviceId);
    expect(failed.authorization).toBe('authorized');
    expect(failed.receipt).toBe(null);
    expect((await networkEvents()).some(event => event.path.endsWith('/oauth2/token') && event.status === 503)).toBe(true);
    await control('/token-transport', { unavailable: false });
    await quiet(popup);
    const native = await nativeAlarmRestart(context, popup, () => stopExtensionWorker(context, popup), process.env.QUICKLOGIN_E2E_BREAK_ALARM === '1');
    await until(() => localState(popup), state => state.observation === 'fresh' && state.networkFailures === 0);
    const rotated = await popup.evaluate(async previous => {
      const token = (await chrome.storage.local.get('quicklogin.tokens'))['quicklogin.tokens'] as { accessToken: string; refreshToken: string };
      const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].join(',');
      return { access: await hash(token.accessToken) !== previous.access, refresh: await hash(token.refreshToken) !== previous.refresh };
    }, previous);
    expect(rotated).toEqual({ access: true, refresh: true });
    const after = await localState(popup);
    expect(after.deviceId).toBe(before.deviceId);
    expect(after.installationId).toBe(before.installationId);
    expect(after.reportEpoch).toBe(before.reportEpoch);
    expect((await serverState(identity.userId)).devices.length).toBe(1);
    await recordEvent('native-alarm-refresh', { ...native, realTokenRotation: rotated.refresh, deviceRetained: true });
  } catch (error) { await captureArtifacts('alarm-refresh-failure', [popup]); throw error; }
  finally { await control('/token-transport', { unavailable: false }); }
});

test('QUICKLOGIN-03 late real refresh persists across disable but cannot overwrite a newer explicit OAuth authorization', { timeout: 180_000 }, async ({ app }) => {
  const { popup, settings, identity } = await connectDevice(app, 'late-refresh', true);
  async function fingerprint() {
    return popup.evaluate(async () => {
      const token = (await chrome.storage.local.get('quicklogin.tokens'))['quicklogin.tokens'] as { refreshToken: string };
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token.refreshToken)))].join(',');
    });
  }
  try {
    const first = await localState(popup), firstToken = await fingerprint();
    await relay({ path: 'token', hold: true, once: true });
    await expireLocalAccess(popup);
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CHECK_STATE' }));
    await until(() => relay(), value => value.heldResponses === 1);
    await popup.getByRole('checkbox', { name: '开启 QuickLogin' }).press('Space');
    await until(() => localState(popup), state => !state.enabledIntent && state.localGeneration > first.localGeneration);
    await relay({ hold: false });
    await until(() => localState(popup), state => !state.pendingCommand);
    expect(await fingerprint() !== firstToken).toBe(true);
    expect((await localState(popup)).authGeneration).toBe(first.authGeneration);
    expect((await localState(popup)).receipt).toBe(null);

    await relay({ path: 'token', hold: true, once: true });
    await expireLocalAccess(popup);
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CHECK_STATE' }));
    await until(() => relay(), value => value.heldResponses === 1);
    const old = await localState(popup);
    await settings.goto(`https://auth.cqu.moe/settings?quickloginDevice=${old.deviceId}&quickloginReconnect=1`);
    await settings.getByRole('button', { name: '重新连接', exact: true }).click();
    await until(() => localState(popup), state => state.authorization === 'authorized' && state.authGeneration > old.authGeneration && state.reportEpoch !== old.reportEpoch);
    const replacement = await fingerprint();
    await relay({ hold: false });
    await until(() => localState(popup), state => !state.pendingCommand && !state.connectIntentId && state.observation === 'fresh');
    expect(await fingerprint() === replacement).toBe(true);
    expect((await localState(popup)).deviceId).toBe(first.deviceId);
    expect((await serverState(identity.userId)).devices.length).toBe(1);
    await recordEvent('late-refresh-fences', { rotatedTokenRetainedAcrossDisable: true, newerAuthorizationRetained: true, sameDevice: true });
  } catch (error) { await captureArtifacts('late-refresh-failure', [popup, settings]); throw error; }
  finally { await relay({ hold: false }); }
});

test('QUICKLOGIN-03 actual Auth device revocation rejects old resource and refresh credentials while another installation and website survive', { timeout: 240_000 }, async ({ app, browser: managedBrowser }) => {
  await managedBrowser.onDialog('accept');
  const { popup, context, settings, identity } = await connectDevice(app, 'revoke-device', true);
  const before = await localState(popup);
  let lease: Awaited<ReturnType<typeof extensionBrowser.acquire>> | undefined;
  try {
    const oldCredentials = await popup.evaluate(async () => (await chrome.storage.local.get('quicklogin.tokens'))['quicklogin.tokens'] as { accessToken: string; refreshToken: string });
    lease = await extensionBrowser.acquire({ signal: new AbortController().signal } as Parameters<typeof extensionBrowser.acquire>[0]);
    const browser = await chromium.connectOverCDP(lease.cdpEndpoint!);
    const otherContext = browser.contexts()[0]!;
    const other = await otherContext.newPage();
    await other.goto(`${extensionOrigin}/popup.html`);
    await authorize(other, otherContext, 'revoke-device');
    const second = await localState(other);
    expect(second.deviceId !== before.deviceId).toBe(true);
    expect(second.installationId !== before.installationId).toBe(true);
    expect((await serverState(identity.userId)).devices.length).toBe(2);
    await revoke(settings, before.deviceId!);
    const worker = context.serviceWorkers().find(worker => worker.url() === `${extensionOrigin}/background.js`)!;
    const rejected = await worker.evaluate(async ({ deviceId, token }) => {
      const resource = await fetch(`https://auth.cqu.moe/api/v1/cqu/quicklogin/devices/${deviceId}/reconcile`, {
        method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json', authorization: `Bearer ${token.accessToken}` }, body: JSON.stringify({ protocolVersion: 3 }),
      });
      const refresh = await fetch('https://auth.cqu.moe/api/v1/auth/oauth2/token', {
        method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'cqu-quicklogin-chrome', refresh_token: token.refreshToken, resource: 'https://auth.cqu.moe/api/auth' }),
      });
      const resourceBody = await resource.json().catch(() => ({ code: 'NON_JSON_RESPONSE' })) as { code?: string };
      const refreshBody = await refresh.json().catch(() => ({ code: 'NON_JSON_RESPONSE' })) as { error?: string; code?: string };
      return { resource: resource.status, refresh: refresh.status, resourceCode: resourceBody.code ?? 'unknown', refreshCode: refreshBody.error ?? refreshBody.code ?? 'unknown' };
    }, { deviceId: before.deviceId!, token: oldCredentials });
    await recordEvent('revoked-credential-readback', { ...rejected });
    expect(rejected.resource).toBe(403);
    expect(rejected.resourceCode).toBe('DEVICE_REVOKED');
    expect(rejected.refresh).toBe(400);
    expect(rejected.refreshCode).toBe('INVALID_GRANT');
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CHECK_STATE' }));
    await until(() => localState(popup), state => state.authorization === 'revoked');
    expect(await popup.evaluate(async () => !!(await chrome.storage.local.get('quicklogin.tokens'))['quicklogin.tokens'])).toBe(false);
    await popup.getByRole('heading', { name: '此设备已退出', exact: true }).waitFor();
    const successfulExchanges = (await networkEvents()).filter(event => event.path.endsWith('/oauth2/token') && event.status === 200).length;
    await expireLocalAccess(other);
    await other.evaluate(() => chrome.runtime.sendMessage({ type: 'CHECK_STATE' }));
    await until(() => other.evaluate(async () => {
      const token = (await chrome.storage.local.get('quicklogin.tokens'))['quicklogin.tokens'] as { expiresAt: number } | undefined;
      return !!token && token.expiresAt > Date.now() + 30_000;
    }), Boolean);
    expect((await networkEvents()).filter(event => event.path.endsWith('/oauth2/token') && event.status === 200).length > successfulExchanges).toBe(true);
    await until(() => localState(other), state => state.authorization === 'authorized' && state.observation === 'fresh' && state.networkFailures === 0);
    expect((await localState(other)).deviceId).toBe(second.deviceId);
    expect(await settings.evaluate(async () => (await fetch('/api/v1/cqu/quicklogin/overview')).status)).toBe(200);
    const server = await serverState(identity.userId);
    expect(server.devices.length).toBe(2);
    expect(server.devices.some(device => device.deviceId === second.deviceId && !device.revokedAt)).toBe(true);
    await recordEvent('real-device-revocation', { oldResourceStatus: rejected.resource, oldRefreshStatus: rejected.refresh, otherDeviceRefreshed: true, websiteSurvived: true });
  } catch (error) { await captureArtifacts('device-revoke-failure', [popup, settings]); throw error; }
  finally { if (lease) await extensionBrowser.release(lease, {} as Parameters<typeof extensionBrowser.release>[1]); }
});

test('QUICKLOGIN-03 lost token and actually expired Auth grants require explicit website reconnect without replacing device identity', { timeout: 240_000 }, async ({ app }) => {
  const { popup, settings, identity } = await connectDevice(app, 'reconnect-device', true);
  const before = await localState(popup);
  try {
    for (const fault of ['lost-token', 'expired-grant']) {
      if (fault === 'lost-token') await popup.evaluate(() => chrome.storage.local.remove('quicklogin.tokens'));
      else {
        const result = await control('/expire-refresh', { userId: identity.userId });
        expect(result.expired > 0).toBe(true);
        await expireLocalAccess(popup);
      }
      await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CHECK_STATE' }));
      await until(() => localState(popup), state => state.authorization === 'reconnect_required');
      await popup.getByRole('heading', { name: '需要重新连接 Auth', exact: true }).waitFor();
      const failed = await localState(popup);
      expect(failed.deviceId).toBe(before.deviceId);
      expect(failed.installationId).toBe(before.installationId);
      expect(failed.nextAttemptAt).toBe(null);
      expect((await serverState(identity.userId)).devices.length).toBe(1);
      await reconnect(settings, popup, before.deviceId!);
      expect((await localState(popup)).installationId).toBe(before.installationId);
      expect((await serverState(identity.userId)).devices.length).toBe(1);
      await recordEvent('explicit-device-reconnect', { fault, sameDevice: true, sameInstallation: true });
    }
    expect((await networkEvents()).some(event => event.path.endsWith('/oauth2/token') && event.status === 400)).toBe(true);
  } catch (error) { await captureArtifacts('device-reconnect-failure', [popup, settings]); throw error; }
});
