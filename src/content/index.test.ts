import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {installChromeFake} from "../test/chrome-fake";
beforeEach(()=>{
 vi.resetModules();vi.useFakeTimers();installChromeFake();
 vi.stubGlobal("location",new URL("https://sso.cqu.edu.cn/login"));
 vi.spyOn(document,"hidden","get").mockReturnValue(false);
 document.body.innerHTML='<form><input type="text"><input type="password"><button type="submit">登录</button></form>';
});
afterEach(()=>{window.dispatchEvent(new Event("pagehide"));vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
it("stops automatic checks after manual_required until explicit retry",async()=>{
 const send=vi.fn(async()=>({kind:"manual_required",message:"手动登录"}));
 Object.assign(chrome.runtime,{sendMessage:send});
 await import("./index");
 await vi.advanceTimersByTimeAsync(6000);
 expect(send).toHaveBeenCalledTimes(1);
 for(let i=0;i<2;i++){
  [...document.querySelectorAll('button')].find(button=>button.textContent==='重试快捷登录')!.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(send).toHaveBeenLastCalledWith({type:"RETRY_AUTOMATIC"});
 }
});
