import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { initialLocalState } from "./storage";
import * as syncModule from "./sync";
import { handleContentMessage } from "./messages";

const sender = {
  id: "test-extension",
  url: "https://sso.cqu.edu.cn/login?service=synthetic",
  tab: { id: 7 },
  documentId: "document-one",
} as chrome.runtime.MessageSender;

beforeEach(() => installChromeFake());

describe("one login-page recovery", () => {
  it("navigates once after a completed write, then requires manual login", async () => {
    await chrome.storage.local.set({
      "quicklogin.state": {
        ...initialLocalState(), deviceId: "device-a", localWriteState: "ready",
        recovery: {
          id: "round-a", generation: 4, sessionVersion: 7, phase: "finished",
          downloadRetries: 0, writeRetries: 0, nextAttemptAt: null, navigatedTabId: null,
        },
      },
    });
    vi.spyOn(syncModule, "sync").mockResolvedValue();
    await expect(handleContentMessage({ type: "LOGIN_FORM_VISIBLE" }, sender))
      .resolves.toEqual({ kind: "navigating" });
    await expect(handleContentMessage(
      { type: "LOGIN_FORM_VISIBLE" },
      { ...sender, documentId: "document-two" }
    ))
      .resolves.toMatchObject({ kind: "manual_required" });
  });

  it("rejects content messages outside the exact SSO login page", async () => {
    await expect(handleContentMessage(
      { type: "LOGIN_FORM_VISIBLE" },
      { ...sender, url: "https://attacker.example/login" }
    )).rejects.toThrow("FORBIDDEN");
  });
});
