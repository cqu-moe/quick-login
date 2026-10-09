import { beforeEach,expect,it,vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { handleMessage } from "./messages";
import { readLocalState, updateLocalState } from "./storage";
import { setEnabled } from "./sync";
import * as auth from "./auth";
beforeEach(()=>installChromeFake());
it("does not enable after the user closes while login is still pending",async()=>{
  let finish!:()=>void;
  vi.spyOn(auth,"loginInteractive").mockImplementation(()=>new Promise((resolve)=>{finish=resolve;}));
  await handleMessage({type:"LOGIN"});
  await setEnabled(false);
  finish();
  await new Promise((resolve)=>setTimeout(resolve,10));
  expect((await readLocalState()).enabledIntent).toBe(false);
});
it("checks the connection intent atomically with enabling",async()=>{
  await setEnabled(false);
  await setEnabled(true,"superseded-intent");
  expect((await readLocalState()).enabledIntent).toBe(false);
});
it("stops automatic writes before opening the school manual-login page",async()=>{
  const open=vi.spyOn(chrome.tabs,"create");
  await handleMessage({type:"OPEN_SCHOOL_MANUAL"});
  expect((await readLocalState()).manualOverride).toBe(true);
  expect(open).toHaveBeenCalledWith({url:"https://sso.cqu.edu.cn/login"});
});
it.each([false, true])("offers reconnection after failed authorization, disabled meanwhile: %s", async disabled => {
  await updateLocalState(state => ({ ...state, deviceId: "device-a", authorization: "reconnect_required" }));
  let cancel!: (error: Error) => void;
  vi.spyOn(auth, "loginInteractive").mockImplementation(() => new Promise((_resolve, reject) => { cancel = reject; }));
  await handleMessage({ type: "LOGIN" });
  if (disabled) await setEnabled(false);
  cancel(new Error("User cancelled"));
  await vi.waitFor(async () => expect(await readLocalState()).toMatchObject({
    deviceId: "device-a", authorization: "reconnect_required", connectIntentId: null, nextAttemptAt: null,
  }));
});
it("recovers a connection interrupted by a background restart", async () => {
  await updateLocalState(state => ({ ...state, deviceId: "device-a", authorization: "authorizing", connectIntentId: "interrupted" }));
  await import("./index");
  await vi.waitFor(async () => expect(await readLocalState()).toMatchObject({
    deviceId: "device-a", authorization: "reconnect_required", connectIntentId: null, nextAttemptAt: null,
  }));
});
