import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostHog } from "posthog-js/dist/module.no-external";
let PostHogClass: typeof PostHog;
import { sanitizePostHogEvent, type EventLike } from "./posthog-privacy";
import { installChromeFake } from "../test/chrome-fake";

type RawEvent = EventLike & {
  uuid?: string;
  timestamp?: unknown;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
};

const token = "phc-real-sdk-public-token";
const rawEvents: RawEvent[] = [];
const sanitizedEvents: RawEvent[] = [];
const requests: Array<{ url: string; body: unknown }> = [];
let client: PostHog | null = null;
const identityClients: PostHog[] = [];

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  rawEvents.length = 0;
  sanitizedEvents.length = 0;
  requests.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), body: init?.body });
    return Response.json({ status: 1 });
  }));
  PostHogClass = (await import("posthog-js/dist/module.no-external")).PostHog;
});

afterEach(async () => {
  await client?.shutdown();
  await Promise.all(identityClients.splice(0).map(instance => instance.shutdown()));
  client = null;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function initClient(surface: "extension" | "web" = "extension", apiHost = "https://p.cqu.moe"): PostHog {
  client = new PostHogClass();
  client.init(token, {
    api_host: apiHost,
    bootstrap: { distinctID: "central-user-a" },
    persistence: "memory",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_web_experiments: true,
    advanced_disable_flags: true,
    request_batching: false,
    disable_compression: true,
    person_profiles: "never",
    api_transport: "fetch",
    ip: false,
    before_send: event => {
      rawEvents.push(event as RawEvent);
      const sanitized = sanitizePostHogEvent(event, surface);
      sanitizedEvents.push(sanitized as RawEvent);
      return sanitized;
    },
  });
  return client;
}

function requestBody(body: unknown): Record<string, unknown> {
  if (body instanceof FormData) throw new Error("Unexpected form-data request");
  return JSON.parse(String(body)) as Record<string, unknown>;
}

describe("real posthog-js event sanitization", () => {
  it.each(["extension", "web"] as const)("preserves %s transport metadata while removing person data and unknown properties", async (surface) => {
    const instance = initClient(surface);
    const eventName = surface === "web" ? "$pageview" : "quicklogin_operation_completed";
    instance.capture(eventName, {
      telemetry_version: 2,
      product: "quicklogin",
      surface,
      operation: "sync",
      outcome: "failure",
      email: "user@example.com",
      cookie: "secret-cookie",
      $current_url: "https://quicklogin.cqu.moe/download?token=secret-token",
    }, {
      send_instantly: true,
      $set: { $initial_current_url: "https://quicklogin.cqu.moe/download?email=user@example.com" },
      $set_once: { $initial_referring_domain: "sso.cqu.edu.cn" },
    } as never);

    const raw = rawEvents[0]!;
    expect(raw.properties.token).toBe(token);
    expect(raw.properties.distinct_id).toBe("central-user-a");
    expect(raw.properties.$lib_custom_api_host).toBe("https://p.cqu.moe");
    expect(raw.$set).toBeDefined();
    expect(raw.$set_once).toBeDefined();

    const sanitized = sanitizedEvents[0]!;
    expect(Object.keys(sanitized).sort()).toEqual(["event", "properties", "timestamp", "uuid"]);
    expect(sanitized.properties.token).toBe(token);
    expect(sanitized.properties.$geoip_disable).toBe(true);
    expect(sanitized.properties.distinct_id).toBe("central-user-a");
    expect(sanitized.properties.$lib_custom_api_host).toBe("https://p.cqu.moe");
    expect(sanitized.properties.$current_url).toBe("https://quicklogin.cqu.moe/");
    expect(sanitized.properties.email).toBeUndefined();
    expect(sanitized.properties.cookie).toBeUndefined();
    expect(sanitized.$set).toBeUndefined();
    expect(sanitized.$set_once).toBeUndefined();
    expect(JSON.stringify(sanitized)).not.toContain("user@example.com");
    expect(JSON.stringify(sanitized)).not.toContain("secret-cookie");
    expect(JSON.stringify(sanitized)).not.toContain("secret-token");

    await vi.waitFor(() => expect(requests.some(request => {
      if (!request.url.includes("/e/") || request.body === undefined) return false;
      const payload = requestBody(request.body) as { batch: Array<{ event: string; properties: Record<string, unknown> }> };
      const event = payload.batch[0]!;
      return event.event === eventName &&
        event.properties?.token === token && event.properties?.distinct_id === "central-user-a" &&
        event.properties?.$lib_custom_api_host === "https://p.cqu.moe";
    }), JSON.stringify(requests)).toBe(true));
  });

  it.each([
    "https://p.cqu.moe/?token=secret-token",
    "https://secret-token@p.cqu.moe",
    "https://unapproved.example.com",
  ])("does not retain an unapproved custom API host: %s", (host) => {
    const instance = initClient("extension", host);
    instance.capture("quicklogin_operation_completed");
    expect(rawEvents[0]!.properties.$lib_custom_api_host).toBe(host);
    expect(sanitizedEvents[0]!.properties.$lib_custom_api_host).toBeUndefined();
  });

  it("isolates real SDK events across authorization clearing and account switching", async () => {
    vi.stubGlobal("chrome", undefined);
    installChromeFake();
    vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", token);
    vi.stubEnv("VITE_POSTHOG_ALLOW_NON_PRODUCTION", "true");
    vi.stubGlobal("__QUICKLOGIN_BUILD_ID__", "test-build");
    const initialize = PostHogClass.prototype.init;
    vi.spyOn(PostHogClass.prototype, "init").mockImplementation(function (this: PostHog, key, config, name) {
      identityClients.push(this);
      return initialize.call(this, key, { ...config, api_transport: "fetch", disable_compression: true }, name);
    });
    const { initialLocalState, LOCAL_STATE_KEY } = await import("../background/storage");
    const { clearDeviceAuthorization } = await import("../background/auth");
    const { captureQuickloginOperation: capture } = await import("./posthog");
    const localState = { ...initialLocalState(), installationId: "installation-a", deviceId: "device-a", authorization: "authorized" };
    await chrome.storage.local.set({ [LOCAL_STATE_KEY]: { ...localState, centralUserId: "central-user-a" } });
    capture("sync", { outcome: "success", trigger: "user", durationMs: 1 });
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    await clearDeviceAuthorization();
    capture("connect", { outcome: "failure", trigger: "user", durationMs: 1 });
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    await chrome.storage.local.set({ [LOCAL_STATE_KEY]: { ...localState, centralUserId: "central-user-b" } });
    capture("connect", { outcome: "success", trigger: "user", durationMs: 1 });
    await vi.waitFor(() => expect(requests).toHaveLength(3));

    const events = requests.flatMap(request => (requestBody(request.body) as { batch: RawEvent[] }).batch);
    expect(events.map(event => event.properties.distinct_id)).toEqual(["central-user-a", "installation-a", "central-user-b"]);
    expect(events.map(event => event.properties.actor_type)).toEqual(["user", "installation", "user"]);
    expect(events.map(event => event.event)).toEqual(Array(3).fill("quicklogin_operation_completed"));
  });

  it("keeps only minimal identify association fields", () => {
    const instance = initClient();
    instance.capture("$identify", {
      distinct_id: "central-user-a",
      $anon_distinct_id: "installation-a",
      $user_id: "central-user-a",
      email: "user@example.com",
    }, {
      send_instantly: true,
      $set: { email: "user@example.com", name: "Real User" },
      $set_once: { $initial_browser: "Chrome" },
    } as never);

    const sanitized = sanitizedEvents[0]!;
    expect(sanitized.properties).toMatchObject({
      token,
      distinct_id: "central-user-a",
      $anon_distinct_id: "installation-a",
      $user_id: "central-user-a",
    });
    expect(sanitized.properties.email).toBeUndefined();
    expect(sanitized.$set).toBeUndefined();
    expect(sanitized.$set_once).toBeUndefined();
    expect(JSON.stringify(sanitized)).not.toContain("user@example.com");
    expect(JSON.stringify(sanitized)).not.toContain("Real User");
  });

  it("passes recorder-compressed snapshot data through without recursive rewriting", () => {
    const instance = initClient("web");
    const snapshotData = [{ type: 2, data: "\x1f\x8bopaque-compressed-dom-payload" }];
    instance.capture("$snapshot", {
      $snapshot_data: snapshotData,
      $snapshot_bytes: 43,
      $session_id: "session-a",
      $window_id: "window-a",
      $lib: "web",
      $lib_version: "1.433.5",
      $snapshot_host: "quicklogin.cqu.moe",
      email: "user@example.com",
    }, {
      send_instantly: true,
      _batchKey: "recordings",
      _noTruncate: true,
    } as never);

    const raw = rawEvents[0]!;
    const sanitized = sanitizedEvents[0]!;
    expect(sanitized.properties.$snapshot_data).toBe(raw.properties.$snapshot_data);
    expect(sanitized.properties.$snapshot_data).toBe(snapshotData);
    expect(sanitized.properties.token).toBe(token);
    expect(sanitized.properties.$geoip_disable).toBe(true);
    expect(sanitized.properties.distinct_id).toBe("central-user-a");
    expect(sanitized.properties.$snapshot_bytes).toBe(43);
    expect(sanitized.properties.$session_id).toBe("session-a");
    expect(sanitized.properties.$window_id).toBe("window-a");
    expect(sanitized.properties.$snapshot_host).toBe("quicklogin.cqu.moe");
    expect(sanitized.properties.email).toBeUndefined();
    expect(Object.keys(sanitized).sort()).toEqual(["event", "properties", "timestamp", "uuid"]);
  });
});
