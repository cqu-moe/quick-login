import { beforeEach, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { handleExternalMessage } from "./external";
import * as auth from "./auth";
import * as sync from "./sync";

beforeEach(() => { installChromeFake(); vi.spyOn(auth,"loginInteractive").mockResolvedValue(); vi.spyOn(sync,"setEnabled").mockResolvedValue(); });
const message=()=>({type:"RESUME_DEVICE",deviceId:"device-a",resumeTicket:"synthetic-resume-ticket",expiresAt:Date.now()+300_000});
it("rejects messages from other origins and frames",async()=>{
  await expect(handleExternalMessage(message(),{url:"https://attacker.example/settings",frameId:0})).rejects.toThrow("FORBIDDEN");
  await expect(handleExternalMessage(message(),{url:"https://auth.cqu.moe/settings",frameId:1})).rejects.toThrow("FORBIDDEN");
  expect(auth.loginInteractive).not.toHaveBeenCalled();
});
it("only accepts a bounded explicit reconnect ticket from Auth settings",async()=>{
  await expect(handleExternalMessage(message(),{url:"https://auth.cqu.moe/settings",frameId:0})).resolves.toMatchObject({accepted:true});
  await vi.waitFor(()=>expect(auth.loginInteractive).toHaveBeenCalledOnce());
  expect(auth.loginInteractive).toHaveBeenCalledWith(expect.objectContaining({deviceId:"device-a",resumeTicket:"synthetic-resume-ticket"}));
});
