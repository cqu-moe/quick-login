import { beforeEach, describe, expect, it, vi } from "vitest";

const initializedClients = vi.hoisted(() => [] as Array<{
  token: string;
  config: Record<string, unknown>;
  startSessionRecording: ReturnType<typeof vi.fn>;
  capture: ReturnType<typeof vi.fn>;
}>);

vi.mock("posthog-js/dist/module.no-external", () => ({
  PostHog: class {
    capture = vi.fn();
    startSessionRecording = vi.fn();

    init(token: string, config: Record<string, unknown>) {
      initializedClients.push({
        token,
        config,
        startSessionRecording: this.startSessionRecording,
        capture: this.capture,
      });
      return this;
    }
  },
}));

vi.mock("posthog-js/dist/lazy-recorder", () => ({}));

const allowedLocation = { origin: "https://quicklogin.cqu.moe", href: "https://quicklogin.cqu.moe/" };

beforeEach(() => {
  allowedLocation.origin = "https://quicklogin.cqu.moe";
  vi.resetModules();
  initializedClients.length = 0;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.stubGlobal("__QUICKLOGIN_WEBSITE_RELEASE__", "0.4.6+test");
});

describe("QuickLogin website telemetry boundary", () => {
  it("initializes recording only for the production website and public token", async () => {
    vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "public-project-token");
    vi.stubEnv("VITE_POSTHOG_ALLOW_NON_PRODUCTION", "true");
    const { initializeWebsiteTelemetry } = await import("./telemetry");

    expect(initializeWebsiteTelemetry({ origin: "https://auth.cqu.moe", href: "https://auth.cqu.moe/" })).toBeNull();
    expect(initializeWebsiteTelemetry({ origin: "https://sso.cqu.edu.cn", href: "https://sso.cqu.edu.cn/login" })).toBeNull();
    expect(initializeWebsiteTelemetry({ origin: "http://localhost:4173", href: "http://localhost:4173/" })).toBeNull();
    expect(initializedClients).toHaveLength(0);

    expect(initializeWebsiteTelemetry(allowedLocation)).toBeInstanceOf(Object);
    const client = initializedClients[0]!;
    expect(client.token).toBe("public-project-token");
    expect(client.config).toMatchObject({
      api_host: "https://p.cqu.moe",
      asset_host: "https://p.cqu.moe",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_exceptions: false,
      disable_session_recording: false,
      person_profiles: "never",
      ip: false,
      session_recording: {
        sampleRate: 1,
        maskAllInputs: true,
        maskAllElementAttributes: true,
        slimDOMOptions: "all",
        collectFonts: false,
        captureJsonLd: false,
        recordCrossOriginIframes: false,
        recordHeaders: false,
        recordBody: false,
        streamNetworkBody: false,
        maskCapturedNetworkRequestFn: expect.any(Function),
      },
    });
    const recordingConfig = client.config.session_recording as Record<string, unknown>;
    const maskUrl = recordingConfig.maskCapturedNetworkRequestFn as (request: Record<string, unknown>) => unknown;
    expect(maskUrl({ name: "https://quicklogin.cqu.moe/?token=private" })).toEqual({ name: "https://quicklogin.cqu.moe/" });
    expect(maskUrl({ name: "https://quicklogin.cqu.moe/api", requestBody: "private" })).toBeNull();
    expect(maskUrl({ name: "https://sso.cqu.edu.cn/" })).toBeNull();
    expect(String(recordingConfig.blockSelector)).toContain("img");
    expect(String(recordingConfig.blockSelector)).toContain("iframe");
    expect(client.startSessionRecording).toHaveBeenCalledWith(true);
    expect(client.capture).toHaveBeenCalledWith("$pageview", expect.objectContaining({
      telemetry_version: 2,
      product: "quicklogin",
      surface: "web",
      actor_type: "user",
      release: "0.4.6+test",
    }));
  });

  it("stays silent when the public token is not configured", async () => {
    const { initializeWebsiteTelemetry } = await import("./telemetry");

    expect(initializeWebsiteTelemetry(allowedLocation)).toBeNull();
    expect(initializedClients).toHaveLength(0);
  });

  it("stays silent outside production without an explicit test override", async () => {
    vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "public-project-token");
    const { initializeWebsiteTelemetry } = await import("./telemetry");

    expect(initializeWebsiteTelemetry(allowedLocation)).toBeNull();
    expect(initializedClients).toHaveLength(0);
  });

  it("sanitizes outgoing URLs and credentials from allowed pages only", async () => {
    vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "public-project-token");
    vi.stubEnv("VITE_POSTHOG_ALLOW_NON_PRODUCTION", "true");
    const { initializeWebsiteTelemetry } = await import("./telemetry");
    initializeWebsiteTelemetry(allowedLocation);
    const beforeSend = initializedClients[0]!.config.before_send as (event: unknown) => unknown;

    const event = {
      event: "$pageview",
      properties: {
        $current_url: "https://quicklogin.cqu.moe/download?token=secret-token#next",
        email: "user@example.com",
        nested: { authorization: "Bearer secret-token" },
      },
    };
    const sanitized = beforeSend(event) as typeof event;
    expect(sanitized.properties.$current_url).toBe("https://quicklogin.cqu.moe/");
    expect(sanitized.properties.email).toBeUndefined();
    expect(sanitized.properties.nested).toBeUndefined();
    expect(JSON.stringify(sanitized)).not.toContain("secret-token");
    expect(JSON.stringify(sanitized)).not.toContain("user@example.com");

    allowedLocation.origin = "https://sso.cqu.edu.cn";
    expect(beforeSend({
      event: "$pageview",
      properties: { $current_url: "https://sso.cqu.edu.cn/login?token=secret-token" },
    })).toBeNull();
  });
});
