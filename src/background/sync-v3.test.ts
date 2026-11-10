import { derivePresentation } from "../shared/protocol-v3.generated";
import { applyEnvelope, clearOwnedCookies } from "./cookie-store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { snapshot, readySnapshot, envelope, receipt } from "../test/protocol-fixtures";
import { initialLocalState, LOCAL_STATE_KEY, readLocalState, updateLocalState } from "./storage";
import { setEnabled, setEnvelopeWriter, sync, switchToManagedOnce } from "./sync";
import { JOURNAL_KEY } from "./cookie-journal";
import { observeSchoolLogin } from "./school-recovery";
import { handleContentMessage, handleMessage } from "./messages";
import { derivePopupView, type PopupInput } from "../popup/view-model";
import * as api from "./api-v3";
import * as telemetry from "../shared/posthog";
import type { DeviceSnapshot, OperationResponse } from "../shared/protocol-v3.generated";

function operationResponse(value: DeviceSnapshot): OperationResponse {
  return {
    snapshot: value,
    operation: { operationId: "operation-a", command: "retry_session", versions: receipt(),
      state: "running", stage: "authenticating", attempt: 1, createdAt: Date.now(),
      startedAt: Date.now(), deadlineAt: Date.now() + 300_000, completedAt: null,
      retryAt: null, resultCode: null, cancelReason: null },
  };
}

let fake: ReturnType<typeof installChromeFake>;

beforeEach(async () => {
  fake = installChromeFake();
  vi.spyOn(telemetry, "captureQuickloginOperation").mockImplementation(() => undefined);
  await chrome.storage.local.set({ [LOCAL_STATE_KEY]: {
    ...initialLocalState(), deviceId: "device-a", serverGeneration: 4, enabledIntent: true,
    authorization: "authorized", snapshot: snapshot(), observation: "fresh",
  } });
  vi.spyOn(api, "capabilities").mockResolvedValue({ protocolVersion: 3, supportedProtocolVersions: [2,3],
    minExtensionVersion: "0.2.0", serverBuild: "test", features: { reconcile:true, operations:true, receipts:true, overview:true } });
  vi.spyOn(api, "reconcile").mockResolvedValue({ centralUserId: "central-user-a", snapshot: snapshot(), receiptAck: null });
  vi.spyOn(api, "exportSession").mockResolvedValue(envelope());
  vi.spyOn(api, "operate").mockImplementation(async () => operationResponse({ ...snapshot(), cloud: { ...snapshot().cloud, state: "logging_in" } }));
  vi.spyOn(api, "acknowledge").mockImplementation(async(applied)=>{
    const local=await readLocalState();
    return {accepted:true,exportId:applied.exportId,acceptedTuple:applied,reportEpoch:local.reportEpoch,
      clientReportSeq:local.clientReportSeq,receivedAt:Date.now(),reasonCode:null,snapshot:snapshot()};
  });
});

it("finishes a real cookie write and its pending ACK before applying a downloaded extension update", async () => {
  setEnvelopeWriter(applyEnvelope);
  let finishAck!: () => void;
  const gate = new Promise<void>(resolve => { finishAck = resolve; });
  const acknowledge = vi.mocked(api.acknowledge).getMockImplementation()!;
  vi.mocked(api.acknowledge).mockImplementation(async applied => {
    await gate;
    return acknowledge(applied);
  });
  const reload = vi.spyOn(chrome.runtime, "reload");
  const before = await readLocalState();
  const syncing = sync("alarm");
  await vi.waitFor(async () => expect(await readLocalState()).toMatchObject({ pendingAck: true }));
  expect(fake.getCookie("SOURCEID_TGC")?.value).toBe(envelope().cookies[0].value);
  const { applyAvailableUpdate } = await import("./updates");
  applyAvailableUpdate();
  expect(reload).not.toHaveBeenCalled();
  finishAck();
  await syncing;
  expect(reload).toHaveBeenCalledOnce();
  expect(await readLocalState()).toMatchObject({
    deviceId: before.deviceId, installationId: before.installationId, pendingAck: false,
    receipt: { result: "applied" },
  });
});

