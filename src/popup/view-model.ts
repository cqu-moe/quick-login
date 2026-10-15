import { derivePresentation, type DeviceSnapshot, type LocalPresentation, type ReasonCode, type ActionTarget } from "../shared/protocol-v3.generated";

export type PopupAction = "login" | "open_settings" | "resume" | "switch_managed" | "retry" | "retry_local" | "update" | "fix_permissions" | "manual_login";
export interface PopupInput {
  deviceId?:string|null;
  snapshot: DeviceSnapshot | null;
  local: LocalPresentation;
  lastError: ReasonCode | null;
  lastConfirmedAt: number | null;
  nextAttemptAt: number | null;
  recoveryFailed?: boolean;
}
export interface PopupView {
  heading:string;description:string;tone:"ready"|"busy"|"attention"|"neutral";
  switchEnabled:boolean;switchChecked:boolean;switchVisible?:boolean;
  actions:PopupAction[];actionTarget?:ActionTarget;
}
export function derivePopupView(input: PopupInput): PopupView {
  const rejected = input.local.schoolAccess === "login_form_seen";
  // A local login form is newer evidence than the cloud's estimated expiry.
  const snapshot = rejected && input.snapshot ? { ...input.snapshot,
    capabilities:{ ...input.snapshot.capabilities,canUseExistingSession:false } } : input.snapshot;
  let state=derivePresentation(snapshot,input.local);
  if (rejected && state.statusCode === "unknown" && state.reasonCode === null) {
    state = input.recoveryFailed
      ? { ...state,title:"快捷登录未成功",detail:"请在学校页面手动登录，或重试快捷登录。",actionCode:"retry_session" }
      : { ...state,statusCode:"refreshing",title:"正在恢复学校登录",detail:"学校登录已失效，正在获取新的登录状态。",actionCode:"none" };
  }
  const actions:Partial<Record<typeof state.actionCode,PopupAction>>={
    connect_auth:"login",update_extension:"update",open_auth:"open_settings",manage_devices:"open_settings",
    resume_automatic:"resume",switch_to_quicklogin:"switch_managed",reconcile:"retry",bind_school:"open_settings",
    update_password:"open_settings",complete_verification:"manual_login",retry_session:"retry",
    fix_permissions:"fix_permissions",retry_local:"retry_local",confirm_receipt:"retry_local",
  };
  const action=state.statusCode === "reconnect_required" && (input.deviceId ?? input.snapshot?.identity.deviceId)
    ? "open_settings" : actions[state.actionCode];
  const authorized=input.local.authorization === "authorized" && input.snapshot?.authorization.state === "authorized";
  const enabled=input.local.enabledIntent ?? input.snapshot?.authorization.deviceEnabled ?? false;
  const switchEnabled=authorized && (enabled || input.snapshot?.capabilities.canEnable === true ||
    (input.snapshot?.authorization.deviceEnabled === true && input.snapshot.authorization.policy === "enabled"));
  const recoveryAction=state.statusCode === "disabled" && !switchEnabled ? "open_settings" : action;
  let description=state.detail ?? "";
  if (state.statusCode === "unreachable" && input.lastConfirmedAt !== null) {
    description=`上次确认：${new Date(input.lastConfirmedAt).toLocaleTimeString("zh-CN")}`;
  } else if (state.statusCode === "retry_wait" && input.snapshot?.cloud.retryAt) {
    description=`预计 ${new Date(input.snapshot.cloud.retryAt).toLocaleTimeString("zh-CN")} 后重试`;
  }
  const busy=["authorizing","checking","preparing","refreshing","syncing","pending_ack","binding_updating"].includes(state.statusCode);
  const neutral=["disabled","device_off","master_off","manual","foreign"].includes(state.statusCode);
  return {heading:state.title,description,tone:state.statusCode === "ready" ? "ready" : busy ? "busy" : neutral ? "neutral" : "attention",
    switchEnabled,
    switchChecked:enabled,switchVisible:authorized,actions:recoveryAction ? [recoveryAction] : [],actionTarget:state.actionTarget};
}
