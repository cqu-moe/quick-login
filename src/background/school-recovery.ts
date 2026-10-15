import type { LocalState } from "../shared/contracts";
import { sameTuple, tupleForSnapshot } from "../shared/protocol-v3.generated";
import { readLocalState, updateLocalState } from "./storage";
import { verifyRecoveryCookies } from "./cookie-store";

export interface SchoolPage { tabId: number; documentId: string | null }

// Leaving SSO ends this page's attempt; it is not proof of a business-site login.
export async function forgetSchoolPage(tabId: number): Promise<void> {
  const before = await readLocalState();
  if (!before.loginRecovery?.pages.some(page => page.tabId === tabId)) return;
  await updateLocalState(state => {
    if (state.loginRecovery?.id !== before.loginRecovery?.id) return state;
    const pages = state.loginRecovery!.pages.filter(page => page.tabId !== tabId);
    return {...state,loginRecovery:pages.length ? {...state.loginRecovery!,pages} : null};
  });
}

export async function onSchoolTabUpdated(
  tabId: number, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab
): Promise<void> {
  if (change.status !== "complete") return;
  // Our SSO host permission exposes its URL without the broad tabs permission.
  // URLs on other hosts can be omitted; no URL is stored or interpreted as success.
  if (tab.url?.startsWith("https://sso.cqu.edu.cn/")) return;
  await forgetSchoolPage(tabId);
}

export function notifySchoolPages(before: LocalState | undefined, after: LocalState | undefined): void {
  const pages = [...(before?.loginRecovery?.pages ?? []), ...(after?.loginRecovery?.pages ?? [])];
  const sent = new Set<string>();
  for (const page of pages) {
    const key = `${page.tabId}:${page.documentId}`;
    if (sent.has(key)) continue;
    sent.add(key);
    // Storage stays restricted to trusted extension contexts. Only announce a change.
    void chrome.tabs.sendMessage(page.tabId, { type:"QUICKLOGIN_STATE_CHANGED" },
      page.documentId ? { documentId:page.documentId } : { frameId:0 }).catch(() => {
      // The document may have navigated away or the tab may have closed.
    });
  }
}

export async function observeSchoolLogin(page: SchoolPage): Promise<void> {
  await updateLocalState(state => {
    if (!state.deviceId || !state.enabledIntent || state.manualOverride || state.authorization !== "authorized") return state;
    const round = state.loginRecovery;
    const previous = round?.pages.find(item => item.tabId === page.tabId);
    if (previous?.documentId === page.documentId) return state;
    if (previous?.navigated) {
      return { ...state, schoolAccess: "login_form_seen",
        loginRecovery: { ...round!, failed: true, appliedExportId: null,
          pages:round!.pages.map(item=>item === previous ? {...page,navigated:false} : item) } };
    }
    const pages = [...(round?.pages ?? []).filter(item => item.tabId !== page.tabId), { ...page, navigated: false }].slice(-32);
    if (round && !round.appliedExportId && !round.failed) {
      return { ...state, schoolAccess: "login_form_seen", loginRecovery: { ...round, pages } };
    }
    return { ...state, schoolAccess: "login_form_seen", recovery: null,
      loginRecovery: { id: crypto.randomUUID(), rejectedTuple: state.receipt, appliedExportId: null,
        failed: false, pages: [{ ...page, navigated: false }] } };
  });
}

function canNavigate(state: LocalState): boolean {
  const round = state.loginRecovery;
  return !!round && !round.failed && !!round.appliedExportId &&
    round.acknowledgedExportId === round.appliedExportId &&
    state.enabledIntent && !state.manualOverride && state.authorization === "authorized" &&
    state.schoolAccess !== "login_form_seen" && !state.pendingAck &&
    ((state.localWriteState === "ready" && state.receipt?.result === "applied") ||
      (state.localWriteState === "idle" && state.receipt?.result === "foreign")) &&
    state.receipt?.exportId === round.appliedExportId && state.snapshot !== null &&
    state.snapshot.authorization.policy === "enabled" && state.snapshot.observation === "fresh" &&
    state.snapshot.cloud.state === "ready" &&
    state.observation === "fresh" && state.snapshot.freshUntil > Date.now() &&
    sameTuple(state.receipt, tupleForSnapshot(state.snapshot));
}

// Only documents that waited for this write may consume its acknowledged result.
export async function navigateRecoveredPage(page: SchoolPage, url: string): Promise<boolean> {
  const before = await readLocalState();
  const target = before.loginRecovery?.pages.find(item => item.tabId === page.tabId && item.documentId === page.documentId);
  if (!target || before.loginRecovery?.failed || before.manualOverride || !before.enabledIntent) return false;
  if (target.navigated) return canNavigate(before);
  if (!canNavigate(before) || !await verifyRecoveryCookies(before.managed)) return false;
  let accepted = false;
  await updateLocalState(state => {
    if (state.authGeneration !== before.authGeneration || state.localGeneration !== before.localGeneration || state.loginRecovery?.id !== before.loginRecovery?.id ||
        !canNavigate(state) || state.receipt?.exportId !== before.receipt?.exportId) return state;
    const current = state.loginRecovery!.pages.find(item => item.tabId === page.tabId && item.documentId === page.documentId);
    if (!current || current.navigated) return state;
    accepted = true;
    return { ...state, loginRecovery: { ...state.loginRecovery!, pages: state.loginRecovery!.pages.map(item =>
      item === current ? { ...item, navigated: true } : item) } };
  });
  if (!accepted) return false;
  const after = await readLocalState();
  if (after.authGeneration !== before.authGeneration || after.localGeneration !== before.localGeneration || after.loginRecovery?.id !== before.loginRecovery?.id ||
      after.receipt?.exportId !== before.receipt?.exportId || !canNavigate(after)) return false;
  await chrome.tabs.update(page.tabId, { url });
  return true;
}
