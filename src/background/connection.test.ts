import { beforeEach,expect,it,vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { handleMessage } from "./messages";
import { readLocalState } from "./storage";
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
