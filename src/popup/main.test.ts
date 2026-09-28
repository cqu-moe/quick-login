import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { readySnapshot, receipt } from "../test/protocol-fixtures";
import type { PopupInput } from "./view-model";

const readyInput: PopupInput = {
  snapshot: readySnapshot(),
  local: { authorization: "authorized", enabledIntent:true, observation:"fresh", cookieState:"applied", receipt:receipt(), pendingAck:false },
  lastError:null,lastConfirmedAt:Date.now(),nextAttemptAt:null,
};

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<main id="app" aria-live="polite"></main>';
});

describe("popup rendering", () => {
  it("renders the ready view without redundant device copy or management", async () => {
    const { fake } = installChromeFake();
    Object.assign(fake.runtime, { sendMessage: vi.fn(async () => readyInput) });

    await import("./main");
    await vi.waitFor(() => expect(document.querySelector("h1")?.textContent).toBe("已就绪"));

    expect(document.body.textContent).toContain("QuickLogin");
    expect(document.body.textContent).not.toContain("此设备");
    expect(document.body.textContent).not.toContain("独立学校会话");
    expect(document.body.textContent).not.toContain("管理设备");
  });

  it("shows syncing feedback before an enable request finishes", async () => {
    const { fake } = installChromeFake();
    let finishEnable!: () => void;
    const enablePending = new Promise<void>((resolve) => { finishEnable = resolve; });
    const disabledInput: PopupInput = {
      ...readyInput,
      snapshot: { ...readyInput.snapshot!, capabilities: { ...readyInput.snapshot!.capabilities, canEnable:false } },
      local: { ...readyInput.local, enabledIntent:false, cookieState:"unknown" },
    };
    Object.assign(fake.runtime, {
      sendMessage: vi.fn(async (message: unknown) => {
        const type = (message as { type: string }).type;
        if (type === "GET_UI_STATE") return disabledInput;
        if (type === "SET_ENABLED") {
          await enablePending;
          return { ok: true };
        }
        return { ok: true };
      }),
    });

    await import("./main");
    await vi.waitFor(() => expect(document.querySelector("h1")?.textContent).toBe("已关闭"));

    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    expect(document.querySelector("h1")?.textContent).toBe("正在同步");

    finishEnable();
    await vi.waitFor(() => expect(document.querySelector("h1")?.textContent).toBe("已关闭"));
  });
});
