import type { ApiError, DeviceStatus, ErrorCode } from "./contracts";

const STATES = new Set([
  "disabled", "paused", "preparing", "ready", "refreshing",
  "needs_reauth", "temporary_unavailable", "revoked",
]);
const ERROR_CODES = new Set<ErrorCode>([
  "UNAUTHORIZED", "FORBIDDEN", "INVALID_REQUEST", "NO_DEVICE_CAPACITY",
  "DEVICE_LIMIT_REACHED", "DEVICE_REVOKED", "MASTER_DISABLED", "DEVICE_DISABLED",
  "PREPARING", "NEEDS_REAUTH", "TEMPORARY_UNAVAILABLE", "RATE_LIMITED",
  "PROTOCOL_UNSUPPORTED", "STALE_GENERATION", "PREVIEW_CHANGED",
]);
const STATUS_KEYS = [
  "appliedVersion", "deviceId", "deviceLimit", "disabledReason", "enabled",
  "generation", "lastKeepAliveAt", "lastSeenAt", "loginAt", "masterEnabled",
  "protocolVersion", "sessionVersion", "state", "used",
].sort().join(",");

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function nullableInteger(value: unknown): boolean {
  return value === null || safeInteger(value);
}

export function validateDeviceStatus(value: unknown): DeviceStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_STATUS");
  const status = value as Record<string, unknown>;
  if (JSON.stringify(value).length > 64 * 1024 ||
      Object.keys(status).sort().join(",") !== STATUS_KEYS ||
      status.protocolVersion !== 1 || typeof status.deviceId !== "string" || !status.deviceId ||
      !safeInteger(status.generation) || typeof status.masterEnabled !== "boolean" ||
      typeof status.enabled !== "boolean" || !safeInteger(status.deviceLimit) ||
      !safeInteger(status.used) ||
      ![null, "user", "quota_reduced"].includes(status.disabledReason as null | string) ||
      typeof status.state !== "string" || !STATES.has(status.state) ||
      !safeInteger(status.sessionVersion) || !nullableInteger(status.appliedVersion) ||
      !nullableInteger(status.loginAt) || !nullableInteger(status.lastKeepAliveAt) ||
      !nullableInteger(status.lastSeenAt)) {
    throw new Error("INVALID_STATUS");
  }
  return value as DeviceStatus;
}

export function validateApiError(value: unknown): ApiError {
  const error = (value as { error?: Record<string, unknown> } | null)?.error;
  if (!error || typeof error.code !== "string" || !ERROR_CODES.has(error.code as ErrorCode) ||
      typeof error.message !== "string" ||
      (error.retryAfterMs !== undefined && !safeInteger(error.retryAfterMs))) {
    throw new Error("INVALID_API_ERROR");
  }
  return value as ApiError;
}
