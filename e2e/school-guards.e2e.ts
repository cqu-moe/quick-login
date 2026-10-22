import { openWebPage } from "./web-viewport.ts";
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { captureArtifacts, extensionOrigin, networkEvents, recordEvent } from './helpers.ts';
import { connectSchool, controlSchool, localState, popupEnabled, beginHeldRecovery, relay, until, overview, protectedValues, openSchoolForm, schoolUrl } from './school-helpers.ts';
import { pauseWorkerAt, stopExtensionWorker } from './worker-debugger.ts';

test('QUICKLOGIN-02 foreign cookies and ambiguous domain/path ownership survive sync and disable', { timeout: 240_000 }, async ({ app }) => {
  const { popup } = await connectSchool(app, 'school-foreign');
  await protectedValues(['foreign-school-session', 'foreign-domain-session', 'foreign-path-session']);
  await popup.evaluate(async () => {
    await chrome.cookies.set({ url: 'https://sso.cqu.edu.cn/login', name: 'SOURCEID_TGC', value: 'foreign-school-session', path: '/', secure: true, httpOnly: true });
    await chrome.cookies.set({ url: 'https://sso.cqu.edu.cn/login', domain: '.sso.cqu.edu.cn', name: 'SOURCEID_TGC', value: 'foreign-domain-session', path: '/', secure: true });
    await chrome.cookies.set({ url: 'https://sso.cqu.edu.cn/authserver/login', name: 'SOURCEID_TGC', value: 'foreign-path-session', path: '/authserver', secure: true });
    await chrome.runtime.sendMessage({ type: 'RETRY_LOCAL' });
  });
  await until(() => localState(popup), state => state.localWriteState === 'foreign_session');
  expect((await localState(popup)).receipt).toBe(null);
  await popupEnabled(popup, false);
  const preserved = await popup.evaluate(async () => {
    const all = await chrome.cookies.getAll({ domain: 'sso.cqu.edu.cn', name: 'SOURCEID_TGC' });
    return ['foreign-school-session', 'foreign-domain-session', 'foreign-path-session'].every(value => all.some(cookie => cookie.value === value));
  });
  expect(preserved).toBe(true);
});

test('QUICKLOGIN-02 actual manual typing fences a late real school login and exposes recovery actions', { timeout: 240_000 }, async ({ app }) => {
  const { popup, context } = await connectSchool(app, 'school-manual');
  const page = await beginHeldRecovery(popup, context, 'manual');
  let navigations = 0; page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  try {
    await page.getByLabel('学校账号').fill('manual-synthetic-user');
    await until(() => localState(popup), state => state.manualOverride && !state.receipt);
    await controlSchool({ holdLogin: false });
    await until(() => controlSchool(), value => value.events.some(event => event.kind === 'login_replied'));
    await page.waitForTimeout(1500);
    expect(navigations).toBe(0);
    expect((await localState(popup)).receipt).toBe(null);
    await page.getByRole('button', { name: '恢复快捷登录', exact: true }).waitFor();
    await page.getByText('已切换为手动登录，可直接在下方输入。', { exact: true }).waitFor();
    await captureArtifacts('manual-late-login-fenced', [page, popup]);
  } finally { await controlSchool({ holdLogin: false }); }
});

test('QUICKLOGIN-02 disabling sync while a real export response is delayed cancels its cookie write and receipt', { timeout: 240_000 }, async ({ app }) => {
  const { popup, settings } = await connectSchool(app, 'school-late-export');
  await relay({ path: 'exports', hold: true });
  try {
    await popup.evaluate(async () => { await chrome.cookies.remove({ url: 'https://sso.cqu.edu.cn/', name: 'SOURCEID_TGC' }); await chrome.runtime.sendMessage({ type: 'RETRY_LOCAL' }); });
    await until(() => relay(), value => value.heldResponses > 0);
    // The genuine popup action commits its local intent before the older sync
    // request finishes; the server command is intentionally queued behind it.
    await popup.bringToFront(); await popup.getByRole('checkbox', { name: '此浏览器快捷登录' }).press('Space');
    await until(() => localState(popup), state => !state.enabledIntent);
  } finally { await relay({ hold: false }); }
  await until(() => localState(popup), state => !state.enabledIntent && !state.pendingCommand);
  const state = await localState(popup);
  expect(state.receipt).toBe(null);
  expect(await popup.evaluate(async () => !(await chrome.cookies.get({ url: 'https://sso.cqu.edu.cn/', name: 'SOURCEID_TGC' })))).toBe(true);
  const remote = await overview(settings);
  expect(remote.devices[0].authorization.deviceEnabled).toBe(false);
});

