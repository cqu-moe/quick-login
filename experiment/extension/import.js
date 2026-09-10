import {prepareCookies, compareCookies} from "./cookies.mjs";
const file = document.querySelector("#file");
const button = document.querySelector("#import");
const status = document.querySelector("#status");
const inspect = document.querySelector("#inspect");
const diagnostics = document.querySelector("#diagnostics");
let payload;
async function getSsoCookies() {
  const current = await chrome.cookies.getAll({domain:"sso.cqu.edu.cn"});
  const root = await chrome.cookies.getAll({url:"https://sso.cqu.edu.cn/"});
  for (const c of root) {
    if (!current.some(x => x.name === c.name && x.domain === c.domain && x.path === c.path && x.storeId === c.storeId)) current.push(c);
  }
  return current;
}
async function inspectCookies() {
  inspect.disabled = true;
  try {
    const cookies = await getSsoCookies();
    const window = await chrome.windows.getCurrent();
    const tgc = cookies.filter(c => c.name === "SOURCEID_TGC");
    const lines = [
      `扩展所在窗口：${window.incognito ? "无痕" : "普通"}；请确认学校页面在同一个浏览器资料和同类窗口中。`,
      `可见 SSO Cookie：${cookies.length} 个；Cookie 存储区：${[...new Set(cookies.map(c=>c.storeId))].join("、") || "无 Cookie"}`,
      `SOURCEID_TGC：${tgc.length ? `${tgc.length} 个` : "缺失；当前存储区没有这项 SSO 凭据"}`,
    ];
    if (payload) {
      lines.push(...compareCookies(payload.cookies, cookies).map(c=>`${c.name}：${c.state}`));
    } else lines.push("重新选择原 JSON 文件后，可检查是否与导入前的值一致。");
    lines.push("存在或值一致不代表学校认可会话；此检查没有修改 Cookie。");
    diagnostics.textContent = lines.join("\n");
  } catch {
    diagnostics.textContent = "无法读取 Cookie 检查结果，请确认此扩展拥有 SSO 站点权限。没有修改 Cookie。";
  } finally {
    inspect.disabled = false;
  }
}
inspect.addEventListener("click", inspectCookies);
file.addEventListener("change", async () => {
  button.disabled = true;
  payload = undefined;
  try {
    if (!file.files[0] || file.files[0].size > 200_000) throw new Error("请选择小于 200 KB 的实验文件。");
    payload = JSON.parse(await file.files[0].text());
    const cookies = prepareCookies(payload);
    const ageMinutes = Math.max(0, Math.floor((Date.now() / 1000 - payload.createdAt) / 60));
    status.textContent = `可导入 ${cookies.length} 个 SSO Cookie。文件导出于约 ${ageMinutes} 分钟前；学校会话是否仍有效，需要实际登录验证。`;
    button.disabled = false;
    await inspectCookies();
  } catch (error) {
    payload = undefined;
    status.textContent = error instanceof SyntaxError ? "文件不是合法 JSON。" : error.message;
  }
});
button.addEventListener("click", async () => {
  button.disabled = true;
  let imported = 0;
  let phase = "文件校验";
  try {
    const cookies = prepareCookies(payload);
    phase = "读取现有 Cookie";
    const existing = await getSsoCookies();
    if (existing.some(c => c.name === "SOURCEID_TGC" && c.value)) throw new Error("当前浏览器已有 SSO 登录凭据 SOURCEID_TGC，已停止导入，避免覆盖现有会话。");
    for (const cookie of cookies) {
      phase = `写入 ${cookie.name}`;
      const saved = await chrome.cookies.set(cookie);
      phase = `回读 ${cookie.name}`;
      if (!saved || saved.value !== cookie.value || saved.httpOnly !== cookie.httpOnly ||
          saved.secure !== cookie.secure || saved.path !== cookie.path || saved.sameSite !== cookie.sameSite) {
        throw new Error("Cookie 写入或属性回读不一致。");
      }
      imported++;
    }
    status.textContent = `已写入并回读 ${imported} 个 Cookie。现在打开学校门户检查实际登录；此处不代表登录成功。`;
  } catch (error) {
    const reason = phase === "文件校验" || error.message.startsWith("当前浏览器") ? error.message : "导入未完成。";
    status.textContent = `${reason} 阶段：${phase}；已确认写入并回读 ${imported} 个。`;
  } finally {
    await inspectCookies();
    payload = undefined;
    file.value = "";
  }
});
