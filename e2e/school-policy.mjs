import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

// Legitimate policy prerequisite only: actual strong-admin admission and API.
export async function grantSchoolDevicePolicy(authRoot, runtime, userId, sensitive) {
  const { prepareAccount } = await import(pathToFileURL(join(authRoot, 'e2e/prepare-account.mjs')).href);
  const password = 'Synthetic-school-policy-admin-123!';
  sensitive.add(password);
  const account = await prepareAccount(runtime, { email: `policy-${randomUUID()}@example.test`, password });
  await runtime.db.prepare("UPDATE user SET role='superAdmin' WHERE id=?").bind(account.userId).run();
  const jar = new Map();
  async function request(path, body, method = 'POST') {
    const response = await fetch(`${runtime.origin}/api/v1${path}`, { method, headers: {
      origin: runtime.origin, 'content-type': 'application/json', cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '),
    }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    for (const raw of response.headers.getSetCookie()) { const pair = raw.split(';')[0], index = pair.indexOf('='); jar.set(pair.slice(0, index), pair.slice(index + 1)); }
    if (!response.ok) throw new Error(`Strong-admin policy prerequisite failed (${response.status}, ${path})`);
    return response.status === 204 ? null : response.json();
  }
  await request('/auth/sign-in/email', { email: account.email, password });
  await request('/auth/security/challenge', { password, purpose: 'mfa' });
  const enrolled = await request('/auth/two-factor/enable', { password });
  sensitive.add(enrolled.totpURI);
  const requireAuth = createRequire(join(authRoot, 'package.json'));
  const { createOTP } = await import(pathToFileURL(requireAuth.resolve('@better-auth/utils/otp')).href);
  const { base32 } = await import(pathToFileURL(requireAuth.resolve('@better-auth/utils/base32')).href);
  const raw = new TextDecoder().decode(base32.decode(new URL(enrolled.totpURI).searchParams.get('secret')));
  await request('/auth/two-factor/verify-totp', { code: await createOTP(raw).totp() });
  const preview = await request(`/admin/users/${userId}/quicklogin-quota/preview`, { deviceLimit: 2 });
  await request(`/admin/users/${userId}/quicklogin-quota`, { newLimit: 2, token: preview.data.token }, 'PUT');
}
