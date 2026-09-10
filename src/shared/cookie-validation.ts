import type { CookieEnvelope, ExportedCookie } from "./contracts";

const ALLOWED_DOMAINS = new Set(["sso.cqu.edu.cn", ".sso.cqu.edu.cn"]);
const MAX_ENVELOPE_BYTES = 256 * 1024;

export class CookieValidationError extends Error {
  constructor(public readonly code: "INVALID_COOKIE_ENVELOPE") {
    super(code);
  }
}

function validCookie(cookie: ExportedCookie): boolean {
  const keys = Object.keys(cookie).sort().join(",");
  return keys === "domain,expires,httpOnly,name,path,sameSite,secure,value" &&
    typeof cookie.name === "string" && cookie.name.length > 0 &&
    typeof cookie.value === "string" &&
    ALLOWED_DOMAINS.has(cookie.domain) &&
    typeof cookie.path === "string" && cookie.path.startsWith("/") &&
    typeof cookie.secure === "boolean" && typeof cookie.httpOnly === "boolean" &&
    ["Strict", "Lax", "None"].includes(cookie.sameSite) &&
    Number.isFinite(cookie.expires) && (cookie.expires === -1 || cookie.expires > 0) &&
    !(cookie.sameSite === "None" && !cookie.secure);
}

export function validateCookieEnvelope(value: CookieEnvelope): CookieEnvelope {
  if (!value || Object.keys(value).sort().join(",") !==
      "cookies,createdAt,deviceId,generation,protocolVersion,sessionVersion" ||
      value.protocolVersion !== 1 || !value.deviceId ||
      !Number.isSafeInteger(value.generation) || value.generation < 0 ||
      !Number.isSafeInteger(value.sessionVersion) || value.sessionVersion < 0 ||
      !Number.isSafeInteger(value.createdAt) || !Array.isArray(value.cookies) ||
      value.cookies.length === 0 || value.cookies.length > 64 ||
      new TextEncoder().encode(JSON.stringify(value)).length > MAX_ENVELOPE_BYTES ||
      value.cookies.some((cookie) => !validCookie(cookie)) ||
      !value.cookies.some((cookie) => cookie.name === "SOURCEID_TGC" && cookie.value.length > 0)) {
    throw new CookieValidationError("INVALID_COOKIE_ENVELOPE");
  }
  const keys = new Set<string>();
  for (const cookie of value.cookies) {
    const key = `${cookie.name}\0${cookie.domain}\0${cookie.path}`;
    if (keys.has(key)) throw new CookieValidationError("INVALID_COOKIE_ENVELOPE");
    keys.add(key);
  }
  return value;
}
