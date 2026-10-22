import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { snapshot } from "../test/protocol-fixtures";
import { updateLocalState } from "../background/storage";
import { handleContentMessage } from "../background/messages";
import { renderStatusBanner } from "../content/status-banner";
import { sync } from "../background/sync";
import * as api from "../background/api-v3";
import * as telemetry from "../shared/posthog";

const sender = {
  id: "test-extension",
  tab: { id: 7 },
  documentId: "school-login-document",
  url: "https://sso.cqu.edu.cn/login",
} as chrome.runtime.MessageSender;

const cases = [
  {
    name: "foreign cookie",
    notice: "正在保留已有学校登录",
    action: "切换到快捷登录",
    authorization: "authorized",
    localWriteState: "foreign_session",
    configureSnapshot: (remote: ReturnType<typeof snapshot>) => remote,
  },
  {
    name: "rejected credentials",
    notice: "学校密码需要更新",
    action: "更新学校密码",
    authorization: "authorized",
    localWriteState: "idle",
    configureSnapshot: (remote: ReturnType<typeof snapshot>) => {
      remote.binding = { ...remote.binding, credentialsState: "rejected",
        evidenceKind: "password_rejected" };
      remote.cloud = { ...remote.cloud, state: "expired", usableUntil: null };
      remote.capabilities = { ...remote.capabilities,
        canEnsure: false, canRetry: false, canExport: false, canUseExistingSession: false };
      return remote;
    },
  },
  {
    name: "Auth reconnect",
    notice: "需要重新连接 Auth",
    action: "重新连接此设备",
    authorization: "reconnect_required",
    localWriteState: "idle",
    configureSnapshot: (remote: ReturnType<typeof snapshot>) => remote,
  },
] as const;

beforeEach(() => {
  installChromeFake();
  vi.spyOn(telemetry, "captureQuickloginOperation").mockImplementation(() => undefined);
  document.body.innerHTML = "<form><input type='text'><input type='password'><button type='submit'>登录</button></form>";
});

afterEach(async () => {
  await sync("alarm");
  vi.restoreAllMocks();
});

it.each(cases)("school login page keeps the specific recovery action for $name", async scenario => {
  const remote = snapshot();
  scenario.configureSnapshot(remote);
  await updateLocalState(state => ({ ...state, deviceId: "device-a", serverGeneration: 4,
    enabledIntent: true, authorization: scenario.authorization, observation: "fresh",
    snapshot: remote, localWriteState: scenario.localWriteState }));
  vi.spyOn(api, "reconcile").mockResolvedValue({
    centralUserId: "synthetic-user", snapshot: remote, receiptAck: null,
  });

  const result = await handleContentMessage({ type: "LOGIN_FORM_VISIBLE" }, sender);
  renderStatusBanner(document, result, vi.fn());

  expect(result.kind).toBe("manual_required");
  if (result.kind !== "manual_required") throw new Error("Expected a blocking recovery notice");
  expect(result.message).toContain(scenario.notice);
  expect([...document.querySelectorAll("button")].map(button => button.textContent)).toContain(scenario.action);
});
