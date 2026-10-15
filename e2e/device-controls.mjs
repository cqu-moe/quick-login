import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { strict as assert } from 'node:assert';

const output = resolve(`.e2e/device-control-${Date.now()}`);
await mkdir(output, { mode: 0o700 });
const checks = [];
for (const [name, title, flag, message, event] of [
  ['missing-alarm', '^QUICKLOGIN-03 native alarm', 'QUICKLOGIN_E2E_BREAK_ALARM', 'Native alarm did not restart stopped MV3 worker', 'missing-alarm-control-armed'],
  ['held-ack', '^QUICKLOGIN-03 real pending ACK', 'QUICKLOGIN_E2E_BREAK_ACK', 'Pending ACK was not independently confirmed', 'held-ack-control-armed'],
]) {
  const child = spawn(process.execPath, ['e2e/run.mjs', '--grep', title], {
    env: { ...process.env, [flag]: '1', QUICKLOGIN_E2E_OUTPUT: join(output, name), E2E_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log += chunk; process.stdout.write(chunk); });
  const code = await new Promise((done, fail) => { child.once('error', fail); child.once('close', code => done(code ?? 1)); });
  await writeFile(join(output, `${name}.log`), log);
  const runtime = JSON.parse(await readFile(join(output, name, 'runtime.json'), 'utf8'));
  const report = JSON.parse(await readFile(join(output, name, 'report.json'), 'utf8'));
  const attempt = report.run.results.find(test => test.selected)?.attempts[0];
  const events = await readFile(join(output, name, 'artifacts/events.log'), 'utf8');
  assert.equal(code, 1);
  assert.equal(report.run.summary.executed, 1);
  assert.equal(report.run.summary.failed, 1);
  assert.equal(report.run.summary.passed, 0);
  assert.equal(report.run.summary.skipped, 0);
  assert.equal(attempt.error.message, message);
  assert(events.includes(`"event":"${event}"`));
  assert.equal(runtime.cleanup, 'passed');
  if (name === 'held-ack') {
    assert.equal(runtime.school.proxyObjectsRemoved, true);
    assert(runtime.school.removedProxyIds.length > 0);
  }
  checks.push({ name, expectedFailure: message, runnerExitCode: code, cleanup: runtime.cleanup });
}
await writeFile(join(output, 'control.json'), JSON.stringify({ status: 'passed', checks }, null, 2) + '\n');
console.log(`[quicklogin-e2e] verified two actual lifecycle faults: ${output}`);
