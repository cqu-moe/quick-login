import { expect } from 'e2e';
import type { LocalState } from '../src/shared/contracts';
import type { BrowserContext, Page } from 'playwright-core';
import { beginConnection, completeLogin, connectExtensionBrowser, openPopup, requiredControl, waitForUiState } from './helpers.ts';

export async function controlSchool(changes?: Record<string, unknown>) {
  const response = await fetch(`${requiredControl()}/school`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ changes }), signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`External school control failed (${response.status})`);
  return response.json() as Promise<{ events: Array<{ kind: string }>; profiles: number; chromeProcesses: number }>;
}
export async function until<T>(read: () => Promise<T>, match: (value: T) => boolean, timeout = 120_000): Promise<T> {
  const deadline = Date.now() + timeout;
  do { const value = await read(); if (match(value)) return value; await new Promise(done => setTimeout(done, 150)); } while (Date.now() < deadline);
  throw new Error('Required real school/extension condition did not arrive');
}
export function localState(popup: Page): Promise<LocalState> {
  return popup.evaluate(async () => (await chrome.storage.local.get('quicklogin.state.v2'))['quicklogin.state.v2'] as LocalState);
}
export async function protectedValues(values: string[]) {
  const response = await fetch(`${requiredControl()}/protect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values }) });
  expect(response.status).toBe(204);
}
export async function connectSchool(app: { open(path: string): Promise<unknown> }, key: string, beforeEnable?: (popup: Page, context: BrowserContext) => Promise<void>, waitReady = true) {
  await app.open('/');
  const response = await fetch(`${requiredControl()}/identity`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, school: true }), signal: AbortSignal.timeout(180_000) });
  if (!response.ok) { const detail = await response.json() as { error?: string }; throw new Error(`Real school prerequisite failed (${response.status}, ${detail.error ?? "unknown"})`); }
  const identity = await response.json() as { email: string; password: string; userId: string };
  await controlSchool({ cookieVariant: 'attributes' });
  const { context } = await connectExtensionBrowser();
  const popup = await openPopup(context);
  const { authPage } = await beginConnection(popup, context, () => popup.getByRole('button', { name: '连接 Auth', exact: true }).click());
  await completeLogin(authPage, key);
  await waitForUiState(popup, state => state?.deviceId && state.local?.authorization === 'authorized', 120_000);
  await until(() => localState(popup), state => !state.connectIntentId && !state.pendingCommand);
  const settings = await context.newPage();
  await settings.goto('https://auth.cqu.moe/settings');
  const result = await settings.evaluate(async () => {
    const response = await fetch('/api/v1/cqu/quicklogin', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
    return { status: response.status, masterEnabled: (await response.json()).data?.masterEnabled };
  });
  expect(result).toEqual({ status: 200, masterEnabled: true });
  await popup.bringToFront();
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CHECK_STATE' }));
  await popupEnabled(popup, false);
  if (beforeEnable) await beforeEnable(popup, context);
  await popupEnabled(popup, true);
  if (waitReady) await until(() => localState(popup), state => state.localWriteState === 'ready' && !!state.receipt && !state.pendingAck, 180_000);
  const cookies = await popup.evaluate(() => chrome.cookies.getAll({ domain: 'sso.cqu.edu.cn' }));
  await protectedValues(cookies.map(cookie => cookie.value).filter(Boolean));
  return { popup, context, settings, identity, cookies };
}
export function schoolUrl(caseId = 'business') {
  return `https://sso.cqu.edu.cn/login?service=${encodeURIComponent('https://sso.cqu.edu.cn/quicklogin-business')}&case=${caseId}`;
}
export async function openSchoolForm(context: BrowserContext, caseId: string) {
  const page = await context.newPage();
  await page.goto(schoolUrl(caseId));
  await page.getByLabel('学校账号').waitFor({ state: 'visible' });
  return page;
}
export async function receiptProjection(userId: string) {
  const response = await fetch(`${requiredControl()}/state?userId=${encodeURIComponent(userId)}`);
  if (!response.ok) throw new Error('Device projection readback failed');
  return response.json() as Promise<{ devices: Array<Record<string, any>> }>;
}

export async function relay(input: { hold?: boolean; path?: 'exports' | 'receipts' | 'reconcile' | 'token'; once?: boolean } = {}) {
  const response = await fetch(`${requiredControl()}/relay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error('Real-response transport gate failed');
  return response.json() as Promise<{ heldResponses: number }>;
}
export async function popupEnabled(popup: Page, enabled: boolean) {
  await popup.bringToFront();
  const toggle = popup.getByRole('checkbox', { name: '开启 QuickLogin' });
  await until(() => toggle.getAttribute('aria-disabled'), value => value === 'false');
  if ((await localState(popup)).enabledIntent !== enabled) await toggle.press('Space');
  await until(() => localState(popup), value => value.enabledIntent === enabled && !value.pendingCommand);
}
export async function beginHeldRecovery(popup: Page, context: BrowserContext, key: string) {
  await controlSchool({ expire: true, holdLogin: true, clearEvents: true });
  const page = await openSchoolForm(context, key);
  await until(async () => ({ ...(await controlSchool()), state: await localState(popup) }), value => {
    if (value.state.loginRecovery?.failed) throw new Error('Old school session navigated before actual fresh login');
    return value.events.some(event => event.kind === 'code_accepted');
  });
  return page;
}
export async function overview(settings: Page) {
  return settings.evaluate(async () => {
    const response = await fetch('/api/v1/cqu/quicklogin/overview');
    if (!response.ok) throw new Error('Independent website overview readback failed');
    return (await response.json()).data;
  });
}
