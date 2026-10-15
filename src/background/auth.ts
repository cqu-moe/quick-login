import { API_PATHS, AUTH_ISSUER, config, DEVICE_SCOPE } from "../shared/config";
import type { ApiError } from "../shared/contracts";
import { clientMetadata } from "../shared/client-metadata";
import { parseApiResponse, parseRegistrationResponse, type ReasonCode } from "../shared/protocol-v3.generated";
import { readLocalState, updateLocalState, updateLocalStateWith } from "./storage";
import {
  captureQuickloginOperation,
  durationFrom,
  telemetryErrorCode,
} from "../shared/posthog";

const TOKENS_KEY = "quicklogin.tokens";
const PENDING_KEY = "quicklogin.pkce";
const PENDING_TTL_MS = 10 * 60_000;
const RESUME_KEY = "quicklogin.resume";
interface ResumeContext { resumeTicket: string; deviceId: string; expiresAt: number }

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

let refreshFlight: { generation: number; promise: Promise<Tokens> } | null = null;
let loginFlight: Promise<void> | null = null;

export class AuthorizationError extends Error {
  constructor(public readonly code: ReasonCode | "TEMPORARY_UNAVAILABLE") {
    super(code);
    this.name = "AuthorizationError";
  }
}

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

async function saveTokens(body: Record<string, unknown>, authGeneration: number, newGrant: boolean): Promise<Tokens> {
  if (typeof body.access_token !== "string" || typeof body.refresh_token !== "string") {
    throw new Error("INVALID_TOKEN_RESPONSE");
  }
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 300;
  const tokens = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + Math.max(30, expiresIn) * 1_000,
  };
  await updateLocalStateWith({ [TOKENS_KEY]: tokens }, (state) => {
    if (state.authGeneration !== authGeneration) throw new AuthorizationError("AUTH_RECONNECT_REQUIRED");
    // Publish a new grant and its report epoch together. Refreshes keep the epoch.
    return newGrant ? { ...state, reportEpoch: crypto.randomUUID(), clientReportSeq: 0 } : state;
  });
  return tokens;
}

