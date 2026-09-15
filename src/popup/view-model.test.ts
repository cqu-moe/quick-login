import { describe, expect, it } from "vitest";
import { derivePopupView, type PopupInput } from "./view-model";
import { readySnapshot, receipt } from "../test/protocol-fixtures";

const input=(): PopupInput => ({ snapshot:readySnapshot(),local:{authorization:"authorized",enabledIntent:true,
  observation:"fresh",cookieState:"applied",receipt:receipt(),pendingAck:false},lastError:null,lastConfirmedAt:Date.now(),nextAttemptAt:null });

describe("current protocol popup projection",() => {
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
    expect(derivePopupView(pending).heading).toContain("正在确认");
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
  it("keeps a close control available while the cloud is preparing",() => {
    const value=input();value.snapshot!.cloud.state="logging_in";value.snapshot!.cloud.usableUntil=null;
    expect(derivePopupView(value).switchEnabled).toBe(true);
  });
});
