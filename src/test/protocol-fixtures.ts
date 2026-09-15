import type { DeviceSnapshot, ExportEnvelope, Receipt, ApiResponse } from "../shared/protocol-v3.generated";

export function snapshot(now = Date.now()): DeviceSnapshot {
  return {
    snapshotId: "snapshot-synthetic", serverTime: now, observedAt: now, freshUntil: now + 300_000,
    identity: { deviceId: "device-a", installationId: "installation-a", deviceName: "Test Chrome" },
    presence: { lastSeenAt: now, lastIp: null },
    versions: { generation: 4, bindingEpoch: 3, credentialRevision: 2, sessionVersion: 7,
      accountRevision: 11, deviceRevision: 12, bindingRevision: 8 },
    authorization: { state: "authorized", policy: "enabled", disabledReason: null,
      masterEnabled: true, deviceEnabled: true, deviceLimit: 5, used: 1 },
    binding: { state: "bound", credentialsState: "verified", evidenceAt: now,
      evidenceKind: "first_factor_success", evidenceCredentialRevision: 2, bindingTransitionId: null },
    cloud: { state: "ready", operationId: null, stage: null, loginAt: now, lastValidatedAt: now,
      usableUntil: now + 3_600_000, retryAt: null, reasonCode: null, deadlineAt: null },
    reportedLocal: null,
    observation: "fresh",
    presentation: { statusCode: "syncing", title: "正在同步到浏览器", detail: null,
      reasonCode: null, actionCode: "none", actionTarget: null, nextCheckAt: now + 30_000, freshUntil: now + 300_000 },
    capabilities: { canEnsure: true, canRetry: true, canExport: true, canEnable: true, canUseExistingSession: true },
  };
}

export function envelope(now = Date.now()): ExportEnvelope {
  return {
    protocolVersion: 3, deviceId: "device-a", generation: 4, bindingEpoch: 3,
    credentialRevision: 2, sessionVersion: 7, exportId: "export-a", createdAt: now,
    applyBefore: now + 30_000,
    cookies: [{ name: "SOURCEID_TGC", value: "synthetic-session", domain: "sso.cqu.edu.cn",
      path: "/", secure: true, httpOnly: true, sameSite: "Lax", expires: -1 }],
  };
}

export function receipt(now = Date.now()): Receipt {
  return { deviceId: "device-a", generation: 4, bindingEpoch: 3, credentialRevision: 2,
    sessionVersion: 7, exportId: "export-a", result: "applied", verifiedAt: now };
}

export function response<T>(data: T): ApiResponse<T> {
  return { data, meta: { protocolVersion: 3, requestId: "request-a", serverTime: Date.now(), serverBuild: "synthetic-build" } };
}

export function readySnapshot(now = Date.now()): DeviceSnapshot {
  return { ...snapshot(now), reportedLocal: {
    reportEpoch: "report-a",clientReportSeq:1,cookieState:"applied",receipt:receipt(now),receivedAt:now,
    verificationAge:0,acknowledgedAt:now,enabledIntent:true,mode:"automatic",schoolAccess:"unverified",client:null,
  } };
}
