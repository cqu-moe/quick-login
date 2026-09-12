import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { authorizedFetch, loginInteractive } from "./auth";

const stableResource = "https://auth.cqu.moe/api/auth";

const deviceStatus = {
  protocolVersion: 1,
  deviceId: "device-from-grant",
  generation: 1,
  masterEnabled: true,
  enabled: false,
  deviceLimit: 5,
  used: 0,
  disabledReason: null,
  state: "disabled",
  sessionVersion: 0,
  appliedVersion: null,
  loginAt: null,
  lastKeepAliveAt: null,
  lastSeenAt: null,
};

beforeEach(() => {
  installChromeFake();
  vi.stubGlobal("fetch", vi.fn());
});

describe("device authorization", () => {
  it("rejects a callback with a different OAuth state", async () => {
    vi.spyOn(chrome.identity, "launchWebAuthFlow").mockImplementation(async () =>
      "https://test-extension.chromiumapp.org/?code=synthetic&state=wrong"
    );
    await expect(loginInteractive()).rejects.toThrow("OAUTH_STATE_MISMATCH");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses one refresh request for concurrent authorized requests", async () => {
    await chrome.storage.local.set({
      "quicklogin.tokens": {
        accessToken: "expired-access",
        refreshToken: "synthetic-refresh",
        expiresAt: 0,
      },
    });
    let refreshCalls = 0;
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/oauth2/token")) {
        refreshCalls += 1;
        return Response.json({
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          expires_in: 300,
        });
      }
      return Response.json({ ok: true });
    });
    await Promise.all(Array.from({ length: 10 }, () => authorizedFetch("/probe")));
    expect(refreshCalls).toBe(1);
    const tokenCall = vi.mocked(fetch).mock.calls.find(([input]) =>
      String(input).endsWith("/oauth2/token")
    );
    expect(String(tokenCall?.[0])).toBe("https://auth.cqu.moe/api/v1/auth/oauth2/token");
    expect(new URLSearchParams(String(tokenCall?.[1]?.body)).get("resource"))
      .toBe(stableResource);
  });

  it("replays an API request only once after a 401", async () => {
    await chrome.storage.local.set({
      "quicklogin.tokens": {
        accessToken: "current-access",
        refreshToken: "synthetic-refresh",
        expiresAt: Date.now() + 300_000,
      },
    });
    let apiCalls = 0;
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith("/oauth2/token")) {
        return Response.json({
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          expires_in: 300,
        });
      }
      apiCalls += 1;
      return apiCalls === 1
        ? Response.json({ error: { code: "UNAUTHORIZED", message: "UNAUTHORIZED" } }, { status: 401 })
        : Response.json({ ok: true });
    });
    expect((await authorizedFetch("/probe")).status).toBe(200);
    expect(apiCalls).toBe(2);
  });

  it("uses v1 OAuth endpoints and the stable resource for an authorization-code grant", async () => {
    const launch = vi.spyOn(chrome.identity, "launchWebAuthFlow")
      .mockImplementation(async ({ url }) => {
        const authorize = new URL(url);
        return `${chrome.identity.getRedirectURL()}?code=synthetic&state=${authorize.searchParams.get("state")}`;
      });
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith("/oauth2/token")) {
        return Response.json({
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          expires_in: 300,
        });
      }
      return Response.json(deviceStatus);
    });

    await loginInteractive();

    const authorize = new URL(launch.mock.calls[0]![0].url);
    expect(authorize.origin + authorize.pathname)
      .toBe("https://auth.cqu.moe/api/v1/auth/oauth2/authorize");
    expect(authorize.searchParams.get("resource")).toBe(stableResource);
    const tokenCall = vi.mocked(fetch).mock.calls.find(([input]) =>
      String(input).endsWith("/oauth2/token")
    );
    expect(String(tokenCall?.[0])).toBe("https://auth.cqu.moe/api/v1/auth/oauth2/token");
    const tokenBody = new URLSearchParams(String(tokenCall?.[1]?.body));
    expect(tokenBody.get("grant_type")).toBe("authorization_code");
    expect(tokenBody.get("resource")).toBe(stableResource);
  });

  it("retries device registration with the saved grant before starting another OAuth flow", async () => {
    await chrome.storage.local.set({
      "quicklogin.tokens": {
        accessToken: "saved-access",
        refreshToken: "saved-refresh",
        expiresAt: Date.now() + 300_000,
      },
    });
    const launch = vi.spyOn(chrome.identity, "launchWebAuthFlow");
    vi.mocked(fetch).mockResolvedValue(Response.json({
      ...deviceStatus,
      deviceId: "device-from-saved-grant",
    }));

    await loginInteractive();

    expect(launch).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0]![0]))
      .toBe("https://auth.cqu.moe/api/v1/cqu/quicklogin/devices");
    expect(vi.mocked(fetch).mock.calls[0]![1]?.method).toBe("POST");
    await expect(chrome.storage.local.get("quicklogin.state")).resolves
      .toMatchObject({
        "quicklogin.state": { deviceId: "device-from-saved-grant" },
      });
  });
});
