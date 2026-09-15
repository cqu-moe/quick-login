import { beforeEach, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { snapshot, envelope, receipt } from "../test/protocol-fixtures";
import { initialLocalState, LOCAL_STATE_KEY, readLocalState, updateLocalState } from "./storage";
import { setEnvelopeWriter, sync } from "./sync";
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
