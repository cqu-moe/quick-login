import type { DeviceStatus, ErrorCode, LocalState } from "../shared/contracts";

export type PopupAction =
  | "login" | "open_settings" | "resume" | "switch_managed" | "retry";

export interface PopupInput {
  authorized: boolean;
  status: DeviceStatus | null;
  manualOverride: boolean;
  localWriteState: LocalState["localWriteState"];
  lastError: ErrorCode | null;
}

export interface PopupView {
  heading: string;
  description: string;
  switchEnabled: boolean;
  switchChecked: boolean;
  actions: PopupAction[];
}

export function derivePopupView(input: PopupInput): PopupView {
  const status = input.status;
  if (status?.state === "revoked" || input.lastError === "DEVICE_REVOKED") {
    return {
      heading: "此设备已退出快捷登录",
      description: "重新使用时，需要再次登录 Auth 并授权此安装实例。",
      switchEnabled: false, switchChecked: false, actions: ["login"],
    };
  }
  if (!input.authorized) {
    return {
      heading: "连接 Auth",
      description: "登录并授权后，这台浏览器会获得独立的学校登录会话。",
      switchEnabled: false, switchChecked: false, actions: ["login"],
    };
  }
  if (!status) {
    return {
      heading: "正在检查状态",
      description: "已授权，正在读取这台设备的状态。",
      switchEnabled: false, switchChecked: false, actions: ["retry"],
    };
  }
  if (!status.masterEnabled) {
    return {
      heading: "请先在 Auth 开启快捷登录",
      description: `当前已使用 ${status.used} / ${status.deviceLimit} 台设备。`,
      switchEnabled: false, switchChecked: status.enabled, actions: ["open_settings"],
    };
  }
  if (input.lastError === "DEVICE_LIMIT_REACHED" || input.lastError === "NO_DEVICE_CAPACITY") {
    return {
      heading: "设备名额已满",
      description: `当前已使用 ${status.used} / ${status.deviceLimit} 台设备，可在 Auth 退出旧设备。`,
      switchEnabled: true, switchChecked: false, actions: ["open_settings"],
    };
  }
  if (status.state === "needs_reauth") {
    return {
      heading: "需要重新绑定学校账号",
      description: "学校凭据已变化，旧会话不会继续下发。",
      switchEnabled: true, switchChecked: status.enabled, actions: ["open_settings"],
    };
  }
  if (input.manualOverride) {
    return {
      heading: "已切换手动登录",
      description: "云端仍会保活；本机不会覆盖学校 Cookie。",
      switchEnabled: true, switchChecked: status.enabled, actions: ["resume"],
    };
  }
  if (input.localWriteState === "foreign_session") {
    return {
      heading: "已有学校登录",
      description: "继续使用当前会话；只有你明确切换时才会替换。",
      switchEnabled: true, switchChecked: status.enabled, actions: ["switch_managed"],
    };
  }
  if (status.state === "preparing" || status.state === "refreshing") {
    return {
      heading: "正在准备",
      description: "学校会话正在建立，稍后会自动同步到这台浏览器。",
      switchEnabled: false, switchChecked: status.enabled, actions: [],
    };
  }
  if (status.state === "ready" && input.localWriteState === "ready") {
    return {
      heading: "快捷登录已准备",
      description: "访问学校系统时会使用这台设备自己的会话。",
      switchEnabled: true, switchChecked: status.enabled, actions: ["open_settings"],
    };
  }
  if (status.state === "ready") {
    return {
      heading: "正在同步到浏览器",
      description: "云端会话已就绪，本地 Cookie 尚未完成写入。",
      switchEnabled: false, switchChecked: status.enabled, actions: ["retry"],
    };
  }
  return {
    heading: status.enabled ? "暂时无法同步" : "快捷登录已关闭",
    description: status.enabled ? "稍后会自动重试，也可以立即重试。" : "开启后会占用一个设备名额。",
    switchEnabled: true,
    switchChecked: status.enabled,
    actions: status.enabled ? ["retry", "open_settings"] : ["open_settings"],
  };
}
