import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { initialLocalState, readLocalState } from "./storage";
import { applyEnvelope, clearOwnedCookies, inspectLocalTgc, recoverInterruptedWrite } from "./cookie-store";
import { JOURNAL_KEY } from "./cookie-journal";
import type { CookieEnvelope } from "../shared/contracts";

let fake: ReturnType<typeof installChromeFake>;
const envelope: CookieEnvelope = {
  protocolVersion: 2,
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
    "quicklogin.state.v2": {
      ...initialLocalState(), deviceId: "device-a", localGeneration: 1,
      serverGeneration: 4, enabledIntent: true,
    },
  });
});

describe("managed SSO cookies", () => {
  it("keeps obsolete owned-cookie evidence when replacement cannot remove it safely",async()=>{
    const old={...envelope,cookies:envelope.cookies.map(cookie=>cookie.name==="SOURCEID_TGC"
      ? {...cookie,domain:".sso.cqu.edu.cn" as const}:cookie)};
    await applyEnvelope(old,{localGeneration:1,allowForeignOnce:false});
    await expect(applyEnvelope(envelope,{localGeneration:1,allowForeignOnce:false})).resolves.toBe("foreign_session");
    const local=await readLocalState();
    expect(local.managed.filter((entry:{name:string})=>entry.name==="SOURCEID_TGC")).toHaveLength(2);
    fake.cookieStore.delete("0\0sso.cqu.edu.cn\0/\0SOURCEID_TGC");
    await clearOwnedCookies();
    expect(fake.getCookie("SOURCEID_TGC")).toBeNull();
  });
  it("retains rollback ownership until an ambiguous foreign cookie is gone",async()=>{
    await chrome.cookies.set({url:"https://sso.cqu.edu.cn/",domain:".sso.cqu.edu.cn",name:"SOURCEID_TGC",
      value:"foreign-domain-cookie",path:"/",storeId:"0",secure:true});
    const original=chrome.cookies.set.bind(chrome.cookies);
    vi.spyOn(chrome.cookies,"set").mockImplementation(async(details)=>{
      await original(details); throw new Error("write response interrupted");
    });
    await expect(applyEnvelope(envelope,{localGeneration:1,allowForeignOnce:true})).rejects.toBeDefined();
    expect((await chrome.storage.local.get(JOURNAL_KEY))[JOURNAL_KEY]).toMatchObject({phase:"writing"});
    expect([...fake.cookieStore.values()].find(cookie=>cookie.domain===".sso.cqu.edu.cn")?.value).toBe("foreign-domain-cookie");
    fake.cookieStore.delete("0\0.sso.cqu.edu.cn\0/\0SOURCEID_TGC");
    await recoverInterruptedWrite();
    expect(fake.getCookie("SOURCEID_TGC")).toBeNull();
    expect((await chrome.storage.local.get(JOURNAL_KEY))[JOURNAL_KEY]).toBeUndefined();
  });
  it("restores a prepared cookie when the write succeeds but its response is interrupted", async () => {
    await chrome.cookies.set({
      url: "https://sso.cqu.edu.cn/", name: "SOURCEID_TGC", value: "previous-test-value",
      path: "/", storeId: "0", secure: true, httpOnly: true, sameSite: "lax",
    });
    const original = chrome.cookies.set.bind(chrome.cookies);
    let interrupted = false;
    vi.spyOn(chrome.cookies, "set").mockImplementation(async (details) => {
      const value = await original(details);
      if (!interrupted) { interrupted = true; throw new Error("response interrupted after browser write"); }
      return value;
    });
    await expect(applyEnvelope(envelope, { localGeneration: 1, allowForeignOnce: true }))
      .rejects.toMatchObject({ code: "COOKIE_WRITE_TRANSIENT" });
    expect(fake.getCookie("SOURCEID_TGC")?.value).toBe("previous-test-value");
  });

  it("never deletes an ambiguous foreign domain cookie during owned cleanup", async () => {
    await chrome.cookies.set({
      url: "https://sso.cqu.edu.cn/", domain: ".sso.cqu.edu.cn", name: "SOURCEID_TGC",
      value: "foreign-domain-cookie", path: "/", storeId: "0", secure: true,
    });
    await applyEnvelope(envelope, { localGeneration: 1, allowForeignOnce: true });
    await clearOwnedCookies();
    const cookies = await chrome.cookies.getAll({ name: "SOURCEID_TGC", storeId: "0" });
    expect(cookies.find((cookie) => cookie.domain === ".sso.cqu.edu.cn")?.value)
      .toBe("foreign-domain-cookie");
  });
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
