import { beforeEach, describe, expect, it, vi } from "vitest";
import { snapshot, response } from "../test/protocol-fixtures";
import { updateLocalState } from "./storage";
import { installChromeFake } from "../test/chrome-fake";
import { authorizedFetch, clearDeviceAuthorization, loginInteractive } from "./auth";

const stableResource = "https://auth.cqu.moe/api/auth";

const deviceStatus = { deviceId: "device-a", snapshot: snapshot() };


beforeEach(() => {
  installChromeFake();
  vi.stubGlobal("fetch", vi.fn());
});

describe("device authorization", () => {
  it("requires explicit resume for an existing device whose tokens are missing",async()=>{
    await updateLocalState(state=>({...state,deviceId:"existing-device",authorization:"reconnect_required"}));
    const launch=vi.spyOn(chrome.identity,"launchWebAuthFlow");
    await expect(loginInteractive()).rejects.toMatchObject({code:"AUTH_RECONNECT_REQUIRED"});
    expect(launch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps a rotated refresh token when only the local cookie intent changes", async () => {
    await chrome.storage.local.set({"quicklogin.tokens":{accessToken:"expired",refreshToken:"old-refresh",expiresAt:0}});
    let release!: (response:Response)=>void;
    vi.mocked(fetch).mockImplementation((input)=>String(input).endsWith("/oauth2/token")
      ? new Promise((resolve)=>{release=resolve;}) : Promise.resolve(Response.json({ok:true})));
    const pending=authorizedFetch("/probe");
    const result=expect(pending).resolves.toMatchObject({status:200});
    await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce());
    await updateLocalState((state)=>({...state,manualOverride:true,localGeneration:state.localGeneration+1}));
    release(Response.json({access_token:"new-access",refresh_token:"rotated-refresh",expires_in:300}));
    await result;
    expect((await chrome.storage.local.get("quicklogin.tokens"))["quicklogin.tokens"]).toMatchObject({refreshToken:"rotated-refresh"});
  });
  it("does not restore tokens from a refresh that finishes after disconnect", async () => {
    await chrome.storage.local.set({
      "quicklogin.tokens": { accessToken: "expired", refreshToken: "synthetic", expiresAt: 0 },
    });
    let release!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation((input) => String(input).endsWith("/oauth2/token")
      ? new Promise((resolve) => { release = resolve; })
      : Promise.resolve(Response.json({ ok: true })));
    const pending = authorizedFetch("/probe");
    const result = expect(pending).rejects.toMatchObject({ code: "AUTH_RECONNECT_REQUIRED" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await clearDeviceAuthorization();
    release(Response.json({ access_token: "late-access", refresh_token: "late-refresh", expires_in: 300 }));
    await result;
    expect((await chrome.storage.local.get("quicklogin.tokens"))["quicklogin.tokens"]).toBeFalsy();
  });
  it("rejects an OAuth callback with the right state but a different path", async () => {
    vi.spyOn(chrome.identity, "launchWebAuthFlow").mockImplementation(async ({ url }) =>
      `https://test-extension.chromiumapp.org/unexpected?code=synthetic&state=${new URL(url).searchParams.get("state")}`
    );
    vi.mocked(fetch).mockImplementation(async (input) => Response.json(
      String(input).endsWith("/oauth2/token")
        ? { access_token: "fresh-access", refresh_token: "fresh-refresh", expires_in: 300 }
        : response(deviceStatus)
    ));
    await expect(loginInteractive()).rejects.toThrow("OAUTH_STATE_MISMATCH");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([{ error: "invalid_grant" }, { code: "INVALID_GRANT", message: "invalid refresh token" }])("recognizes invalid refresh grants: %j", async (body) => {
    await chrome.storage.local.set({
      "quicklogin.tokens": { accessToken: "expired", refreshToken: "synthetic", expiresAt: 0 },
    });
    vi.mocked(fetch).mockResolvedValue(Response.json(body, { status: 400 }));
    await expect(authorizedFetch("/probe")).rejects.toMatchObject({ code: "AUTH_RECONNECT_REQUIRED" });
  });

  it("retains a refresh grant when the token service is unavailable", async () => {
    await chrome.storage.local.set({
      "quicklogin.tokens": { accessToken: "expired", refreshToken: "synthetic", expiresAt: 0 },
    });
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    await expect(authorizedFetch("/probe")).rejects.toMatchObject({ code: "TEMPORARY_UNAVAILABLE" });
    expect((await chrome.storage.local.get("quicklogin.tokens"))["quicklogin.tokens"])
      .toMatchObject({ refreshToken: "synthetic" });
  });
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
        ? Response.json({ code: "AUTH_RECONNECT_REQUIRED", detail: "access token expired" }, { status: 401 })
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
      return Response.json(response(deviceStatus));
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
    vi.spyOn(navigator, "platform", "get").mockReturnValue("macOS");
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36"
    );
    await chrome.storage.local.set({
      "quicklogin.tokens": {
        accessToken: "saved-access",
        refreshToken: "saved-refresh",
        expiresAt: Date.now() + 300_000,
      },
    });
    const launch = vi.spyOn(chrome.identity, "launchWebAuthFlow");
    vi.mocked(fetch).mockResolvedValue(Response.json(response({
      deviceId: "device-from-saved-grant",
      snapshot: { ...snapshot(), identity: { ...snapshot().identity, deviceId: "device-from-saved-grant" } },
    })));

    await loginInteractive();

    expect(launch).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0]![0]))
      .toBe("https://auth.cqu.moe/api/v1/cqu/quicklogin/registrations");
    expect(vi.mocked(fetch).mock.calls[0]![1]?.method).toBe("POST");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toMatchObject({
      protocolVersion: 3, deviceName: "macOS Chrome",
      client: { extensionVersion: "0.2.0", browserVersion: "140.0.0.0" },
    });
    await expect(chrome.storage.local.get("quicklogin.state.v2")).resolves
      .toMatchObject({
        "quicklogin.state.v2": { deviceId: "device-from-saved-grant" },
      });
  });
});
