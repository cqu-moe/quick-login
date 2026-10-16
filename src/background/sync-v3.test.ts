import { derivePresentation } from "../shared/protocol-v3.generated";
import { applyEnvelope } from "./cookie-store";
import { beforeEach, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { snapshot, readySnapshot, envelope, receipt } from "../test/protocol-fixtures";
import { initialLocalState, LOCAL_STATE_KEY, readLocalState, updateLocalState } from "./storage";
import { setEnabled, setEnvelopeWriter, sync, switchToManagedOnce } from "./sync";
import { JOURNAL_KEY } from "./cookie-journal";
import { observeSchoolLogin } from "./school-recovery";
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

it.each(["new-session", "school-form"])("does not let a prior local rotation block %s", async transition => {
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
  expect((await readLocalState()).receipt?.result).not.toBe("applied");

  if (transition === "school-form") {
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


it("keeps a confirmed switch when reconciliation advances only the cloud session", async () => {
  await updateLocalState(s=>({...s,localWriteState:"foreign_session"}));
  const remote=snapshot(); remote.versions.sessionVersion+=1;
  vi.mocked(api.reconcile).mockResolvedValue({ centralUserId: "central-user-a", snapshot:remote,receiptAck:null });
  vi.mocked(api.exportSession).mockResolvedValue({...envelope(),sessionVersion:remote.versions.sessionVersion});
  const writer=vi.fn().mockResolvedValue("applied");setEnvelopeWriter(writer);
  await switchToManagedOnce();
  expect(writer).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({allowForeignOnce:true}));
});

it("keeps the switch through cloud preparation until the next alarm can apply cookies", async () => {
  await updateLocalState(s=>({...s,localWriteState:"foreign_session"}));
  const preparing=snapshot();preparing.cloud.state="logging_in";preparing.capabilities.canExport=false;
  vi.mocked(api.reconcile).mockResolvedValueOnce({ centralUserId: "central-user-a", snapshot:preparing,receiptAck:null });
  const writer=vi.fn().mockResolvedValue("applied");setEnvelopeWriter(writer);
  await switchToManagedOnce();
  expect(api.operate).not.toHaveBeenCalled();
  await sync("alarm");
  expect(writer).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({allowForeignOnce:true}));
});


it.each(["disable", "manual", "reauthorize", "binding", "expire"])("cancels pending switch after %s", async kind => {
  await updateLocalState(s=>({...s,localWriteState:"foreign_session"}));
  const preparing=snapshot();preparing.cloud.state="logging_in";preparing.capabilities.canExport=false;
  vi.mocked(api.reconcile).mockResolvedValueOnce({ centralUserId: "central-user-a", snapshot:preparing,receiptAck:null });
  await switchToManagedOnce();
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

it("consumes replacement consent once through the actual cookie writer", async () => {
  await chrome.cookies.set({url:"https://sso.cqu.edu.cn/",name:"SOURCEID_TGC",value:"synthetic-foreign",path:"/",storeId:"0"});
  await updateLocalState(s=>({...s,localWriteState:"foreign_session"}));
  setEnvelopeWriter(async (value,options) => {
    const result=await applyEnvelope(value,options);
    expect((await readLocalState()).managedSwitch).toBeNull();
    return result;
  });
  await switchToManagedOnce();
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
