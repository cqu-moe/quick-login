import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { readySnapshot as snapshot, envelope } from "../test/protocol-fixtures";
import { initialLocalState, LOCAL_STATE_KEY, readLocalState } from "./storage";
import { handleContentMessage, handleMessage } from "./messages";
import { sync, setEnvelopeWriter, retryAutomaticNow, setEnabled } from "./sync";
import { applyEnvelope } from "./cookie-store";
import { derivePopupView, type PopupInput } from "../popup/view-model";
import * as api from "./api-v3";
import * as telemetry from "../shared/posthog";
import { onSchoolTabUpdated } from "./school-recovery";
import type { DeviceSnapshot, OperationResponse } from "../shared/protocol-v3.generated";

function operationResponse(value: DeviceSnapshot): OperationResponse {
  return { snapshot: value, operation: {
    operationId: "operation-a", command: "retry_session", versions: {
      deviceId: "device-a", generation: 4, bindingEpoch: 3, credentialRevision: 2, sessionVersion: 7,
    }, state: "retry_wait", stage: null, attempt: 1, createdAt: Date.now(), startedAt: Date.now(),
    deadlineAt: Date.now() + 300_000, completedAt: null, retryAt: value.cloud.retryAt,
    resultCode: value.cloud.reasonCode, cancelReason: null,
  } };
}

const sender = {
  id: "test-extension", tab: { id: 7 }, documentId: "rejected-session-document",
  url: "https://sso.cqu.edu.cn/login?service=https%3A%2F%2Fmy.cqu.edu.cn%2Fauthserver%2Fauthentication%2Fcas",
} as chrome.runtime.MessageSender;
let fake: ReturnType<typeof installChromeFake>;

async function startRecovery() {
  const waiting = snapshot();
  waiting.cloud = { ...waiting.cloud,state:"refreshing",operationId:"operation-a" };
  vi.mocked(api.reconcile).mockResolvedValue({centralUserId:"central-user-a",snapshot:waiting,receiptAck:null});
  vi.mocked(api.operate).mockResolvedValue(operationResponse(waiting));
  await handleContentMessage({type:"LOGIN_FORM_VISIBLE"},sender);
  await sync("alarm");
}

function publishNewSession(sessionVersion = 8) {
  const fresh = snapshot();
  fresh.versions = {...fresh.versions,sessionVersion,deviceRevision:sessionVersion+5};
  fresh.reportedLocal = null;
  vi.mocked(api.reconcile).mockResolvedValue({centralUserId:"central-user-a",snapshot:fresh,receiptAck:null});
  vi.mocked(api.exportSession).mockResolvedValue({...envelope(),sessionVersion,exportId:`export-${sessionVersion}`,
    cookies:envelope().cookies.map(cookie=>({...cookie,value:`synthetic-session-${sessionVersion}`}))});
  const acknowledge: typeof api.acknowledge = async applied => {
    const local = await readLocalState();
    return {accepted:true,exportId:applied.exportId,acceptedTuple:applied,reportEpoch:local.reportEpoch,
      clientReportSeq:local.clientReportSeq,receivedAt:Date.now(),reasonCode:null,
      snapshot:{...fresh,reportedLocal:{...snapshot().reportedLocal!,receipt:applied}}};
  };
  vi.mocked(api.acknowledge).mockImplementation(acknowledge);
  return acknowledge;
}

beforeEach(async () => {
  fake = installChromeFake();
  setEnvelopeWriter(applyEnvelope);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T01:30:00Z"));
  vi.spyOn(telemetry, "captureQuickloginOperation").mockImplementation(() => undefined);
  await chrome.storage.local.set({ [LOCAL_STATE_KEY]: {
    ...initialLocalState(), deviceId: "device-a", serverGeneration: 4,
    enabledIntent: true, authorization: "authorized", snapshot: snapshot(), observation: "fresh",
  } });
  vi.spyOn(api, "capabilities").mockResolvedValue({ protocolVersion: 3, supportedProtocolVersions: [2, 3],
    minExtensionVersion: "0.2.0", serverBuild: "test",
    features: { reconcile: true, operations: true, receipts: true, overview: true } });
  vi.spyOn(api, "reconcile").mockResolvedValue({ centralUserId: "central-user-a", snapshot: snapshot(), receiptAck: null });
  vi.spyOn(api, "exportSession").mockResolvedValue(envelope());
  vi.spyOn(api, "operate").mockResolvedValue(operationResponse(snapshot()));
  vi.spyOn(api, "acknowledge").mockImplementation(async applied => {
    const local = await readLocalState();
    return { accepted: true, exportId: applied.exportId, acceptedTuple: applied,
      reportEpoch: local.reportEpoch, clientReportSeq: local.clientReportSeq,
      receivedAt: Date.now(), reasonCode: null, snapshot: snapshot() };
  });
  await sync("startup");
  expect(derivePopupView(await handleMessage({ type: "GET_UI_STATE" }) as PopupInput).heading).toBe("已就绪");
});

