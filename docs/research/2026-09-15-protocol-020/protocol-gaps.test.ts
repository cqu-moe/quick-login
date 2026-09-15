import {beforeEach,expect,it,vi} from "vitest";
import {installChromeFake} from "../../../src/test/chrome-fake";
import {snapshot,envelope,receipt} from "../../../src/test/protocol-fixtures";
import {initialLocalState,LOCAL_STATE_KEY,readLocalState,updateLocalState} from "../../../src/background/storage";
import * as api from "../../../src/background/api-v3";
import {setEnvelopeWriter,sync} from "../../../src/background/sync";
import {handleMessage} from "../../../src/background/messages";
import {derivePopupView} from "../../../src/popup/view-model";
import {QuickloginLoginBrokerClient} from "auth-source/services/quicklogin/login-broker-client";

beforeEach(async()=>{
  installChromeFake();
  await chrome.storage.local.set({[LOCAL_STATE_KEY]:{...initialLocalState(),deviceId:"device-a",serverGeneration:4,
    enabledIntent:true,authorization:"authorized",snapshot:snapshot(),observation:"fresh"}});
  vi.spyOn(api,"reconcile").mockResolvedValue({snapshot:snapshot(),receiptAck:null});
  vi.spyOn(api,"exportSession").mockResolvedValue(envelope());
  vi.spyOn(api,"operate").mockImplementation(async()=>{
    const remote=snapshot();remote.cloud.state="logging_in";remote.capabilities.canExport=false;
    return {snapshot:remote,operation:{operationId:"operation-a",command:"retry_session",versions:receipt(),state:"running",
      stage:"authenticating",attempt:1,createdAt:Date.now(),startedAt:Date.now(),deadlineAt:Date.now()+300_000,
      completedAt:null,retryAt:null,resultCode:null,cancelReason:null}};
  });
  vi.spyOn(api,"acknowledge").mockImplementation(async(applied)=>{
    const local=await readLocalState();return {accepted:true,exportId:applied.exportId,acceptedTuple:applied,
      reportEpoch:local.reportEpoch,clientReportSeq:local.clientReportSeq,receivedAt:Date.now(),reasonCode:null,snapshot:snapshot()};
  });
  setEnvelopeWriter(vi.fn().mockResolvedValue("applied"));
});
it("R1: a failed observation cannot claim current readiness",async()=>{
  vi.mocked(api.reconcile).mockRejectedValue(new TypeError("synthetic network failure"));
  await sync("alarm");
  expect(derivePopupView(await handleMessage({type:"GET_UI_STATE"})).heading).toBe("暂时无法连接 Auth");
});
it("R2: generation changes invalidate a version-only application receipt",async()=>{
  await updateLocalState(state=>({...state,appliedVersion:7,receipt:receipt(),localWriteState:"ready"}));
  const remote=snapshot();remote.versions.generation=5;
  vi.mocked(api.reconcile).mockResolvedValue({snapshot:remote,receiptAck:null});
  vi.mocked(api.exportSession).mockResolvedValue({...envelope(),generation:5});
  await sync("alarm");
  expect(api.exportSession).toHaveBeenCalledOnce();
});
it("R3: explicit retry requests server recovery",async()=>{
  const remote=snapshot();remote.cloud.state="retry_wait";remote.cloud.usableUntil=null;remote.capabilities.canExport=false;
  vi.mocked(api.reconcile).mockResolvedValue({snapshot:remote,receiptAck:null});
  await sync("user_retry");
  expect(api.operate).toHaveBeenCalledWith("retry_session",expect.anything(),expect.any(String));
});
it("R4: a failed observation marks an old credential error as historical",async()=>{
  const remote=snapshot();remote.binding.credentialsState="rejected";remote.binding.evidenceKind="password_rejected";
  remote.cloud.state="blocked";remote.cloud.usableUntil=null;
  await updateLocalState(state=>({...state,snapshot:remote}));
  vi.mocked(api.reconcile).mockRejectedValue(new TypeError("synthetic network failure"));
  await sync("alarm");
  expect(derivePopupView(await handleMessage({type:"GET_UI_STATE"})).heading).toBe("暂时无法连接 Auth");
});
it("R5: binding service failure is unavailable, not unbound",async()=>{
  const broker=new QuickloginLoginBrokerClient({CQU_SESSION:{idFromName:(name:string)=>name,
    get:()=>({fetch:async()=>new Response(null,{status:503})})}} as never);
  await expect(broker.getQuickloginBindingEpoch("synthetic-user")).rejects.toThrow();
});
