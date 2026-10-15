import { openWebPage } from "./web-viewport.ts";
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { captureArtifacts, extensionOrigin, networkEvents, recordEvent } from './helpers.ts';
import { connectSchool, localState, overview, popupEnabled, protectedValues, relay, schoolUrl, until } from './school-helpers.ts';
import { nativeAlarmRestart, quiet, revoke } from './device-helpers.ts';
import { pauseWorkerAt, stopExtensionWorker } from './worker-debugger.ts';

test('QUICKLOGIN-03 real pending Cookie journal survives worker kill and alarm recovery preserves a manually replaced Cookie', { timeout: 300_000 }, async ({ app }) => {
  let debugger_: Awaited<ReturnType<typeof pauseWorkerAt>> | undefined;
  const { popup, context, settings } = await connectSchool(app, 'journal-alarm', async () => { debugger_ = await pauseWorkerAt('cookie-written', 'SOURCEID_TGC'); }, false);
  try {
    await debugger_!.wait();
    await protectedValues(['manual-during-worker-crash']);
    const interrupted = await popup.evaluate(async () => {
      const journal = (await chrome.storage.local.get('quicklogin.cookieJournal'))['quicklogin.cookieJournal'] as { entries: Array<{ name: string; domain: string; path: string; completed: boolean }> };
      if (!journal?.entries.length) throw new Error('No real interrupted journal');
      const entry = journal.entries.at(-1)!;
      const cookie = await chrome.cookies.get({ url: `https://sso.cqu.edu.cn${entry.path}`, name: entry.name });
      return { name: entry.name, domain: entry.domain, hostOnly: cookie?.hostOnly, path: entry.path, completed: entry.completed, written: !!cookie };
    });
    expect(interrupted.completed).toBe(false);
    expect(interrupted.written).toBe(true);
    expect(interrupted.name).toBe('SOURCEID_TGC');
    await recordEvent('journal-interruption-tuple', { name: interrupted.name, domain: interrupted.domain, path: interrupted.path, hostOnly: interrupted.hostOnly === true });
    expect((await localState(popup)).receipt).toBe(null);
    await popup.evaluate(async entry => {
      await chrome.cookies.set({ url: `https://sso.cqu.edu.cn${entry.path}`, name: entry.name, path: entry.path, ...(!entry.hostOnly ? { domain: entry.domain } : {}), value: 'manual-during-worker-crash', secure: true, httpOnly: true });
    }, interrupted);
    const receiptsBefore = (await networkEvents()).filter(event => event.path.endsWith('/receipts')).length;
    await quiet(popup);
    const native = await nativeAlarmRestart(context, popup, async () => {
      await stopExtensionWorker(context, popup);
      debugger_!.close(); debugger_ = undefined;
    });
    await until(() => popup.evaluate(async () => !(await chrome.storage.local.get('quicklogin.cookieJournal'))['quicklogin.cookieJournal']), Boolean);
    const preserved = await popup.evaluate(async entry => (await chrome.cookies.get({ url: `https://sso.cqu.edu.cn${entry.path}`, name: entry.name }))?.value === 'manual-during-worker-crash', interrupted);
    expect(preserved).toBe(true);
    expect((await localState(popup)).receipt).toBe(null);
    expect((await overview(settings)).devices[0].reportedLocal?.acknowledgedAt ?? null).toBe(null);
    expect((await networkEvents()).filter(event => event.path.endsWith('/receipts')).length).toBe(receiptsBefore);
    await popup.goto(`${extensionOrigin}/popup.html`);
    await popup.getByRole('button', { name: '切换到快捷登录', exact: true }).click();
    await until(() => localState(popup), state => !!state.receipt && !state.pendingAck && state.localWriteState === 'ready');
    const page = await openWebPage(context, schoolUrl('journal-alarm-recovery'));
    await page.getByRole('heading', { name: '已进入学校合成业务' }).waitFor();
    await recordEvent('journal-native-alarm', { ...native, realUncompletedEntry: true, manualCookiePreserved: preserved, noFalseReceipt: true, explicitFreshRecovery: true });
    await captureArtifacts('journal-alarm-recovered', [page, popup]);
  } finally { if (debugger_) { await debugger_.resume().catch(() => {}); debugger_.close(); } }
});

