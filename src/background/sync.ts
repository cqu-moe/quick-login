import type { LocalState, RecoveryRound } from "../shared/contracts";
import { PREPARING_SYNC_DELAY_MS, SYNC_ALARM } from "../shared/config";
import { REASON_CODES, sameTuple, tupleForSnapshot, type DeviceSnapshot, type ExportEnvelope, type ReasonCode } from "../shared/protocol-v3.generated";
import * as api from "./api-v3";
import { clearDeviceAuthorization } from "./auth";
import { readLocalState, updateLocalState } from "./storage";
import { clearOwnedCookies, inspectManagedCookies, inspectLocalTgc } from "./cookie-store";
import {
  captureQuickloginOperation,
  durationFrom,
  telemetryTrigger,
  telemetryErrorCode,
} from "../shared/posthog";

export type SyncReason = "alarm" | "startup" | "network" | "enable" | "login_form" | "user_retry" | "popup";
type SyncRunResult = {
  outcome: "success" | "failure" | "partial" | "canceled" | "needs_input";
  noOp?: boolean;
  suppressSyncEvent?: boolean;
};
export type EnvelopeWriter = (envelope: ExportEnvelope,
  options: { localGeneration: number; allowForeignOnce: boolean }) => Promise<"applied" | "foreign_session" | "cancelled">;
let writer: EnvelopeWriter = async () => { throw new api.ApiFailure("LOCAL_WRITE_FAILED"); };
let syncFlight: Promise<void> | null = null;
const pendingReasons = new Set<SyncReason>();
function hasManagedSwitch(local: LocalState): boolean {
  const intent = local.managedSwitch, versions = local.snapshot?.versions;
  return !!intent && !!versions && intent.expiresAt > Date.now() &&
    intent.deviceId === local.deviceId && intent.authGeneration === local.authGeneration &&
    intent.localGeneration === local.localGeneration && local.enabledIntent && !local.manualOverride &&
    intent.generation === versions.generation && intent.bindingEpoch === versions.bindingEpoch &&
    intent.credentialRevision === versions.credentialRevision;
}

export function setEnvelopeWriter(next: EnvelopeWriter): void { writer = next; }

async function schedule(when: number): Promise<void> {
  await chrome.alarms.create(`${SYNC_ALARM}-retry`, { when: Math.max(Date.now() + 30_000, when) });
}

export async function recordFailure(error: unknown): Promise<void> {
  const candidate = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const code: ReasonCode = (REASON_CODES as readonly string[]).includes(candidate)
    ? candidate as ReasonCode : candidate === "COOKIE_PERMISSION_DENIED" ? "LOCAL_PERMISSION_DENIED" :
      candidate === "COOKIE_WRITE_TRANSIENT" ? "LOCAL_WRITE_FAILED" : "INTERNAL_STATE_UNAVAILABLE";
  if (code === "DEVICE_REVOKED") {
    await updateLocalState((state) => ({ ...state, localGeneration:state.localGeneration+1,
      authorization:"revoked", enabledIntent:false, centralUserId:null, receipt:null, pendingAck:false, localError:code }));
    await clearOwnedCookies();
    await clearDeviceAuthorization();
    await updateLocalState((state) => ({ ...state, authorization:"revoked", localError:code }));
    return;
  }
  const state = await updateLocalState((current) => {
    const failures = current.networkFailures + 1;
    const delays = [30_000,60_000,180_000,300_000];
    const retryAt = code === "AUTH_RECONNECT_REQUIRED" ? null : error instanceof api.ApiFailure && error.retryAt !== null ? error.retryAt :
      Date.now() + Math.round(delays[Math.min(failures-1,delays.length-1)] * (0.8+Math.random()*0.4));
    return { ...current, localError:code, networkFailures:failures, nextAttemptAt:retryAt,
      observation: code.startsWith("LOCAL_") ? current.observation : "unreachable",
      localWriteState: code.startsWith("LOCAL_") ? "error" : current.localWriteState,
      authorization: code === "AUTH_RECONNECT_REQUIRED" ? "reconnect_required" : current.authorization,
      protocolSupport: code === "PROTOCOL_UNSUPPORTED" || code === "CLIENT_UPDATE_REQUIRED" ? "client_update_required" : current.protocolSupport };
  });
  if (state.nextAttemptAt === null) await chrome.alarms.clear(`${SYNC_ALARM}-retry`);
  else await schedule(state.nextAttemptAt);
}

