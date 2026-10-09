import {
  parseApiProblem, parseApiResponse, parseCapabilities, parseExportEnvelope,
  parseOperationResponse, parseReceiptAck, parseReconcileResponse, parseDeviceSnapshot, tupleForSnapshot, sameTuple,
  type ActionCode, type DeviceSnapshot, type ExportEnvelope, type OperationCommand,
  type ReasonCode, type Receipt, type ReconcileResponse,
} from "../shared/protocol-v3.generated";
import { clientMetadata } from "../shared/client-metadata";
import { config } from "../shared/config";
import { authorizedFetch } from "./auth";
import { readLocalState, updateLocalState } from "./storage";
import type { LocalState } from "../shared/contracts";

const BASE = "/api/v1/cqu/quicklogin";
export class ApiFailure extends Error {
  constructor(public readonly code: ReasonCode, public readonly retryAt: number | null = null,
    public readonly action: ActionCode = "reconcile") {
    super(code);
    this.name = "ApiFailure";
  }
}


export function localCookieState(state: LocalState) {
  if (state.manualOverride) return "manual" as const;
  if (state.localWriteState === "foreign_session") return "foreign" as const;
  if (state.localError === "LOCAL_PERMISSION_DENIED") return "permission_denied" as const;
  if (state.localWriteState === "error") return "write_failed" as const;
  if (state.localWriteState === "writing") return "applying" as const;
  if (state.receipt?.result === "applied" && state.localWriteState === "ready") return "applied" as const;
  return "unknown" as const;
}

async function decode<T>(response: Response, parser: (value: unknown) => T, maxBytes = 64 * 1024): Promise<T> {
  let text: string;
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new ApiFailure("CONTRACT_INVALID");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new ApiFailure("CONTRACT_INVALID"); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    text = new TextDecoder().decode(bytes);
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    throw new ApiFailure("INTERNAL_STATE_UNAVAILABLE");
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch { value = null; }
  if (!response.ok) {
    try {
      const problem = parseApiProblem(value);
      throw new ApiFailure(problem.code, problem.retryAt, problem.action);
    } catch (error) {
      if (error instanceof ApiFailure) throw error;
      const code = response.status === 401 ? "AUTH_RECONNECT_REQUIRED" :
        response.status === 403 ? "FORBIDDEN" : response.status === 426 ? "PROTOCOL_UNSUPPORTED" :
        response.status === 429 ? "RATE_LIMITED" : "INTERNAL_STATE_UNAVAILABLE";
      const delay = Number(response.headers.get("Retry-After"));
      throw new ApiFailure(code, delay > 0 ? Date.now() + delay * 1000 : null);
    }
  }
  return parseApiResponse(value, parser).data;
}

async function post<T>(state: LocalState, path: string, body: unknown, parser: (value: unknown) => T, maxBytes?: number): Promise<T> {
  if (state.authorization === "authorizing") throw new ApiFailure("OPERATION_CANCELLED");
  return decode(await authorizedFetch(`${BASE}${path}`, {
    method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  }, state.authGeneration), parser, maxBytes);
}

function devicePath(state: LocalState): string {
  if (!state.deviceId) throw new ApiFailure("AUTH_RECONNECT_REQUIRED");
  return `/devices/${encodeURIComponent(state.deviceId)}`;
}

export async function capabilities() {
  return decode(await fetch(`${config.authOrigin}${BASE}/capabilities`, {
    credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(10_000),
  }), parseCapabilities);
}

async function sendReconcile(state: LocalState): Promise<ReconcileResponse> {
  const snapshot = state.snapshot;
  const result=await post(state, `${devicePath(state)}/reconcile`, {
    protocolVersion: 3, requestId: crypto.randomUUID(), client: clientMetadata(state),
    observed: snapshot ? {
      generation: snapshot.versions.generation, bindingEpoch: snapshot.versions.bindingEpoch,
      credentialRevision: snapshot.versions.credentialRevision, sessionVersion: snapshot.versions.sessionVersion,
      deviceRevision: snapshot.versions.deviceRevision,
    } : null,
    reportEpoch: state.reportEpoch, clientReportSeq: state.clientReportSeq,
    local: { enabledIntent: state.enabledIntent, mode: state.manualOverride ? "manual" : "automatic",
      cookieState: localCookieState(state), receipt: state.receipt, schoolAccess: state.schoolAccess },
  }, parseReconcileResponse);
  if (result.snapshot.identity.deviceId !== state.deviceId) throw new ApiFailure("CONTRACT_INVALID");
  if (result.receiptAck && (result.receiptAck.reportEpoch !== state.reportEpoch ||
      result.receiptAck.clientReportSeq !== state.clientReportSeq ||
      result.receiptAck.exportId !== (state.receipt?.exportId ?? null) ||
      (result.receiptAck.accepted && !sameTuple(result.receiptAck.acceptedTuple,state.receipt)))) throw new ApiFailure("CONTRACT_INVALID");
  return result;
}