afterEach(async () => { await sync("alarm"); vi.useRealTimers(); vi.restoreAllMocks(); });

it("withdraws ready as soon as the school login form is reported, before Auth responds", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  vi.mocked(api.reconcile).mockImplementation(async () => {
    started(); await gate;
    return { centralUserId: "central-user-a", snapshot: snapshot(), receiptAck: null };
  });
  const pending = handleContentMessage({ type: "LOGIN_FORM_VISIBLE" }, sender);
  try {
    await entered;
    expect(await pending).toMatchObject({kind:"recovering"});
    const view = derivePopupView(await handleMessage({ type: "GET_UI_STATE" }) as PopupInput);
    expect(view.heading).not.toBe("已就绪");
  } finally {
    release(); await pending; await sync("alarm");
  }
});

it("does not claim the current session is usable when a school login form triggers a retry wait", async () => {
  const retrying = snapshot();
  retrying.cloud = { ...retrying.cloud, state: "retry_wait", retryAt: Date.now() + 180_000,
    reasonCode: "SCHOOL_UNREACHABLE" };
  vi.mocked(api.reconcile).mockResolvedValue({ centralUserId: "central-user-a", snapshot: retrying, receiptAck: null });
  vi.mocked(api.operate).mockResolvedValue(operationResponse(retrying));
  await handleContentMessage({ type: "LOGIN_FORM_VISIBLE" }, sender);
  await sync("alarm");
  const view = derivePopupView(await handleMessage({ type: "GET_UI_STATE" }) as PopupInput);
  expect(view.heading).not.toMatch(/已就绪|当前可用/);
  expect(view.description).toContain("后重试");
});

it("does not navigate using a previous completed recovery while the cloud is still retrying", async () => {
  const retrying = snapshot();
  retrying.cloud = { ...retrying.cloud, state: "retry_wait", retryAt: Date.now() + 180_000,
    reasonCode: "SCHOOL_UNREACHABLE" };
  vi.mocked(api.reconcile).mockResolvedValue({ centralUserId: "central-user-a", snapshot: retrying, receiptAck: null });
  const result = await handleContentMessage({ type: "LOGIN_FORM_VISIBLE" }, sender);
  expect(result.kind).not.toBe("navigating");
  await sync("alarm");
  expect(await handleContentMessage({type:"GET_UI_STATE"},sender)).toMatchObject({kind:"recovering"});
  expect(fake.tabUpdates).toHaveLength(0);
});

it("waits for the new session ACK, then navigates the waiting document once and stops on another login form",async()=>{
  await startRecovery();
  const acknowledge=publishNewSession();
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  vi.mocked(api.acknowledge).mockImplementation(async applied=>{entered();await gate;return acknowledge(applied);});
  const syncing=sync("alarm");
  try {
    await started;
    expect(await handleContentMessage({type:"GET_UI_STATE"},sender)).toMatchObject({kind:"recovering"});
    expect(fake.tabUpdates).toHaveLength(0);
    expect(derivePopupView(await handleMessage({type:"GET_UI_STATE"}) as PopupInput).heading).toContain("正在确认");
  } finally {release();await syncing;}
  const retries=vi.mocked(api.operate).mock.calls.length;
  expect(await handleContentMessage({type:"LOGIN_FORM_VISIBLE"},sender)).toEqual({kind:"navigating"});
  expect(await handleContentMessage({type:"GET_UI_STATE"},sender)).toEqual({kind:"navigating"});
  expect(fake.tabUpdates).toHaveLength(1);
  expect(api.operate).toHaveBeenCalledTimes(retries);
  expect(await handleContentMessage({type:"LOGIN_FORM_VISIBLE"},{...sender,documentId:"still-login"}))
    .toMatchObject({kind:"manual_required"});
  expect(derivePopupView(await handleMessage({type:"GET_UI_STATE"}) as PopupInput).heading).not.toMatch(/已就绪|当前可用/);
});

it("shares an in-flight recovery between waiting tabs but never lends its completion to an unrelated page",async()=>{
  await startRecovery();
  const second={...sender,tab:{id:8},documentId:"second-waiter"} as chrome.runtime.MessageSender;
  await handleContentMessage({type:"LOGIN_FORM_VISIBLE"},second);
  await sync("alarm");
  publishNewSession();
  await sync("alarm");
  expect(await handleContentMessage({type:"GET_UI_STATE"},sender)).toEqual({kind:"navigating"});
  expect(await handleContentMessage({type:"GET_UI_STATE"},second)).toEqual({kind:"navigating"});
  const unrelated={...sender,tab:{id:9},documentId:"unrelated-page"} as chrome.runtime.MessageSender;
  expect(await handleContentMessage({type:"LOGIN_FORM_VISIBLE"},unrelated)).toMatchObject({kind:"recovering"});
  expect(fake.tabUpdates.map(update=>update.tabId)).toEqual([7,8]);
});

