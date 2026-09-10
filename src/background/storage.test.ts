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
      "quicklogin.state": { ...initialLocalState(), schemaVersion: 2, deviceId: "device-a" },
    });
    await expect(readLocalState()).rejects.toThrow("QUICKLOGIN_UPDATE_REQUIRED");
  });
});