it.each(["new-session", "school-form", "explicit-switch"])("does not let a prior local rotation block %s", async transition => {
  const first = envelope();
  first.cookies.push({ ...first.cookies[0], name: "SESSION", value: "initial-auxiliary" });
  vi.mocked(api.exportSession).mockResolvedValue(first);
  setEnvelopeWriter(applyEnvelope);
  await sync("startup");
  await chrome.cookies.set({ url: "https://sso.cqu.edu.cn/", name: "SESSION", path: "/",
    value: "locally-rotated", secure: true, httpOnly: true, sameSite: "lax" });
  await sync("popup");
  await sync("popup");
  expect(fake.getCookie("SESSION")?.value).toBe("locally-rotated");
  expect((await readLocalState()).receipt?.result).toBe("applied");

  if (transition === "explicit-switch") {
    fake.getCookie("SOURCEID_TGC")!.value = "another-school-login";
    await sync("popup");
    expect((await readLocalState()).localWriteState).toBe("foreign_session");
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(api.reconcile).mockImplementation(async () => {
      await gate;
      return { centralUserId: "central-user-a", snapshot: snapshot(), receiptAck: null };
    });
    try {
      await handleMessage({ type: "SWITCH_TO_MANAGED" });
      expect(derivePopupView(await handleMessage({ type: "GET_UI_STATE" }) as PopupInput))
        .toMatchObject({ heading: "正在准备学校登录", tone: "busy", actions: [], switchEnabled: true });
      expect(fake.getCookie("SESSION")?.value).toBe("locally-rotated");
    } finally { release(); await sync("popup"); }
    expect(fake.getCookie("SESSION")?.value).toBe("initial-auxiliary");
    expect(await readLocalState()).toMatchObject({ localWriteState: "ready", managedSwitch: null, pendingAck: false });
  } else if (transition === "school-form") {
    await observeSchoolLogin({ tabId: 7, documentId: "new-school-document" });
    await sync("login_form");
    expect(api.operate).toHaveBeenCalledWith("retry_session", expect.anything(), expect.any(String));
    expect((await readLocalState()).snapshot?.cloud.state).toBe("logging_in");
  } else {
    const next = snapshot();
    next.versions.sessionVersion++;
    next.versions.deviceRevision++;
    vi.mocked(api.reconcile).mockResolvedValue({ centralUserId: "central-user-a", snapshot: next, receiptAck: null });
    vi.mocked(api.exportSession).mockResolvedValue({ ...first, sessionVersion: 8, exportId: "next-export",
      cookies: first.cookies.map(cookie => ({ ...cookie, value: "new-server-session" })) });
    vi.mocked(api.acknowledge).mockImplementation(async applied => {
      const local = await readLocalState();
      return { accepted: true, exportId: applied.exportId, acceptedTuple: applied, reportEpoch: local.reportEpoch,
        clientReportSeq: local.clientReportSeq, receivedAt: Date.now(), reasonCode: null, snapshot: next };
    });
    await sync("alarm");
    expect(fake.getCookie("SOURCEID_TGC")?.value).toBe("new-server-session");
    expect(fake.getCookie("SESSION")?.value).toBe("new-server-session");
    expect(await readLocalState()).toMatchObject({ receipt: { result: "applied", sessionVersion: 8 }, pendingAck: false });
  }
});

