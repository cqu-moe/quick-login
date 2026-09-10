import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { authorizedFetch, loginInteractive } from "./auth";

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
      if (url.endsWith("/api/auth/oauth2/token")) {
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
      if (String(input).endsWith("/api/auth/oauth2/token")) {
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
});
