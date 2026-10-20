import { beforeEach, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";

beforeEach(() => {
  vi.resetModules();
  installChromeFake();
  vi.spyOn(chrome.runtime, "getManifest").mockReturnValue({
    ...chrome.runtime.getManifest(), update_url: "https://clients2.google.com/service/update2/crx",
  });
});

it.each(["update_available", "no_update", "throttled"] as const)("handles Chrome's %s result without altering device data", async status => {
  const device = { deviceId: "existing-device", token: "test-token" };
  await chrome.storage.local.set({ device });
  vi.spyOn(chrome.runtime, "requestUpdateCheck").mockImplementation(async () => ({ status }));
  const reload = vi.spyOn(chrome.runtime, "reload");
  const { checkForExtensionUpdate } = await import("./updates");
  expect(await checkForExtensionUpdate()).toBe(status);
  expect(reload).toHaveBeenCalledTimes(status === "update_available" ? 1 : 0);
  expect(await chrome.storage.local.get()).toEqual({ device });
});

it("coalesces concurrent checks and preserves the cooldown across worker restarts", async () => {
  let finish!: (result: chrome.runtime.RequestUpdateCheckResult) => void;
  const check = vi.spyOn(chrome.runtime, "requestUpdateCheck").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { checkForExtensionUpdate } = await import("./updates");
  const first = checkForExtensionUpdate();
  const second = checkForExtensionUpdate();
  await vi.waitFor(() => expect(check).toHaveBeenCalledOnce());
  finish({ status: "no_update" });
  expect(await Promise.all([first, second])).toEqual(["no_update", "no_update"]);
  vi.resetModules();
  const restarted = await import("./updates");
  expect(await restarted.checkForExtensionUpdate()).toBe("throttled");
  expect(check).toHaveBeenCalledOnce();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5 * 60_000);
  check.mockImplementation(async () => ({ status: "no_update" }));
  expect(await restarted.checkForExtensionUpdate()).toBe("no_update");
  expect(check).toHaveBeenCalledTimes(2);
});

it("reports an update-check failure without changing login state or reloading", async () => {
  const local = { deviceId: "existing-device", authorization: "authorized" };
  await chrome.storage.local.set({ local });
  vi.spyOn(chrome.runtime, "requestUpdateCheck").mockRejectedValue(new Error("network unavailable"));
  const reload = vi.spyOn(chrome.runtime, "reload");
  const { checkForExtensionUpdate } = await import("./updates");
  expect(await checkForExtensionUpdate()).toBe("failed");
  expect(reload).not.toHaveBeenCalled();
  expect(await chrome.storage.local.get()).toEqual({ local });
});

it("does not promise automatic updates for an unpacked build", async () => {
  vi.spyOn(chrome.runtime, "getManifest").mockReturnValue({ version: "0.5.0" } as chrome.runtime.Manifest);
  const check = vi.spyOn(chrome.runtime, "requestUpdateCheck");
  const { checkForExtensionUpdate } = await import("./updates");
  expect(await checkForExtensionUpdate()).toBe("manual_update");
  expect(check).not.toHaveBeenCalled();
});