describe("routine cookie continuity", () => {
  beforeEach(() => {
    const exported = envelope();
    exported.cookies[0].expires = Date.now() / 1000 + 1800;
    exported.cookies.push({ ...exported.cookies[0], name: "auxiliary", value: "same-school-session", sameSite: "None" });
    exported.cookies.push({ ...exported.cookies[0], name: "JSESSIONID", value: "initial-request-session", sameSite: "None", expires: -1 });
    vi.mocked(api.exportSession).mockResolvedValue(exported);
    vi.mocked(api.reconcile).mockResolvedValue({ centralUserId: "central-user-a", snapshot: readySnapshot(), receiptAck: null });
    vi.mocked(api.acknowledge).mockImplementation(async applied => {
      const local = await readLocalState();
      return { accepted: true, exportId: applied.exportId, acceptedTuple: applied, reportEpoch: local.reportEpoch,
        clientReportSeq: local.clientReportSeq, receivedAt: Date.now(), reasonCode: null, snapshot: readySnapshot() };
    });
    setEnvelopeWriter(applyEnvelope);
  });

  it.each([
    ["acknowledged", "expiry"], ["pending-ack", "expiry"], ["previously-misclassified", "expiry"],
    ["acknowledged", "rotation"], ["pending-ack", "rotation"], ["previously-misclassified", "rotation"],
  ] as const)(
    "keeps the managed login ready without rewriting school cookies: %s / %s", async (previous, change) => {
      if (previous === "pending-ack") vi.mocked(api.acknowledge).mockRejectedValueOnce(new TypeError("offline"));
      await sync("startup");
      const written = await readLocalState();
      expect(written.receipt?.result).toBe("applied");
      expect(written.pendingAck).toBe(previous === "pending-ack");
      const auxiliary = fake.getCookie("auxiliary")!;
      auxiliary.expirationDate! += 60;
      const requestSession = fake.getCookie("JSESSIONID")!;
      if (change === "rotation") {
        auxiliary.value = "rotated-school-cookie";
        auxiliary.sameSite = "unspecified";
        requestSession.value = "rotated-request-session";
        requestSession.sameSite = "lax";
      }
      if (previous === "previously-misclassified") {
        // Upgrade from a version that misclassified normal school Cookie changes.
        await updateLocalState(state => ({ ...state, receipt: { ...state.receipt!, result: "foreign", verifiedAt: null },
          pendingAck: false, appliedVersion: null, localWriteState: "idle" }));
      }
      const writes = vi.spyOn(chrome.cookies, "set");
      const exports = vi.mocked(api.exportSession).mock.calls.length;
      const acknowledgments = vi.mocked(api.acknowledge).mock.calls.length;
      await sync("popup");
      await sync("alarm");
      expect(derivePopupView(await handleMessage({ type: "GET_UI_STATE" }) as PopupInput).heading).toBe("已就绪");
      expect(await readLocalState()).toMatchObject({ localWriteState: "ready", appliedVersion: 7, pendingAck: false,
        receipt: { ...written.receipt, result: "applied", verifiedAt: expect.any(Number) }, managed: written.managed });
      expect(api.localCookieState(await readLocalState())).toBe("applied");
      expect(writes).not.toHaveBeenCalled();
      expect(api.exportSession).toHaveBeenCalledTimes(exports);
      expect(api.acknowledge).toHaveBeenCalledTimes(acknowledgments + (previous === "acknowledged" ? 0 : 1));
      // Read-only continuity must not make the renewed cookie deletable by the extension.
      await clearOwnedCookies();
      expect(fake.getCookie("auxiliary")).toEqual(auxiliary);
      expect(fake.getCookie("JSESSIONID")).toEqual(change === "rotation" ? requestSession : null);
      expect(fake.getCookie("SOURCEID_TGC")).toBeNull();
    }
  );

  it.each(["shortened-expiry", "security", "session", "missing-proof", "primary-value",
    "primary-expiry", "foreign-domain", "foreign-path", "foreign-domain-with-renewal", "foreign-path-with-renewal"] as const)(
    "preserves a genuinely changed or unproven login: %s", async change => {
      await sync("startup");
      const auxiliary = fake.getCookie("auxiliary")!;
      const tgc = fake.getCookie("SOURCEID_TGC")!;
      if (change === "shortened-expiry") tgc.expirationDate! -= 60;
      else if (change === "security") tgc.httpOnly = false;
      else if (change === "session") tgc.session = true;
      else if (change === "missing-proof") {
        await updateLocalState(state => ({ ...state, managed: state.managed.filter(entry => entry.name !== "SOURCEID_TGC") }));
      } else if (change === "primary-value") tgc.value = "another-account";
      else if (change === "primary-expiry") tgc.expirationDate! += 60;
      else {
        if (change.endsWith("with-renewal")) auxiliary.expirationDate! += 60;
        await chrome.cookies.set({ url: "https://sso.cqu.edu.cn/authserver/login", name: "SOURCEID_TGC", value: "another-account",
          path: change.startsWith("foreign-path") ? "/authserver" : "/",
          ...(change.startsWith("foreign-domain") ? { domain: ".sso.cqu.edu.cn" } : {}), secure: true, httpOnly: true });
      }
      const cookies = structuredClone([...fake.cookieStore.values()]);
      const writes = vi.spyOn(chrome.cookies, "set");
      const acknowledgments = vi.mocked(api.acknowledge).mock.calls.length;
      await sync("popup");
      await sync("alarm");
      expect(derivePopupView(await handleMessage({ type: "GET_UI_STATE" }) as PopupInput).heading).toBe("正在保留已有学校登录");
      expect((await readLocalState()).receipt?.result).not.toBe("applied");
      expect([...fake.cookieStore.values()]).toEqual(cookies);
      expect(writes).not.toHaveBeenCalled();
      expect(api.acknowledge).toHaveBeenCalledTimes(acknowledgments);
    }
  );
});

it("records disconnected and throttled sync checks as no-ops", async () => {
  await updateLocalState((state) => ({ ...state, deviceId: null, nextAttemptAt: Date.now() + 60_000 }));
  await sync("alarm");

  expect(telemetry.captureQuickloginOperation).toHaveBeenCalledWith("sync", {
    outcome: "success",
    trigger: "scheduled",
    durationMs: expect.any(Number),
    noOp: true,
  });
});

it("records sync failures with a bounded code and duration", async () => {
  vi.mocked(api.reconcile).mockRejectedValue(new TypeError("offline"));
  await sync("alarm");

  expect(telemetry.captureQuickloginOperation).toHaveBeenCalledWith("sync", {
    outcome: "failure",
    trigger: "scheduled",
    durationMs: expect.any(Number),
    errorCode: "UNEXPECTED_ERROR",
  });
});

it("records a manual Cookie write as unverified without a second sync success", async () => {
  setEnvelopeWriter(vi.fn().mockResolvedValue("applied"));
  await sync("user_retry");

  expect(telemetry.captureQuickloginOperation).toHaveBeenCalledWith("cookie_apply", {
    outcome: "success",
    trigger: "user",
    durationMs: expect.any(Number),
    operationId: "export-a",
    verification: "unverified",
  });
  expect(telemetry.captureQuickloginOperation).not.toHaveBeenCalledWith("sync", expect.anything());
  expect(await readLocalState()).toMatchObject({ centralUserId: "central-user-a" });
});

