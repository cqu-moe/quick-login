import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { exportCookies, refresh, register, setDeviceEnabled, status } from "./api";
import { initialLocalState } from "./storage";

const devicesUrl = "https://auth.cqu.moe/api/v1/cqu/quicklogin/devices";
const encodedDeviceUrl = `${devicesUrl}/device%2Fa%20b`;

beforeEach(async () => {
  installChromeFake();
  await chrome.storage.local.set({
    "quicklogin.tokens": {
      accessToken: "current-access",
      refreshToken: "current-refresh",
      expiresAt: Date.now() + 300_000,
    },
    "quicklogin.state": {
      ...initialLocalState(),
      deviceId: "device/a b",
    },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
});

function capturedRequest() {
  expect(fetch).toHaveBeenCalledTimes(1);
  const [input, init] = vi.mocked(fetch).mock.calls[0]!;
  return { url: String(input), init: init! };
}

describe("QuickLogin API requests", () => {
  it("registers a device at the v1 collection path with its metadata", async () => {
    const metadata = {
      deviceName: "My Chrome",
      browserFamily: "chrome" as const,
      browserVersion: "140.0.0.0",
    };

    await register(metadata);

    const request = capturedRequest();
    expect(request.url).toBe(devicesUrl);
    expect(request.init.method).toBe("POST");
    expect(request.init.body).toBe(JSON.stringify(metadata));
  });

  it("posts device status using the v2 observed-generation contract", async () => {
    const heartbeat = {
      protocolVersion: 2 as const,
      observedGeneration: 7,
      appliedVersion: 5,
      browserVersion: "140.0.0.0",
    };

    await status(heartbeat);

    const request = capturedRequest();
    expect(request.url).toBe(`${encodedDeviceUrl}/status`);
    expect(request.init.method).toBe("POST");
    expect(request.init.body).toBe(JSON.stringify(heartbeat));
  });

  it("updates device enablement at the v1 device path", async () => {
    await setDeviceEnabled(true);

    const request = capturedRequest();
    expect(request.url).toBe(encodedDeviceUrl);
    expect(request.init.method).toBe("PUT");
    expect(request.init.body).toBe(JSON.stringify({ enabled: true }));
  });

  it("requests a refresh at the v1 refresh path with generation protection", async () => {
    await refresh(7);

    const request = capturedRequest();
    expect(request.url).toBe(`${encodedDeviceUrl}/refresh`);
    expect(request.init.method).toBe("POST");
    expect(request.init.body).toBe(JSON.stringify({ protocolVersion: 2, generation: 7 }));
  });

  it("exports cookies at the v1 export path with generation and version protection", async () => {
    await exportCookies(7, 11);

    const request = capturedRequest();
    expect(request.url).toBe(`${encodedDeviceUrl}/export`);
    expect(request.init.method).toBe("POST");
    expect(request.init.body).toBe(JSON.stringify({
      protocolVersion: 2,
      generation: 7,
      sessionVersion: 11,
    }));
  });
});
