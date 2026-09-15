import { beforeEach, describe, expect, it } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { initialLocalState, readLocalState, updateLocalState } from "./storage";

beforeEach(() => installChromeFake());

describe("local state", () => {
  it("serializes concurrent updates without losing fields", async () => {
    await Promise.all([
      updateLocalState((state) => ({ ...state, enabledIntent: true })),
      updateLocalState((state) => ({ ...state, manualOverride: true })),
    ]);
    expect(await readLocalState()).toMatchObject({
      enabledIntent: true,
      manualOverride: true,
    });
  });

  it("rejects a future schema instead of resetting a registered device", async () => {
    await chrome.storage.local.set({
      "quicklogin.state.v2": { ...initialLocalState(), schemaVersion: 3, deviceId: "device-a" },
    });
    await expect(readLocalState()).rejects.toThrow("QUICKLOGIN_UPDATE_REQUIRED");
  });

  it("migrates the existing device without trusting a generation-less appliedVersion", async () => {
    await chrome.storage.local.set({
      "quicklogin.state": {
        schemaVersion: 1, deviceId: "existing-device", localGeneration: 5,
        serverGeneration: 9, enabledIntent: true, appliedVersion: 11,
        localWriteState: "ready", managed: [{ name: "SOURCEID_TGC", domain: "sso.cqu.edu.cn", path: "/", storeId: "0", digest: "owned" }],
      },
      "quicklogin.tokens": { refreshToken: "synthetic-preserved-token" },
    });
    const state = await readLocalState();
    expect(state).toMatchObject({ schemaVersion: 2, deviceId: "existing-device", enabledIntent: true, appliedVersion: null, localWriteState: "idle" });
    expect(state.localGeneration).toBeGreaterThan(5);
    expect(state.managed).toHaveLength(1);
    const stored = await chrome.storage.local.get(["quicklogin.state.v2", "quicklogin.activeSchema", "quicklogin.tokens"]);
    expect(stored["quicklogin.activeSchema"]).toBe(2);
    expect(stored["quicklogin.state.v2"]).toMatchObject({ deviceId: "existing-device" });
    expect(stored["quicklogin.tokens"]).toEqual({ refreshToken: "synthetic-preserved-token" });
  });
});