test('QUICKLOGIN-03 website revoke clears only truly managed Cookie values and preserves a manual replacement', { timeout: 240_000 }, async ({ app, browser }) => {
  await browser.onDialog('accept');
  const { popup, settings } = await connectSchool(app, 'revoke-owned-cookies');
  try {
    const before = await localState(popup);
    expect(before.managed.length >= 3).toBe(true);
    await protectedValues(['manual-before-revoke']);
    await popup.evaluate(() => chrome.cookies.set({ url: 'https://sso.cqu.edu.cn/login', name: 'SESSION', path: '/', secure: true, httpOnly: true, value: 'manual-before-revoke' }));
    const replaced = await popup.evaluate(async () => (await chrome.cookies.getAll({ domain: 'sso.cqu.edu.cn', name: 'SESSION' }))
      .map(cookie => ({ name: cookie.name, domain: cookie.domain, path: cookie.path, storeId: cookie.storeId, manual: cookie.value === 'manual-before-revoke' })));
    await recordEvent('manual-cookie-before-reconcile', { cookies: JSON.stringify(replaced) });
    expect(replaced.some(cookie => cookie.manual)).toBe(true);
    // An ordinary popup reconciliation can happen before the website request.
    // Observe that real path so preserving the replacement cannot depend on
    // winning the race against the next poll.
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CHECK_STATE' }));
    await until(() => localState(popup), state => state.receipt?.result === 'foreign' || state.localWriteState === 'foreign_session' ||
      (!!state.receipt && state.receipt.exportId !== before.receipt?.exportId && !state.pendingAck));
    const afterReconcile = await popup.evaluate(async () => (await chrome.cookies.getAll({ domain: 'sso.cqu.edu.cn', name: 'SESSION' }))
      .map(cookie => ({ name: cookie.name, domain: cookie.domain, path: cookie.path, storeId: cookie.storeId, manual: cookie.value === 'manual-before-revoke' })));
    await recordEvent('manual-cookie-after-reconcile', { cookies: JSON.stringify(afterReconcile) });
    expect(afterReconcile.some(cookie => cookie.manual)).toBe(true);
    expect((await localState(popup)).receipt?.result).toBe('foreign');
    expect((await localState(popup)).receipt?.verifiedAt).toBe(null);
    await revoke(settings, before.deviceId!);
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CHECK_STATE' }));
    await until(() => popup.evaluate(async () => {
      const stored = await chrome.storage.local.get(['quicklogin.state.v2', 'quicklogin.tokens']);
      const state = stored['quicklogin.state.v2'] as { authorization?: string } | undefined;
      return state?.authorization === 'revoked' && !stored['quicklogin.tokens'];
    }), Boolean);
    const values = await popup.evaluate(async managed => {
      const cookies = await chrome.cookies.getAll({ domain: 'sso.cqu.edu.cn' });
      return {
        manualPreserved: cookies.some(cookie => cookie.name === 'SESSION' && cookie.value === 'manual-before-revoke'),
        ownedRemoved: managed.filter(entry => entry.name !== 'SESSION').every(entry => !cookies.some(cookie => cookie.name === entry.name && cookie.domain === entry.domain && cookie.path === entry.path && cookie.storeId === entry.storeId)),
        tokenRemoved: !(await chrome.storage.local.get('quicklogin.tokens'))['quicklogin.tokens'],
      };
    }, before.managed);
    expect(values).toEqual({ manualPreserved: true, ownedRemoved: true, tokenRemoved: true });
    expect((await localState(popup)).receipt).toBe(null);
    expect((await overview(settings)).devices.length).toBe(0);
    await recordEvent('revoke-owned-cookie-readback', values);
    await captureArtifacts('revoked-owned-cookies', [popup]);
  } catch (error) { await captureArtifacts('revoke-owned-cookie-failure', [popup, settings]); throw error; }
});

test('QUICKLOGIN-03 real pending ACK resumes only after exact Cookie readback on a native alarm without downloading again', { timeout: 300_000 }, async ({ app }) => {
  const { popup, context, settings } = await connectSchool(app, 'pending-ack-alarm', async () => { await relay({ path: 'receipts', hold: true }); }, false);
  try {
    await until(() => localState(popup), state => !!state.receipt && state.pendingAck);
    await until(() => relay(), value => value.heldResponses > 0);
    const pending = await localState(popup);
    expect(pending.localWriteState).toBe('ready');
    const before = await networkEvents();
    await quiet(popup);
    const native = await nativeAlarmRestart(context, popup, async () => {
      await stopExtensionWorker(context, popup);
      if (process.env.QUICKLOGIN_E2E_BREAK_ACK === '1') {
        await relay({ path: 'reconcile', hold: true });
        await recordEvent('held-ack-control-armed', { genuineAckPending: true, realReconcileResponseHeld: true });
      } else await relay({ hold: false });
    });
    await until(() => localState(popup), state => !!state.receipt && !state.pendingAck, 20_000)
      .catch(() => { throw new Error('Pending ACK was not independently confirmed'); });
    const recovered = await localState(popup);
    expect(recovered.receipt!.exportId).toBe(pending.receipt!.exportId);
    expect(recovered.deviceId).toBe(pending.deviceId);
    expect(recovered.receipt!.verifiedAt !== null && recovered.receipt!.verifiedAt >= (pending.receipt!.verifiedAt ?? 0)).toBe(true);
    expect((await networkEvents()).filter(event => event.path.endsWith('/exports')).length).toBe(before.filter(event => event.path.endsWith('/exports')).length);
    const remote = (await overview(settings)).devices[0];
    expect(remote.reportedLocal.receipt.exportId).toBe(pending.receipt!.exportId);
    expect(typeof remote.reportedLocal.acknowledgedAt).toBe('number');
    const page = await openWebPage(context, schoolUrl('pending-ack-restart'));
    await page.getByRole('heading', { name: '已进入学校合成业务' }).waitFor();
    await recordEvent('pending-ack-native-alarm', { ...native, actualPendingAck: true, exportRetained: true, noDownloadReplay: true });
  } finally { await relay({ hold: false }); }
});

