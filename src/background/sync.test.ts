import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { initialLocalState } from "./storage";
import * as api from "./api";
import { setEnvelopeWriter, sync } from "./sync";

const remote = {
  protocolVersion: 1 as const,
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
    protocolVersion: 1,
    deviceId: "device-a",
    generation: 4,
    sessionVersion: 7,
    createdAt: 4,
    cookies: [],
  });
});

describe("background synchronization", () => {
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
      protocolVersion: 1,
      deviceId: "device-a",
      generation: 4,
      sessionVersion: 7,
      createdAt: 4,
      cookies: [],
    });
    await running;
    expect(apply).not.toHaveBeenCalled();
  });
});
