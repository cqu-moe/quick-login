import { describe, expect, it } from "vitest";
import { sanitizePostHogEvent, telemetryErrorCode } from "./posthog";

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
    expect(event?.properties.url).toBe("https://auth.cqu.moe/callback");
  });

  it("keeps only bounded stable error codes", () => {
    expect(telemetryErrorCode({ code: "COOKIE_PERMISSION_DENIED" })).toBe("COOKIE_PERMISSION_DENIED");
    expect(telemetryErrorCode(new Error("token=secret-token"))).toBe("UNEXPECTED_ERROR");
    expect(telemetryErrorCode({ code: "not safe user@example.com" })).toBe("UNEXPECTED_ERROR");
  });
});