test('QUICKLOGIN-02 two waiting school documents each navigate once after a new acknowledged write', { timeout: 240_000 }, async ({ app }) => {
  const { popup, context } = await connectSchool(app, 'school-tabs');
  await protectedValues(['local-rotation-before-recovery']);
  await popup.evaluate(async () => {
    await chrome.cookies.set({ url: 'https://sso.cqu.edu.cn/', name: 'SESSION', path: '/',
      value: 'local-rotation-before-recovery', secure: true, httpOnly: true, sameSite: 'lax' });
    await chrome.runtime.sendMessage({ type: 'CHECK_STATE' });
  });
  await until(() => localState(popup), state => state.receipt?.result === 'foreign');
  expect((await localState(popup)).receipt?.verifiedAt).toBe(null);
  expect(await popup.evaluate(async () => (await chrome.cookies.get({ url: 'https://sso.cqu.edu.cn/', name: 'SESSION' }))?.value === 'local-rotation-before-recovery')).toBe(true);
  const first = await beginHeldRecovery(popup, context, 'tab-first');
  const second = await openSchoolForm(context, 'tab-second');
  const secondDebugger = await context.newCDPSession(second);
  let firstLoads = 0, secondLoads = 0;
  first.on('framenavigated', frame => { if (frame === first.mainFrame()) firstLoads++; });
  second.on('framenavigated', frame => { if (frame === second.mainFrame()) secondLoads++; });
  try {
    await until(() => localState(popup), state => state.loginRecovery?.pages.length === 2);
    expect(firstLoads + secondLoads).toBe(0);
    await first.bringToFront();
    await secondDebugger.send('Debugger.enable');
    await secondDebugger.send('Debugger.pause');
    await controlSchool({ holdLogin: false });
    for (const [index, page] of [first, second].entries()) {
      await page.bringToFront();
      await page.getByRole('heading', { name: '已进入学校合成业务' }).waitFor({ timeout: 120_000 });
      await recordEvent('waiting-page-arrived', { index, firstLoads, secondLoads });
      if (index === 0) {
        expect(firstLoads).toBe(1); expect(secondLoads).toBe(0);
        // Exercise a real school Set-Cookie renewal and ordinary polling before
        // the original background document is allowed to consume the same ACK.
        await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CHECK_STATE' }));
        await until(() => localState(popup), state => state.receipt?.result === 'foreign' && state.receipt.verifiedAt === null);
        await secondDebugger.send('Debugger.resume');
      }
    }
    await first.bringToFront(); await first.waitForTimeout(1200);
    expect(firstLoads).toBe(1); expect(secondLoads).toBe(1);
    expect((await localState(popup)).pendingAck).toBe(false);
  } finally {
    await secondDebugger.send('Debugger.disable');
    await secondDebugger.detach();
    await controlSchool({ holdLogin: false });
  }
});

test('QUICKLOGIN-02 replacing a waiting school document prevents its late navigation', { timeout: 240_000 }, async ({ app }) => {
  const { popup, context } = await connectSchool(app, 'school-document');
  const page = await beginHeldRecovery(popup, context, 'old-document');
  try {
    await page.goto('https://sso.cqu.edu.cn/quicklogin-document');
    await page.getByRole('heading', { name: '新的学校文档' }).waitFor();
    const before = await localState(popup);
    let navigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    await controlSchool({ holdLogin: false });
    await until(() => localState(popup), state => !!state.receipt && state.receipt.exportId !== before.receipt?.exportId && !state.pendingAck);
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).pathname).toBe('/quicklogin-document');
    expect(navigations).toBe(0);
  } finally { await controlSchool({ holdLogin: false }); }
});

