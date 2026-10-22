import { derivePresentation, type DeviceSnapshot, type LocalPresentation, type ReasonCode, type ActionTarget } from "../shared/protocol-v3.generated";

export type PopupAction = "login" | "open_settings" | "resume" | "switch_managed" | "retry" | "retry_local" | "update" | "fix_permissions" | "manual_login";
export const ACTION_LABELS: Record<PopupAction, string> = {
  login:"连接 Auth",open_settings:"管理快捷登录",resume:"恢复快捷登录",switch_managed:"切换到快捷登录",
  retry:"重新检查",retry_local:"重试同步",update:"更新插件",fix_permissions:"检查浏览器权限",manual_login:"前往学校手动登录",
};
export interface PopupInput {
  deviceId?:string|null;
  snapshot: DeviceSnapshot | null;
  local: LocalPresentation;
  lastError: ReasonCode | null;
  lastConfirmedAt: number | null;
  nextAttemptAt: number | null;
  recoveryFailed?: boolean;
  connecting?: boolean;
  pendingEnabled?: boolean;
}
export interface PopupView {
  heading:string;description:string;tone:"ready"|"busy"|"attention"|"neutral";
  switchEnabled:boolean;switchChecked:boolean;switchVisible?:boolean;
  actions:PopupAction[];actionTarget?:ActionTarget;actionLabel?:string;
}
export function derivePopupView(input: PopupInput): PopupView {
  const rejected = input.local.schoolAccess === "login_form_seen";
  // A local login form is newer evidence than the cloud's estimated expiry.
  const snapshot = rejected && input.snapshot ? { ...input.snapshot,
    capabilities:{ ...input.snapshot.capabilities,canUseExistingSession:false } } : input.snapshot;
  let state=derivePresentation(snapshot,input.local);
  const authorized=input.local.authorization === "authorized" && input.snapshot?.authorization.state === "authorized";
  if (authorized && input.connecting && ["disabled","device_off"].includes(state.statusCode)) {
    state={...state,statusCode:"authorizing",title:"正在连接 Auth",detail:"授权已完成，正在开启此设备。",actionCode:"none"};
  } else if (authorized && input.pendingEnabled === true && state.statusCode === "device_off") {
    state={...state,statusCode:"preparing",title:"正在准备学校登录",detail:"Auth 已连接，正在开启此设备。",actionCode:"none"};
  }
  if (authorized && input.local.enabledIntent !== false && input.lastError === "CONTRACT_INVALID") {
    state={...state,statusCode:"unknown",title:"暂时无法读取服务状态",detail:"服务返回了无法识别的状态，请重新检查；若持续出现，请更新插件。",reasonCode:"CONTRACT_INVALID",actionCode:"reconcile"};
  }
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
  const enabled=input.pendingEnabled ?? (input.local.enabledIntent !== false && input.snapshot?.authorization.deviceEnabled === true && input.snapshot.authorization.policy === "enabled");
  const switchEnabled=authorized && (enabled || input.snapshot?.capabilities.canEnable === true ||
    (input.snapshot?.authorization.deviceEnabled === true && input.snapshot.authorization.policy === "enabled"));
  const recoveryAction=state.statusCode === "disabled" && !switchEnabled ? "open_settings" : action;
  let description=state.detail ?? "";
  if (["disabled","device_off"].includes(state.statusCode) && switchEnabled) description="开启下方开关，即可在此浏览器恢复快捷登录。";
  if (state.statusCode === "disabled" && input.pendingEnabled === false) {
    description="已停止此浏览器的快捷登录，正在保存设置。";
  } else if (state.statusCode === "disabled" && !switchEnabled) {
    description=derivePresentation(snapshot,{...input.local,enabledIntent:true}).detail ?? description;
  }
  if (state.statusCode === "unreachable" && input.lastConfirmedAt !== null) {
    description+=` 上次确认：${new Date(input.lastConfirmedAt).toLocaleTimeString("zh-CN")}。`;
  } else if (state.statusCode === "retry_wait" && input.snapshot?.cloud.retryAt) {
    description=`预计 ${new Date(input.snapshot.cloud.retryAt).toLocaleTimeString("zh-CN")} 后重试`;
  }
  const busy=["authorizing","checking","preparing","refreshing","syncing","pending_ack","binding_updating"].includes(state.statusCode);
  const neutral=["disabled","device_off","master_off","manual","foreign"].includes(state.statusCode);
  const specificLabels:Partial<Record<typeof state.actionCode,string>>={bind_school:"绑定学校账号",update_password:"更新学校密码",manage_devices:"管理设备名额",open_auth:"打开账号设置",retry_session:"重试快捷登录"};
  const actionLabel=state.statusCode === "reconnect_required" ? "重新连接此设备" : specificLabels[state.actionCode] ?? (recoveryAction ? ACTION_LABELS[recoveryAction] : undefined);
  return {heading:state.title,description,tone:state.statusCode === "ready" ? "ready" : busy ? "busy" : neutral ? "neutral" : "attention",
    switchEnabled,
    switchChecked:enabled,switchVisible:authorized,actions:recoveryAction ? [recoveryAction] : [],actionTarget:state.actionTarget,actionLabel};
}
