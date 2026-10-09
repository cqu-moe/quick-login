import { beforeEach, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { readySnapshot, response, receipt } from "../test/protocol-fixtures";
import { readLocalState, updateLocalState } from "./storage";
import { sync, setEnabled } from "./sync";
import { handleMessage } from "./messages";
import { derivePopupView } from "../popup/view-model";
import { handleExternalMessage } from "./external";
import { SYNC_ALARM } from "../shared/config";
import type { ReconcileRequest } from "../shared/protocol-v3.generated";

beforeEach(() => installChromeFake());

it("recovers an installed device's rejected report epoch without replacing its authorization", async () => {
  const remote = readySnapshot();
  remote.cloud = { ...remote.cloud, state: "logging_in", usableUntil: null };
  remote.capabilities = { ...remote.capabilities, canEnsure: false, canExport: false };
  remote.reportedLocal = { ...remote.reportedLocal!, reportEpoch: "server-epoch", clientReportSeq: 6477 };
  await updateLocalState(state => ({ ...state, deviceId: "device-a", installationId: "installation-a",
    authorization: "authorized", enabledIntent: true, snapshot: remote, serverGeneration: 4,
    reportEpoch: "local-epoch", clientReportSeq: 6503, receipt: receipt(), pendingAck: true }));
  const tokens = { accessToken: "synthetic", refreshToken: "synthetic", expiresAt: Date.now() + 300_000 };
  await chrome.storage.local.set({ "quicklogin.tokens": tokens });
  const reports: ReconcileRequest[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/capabilities")) return Response.json(response({ protocolVersion: 3,
      supportedProtocolVersions: [3], minExtensionVersion: "0.2.0", serverBuild: "test",
      features: { reconcile: true, operations: true, receipts: true, overview: true } }));
    if (!String(input).endsWith("/reconcile")) throw new Error("Unexpected request");
    const report = JSON.parse(String(init?.body));
    reports.push(report);
    if (reports.length === 1) return Response.json({ type: "about:blank", title: "INVALID_REQUEST",
      status: 422, detail: "INVALID_REQUEST", code: "INVALID_REQUEST", requestId: report.requestId,
      retryAt: null, action: "reconcile" }, { status: 422 });
    return Response.json(response({ snapshot: { ...remote, reportedLocal: { ...remote.reportedLocal,
      ...report.local, reportEpoch: report.reportEpoch, clientReportSeq: report.clientReportSeq } }, receiptAck: null }));
  }));

  await sync("startup");

  expect(reports).toHaveLength(2);
  expect(reports[1]).toMatchObject({ reportEpoch: "server-epoch", clientReportSeq: 6505,
    local: { enabledIntent: true, cookieState: "unknown", receipt: null } });
  expect(await readLocalState()).toMatchObject({ authorization: "authorized", localError: null,
    reportEpoch: "server-epoch", clientReportSeq: 6505, receipt: null, pendingAck: false });
  expect((await chrome.storage.local.get("quicklogin.tokens"))["quicklogin.tokens"]).toEqual(tokens);
});

