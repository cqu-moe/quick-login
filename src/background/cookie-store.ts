import type { CookieEnvelope, ExportedCookie, ManagedCookie } from "../shared/contracts";
import { validateCookieEnvelope } from "../shared/cookie-validation";
import { readLocalState, updateLocalState, updateLocalStateWith } from "./storage";
import { SyncError } from "./retry";
import { parseExportEnvelope, sameTuple, tupleForSnapshot, type ExportEnvelope } from "../shared/protocol-v3.generated";
import {
  clearJournal,
  JOURNAL_KEY,
  SNAPSHOT_KEY,
  snapshotId,
  writeJournal,
  type CookieJournal,
  type CookieSnapshots,
} from "./cookie-journal";

const SSO_URL = "https://sso.cqu.edu.cn";

async function digestCookie(cookie: Pick<chrome.cookies.Cookie,
  "name" | "value" | "domain" | "path" | "secure" | "httpOnly" | "sameSite" | "session" | "expirationDate">): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    session: cookie.session,
    expirationDate: cookie.expirationDate ?? null,
  }));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookieUrl(path: string): string {
  return `${SSO_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

async function normalStoreId(): Promise<string> {
  const stores = await chrome.cookies.getAllCookieStores();
  if (stores.length !== 1) throw new SyncError("COOKIE_PERMISSION_DENIED");
  return stores[0].id;
}

async function getExact(entry: Pick<ManagedCookie, "name" | "domain" | "path" | "storeId">) {
  const candidates = await chrome.cookies.getAll({
    url: cookieUrl(entry.path),
    name: entry.name,
    storeId: entry.storeId,
  });
  const exact = candidates.find((cookie) =>
    cookie.name === entry.name && cookie.domain === entry.domain &&
    cookie.path === entry.path && cookie.storeId === entry.storeId
  ) ?? null;
  if (exact) return exact;
  const single = await chrome.cookies.get({
    url: cookieUrl(entry.path),
    name: entry.name,
    storeId: entry.storeId,
  });
  return single && single.name === entry.name && single.domain === entry.domain &&
    single.path === entry.path && single.storeId === entry.storeId
    ? single
    : null;
}

function setDetails(cookie: ExportedCookie, storeId: string): chrome.cookies.SetDetails {
  return {
    url: cookieUrl(cookie.path),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite === "Strict" ? "strict" :
      cookie.sameSite === "Lax" ? "lax" : "no_restriction",
    storeId,
    ...(cookie.domain.startsWith(".") ? { domain: cookie.domain } : {}),
    ...(cookie.expires !== -1 ? { expirationDate: cookie.expires } : {}),
  };
}

function returnedCookieMatches(
  written: chrome.cookies.Cookie,
  source: ExportedCookie,
  storeId: string
): boolean {
  const sameSite = source.sameSite === "Strict" ? "strict" :
    source.sameSite === "Lax" ? "lax" : "no_restriction";
  const expectedSession = source.expires === -1;
  return written.name === source.name && written.value === source.value &&
    written.domain === source.domain && written.path === source.path &&
    written.storeId === storeId && written.secure === source.secure &&
    written.httpOnly === source.httpOnly && written.sameSite === sameSite &&
    written.session === expectedSession &&
    (expectedSession ||
      (typeof written.expirationDate === "number" &&
       Math.abs(written.expirationDate - source.expires) < 1));
}

async function remove(entry: Pick<ManagedCookie, "name" | "domain" | "path" | "storeId">): Promise<boolean> {
  const candidates = await chrome.cookies.getAll({
    url: cookieUrl(entry.path), name: entry.name, storeId: entry.storeId,
  });
  const matching = candidates.filter((cookie) =>
    (cookie.domain === "sso.cqu.edu.cn" || cookie.domain === ".sso.cqu.edu.cn") &&
    (entry.path === cookie.path || entry.path.startsWith(cookie.path.endsWith("/") ? cookie.path : `${cookie.path}/`))
  );
  if (matching.some((cookie) => cookie.domain !== entry.domain || cookie.path !== entry.path)) return false;
  await chrome.cookies.remove({
    url: cookieUrl(entry.path),
    name: entry.name,
    storeId: entry.storeId,
  });
  return await getExact(entry) === null;
}

async function restore(cookie: chrome.cookies.Cookie): Promise<void> {
  const restored = await chrome.cookies.set({
    url: cookieUrl(cookie.path),
    name: cookie.name,
    value: cookie.value,
    domain: cookie.hostOnly ? undefined : cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    storeId: cookie.storeId,
    expirationDate: cookie.session ? undefined : cookie.expirationDate,
  });
  if (!restored) throw new SyncError("COOKIE_PERMISSION_DENIED");
}

type RollbackResult = "restored" | "discarded" | "incomplete";

async function rollback(journal: CookieJournal, snapshots: CookieSnapshots | null): Promise<RollbackResult> {
  let complete = true;
  let discarded = false;
  for (const entry of [...journal.entries].reverse()) {
    const state = await readLocalState();
    const rollbackAuthorized = state.enabledIntent && state.localGeneration === journal.localGeneration;
    const current = await getExact(entry);
    const currentDigest = current ? await digestCookie(current) : null;
    if (!rollbackAuthorized) {
      discarded = true;
      // A disable/revoke can commit while applyEnvelope holds the write lock. Remove
      // only the exact value this journal wrote; clearOwnedCookies runs afterward.
      if (currentDigest === entry.expectedDigest && !await remove(entry)) complete = false;
      continue;
    }
    if (currentDigest !== entry.expectedDigest) continue;
    if (entry.previousDigest === entry.expectedDigest) continue;
    const previous = snapshots?.[snapshotId(entry)];
    if (previous == null) { if (!await remove(entry)) complete=false; }
    else await restore(previous);
  }
  return complete ? discarded ? "discarded" : "restored" : "incomplete";
}

async function localTgcCandidates(): Promise<chrome.cookies.Cookie[]> {
  const storeId = await normalStoreId();
  const urls = [`${SSO_URL}/login`, `${SSO_URL}/authserver/login`];
  const [lists, singles] = await Promise.all([
    Promise.all(urls.map((url) =>
      chrome.cookies.getAll({ url, name: "SOURCEID_TGC", storeId })
    )),
    Promise.all(urls.map((url) =>
      chrome.cookies.get({ url, name: "SOURCEID_TGC", storeId })
    )),
  ]);
  const presentSingles = singles.filter(
    (cookie): cookie is chrome.cookies.Cookie => cookie !== null && cookie !== undefined
  );
  return [...new Map([...lists.flat(), ...presentSingles]
    .filter((cookie) =>
      cookie.domain === "sso.cqu.edu.cn" || cookie.domain === ".sso.cqu.edu.cn"
    )
    .map((cookie) => [
      `${cookie.storeId}\0${cookie.domain}\0${cookie.path}\0${cookie.name}`,
      cookie,
    ])).values()];
}

export async function inspectLocalTgc(): Promise<"missing" | "managed" | "foreign"> {
  const state = await readLocalState();
  const cookies = await localTgcCandidates();
  if (cookies.length === 0) return "missing";
  for (const cookie of cookies) {
    const managed = state.managed.find((entry) =>
      entry.name === cookie.name && entry.domain === cookie.domain &&
      entry.path === cookie.path && entry.storeId === cookie.storeId
    );
    if (managed && managed.digest === await digestCookie(cookie)) return "managed";
  }
  return "foreign";
}

async function applyEnvelopeUnlocked(
  raw: CookieEnvelope | ExportEnvelope,
  options: { localGeneration: number; allowForeignOnce: boolean }
): Promise<"applied" | "foreign_session" | "cancelled"> {
  const envelope = raw.protocolVersion === 3 ? parseExportEnvelope(raw) : validateCookieEnvelope(raw);
  if ((await chrome.storage.local.get(JOURNAL_KEY))[JOURNAL_KEY]) {
    await recoverJournal();
    if ((await chrome.storage.local.get(JOURNAL_KEY))[JOURNAL_KEY]) return "foreign_session";
  }
  const state = await readLocalState();
  if (state.deviceId !== envelope.deviceId || state.localGeneration !== options.localGeneration ||
      state.serverGeneration !== envelope.generation ||
      !state.enabledIntent || state.manualOverride) return "cancelled";
  if (envelope.protocolVersion === 3 && (envelope.applyBefore <= Date.now() ||
      !state.snapshot || !sameTuple(envelope, tupleForSnapshot(state.snapshot)))) return "cancelled";
  if (!options.allowForeignOnce && await inspectLocalTgc() === "foreign") {
    return "foreign_session";
  }

  const switchIntentId = options.allowForeignOnce ? state.managedSwitch?.id : undefined;
  const storeId = await normalStoreId();
  const journal: CookieJournal = {
    id: crypto.randomUUID(),
    localGeneration: options.localGeneration,
    serverGeneration: envelope.generation,
    sessionVersion: envelope.sessionVersion,
    phase: "writing",
    entries: [],
  };
  const snapshots: CookieSnapshots = {};
  await writeJournal(journal, snapshots);

  try {
    for (const cookie of envelope.cookies) {
      const identity = { name: cookie.name, domain: cookie.domain, path: cookie.path, storeId };
      const previous = await getExact(identity);
      const target = setDetails(cookie, storeId);
      const targetCookie = {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: target.sameSite ?? "unspecified",
        session: cookie.expires === -1,
        expirationDate: target.expirationDate,
      };
      const entry = {
        ...identity,
        digest: await digestCookie(targetCookie),
        previousDigest: previous ? await digestCookie(previous) : null,
        expectedDigest: await digestCookie(targetCookie),
        completed: false,
      };
      journal.entries.push(entry);
      snapshots[snapshotId(entry)] = previous;
      await writeJournal(journal, snapshots);

      const unchanged = await getExact(identity);
      const unchangedDigest = unchanged ? await digestCookie(unchanged) : null;
      if (unchangedDigest !== entry.previousDigest) throw new SyncError("COOKIE_WRITE_TRANSIENT");
      const beforeWrite = await readLocalState();
      if (beforeWrite.localGeneration !== options.localGeneration || !beforeWrite.enabledIntent || beforeWrite.manualOverride ||
          (envelope.protocolVersion === 3 && envelope.applyBefore <= Date.now())) throw new SyncError("COOKIE_WRITE_TRANSIENT");
      let written: chrome.cookies.Cookie | null;
      try {
        written = await chrome.cookies.set(target);
      } catch {
        throw new SyncError("COOKIE_WRITE_TRANSIENT");
      }
      if (!written) throw new SyncError("COOKIE_PERMISSION_DENIED");
      if (!returnedCookieMatches(written, cookie, storeId)) {
        throw new SyncError("COOKIE_WRITE_TRANSIENT");
      }
      const writtenDigest = await digestCookie(written);
      entry.digest = writtenDigest;
      entry.expectedDigest = writtenDigest;
      entry.completed = true;
      await writeJournal(journal, snapshots);
      const current = await readLocalState();
      if (current.localGeneration !== options.localGeneration ||
          current.serverGeneration !== envelope.generation ||
          !current.enabledIntent || current.manualOverride) {
        throw new SyncError("COOKIE_WRITE_TRANSIENT");
      }
    }

    const managed: ManagedCookie[] = [];
    for (const entry of journal.entries) {
      const current = await getExact(entry);
      if (!current || await digestCookie(current) !== entry.expectedDigest) {
        throw new SyncError("COOKIE_WRITE_TRANSIENT");
      }
      managed.push({
        name: entry.name, domain: entry.domain, path: entry.path,
        storeId: entry.storeId, digest: entry.expectedDigest,
        ...(!current.session && current.expirationDate !== undefined ? { renewal: {
          digest: await digestCookie({...current,expirationDate:undefined}),
          expirationDate: current.expirationDate,
        } } : {}),
      });
    }
    const keep = new Set(managed.map(snapshotId));
    let cleanupConflict=false;
    for (const old of state.managed) {
      if (keep.has(snapshotId(old))) continue;
      const current = await getExact(old);
      if (current && await digestCookie(current) === old.digest && !await remove(old)) {
        managed.push(old);
        cleanupConflict=true;
      }
    }

    journal.phase = "committed";
    await updateLocalStateWith({ [JOURNAL_KEY]: journal }, (current) => {
      if (current.localGeneration !== options.localGeneration || !current.enabledIntent || current.manualOverride ||
          current.serverGeneration !== envelope.generation) throw new SyncError("COOKIE_WRITE_TRANSIENT");
      return { ...current, managed,
        managedSwitch: switchIntentId !== undefined && current.managedSwitch?.id === switchIntentId ? null : current.managedSwitch,
        appliedVersion:cleanupConflict ? null : envelope.sessionVersion,
        localWriteState:cleanupConflict ? "foreign_session" : "ready",
        localError:cleanupConflict ? "LOCAL_COOKIE_CONFLICT" : null };
    });
    await clearJournal();
    return cleanupConflict ? "foreign_session" : "applied";
  } catch (error) {
    const rollbackResult = await rollback(journal, snapshots);
    if (rollbackResult !== "incomplete") await clearJournal();
    else { journal.phase="writing"; await writeJournal(journal,snapshots); }
    throw error;
  }
}

export async function inspectManagedCookies(): Promise<"verified" | "missing" | "changed"> {
  const state = await readLocalState();
  if (!state.managed.some((cookie) => cookie.name === "SOURCEID_TGC")) return "missing";
  let missing = false;
  for (const entry of state.managed) {
    const current = await getExact(entry);
    if (!current) missing = true;
    else if (await digestCookie(current) !== entry.digest) return "changed";
  }
  return missing ? "missing" : "verified";
}

export async function verifyManagedCookies(): Promise<boolean> {
  return await inspectManagedCookies() === "verified";
}

// A school response may extend an auxiliary Cookie while another document is
// still waiting on the same acknowledged write. This does not reclaim ownership.
export async function verifyRecoveryCookies(managed: ManagedCookie[]): Promise<boolean> {
  const candidates = await localTgcCandidates();
  if (!candidates.length) return false;
  for (const cookie of candidates) {
    const owned = managed.find(entry => entry.name === cookie.name && entry.domain === cookie.domain &&
      entry.path === cookie.path && entry.storeId === cookie.storeId);
    if (!owned || await digestCookie(cookie) !== owned.digest) return false;
  }
  for (const entry of managed) {
    const current = await getExact(entry);
    if (!current) return false;
    if (await digestCookie(current) === entry.digest) continue;
    const baseline = entry.renewal;
    if (entry.name === "SOURCEID_TGC" || !baseline || current.session ||
        !Number.isFinite(baseline.expirationDate) || !Number.isFinite(current.expirationDate) ||
        current.expirationDate! <= Date.now()/1000 || current.expirationDate! < baseline.expirationDate ||
        await digestCookie({...current,expirationDate:undefined}) !== baseline.digest) return false;
  }
  return managed.some(entry => entry.name === "SOURCEID_TGC");
}

async function clearOwnedCookiesUnlocked(): Promise<void> {
  const state = await readLocalState();
  const remaining: ManagedCookie[] = [];
  for (const entry of state.managed) {
    const current = await getExact(entry);
    if (current && await digestCookie(current) === entry.digest) {
      if (!await remove(entry)) remaining.push(entry);
    }
    else if (current) remaining.push(entry);
  }
  await updateLocalState((current) => ({
    ...current,
    managed: remaining,
    appliedVersion: null,
  }));
}

async function recoverJournal(): Promise<void> {
  const stored = await chrome.storage.local.get(JOURNAL_KEY);
  const journal = stored[JOURNAL_KEY] as CookieJournal | undefined;
  if (!journal) return;
  if (journal.phase === "committed") {
    await clearJournal();
    return;
  }
  const session = await chrome.storage.session.get(SNAPSHOT_KEY);
  const snapshots = (session[SNAPSHOT_KEY] as CookieSnapshots | undefined) ?? null;
  const result=await rollback(journal,snapshots);
  if (result !== "incomplete") await clearJournal();
  if (result === "restored") {
    await updateLocalState((state) => ({ ...state, localWriteState:"error",
      localError:"LOCAL_WRITE_FAILED",receipt:null,pendingAck:false }));
  } else if (result === "discarded") {
    await updateLocalState((state) => ({ ...state, localWriteState:"idle",
      receipt:null,pendingAck:false }));
  } else {
    await updateLocalState((state) => ({ ...state, localWriteState:"foreign_session",
      localError:"LOCAL_COOKIE_CONFLICT",receipt:null,pendingAck:false }));
  }
}

let cookieWriteQueue: Promise<unknown> = Promise.resolve();

function serializeCookieWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = cookieWriteQueue.then(operation);
  cookieWriteQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function applyEnvelope(
  raw: CookieEnvelope | ExportEnvelope,
  options: { localGeneration: number; allowForeignOnce: boolean }
): Promise<"applied" | "foreign_session" | "cancelled"> {
  return serializeCookieWrite(() => applyEnvelopeUnlocked(raw, options));
}

export function clearOwnedCookies(): Promise<void> {
  return serializeCookieWrite(clearOwnedCookiesUnlocked);
}

export function recoverInterruptedWrite(): Promise<void> {
  return serializeCookieWrite(recoverJournal);
}
