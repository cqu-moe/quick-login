import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { initialLocalState } from "./storage";
import { applyEnvelope, clearOwnedCookies, inspectLocalTgc } from "./cookie-store";
import type { CookieEnvelope } from "../shared/contracts";

let fake: ReturnType<typeof installChromeFake>;
const envelope: CookieEnvelope = {
  protocolVersion: 1,
  deviceId: "device-a",
  generation: 4,
  sessionVersion: 7,
  createdAt: 1_700_000_000_000,
  cookies: [
    {
      name: "SOURCEID_TGC", value: "synthetic-test-session",
      domain: "sso.cqu.edu.cn", path: "/", secure: true, httpOnly: true,
      sameSite: "Lax", expires: -1,
    },
    {
      name: "SESSION", value: "synthetic-persistent",
      domain: ".sso.cqu.edu.cn", path: "/login", secure: true, httpOnly: true,
      sameSite: "None", expires: 1_900_000_000,
    },
  ],
};

beforeEach(async () => {
  fake = installChromeFake();
  await chrome.storage.local.set({
    "quicklogin.state": {
      ...initialLocalState(), deviceId: "device-a", localGeneration: 1,
      serverGeneration: 4, enabledIntent: true,
    },
  });
});

describe("managed SSO cookies", () => {
  it("applies host-only and domain cookies and only clears owned values", async () => {
    await expect(applyEnvelope(envelope, { localGeneration: 1, allowForeignOnce: false }))
      .resolves.toBe("applied");
    expect(fake.getCookie("SOURCEID_TGC")?.hostOnly).toBe(true);
    expect(fake.getCookie("SESSION", "/login")?.domain).toBe(".sso.cqu.edu.cn");
    expect(await inspectLocalTgc()).toBe("managed");

    await chrome.cookies.set({
      url: "https://sso.cqu.edu.cn/", name: "SOURCEID_TGC", value: "foreign",
      path: "/", storeId: "0", secure: true,
    });
    await clearOwnedCookies();
    expect(fake.getCookie("SOURCEID_TGC")?.value).toBe("foreign");
    expect(fake.getCookie("SESSION", "/login")).toBeNull();
  });

  it("rolls back completed entries when a later write fails", async () => {
    await chrome.cookies.set({
      url: "https://sso.cqu.edu.cn/", name: "SOURCEID_TGC", value: "previous-test-value",
      path: "/", storeId: "0", secure: true, httpOnly: true, sameSite: "lax",
    });
    const original = chrome.cookies.set.bind(chrome.cookies);
    let calls = 0;
    vi.spyOn(chrome.cookies, "set").mockImplementation(async (details) => {
      calls += 1;
      if (calls === 2) throw new Error("temporary");
      return original(details);
    });
    await expect(applyEnvelope(envelope, { localGeneration: 1, allowForeignOnce: true }))
      .rejects.toMatchObject({ code: "COOKIE_WRITE_TRANSIENT" });
    expect(fake.getCookie("SOURCEID_TGC")?.value).toBe("previous-test-value");
  });

  it("protects an unowned TGC unless the user grants one-time replacement", async () => {
    await chrome.cookies.set({
      url: "https://sso.cqu.edu.cn/", name: "SOURCEID_TGC", value: "foreign",
      path: "/", storeId: "0", secure: true,
    });
    await expect(applyEnvelope(envelope, { localGeneration: 1, allowForeignOnce: false }))
      .resolves.toBe("foreign_session");
    expect(fake.getCookie("SOURCEID_TGC")?.value).toBe("foreign");
  });

  it("finds a host-only cookie without relying on Chrome's domain query filter", async () => {
    const getAll = chrome.cookies.getAll.bind(chrome.cookies);
    vi.spyOn(chrome.cookies, "getAll").mockImplementation(async (details) => {
      if (details.domain) return [];
      return getAll(details);
    });

    await expect(applyEnvelope(envelope, {
      localGeneration: 1,
      allowForeignOnce: false,
    })).resolves.toBe("applied");
    expect(fake.getCookie("SOURCEID_TGC")?.value).toBe("synthetic-test-session");
  });

  it("reads host-only cookies through the exact SSO URL", async () => {
    const getAll = chrome.cookies.getAll.bind(chrome.cookies);
    vi.spyOn(chrome.cookies, "getAll").mockImplementation(async (details) => {
      const cookies = await getAll(details);
      if (details.name && !details.url) {
        return cookies.filter((cookie) => !cookie.hostOnly);
      }
      return cookies;
    });

    await expect(applyEnvelope(envelope, {
      localGeneration: 1,
      allowForeignOnce: false,
    })).resolves.toBe("applied");
    expect(fake.getCookie("SOURCEID_TGC")?.value).toBe("synthetic-test-session");
  });

  it("falls back to single-cookie lookup when Chrome omits a host-only cookie from getAll", async () => {
    const getAll = chrome.cookies.getAll.bind(chrome.cookies);
    vi.spyOn(chrome.cookies, "getAll").mockImplementation(async (details) =>
      (await getAll(details)).filter((cookie) => !cookie.hostOnly)
    );

    await expect(applyEnvelope(envelope, {
      localGeneration: 1,
      allowForeignOnce: false,
    })).resolves.toBe("applied");
    expect(fake.getCookie("SOURCEID_TGC")?.value).toBe("synthetic-test-session");
    expect(await inspectLocalTgc()).toBe("managed");
  });

  it("accepts Chrome-normalized attributes after verifying the returned cookie", async () => {
    const originalSet = chrome.cookies.set.bind(chrome.cookies);
    vi.spyOn(chrome.cookies, "set").mockImplementation((details) =>
      originalSet({
        ...details,
        expirationDate: details.expirationDate === undefined
          ? undefined
          : Math.floor(details.expirationDate),
      })
    );
    const normalized = {
      ...envelope,
      cookies: envelope.cookies.map((cookie) =>
        cookie.name === "SESSION" ? { ...cookie, expires: 1_900_000_000.75 } : cookie
      ),
    };

    await expect(applyEnvelope(normalized, {
      localGeneration: 1,
      allowForeignOnce: false,
    })).resolves.toBe("applied");
  });
});
