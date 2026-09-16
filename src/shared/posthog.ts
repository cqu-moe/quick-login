import { PostHog } from "posthog-js/dist/module.no-external";

type EventLike = {
  event: string;
  properties: Record<string, unknown>;
};

export type QuickLoginOperation =
  | "connect"
  | "sync"
  | "cookie_apply"
  | "enable"
  | "disable"
  | "resume"
  | "switch_managed";

const INSTALLATION_ID_KEY = "quicklogin.posthog.installation_id";
const REDACTED = "[redacted]";
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const LABELED_SECRET = /\b(password|cookie|authorization|token|student_?id|email|otp|code|ticket)\s*[:=]\s*[^\s,;&]+/gi;
const BEARER = /\bBearer\s+[^\s,;&]+/gi;
const EXPECTED_STATE_CODES = new Set([
  "AUTH_RECONNECT_REQUIRED",
  "DEVICE_REVOKED",
  "MASTER_DISABLED",
  "DEVICE_DISABLED",
  "QUOTA_BLOCKED",
  "SERVICE_PAUSED",
  "BINDING_UNBOUND",
  "BINDING_UPDATING",
  "BINDING_CHANGED",
  "CREDENTIALS_REJECTED",
  "INTERACTION_REQUIRED",
  "STALE_SNAPSHOT",
  "SESSION_CHANGED",
  "RECONCILING",
  "RATE_LIMITED",
  "VERIFICATION_COOLDOWN",
  "LOCAL_PERMISSION_DENIED",
  "LOCAL_COOKIE_CONFLICT",
  "PROTOCOL_UNSUPPORTED",
  "CLIENT_UPDATE_REQUIRED",
  "FORBIDDEN",
  "OPERATION_CANCELLED",
]);

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return normalized === "password"
    || normalized === "authorization"
    || normalized === "studentid"
    || normalized === "email"
    || normalized === "otp"
    || normalized === "code"
    || normalized === "ticket"
    || normalized === "schedule"
    || normalized === "subscriptionurl"
    || normalized.endsWith("password")
    || normalized.endsWith("cookie")
    || normalized.endsWith("token")
    || (normalized.endsWith("code") && normalized !== "errorcode");
}

function redactText(value: string): string {
  return value
    .replace(EMAIL, REDACTED)
    .replace(LABELED_SECRET, (_match, label: string) => `${label}=${REDACTED}`)
    .replace(BEARER, `Bearer ${REDACTED}`);
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return redactText(value.split(/[?#]/, 1)[0] ?? "");
  }
}

function sanitizeValue(value: unknown, key = ""): unknown {
  if (isSensitiveKey(key)) return REDACTED;
  if (typeof value === "string") {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return normalized.includes("url") || normalized.includes("referrer")
      ? sanitizeUrl(value)
      : redactText(value);
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [childKey, sanitizeValue(childValue, childKey)])
    );
  }
  return value;
}

export function sanitizePostHogEvent<T extends EventLike>(event: T | null): T | null {
  if (!event) return null;
  return { ...event, properties: sanitizeValue(event.properties) as Record<string, unknown> };
}

export function telemetryErrorCode(error: unknown): string {
  const candidate = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(candidate) ? candidate : "UNEXPECTED_ERROR";
}

export function shouldCaptureQuickloginException(error: unknown): boolean {
  return !EXPECTED_STATE_CODES.has(telemetryErrorCode(error));
}

async function installationId(): Promise<string> {
  const stored = await chrome.storage.local.get(INSTALLATION_ID_KEY);
  const existing = stored[INSTALLATION_ID_KEY];
  if (typeof existing === "string" && existing.length > 0) return existing;
  const created = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTALLATION_ID_KEY]: created });
  return created;
}

async function client(): Promise<PostHog | null> {
  const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN?.trim();
  if (!token) return null;
  const instance = new PostHog();
  instance.init(token, {
    api_host: import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://p.cqu.moe",
    ui_host: "https://us.posthog.com",
    defaults: "2026-05-30",
    bootstrap: { distinctID: await installationId() },
    persistence: "memory",
    disable_external_dependency_loading: true,
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    advanced_disable_flags: true,
    request_batching: false,
    person_profiles: "never",
    error_tracking: { captureExtensionExceptions: true },
    before_send: sanitizePostHogEvent,
    ip: false,
  });
  return instance;
}

async function withClient(action: (instance: PostHog) => void): Promise<void> {
  try {
    const instance = await client();
    if (!instance) return;
    action(instance);
    await instance.shutdown();
  } catch {
    // Telemetry must never change extension behavior.
  }
}

function commonProperties(): Record<string, unknown> {
  return {
    service: "quicklogin",
    environment: import.meta.env.PROD ? "production" : "development",
    release: __QUICKLOGIN_BUILD_ID__,
    extension_version: chrome.runtime.getManifest().version,
    $process_person_profile: false,
  };
}

export async function captureQuickloginOperation(
  operation: QuickLoginOperation,
  outcome: "success" | "failure",
  errorCode?: string
): Promise<void> {
  await withClient((instance) => {
    instance.capture("quicklogin_operation_completed", {
      ...commonProperties(),
      operation,
      outcome,
      ...(errorCode ? { error_code: errorCode } : {}),
    }, { send_instantly: true });
  });
}

export async function captureQuickloginException(
  error: unknown,
  operation: QuickLoginOperation
): Promise<void> {
  if (!shouldCaptureQuickloginException(error)) return;
  await withClient((instance) => {
    instance.captureException(error, {
      ...commonProperties(),
      operation,
      error_code: telemetryErrorCode(error),
    });
  });
}
