import type { AuthorizationState, DeviceSnapshot, ObservationState, ReasonCode, Receipt, VersionTuple } from "./protocol-v3.generated";

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
  protocolVersion: 2;
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
}

export interface CookieEnvelope {
  protocolVersion: 2;
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
  // Read-only continuity proof; never grants ownership for deletion or rollback.
  renewal?: { digest: string; expirationDate: number };
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
  navigatedDocumentId?: string | null;
}

export interface LocalState {
  schemaVersion: 2;
  authGeneration: number;
  connectIntentId: string | null;
  managedSwitch?: {
    id: string; deviceId: string; authGeneration: number; localGeneration: number;
    generation: number; bindingEpoch: number; credentialRevision: number; expiresAt: number;
  } | null;
  installationId: string;
  centralUserId: string | null;
  registrationId: string;
  reportEpoch: string;
  clientReportSeq: number;
  snapshot: DeviceSnapshot | null;
  receipt: Receipt | null;
  pendingAck: boolean;
  authorization: AuthorizationState;
  observation: ObservationState;
  protocolSupport: "supported" | "client_update_required" | "service_upgrading";
  lastConfirmedAt: number | null;
  nextAttemptAt: number | null;
  localError: ReasonCode | null;
  schoolAccess: "unverified" | "accepted" | "login_form_seen";
  loginRecovery?: {
    id: string;
    rejectedTuple: VersionTuple | null;
    appliedExportId: string | null;
    acknowledgedExportId?: string | null;
    failed: boolean;
    pages: Array<{ tabId: number; documentId: string | null; navigated: boolean }>;
  } | null;
  networkFailures: number;
  pendingCommand: { id: string; enabled: boolean } | null;
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
