export type ErrorCode =
  | "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_REQUEST"
  | "NO_DEVICE_CAPACITY" | "DEVICE_LIMIT_REACHED" | "DEVICE_REVOKED"
  | "MASTER_DISABLED" | "DEVICE_DISABLED" | "PREPARING" | "NEEDS_REAUTH"
  | "TEMPORARY_UNAVAILABLE" | "RATE_LIMITED" | "PROTOCOL_UNSUPPORTED"
  | "STALE_GENERATION" | "PREVIEW_CHANGED";

export type CloudState =
  | "disabled" | "paused" | "preparing" | "ready" | "refreshing"
  | "needs_reauth" | "temporary_unavailable" | "revoked";

export interface DeviceStatus {
  protocolVersion: 1;
  deviceId: string;
  generation: number;
  masterEnabled: boolean;
  enabled: boolean;
  deviceLimit: number;
  used: number;
  disabledReason: "user" | "quota_reduced" | null;
  state: CloudState;
  sessionVersion: number;
  appliedVersion: number | null;
  loginAt: number | null;
  lastKeepAliveAt: number | null;
  lastSeenAt: number | null;
}

export interface ExportedCookie {
  name: string;
  value: string;
  domain: "sso.cqu.edu.cn" | ".sso.cqu.edu.cn";
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "Strict" | "Lax" | "None";
  expires: number;
  session: boolean;
}

export interface CookieEnvelope {
  protocolVersion: 1;
  deviceId: string;
  generation: number;
  sessionVersion: number;
  createdAt: number;
  cookies: ExportedCookie[];
}

export interface ManagedCookie {
  name: string;
  domain: string;
  path: string;
  storeId: string;
  digest: string;
}

export interface RecoveryRound {
  id: string;
  generation: number;
  sessionVersion: number | null;
  phase: "downloading" | "writing" | "navigated" | "manual_required" | "finished";
  downloadRetries: number;
  writeRetries: number;
  nextAttemptAt: number | null;
  navigatedTabId: number | null;
}

export interface LocalState {
  schemaVersion: 1;
  deviceId: string | null;
  localGeneration: number;
  serverGeneration: number | null;
  enabledIntent: boolean;
  manualOverride: boolean;
  appliedVersion: number | null;
  managed: ManagedCookie[];
  recovery: RecoveryRound | null;
  status: DeviceStatus | null;
  localWriteState: "idle" | "writing" | "ready" | "foreign_session" | "error";
  lastError: ErrorCode | null;
  pendingOperation: "disable" | null;
}

export interface ApiError {
  error: { code: ErrorCode; message: string; retryAfterMs?: number };
}