it.each(["same epoch", "other installation", "other device", "rejected candidate", "unconfirmed candidate"])(
  "stops retrying and preserves the device when epoch recovery has %s", async scenario => {
    const remote = readySnapshot();
    remote.reportedLocal = { ...remote.reportedLocal!, reportEpoch: "server-epoch" };
    if (scenario === "same epoch") remote.reportedLocal.reportEpoch = "local-epoch";
    if (scenario === "other installation") remote.identity.installationId = "other-installation";
    if (scenario === "other device") remote.identity.deviceId = "other-device";
    await updateLocalState(state => ({ ...state, deviceId: "device-a", installationId: "installation-a",
      authorization: "authorized", enabledIntent: true, snapshot: remote, reportEpoch: "local-epoch" }));
    await chrome.storage.local.set({ "quicklogin.tokens": {
      accessToken: "synthetic", refreshToken: "synthetic", expiresAt: Date.now() + 300_000,
    } });
    const fetcher = vi.fn(async () => {
      if (scenario === "unconfirmed candidate" && fetcher.mock.calls.length === 2) {
        return Response.json(response({ snapshot: remote, receiptAck: null }));
      }
      return Response.json({ type: "about:blank", title: "INVALID_REQUEST", status: 422,
        detail: "INVALID_REQUEST", code: "INVALID_REQUEST", requestId: "request-a",
        retryAt: null, action: "reconcile" }, { status: 422 });
    });
    vi.stubGlobal("fetch", fetcher);
    await sync("popup");
    await sync("alarm");
    await sync("user_retry");
    expect(fetcher).toHaveBeenCalledTimes(scenario.endsWith("candidate") ? 2 : 1);
    expect(await readLocalState()).toMatchObject({ deviceId: "device-a", reportEpoch: "local-epoch",
      authorization: "reconnect_required", nextAttemptAt: null });
    expect(await chrome.alarms.get(`${SYNC_ALARM}-retry`)).toBeUndefined();
    const ui = await handleMessage({ type: "GET_UI_STATE" });
    expect(derivePopupView(ui as Parameters<typeof derivePopupView>[0]).heading).toBe("需要重新连接 Auth");
  },
);

it("preserves the report epoch and sequence when the updated background starts", async () => {
  const remote = readySnapshot();
  remote.cloud = { ...remote.cloud, state: "logging_in", usableUntil: null };
  remote.capabilities = { ...remote.capabilities, canEnsure: false, canExport: false };
  await updateLocalState(state => ({ ...state, deviceId: "device-a", installationId: "installation-a",
    authorization: "authorized", enabledIntent: true, snapshot: remote, serverGeneration: 4,
    reportEpoch: "persisted-epoch", clientReportSeq: 6503 }));
  const tokens = { accessToken: "synthetic", refreshToken: "synthetic", expiresAt: Date.now() + 300_000 };
  await chrome.storage.local.set({ "quicklogin.tokens": tokens });
  const reports: ReconcileRequest[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/capabilities")) return Response.json(response({ protocolVersion: 3,
      supportedProtocolVersions: [3], minExtensionVersion: "0.2.0", serverBuild: "test",
      features: { reconcile: true, operations: true, receipts: true, overview: true } }));
    if (!String(input).endsWith("/reconcile")) throw new Error("Unexpected request");
    const report = JSON.parse(String(init?.body));
    reports.push(report);
    return Response.json(response({ snapshot: remote, receiptAck: null }));
  }));
  await import("./index");
  await vi.waitFor(async () => expect((await readLocalState()).lastConfirmedAt).not.toBeNull());
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({ reportEpoch: "persisted-epoch", clientReportSeq: 6504 });
  expect(await readLocalState()).toMatchObject({ reportEpoch: "persisted-epoch", clientReportSeq: 6504 });
  expect((await chrome.storage.local.get("quicklogin.tokens"))["quicklogin.tokens"]).toEqual(tokens);
});

it("routes an invalid refresh grant to original-device recovery even after closing", async () => {
  const remote=readySnapshot();remote.capabilities.canEnable=false;
  await updateLocalState(state=>({...state,deviceId:"device-a",authorization:"authorized",
    enabledIntent:true,snapshot:remote,serverGeneration:remote.versions.generation,observation:"fresh"}));
  await chrome.storage.local.set({"quicklogin.tokens":{accessToken:"expired",refreshToken:"invalid",expiresAt:0}});
  const fetcher=vi.fn(async()=>Response.json({code:"INVALID_GRANT",message:"invalid refresh token"},{status:400}));
  vi.stubGlobal("fetch",fetcher);
  await chrome.alarms.create(`${SYNC_ALARM}-retry`,{when:Date.now()+30_000});

  await sync("popup");
  await setEnabled(false);
  await handleMessage({type:"CHECK_STATE"});
  await sync("user_retry");
  expect(await readLocalState()).toMatchObject({deviceId:"device-a",authorization:"reconnect_required",enabledIntent:false,nextAttemptAt:null});
  expect(await chrome.alarms.get(`${SYNC_ALARM}-retry`)).toBeUndefined();
  expect(fetcher).toHaveBeenCalledOnce();
  const input=await handleMessage({type:"GET_UI_STATE"});
  expect(derivePopupView(input as Parameters<typeof derivePopupView>[0])).toMatchObject({
    heading:"需要重新连接 Auth",actions:["open_settings"],switchVisible:false,
  });
  const open=vi.spyOn(chrome.tabs,"create");
  await handleMessage({type:"OPEN_SETTINGS"});
  expect(open).toHaveBeenCalledWith({url:"https://auth.cqu.moe/settings?quickloginDevice=device-a&quickloginReconnect=1"});
});