it("records a failed Cookie write without relabeling it as sync failure", async () => {
  setEnvelopeWriter(vi.fn().mockRejectedValue(Object.assign(new Error("write failed"), { code: "LOCAL_WRITE_FAILED" })));
  await sync("alarm");

  expect(telemetry.captureQuickloginOperation).toHaveBeenCalledWith("cookie_apply", {
    outcome: "failure",
    trigger: "scheduled",
    durationMs: expect.any(Number),
    operationId: "export-a",
    errorCode: "LOCAL_WRITE_FAILED",
  });
  expect(telemetry.captureQuickloginOperation).not.toHaveBeenCalledWith("sync", expect.anything());
});

it("records unreachable observation instead of retaining a current ready claim", async () => {
  vi.mocked(api.reconcile).mockRejectedValue(new TypeError("offline"));
  await sync("alarm");
  expect(await readLocalState()).toMatchObject({ observation:"unreachable", localError:"INTERNAL_STATE_UNAVAILABLE" });
});

it("applies and acknowledges the exact current generation even when the session number matches", async () => {
  await updateLocalState((state) => ({ ...state, appliedVersion:7, receipt:receipt(), localWriteState:"ready" }));
  const remote = snapshot(); remote.versions.generation = 5;
  vi.mocked(api.reconcile).mockResolvedValue({ centralUserId: "central-user-a", snapshot:remote, receiptAck:null });
  vi.mocked(api.exportSession).mockResolvedValue({ ...envelope(), generation:5 });
  vi.mocked(api.acknowledge).mockImplementation(async (applied) => {
    const local=await readLocalState();
    return { accepted:true, exportId:applied.exportId,acceptedTuple:applied, reportEpoch:local.reportEpoch,
      clientReportSeq:local.clientReportSeq,receivedAt:Date.now(),reasonCode:null,snapshot:remote };
  });
  const writer = vi.fn().mockResolvedValue("applied"); setEnvelopeWriter(writer);
  await sync("alarm");
  expect(writer).toHaveBeenCalledOnce();
  expect(api.acknowledge).toHaveBeenCalledWith(expect.objectContaining({ generation:5, sessionVersion:7, result:"applied" }));
  expect((await readLocalState()).pendingAck).toBe(false);
});

it("sends a real retry operation for recoverable cloud failure", async () => {
  const remote = snapshot(); remote.cloud.state="retry_wait"; remote.cloud.usableUntil=null;
  vi.mocked(api.reconcile).mockResolvedValue({ centralUserId: "central-user-a", snapshot:remote, receiptAck:null });
  await sync("user_retry");
  expect(api.operate).toHaveBeenCalledWith("retry_session", expect.anything(), expect.any(String));
  expect(api.exportSession).not.toHaveBeenCalled();
});

it("does not acknowledge a cancelled cookie writer", async () => {
  setEnvelopeWriter(vi.fn().mockResolvedValue("cancelled"));
  await sync("startup");
  expect(api.exportSession).toHaveBeenCalledOnce();
  expect(api.acknowledge).not.toHaveBeenCalled();
  expect((await readLocalState()).receipt).toBeNull();
});

it("does not accept an ACK for another export or report request",async()=>{
  setEnvelopeWriter(vi.fn().mockResolvedValue("applied"));
  vi.mocked(api.acknowledge).mockImplementation(async(applied)=>({accepted:true,exportId:"another-export",
    acceptedTuple:applied,reportEpoch:"another-epoch",clientReportSeq:999,receivedAt:Date.now(),reasonCode:null,snapshot:snapshot()}));
  await sync("startup");
  expect(await readLocalState()).toMatchObject({pendingAck:true,localError:"CONTRACT_INVALID"});
});

it("coalesces concurrent background requests", async () => {
  const writer = vi.fn().mockResolvedValue("applied"); setEnvelopeWriter(writer);
  await Promise.all(Array.from({length:10}, () => sync("alarm")));
  expect(api.reconcile).toHaveBeenCalledOnce();
  expect(writer).toHaveBeenCalledOnce();
});

it("discards an export completing after a local cancellation", async () => {
  let release!: (value: ReturnType<typeof envelope>) => void;
  vi.mocked(api.exportSession).mockImplementation(() => new Promise((resolve) => { release=resolve; }));
  const writer=vi.fn().mockResolvedValue("applied"); setEnvelopeWriter(writer);
  const running=sync("alarm");
  await vi.waitFor(() => expect(api.exportSession).toHaveBeenCalledOnce());
  await updateLocalState((state) => ({ ...state,enabledIntent:false,localGeneration:state.localGeneration+1 }));
  release(envelope());
  await running;
  expect(writer).not.toHaveBeenCalled();
  expect(api.acknowledge).not.toHaveBeenCalled();
});

