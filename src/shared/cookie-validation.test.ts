import { describe, expect, it } from "vitest";
import { validateCookieEnvelope } from "./cookie-validation";
import type { CookieEnvelope } from "./contracts";

function envelope(domain: string, value = "synthetic-test-session") {
  return {
  protocolVersion: 2,
    deviceId: "device-a",
    generation: 4,
    sessionVersion: 7,
    createdAt: 1_700_000_000_000,
    cookies: [{
      name: "SOURCEID_TGC", value, domain, path: "/", secure: true,
      httpOnly: true, sameSite: "Lax", expires: -1,
    }],
  } as CookieEnvelope;
}

describe("cookie envelope validation", () => {
  it("accepts only the exact SSO cookie domains", () => {
    expect(validateCookieEnvelope(envelope("sso.cqu.edu.cn"))).toBeDefined();
    expect(() => validateCookieEnvelope(envelope(".cqu.edu.cn"))).toThrow();
  });

  it("requires a non-empty TGC", () => {
    expect(() => validateCookieEnvelope(envelope("sso.cqu.edu.cn", ""))).toThrow();
  });
});
