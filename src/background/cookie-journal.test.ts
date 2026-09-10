import { beforeEach, describe, expect, it } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { initialLocalState } from "./storage";
import { JOURNAL_KEY } from "./cookie-journal";
import { recoverInterruptedWrite } from "./cookie-store";

beforeEach(async () => {
  installChromeFake();
  await chrome.storage.local.set({ "quicklogin.state": initialLocalState() });
});

describe("cookie journal recovery", () => {
  it("preserves an unknown current value when plaintext snapshots are gone", async () => {
    await chrome.cookies.set({
      url: "https://sso.cqu.edu.cn/", name: "SOURCEID_TGC", value: "new-owner-value",
      path: "/", storeId: "0", secure: true,
    });
    await chrome.storage.local.set({
      [JOURNAL_KEY]: {
        id: "journal-a", localGeneration: 1, serverGeneration: 4,
        sessionVersion: 7, phase: "writing",
        entries: [{
          name: "SOURCEID_TGC", domain: "sso.cqu.edu.cn", path: "/", storeId: "0",
          digest: "different", previousDigest: null, expectedDigest: "different", completed: true,
        }],
      },
    });
    await recoverInterruptedWrite();
    const cookies = await chrome.cookies.getAll({ name: "SOURCEID_TGC", storeId: "0" });
    expect(cookies[0].value).toBe("new-owner-value");
    expect((await chrome.storage.local.get(JOURNAL_KEY))[JOURNAL_KEY]).toBeUndefined();
  });
});
