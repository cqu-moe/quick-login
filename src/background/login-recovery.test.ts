import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { initialLocalState, updateLocalState } from "./storage";
import { snapshot, receipt } from "../test/protocol-fixtures";
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
  it("rechecks the same document after a pending cloud job becomes ready",async()=>{
    vi.spyOn(syncModule,"sync").mockResolvedValue();
    const waitingSender={...sender,documentId:"waiting-document"};
    await expect(handleContentMessage({type:"LOGIN_FORM_VISIBLE"},waitingSender)).resolves.toMatchObject({kind:"idle"});
    await updateLocalState(state=>({...state,deviceId:"device-a",snapshot:snapshot(),receipt:receipt(),pendingAck:false,
      enabledIntent:true,localWriteState:"ready",recovery:{id:"round-wait",generation:4,sessionVersion:7,
        phase:"finished",downloadRetries:0,writeRetries:0,nextAttemptAt:null,navigatedTabId:null}}));
    await expect(handleContentMessage({type:"LOGIN_FORM_VISIBLE"},waitingSender)).resolves.toEqual({kind:"navigating"});
  });
  it("navigates once after a completed write, then requires manual login", async () => {
    await chrome.storage.local.set({
      "quicklogin.state.v2": {
        ...initialLocalState(), deviceId: "device-a", localWriteState: "ready",enabledIntent:true,
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
