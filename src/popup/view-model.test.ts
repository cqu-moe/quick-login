import { describe, expect, it } from "vitest";
import { derivePopupView, type PopupInput } from "./view-model";

const status = {
  protocolVersion: 2 as const, deviceId: "device-a", generation: 4,
  masterEnabled: true, enabled: true, deviceLimit: 5, used: 1,
  disabledReason: null, state: "ready" as const, sessionVersion: 7,
  appliedVersion: null, loginAt: 1, lastKeepAliveAt: 2, lastSeenAt: 3,
};
const input: PopupInput = {
  authorized: true, status, manualOverride: false,
  localWriteState: "idle", lastError: null,
};

describe("popup state table", () => {
  it.each([
    [{ ...input, authorized: false, status: null }, "未连接 Auth"],
    [{ ...input, status: { ...status, masterEnabled: false } }, "尚未开启"],
    [{ ...input, status: { ...status, state: "preparing" as const } }, "正在同步"],
    [{ ...input, localWriteState: "ready" as const }, "已就绪"],
    [{ ...input, manualOverride: true }, "手动登录中"],
    [{ ...input, status: { ...status, state: "revoked" as const } }, "已退出"],
    [{ ...input, localWriteState: "foreign_session" as const }, "已有学校登录"],
  ] satisfies Array<[PopupInput, string]>)("maps state to %s", (value, heading) => {
    expect(derivePopupView(value).heading).toBe(heading);
  });

  it("does not claim completion while the cloud is ready but local write is not", () => {
    expect(derivePopupView(input).heading).toBe("正在同步");
  });

  it("keeps the ready state free of descriptions and device-management actions", () => {
    const view = derivePopupView({ ...input, localWriteState: "ready" });

    expect(view.description).toBe("");
    expect(view.actions).toEqual([]);
  });
});