async function adopt(snapshot: DeviceSnapshot, fence: number, centralUserId?: string): Promise<LocalState> {
  return updateLocalState((current) => {
    if (current.localGeneration !== fence || current.deviceId !== snapshot.identity.deviceId) return current;
    const old = current.snapshot;
    if (old && snapshot.versions.generation < old.versions.generation) return current;
    if (old && snapshot.versions.generation === old.versions.generation &&
        (snapshot.versions.deviceRevision < old.versions.deviceRevision ||
         snapshot.versions.accountRevision < old.versions.accountRevision ||
         (snapshot.versions.bindingRevision !== null && old.versions.bindingRevision !== null &&
          snapshot.versions.bindingRevision < old.versions.bindingRevision))) return current;
    const tuple = tupleForSnapshot(snapshot);
    const invalidated = current.serverGeneration !== snapshot.versions.generation ||
      (old !== null && !sameTuple(tupleForSnapshot(old), tuple));
    const validReceipt = tuple !== null && sameTuple(current.receipt, tuple);
    const managedSwitch = hasManagedSwitch(current) && current.managedSwitch &&
      current.managedSwitch.generation === snapshot.versions.generation &&
      current.managedSwitch.bindingEpoch === snapshot.versions.bindingEpoch &&
      current.managedSwitch.credentialRevision === snapshot.versions.credentialRevision &&
      snapshot.authorization.state === "authorized" && snapshot.authorization.policy === "enabled"
      ? { ...current.managedSwitch, localGeneration: current.localGeneration + (invalidated ? 1 : 0) } : null;
    return { ...current, ...(centralUserId !== undefined ? { centralUserId } : {}), managedSwitch, snapshot, serverGeneration:snapshot.versions.generation,
      localGeneration: current.localGeneration + (invalidated ? 1 : 0),
      authorization:snapshot.authorization.state, observation:snapshot.observation,
      lastConfirmedAt:Date.now(), networkFailures:0, nextAttemptAt:null, localError:null,
      receipt:validReceipt ? current.receipt : null, pendingAck:validReceipt && current.pendingAck,
      appliedVersion:validReceipt ? current.appliedVersion : null,
      localWriteState: invalidated && current.localWriteState === "ready" ? "idle" : current.localWriteState };
  });
}

async function ackCurrent(local: LocalState): Promise<void> {
  if (!local.receipt) return;
  const receipt = local.receipt;
  const ack = await api.acknowledge(receipt);
  const after = await readLocalState();
  if (after.localGeneration !== local.localGeneration || !sameTuple(after.receipt,receipt)) return;
  if (ack.exportId !== receipt.exportId || ack.reportEpoch !== after.reportEpoch || ack.clientReportSeq !== after.clientReportSeq) {
    throw new api.ApiFailure("CONTRACT_INVALID");
  }
  if (!ack.accepted || !sameTuple(ack.acceptedTuple,receipt)) {
    await updateLocalState((state) => ({ ...state, receipt:null, pendingAck:false, appliedVersion:null, localWriteState:"idle" }));
    await schedule(Date.now()+30_000);
    return;
  }
  await adopt(ack.snapshot, local.localGeneration);
  await updateLocalState((state) => sameTuple(state.receipt,receipt) ? { ...state,pendingAck:false } : state);
}

