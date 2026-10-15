import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extensionOrigin } from './helpers.ts';

// CDP supplies scheduling/crash faults at actual browser execution boundaries.
// No Chrome API, Auth response, journal or successful state is manufactured.
export async function pauseWorkerAt(boundary: 'expiry' | 'cookie-written') {
  const endpoint = (globalThis as typeof globalThis & { __QUICKLOGIN_CDP_ENDPOINT__?: string }).__QUICKLOGIN_CDP_ENDPOINT__;
  if (!endpoint) throw new Error('Missing owned Chromium endpoint');
  const targets = await (await fetch(`${endpoint}/json/list`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const target = targets.find(value => value.type === 'service_worker' && value.url === `${extensionOrigin}/background.js`);
  if (!target) throw new Error('Actual extension worker target not found');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  let sequence = 0;
  let paused: any;
  socket.addEventListener('message', event => {
    const value = JSON.parse(String(event.data));
    if (value.id) {
      const request = pending.get(value.id); pending.delete(value.id);
      if (value.error) request?.reject(new Error(`CDP ${value.error.code}: ${value.error.message}`));
      else request?.resolve(value.result);
    } else if (value.method === 'Debugger.paused') paused = value.params;
  });
  await new Promise<void>((done, fail) => { socket.addEventListener('open', () => done(), { once: true }); socket.addEventListener('error', () => fail(new Error('Owned CDP connection failed')), { once: true }); });
  function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Owned CDP command timed out: ${method}`)); }, 10_000);
      pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); }, reject(error) { clearTimeout(timer); reject(error); } });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  await send('Debugger.enable');
  const source = await readFile(join(process.cwd(), 'dist/background.js'), 'utf8');
  const matches = [...source.matchAll(boundary === 'expiry'
    ? /if\([\w$]+\.applyBefore<=Date\.now\(\)\)throw new [\w$]+\(`STALE_SNAPSHOT`\)/g
    : /[\w$]+\.completed=!0,await [\w$]+\(/g)];
  if (matches.length !== 1) { socket.close(); throw new Error(`Cannot identify unique real ${boundary} scheduling boundary`); }
  const prefix = source.slice(0, matches[0]!.index);
  const location = { url: `${extensionOrigin}/background.js`, lineNumber: prefix.split('\n').length - 1, columnNumber: prefix.split('\n').at(-1)!.length };
  const breakpoint = await send('Debugger.setBreakpointByUrl', location);
  return {
    async wait() {
      const deadline = Date.now() + 120_000;
      while (!paused && Date.now() < deadline) await new Promise(done => setTimeout(done, 50));
      if (!paused?.hitBreakpoints?.includes(breakpoint.breakpointId)) throw new Error('Actual scheduling breakpoint was not reached');
    },
    async resume() { await send('Debugger.removeBreakpoint', { breakpointId: breakpoint.breakpointId }); if (paused) await send('Debugger.resume'); paused = undefined; },
    close() { socket.close(); },
  };
}

// Chromium's native lifecycle command terminates the actual worker, preserving
// storage/journal and the extension installation. No runtime listener is called.
export async function stopExtensionWorker(context: import('playwright-core').BrowserContext, page: import('playwright-core').Page) {
  const session = await context.newCDPSession(page);
  const versions = new Map<string, { versionId: string; scriptURL: string; runningStatus: string }>();
  session.on('ServiceWorker.workerVersionUpdated', event => { for (const version of event.versions) versions.set(version.versionId, version); });
  try {
    await session.send('ServiceWorker.enable');
    const deadline = Date.now() + 5000;
    while (![...versions.values()].some(version => version.scriptURL === `${extensionOrigin}/background.js`) && Date.now() < deadline) await new Promise(done => setTimeout(done, 50));
    const version = [...versions.values()].find(value => value.scriptURL === `${extensionOrigin}/background.js` && value.runningStatus === 'running');
    if (!version) throw new Error('Native extension worker version not discovered');
    await session.send('ServiceWorker.stopWorker', { versionId: version.versionId });
    if (versions.get(version.versionId)?.runningStatus !== 'stopped') {
      const stoppedBy = Date.now() + 5000;
      while (versions.get(version.versionId)?.runningStatus !== 'stopped' && Date.now() < stoppedBy) await new Promise(done => setTimeout(done, 50));
      if (versions.get(version.versionId)?.runningStatus !== 'stopped') throw new Error('Native extension worker did not stop');
    }
  } finally { await session.detach(); }
}
