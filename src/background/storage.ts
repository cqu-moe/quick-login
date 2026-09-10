import type { LocalState } from "../shared/contracts";

const STATE_KEY = "quicklogin.state";

export const initialLocalState = (): LocalState => ({
  schemaVersion: 1,
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

let queue = Promise.resolve();

function migrate(value: unknown): LocalState {
  if (!value || typeof value !== "object") return initialLocalState();
  const candidate = value as Partial<LocalState> & { schemaVersion?: number };
  if ((candidate.schemaVersion ?? 0) > 1) {
    throw new Error("QUICKLOGIN_UPDATE_REQUIRED");
  }
  const base = initialLocalState();
  return {
    ...base,
    ...candidate,
    schemaVersion: 1,
    deviceId: typeof candidate.deviceId === "string" ? candidate.deviceId : null,
    localGeneration: Number.isSafeInteger(candidate.localGeneration)
      ? candidate.localGeneration! : 0,
    managed: Array.isArray(candidate.managed) ? candidate.managed : [],
  };
}

export async function readLocalState(): Promise<LocalState> {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return migrate(stored[STATE_KEY]);
}

export function updateLocalState(
  reducer: (state: LocalState) => LocalState
): Promise<LocalState> {
  const task = queue.then(async () => {
    const current = await readLocalState();
    const next = reducer(structuredClone(current));
    if (next.schemaVersion !== 1) throw new Error("INVALID_LOCAL_SCHEMA");
    await chrome.storage.local.set({ [STATE_KEY]: next });
    return next;
  });
  queue = task.then(() => undefined, () => undefined);
  return task;
}

export async function configureTrustedStorage(): Promise<void> {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}
