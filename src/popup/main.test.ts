import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { readySnapshot, receipt } from "../test/protocol-fixtures";
import type { PopupInput } from "./view-model";

const readyInput: PopupInput = {
  snapshot: readySnapshot(),
  local: { authorization: "authorized", enabledIntent: true, observation: "fresh", cookieState: "applied", receipt: receipt(), pendingAck: false },
  lastError: null, lastConfirmedAt: Date.now(), nextAttemptAt: null,
};
const disabledInput: PopupInput = {
  ...readyInput,
  snapshot: { ...readyInput.snapshot!, capabilities: { ...readyInput.snapshot!.capabilities, canEnable: false } },
  local: { ...readyInput.local, enabledIntent: false, cookieState: "unknown" },
};
const heading = () => document.querySelector("h1")?.textContent;
const toggle = () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const flush = () => vi.advanceTimersByTimeAsync(0);

function setup(handler: (message: { type: string }) => Promise<unknown>) {
  const { fake } = installChromeFake();
  const send = vi.fn(handler);
  Object.assign(fake.runtime, { sendMessage: send });
  const listeners = new Set<Parameters<typeof chrome.storage.onChanged.addListener>[0]>();
  vi.spyOn(fake.storage.onChanged, "addListener").mockImplementation(listener => { listeners.add(listener); });
  vi.spyOn(fake.storage.onChanged, "removeListener").mockImplementation(listener => { listeners.delete(listener); });
  return { send, changed: () => listeners.forEach(listener => listener({ "quicklogin.state.v2": { newValue: {} } }, "local")) };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  document.body.innerHTML = '<main id="app" aria-live="polite"></main>';
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("popup responsiveness", () => {
  it.each([
    ["no_update", "商店暂未提供可用更新"],
    ["throttled", "刚刚检查过更新"],
    ["failed", "暂时无法检查更新"],
    ["manual_update", "当前为开发版"],
  ])("checks for extension updates and retains the %s result while state refreshes", async (updateStatus, notice) => {
    const input: PopupInput = { ...readyInput, local: { ...readyInput.local, protocolSupport: "client_update_required" } };
    const { send } = setup(async ({ type }) => type === "CHECK_EXTENSION_UPDATE" ? { ok: true, updateStatus } : input);
    await import("./main");
    await flush();
    document.querySelector<HTMLButtonElement>("button")!.click();
    expect(heading()).toBe("正在检查更新");
    await flush();
    expect(send).toHaveBeenCalledWith({ type: "CHECK_EXTENSION_UPDATE" });
    expect(document.querySelector(".status-description")?.textContent).toContain(notice);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(document.querySelector(".status-description")?.textContent).toContain(notice);
    expect(document.querySelector("button")?.getAttribute("aria-disabled")).toBe("false");
  });

  it("renders the ready view without redundant device copy or management", async () => {
    setup(async () => readyInput);
    await import("./main");
    await flush();
    expect(heading()).toBe("已就绪");
    expect(document.body.textContent).toContain("QuickLogin");
    for (const copy of ["此设备", "独立学校会话", "管理设备"]) expect(document.body.textContent).not.toContain(copy);
  });

  it("keeps the switch mounted and focused while showing immediate progress", async () => {
    let finish!: (value: unknown) => void;
    setup(async ({ type }) => type === "SET_ENABLED" ? new Promise(resolve => { finish = resolve; }) : disabledInput);
    await import("./main");
    await flush();
    const control = toggle();
    control.focus();
    control.click();
    expect(heading()).toBe("正在同步");
    expect(toggle()).toBe(control);
    expect(document.activeElement).toBe(control);
    await flush();
    finish({ accepted: true });
    await flush();
    expect(heading()).toBe("已关闭");
  });

  it("offers a state-only retry when the initial worker response never arrives, ignoring its late response", async () => {
    let late!: (value: PopupInput) => void;
    let calls = 0;
    const { send } = setup(async ({ type }) => type === "GET_UI_STATE" && calls++ === 0
      ? new Promise(resolve => { late = resolve; }) : readyInput);
    await import("./main");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(heading()).toBe("暂时无法读取状态");
    const retry = document.querySelector<HTMLButtonElement>("button")!;
    expect(retry.textContent).toBe("重新检查");
    retry.click();
    await flush();
    expect(heading()).toBe("已就绪");
    late(disabledInput);
    await flush();
    expect(heading()).toBe("已就绪");
    expect(send.mock.calls.map(([message]) => message.type)).not.toContain("SYNC");
  });

  it.each(["reject", "decline", "hang"])("recovers from an action that %s without an automatic duplicate mutation", async (failure) => {
    const { send } = setup(async ({ type }) => {
      if (type !== "SET_ENABLED") return disabledInput;
      if (failure === "reject") throw new Error("worker disconnected");
      if (failure === "decline") return { accepted: false };
      return new Promise(() => {});
    });
    await import("./main");
    await flush();
    toggle().click();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(heading()).toBe("操作暂未确认");
    expect(document.querySelector("button")?.textContent).toBe("重新检查");
    expect(send.mock.calls.filter(([message]) => message.type === "SET_ENABLED")).toHaveLength(1);
    document.querySelector<HTMLButtonElement>("button")!.click();
    await flush();
    expect(heading()).toBe("已关闭");
  });

  it("does not repeat a primary action while its resulting state is still loading", async () => {
    let completed = false;
    let finishRead!: (value: PopupInput) => void;
    const { send } = setup(async ({ type }) => {
      if (type === "RESUME") { completed = true; return { ok: true }; }
      if (type === "GET_UI_STATE" && completed) return new Promise(resolve => { finishRead = resolve; });
      return { ...readyInput, local: { ...readyInput.local, mode: "manual" } };
    });
    await import("./main");
    await flush();
    const primary = document.querySelector<HTMLButtonElement>("button")!;
    expect(primary.textContent).toBe("恢复快捷登录");
    primary.click();
    await flush();
    primary.click();
    await flush();
    expect(send.mock.calls.filter(([message]) => message.type === "RESUME")).toHaveLength(1);
    finishRead(readyInput);
    await flush();
    expect(heading()).toBe("已就绪");
  });

  it("coalesces a burst of storage changes and displays the trailing state", async () => {
    let input = readyInput;
    let read!: (value: PopupInput) => void;
    let hold = false;
    const { send, changed } = setup(async ({ type }) => type === "GET_UI_STATE" && hold
      ? new Promise(resolve => { read = resolve; }) : input);
    await import("./main");
    await flush();
    send.mockClear();
    hold = true;
    changed();
    await vi.advanceTimersByTimeAsync(100);
    for (let i = 0; i < 100; i++) changed();
    await vi.advanceTimersByTimeAsync(100);
    expect(send.mock.calls.filter(([message]) => message.type === "GET_UI_STATE")).toHaveLength(1);
    hold = false;
    input = disabledInput;
    read(readyInput);
    await vi.advanceTimersByTimeAsync(200);
    expect(heading()).toBe("已关闭");
    expect(send.mock.calls.filter(([message]) => message.type === "GET_UI_STATE")).toHaveLength(2);
  });

  it("does not let an earlier state read overwrite an in-flight user action", async () => {
    let read!: (value: PopupInput) => void;
    let hold = false;
    const { changed } = setup(async ({ type }) => {
      if (type === "SET_ENABLED") return new Promise(() => {});
      if (type === "GET_UI_STATE" && hold) return new Promise(resolve => { read = resolve; });
      return disabledInput;
    });
    await import("./main");
    await flush();
    hold = true;
    changed();
    await vi.advanceTimersByTimeAsync(100);
    toggle().click();
    read(disabledInput);
    await flush();
    expect(heading()).toBe("正在同步");
    expect(toggle().getAttribute("aria-disabled")).toBe("true");
  });

  it("stops work on pagehide and resumes after back/forward restoration", async () => {
    const { send, changed } = setup(async () => readyInput);
    await import("./main");
    await flush();
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    send.mockClear();
    changed();
    await vi.advanceTimersByTimeAsync(6000);
    expect(send).not.toHaveBeenCalled();
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await flush();
    expect(send).toHaveBeenCalledWith({ type: "GET_UI_STATE" });
  });
});
