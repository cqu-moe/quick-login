import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {installChromeFake} from "../test/chrome-fake";
type RuntimeListener=(message:unknown,sender:chrome.runtime.MessageSender)=>void;
function installStateNotification(){
 const runtimeListeners=new Set<RuntimeListener>(),storageListeners=new Set<()=>void>();
 Object.assign(chrome.runtime,{onMessage:{
  addListener(listener:RuntimeListener){runtimeListeners.add(listener);},
  removeListener(listener:RuntimeListener){runtimeListeners.delete(listener);},
  hasListener(listener:RuntimeListener){return runtimeListeners.has(listener);},
 }});
 Object.assign(chrome,{storage:{...chrome.storage,onChanged:{
  addListener(listener:()=>void){storageListeners.add(listener);},
  removeListener(listener:()=>void){storageListeners.delete(listener);},
  hasListener(listener:()=>void){return storageListeners.has(listener);},
 }}});
 return {
  storageListeners,
  notify(extensionId=chrome.runtime.id){
   runtimeListeners.forEach(listener=>listener({type:"QUICKLOGIN_STATE_CHANGED"},{id:extensionId} as chrome.runtime.MessageSender));
  },
 };
}
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
it("shows recovery progress and refreshes notified state without restarting login",async()=>{
 const states=installStateNotification();
 const sent: string[]=[];
 Object.assign(chrome.runtime,{sendMessage:vi.fn(async(message:{type:string})=>{
  sent.push(message.type);
  if(message.type==="LOGIN_FORM_VISIBLE") return {kind:"recovering",message:"正在恢复快捷登录。"};
  return sent.filter(type=>type==="GET_UI_STATE" || type==="CHECK_STATE").length===1
   ? {kind:"recovering",message:"正在确认学校登录。"}
   : {kind:"navigating"};
 })});
 await import("./index");
 await vi.advanceTimersByTimeAsync(0);
 expect(states.storageListeners.size).toBe(0);
 expect(document.body.textContent).toContain("正在恢复快捷登录。");
 expect(document.querySelector<HTMLButtonElement>('[data-action="ENTER_MANUAL"]')!.hidden).toBe(false);
 expect(document.querySelector<HTMLButtonElement>('[data-action="RETRY_AUTOMATIC"]')!.hidden).toBe(true);

 for(let i=0;i<3;i++) states.notify("other-extension");
 await vi.advanceTimersByTimeAsync(150);
 expect(sent).toEqual(["LOGIN_FORM_VISIBLE"]);

 for(let i=0;i<3;i++) states.notify();
 await vi.advanceTimersByTimeAsync(150);
 expect(sent).toEqual(["LOGIN_FORM_VISIBLE","GET_UI_STATE"]);
 expect(document.body.textContent).toContain("正在确认学校登录。");

 await vi.advanceTimersByTimeAsync(4850);
 expect(sent).toEqual(["LOGIN_FORM_VISIBLE","GET_UI_STATE","CHECK_STATE"]);
 expect(document.body.textContent).toContain("正在恢复快捷登录，请稍候。");
});
it("lets notifications observe a popup retry after manual_required but not direct editing",async()=>{
 const states=installStateNotification();
 const sent:string[]=[];
 Object.assign(chrome.runtime,{sendMessage:vi.fn(async(message:{type:string})=>{
  sent.push(message.type);
  if(message.type==="LOGIN_FORM_VISIBLE") return {kind:"manual_required",message:"请手动登录。"};
  if(message.type==="GET_UI_STATE") return {kind:"recovering",message:"正在应用重试结果。"};
  return {kind:"manual_required",message:"已切换手动登录。"};
 })});
 await import("./index");
 await vi.advanceTimersByTimeAsync(0);
 expect(states.storageListeners.size).toBe(0);
 states.notify();
 await vi.advanceTimersByTimeAsync(150);
 expect(sent).toEqual(["LOGIN_FORM_VISIBLE","GET_UI_STATE"]);
 expect(document.body.textContent).toContain("正在应用重试结果。");

 document.querySelector("input")!.dispatchEvent(new Event("input",{bubbles:true}));
 await vi.advanceTimersByTimeAsync(0);
 for(let i=0;i<3;i++) states.notify();
 await vi.advanceTimersByTimeAsync(6000);
 expect(sent).toEqual(["LOGIN_FORM_VISIBLE","GET_UI_STATE","ENTER_MANUAL"]);
});
it.each(["recovering","manual_required"])("keeps a trailing read after a stale %s reply",async(kind)=>{
 const states=installStateNotification();
 let finishGet!: (value:unknown)=>void;
 let getRequests=0;
 Object.assign(chrome.runtime,{sendMessage:vi.fn(async(message:{type:string})=>{
  if(message.type==="LOGIN_FORM_VISIBLE") return {kind:"recovering",message:"正在恢复快捷登录。"};
  if(message.type!=="GET_UI_STATE") return {kind:"recovering",message:"正在恢复。"};
  if(++getRequests===1) return new Promise(resolve=>{finishGet=resolve;});
  return {kind:"navigating"};
 })});
 await import("./index");
 await vi.advanceTimersByTimeAsync(0);
 states.notify();
 await vi.advanceTimersByTimeAsync(150);
 expect(getRequests).toBe(1);

 states.notify();
 finishGet({kind,message:"仍在恢复学校登录。"});
 await vi.advanceTimersByTimeAsync(1000);
 expect(getRequests).toBe(2);
 expect(document.body.textContent).toContain("正在恢复快捷登录，请稍候。");
});
it("reads the latest recovery state on visibility return after missing a hidden-page notification",async()=>{
 const states=installStateNotification();
 const send=vi.fn(async(message:{type:string})=>message.type==="LOGIN_FORM_VISIBLE"
  ? {kind:"manual_required",message:"请手动登录。"}
  : {kind:"recovering",message:"正在应用重试结果。"});
 Object.assign(chrome.runtime,{sendMessage:send});
 await import("./index");
 await vi.advanceTimersByTimeAsync(0);
 const hidden=vi.spyOn(document,"hidden","get").mockReturnValue(true);
 states.notify();
 await vi.advanceTimersByTimeAsync(1000);
 expect(send).toHaveBeenCalledTimes(1);
 hidden.mockReturnValue(false);
 document.dispatchEvent(new Event("visibilitychange"));
 await vi.advanceTimersByTimeAsync(150);
 expect(send).toHaveBeenLastCalledWith({type:"GET_UI_STATE"});
 expect(document.body.textContent).toContain("正在应用重试结果。");
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
