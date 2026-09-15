import { derivePresentation } from "../shared/protocol-v3.generated";
import { applyEnvelope } from "./cookie-store";
import { beforeEach, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { snapshot, readySnapshot, envelope, receipt } from "../test/protocol-fixtures";
import { initialLocalState, LOCAL_STATE_KEY, readLocalState, updateLocalState } from "./storage";
import { setEnvelopeWriter, sync, switchToManagedOnce } from "./sync";
import * as api from "./api-v3";
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

beforeEach(async () => {
  installChromeFake();
  await chrome.storage.local.set({ [LOCAL_STATE_KEY]: {
    ...initialLocalState(), deviceId: "device-a", serverGeneration: 4, enabledIntent: true,
    authorization: "authorized", snapshot: snapshot(), observation: "fresh",
  } });
  vi.spyOn(api, "capabilities").mockResolvedValue({ protocolVersion: 3, supportedProtocolVersions: [2,3],
    minExtensionVersion: "0.2.0", serverBuild: "test", features: { reconcile:true, operations:true, receipts:true, overview:true } });
  vi.spyOn(api, "reconcile").mockResolvedValue({ snapshot: snapshot(), receiptAck: null });
  vi.spyOn(api, "exportSession").mockResolvedValue(envelope());
  vi.spyOn(api, "operate").mockImplementation(async () => operationResponse({ ...snapshot(), cloud: { ...snapshot().cloud, state: "logging_in" } }));
  vi.spyOn(api, "acknowledge").mockImplementation(async(applied)=>{
    const local=await readLocalState();
    return {accepted:true,exportId:applied.exportId,acceptedTuple:applied,reportEpoch:local.reportEpoch,
      clientReportSeq:local.clientReportSeq,receivedAt:Date.now(),reasonCode:null,snapshot:snapshot()};
  });
});

it("records unreachable observation instead of retaining a current ready claim", async () => {
  vi.mocked(api.reconcile).mockRejectedValue(new TypeError("offline"));
  await sync("alarm");
  expect(await readLocalState()).toMatchObject({ observation:"unreachable", localError:"INTERNAL_STATE_UNAVAILABLE" });
});

it("applies and acknowledges the exact current generation even when the session number matches", async () => {
  await updateLocalState((state) => ({ ...state, appliedVersion:7, receipt:receipt(), localWriteState:"ready" }));
  const remote = snapshot(); remote.versions.generation = 5;
  vi.mocked(api.reconcile).mockResolvedValue({ snapshot:remote, receiptAck:null });
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
  vi.mocked(api.reconcile).mockResolvedValue({ snapshot:remote, receiptAck:null });
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

it("schedules a background check while a durable server operation runs", async () => {
  const remote=snapshot(); remote.cloud.state="logging_in"; remote.capabilities.canExport=false;
  vi.mocked(api.reconcile).mockResolvedValue({ snapshot:remote,receiptAck:null });
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
  vi.mocked(api.reconcile).mockResolvedValue({snapshot:remote,receiptAck:null});
  await sync('alarm');
  if (starts) expect(api.operate).toHaveBeenCalledWith('ensure_session',expect.anything(),expect.any(String));
  else expect(api.operate).not.toHaveBeenCalled();
});


it("keeps a confirmed switch when reconciliation advances only the cloud session", async () => {
  await updateLocalState(s=>({...s,localWriteState:"foreign_session"}));
  const remote=snapshot(); remote.versions.sessionVersion+=1;
  vi.mocked(api.reconcile).mockResolvedValue({snapshot:remote,receiptAck:null});
  vi.mocked(api.exportSession).mockResolvedValue({...envelope(),sessionVersion:remote.versions.sessionVersion});
  const writer=vi.fn().mockResolvedValue("applied");setEnvelopeWriter(writer);
  await switchToManagedOnce();
  expect(writer).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({allowForeignOnce:true}));
});

it("keeps the switch through cloud preparation until the next alarm can apply cookies", async () => {
  await updateLocalState(s=>({...s,localWriteState:"foreign_session"}));
  const preparing=snapshot();preparing.cloud.state="logging_in";preparing.capabilities.canExport=false;
  vi.mocked(api.reconcile).mockResolvedValueOnce({snapshot:preparing,receiptAck:null});
  const writer=vi.fn().mockResolvedValue("applied");setEnvelopeWriter(writer);
  await switchToManagedOnce();
  expect(api.operate).not.toHaveBeenCalled();
  await sync("alarm");
  expect(writer).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({allowForeignOnce:true}));
});


it.each(["disable", "manual", "reauthorize", "binding", "expire"])("cancels pending switch after %s", async kind => {
  await updateLocalState(s=>({...s,localWriteState:"foreign_session"}));
  const preparing=snapshot();preparing.cloud.state="logging_in";preparing.capabilities.canExport=false;
  vi.mocked(api.reconcile).mockResolvedValueOnce({snapshot:preparing,receiptAck:null});
  await switchToManagedOnce();
  await updateLocalState(s=>({...s,
    enabledIntent:kind==="disable"?false:s.enabledIntent,
    manualOverride:kind==="manual"?true:s.manualOverride,
    authGeneration:s.authGeneration+(kind==="reauthorize"?1:0),
    managedSwitch:kind==="expire"&&s.managedSwitch?{...s.managedSwitch,expiresAt:0}:s.managedSwitch,
  }));
  if(kind==="binding") {const remote=snapshot();remote.versions.bindingEpoch=4;vi.mocked(api.reconcile).mockResolvedValue({snapshot:remote,receiptAck:null});}
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
  vi.mocked(api.reconcile).mockResolvedValueOnce({snapshot:preparing,receiptAck:null});
  await switchToManagedOnce();
  expect((await readLocalState()).managedSwitch).not.toBeNull();
  vi.resetModules();
  const freshApi=await import("./api-v3");
  const freshSync=await import("./sync");
  vi.spyOn(freshApi,"capabilities").mockResolvedValue({protocolVersion:3,supportedProtocolVersions:[3],minExtensionVersion:"0.2.0",serverBuild:"test",features:{reconcile:true,operations:true,receipts:true,overview:true}});
  vi.spyOn(freshApi,"reconcile").mockResolvedValue({snapshot:snapshot(),receiptAck:null});
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
  vi.mocked(api.reconcile).mockImplementationOnce(async()=>{entered();await gate;return {snapshot:readySnapshot(),receiptAck:null};});
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
    return {snapshot:readySnapshot(),receiptAck:{snapshot:readySnapshot(),accepted:false,receivedAt:Date.now(),reasonCode:"INVALID_REQUEST",
      exportId:local.receipt!.exportId,acceptedTuple:null,reportEpoch:local.reportEpoch,clientReportSeq:local.clientReportSeq}};
  });
  await sync("popup");
  expect(api.exportSession).toHaveBeenCalledOnce();
});