test('QUICKLOGIN-03 disable and actual authorization replacement fence held callbacks and device disconnect preserves manual Cookies', { timeout: 360_000 }, async ({ app, browser }) => {
  await browser.onDialog('accept');
  const { popup, settings } = await connectSchool(app, 'late-callbacks', async () => { await relay({ path: 'receipts', hold: true }); }, false);
  try {
    await until(() => relay(), value => value.heldResponses > 0);
    const pending = await until(() => localState(popup), state => !!state.receipt && state.pendingAck);
    expect(pending.pendingAck).toBe(true);
    await popup.getByRole('checkbox', { name: '开启 QuickLogin' }).press('Space');
    await until(() => localState(popup), state => !state.enabledIntent && state.localGeneration > pending.localGeneration);
    await protectedValues(['manual-after-disable']);
    await popup.evaluate(() => chrome.cookies.set({ url: 'https://sso.cqu.edu.cn/login', name: 'SOURCEID_TGC', path: '/', secure: true, httpOnly: true, value: 'manual-after-disable' }));
    await relay({ hold: false });
    await until(() => localState(popup), state => !state.pendingCommand);
    expect((await localState(popup)).receipt).toBe(null);
    expect((await overview(settings)).devices[0].authorization.deviceEnabled).toBe(false);
    expect(await popup.evaluate(async () => (await chrome.cookies.get({ url: 'https://sso.cqu.edu.cn/login', name: 'SOURCEID_TGC' }))?.value === 'manual-after-disable')).toBe(true);

    await popupEnabled(popup, true);
    await until(() => localState(popup), state => state.localWriteState === 'foreign_session');
    await relay({ path: 'reconcile', hold: true });
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CHECK_STATE' }));
    await until(() => relay(), value => value.heldResponses > 0);
    const old = await localState(popup);
    await settings.goto(`https://auth.cqu.moe/settings?quickloginDevice=${old.deviceId}&quickloginReconnect=1`);
    await settings.getByRole('button', { name: '重新连接', exact: true }).click();
    await until(() => localState(popup), state => state.authorization === 'authorized' && state.authGeneration > old.authGeneration && state.reportEpoch !== old.reportEpoch);
    await relay({ hold: false });
    await until(() => localState(popup), state => !state.pendingCommand && !state.connectIntentId);
    const replaced = await localState(popup);
    expect(replaced.deviceId).toBe(old.deviceId);
    expect(replaced.installationId).toBe(old.installationId);
    expect(replaced.receipt).toBe(null);
    expect(await popup.evaluate(async () => (await chrome.cookies.get({ url: 'https://sso.cqu.edu.cn/login', name: 'SOURCEID_TGC' }))?.value === 'manual-after-disable')).toBe(true);

    await relay({ path: 'reconcile', hold: true });
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CHECK_STATE' }));
    await until(() => relay(), value => value.heldResponses > 0);
    await revoke(settings, replaced.deviceId!);
    await relay({ hold: false });
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CHECK_STATE' }));
    await until(() => localState(popup), state => state.authorization === 'revoked');
    expect((await localState(popup)).receipt).toBe(null);
    expect(await popup.evaluate(async () => (await chrome.cookies.get({ url: 'https://sso.cqu.edu.cn/login', name: 'SOURCEID_TGC' }))?.value === 'manual-after-disable')).toBe(true);
    expect(await popup.evaluate(async () => !!(await chrome.storage.local.get('quicklogin.tokens'))['quicklogin.tokens'])).toBe(false);
    await recordEvent('late-callback-fences', { disabledAckIgnored: true, replacementSameDevice: true, disconnectedOldGeneration: true, manualCookiePreserved: true });
  } catch (error) { await captureArtifacts('late-callback-failure', [popup, settings]); throw error; }
  finally { await relay({ hold: false }); }
});
