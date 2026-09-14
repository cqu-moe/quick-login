import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { initialLocalState } from "./storage";
import * as api from "./api";
import { setEnvelopeWriter, sync } from "./sync";
import { handleMessage } from "./messages";
import { SYNC_ALARM } from "../shared/config";

const remote = {
  protocolVersion: 2 as const,
  deviceId: "device-a",
  generation: 4,
  masterEnabled: true,
  enabled: true,
  deviceLimit: 5,
  used: 1,
  disabledReason: null,
  state: "ready" as const,
  sessionVersion: 7,
  appliedVersion: null,
  loginAt: 1,
  lastKeepAliveAt: 2,
  lastSeenAt: 3,
};

beforeEach(async () => {
  installChromeFake();
  await chrome.storage.local.set({
    "quicklogin.state": {
      ...initialLocalState(),
      deviceId: "device-a",
      serverGeneration: 4,
      enabledIntent: true,
    },
  });
  vi.spyOn(api, "status").mockResolvedValue(remote);
  vi.spyOn(api, "exportCookies").mockResolvedValue({
    protocolVersion: 2,
    deviceId: "device-a",
    generation: 4,
    sessionVersion: 7,
    createdAt: 4,
    cookies: [],
  });
});

describe("background synchronization", () => {
  it("reports the last observed generation through protocol v2", async () => {
    setEnvelopeWriter(vi.fn().mockResolvedValue("applied" as const));

    await sync("alarm");

    expect(api.status).toHaveBeenCalledWith({
      protocolVersion: 2,
      observedGeneration: 4,
      appliedVersion: null,
      browserVersion: expect.any(String),
    });
  });

  it("coalesces concurrent alarm and login-form requests", async () => {
    const apply = vi.fn().mockResolvedValue("applied" as const);
    setEnvelopeWriter(apply);
    await Promise.all(Array.from({ length: 10 }, () => sync("alarm")));
    expect(api.status).toHaveBeenCalledTimes(1);
    expect(api.exportCookies).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("does not write a completed download after local generation changes", async () => {
    let release!: (value: Awaited<ReturnType<typeof api.exportCookies>>) => void;
    vi.spyOn(api, "exportCookies").mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const apply = vi.fn().mockResolvedValue("applied" as const);
    setEnvelopeWriter(apply);
    const running = sync("login_form");
    while (!vi.mocked(api.exportCookies).mock.calls.length) {
      await Promise.resolve();
    }
    const current = (await chrome.storage.local.get("quicklogin.state"))["quicklogin.state"] as ReturnType<typeof initialLocalState>;
    await chrome.storage.local.set({
      "quicklogin.state": { ...current, localGeneration: current.localGeneration + 1 },
    });
    release({
      protocolVersion: 2,
      deviceId: "device-a",
      generation: 4,
      sessionVersion: 7,
      createdAt: 4,
      cookies: [],
    });
    await running;
    expect(apply).not.toHaveBeenCalled();
  });

  it("clears a persisted retry wait when the user clicks retry", async () => {
    const apply = vi.fn().mockResolvedValue("applied" as const);
    setEnvelopeWriter(apply);
    const current = (await chrome.storage.local.get("quicklogin.state"))["quicklogin.state"] as ReturnType<typeof initialLocalState>;
    await chrome.storage.local.set({
      "quicklogin.state": {
        ...current,
        localWriteState: "error",
        recovery: {
          id: "round-a",
          generation: 4,
          sessionVersion: 7,
          phase: "downloading",
          downloadRetries: 2,
          writeRetries: 0,
          nextAttemptAt: Date.now() + 60_000,
          navigatedTabId: null,
        },
      },
    });

    await handleMessage({ type: "SYNC" });

    expect(api.status).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    const after = (await chrome.storage.local.get("quicklogin.state"))["quicklogin.state"] as ReturnType<typeof initialLocalState>;
    expect(after.recovery?.nextAttemptAt).toBeNull();
  });

  it("schedules a 30-second status check while the cloud session is preparing", async () => {
    vi.mocked(api.status).mockResolvedValue({ ...remote, state: "preparing" });
    const startedAt = Date.now();

    await sync("enable");

    expect(api.exportCookies).not.toHaveBeenCalled();
    const alarm = await chrome.alarms.get(`${SYNC_ALARM}-retry`);
    expect(alarm?.scheduledTime).toBeGreaterThanOrEqual(startedAt + 30_000);
    expect(alarm?.scheduledTime).toBeLessThan(startedAt + 31_000);
  });
});
