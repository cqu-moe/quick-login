import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { loadDownloadState, mountDownloads } from './download';
const record = { version: '0.4.0', filename: 'cqu-quicklogin-0.4.0-canary.zip', size: 128000,
  sha256: 'a'.repeat(64), publishedAt: '2026-09-28T00:00:00Z', notes: ['测试版本'] };
let cleanup: (() => void) | undefined;
beforeEach(() => { document.body.innerHTML = '<div data-download><a data-download-link></a><p data-download-message></p><button data-download-retry hidden>重试</button></div><dl data-release hidden><dd data-release-version></dd><dd data-release-size></dd><dd data-release-sha256></dd></dl>'; });
afterEach(() => { cleanup?.(); cleanup = undefined; vi.unstubAllGlobals(); });
function respond(state: 'signedOut' | 'eligible' | 'ineligible') {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/release')
    ? Response.json({ data: record }) : state === 'signedOut' ? new Response('', { status: 401 })
      : Response.json({ data: { eligible: state === 'eligible' } })));
}
it.each([['signedOut', '请登录后下载'], ['eligible', '下载'], ['ineligible', '内测中，暂未开放']] as const)('renders %s without automatically downloading', async (state, label) => {
  respond(state); cleanup = mountDownloads(document);
  await vi.waitFor(() => expect(document.querySelector('[data-download-link]')?.textContent).toBe(label));
  const link = document.querySelector<HTMLAnchorElement>('[data-download-link]')!;
  if (state === 'eligible') expect(new URL(link.href).searchParams.get('version')).toBe('0.4.0');
  if (state === 'signedOut') expect(new URL(link.href).searchParams.get('redirect')).toBe('https://quicklogin.cqu.moe/download/');
  if (state === 'ineligible') expect(link.hasAttribute('href')).toBe(false);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/download'))).toBe(false);
});
it('does not confuse failed or malformed eligibility queries with ineligibility', async () => {
  for (const response of [new Response('', { status: 503 }), Response.json({ data: {} })]) {
    vi.stubGlobal('fetch', vi.fn(async () => response.clone()));
    await expect(loadDownloadState(new AbortController().signal)).rejects.toThrow();
  }
  cleanup = mountDownloads(document);
  await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('[data-download-retry]')!.hidden).toBe(false));
  expect(document.body.textContent).not.toContain('内测中，暂未开放');
});
it('refreshes on focus and ignores responses from an earlier query', async () => {
  let finish!: (value: Response) => void;
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/release')) return Response.json({ data: record });
    if (calls++ === 0) return new Promise<Response>(resolve => { finish = resolve; });
    return Response.json({ data: { eligible: false } });
  }));
  cleanup = mountDownloads(document);
  window.dispatchEvent(new Event('focus'));
  await vi.waitFor(() => expect(document.body.textContent).toContain('内测中，暂未开放'));
  finish(Response.json({ data: { eligible: true } }));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(document.querySelector('[data-download-link]')!.hasAttribute('href')).toBe(false);
});
