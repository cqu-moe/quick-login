import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import {
  sanitizePostHogEvent,
  telemetryErrorCode,
} from "./posthog";

const initializedClients = vi.hoisted(() => [] as Array<{
  token: string;
  config: Record<string, unknown>;
  capture: ReturnType<typeof vi.fn>;
}>);

vi.mock("posthog-js/dist/module.no-external", () => ({
  PostHog: class {
    capture = vi.fn(async () => undefined);

    init(token: string, config: Record<string, unknown>) {
      initializedClients.push({ token, config, capture: this.capture });
      return this;
    }
  },
}));

beforeEach(() => {
  vi.unstubAllEnvs();
  installChromeFake();
  initializedClients.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QuickLogin PostHog privacy boundary", () => {
  it("removes cookie and auth material from nested events", () => {
    const event = sanitizePostHogEvent({
      event: "$exception",
      properties: {
        service: "quicklogin",
        cookie: "SOURCEID_TGC=secret-cookie",
        accessToken: "secret-access-token",
        refresh_token: "secret-refresh-token",
        code: "secret-code",
        url: "https://auth.cqu.moe/callback?code=secret-code#fragment",
        message: "authorization=Bearer-secret user@example.com",
      },
    });

    const serialized = JSON.stringify(event);
    for (const secret of [
      "secret-cookie",
      "secret-access-token",
      "secret-refresh-token",
      "secret-code",
      "user@example.com",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(event).toBeNull();
  });

  it("keeps only bounded stable error codes", () => {
    expect(telemetryErrorCode({ code: "COOKIE_PERMISSION_DENIED" })).toBe("COOKIE_PERMISSION_DENIED");
    expect(telemetryErrorCode(new Error("token=secret-token"))).toBe("UNEXPECTED_ERROR");
    expect(telemetryErrorCode({ code: "not safe user@example.com" })).toBe("UNEXPECTED_ERROR");
  });

  it("sends the v2 operation contract through a privacy-safe optional client", async () => {
    vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "public-project-token");
    vi.stubEnv("VITE_POSTHOG_ALLOW_NON_PRODUCTION", "true");
    vi.stubGlobal("__QUICKLOGIN_BUILD_ID__", "test-build");
    vi.resetModules();
    const { captureQuickloginOperation: capture } = await import("./posthog");
    capture("sync", {
      outcome: "failure",
      trigger: "scheduled",
      durationMs: 7,
      operationId: "export-a",
      errorCode: "RATE_LIMITED",
    });

    await vi.waitFor(() => expect(initializedClients[0]?.capture).toHaveBeenCalledOnce());
    const client = initializedClients[0]!;
    expect(client.token).toBe("public-project-token");
    expect(client.config).toMatchObject({
      api_host: "https://p.cqu.moe",
      autocapture: false,
      rageclick: false,
      capture_performance: false,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_surveys_automatic_display: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_web_experiments: true,
      logs: { captureConsoleLogs: false },
      save_referrer: false,
      save_campaign_params: false,
      disable_scroll_properties: true,
      advanced_disable_flags: true,
      person_profiles: "never",
      capture_exceptions: false,
      ip: false,
    });
    expect(String(client.config.bootstrap)).not.toContain("public-project-token");
    expect(client.capture.mock.calls[0]?.[0]).toBe("quicklogin_operation_completed");
    expect(client.capture.mock.calls[0]?.[1]).toMatchObject({
      telemetry_version: 2,
      product: "quicklogin",
      surface: "extension",
      actor_type: "installation",
      environment: "test",
      release: "test-build",
      is_test: true,
      operation: "sync",
      outcome: "failure",
      trigger: "scheduled",
      duration_ms: 7,
      operation_id: "export-a",
      error_code: "RATE_LIMITED",
      $process_person_profile: false,
    });
    expect(client.capture.mock.calls[0]?.[2]).toEqual({ send_instantly: true });
  });

  it("uses the authenticated central identity after the device is connected", async () => {
    vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "public-project-token");
    vi.stubEnv("VITE_POSTHOG_ALLOW_NON_PRODUCTION", "true");
    vi.stubGlobal("__QUICKLOGIN_BUILD_ID__", "test-build");
    vi.resetModules();
    const { initialLocalState, LOCAL_STATE_KEY } = await import("../background/storage");
    await chrome.storage.local.set({ [LOCAL_STATE_KEY]: {
      ...initialLocalState(),
      installationId: "installation-a",
      centralUserId: "central-user-a",
      deviceId: "device-a",
      authorization: "authorized",
    } });
    const { captureQuickloginOperation: capture } = await import("./posthog");
    capture("sync", { outcome: "success", trigger: "user", durationMs: 3 });

    await vi.waitFor(() => expect(initializedClients[0]?.capture).toHaveBeenCalledOnce());
    expect(initializedClients[0]!.config.bootstrap).toEqual({ distinctID: "central-user-a" });
    expect(initializedClients[0]!.capture.mock.calls[0]?.[1]).toMatchObject({ actor_type: "user" });
  });

  it("does not initialize sending outside production without an explicit test override", async () => {
    vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "public-project-token");
    vi.resetModules();
    const { captureQuickloginOperation: capture } = await import("./posthog");
    capture("sync", { outcome: "success", trigger: "user", durationMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(initializedClients).toHaveLength(0);
  });

  it("falls back to installation identity when a stored central identity is not currently connected", async () => {
    vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "public-project-token");
    vi.stubEnv("VITE_POSTHOG_ALLOW_NON_PRODUCTION", "true");
    vi.stubGlobal("__QUICKLOGIN_BUILD_ID__", "test-build");
    vi.resetModules();
    const { initialLocalState, LOCAL_STATE_KEY } = await import("../background/storage");
    await chrome.storage.local.set({ [LOCAL_STATE_KEY]: {
      ...initialLocalState(),
      installationId: "installation-a",
      centralUserId: "central-user-a",
      deviceId: "device-a",
      authorization: "reconnect_required",
    } });
    const { captureQuickloginOperation: capture } = await import("./posthog");
    capture("connect", { outcome: "failure", trigger: "user", durationMs: 2 });

    await vi.waitFor(() => expect(initializedClients[0]?.capture).toHaveBeenCalledOnce());
    expect(initializedClients[0]!.config.bootstrap).toEqual({ distinctID: "installation-a" });
    expect(initializedClients[0]!.capture.mock.calls[0]?.[1]).toMatchObject({ actor_type: "installation" });
  });

});