async function tokenRequest(params: URLSearchParams, authGeneration: number): Promise<Tokens> {
  if ((await readLocalState()).authGeneration !== authGeneration) throw new AuthorizationError("OPERATION_CANCELLED");
  let response: Response;
  try {
    response = await fetch(`${config.authOrigin}${API_PATHS.oauthToken}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params,
      credentials: "omit",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AuthorizationError("TEMPORARY_UNAVAILABLE");
  }
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    if (body?.error === "invalid_grant" || body?.code === "INVALID_GRANT") {
      throw new AuthorizationError("AUTH_RECONNECT_REQUIRED");
    }
    throw new AuthorizationError("TEMPORARY_UNAVAILABLE");
  }
  if (!body) throw new AuthorizationError("CONTRACT_INVALID");
  return saveTokens(body, authGeneration, params.get("grant_type") === "authorization_code");
}

async function refreshTokens(authGeneration: number, force = false): Promise<Tokens> {
  if (refreshFlight?.generation === authGeneration) return refreshFlight.promise;
  const flight = { generation: authGeneration, promise: (async () => {
    const current = await readTokens();
    if (!current) throw new AuthorizationError("AUTH_RECONNECT_REQUIRED");
    if (!force && current.expiresAt > Date.now() + 30_000) return current;
    return tokenRequest(new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      refresh_token: current.refreshToken,
      resource: AUTH_ISSUER,
    }), authGeneration);
  })() };
  refreshFlight = flight;
  try {
    return await flight.promise;
  } finally {
    if (refreshFlight === flight) refreshFlight = null;
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
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
}

export async function authorizedFetch(path: string, init: RequestInit = {}, expectedAuthGeneration?: number): Promise<Response> {
  const generation = expectedAuthGeneration ?? (await readLocalState()).authGeneration;
  const assertCurrentAuthorization = async () => {
    if ((await readLocalState()).authGeneration !== generation) throw new AuthorizationError("OPERATION_CANCELLED");
  };
  await assertCurrentAuthorization();
  let tokens = await refreshTokens(generation);
  await assertCurrentAuthorization();
  let response = await send(path, init, tokens.accessToken);
  if (response.status !== 401) return response;

  const error = await response.clone().json().catch(() => null) as (Partial<ApiError> & {code?:string}) | null;
  if (error?.error?.code === "DEVICE_REVOKED" || error?.code === "DEVICE_REVOKED") return response;
  await assertCurrentAuthorization();
  tokens = await refreshTokens(generation, true);
  await assertCurrentAuthorization();
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

async function registerSavedAuthorization(resume?: ResumeContext): Promise<boolean> {
  if (!await readTokens()) return false;
  const local = await readLocalState();
  const localGeneration = local.localGeneration;
  let response: Response;
  try {
    response = await authorizedFetch("/api/v1/cqu/quicklogin/registrations", {
      method: "POST",
      body: JSON.stringify({ protocolVersion:3,requestId:crypto.randomUUID(),registrationId:local.registrationId,
        client:clientMetadata(local),deviceName:deviceMetadata().deviceName,
        ...(local.deviceId ? { deviceId:local.deviceId } : {}),
        ...(resume ? { resumeTicket:resume.resumeTicket,deviceId:resume.deviceId } : {}) }),
    });
  } catch (error) {
    if (error instanceof AuthorizationError && error.code === "AUTH_RECONNECT_REQUIRED") {
      await chrome.storage.local.remove(TOKENS_KEY); return false;
    }
    throw error;
  }
  if (!response.ok) {
    const body = await response.clone().json().catch(() => null) as ApiError | null;
    if (response.status === 401 || body?.error?.code === "DEVICE_REVOKED") {
      await chrome.storage.local.remove(TOKENS_KEY);
      return false;
    }
    throw new AuthorizationError(response.status === 426 ? "PROTOCOL_UNSUPPORTED" :
      response.status === 403 ? "FORBIDDEN" : "INTERNAL_STATE_UNAVAILABLE");
  }
  const result = parseApiResponse(await response.json(),parseRegistrationResponse).data;
  await updateLocalState((local) => {
    if (local.localGeneration !== localGeneration) throw new AuthorizationError("AUTH_RECONNECT_REQUIRED");
    return { ...local,deviceId:result.deviceId,serverGeneration:result.snapshot.versions.generation,
      centralUserId:result.centralUserId,snapshot:result.snapshot,authorization:"authorized",observation:"fresh",localError:null,
      receipt:null,pendingAck:false,lastConfirmedAt:Date.now(),lastError:null };
  });
  await chrome.storage.session.remove(RESUME_KEY);
  return true;
}

async function performInteractiveLogin(resume?: ResumeContext): Promise<void> {
  if (!resume && await registerSavedAuthorization()) return;
  if (!resume && (await readLocalState()).deviceId) throw new AuthorizationError("AUTH_RECONNECT_REQUIRED");
  const authorization = await updateLocalState((state)=>({...state,authGeneration:state.authGeneration+1,localGeneration:state.localGeneration+1,
    authorization:"authorizing",receipt:null,pendingAck:false}));
  const state = randomBase64Url();
  const verifier = randomBase64Url();
  const redirectUri = chrome.identity.getRedirectURL();
  const pending: PendingPkce = { state, verifier, redirectUri, createdAt: Date.now() };
  await chrome.storage.local.set({ [PENDING_KEY]: pending });

  const authorize = new URL(`${config.authOrigin}${API_PATHS.oauthAuthorize}`);
  authorize.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `openid offline_access ${DEVICE_SCOPE}`,
    state,
    code_challenge: await challenge(verifier),
    code_challenge_method: "S256",
    prompt: "consent",
    resource: AUTH_ISSUER,
  }).toString();

  const callback = await chrome.identity.launchWebAuthFlow({
    url: authorize.toString(),
    interactive: true,
  });
  const stored = (await chrome.storage.local.get(PENDING_KEY))[PENDING_KEY] as PendingPkce | undefined;
  const url = callback ? new URL(callback) : null;
  const expected = stored ? new URL(stored.redirectUri) : null;
  if (!stored || Date.now() - stored.createdAt > PENDING_TTL_MS ||
      stored.state !== url?.searchParams.get("state") ||
      url?.origin !== expected?.origin || url?.pathname !== expected?.pathname ||
      url?.username || url?.password || url?.hash) {
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
    resource: AUTH_ISSUER,
  }), authorization.authGeneration);
  if (!await registerSavedAuthorization(resume)) {
    throw new Error("DEVICE_REGISTRATION_FAILED");
  }
}

export function loginInteractive(resume?: ResumeContext): Promise<void> {
  if (loginFlight) return loginFlight;
  loginFlight = (async () => {
    const startedAt = Date.now();
    try {
      if (resume) {
        if (resume.expiresAt <= Date.now() || resume.resumeTicket.length > 4096 || !resume.deviceId) throw new AuthorizationError("INVALID_REQUEST");
        await chrome.storage.session.set({ [RESUME_KEY]:resume });
      }
      const pendingResume=(await chrome.storage.session.get(RESUME_KEY))[RESUME_KEY] as ResumeContext | undefined;
      await performInteractiveLogin(pendingResume && pendingResume.expiresAt > Date.now() ? pendingResume : undefined);
      captureQuickloginOperation("connect", {
        outcome: "success",
        trigger: "user",
        durationMs: durationFrom(startedAt),
      });
    } catch (error) {
      captureQuickloginOperation("connect", {
        outcome: "failure",
        trigger: "user",
        durationMs: durationFrom(startedAt),
        errorCode: telemetryErrorCode(error),
      });
      throw error;
    }
  })().finally(() => { loginFlight=null; });
  return loginFlight;
}

export async function clearDeviceAuthorization(): Promise<void> {
  await updateLocalStateWith({ [TOKENS_KEY]: null, [PENDING_KEY]: null }, (state) => ({
    ...state,
    localGeneration: state.localGeneration + 1,
    authGeneration: state.authGeneration + 1,
    deviceId: null,
    centralUserId: null,
    serverGeneration: null,
    snapshot: null,
    receipt: null,
    pendingAck: false,
    authorization: "disconnected",
    observation: "checking",
    reportEpoch: crypto.randomUUID(),
    enabledIntent: false,
    recovery: null,
    loginRecovery: null,
  }));
}
