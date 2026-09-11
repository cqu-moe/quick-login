import { config, DEVICE_SCOPE } from "../shared/config";
import type { ApiError, DeviceStatus } from "../shared/contracts";
import { updateLocalState } from "./storage";

const TOKENS_KEY = "quicklogin.tokens";
const PENDING_KEY = "quicklogin.pkce";
const PENDING_TTL_MS = 10 * 60_000;

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface PendingPkce {
  state: string;
  verifier: string;
  redirectUri: string;
  createdAt: number;
}

let refreshFlight: Promise<Tokens> | null = null;

function randomBase64Url(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function readTokens(): Promise<Tokens | null> {
  const stored = await chrome.storage.local.get(TOKENS_KEY);
  return (stored[TOKENS_KEY] as Tokens | undefined) ?? null;
}

async function saveTokens(body: Record<string, unknown>): Promise<Tokens> {
  if (typeof body.access_token !== "string" || typeof body.refresh_token !== "string") {
    throw new Error("INVALID_TOKEN_RESPONSE");
  }
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 300;
  const tokens = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + Math.max(30, expiresIn) * 1_000,
  };
  await chrome.storage.local.set({ [TOKENS_KEY]: tokens });
  return tokens;
}

async function tokenRequest(params: URLSearchParams): Promise<Tokens> {
  const response = await fetch(`${config.authOrigin}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
    credentials: "omit",
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error("TOKEN_EXCHANGE_FAILED");
  return saveTokens(body);
}

async function refreshTokens(force = false): Promise<Tokens> {
  if (refreshFlight) return refreshFlight;
  refreshFlight = (async () => {
    const current = await readTokens();
    if (!current) throw new Error("UNAUTHORIZED");
    if (!force && current.expiresAt > Date.now() + 30_000) return current;
    return tokenRequest(new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      refresh_token: current.refreshToken,
      resource: config.authOrigin,
    }));
  })();
  try {
    return await refreshFlight;
  } finally {
    refreshFlight = null;
  }
}

async function send(path: string, init: RequestInit, token: string): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${config.authOrigin}${path}`, {
    ...init,
    headers,
    credentials: "omit",
  });
}

export async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let tokens = await refreshTokens();
  let response = await send(path, init, tokens.accessToken);
  if (response.status !== 401) return response;

  const error = await response.clone().json().catch(() => null) as ApiError | null;
  if (error?.error.code === "DEVICE_REVOKED") return response;
  tokens = await refreshTokens(true);
  response = await send(path, init, tokens.accessToken);
  return response;
}

function deviceMetadata() {
  return {
    deviceName: `${navigator.platform || "Chrome"} Chrome`,
    browserFamily: "chrome" as const,
    browserVersion: navigator.userAgent.match(/Chrome\/(\d+(?:\.\d+)*)/)?.[1] ?? "unknown",
  };
}

async function registerSavedAuthorization(): Promise<boolean> {
  if (!await readTokens()) return false;
  const response = await authorizedFetch("/api/cqu/quicklogin/devices", {
    method: "POST",
    body: JSON.stringify(deviceMetadata()),
  });
  if (!response.ok) {
    const body = await response.clone().json().catch(() => null) as ApiError | null;
    if (response.status === 401 || body?.error.code === "DEVICE_REVOKED") {
      await chrome.storage.local.remove(TOKENS_KEY);
      return false;
    }
    throw new Error(`DEVICE_REGISTRATION_FAILED:${body?.error.code ?? response.status}`);
  }
  const status = await response.json() as DeviceStatus;
  await updateLocalState((local) => ({
    ...local,
    deviceId: status.deviceId,
    serverGeneration: status.generation,
    status,
    lastError: null,
  }));
  return true;
}

export async function loginInteractive(): Promise<void> {
  if (await registerSavedAuthorization()) return;
  const state = randomBase64Url();
  const verifier = randomBase64Url();
  const redirectUri = chrome.identity.getRedirectURL();
  const pending: PendingPkce = { state, verifier, redirectUri, createdAt: Date.now() };
  await chrome.storage.local.set({ [PENDING_KEY]: pending });

  const authorize = new URL(`${config.authOrigin}/api/auth/oauth2/authorize`);
  authorize.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `openid offline_access ${DEVICE_SCOPE}`,
    state,
    code_challenge: await challenge(verifier),
    code_challenge_method: "S256",
    prompt: "consent",
    resource: config.authOrigin,
  }).toString();

  const callback = await chrome.identity.launchWebAuthFlow({
    url: authorize.toString(),
    interactive: true,
  });
  const stored = (await chrome.storage.local.get(PENDING_KEY))[PENDING_KEY] as PendingPkce | undefined;
  const url = callback ? new URL(callback) : null;
  if (!stored || Date.now() - stored.createdAt > PENDING_TTL_MS ||
      stored.state !== url?.searchParams.get("state") ||
      !url?.toString().startsWith(stored.redirectUri)) {
    await chrome.storage.local.remove(PENDING_KEY);
    throw new Error("OAUTH_STATE_MISMATCH");
  }
  const code = url.searchParams.get("code");
  if (!code) throw new Error("OAUTH_CODE_MISSING");
  await chrome.storage.local.remove(PENDING_KEY);
  await tokenRequest(new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    code_verifier: stored.verifier,
    redirect_uri: stored.redirectUri,
    resource: config.authOrigin,
  }));
  if (!await registerSavedAuthorization()) {
    throw new Error("DEVICE_REGISTRATION_FAILED");
  }
}

export async function clearDeviceAuthorization(): Promise<void> {
  await chrome.storage.local.remove([TOKENS_KEY, PENDING_KEY]);
  await updateLocalState((state) => ({
    ...state,
    deviceId: null,
    serverGeneration: null,
    enabledIntent: false,
    recovery: null,
  }));
}
