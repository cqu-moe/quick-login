import type { LocalState } from "../shared/contracts";

export const LOCAL_STATE_KEY = "quicklogin.state.v2";
export const LEGACY_STATE_KEY = "quicklogin.state";
const SCHEMA_KEY = "quicklogin.activeSchema";

export const initialLocalState = (): LocalState => ({
  schemaVersion: 2,
  authGeneration: 0,
  connectIntentId: null,
  installationId: crypto.randomUUID(),
  registrationId: crypto.randomUUID(),
  reportEpoch: crypto.randomUUID(),
  clientReportSeq: 0,
  snapshot: null,
  receipt: null,
  pendingAck: false,
  authorization: "disconnected",
  observation: "checking",
  protocolSupport: "supported",
  lastConfirmedAt: null,
  nextAttemptAt: null,
  localError: null,
  schoolAccess: "unverified",
  networkFailures: 0,
  pendingCommand: null,
  deviceId: null,
  localGeneration: 0,
  serverGeneration: null,
  enabledIntent: false,
  manualOverride: false,
  appliedVersion: null,
  managed: [],
  recovery: null,
  status: null,
  localWriteState: "idle",
  lastError: null,
  pendingOperation: null,
});

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const task = queue.then(operation);
  queue = task.then(() => undefined, () => undefined);
  return task;
}

async function load(): Promise<LocalState> {
  const stored = await chrome.storage.local.get([LOCAL_STATE_KEY, LEGACY_STATE_KEY, SCHEMA_KEY]);
  if (typeof stored[SCHEMA_KEY] === "number" && stored[SCHEMA_KEY] > 2) throw new Error("QUICKLOGIN_UPDATE_REQUIRED");
  const current = stored[LOCAL_STATE_KEY] as Partial<LocalState> | undefined;
  if (current !== undefined) {
    if (current.schemaVersion !== 2) throw new Error("QUICKLOGIN_UPDATE_REQUIRED");
    if (!Number.isSafeInteger(current.localGeneration) || typeof current.installationId !== "string" ||
        typeof current.reportEpoch !== "string" || !Array.isArray(current.managed)) throw new Error("INVALID_LOCAL_STATE");
    return structuredClone(current) as LocalState;
  }
  const legacy = stored[LEGACY_STATE_KEY] as (Partial<Omit<LocalState, "schemaVersion">> & { schemaVersion?: number }) | undefined;
  if (legacy?.schemaVersion !== undefined && legacy.schemaVersion > 1) throw new Error("QUICKLOGIN_UPDATE_REQUIRED");
  const next = initialLocalState();
  if (legacy) {
    next.deviceId = typeof legacy.deviceId === "string" ? legacy.deviceId : null;
    next.localGeneration = Number.isSafeInteger(legacy.localGeneration) ? legacy.localGeneration! + 1 : 1;
    next.serverGeneration = Number.isSafeInteger(legacy.serverGeneration) ? legacy.serverGeneration! : null;
    next.enabledIntent = legacy.enabledIntent === true;
    next.manualOverride = legacy.manualOverride === true;
    next.managed = Array.isArray(legacy.managed) ? legacy.managed : [];
    next.authorization = next.deviceId ? "authorized" : "disconnected";
    if (legacy.pendingOperation === "disable") {
      next.pendingOperation = "disable";
      next.pendingCommand = { id: crypto.randomUUID(), enabled: false };
      next.enabledIntent = false;
    }
  }
  await chrome.storage.local.set({ [LOCAL_STATE_KEY]: next, [SCHEMA_KEY]: 2 });
  return structuredClone(next);
}

export function readLocalState(): Promise<LocalState> {
  return enqueue(load);
}

export function updateLocalState(reducer: (state: LocalState) => LocalState): Promise<LocalState> {
  return updateLocalStateWith({}, reducer);
}

export function updateLocalStateWith(
  items: Record<string, unknown>,
  reducer: (state: LocalState) => LocalState
): Promise<LocalState> {
  return enqueue(async () => {
    const next = reducer(await load());
    if (next.schemaVersion !== 2) throw new Error("INVALID_LOCAL_SCHEMA");
    await chrome.storage.local.set({ ...items, [LOCAL_STATE_KEY]: next, [SCHEMA_KEY]: 2 });
    return next;
  });
}

export async function configureTrustedStorage(): Promise<void> {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}