it("clears a cookie written immediately before disable without rollback resurrecting it", async () => {
  const previous = {
    ...envelope(),
    cookies: envelope().cookies.map((cookie) =>
      cookie.name === "SOURCEID_TGC" ? { ...cookie, value: "previous-managed-value" } : cookie
    ),
  };
  await applyEnvelope(previous, { localGeneration: 0, allowForeignOnce: false });
  const originalSet = chrome.cookies.set.bind(chrome.cookies);
  let entered!: () => void;
  let release!: () => void;
  const began = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.spyOn(chrome.cookies, "set").mockImplementation(async (details) => {
    const written = await originalSet(details);
    if (details.name === "SOURCEID_TGC") {
      entered();
      await gate;
    }
    return written;
  });
  const replacement = {
    ...envelope(),
    cookies: envelope().cookies.map((cookie) =>
      cookie.name === "SOURCEID_TGC" ? { ...cookie, value: "replacement-during-disable" } : cookie
    ),
  };
  const application = applyEnvelope(replacement, { localGeneration: 0, allowForeignOnce: false });
  const failure = expect(application).rejects.toMatchObject({ code: "COOKIE_WRITE_TRANSIENT" });
  await began;
  const disabling = setEnabled(false);
  await vi.waitFor(async () => expect(await readLocalState()).toMatchObject({ enabledIntent: false }));
  release();
  await disabling;
  await failure;

  expect(fake.getCookie("SOURCEID_TGC")).toBeNull();
  expect((await chrome.storage.local.get(JOURNAL_KEY))[JOURNAL_KEY]).toBeUndefined();
  expect(await readLocalState()).toMatchObject({ enabledIntent: false });
});

it("schedules a background check while a durable server operation runs", async () => {
  const remote=snapshot(); remote.cloud.state="logging_in"; remote.capabilities.canExport=false;
  vi.mocked(api.reconcile).mockResolvedValue({ centralUserId: "central-user-a", snapshot:remote,receiptAck:null });
  await sync("alarm");
  expect(api.exportSession).not.toHaveBeenCalled();
  expect((await chrome.alarms.get("quicklogin-sync-retry"))?.scheduledTime).toBeGreaterThanOrEqual(Date.now()+29_000);
});

it("explicit retry observes current state despite an older persisted network wait", async () => {
  await updateLocalState((state) => ({ ...state,nextAttemptAt:Date.now()+60_000 }));
  setEnvelopeWriter(vi.fn().mockResolvedValue("applied"));
  await sync("user_retry");
  expect(api.reconcile).toHaveBeenCalledOnce();
});

it.each([
  { operationId: null, retryAt: null, canEnsure: true, starts: true },
  { operationId: 'existing-task', retryAt: null, canEnsure: true, starts: false },
  { operationId: null, retryAt: Date.now() + 600_000, canEnsure: true, starts: false },
  { operationId: null, retryAt: null, canEnsure: false, starts: false },
])('recovers queued state only when no task owns the authorized attempt: $starts', async ({operationId,retryAt,canEnsure,starts}) => {
  const remote = snapshot();
  remote.cloud = { ...remote.cloud, state: 'queued', operationId, retryAt, usableUntil: null };
  remote.capabilities = { ...remote.capabilities, canExport: false, canEnsure };
  vi.mocked(api.reconcile).mockResolvedValue({ centralUserId: "central-user-a", snapshot:remote,receiptAck:null });
  await sync('alarm');
  if (starts) expect(api.operate).toHaveBeenCalledWith('ensure_session',expect.anything(),expect.any(String));
  else expect(api.operate).not.toHaveBeenCalled();
});


it("rejects school-page switch commands while preserving explicit popup consent", async () => {
  await chrome.cookies.set({url:"https://sso.cqu.edu.cn/",name:"SOURCEID_TGC",value:"synthetic-foreign",path:"/",secure:true});
  await updateLocalState(s=>({...s,localWriteState:"foreign_session"}));
  setEnvelopeWriter(applyEnvelope);
  const before = await readLocalState();
  for (const path of ["/login", "/authserver/login"]) {
    await expect(handleContentMessage({type:"SWITCH_TO_MANAGED"} as never, {
      id:chrome.runtime.id,url:`https://sso.cqu.edu.cn${path}`,tab:{id:7} as chrome.tabs.Tab,
    })).rejects.toThrow("FORBIDDEN");
  }
  expect(await readLocalState()).toEqual(before);
  expect(fake.getCookie("SOURCEID_TGC")?.value).toBe("synthetic-foreign");
  expect(api.exportSession).not.toHaveBeenCalled();
  await handleMessage({type:"SWITCH_TO_MANAGED"});
  await sync("popup");
  expect(fake.getCookie("SOURCEID_TGC")?.value).toBe(envelope().cookies[0].value);
  expect(await readLocalState()).toMatchObject({managedSwitch:null,localWriteState:"ready",pendingAck:false});
});

