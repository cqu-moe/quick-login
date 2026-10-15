import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { sameTuple } from '../src/shared/protocol-v3.generated.ts';
import { isDeepStrictEqual } from 'node:util';
import { captureArtifacts, networkEvents } from './helpers.ts';
import { connectSchool, controlSchool, localState, openSchoolForm, receiptProjection, relay, until } from './school-helpers.ts';

test('QUICKLOGIN-02 real binding/container cookies reach a school business page and server receipt', { timeout: 240_000, tags: ['school-cookie-ack'] }, async ({ app }) => {
  const { popup, context, settings, identity, cookies } = await connectSchool(app, 'school-success');
  const initial = await localState(popup);
  await popup.getByRole('heading', { name: '已就绪', exact: true }).waitFor();
  expect(cookies.some(cookie => ['outside_domain', 'expired_probe'].includes(cookie.name))).toBe(false);
  expect(cookies.some(cookie => cookie.name === 'SOURCEID_TGC' && cookie.hostOnly && cookie.httpOnly && cookie.secure && cookie.session && cookie.path === '/')).toBe(true);
  expect(cookies.some(cookie => cookie.name === 'path_cookie' && cookie.path === '/quicklogin-business' && !cookie.session && cookie.sameSite === 'strict' && cookie.expirationDate! > Date.now() / 1000)).toBe(true);
  expect(cookies.some(cookie => cookie.name === 'domain_cookie' && cookie.domain === '.sso.cqu.edu.cn' && !cookie.hostOnly && !cookie.session)).toBe(true);
  await controlSchool({ expire: true, holdLogin: true, clearEvents: true });
  const page = await openSchoolForm(context, 'fresh-ack');
  let loads = 1;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) loads++; });
  await until(() => localState(popup), state => state.schoolAccess === 'login_form_seen' && !!state.loginRecovery);
  await until(async () => ({ ...(await controlSchool()), failed: (await localState(popup)).loginRecovery?.failed }), value => {
    if (value.failed) throw new Error('Recovery navigated an old session before a fresh school login completed');
    return value.events.some(event => event.kind === 'code_accepted');
  });
  await page.getByRole('status').waitFor();
  expect((await page.getByRole('status').innerText()).includes('已就绪')).toBe(false);
  expect(await popup.getByRole('heading', { name: '已就绪', exact: true }).count()).toBe(0);
  expect(loads).toBe(1);
  const waiting = await localState(popup);
  expect(sameTuple(waiting.loginRecovery!.rejectedTuple, initial.receipt)).toBe(true);
  expect(waiting.loginRecovery!.appliedExportId).toBe(null);
  expect(waiting.loginRecovery!.acknowledgedExportId ?? null).toBe(null);
  expect(waiting.pendingAck).toBe(false);
  expect(waiting.receipt === null || waiting.receipt.exportId === initial.receipt!.exportId).toBe(true);
  await relay({ path: 'receipts', hold: true });
  await controlSchool({ holdLogin: false });
  await until(() => relay(), value => value.heldResponses > 0);
  const written = await localState(popup);
  expect(written.pendingAck).toBe(true);
  expect(sameTuple(written.receipt, initial.receipt)).toBe(false);
  expect(written.receipt?.result).toBe('applied');
  expect(written.loginRecovery!.appliedExportId).toBe(written.receipt!.exportId);
  expect(written.loginRecovery!.acknowledgedExportId ?? null).toBe(null);
  await popup.getByRole('heading', { name: '浏览器已同步，正在确认', exact: true }).waitFor({ timeout: 10_000 });
  await page.getByRole('status').getByText('浏览器已同步，正在确认', { exact: false }).waitFor({ timeout: 10_000 });
  expect(loads).toBe(1);
  const beforeNavigationCookies = await popup.evaluate(() => chrome.cookies.getAll({ domain: 'sso.cqu.edu.cn' }));
  await relay({ hold: false });
  await page.getByRole('heading', { name: '已进入学校合成业务', exact: true }).waitFor({ timeout: 120_000 });
  const current = await until(() => localState(popup), state => !!state.receipt && !state.pendingAck && state.receipt.exportId !== initial.receipt!.exportId);
  const server = await receiptProjection(identity.userId);
  expect(server.devices.length).toBe(1);
  expect(server.devices[0]?.deviceId).toBe(current.deviceId);
  expect(current.localWriteState).toBe('ready');
  const overview = await settings.evaluate(async () => (await (await fetch('/api/v1/cqu/quicklogin/overview')).json()).data);
  expect(overview.devices[0].reportedLocal.receipt.exportId === current.receipt!.exportId).toBe(true);
  expect(overview.devices[0].reportedLocal.acknowledgedAt > 0).toBe(true);
  await popup.getByRole('heading', { name: '已就绪', exact: true }).waitFor();
  expect(loads).toBe(2);
  await captureArtifacts('school-business-and-ack', [page, popup]);
  // The school response renews auxiliary cookies. Their ownership digests must
  // remain unchanged: normal reconciliation conservatively reports a foreign
  // local session, rather than silently claiming deletion/overwrite authority.
  const schoolCookies = await popup.evaluate(() => chrome.cookies.getAll({ domain: 'sso.cqu.edu.cn' }));
  for (const name of ['path_cookie', 'domain_cookie']) {
    const before = beforeNavigationCookies.find(cookie => cookie.name === name)!;
    const after = schoolCookies.find(cookie => cookie.name === name)!;
    expect(after.expirationDate! > before.expirationDate!).toBe(true);
    expect(isDeepStrictEqual({ ...after, expirationDate: undefined }, { ...before, expirationDate: undefined })).toBe(true);
  }
  expect(isDeepStrictEqual(schoolCookies.find(cookie => cookie.name === 'SOURCEID_TGC'),
    beforeNavigationCookies.find(cookie => cookie.name === 'SOURCEID_TGC'))).toBe(true);
  const operationsBefore = await networkEvents();
  const lastCheck = (await localState(popup)).lastConfirmedAt ?? 0;
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CHECK_STATE' }));
  await until(() => localState(popup), state => (state.lastConfirmedAt ?? 0) > lastCheck);
  // CHECK_STATE acknowledges immediately. The next real reconciliation can
  // start only after the previous sync finishes; hold its response so final
  // readbacks cannot race a continuation. Runtime teardown releases the gate.
  await relay({ path: 'reconcile', hold: true, once: true });
  await until(async () => {
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CHECK_STATE' }));
    return relay();
  }, state => state.heldResponses === 1);
  const operationsAfter = await networkEvents();
  for (const operation of ['/exports', '/receipts']) {
    expect(operationsAfter.filter(event => event.path.endsWith(operation)).length)
      .toBe(operationsBefore.filter(event => event.path.endsWith(operation)).length);
  }
  const checked = await localState(popup);
  expect(checked.localWriteState).toBe('idle');
  expect(checked.receipt?.result).toBe('foreign');
  expect(checked.receipt?.exportId).toBe(current.receipt!.exportId);
  expect(checked.pendingAck).toBe(false);
  expect(isDeepStrictEqual(checked.managed, current.managed)).toBe(true);
  const checkedCookies = await popup.evaluate(() => chrome.cookies.getAll({ domain: 'sso.cqu.edu.cn' }));
  expect(checkedCookies.length === schoolCookies.length && schoolCookies.every(cookie =>
    checkedCookies.some(checkedCookie => isDeepStrictEqual(cookie, checkedCookie)))).toBe(true);
  await popup.getByRole('heading', { name: '已有学校登录', exact: true }).waitFor();
  expect(loads).toBe(2);
  await captureArtifacts('school-renewed-cookie-ownership', [page, popup]);
});
