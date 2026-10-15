import { strict as assert } from 'node:assert';
import { createServer, connect } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createEgressProxy } from './network.mjs';
import { listenLoopback, closeServer } from './lifecycle.mjs';

const output = resolve(process.argv[2] ?? '.e2e/network-reset-control');
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
const observations = [];
const sockets = new Set();
let upstreamConnections = 0;
const upstream = createServer(socket => {
  upstreamConnections++;
  sockets.add(socket);
  socket.on('error', () => socket.destroy());
  socket.on('close', () => sockets.delete(socket));
  socket.on('data', data => socket.write(data));
});
let proxy;
const timeout = setTimeout(() => {
  console.error('CONNECT socket control timed out');
  process.exit(1);
}, 10_000);

async function tunnel(target, reset = false, payload = '') {
  return new Promise((done, fail) => {
    const socket = connect(proxy.port, '127.0.0.1');
    let response = '';
    let acted = false;
    socket.once('error', fail);
    socket.once('connect', () => socket.write(
      `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n${payload}`));
    socket.on('data', data => {
      response += data.toString();
      if (acted || !response.includes('\r\n\r\n') || (payload && !response.endsWith(payload))) return;
      acted = true;
      const status = response.split('\r\n')[0];
      const observation = { target, status, reset, payloadEchoed: payload ? response.endsWith(payload) : null };
      observations.push(observation);
      console.log(JSON.stringify(observation));
      if (reset) socket.resetAndDestroy();
      else socket.end();
    });
    socket.once('close', () => {
      if (!acted) fail(new Error('CONNECT closed before its response/payload'));
      else done(response);
    });
  });
}

try {
  const port = await listenLoopback(upstream);
  proxy = await createEgressProxy({ tlsPort: port });
  assert.match(await tunnel('denied.example.invalid:443', true), /^HTTP\/1.1 403 Forbidden\r\n/);
  // Allow the peer's real TCP RST to reach the server before proving it still serves.
  await new Promise(done => setTimeout(done, 100));
  assert.match(await tunnel('denied.example.invalid:443'), /^HTTP\/1.1 403 Forbidden\r\n/);
  assert.equal(upstreamConnections, 0, 'Denied CONNECT must never reach the upstream');
  for (const host of ['auth.cqu.moe', 'sso.cqu.edu.cn']) {
    assert.match(await tunnel(`${host}:443`, false, 'actual-tunnel-head'), /^HTTP\/1.1 200 Connection Established\r\n/);
  }
  assert.equal(upstreamConnections, 2);
  assert.deepEqual(proxy.denied, ['https://denied.example.invalid', 'https://denied.example.invalid']);
} finally {
  try {
    await proxy?.close();
    await closeServer(upstream);
    assert.equal(sockets.size, 0, 'CONNECT upstream sockets must close');
  } finally { clearTimeout(timeout); }
}
await writeFile(join(output, 'control.json'), JSON.stringify({
  status: 'passed', observations, upstreamConnections, deniedCount: proxy.denied.length,
  cleanup: 'passed', remainingUpstreamSockets: sockets.size,
}, null, 2) + '\n', { flag: 'wx' });
console.log('[quicklogin-e2e] real denied CONNECT/RST and allowed tunnel control passed');
