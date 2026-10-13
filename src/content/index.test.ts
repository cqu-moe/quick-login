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
  const retry=[...document.querySelectorAll('button')].find(button=>button.textContent==='重试快捷登录')!;
  retry.focus();retry.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(send).toHaveBeenLastCalledWith({type:"RETRY_AUTOMATIC"});
  expect(document.activeElement).toBe(retry);
 }
});
it("bounds checks when the host page keeps mutating", async () => {
 const send=vi.fn(async()=>({kind:"idle"}));
 Object.assign(chrome.runtime,{sendMessage:send});
 await import("./index");
 await vi.advanceTimersByTimeAsync(0);
 for(let i=0;i<10;i++) {
  const node=document.createElement("span");document.body.append(node);
  await vi.advanceTimersByTimeAsync(200);
  node.remove();
 }
 expect(send).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(5000);
 expect(send.mock.calls.length).toBeLessThanOrEqual(2);
});
it("unlocks a stalled request with a manual fallback and ignores late replies",async()=>{
 let finish!: (value: unknown)=>void;
 Object.assign(chrome.runtime,{sendMessage:vi.fn(()=>new Promise(resolve=>{finish=resolve;}))});
 await import("./index");
 await vi.advanceTimersByTimeAsync(15_000);
 expect(document.body.textContent).toContain("暂时无法连接插件");
 expect([...document.querySelectorAll("button")].some(button=>button.textContent==="重试快捷登录")).toBe(true);
 finish({kind:"navigating"});
 await vi.advanceTimersByTimeAsync(0);
 expect(document.body.textContent).not.toContain("正在恢复快捷登录");
});
it("does not show stale automatic progress after the user starts typing",async()=>{
 let finish!: (value: unknown)=>void;
 Object.assign(chrome.runtime,{sendMessage:vi.fn(async(message:{type:string})=>message.type==="LOGIN_FORM_VISIBLE"
  ? new Promise(resolve=>{finish=resolve;}) : {kind:"manual_required",message:"已切换手动登录。"})});
 await import("./index");
 await vi.advanceTimersByTimeAsync(0);
 document.querySelector("input")!.dispatchEvent(new Event("input",{bubbles:true}));
 finish({kind:"navigating"});
 await vi.advanceTimersByTimeAsync(0);
 expect(document.body.textContent).not.toContain("正在恢复快捷登录");
});
it("resumes detection after a back/forward cache restore",async()=>{
 const send=vi.fn(async()=>({kind:"idle"}));Object.assign(chrome.runtime,{sendMessage:send});
 await import("./index");await vi.advanceTimersByTimeAsync(0);
 window.dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}));
 send.mockClear();await vi.advanceTimersByTimeAsync(6000);expect(send).not.toHaveBeenCalled();
 window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}));
 await vi.advanceTimersByTimeAsync(0);expect(send).toHaveBeenCalledTimes(1);
});
it("moves focus to the remaining manual action when retry starts navigation",async()=>{
 Object.assign(chrome.runtime,{sendMessage:vi.fn(async(message:{type:string})=>message.type==="RETRY_AUTOMATIC"
  ? {kind:"navigating"} : {kind:"manual_required",message:"请重试。"})});
 await import("./index");await vi.advanceTimersByTimeAsync(0);
 const retry=document.querySelector<HTMLButtonElement>('[data-action="RETRY_AUTOMATIC"]')!;
 retry.focus();retry.click();await vi.advanceTimersByTimeAsync(0);
 expect(retry.hidden).toBe(true);
 expect(document.activeElement).toBe(document.querySelector('[data-action="ENTER_MANUAL"]'));
});
