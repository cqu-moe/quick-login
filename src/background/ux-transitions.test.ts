import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { snapshot, response, receipt } from "../test/protocol-fixtures";
import { readLocalState, updateLocalState } from "../background/storage";
import { handleMessage } from "../background/messages";
import { sync } from "../background/sync";
import { derivePopupView, type PopupInput } from "../popup/view-model";
import * as auth from "../background/auth";
import * as telemetry from "../shared/posthog";
import type { DeviceSnapshot } from "../shared/protocol-v3.generated";

beforeEach(() => {
  installChromeFake();
  vi.spyOn(telemetry, "captureQuickloginOperation").mockImplementation(() => undefined);
});
afterEach(() => vi.unstubAllGlobals());

const view = async () => derivePopupView(await handleMessage({ type: "GET_UI_STATE" }) as PopupInput);
function disabledSnapshot(): DeviceSnapshot {
  const remote = snapshot();
  remote.authorization = { ...remote.authorization, policy: "device_off", deviceEnabled: false };
  remote.cloud = { ...remote.cloud, state: "absent", usableUntil: null };
  remote.capabilities = { ...remote.capabilities, canEnsure: false, canExport: false, canUseExistingSession: false };
  return remote;
}

it.each(["success", "network failure", "master_off", "quota_blocked"])("new login respects the enable outcome: %s", async outcome => {
  const remote = disabledSnapshot();
  const blocked = outcome === "master_off" || outcome === "quota_blocked";
  if (blocked) {
    remote.authorization.policy = outcome;
    remote.authorization.masterEnabled = outcome !== "master_off";
    remote.capabilities.canEnable = false;
  }
  const preparing = snapshot();
  preparing.cloud = { ...preparing.cloud, state: "logging_in", usableUntil: null };
  preparing.capabilities = { ...preparing.capabilities, canEnsure: false, canExport: false };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let enabling = false;
  vi.spyOn(chrome.identity, "launchWebAuthFlow").mockImplementation(async ({ url }) =>
    `${chrome.identity.getRedirectURL()}?code=synthetic&state=${new URL(url).searchParams.get("state")}`);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/oauth2/token")) return Response.json({ access_token: "synthetic", refresh_token: "synthetic", expires_in: 300 });
    if (url.endsWith("/registrations")) return Response.json(response({ centralUserId: "synthetic-user", deviceId: remote.identity.deviceId, snapshot: remote }));
    if (url.endsWith("/reconcile")) return Response.json(response({ centralUserId: "synthetic-user", snapshot: remote, receiptAck: null }));
    if (url.endsWith("/operations")) {
      enabling = true;
      if (blocked) return new Response("", { status: 503 });
      await gate;
      if (outcome === "network failure") throw new TypeError("offline");
      return Response.json(response({ snapshot: preparing, operation: {
        operationId: "synthetic-operation", command: "set_enabled", versions: receipt(),
        state: "succeeded", stage: null, attempt: 1, createdAt: Date.now(), startedAt: Date.now(),
        deadlineAt: null, completedAt: Date.now(), retryAt: null, resultCode: null, cancelReason: null,
      } }));
    }
    throw new Error(`Unexpected synthetic request: ${url}`);
  }));
  await handleMessage({ type: "LOGIN" });
  if (blocked) {
    await vi.waitFor(async () => expect((await readLocalState()).authorization).toBe("authorized"));
    await sync("popup");
    expect(enabling).toBe(false);
    expect((await view()).heading).toBe(outcome === "master_off" ? "账号已暂停快捷登录" : "设备名额已满");
    expect((await readLocalState()).pendingCommand).toBeNull();
    return;
  }
  await vi.waitFor(() => expect(enabling).toBe(true));
  const during = await view();
  release();
  await sync("popup");
  const after = await view();
  expect.soft(during.heading).not.toMatch(/已关闭|已退出/);
  expect.soft(during.tone).toBe("busy");
  if (outcome === "success") expect(after.heading).toBe("正在准备学校登录");
  else expect(after.heading).toBe("暂时无法连接 Auth");
});

it("an existing disabled device shows connecting while OAuth is open", async () => {
  await updateLocalState(state => ({ ...state, deviceId: "device-a", snapshot: disabledSnapshot(),
    authorization: "reconnect_required", enabledIntent: false }));
  let cancel!: (error: Error) => void;
  vi.spyOn(auth, "loginInteractive").mockImplementation(() => new Promise((_resolve, reject) => { cancel = reject; }));
  await handleMessage({ type: "LOGIN" });
  const during = await view();
  cancel(new Error("synthetic cancellation"));
  await vi.waitFor(async () => expect((await readLocalState()).connectIntentId).toBeNull());
  expect(during.heading).toMatch(/正在连接/);
});

it("a remotely disabled device has an off switch that can enable it in one click", async () => {
  await updateLocalState(state => ({ ...state, deviceId: "device-a", snapshot: disabledSnapshot(),
    authorization: "authorized", enabledIntent: true, observation: "fresh" }));
  const current = await view();
  expect(current.heading).toBe("此设备已关闭");
  expect(current.switchEnabled).toBe(true);
  expect(current.switchChecked).toBe(false);
});
