export type ExtensionUpdateStatus = chrome.runtime.RequestUpdateCheckResult["status"] | "failed" | "manual_update";

const LAST_CHECK_KEY = "quicklogin.updateCheckAt";
const CHECK_INTERVAL_MS = 5 * 60_000;
let activities = 0;
let updateReady = false;
let reloading = false;
let checkFlight: Promise<ExtensionUpdateStatus> | null = null;

function applyWhenReady(): void {
  if (!updateReady || activities > 0 || reloading) return;
  reloading = true;
  chrome.runtime.reload();
}

// Detached authorization and cookie operations must finish before reloading the worker.
export async function withUpdateGuard<T>(operation: () => Promise<T>): Promise<T> {
  activities++;
  try {
    return await operation();
  } finally {
    activities--;
    applyWhenReady();
  }
}

export function applyAvailableUpdate(): void {
  updateReady = true;
  applyWhenReady();
}

export function checkForExtensionUpdate(): Promise<ExtensionUpdateStatus> {
  if (checkFlight) return checkFlight;
  checkFlight = withUpdateGuard(async (): Promise<ExtensionUpdateStatus> => {
    if (!chrome.runtime.getManifest().update_url) return "manual_update";
    try {
      const stored = await chrome.storage.session.get(LAST_CHECK_KEY);
      const lastCheck = stored[LAST_CHECK_KEY];
      const now = Date.now();
      if (typeof lastCheck === "number" && now >= lastCheck && now - lastCheck < CHECK_INTERVAL_MS) return "throttled";
      await chrome.storage.session.set({ [LAST_CHECK_KEY]: now });
      const result = await chrome.runtime.requestUpdateCheck();
      if (result.status === "update_available") applyAvailableUpdate();
      return result.status;
    } catch {
      return "failed";
    }
  }).finally(() => { checkFlight = null; });
  return checkFlight;
}
