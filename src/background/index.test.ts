import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { sync } from "./sync";

vi.mock("./sync", () => ({
  setEnvelopeWriter: vi.fn(),
  sync: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  installChromeFake();
});

async function messageListener() {
  const registration = vi.spyOn(chrome.runtime.onMessage, "addListener");
  await import("./index");
  return registration.mock.calls[0][0];
}

describe("background startup", () => {
  it("synchronizes immediately when the service worker starts", async () => {
    await import("./index");
    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith("startup"));
  });
});

describe("background popup messages", () => {
  it.each([false, true])("returns UI state from the trusted popup (in tab: %s)", async (inTab) => {
    const listener = await messageListener();
    const response = vi.fn();

    expect(listener({ type: "GET_UI_STATE" }, {
      id: chrome.runtime.id,
      url: `chrome-extension://${chrome.runtime.id}/popup.html`,
      ...(inTab ? { tab: { id: 7 } as chrome.tabs.Tab } : {}),
    }, response)).toBe(true);

    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({
      deviceId: null,
      snapshot: null,
      local: {
        authorization: "disconnected",
        observation: "checking",
        protocolSupport: "supported",
        mode: "automatic",
        cookieState: "unknown",
        receipt: null,
        pendingAck: false,
        schoolAccess: "unverified",
      },
      lastError: null,
      lastConfirmedAt: null,
      nextAttemptAt: null,
    }));
  });

  it.each([
    ["another extension's popup", "test-extension", "chrome-extension://other-extension/popup.html"],
    ["another page in this extension", "test-extension", "chrome-extension://test-extension/settings.html"],
    ["a nested popup path", "test-extension", "chrome-extension://test-extension/other/popup.html"],
    ["an unrelated website", "test-extension", "https://attacker.example/popup.html"],
    ["an SSO sibling host", "test-extension", "https://sso.cqu.edu.cn.attacker.example/popup.html"],
    ["a different runtime ID", "other-extension", "chrome-extension://test-extension/popup.html"],
    ["a missing runtime ID", undefined, "chrome-extension://test-extension/popup.html"],
    ["a missing URL", "test-extension", undefined],
  ])("rejects popup RPC from %s even with a tab", async (_label, id, url) => {
    const listener = await messageListener();
    const response = vi.fn();

    expect(listener({ type: "GET_UI_STATE" }, {
      id, url, tab: { id: 7 } as chrome.tabs.Tab,
    }, response)).toBe(false);
    expect(response).not.toHaveBeenCalled();
  });

  it.each(["/login", "/authserver/login", "/popup.html"])(
    "does not expose popup UI state to an SSO content tab at %s",
    async (path) => {
      const listener = await messageListener();
      const response = vi.fn();

      expect(listener({ type: "GET_UI_STATE" }, {
        id: chrome.runtime.id,
        url: `https://sso.cqu.edu.cn${path}`,
        tab: { id: 7 } as chrome.tabs.Tab,
      }, response)).toBe(true);
      await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ kind: "idle" }));
    },
  );
});