it("does not create advance switch consent when there is no foreign session", async () => {
  expect(await switchToManagedOnce()).toBe(false);
  expect((await readLocalState()).managedSwitch).toBeNull();
  expect(api.exportSession).not.toHaveBeenCalled();
});

it("keeps a confirmed switch when reconciliation advances only the cloud session", async () => {
  await updateLocalState(s=>({...s,localWriteState:"foreign_session"}));
  const remote=snapshot(); remote.versions.sessionVersion+=1;
  vi.mocked(api.reconcile).mockResolvedValue({ centralUserId: "central-user-a", snapshot:remote,receiptAck:null });
  vi.mocked(api.exportSession).mockResolvedValue({...envelope(),sessionVersion:remote.versions.sessionVersion});
  const writer=vi.fn().mockResolvedValue("applied");setEnvelopeWriter(writer);
  await switchToManagedOnce();
  await sync("popup");
  expect(writer).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({allowForeignOnce:true}));
});

it("keeps the switch through cloud preparation until the next alarm can apply cookies", async () => {
  await updateLocalState(s=>({...s,localWriteState:"foreign_session"}));
  const preparing=snapshot();preparing.cloud.state="logging_in";preparing.capabilities.canExport=false;
  vi.mocked(api.reconcile).mockResolvedValueOnce({ centralUserId: "central-user-a", snapshot:preparing,receiptAck:null });
  const writer=vi.fn().mockResolvedValue("applied");setEnvelopeWriter(writer);
  await switchToManagedOnce();
  await sync("popup");
  expect(api.operate).not.toHaveBeenCalled();
  await sync("alarm");
  expect(writer).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({allowForeignOnce:true}));
});


it.each(["disable", "manual", "reauthorize", "binding", "expire"])("cancels pending switch after %s", async kind => {
  await updateLocalState(s=>({...s,localWriteState:"foreign_session"}));
  const preparing=snapshot();preparing.cloud.state="logging_in";preparing.capabilities.canExport=false;
  vi.mocked(api.reconcile).mockResolvedValueOnce({ centralUserId: "central-user-a", snapshot:preparing,receiptAck:null });
  await switchToManagedOnce();
  await sync("popup");
  await updateLocalState(s=>({...s,
    enabledIntent:kind==="disable"?false:s.enabledIntent,
    manualOverride:kind==="manual"?true:s.manualOverride,
    authGeneration:s.authGeneration+(kind==="reauthorize"?1:0),
    managedSwitch:kind==="expire"&&s.managedSwitch?{...s.managedSwitch,expiresAt:0}:s.managedSwitch,
  }));
  if(kind==="binding") {const remote=snapshot();remote.versions.bindingEpoch=4;vi.mocked(api.reconcile).mockResolvedValue({ centralUserId: "central-user-a", snapshot:remote,receiptAck:null });}
  const writer=vi.fn().mockResolvedValue("foreign_session");setEnvelopeWriter(writer);
  await sync("alarm");
  expect(writer.mock.calls.every(([,options])=>!options.allowForeignOnce)).toBe(true);
  expect((await readLocalState()).managedSwitch).toBeNull();
});

it.each(["unchanged", "value", "additional-path", "additional-domain", "attributes", "removed", "legacy", "during-write-preparation"])(
  "binds delayed switch consent to the observed TGC set (%s)", async change => {
    const foreign = { url: "https://sso.cqu.edu.cn/", name: "SOURCEID_TGC", value: "consented-session",
      path: "/", storeId: "0", secure: true, httpOnly: true, sameSite: "lax" as const };
    await chrome.cookies.set(foreign);
    await updateLocalState(state => ({ ...state, localWriteState: "foreign_session" }));
    const preparing = snapshot();
    preparing.cloud.state = "logging_in";
    preparing.capabilities.canExport = false;
    vi.mocked(api.reconcile).mockResolvedValueOnce({ centralUserId: "central-user-a", snapshot: preparing, receiptAck: null });
    setEnvelopeWriter(applyEnvelope);
    await switchToManagedOnce();
    await sync("popup");
    const originalSet = chrome.cookies.set.bind(chrome.cookies);
    if (change === "value") await originalSet({ ...foreign, value: "new-manual-session" });
    if (change === "additional-path") {
      const getAll = chrome.cookies.getAll.bind(chrome.cookies);
      vi.spyOn(chrome.cookies, "getAll").mockImplementation(async details => (await getAll(details))
        .filter(cookie => !details.url || new URL(details.url).pathname.startsWith(cookie.path)));
      await originalSet({ ...foreign, path: "/alternate-cas", value: "new-manual-session" });
    }
    if (change === "additional-domain") await originalSet({ ...foreign, domain: ".sso.cqu.edu.cn", value: "new-manual-session" });
    if (change === "attributes") await originalSet({ ...foreign, httpOnly: false });
    if (change === "removed") fake.cookieStore.clear();
    if (change === "legacy") {
      const persisted = await readLocalState();
      Reflect.deleteProperty(persisted.managedSwitch!, "tgc");
      await chrome.storage.local.set({ [LOCAL_STATE_KEY]: persisted });
    }
    if (change === "during-write-preparation") {
      const save = chrome.storage.session.set.bind(chrome.storage.session);
      vi.spyOn(chrome.storage.session, "set").mockImplementation(async items => {
        await save(items);
        await originalSet({ ...foreign, value: "new-manual-session" });
      });
    }
    const before = [...fake.cookieStore.values()].map(cookie => ({ ...cookie }));
    const writes = vi.spyOn(chrome.cookies, "set");
    await sync("alarm");
    if (change === "unchanged") {
      expect(fake.getCookie("SOURCEID_TGC")?.value).toBe(envelope().cookies[0].value);
      expect(await readLocalState()).toMatchObject({ localWriteState: "ready", managedSwitch: null, pendingAck: false });
    } else {
      expect(writes).not.toHaveBeenCalled();
      if (change === "during-write-preparation") expect(fake.getCookie("SOURCEID_TGC")?.value).toBe("new-manual-session");
      else expect([...fake.cookieStore.values()]).toEqual(before);
      expect(await readLocalState()).toMatchObject({ localWriteState: "foreign_session", managedSwitch: null, receipt: null });
    }
  }
);

