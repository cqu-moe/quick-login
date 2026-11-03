import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startPinnedAuth } from './auth-runtime.mjs';

const output = resolve(process.argv[2] || `.e2e/artifact-mail-${randomUUID()}`);
if (!output.startsWith(resolve('.e2e') + '/')) throw new Error('Artifact control must be below .e2e');
await mkdir(dirname(output), { recursive: true });
await mkdir(output, { mode: 0o700 });
const reports = join(output, 'reports');
await mkdir(reports);
let runtime;
try {
  runtime = await startPinnedAuth({
    authPath: process.env.QUICKLOGIN_E2E_AUTH_PATH || '../QUICKLOGIN-03-deps/auth',
    expectedCommit: process.env.QUICKLOGIN_E2E_AUTH_COMMIT || '41147c934c577f6a10f5bf3d9cb71597c362a07f',
    outputDir: output,
  });
  const response = await fetch(`${runtime.controlOrigin}/identity`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'artifact-mail' }),
  });
  const identity = await response.json();
  assert.equal(response.status, 200, String(identity.error ?? '').replace(/https?:\/\/\S+/g, '[endpoint]').replace(/[A-Za-z0-9_-]{20,}/g, '[opaque]'));
  const mail = await fetch(`${runtime.controlOrigin}/mail?email=${encodeURIComponent(identity.email)}`);
  assert.equal(mail.status, 200);
  const { otp } = await mail.json();
  assert.ok(typeof otp === 'string' && /^\d{6}$/.test(otp), 'synthetic mail must contain a six-digit code');
  const report = join(reports, 'report.json');
  const metadata = JSON.stringify({ runId: `aa${otp}-bbbb-4ccc-8ddd-eeeeeeeeeeee`, durationMs: Number(`1${otp}`) });
  await writeFile(report, metadata);
  await assert.doesNotReject(runtime.checkArtifacts(reports, []), 'automatically delivered OTP must not collide with metadata');

  // Identity passwords remain automatic fingerprints.
  await writeFile(report, JSON.stringify({ accidentalLeak: identity.password }));
  await assert.rejects(runtime.checkArtifacts(reports, []), /Sensitive synthetic value/);
  // Caller-provided values and explicit registrations remain exact, even for six digits.
  const cookie = `synthetic-cookie-${randomUUID()}`;
  await writeFile(report, JSON.stringify({ accidentalLeak: cookie }));
  await assert.rejects(runtime.checkArtifacts(reports, [cookie]), /Sensitive synthetic value/);
  const protectedResponse = await fetch(`${runtime.controlOrigin}/protect`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values: [otp, cookie] }),
  });
  assert.equal(protectedResponse.status, 204);
  await assert.rejects(runtime.checkArtifacts(reports, []), /Sensitive synthetic value/);
  await writeFile(report, metadata);
  await assert.rejects(runtime.checkArtifacts(reports, []), /Sensitive synthetic value/);
  console.log('[quicklogin-e2e] artifact mail collision and explicit secret controls passed');
} finally {
  try { await runtime?.close(); }
  finally { await rm(output, { recursive: true, force: true }); }
}