async function runSyncInner(reason: SyncReason): Promise<SyncRunResult> {
  let local = await readLocalState();
  if (!local.deviceId || local.authorization === "authorizing" || local.authorization === "revoked" || local.authorization === "reconnect_required") {
    return { outcome: "success", noOp: true };
  }
  if (reason === "alarm" && local.nextAttemptAt !== null && Date.now() < local.nextAttemptAt) {
    return { outcome: "success", noOp: true };
  }
  if (local.managedSwitch && !hasManagedSwitch(local)) {
    local = await updateLocalState(state => state.managedSwitch?.id === local.managedSwitch?.id
      ? { ...state, managedSwitch: null, localWriteState: state.localWriteState === "idle" ? "foreign_session" : state.localWriteState } : state);
  }
  const fence = local.localGeneration;
  let activeApply: { envelope: ExportEnvelope; startedAt: number } | null = null;
  try {
    if (reason === "startup" || local.protocolSupport !== "supported" || !local.snapshot) {
      const capabilities = await api.capabilities();
      if (!capabilities.supportedProtocolVersions.includes(3) || !capabilities.features.reconcile || !capabilities.features.receipts) {
        await updateLocalState((state) => ({ ...state,protocolSupport:"service_upgrading",observation:"stale" }));
        await schedule(Date.now()+60_000);
        return { outcome: "partial" };
      }
      await updateLocalState((state) => ({ ...state,protocolSupport:"supported" }));
    }
    let currentCookiesVerified = false;
    let locallyChangedCookies = false;
    let locallyOwnedTgc = false;
    if (local.receipt) {
      const cookieState = await inspectManagedCookies();
      currentCookiesVerified = cookieState === "verified";
      locallyChangedCookies = cookieState === "changed";
      const tgcState = currentCookiesVerified ? "managed" : await inspectLocalTgc();
      const tgcMissing = tgcState === "missing";
      locallyOwnedTgc = tgcState === "managed";
      local = await updateLocalState((state) => {
        if (state.localGeneration !== fence) return state;
        return currentCookiesVerified && state.receipt
          ? { ...state,receipt:{ ...state.receipt,verifiedAt:Date.now() } }
          : { ...state,receipt:locallyChangedCookies && locallyOwnedTgc && state.receipt
              ? { ...state.receipt,result:"foreign",verifiedAt:null } : null,
            pendingAck:false,appliedVersion:null,localWriteState:"idle",
            loginRecovery: state.loginRecovery && sameTuple(state.loginRecovery.rejectedTuple, state.receipt)
              ? { ...state.loginRecovery, rejectedTuple:tgcMissing ? null : state.loginRecovery.rejectedTuple, appliedExportId:null } : state.loginRecovery };
      });
    }
    const result = await api.reconcile();
    if ((await readLocalState()).localGeneration !== fence) return { outcome: "canceled" };
    local = await adopt(result.snapshot,fence,result.centralUserId);
    if (local.snapshot !== null && local.snapshot.snapshotId !== result.snapshot.snapshotId) {
      return { outcome: "canceled" };
    }
    const ack = result.receiptAck;
    if (ack && local.receipt && ack.exportId === local.receipt.exportId &&
        ack.reportEpoch === local.reportEpoch && ack.clientReportSeq === local.clientReportSeq) {
      if (ack.accepted && !sameTuple(ack.acceptedTuple,local.receipt)) throw new api.ApiFailure("CONTRACT_INVALID");
      local = await updateLocalState((state) => {
        if (state.localGeneration !== local.localGeneration || state.receipt?.exportId !== ack.exportId) return state;
        return ack.accepted ? { ...state,pendingAck:false }
          : { ...state,receipt:null,pendingAck:false,appliedVersion:null,localWriteState:"idle" };
      });
    }
    let remote = local.snapshot;
    if (!remote) return { outcome: "success", noOp: true };
    if (local.pendingCommand) {
      const command = local.pendingCommand;
      const update = await api.operate("set_enabled",remote,command.id,command.enabled);
      local = await adopt(update.snapshot,local.localGeneration);
      local = await updateLocalState((state) => state.pendingCommand?.id === command.id
        ? { ...state,pendingCommand:null,pendingOperation:null } : state);
      remote = local.snapshot!;
    }
    if (remote.authorization.state === "revoked") throw new api.ApiFailure("DEVICE_REVOKED");
    if (remote.authorization.policy !== "enabled" || !local.enabledIntent) {
      await clearOwnedCookies();
      await updateLocalState((state) => ({ ...state,receipt:null,pendingAck:false,localWriteState:"idle" }));
      return { outcome: "success", noOp: true };
    }
    if (local.manualOverride || remote.observation !== "fresh" || remote.freshUntil <= Date.now()) {
      return { outcome: "success", noOp: true };
    }
    if (local.localWriteState === "foreign_session" && !hasManagedSwitch(local)) {
      return { outcome: "needs_input" };
    }
    const rejectedHere = local.schoolAccess === "login_form_seen" && !!local.loginRecovery && !local.loginRecovery.failed;
    const rejectedCurrent = (currentCookiesVerified || (locallyOwnedTgc && local.receipt?.result === "foreign")) &&
      sameTuple(local.receipt, tupleForSnapshot(remote)) &&
      (!local.loginRecovery || sameTuple(local.loginRecovery.rejectedTuple, local.receipt));
    const userRecovery = !hasManagedSwitch(local) && (((reason === "login_form" || rejectedHere) && rejectedCurrent) ||
      (reason === "user_retry" && (remote.cloud.state !== "ready" || local.schoolAccess === "login_form_seen")));
    const waiting = remote.cloud.retryAt !== null && Date.now() < remote.cloud.retryAt;
    if ((userRecovery && remote.capabilities.canRetry && !waiting) ||
        (!remote.capabilities.canExport && remote.capabilities.canEnsure && !waiting &&
         (["absent","expired","blocked"].includes(remote.cloud.state) ||
          (remote.cloud.state === "queued" && remote.cloud.operationId === null)))) {
      if (!local.recovery || local.recovery.generation !== remote.versions.generation) {
        const versions = remote.versions;
        local = await updateLocalState((state) => ({ ...state,recovery:{ id:crypto.randomUUID(),
          generation:versions.generation,sessionVersion:versions.sessionVersion,phase:"downloading",
          downloadRetries:0,writeRetries:0,nextAttemptAt:null,navigatedTabId:null } }));
      }
      const response = await api.operate(userRecovery ? "retry_session" : "ensure_session",remote,
        `${remote.identity.deviceId}:${remote.versions.generation}:${remote.versions.bindingEpoch}:${local.loginRecovery?.id ?? local.recovery!.id}`);
      local = await adopt(response.snapshot,local.localGeneration);
      if (userRecovery && local.receipt?.result === "foreign") {
        local = await updateLocalState(state => state.localGeneration === local.localGeneration
          ? { ...state, receipt: null } : state);
      }
      remote = local.snapshot!;
    }
    if (!remote.capabilities.canExport || remote.cloud.state !== "ready") {
      await schedule(remote.presentation.nextCheckAt ?? Date.now()+PREPARING_SYNC_DELAY_MS);
      return { outcome: "partial" };
    }
    // A local rotation is not a missing Cookie. Do not reapply the same cloud
    // session over it during a routine poll. A school recovery must still be
    // able to install its genuinely new session, or the user can switch once.
    if (locallyChangedCookies && locallyOwnedTgc && local.receipt?.result === "foreign" &&
        sameTuple(local.receipt, tupleForSnapshot(remote)) &&
        !hasManagedSwitch(local) && !rejectedHere) {
      return { outcome: "needs_input" };
    }
    if (local.receipt && sameTuple(local.receipt,tupleForSnapshot(remote)) && local.localWriteState === "ready") {
      if (local.pendingAck) await ackCurrent(local);
      if (local.schoolAccess === "login_form_seen") await schedule(remote.presentation.nextCheckAt ?? Date.now()+PREPARING_SYNC_DELAY_MS);
      return { outcome: "success", noOp: true };
    }
    const generationFence = local.localGeneration;
    const round: RecoveryRound = { id:crypto.randomUUID(),generation:remote.versions.generation,
      sessionVersion:remote.versions.sessionVersion,phase:"downloading",downloadRetries:0,writeRetries:0,
      nextAttemptAt:null,navigatedTabId:null };
    await updateLocalState((state) => ({ ...state,recovery:round }));
    const envelope = await api.exportSession(remote);
    if (!sameTuple(envelope,tupleForSnapshot(remote)) || envelope.deviceId !== local.deviceId) throw new api.ApiFailure("SESSION_CHANGED");
    if (envelope.applyBefore <= Date.now()) throw new api.ApiFailure("STALE_SNAPSHOT");
    if ((await readLocalState()).localGeneration !== generationFence) return { outcome: "canceled" };
    await updateLocalState((state) => ({ ...state,localWriteState:"writing" }));
    activeApply = {
      envelope,
      startedAt: Date.now(),
    };
    const applied = await writer(envelope,{ localGeneration:generationFence,
      allowForeignOnce:hasManagedSwitch(await readLocalState()) });
    const applyTelemetry = activeApply;
    activeApply = null;
    if (applied === "cancelled") {
      await updateLocalState((state) => state.localWriteState === "writing" ? { ...state,localWriteState:"idle" } : state);
      captureQuickloginOperation("cookie_apply", {
        outcome: "canceled",
        trigger: telemetryTrigger(reason),
        durationMs: durationFrom(applyTelemetry.startedAt),
        operationId: applyTelemetry.envelope.exportId,
      });
      return { outcome: "canceled", suppressSyncEvent: true };
    }
    if (applied === "foreign_session") {
      await updateLocalState((state) => ({ ...state,managedSwitch:null,localWriteState:"foreign_session",receipt:null,pendingAck:false }));
      captureQuickloginOperation("cookie_apply", {
        outcome: "needs_input",
        trigger: telemetryTrigger(reason),
        durationMs: durationFrom(applyTelemetry.startedAt),
        operationId: applyTelemetry.envelope.exportId,
      });
      return { outcome: "needs_input", suppressSyncEvent: true };
    }
    captureQuickloginOperation("cookie_apply", {
      outcome: "success",
      trigger: telemetryTrigger(reason),
      durationMs: durationFrom(applyTelemetry.startedAt),
      operationId: applyTelemetry.envelope.exportId,
      verification: "unverified",
    });
    local = await updateLocalState((state) => {
      if (state.localGeneration !== generationFence || !state.enabledIntent || state.manualOverride) return state;
      const recovered = !state.loginRecovery || (!state.loginRecovery.failed && !sameTuple(state.loginRecovery.rejectedTuple, envelope));
      return { ...state,managedSwitch:null,receipt:{ deviceId:envelope.deviceId,generation:envelope.generation,
        bindingEpoch:envelope.bindingEpoch,credentialRevision:envelope.credentialRevision,
        sessionVersion:envelope.sessionVersion,exportId:envelope.exportId,result:"applied",verifiedAt:Date.now() },
        pendingAck:true,appliedVersion:envelope.sessionVersion,localWriteState:"ready",
        schoolAccess:recovered ? "unverified" : state.schoolAccess,
        loginRecovery:state.loginRecovery && recovered ? { ...state.loginRecovery,appliedExportId:envelope.exportId } : state.loginRecovery,
        recovery:{ ...round,phase:"finished" } };
    });
    if (local.localGeneration === generationFence) await ackCurrent(local);
    return { outcome: "success", suppressSyncEvent: true };
  } catch (error) {
    const current=await readLocalState();
    if (current.deviceId !== local.deviceId || current.localGeneration !== local.localGeneration ||
        current.authGeneration !== local.authGeneration || current.authorization === "authorizing") {
      return { outcome: "canceled" };
    }
    await recordFailure(error);
    if (activeApply !== null) {
      captureQuickloginOperation("cookie_apply", {
        outcome: "failure",
        trigger: telemetryTrigger(reason),
        durationMs: durationFrom(activeApply.startedAt),
        operationId: activeApply.envelope.exportId,
        errorCode: telemetryErrorCode(error),
      });
      return { outcome: "failure", suppressSyncEvent: true };
    }
    throw error;
  }
}