it("requires new consent after the first replacement write fails", async () => {
  await chrome.cookies.set({ url: "https://sso.cqu.edu.cn/", name: "SOURCEID_TGC", value: "consented-session", path: "/", storeId: "0" });
  await updateLocalState(state => ({ ...state, localWriteState: "foreign_session" }));
  setEnvelopeWriter(applyEnvelope);
  const writes = vi.spyOn(chrome.cookies, "set").mockRejectedValueOnce(new Error("write failed"));
  await switchToManagedOnce();
  await sync("popup");
  expect(writes).toHaveBeenCalledOnce();
  expect((await readLocalState()).managedSwitch).toBeNull();
  writes.mockClear();
  await sync("user_retry");
  expect(writes).not.toHaveBeenCalled();
  expect(fake.getCookie("SOURCEID_TGC")?.value).toBe("consented-session");
  expect((await readLocalState()).localWriteState).toBe("foreign_session");
  await switchToManagedOnce();
  await sync("popup");
  expect(fake.getCookie("SOURCEID_TGC")?.value).toBe(envelope().cookies[0].value);
  expect((await readLocalState()).localWriteState).toBe("ready");
});

it("preserves a new manual session that appears between replacement writes", async () => {
  await updateLocalState(state => ({ ...state, localWriteState: "foreign_session" }));
  const foreign = { url: "https://sso.cqu.edu.cn/", name: "SOURCEID_TGC", value: "consented-session", path: "/", storeId: "0" };
  await chrome.cookies.set(foreign);
  const exported = envelope();
  exported.cookies.unshift({ ...exported.cookies[0], name: "SESSION", value: "managed-auxiliary" });
  vi.mocked(api.exportSession).mockResolvedValue(exported);
  setEnvelopeWriter(applyEnvelope);
  const originalSet = chrome.cookies.set.bind(chrome.cookies);
  const writes = vi.spyOn(chrome.cookies, "set").mockImplementation(async details => {
    const written = await originalSet(details);
    if (details.name === "SESSION") await originalSet({ ...foreign, value: "new-manual-session" });
    return written;
  });
  await switchToManagedOnce();
  await sync("popup");
  expect(writes).toHaveBeenCalledOnce();
  expect(fake.getCookie("SOURCEID_TGC")?.value).toBe("new-manual-session");
  expect(fake.getCookie("SESSION")).toBeNull();
  expect(await readLocalState()).toMatchObject({ localWriteState: "foreign_session", managedSwitch: null, receipt: null });
});

it.each(["path", "domain"])("detects a new TGC %s appearing during the final replacement write", async kind => {
  await updateLocalState(state => ({ ...state, localWriteState: "foreign_session" }));
  const foreign = { url: "https://sso.cqu.edu.cn/", name: "SOURCEID_TGC", value: "consented-session", path: "/", storeId: "0" };
  await chrome.cookies.set(foreign);
  const previous = { ...fake.getCookie("SOURCEID_TGC")! };
  setEnvelopeWriter(applyEnvelope);
  const originalSet = chrome.cookies.set.bind(chrome.cookies);
  let added = false;
  vi.spyOn(chrome.cookies, "set").mockImplementation(async details => {
    if (!added) {
      added = true;
      await originalSet({ ...foreign, value: "new-manual-session",
        ...(kind === "path" ? { path: "/alternate-cas" } : { domain: ".sso.cqu.edu.cn" }) });
    }
    return originalSet(details);
  });
  await switchToManagedOnce();
  await sync("popup");
  expect(fake.getCookie("SOURCEID_TGC")).toEqual(previous);
  expect([...fake.cookieStore.values()].some(cookie => cookie.value === "new-manual-session")).toBe(true);
  expect(await readLocalState()).toMatchObject({ localWriteState: "foreign_session", managedSwitch: null, receipt: null });
});