test('QUICKLOGIN-02 an expired genuine export cannot write cookies or send a success receipt', { timeout: 240_000 }, async ({ app }) => {
  const { popup, settings } = await connectSchool(app, 'school-expiry');
  const receiptRequests = (await networkEvents()).filter(event => event.method === 'POST' && event.path.endsWith('/receipts')).length;
  const debugger_ = await pauseWorkerAt('expiry');
  try {
    await popup.evaluate(async () => { await chrome.cookies.remove({ url: 'https://sso.cqu.edu.cn/', name: 'SOURCEID_TGC' }); await chrome.runtime.sendMessage({ type: 'RETRY_LOCAL' }); });
    await debugger_.wait();
    await new Promise(done => setTimeout(done, 31_500));
    await debugger_.resume();
    await until(() => localState(popup), state => state.localError === 'STALE_SNAPSHOT');
    expect(await popup.evaluate(async () => !(await chrome.cookies.get({ url: 'https://sso.cqu.edu.cn/', name: 'SOURCEID_TGC' })))).toBe(true);
    const after = await overview(settings);
    expect(after.devices[0].reportedLocal.receipt).toBe(null);
    expect((await localState(popup)).receipt).toBe(null);
    expect((await networkEvents()).filter(event => event.method === 'POST' && event.path.endsWith('/receipts')).length).toBe(receiptRequests);
  } finally { await debugger_.resume().catch(() => {}); debugger_.close(); }
});

test('QUICKLOGIN-02 a school that still rejects the fresh write stops after one navigation with manual and retry actions', { timeout: 240_000 }, async ({ app }) => {
  const { popup, context } = await connectSchool(app, 'school-repeat-form');
  await controlSchool({ forceForm: true, expire: true, clearEvents: true });
  const page = await openSchoolForm(context, 'always-form');
  let navigations = 0; page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  try {
    await until(() => localState(popup), state => state.loginRecovery?.failed === true);
    await page.getByRole('button', { name: '重试快捷登录', exact: true }).waitFor();
    await page.getByRole('button', { name: '手动登录', exact: true }).waitFor();
    await page.waitForTimeout(5500);
    expect(navigations).toBe(1);
    expect((await localState(popup)).schoolAccess).toBe('login_form_seen');
    await captureArtifacts('school-repeated-form-stopped', [page, popup]);
  } finally { await controlSchool({ forceForm: false, holdLogin: false }); }
});

