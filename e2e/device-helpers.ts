import { expect } from 'e2e';
import type { BrowserContext, Page } from 'playwright-core';
import { account, beginConnection, completeLogin, connectExtensionBrowser, extensionOrigin, openPopup, recordEvent, requiredControl, waitForUiState } from './helpers.ts';
import { localState, until } from './school-helpers.ts';

export async function control(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${requiredControl()}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Lifecycle control failed (${path}, ${response.status})`);
  return response.status === 204 ? null : response.json();
}

export async function connectDevice(app: { open(path: string): Promise<unknown> }, key: string, policy = false) {
  await app.open('/');
  await control('/identity', { key, policy });
  const identity = await account(key);
  const { context } = await connectExtensionBrowser();
  const popup = await openPopup(context);
  await authorize(popup, context, key);
  const settings = await context.newPage();
  await settings.goto('https://auth.cqu.moe/settings');
  return { popup, context, settings, identity };
}

export async function authorize(popup: Page, context: BrowserContext, key: string) {
  const { authPage } = await beginConnection(popup, context, () => popup.getByRole('button', { name: '连接 Auth', exact: true }).click());
  await completeLogin(authPage, key);
  await waitForUiState(popup, value => value?.deviceId && value.local.authorization === 'authorized', 120_000);
  await until(() => localState(popup), value => !value.pendingCommand);
}

export async function expireLocalAccess(popup: Page) {
  // Fault on genuinely issued credentials, never fabricate an authorization.
  await popup.evaluate(async () => {
    const key = 'quicklogin.tokens';
    const tokens = (await chrome.storage.local.get(key))[key] as { expiresAt: number } | undefined;
    if (!tokens) throw new Error('No issued token to expire');
    await chrome.storage.local.set({ [key]: { ...tokens, expiresAt: Date.now() - 1 } });
  });
}

export async function reconnect(settings: Page, popup: Page, deviceId: string) {
  await settings.goto(`https://auth.cqu.moe/settings?quickloginDevice=${deviceId}&quickloginReconnect=1`);
  const connection = settings.getByRole('button', { name: '重新连接', exact: true });
  await connection.click();
  await until(() => localState(popup), value => value.authorization === 'authorized' && !value.connectIntentId && !value.pendingCommand, 120_000);
  expect((await localState(popup)).deviceId).toBe(deviceId);
}

export async function revoke(settings: Page, deviceId: string) {
  // The second CDP client must observe (not auto-dismiss) the native dialog;
  // tester-army's public browser.onDialog handler is its single owner.
  const observeDialog = () => {};
  settings.on('dialog', observeDialog);
  try {
    await settings.goto(`https://auth.cqu.moe/settings?quickloginDevice=${deviceId}`);
    const row = settings.getByRole('list', { name: '快捷登录设备' }).getByRole('listitem').filter({ hasText: '当前插件' });
    await row.getByRole('button', { name: /的更多操作$/ }).click();
    const deleted = settings.waitForResponse(response => response.request().method() === 'DELETE' && new URL(response.url()).pathname === `/api/v1/cqu/quicklogin/devices/${deviceId}`);
    await settings.getByRole('menuitem', { name: '退出设备', exact: true }).click();
    expect((await deleted).status()).toBe(204);
    // Pinned Auth overview intentionally omits revoked rows; the extension owns
    // the visible revoked state. Assert the actual website removal here.
    await row.waitFor({ state: 'hidden' });
  } finally { settings.off('dialog', observeDialog); }
}

// Keep the native extension origin/API without popup polling or product messages.
export async function quiet(popup: Page) { await popup.goto(`${extensionOrigin}/manifest.json`); }

export async function nativeAlarmRestart(context: BrowserContext, page: Page, interrupt: () => Promise<void>, fault = false) {
  const session = await context.newCDPSession(page);
  const versions = new Map<string, { versionId: string; scriptURL: string; runningStatus: string }>();
  let stopped = false, restarted = false, restartedAt = 0;
  session.on('ServiceWorker.workerVersionUpdated', event => {
    for (const version of event.versions) {
      versions.set(version.versionId, version);
      if (version.scriptURL !== `${extensionOrigin}/background.js`) continue;
      if (version.runningStatus === 'stopped') stopped = true;
      if (stopped && version.runningStatus === 'running') { restarted = true; restartedAt = Date.now(); }
    }
  });
  try {
    await session.send('ServiceWorker.enable');
    await until(async () => [...versions.values()].some(value => value.scriptURL === `${extensionOrigin}/background.js` && value.runningStatus === 'running'), Boolean, 5000);
    const scheduledAt = await page.evaluate(async () => {
      await chrome.alarms.clear('quicklogin-sync');
      const when = Date.now() + 30_000;
      await chrome.alarms.create('quicklogin-sync-retry', { when });
      return when;
    });
    await interrupt();
    expect(stopped).toBe(true);
    if (fault) {
      await page.evaluate(() => chrome.alarms.clearAll());
      await recordEvent('missing-alarm-control-armed', { actualWorkerStopped: stopped, nativeAlarmsRemoved: true });
    }
    await until(async () => restarted, Boolean, 50_000).catch(() => { throw new Error('Native alarm did not restart stopped MV3 worker'); });
    expect(restartedAt >= scheduledAt - 500).toBe(true);
    const periodic = await until(() => page.evaluate(() => chrome.alarms.get('quicklogin-sync')), alarm => alarm?.periodInMinutes === 5, 5000);
    expect(periodic?.periodInMinutes).toBe(5);
    return { stopped, restarted, delayMs: restartedAt - scheduledAt };
  } finally { await session.detach(); }
}
