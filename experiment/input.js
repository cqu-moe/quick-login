const token = location.hash.slice(1);
history.replaceState(null, "", "/");
const el = id => document.getElementById(id);
async function api(path, body) {
  const response = await fetch(path, {method: body ? "POST" : "GET", headers: {
    "X-Probe-Token":token, ...(body ? {"Content-Type":"application/json"} : {})},
    ...(body ? {body:JSON.stringify(body)} : {})});
  if (!response.ok) throw new Error(response.status === 403 ? "本地会话链接失效，请重新打开。" : await response.text());
  return response.json();
}
async function command(data) {
  try { await api("/api/command", data); el("message").textContent="已提交，请等待状态更新。"; }
  catch(error) {el("message").textContent=error.message;}
}
el("login").onclick=()=>{
  const password=el("password").value;
  el("password").value="";
  return command({op:"login",studentId:el("student").value.trim(),password,method:el("method").value});
};
el("submit-code").onclick=()=>{
  const code=el("code").value.trim(); el("code").value="";
  return command({op:"code",code});
};
el("probe").onclick=()=>command({op:"probe"});
for(const label of ["A","B"]) el(`export-${label.toLowerCase()}`).onclick=async()=>{
  try {
    const data=await api(`/api/export/${label}`);
    const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download=`cqu-sso-test-${label}.json`;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  } catch(error) {el("message").textContent=error.message;}
};
const names={connected:"测试进程已连接",logging_in:"正在登录学校",waiting_code:"等待你输入验证码",ready:"SSO 会话已建立（尚未验证本地迁移）",failed:"登录失败",probe_result:"服务器会话探测",probe_done:"探测完成",disconnected:"测试连接已断开",rejected:"操作未执行",protocol_error:"测试通信异常"};
async function poll(){
  try {
    const s=await api("/api/status");
    el("status").textContent=s.events.map(e=>`${e.time} ${names[e.kind]||e.kind}${e.label?` [${e.label}]`:""}${e.status?`：${e.status}`:""}${e.error?` (${e.error})`:""}${e.ssoCookieCount!==undefined?`；SSO Cookie ${e.ssoCookieCount} 个，排除其他 Cookie ${e.excludedCookieCount} 个、localStorage origin ${e.localStorageOriginCount} 个`:""}`).join("\n");
    el("login").disabled=!s.connected||s.busy||s.ready.length>=2;
    el("submit-code").disabled=!s.waitingCode;
    el("probe").disabled=s.busy||!s.ready.length||!s.connected;
    for(const label of ["A","B"])el(`export-${label.toLowerCase()}`).disabled=!s.ready.includes(label);
  } catch(error) {el("message").textContent=error.message;}
  setTimeout(poll,2000);
}
poll();
