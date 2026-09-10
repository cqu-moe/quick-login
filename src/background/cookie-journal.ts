import type { ManagedCookie } from "../shared/contracts";

export const JOURNAL_KEY = "quicklogin.cookieJournal";
export const SNAPSHOT_KEY = "quicklogin.cookieSnapshots";

export interface CookieJournalEntry extends ManagedCookie {
  previousDigest: string | null;
  expectedDigest: string;
  completed: boolean;
}

export interface CookieJournal {
  id: string;
  localGeneration: number;
  serverGeneration: number;
  sessionVersion: number;
  phase: "writing" | "committed";
  entries: CookieJournalEntry[];
}

export type CookieSnapshots = Record<string, chrome.cookies.Cookie | null>;

export function snapshotId(entry: Pick<ManagedCookie, "name" | "domain" | "path" | "storeId">): string {
  return `${entry.storeId}\0${entry.domain}\0${entry.path}\0${entry.name}`;
}

export async function writeJournal(
  journal: CookieJournal,
  snapshots: CookieSnapshots
): Promise<void> {
  await chrome.storage.local.set({ [JOURNAL_KEY]: journal });
  await chrome.storage.session.set({ [SNAPSHOT_KEY]: snapshots });
}

export async function clearJournal(): Promise<void> {
  await chrome.storage.local.remove(JOURNAL_KEY);
  await chrome.storage.session.remove(SNAPSHOT_KEY);
}
