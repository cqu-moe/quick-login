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
  tone: "ready" | "busy" | "attention" | "neutral";
  switchEnabled: boolean;
  switchChecked: boolean;
  actions: PopupAction[];
}

export function derivePopupView(input: PopupInput): PopupView {
  const status = input.status;
  if (status?.state === "revoked" || input.lastError === "DEVICE_REVOKED") {
    return {
      heading: "已退出",
      description: "连接 Auth 后可重新使用",
      tone: "attention",
      switchEnabled: false, switchChecked: false, actions: ["login"],
    };
  }
  if (!input.authorized) {
    return {
      heading: "未连接 Auth",
      description: "连接后会自动准备学校登录",
      tone: "attention",
      switchEnabled: false, switchChecked: false, actions: ["login"],
    };
  }
  if (!status) {
    return {
      heading: "正在检查",
      description: "",
      tone: "busy",
      switchEnabled: false, switchChecked: false, actions: [],
    };
  }
  if (!status.masterEnabled) {
    return {
      heading: "尚未开启",
      description: "请先在 Auth 开启快捷登录",
      tone: "attention",
      switchEnabled: false, switchChecked: status.enabled, actions: ["open_settings"],
    };
  }
  if (input.lastError === "DEVICE_LIMIT_REACHED" || input.lastError === "NO_DEVICE_CAPACITY") {
    return {
      heading: "设备名额已满",
      description: "请先在 Auth 退出不用的设备",
      tone: "attention",
      switchEnabled: true, switchChecked: false, actions: ["open_settings"],
    };
  }
  if (status.state === "needs_reauth") {
    return {
      heading: "需要重新绑定",
      description: "学校账号状态已变化",
      tone: "attention",
      switchEnabled: true, switchChecked: status.enabled, actions: ["open_settings"],
    };
  }
  if (input.manualOverride) {
    return {
      heading: "手动登录中",
      description: "恢复后会继续同步",
      tone: "neutral",
      switchEnabled: true, switchChecked: status.enabled, actions: ["resume"],
    };
  }
  if (input.localWriteState === "foreign_session") {
    return {
      heading: "已有学校登录",
      description: "不会覆盖当前会话",
      tone: "neutral",
      switchEnabled: true, switchChecked: status.enabled, actions: ["switch_managed"],
    };
  }
  if (status.state === "preparing" || status.state === "refreshing") {
    return {
      heading: "正在同步",
      description: "正在更新学校登录",
      tone: "busy",
      switchEnabled: false, switchChecked: status.enabled, actions: [],
    };
  }
  if (status.state === "ready" && input.localWriteState === "ready") {
    return {
      heading: "已就绪",
      description: "",
      tone: "ready",
      switchEnabled: true, switchChecked: status.enabled, actions: [],
    };
  }
  if (status.state === "ready" && input.localWriteState === "error") {
    return {
      heading: "同步失败",
      description: "稍后会自动重试",
      tone: "attention",
      switchEnabled: true, switchChecked: status.enabled, actions: ["retry"],
    };
  }
  if (status.state === "ready") {
    return {
      heading: "正在同步",
      description: "正在更新学校登录",
      tone: "busy",
      switchEnabled: false, switchChecked: status.enabled, actions: [],
    };
  }
  return {
    heading: status.enabled ? "同步失败" : "已关闭",
    description: status.enabled ? "稍后会自动重试" : "",
    tone: status.enabled ? "attention" : "neutral",
    switchEnabled: true,
    switchChecked: status.enabled,
    actions: status.enabled ? ["retry"] : [],
  };
}