it("does not restore ready or navigate when manual input cancels an outstanding ACK",async()=>{
  await startRecovery();
  const acknowledge=publishNewSession();
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  vi.mocked(api.acknowledge).mockImplementation(async applied=>{entered();await gate;return acknowledge(applied);});
  const syncing=sync("alarm");
  try {
    await started;
    expect(await handleContentMessage({type:"ENTER_MANUAL"},sender)).toMatchObject({kind:"manual_required"});
  } finally {release();await syncing;}
  expect(await handleContentMessage({type:"GET_UI_STATE"},sender)).toMatchObject({kind:"manual_required"});
  expect(fake.tabUpdates).toHaveLength(0);
  expect(derivePopupView(await handleMessage({type:"GET_UI_STATE"}) as PopupInput).heading).toBe("手动登录中");
});

it("reapplies a missing browser Cookie without forcing another school login",async()=>{
  fake.cookieStore.clear();
  await handleContentMessage({type:"LOGIN_FORM_VISIBLE"},sender);
  await sync("alarm");
  expect(api.operate).not.toHaveBeenCalled();
  expect(await handleContentMessage({type:"GET_UI_STATE"},sender)).toEqual({kind:"navigating"});
  expect(fake.getCookie("SOURCEID_TGC")).not.toBeNull();
});

it("lets an explicit popup retry recover the document where the last navigation failed",async()=>{
  await startRecovery();
  publishNewSession();
  await sync("alarm");
  expect(await handleContentMessage({type:"GET_UI_STATE"},sender)).toEqual({kind:"navigating"});
  const rejectedPage={...sender,documentId:"login-after-recovery"};
  expect(await handleContentMessage({type:"LOGIN_FORM_VISIBLE"},rejectedPage)).toMatchObject({kind:"manual_required"});
  const operations=vi.mocked(api.operate).mock.calls.length;
  await sync("alarm");
  expect(await handleContentMessage({type:"GET_UI_STATE"},rejectedPage)).toMatchObject({kind:"manual_required"});
  expect(api.operate).toHaveBeenCalledTimes(operations);
  publishNewSession(9);
  await retryAutomaticNow();
  expect(await handleContentMessage({type:"GET_UI_STATE"},rejectedPage)).toEqual({kind:"navigating"});
  expect(fake.tabUpdates).toHaveLength(2);
});

it("starts a new recovery when the same tab returns after leaving the previous SSO visit",async()=>{
  await startRecovery();
  publishNewSession();
  await sync("alarm");
  expect(await handleContentMessage({type:"GET_UI_STATE"},sender)).toEqual({kind:"navigating"});
  await onSchoolTabUpdated(7,{status:"complete"},{id:7,url:sender.url} as chrome.tabs.Tab);
  expect((await readLocalState()).loginRecovery?.pages).toHaveLength(1);
  // No tabs permission: a completed visit outside our allowed hosts omits its URL.
  await onSchoolTabUpdated(7,{status:"complete"},{id:7} as chrome.tabs.Tab);
  const waiting={...(await readLocalState()).snapshot!};
  waiting.cloud={...waiting.cloud,state:"retry_wait",retryAt:Date.now()+60_000};
  vi.mocked(api.reconcile).mockResolvedValue({centralUserId:"central-user-a",snapshot:waiting,receiptAck:null});
  expect(await handleContentMessage({type:"LOGIN_FORM_VISIBLE"},{...sender,documentId:"later-sso-visit"}))
    .toMatchObject({kind:"recovering"});
  await sync("alarm");
  expect(fake.tabUpdates).toHaveLength(1);
  expect(derivePopupView(await handleMessage({type:"GET_UI_STATE"}) as PopupInput).heading).not.toMatch(/已就绪|当前可用/);
});

it("ignores a late recovery ACK after the extension is disabled",async()=>{
  await startRecovery();
  const acknowledge=publishNewSession();
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  vi.mocked(api.acknowledge).mockImplementation(async applied=>{entered();await gate;return acknowledge(applied);});
  const syncing=sync("alarm");
  await started;
  const disabling=setEnabled(false);
  try {
    await vi.waitFor(async()=>expect((await readLocalState()).enabledIntent).toBe(false));
  } finally {release();await Promise.all([syncing,disabling]);}
  expect(await handleContentMessage({type:"GET_UI_STATE"},sender)).toEqual({kind:"idle"});
  expect(fake.tabUpdates).toHaveLength(0);
  expect(derivePopupView(await handleMessage({type:"GET_UI_STATE"}) as PopupInput).heading).not.toMatch(/已就绪|当前可用/);
});

it("rejects page recovery requests outside the exact SSO login page",async()=>{
  await expect(handleContentMessage({type:"LOGIN_FORM_VISIBLE"},{...sender,url:"https://attacker.example/login"}))
    .rejects.toThrow("FORBIDDEN");
  expect(fake.tabUpdates).toHaveLength(0);
});
