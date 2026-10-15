import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extensionOrigin, recordEvent } from './helpers.ts';

// CDP supplies scheduling/crash faults at actual browser execution boundaries.
// No Chrome API, Auth response, journal or successful state is manufactured.
export async function pauseWorkerAt(boundary: 'expiry' | 'cookie-written', cookieName?: string) {
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
    : /([\w$]+)\.completed=!0,await [\w$]+\(/g)];
  if (matches.length !== 1) { socket.close(); throw new Error(`Cannot identify unique real ${boundary} scheduling boundary`); }
  const prefix = source.slice(0, matches[0]!.index);
  const location = { url: `${extensionOrigin}/background.js`, lineNumber: prefix.split('\n').length - 1, columnNumber: prefix.split('\n').at(-1)!.length };
  const breakpoint = await send('Debugger.setBreakpointByUrl', { ...location,
    ...(cookieName && boundary === 'cookie-written' ? { condition: `${matches[0]![1]}.name === ${JSON.stringify(cookieName)}` } : {}) });
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
  const timeline: Array<Record<string, unknown>> = [];
  const startedAt = performance.now();
  const targets = new Set<string>();
  let selectedVersion = '', stopRequested = false, stoppedObserved = false;
  const observe = (event: string, value: Record<string, unknown> = {}) => timeline.push({ ms: performance.now() - startedAt, event, ...value });
  session.on('ServiceWorker.workerVersionUpdated', event => {
    for (const version of event.versions) versions.set(version.versionId, version);
    const own = event.versions.filter(version => version.scriptURL === `${extensionOrigin}/background.js`);
    // A public popup message can restart this version before the next poll.
    if (stopRequested && own.some(version => version.versionId === selectedVersion && version.runningStatus === 'stopped')) stoppedObserved = true;
    for (const version of own) if (version.targetId) targets.add(version.targetId);
    observe('ServiceWorker.workerVersionUpdated', { versions: own.map(({ versionId, registrationId, runningStatus, status, targetId, controlledClients }) => ({ versionId, registrationId, runningStatus, status, targetId, controlledClients })) });
  });
  for (const event of ['Target.targetCreated', 'Target.targetInfoChanged'] as const) session.on(event, ({ targetInfo }) => {
    if (targetInfo.type !== 'service_worker' || targetInfo.url !== `${extensionOrigin}/background.js`) return;
    targets.add(targetInfo.targetId);
    observe(event, { targetId: targetInfo.targetId, attached: targetInfo.attached });
  });
  session.on('Target.targetDestroyed', ({ targetId }) => { if (targets.has(targetId)) observe('Target.targetDestroyed', { targetId }); });
  session.on('Target.detachedFromTarget', ({ targetId }) => { if (targetId && targets.has(targetId)) observe('Target.detachedFromTarget', { targetId }); });
  try {
    await session.send('Target.setDiscoverTargets', { discover: true });
    await session.send('ServiceWorker.enable');
    const deadline = Date.now() + 5000;
    while (![...versions.values()].some(version => version.scriptURL === `${extensionOrigin}/background.js`) && Date.now() < deadline) await new Promise(done => setTimeout(done, 50));
    const version = [...versions.values()].find(value => value.scriptURL === `${extensionOrigin}/background.js` && value.runningStatus === 'running');
    if (!version) throw new Error('Native extension worker version not discovered');
    selectedVersion = version.versionId;
    stopRequested = true;
    observe('ServiceWorker.stopWorker.request', { versionId: version.versionId });
    await session.send('ServiceWorker.stopWorker', { versionId: version.versionId });
    observe('ServiceWorker.stopWorker.response', { versionId: version.versionId });
    if (!stoppedObserved) {
      const stoppedBy = Date.now() + 5000;
      while (!stoppedObserved && Date.now() < stoppedBy) await new Promise(done => setTimeout(done, 50));
      if (!stoppedObserved) throw new Error('Native extension worker did not stop');
    }
  } finally {
    observe('observation-finished', { selectedVersion, lastRunningStatus: versions.get(selectedVersion)?.runningStatus ?? 'missing' });
    await session.detach();
    await recordEvent('worker-stop-trace', { selectedVersion, stoppedObserved, timeline: JSON.stringify(timeline) });
  }
}
