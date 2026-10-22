import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { snapshot } from "../test/protocol-fixtures";
import { readLocalState, updateLocalState } from "../background/storage";
import { handleMessage, type BackgroundMessage } from "../background/messages";
import { sync } from "../background/sync";
import * as api from "../background/api-v3";
import * as telemetry from "../shared/posthog";

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  installChromeFake();
  vi.spyOn(telemetry, "captureQuickloginOperation").mockImplementation(() => undefined);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  document.body.innerHTML = '<main id="app"></main>';
  Object.assign(chrome.runtime, { sendMessage: vi.fn((message: BackgroundMessage) => handleMessage(message)) });
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.clearAllTimers();
  vi.useRealTimers();
});

it.each(["manual", "foreign"])("%s recovery keeps progress and a stop control during a slow request", async mode => {
  const remote = snapshot();
  remote.cloud = { ...remote.cloud, state: "logging_in", usableUntil: null };
  remote.capabilities = { ...remote.capabilities, canEnsure: false, canExport: false };
  await updateLocalState(state => ({ ...state, deviceId: "device-a", snapshot: remote, serverGeneration: 4,
    authorization: "authorized", observation: "fresh", enabledIntent: true,
    manualOverride: mode === "manual", localWriteState: mode === "foreign" ? "foreign_session" : "idle" }));
  const reconcile = vi.spyOn(api, "reconcile").mockResolvedValue({ centralUserId: "synthetic-user", snapshot: remote, receiptAck: null });
  await import("../popup/main");
  await vi.advanceTimersByTimeAsync(0);
  await sync("popup");
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  reconcile.mockImplementation(async () => {
    await gate;
    return { centralUserId: "synthetic-user", snapshot: remote, receiptAck: null };
  });
  document.querySelector<HTMLButtonElement>("button")!.click();
  await vi.advanceTimersByTimeAsync(0);
  const during = {
    title: document.querySelector("h1")!.textContent,
    stopDisabled: document.querySelector("input")!.getAttribute("aria-disabled"),
  };
  await vi.advanceTimersByTimeAsync(10_001);
  const afterTimeout = document.querySelector("h1")!.textContent;
  document.querySelector<HTMLInputElement>("input")!.click();
  await vi.advanceTimersByTimeAsync(0);
  expect((await readLocalState()).enabledIntent).toBe(false);
  release();
  await sync("popup");
  await vi.advanceTimersByTimeAsync(0);
  expect.soft(during.stopDisabled).toBe("false");
  expect(afterTimeout).not.toBe("操作暂未确认");
});