export async function reconcile(): Promise<ReconcileResponse> {
  const state = await updateLocalState((current) => ({ ...current, clientReportSeq: current.clientReportSeq + 1 }));
  try {
    return await sendReconcile(state);
  } catch (error) {
    if (!(error instanceof ApiFailure) || error.code !== "INVALID_REQUEST") throw error;
  }

  // A cached report is only a recovery candidate. The server must accept a new,
  // receipt-free report before we adopt its epoch; never overwrite its fence.
  let snapshot: DeviceSnapshot;
  try { snapshot = parseDeviceSnapshot(state.snapshot); }
  catch { throw new ApiFailure("AUTH_RECONNECT_REQUIRED"); }
  const report = snapshot.reportedLocal;
  if (snapshot.identity.deviceId !== state.deviceId || snapshot.identity.installationId !== state.installationId ||
      !report || report.reportEpoch === state.reportEpoch ||
      (report.client !== null && report.client.installationId !== state.installationId)) {
    throw new ApiFailure("AUTH_RECONNECT_REQUIRED");
  }
  const sequence = Math.max(state.clientReportSeq, report.clientReportSeq) + 1;
  if (!Number.isSafeInteger(sequence)) throw new ApiFailure("AUTH_RECONNECT_REQUIRED");
  const sameAttempt = (current: LocalState) => current.deviceId === state.deviceId &&
    current.authGeneration === state.authGeneration && current.localGeneration === state.localGeneration &&
    current.reportEpoch === state.reportEpoch;
  const reserved = await updateLocalState(current => {
    if (!sameAttempt(current) || current.clientReportSeq !== state.clientReportSeq) throw new ApiFailure("OPERATION_CANCELLED");
    return { ...current, clientReportSeq: sequence };
  });
  const candidate: LocalState = { ...reserved, reportEpoch: report.reportEpoch, receipt: null,
    pendingAck: false, appliedVersion: null, localWriteState: "idle" };
  let result: ReconcileResponse;
  try { result = await sendReconcile(candidate); }
  catch (error) {
    if (error instanceof ApiFailure && error.code === "INVALID_REQUEST") throw new ApiFailure("AUTH_RECONNECT_REQUIRED");
    throw error;
  }
  if (result.snapshot.reportedLocal?.reportEpoch !== candidate.reportEpoch ||
      result.snapshot.reportedLocal.clientReportSeq !== sequence) throw new ApiFailure("AUTH_RECONNECT_REQUIRED");
  await updateLocalState(current => {
    if (!sameAttempt(current) || current.clientReportSeq !== sequence) throw new ApiFailure("OPERATION_CANCELLED");
    return { ...current, reportEpoch: candidate.reportEpoch, receipt: null, pendingAck: false,
      appliedVersion: null, localWriteState: "idle" };
  });
  return result;
}

export async function operate(command: OperationCommand, snapshot: DeviceSnapshot, idempotencyKey: string, enabled?: boolean) {
  const state = await readLocalState();
  const expected = tupleForSnapshot(snapshot);
  if (!expected) throw new ApiFailure("RECONCILING");
  return post(state, `${devicePath(state)}/operations`, {
    protocolVersion: 3, requestId: crypto.randomUUID(), command, idempotencyKey, expected,
    ...(enabled === undefined ? {} : { enabled }),
  }, parseOperationResponse);
}

export async function exportSession(snapshot: DeviceSnapshot): Promise<ExportEnvelope> {
  const state = await readLocalState();
  const expected = tupleForSnapshot(snapshot);
  if (!expected) throw new ApiFailure("RECONCILING");
  return post(state, `${devicePath(state)}/exports`, {
    protocolVersion: 3, requestId: crypto.randomUUID(), expected,
  }, parseExportEnvelope, 256 * 1024);
}

export async function acknowledge(receipt: Receipt) {
  const state = await updateLocalState((current) => ({ ...current, clientReportSeq: current.clientReportSeq + 1 }));
  const ack=await post(state, `${devicePath(state)}/receipts`, {
    protocolVersion: 3, requestId: crypto.randomUUID(), reportEpoch: state.reportEpoch,
    clientReportSeq: state.clientReportSeq, receipt,
  }, parseReceiptAck);
  if (ack.exportId !== receipt.exportId || ack.reportEpoch !== state.reportEpoch || ack.clientReportSeq !== state.clientReportSeq ||
      (ack.accepted && !sameTuple(ack.acceptedTuple,receipt))) throw new ApiFailure("CONTRACT_INVALID");
  return ack;
}
