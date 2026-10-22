import { beforeEach, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { handleExternalMessage } from "./external";
import * as auth from "./auth";
import * as sync from "./sync";
import { updateLocalState } from "./storage";

beforeEach(() => { installChromeFake(); vi.spyOn(auth,"loginInteractive").mockResolvedValue(); vi.spyOn(sync,"setEnabled").mockResolvedValue(true); });
const message=()=>({type:"RESUME_DEVICE",deviceId:"device-a",resumeTicket:"synthetic-resume-ticket",expiresAt:Date.now()+300_000});
it("rejects messages from other origins and frames",async()=>{
  await expect(handleExternalMessage(message(),{url:"https://attacker.example/settings",frameId:0})).rejects.toThrow("FORBIDDEN");
  await expect(handleExternalMessage(message(),{url:"https://auth.cqu.moe/settings",frameId:1})).rejects.toThrow("FORBIDDEN");
  expect(auth.loginInteractive).not.toHaveBeenCalled();
});
it.each(["/settings","/settings/cqu"])("accepts a bounded explicit reconnect ticket from %s",async(path)=>{
  await expect(handleExternalMessage(message(),{url:`https://auth.cqu.moe${path}`,frameId:0})).resolves.toMatchObject({accepted:true});
  await vi.waitFor(()=>expect(auth.loginInteractive).toHaveBeenCalledOnce());
  expect(auth.loginInteractive).toHaveBeenCalledWith(expect.objectContaining({deviceId:"device-a",resumeTicket:"synthetic-resume-ticket"}));
});
it("discovers only the current device without starting authorization",async()=>{
  await updateLocalState(state=>({...state,deviceId:"device-a"}));
  await expect(handleExternalMessage({type:"GET_DEVICE_INFO"},{url:"https://auth.cqu.moe/settings/cqu",frameId:0})).resolves.toEqual({deviceId:"device-a"});
  expect(auth.loginInteractive).not.toHaveBeenCalled();
  await expect(handleExternalMessage({type:"GET_DEVICE_INFO",extra:true},{url:"https://auth.cqu.moe/settings/cqu",frameId:0})).rejects.toThrow("INVALID_REQUEST");
});
it.each(["/settings/cqu/other","/settings/other","/oauth/authorize"])("rejects discovery from %s",async path=>{
  await expect(handleExternalMessage({type:"GET_DEVICE_INFO"},{url:`https://auth.cqu.moe${path}`,frameId:0})).rejects.toThrow("FORBIDDEN");
});
