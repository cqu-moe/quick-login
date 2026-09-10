import type { CookieEnvelope, ErrorCode, LocalState, RecoveryRound } from "../shared/contracts";
import { SYNC_ALARM } from "../shared/config";
import * as api from "./api";
import { clearDeviceAuthorization } from "./auth";
import { readLocalState, updateLocalState } from "./storage";
import { responseError, retryBounded, SyncError } from "./retry";

export type SyncReason = "alarm" | "startup" | "network" | "enable" | "login_form" | "user_retry";
export type EnvelopeWriter = (
  envelope: CookieEnvelope,
  options: { localGeneration: number; allowForeignOnce: boolean }
) => Promise<"applied" | "foreign_session" | "cancelled">;

let writer: EnvelopeWriter = async () => {
  throw new SyncError("COOKIE_WRITE_TRANSIENT");
};
let syncFlight: Promise<void> | null = null;

export function setEnvelopeWriter(next: EnvelopeWriter): void {
  writer = next;
}

function browserVersion(): string {
  return navigator.userAgent.match(/Chrome\/(\d+(?:\.\d+)*)/)?.[1] ?? "unknown";
}

async function rememberWait(nextAttemptAt: number): Promise<void> {
  await updateLocalState((state) => ({
    ...state,
    recovery: state.recovery ? { ...state.recovery, nextAttemptAt } : null,
  }));
  chrome.alarms.create(`${SYNC_ALARM}-retry`, { when: nextAttemptAt });
}

async function requestEnvelope(generation: number, sessionVersion: number) {
  return retryBounded(async () => {
    try {
      return await api.exportCookies(generation, sessionVersion);
    } catch (error) {
      if (error instanceof Response) throw await responseError(error);
      throw error;
    }
  }, rememberWait);
}

async function runSync(reason: SyncReason): Promise<void> {
  let local = await readLocalState();
  if (!local.deviceId) return;
  if (local.recovery?.nextAttemptAt && Date.now() < local.recovery.nextAttemptAt) return;

  if (local.pendingOperation === "disable") {
    try {
      await api.setDeviceEnabled(false);
      local = await updateLocalState((state) => ({ ...state, pendingOperation: null }));
    } catch {
      return;
    }
  }

  let remote;
  try {
    remote = await api.status({
      protocolVersion: 1,
      generation: local.serverGeneration ?? 0,
      appliedVersion: local.appliedVersion,
      browserVersion: browserVersion(),
    });
  } catch (error) {
    if (error instanceof Response) {
      const parsed = await responseError(error);
      if (parsed.code === "DEVICE_REVOKED") {
        await updateLocalState((state) => ({
          ...state,
          localGeneration: state.localGeneration + 1,
          enabledIntent: false,
          status: state.status ? { ...state.status, state: "revoked", enabled: false } : null,
          lastError: "DEVICE_REVOKED",
        }));
        await clearDeviceAuthorization();
        return;
      }
      await updateLocalState((state) => ({ ...state, lastError: parsed.code as ErrorCode }));
    }
    return;
  }

  local = await updateLocalState((state) => ({
    ...state,
    status: remote,
    serverGeneration: remote.generation,
    lastError: null,
  }));
  if (!remote.masterEnabled || !remote.enabled || local.manualOverride) return;
  if (remote.state !== "ready") return;
  if (local.appliedVersion === remote.sessionVersion && reason !== "login_form") return;

  const round: RecoveryRound = local.recovery?.generation === remote.generation
    ? local.recovery
    : {
        id: crypto.randomUUID(),
        generation: remote.generation,
        sessionVersion: remote.sessionVersion,
        phase: "downloading",
        downloadRetries: 0,
        writeRetries: 0,
        nextAttemptAt: null,
        navigatedTabId: null,
      };
  local = await updateLocalState((state) => ({ ...state, recovery: round }));
  const generationFence = local.localGeneration;

  try {
    const envelope = await requestEnvelope(remote.generation, remote.sessionVersion);
    if ((await readLocalState()).localGeneration !== generationFence) return;
    await updateLocalState((state) => ({
      ...state,
      recovery: state.recovery ? { ...state.recovery, phase: "writing", nextAttemptAt: null } : null,
      localWriteState: "writing",
    }));
    const result = await retryBounded(
      () => writer(envelope, { localGeneration: generationFence, allowForeignOnce: false }),
      rememberWait
    );
    if (result === "applied") {
      await updateLocalState((state) => ({
        ...state,
        appliedVersion: envelope.sessionVersion,
        localWriteState: "ready",
        recovery: state.recovery ? { ...state.recovery, phase: "finished", nextAttemptAt: null } : null,
      }));
    } else if (result === "foreign_session") {
      await updateLocalState((state) => ({ ...state, localWriteState: "idle" }));
    }
  } catch (error) {
    const code = error instanceof SyncError &&
      error.code !== "COOKIE_WRITE_TRANSIENT" && error.code !== "COOKIE_PERMISSION_DENIED"
      ? error.code : "TEMPORARY_UNAVAILABLE";
    await updateLocalState((state) => ({ ...state, localWriteState: "error", lastError: code }));
  }
}

export function sync(reason: SyncReason): Promise<void> {
  if (syncFlight) return syncFlight;
  syncFlight = runSync(reason).finally(() => { syncFlight = null; });
  return syncFlight;
}

export async function setEnabled(enabled: boolean): Promise<void> {
  if (!enabled) {
    await updateLocalState((state) => ({
      ...state,
      enabledIntent: false,
      localGeneration: state.localGeneration + 1,
      pendingOperation: "disable",
      recovery: null,
    }));
    try {
      const status = await api.setDeviceEnabled(false);
      await updateLocalState((state) => ({ ...state, status, pendingOperation: null }));
    } catch {
      return;
    }
    return;
  }
  const status = await api.setDeviceEnabled(true);
  await updateLocalState((state) => ({
    ...state,
    enabledIntent: true,
    serverGeneration: status.generation,
    status,
    lastError: null,
  }));
  await sync("enable");
}

export async function enterManualMode(): Promise<void> {
  await updateLocalState((state) => ({
    ...state,
    manualOverride: true,
    localGeneration: state.localGeneration + 1,
    recovery: state.recovery ? { ...state.recovery, phase: "manual_required" } : null,
  }));
}

export async function resumeAutomaticMode(): Promise<void> {
  await updateLocalState((state) => ({
    ...state,
    manualOverride: false,
    recovery: null,
    lastError: null,
  }));
  await sync("user_retry");
}

export async function markManualRequired(): Promise<void> {
  await updateLocalState((state) => ({
    ...state,
    recovery: state.recovery ? { ...state.recovery, phase: "manual_required" } : null,
  }));
}