it("consumes replacement consent once through the actual cookie writer", async () => {
  await chrome.cookies.set({url:"https://sso.cqu.edu.cn/",name:"SOURCEID_TGC",value:"synthetic-foreign",path:"/",storeId:"0"});
  await updateLocalState(s=>({...s,localWriteState:"foreign_session"}));
  setEnvelopeWriter(async (value,options) => {
    const result=await applyEnvelope(value,options);
    expect((await readLocalState()).managedSwitch).toBeNull();
    return result;
  });
  await switchToManagedOnce();
  await sync("popup");
  expect(await readLocalState()).toMatchObject({localWriteState:"ready",managedSwitch:null,pendingAck:false});
  await chrome.cookies.set({url:"https://sso.cqu.edu.cn/",name:"SOURCEID_TGC",value:"synthetic-new-manual",path:"/",storeId:"0"});
  await sync("alarm");
  expect((await chrome.cookies.get({url:"https://sso.cqu.edu.cn/",name:"SOURCEID_TGC",storeId:"0"}))?.value).toBe("synthetic-new-manual");
  expect((await readLocalState()).localWriteState).toBe("foreign_session");
});


it("resumes a confirmed pending switch after the background module restarts", async () => {
  await updateLocalState(s=>({...s,localWriteState:"foreign_session"}));
  const preparing=snapshot();preparing.cloud.state="logging_in";preparing.capabilities.canExport=false;
  vi.mocked(api.reconcile).mockResolvedValueOnce({ centralUserId: "central-user-a", snapshot:preparing,receiptAck:null });
  await switchToManagedOnce();
  await sync("popup");
  expect((await readLocalState()).managedSwitch).not.toBeNull();
  vi.resetModules();
  const freshApi=await import("./api-v3");
  const freshSync=await import("./sync");
  vi.spyOn(freshApi,"capabilities").mockResolvedValue({protocolVersion:3,supportedProtocolVersions:[3],minExtensionVersion:"0.2.0",serverBuild:"test",features:{reconcile:true,operations:true,receipts:true,overview:true}});
  vi.spyOn(freshApi,"reconcile").mockResolvedValue({ centralUserId: "central-user-a", snapshot:snapshot(),receiptAck:null });
  vi.spyOn(freshApi,"exportSession").mockResolvedValue(envelope());
  const writer=vi.fn().mockResolvedValue("foreign_session");freshSync.setEnvelopeWriter(writer);
  await freshSync.sync("startup");
  expect(writer).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({allowForeignOnce:true}));
});


it.each([false,true])("does not turn an acknowledged receipt into pending during background verification (pending=%s)", async pending => {
  setEnvelopeWriter(applyEnvelope);
  await sync("startup");
  await updateLocalState(s=>({...s,snapshot:readySnapshot(),pendingAck:pending,receipt:receipt(),localWriteState:"ready"}));
  let release!: () => void;
  let entered!: () => void;
  const began=new Promise<void>(resolve=>{entered=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  vi.mocked(api.reconcile).mockImplementationOnce(async()=>{entered();await gate;return { centralUserId: "central-user-a", snapshot:readySnapshot(),receiptAck:null };});
  const work=sync("popup");
  await began;
  const during=await readLocalState();
  release();await work;
  expect(during.pendingAck).toBe(pending);
  expect(derivePresentation(during.snapshot, {cookieState:"applied",receipt:during.receipt,pendingAck:during.pendingAck}).statusCode)
    .toBe(pending ? "pending_ack" : "ready");
});

it("re-exports when the server rejects a previously acknowledged receipt", async () => {
  setEnvelopeWriter(applyEnvelope);
  await sync("startup");
  await updateLocalState(s=>({...s,snapshot:readySnapshot(),pendingAck:false}));
  vi.mocked(api.exportSession).mockClear();
  vi.mocked(api.reconcile).mockImplementationOnce(async()=>{
    const local=await readLocalState();
    return {centralUserId:"central-user-a",snapshot:readySnapshot(),receiptAck:{snapshot:readySnapshot(),accepted:false,receivedAt:Date.now(),reasonCode:"INVALID_REQUEST",
      exportId:local.receipt!.exportId,acceptedTuple:null,reportEpoch:local.reportEpoch,clientReportSeq:local.clientReportSeq}};
  });
  await sync("popup");
  expect(api.exportSession).toHaveBeenCalledOnce();
});