async function runSync(reason: SyncReason): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await runSyncInner(reason);
    if (result.suppressSyncEvent) return;
    captureQuickloginOperation("sync", {
      outcome: result.outcome,
      trigger: telemetryTrigger(reason),
      durationMs: durationFrom(startedAt),
      ...(result.noOp ? { noOp: true } : {}),
    });
  } catch (error) {
    captureQuickloginOperation("sync", {
      outcome: "failure",
      trigger: telemetryTrigger(reason),
      durationMs: durationFrom(startedAt),
      errorCode: telemetryErrorCode(error),
    });
  }
}

export function sync(reason: SyncReason): Promise<void> {
  if (syncFlight) {
    if (reason === "user_retry" || reason === "enable" || reason === "login_form") pendingReasons.add(reason);
    return syncFlight;
  }
  syncFlight = (async () => {
    await runSync(reason);
    while (pendingReasons.size) {
      const next = pendingReasons.values().next().value!;
      pendingReasons.delete(next); await runSync(next);
    }
  })().finally(() => { syncFlight=null; });
  return syncFlight;
}

export async function setEnabled(enabled: boolean,expectedConnectIntentId?:string): Promise<boolean> {
  let accepted=false;
  const local = await updateLocalState((state) => {
    if (expectedConnectIntentId !== undefined && state.connectIntentId !== expectedConnectIntentId) return state;
    accepted=true;
    return { ...state,enabledIntent:enabled,
    connectIntentId:null,managedSwitch:null,
    localGeneration:state.localGeneration+1,pendingCommand:{ id:crypto.randomUUID(),enabled },
    pendingOperation:enabled ? null : "disable",receipt:null,pendingAck:false,recovery:null,loginRecovery:null,
    localWriteState:"idle",localError:null };
  });
  if (!accepted) return false;
  if (!enabled) await clearOwnedCookies();
  if (local.deviceId) await sync("enable");
  return true;
}
export async function enterManualMode(): Promise<void> {
  await updateLocalState((state) => ({ ...state,manualOverride:true,localGeneration:state.localGeneration+1,
    connectIntentId:null,managedSwitch:null,loginRecovery:null,
    receipt:null,pendingAck:false,recovery:state.recovery ? { ...state.recovery,phase:"manual_required" } : null }));
  void sync("popup");
}
export async function prepareAutomaticMode(): Promise<void> {
  await updateLocalState((state) => ({ ...state,manualOverride:false,recovery:null,loginRecovery:null,localError:null,nextAttemptAt:null }));
}
export async function resumeAutomaticMode(): Promise<boolean> {
  await prepareAutomaticMode();
  await sync("user_retry");
  return true;
}
export async function retryAutomaticNow(): Promise<boolean> {
  const state=await updateLocalState((current) => ({ ...current,nextAttemptAt:null,localError:null,
    ...(current.loginRecovery?.failed && !current.manualOverride ? {recovery:null,loginRecovery:{
      ...current.loginRecovery,id:crypto.randomUUID(),failed:false,appliedExportId:null,rejectedTuple:current.receipt,
      pages:current.loginRecovery.pages.map(page=>({...page,navigated:false})),
    }} : {}) }));
  if (!state.manualOverride) {
    await sync("user_retry");
    return true;
  }
  return false;
}
export async function switchToManagedOnce(): Promise<boolean> {
  let accepted = false;
  await updateLocalState(state => {
    const versions = state.snapshot?.versions;
    if (!state.deviceId || !versions || versions.bindingEpoch === null || versions.credentialRevision === null ||
        !state.enabledIntent || state.manualOverride || state.authorization !== "authorized") return state;
    accepted = true;
    return { ...state, managedSwitch: { id:crypto.randomUUID(), deviceId:state.deviceId,
      authGeneration:state.authGeneration, localGeneration:state.localGeneration, generation:versions.generation,
      bindingEpoch:versions.bindingEpoch, credentialRevision:versions.credentialRevision, expiresAt:Date.now()+15*60_000 },
      localError:null, nextAttemptAt:null, localWriteState:"idle" };
  });
  if (!accepted) return false;
  await sync("user_retry");
  return true;
}
