import { describe, expect, it } from "vitest";
import { derivePopupView, type PopupInput } from "./view-model";
import { readySnapshot, receipt } from "../test/protocol-fixtures";

const input=(): PopupInput => ({ snapshot:readySnapshot(),local:{authorization:"authorized",enabledIntent:true,
  observation:"fresh",cookieState:"applied",receipt:receipt(),pendingAck:false},lastError:null,lastConfirmedAt:Date.now(),nextAttemptAt:null });

describe("current protocol popup projection",() => {
  it.each(["unverified","login_form_seen"] as const)("names malformed service responses without presenting a network outage (%s)",schoolAccess=>{
    const value=input();value.lastError="CONTRACT_INVALID";value.local.observation="unreachable";
    value.local.schoolAccess=schoolAccess;
    expect(derivePopupView(value)).toMatchObject({heading:"暂时无法读取服务状态",tone:"attention",actions:["retry"]});
  });
  it("offers local manual login for a device-only school challenge",()=>{
    const value=input();value.snapshot!.cloud={...value.snapshot!.cloud,state:"blocked",usableUntil:null,reasonCode:"INTERACTION_REQUIRED"};
    expect(derivePopupView(value).actions).toEqual(["manual_login"]);
  });
  it("reconnects the existing device through Auth instead of creating another grant blindly",()=>{
    const value=input();value.local.authorization="reconnect_required";
    expect(derivePopupView(value).actions).toEqual(["open_settings"]);
  });
  it("is ready only after the current-version application was acknowledged",() => {
    expect(derivePopupView(input()).heading).toBe("已就绪");
    const pending=input();pending.local.pendingAck=true;
    expect(derivePopupView(pending)).toMatchObject({heading:"正在准备学校登录",description:expect.stringContaining("正在确认"),actions:[]});
  });
  it("reports a failed observation instead of repeating an old rebind instruction",() => {
    const value=input();value.local.observation="unreachable";
    expect(derivePopupView(value).heading).toBe("暂时无法连接 Auth");
  });
  it("shows a password action only for current explicit rejection",() => {
    const value=input();value.snapshot!.binding={...value.snapshot!.binding,credentialsState:"rejected",evidenceKind:"password_rejected"};
    value.snapshot!.cloud={...value.snapshot!.cloud,state:"blocked",usableUntil:null};
    expect(derivePopupView(value).heading).toBe("学校密码需要更新");
    expect(derivePopupView(value).actions).toEqual(["open_settings"]);
  });
  it("keeps an Auth recovery action when local off hides a server policy block",()=>{
    const value=input();value.local.enabledIntent=false;
    value.snapshot!.authorization.policy="master_off";
    value.snapshot!.authorization.masterEnabled=false;
    value.snapshot!.capabilities.canEnable=false;
    expect(derivePopupView(value)).toMatchObject({switchEnabled:false,actions:["open_settings"]});
  });
  it("keeps a close control available while the cloud is preparing",() => {
    const value=input();value.snapshot!.cloud.state="logging_in";value.snapshot!.cloud.usableUntil=null;
    expect(derivePopupView(value).switchEnabled).toBe(true);
  });
});
