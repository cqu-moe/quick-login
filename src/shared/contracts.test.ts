import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateCookieEnvelope } from "./cookie-validation";
import { validateApiError, validateDeviceStatus } from "./validation";
import type { CookieEnvelope, DeviceStatus } from "./contracts";

async function fixture() {
  return JSON.parse(await readFile(
    resolve(process.cwd(), "tests/fixtures/protocol-v2.json"), "utf8"
  )) as { status: DeviceStatus; envelope: CookieEnvelope; error: unknown };
}

describe("protocol v2 fixture", () => {
  it("accepts the shared valid status, envelope and error", async () => {
    const value = await fixture();
    expect(validateDeviceStatus(value.status).generation).toBe(4);
    expect(validateCookieEnvelope(value.envelope).sessionVersion).toBe(7);
    expect(validateApiError(value.error).error.code).toBe("RATE_LIMITED");
  });

  it("rejects version drift, parent domains, empty TGC and wrong field types", async () => {
    const value = await fixture();
    expect(() => validateDeviceStatus({ ...value.status, protocolVersion: 1 })).toThrow();
    expect(() => validateDeviceStatus({ ...value.status, used: "2" })).toThrow();
    expect(() => validateCookieEnvelope({
      ...value.envelope,
      cookies: value.envelope.cookies.map((cookie) => ({ ...cookie, domain: ".cqu.edu.cn" })),
    } as unknown as CookieEnvelope)).toThrow();
    expect(() => validateCookieEnvelope({
      ...value.envelope,
      cookies: value.envelope.cookies.map((cookie) =>
        cookie.name === "SOURCEID_TGC" ? { ...cookie, value: "" } : cookie
      ),
    })).toThrow();
  });
});