test('QUICKLOGIN-02 an actually issued receipt from an older device generation is rejected without replacing current authority', { timeout: 240_000 }, async ({ app }) => {
  const { popup, settings } = await connectSchool(app, 'school-stale-receipt');
  const old = await localState(popup);
  await popupEnabled(popup, false);
  const result = await popup.evaluate(async receipt => {
    const values = await chrome.storage.local.get(['quicklogin.state.v2', 'quicklogin.tokens']);
    const state = values['quicklogin.state.v2'] as { deviceId: string; reportEpoch: string; clientReportSeq: number };
    const token = values['quicklogin.tokens'] as { accessToken: string };
    const response = await fetch(`https://auth.cqu.moe/api/v1/cqu/quicklogin/devices/${state.deviceId}/receipts`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token.accessToken}` },
      body: JSON.stringify({ protocolVersion: 3, requestId: crypto.randomUUID(), reportEpoch: state.reportEpoch, clientReportSeq: state.clientReportSeq + 1, receipt }),
    });
    const body = await response.json();
    return { status: response.status, accepted: body.data?.accepted, reason: body.data?.reasonCode, tuple: body.data?.acceptedTuple };
  }, old.receipt);
  expect(result).toEqual({ status: 200, accepted: false, reason: 'STALE_SNAPSHOT', tuple: null });
  const current = await overview(settings);
  expect(current.devices[0].versions.generation > old.receipt!.generation).toBe(true);
  expect(current.devices[0].authorization.deviceEnabled).toBe(false);
  expect((await localState(popup)).receipt).toBe(null);
});

test('QUICKLOGIN-02 worker termination after the real Cookie API writes but before journal completion rolls back and recovers', { timeout: 300_000 }, async ({ app }) => {
  let debugger_: Awaited<ReturnType<typeof pauseWorkerAt>> | undefined;
  let lifecycle: import('playwright-core').CDPSession | undefined;
  let restartAfterStop = false;
  let wake: Promise<unknown> | undefined;
  let previousTimeOrigin = 0;
  const { popup, context, settings } = await connectSchool(app, 'school-interrupted-write', async (popup, context) => {
    previousTimeOrigin = await context.serviceWorkers().find(worker => worker.url() === `${extensionOrigin}/background.js`)!.evaluate(() => performance.timeOrigin);
    debugger_ = await pauseWorkerAt('cookie-written');
    lifecycle = await context.newCDPSession(popup);
    lifecycle.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
      // Exercise the real popup-message race immediately after a native stop.
      if (restartAfterStop && !wake && versions.some(version => version.scriptURL === `${extensionOrigin}/background.js` && version.runningStatus === 'stopped')) {
        wake = popup.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_UI_STATE' }));
      }
    });
    await lifecycle.send('ServiceWorker.enable');
  }, false);
  try {
    await debugger_!.wait();
    const written = await popup.evaluate(async () => {
      const journal = (await chrome.storage.local.get('quicklogin.cookieJournal'))['quicklogin.cookieJournal'] as { entries: Array<{ name: string; path: string; completed: boolean }> };
      const entry = journal.entries.at(-1)!;
      return { name: entry.name, path: entry.path, completed: entry.completed, cookieExists: !!(await chrome.cookies.get({ url: `https://sso.cqu.edu.cn${entry.path}`, name: entry.name })) };
    });
    expect(written.completed).toBe(false); expect(written.cookieExists).toBe(true);
    await relay({ path: 'exports', hold: true });
    restartAfterStop = true;
    await stopExtensionWorker(context, popup);
    debugger_!.close(); debugger_ = undefined;
    expect(Boolean(wake)).toBe(true);
    await wake;
    const next = popup;
    await next.evaluate(() => chrome.runtime.sendMessage({ type: 'CHECK_STATE' }));
    const freshTimeOrigin = await context.serviceWorkers().find(worker => worker.url() === `${extensionOrigin}/background.js`)!.evaluate(() => performance.timeOrigin);
    expect(freshTimeOrigin > previousTimeOrigin).toBe(true);
    await until(() => next.evaluate(async () => !(await chrome.storage.local.get('quicklogin.cookieJournal'))['quicklogin.cookieJournal']), Boolean);
    expect(await next.evaluate(async ({ name, path }) => !(await chrome.cookies.get({ url: `https://sso.cqu.edu.cn${path}`, name })), written)).toBe(true);
    expect((await localState(next)).receipt).toBe(null);
    const server = await overview(settings);
    expect(server.devices[0].reportedLocal?.acknowledgedAt ?? null).toBe(null);
    await relay({ hold: false });
    await until(() => localState(next), state => state.localWriteState === 'ready' && !!state.receipt && !state.pendingAck);
    const allowed = await openWebPage(context, schoolUrl('after-interruption'));
    await allowed.getByRole('heading', { name: '已进入学校合成业务' }).waitFor();
    await recordEvent('worker-stop-journal-recovered', { previousTimeOrigin, freshTimeOrigin, publicPopupWake: true, realIncompleteJournal: true, rolledBackCookie: true, noFalseReceipt: true, businessRecovered: true });
    await captureArtifacts('interrupted-write-recovered', [allowed, next]);
  } finally { await relay({ hold: false }); if (debugger_) { await debugger_.resume().catch(() => {}); debugger_.close(); } await lifecycle?.detach(); }
});