it("resumes the original device and allows sync after fresh authorization", async () => {
  await updateLocalState(state=>({...state,deviceId:"device-a",authorization:"reconnect_required",enabledIntent:false,
    reportEpoch:"previous-grant-epoch",clientReportSeq:100}));
  const remote=readySnapshot();
  remote.cloud={...remote.cloud,state:"logging_in",usableUntil:null};
  remote.capabilities={...remote.capabilities,canEnsure:false,canExport:false};
  vi.spyOn(chrome.identity,"launchWebAuthFlow").mockImplementation(async({url})=>
    `${chrome.identity.getRedirectURL()}?code=synthetic&state=${new URL(url).searchParams.get("state")}`);
  let registrationFinished = false;
  let epochAtRegistration: string | undefined;
  const prematureReports: string[] = [];
  const fetcher=vi.fn(async(input: RequestInfo | URL, _init?: RequestInit)=>{
    const url=String(input);
    if (url.endsWith("/oauth2/token")) return Response.json({access_token:"fresh",refresh_token:"new-refresh",expires_in:300});
    if (url.endsWith("/registrations")) {
      const registering = await readLocalState();
      epochAtRegistration = registering.reportEpoch;
      expect(epochAtRegistration).not.toBe("previous-grant-epoch");
      expect(registering.clientReportSeq).toBe(0);
      await sync("alarm");
      registrationFinished = true;
      return Response.json(response({deviceId:"device-a",snapshot:remote}));
    }
    if (url.endsWith("/reconcile")) {
      if (!registrationFinished) prematureReports.push(JSON.parse(String(_init?.body)).reportEpoch);
      return Response.json(response({snapshot:remote,receiptAck:null}));
    }
    if (url.endsWith("/capabilities")) return Response.json(response({ protocolVersion: 3,
      supportedProtocolVersions: [3], minExtensionVersion: "0.2.0", serverBuild: "test",
      features: { reconcile: true, operations: true, receipts: true, overview: true } }));
    if (url.endsWith("/operations")) return Response.json(response({snapshot:remote,operation:{
      operationId:"enable-a",command:"set_enabled",versions:receipt(),state:"succeeded",stage:null,attempt:1,
      createdAt:Date.now(),startedAt:Date.now(),deadlineAt:null,completedAt:Date.now(),retryAt:null,resultCode:null,cancelReason:null,
    }}));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch",fetcher);
  await handleExternalMessage({type:"RESUME_DEVICE",deviceId:"device-a",resumeTicket:"synthetic-ticket",expiresAt:Date.now()+60_000},
    {url:"https://auth.cqu.moe/settings",frameId:0});
  await vi.waitFor(async()=>expect(await readLocalState()).toMatchObject({deviceId:"device-a",authorization:"authorized",
    enabledIntent:true,connectIntentId:null,pendingCommand:null,observation:"fresh",localError:null}));
  const registration=fetcher.mock.calls.find(([url])=>String(url).endsWith("/registrations"));
  expect(JSON.parse(String(registration?.[1]?.body))).toMatchObject({deviceId:"device-a",resumeTicket:"synthetic-ticket"});
  const enable=fetcher.mock.calls.find(([url])=>String(url).endsWith("/operations"));
  expect(JSON.parse(String(enable?.[1]?.body))).toMatchObject({command:"set_enabled",enabled:true});
  expect(fetcher.mock.calls.some(([url])=>String(url).endsWith("/devices/device-a/reconcile"))).toBe(true);
  expect(prematureReports).toEqual([]);
  expect((await readLocalState()).reportEpoch).toBe(epochAtRegistration);
});
