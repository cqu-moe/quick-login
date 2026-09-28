import { beforeEach, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { readySnapshot, response, receipt } from "../test/protocol-fixtures";
import { readLocalState, updateLocalState } from "./storage";
import { sync, setEnabled } from "./sync";
import { handleMessage } from "./messages";
import { derivePopupView } from "../popup/view-model";
import { handleExternalMessage } from "./external";
import { SYNC_ALARM } from "../shared/config";

beforeEach(() => installChromeFake());

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
  await updateLocalState(state=>({...state,deviceId:"device-a",authorization:"reconnect_required",enabledIntent:false}));
  const remote=readySnapshot();
  remote.cloud={...remote.cloud,state:"logging_in",usableUntil:null};
  remote.capabilities={...remote.capabilities,canEnsure:false,canExport:false};
  vi.spyOn(chrome.identity,"launchWebAuthFlow").mockImplementation(async({url})=>
    `${chrome.identity.getRedirectURL()}?code=synthetic&state=${new URL(url).searchParams.get("state")}`);
  const fetcher=vi.fn(async(input: RequestInfo | URL, _init?: RequestInit)=>{
    const url=String(input);
    if (url.endsWith("/oauth2/token")) return Response.json({access_token:"fresh",refresh_token:"new-refresh",expires_in:300});
    if (url.endsWith("/registrations")) return Response.json(response({deviceId:"device-a",snapshot:remote}));
    if (url.endsWith("/reconcile")) return Response.json(response({snapshot:remote,receiptAck:null}));
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
});
