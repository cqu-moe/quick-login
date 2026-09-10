const HOST = "sso.cqu.edu.cn";

export function compareCookies(expected, actual) {
  return expected.map(cookie => {
    const named = actual.filter(c => c.name === cookie.name);
    const matches = named.filter(c => c.domain === cookie.domain && c.path === cookie.path);
    let state = "缺失";
    if (matches.length > 1) state = "同名同路径存在多个条目";
    else if (matches.length === 1) {
      const found = matches[0];
      state = found.value === cookie.value ? "值一致" : "值不同";
      const changed = ["secure", "httpOnly"].filter(key => found[key] !== cookie[key]);
      const site = {Strict:"strict",Lax:"lax",None:"no_restriction"}[cookie.sameSite];
      if (found.sameSite !== site) changed.push("sameSite");
      if (found.hostOnly !== !cookie.domain.startsWith(".")) changed.push("hostOnly");
      if (changed.length) state += `；属性不同：${changed.join("、")}`;
    } else if (named.length) state = "仅找到其他域或路径的同名 Cookie";
    return {name: cookie.name, state};
  });
}

export function prepareCookies(payload, now = Date.now() / 1000) {
  if (payload?.format !== "cqu-sso-cookie-probe-v1" || !Array.isArray(payload.cookies)) {
    throw new Error("不是本次实验的 Cookie 文件。");
  }
  if (!Number.isFinite(payload.createdAt) || payload.createdAt <= 0 || payload.createdAt > now + 60) {
    throw new Error("文件导出时间无效，请检查文件或本机时间。");
  }
  if (!payload.cookies.length || payload.cookies.length > 100) throw new Error("Cookie 数量异常。");
  const seen = new Set();
  const details = payload.cookies.map(c => {
    if (!c || typeof c.domain !== "string" || ![HOST, `.${HOST}`].includes(c.domain)) {
      throw new Error("文件含非 SSO 专属域 Cookie，需另行检查，不自动导入。");
    }
    if (typeof c.name !== "string" || !c.name || typeof c.value !== "string" ||
        typeof c.path !== "string" || !c.path.startsWith("/") || /[?#\\\r\n]/.test(c.path) ||
        typeof c.secure !== "boolean" || typeof c.httpOnly !== "boolean" || c.partitionKey != null) {
      throw new Error("Cookie 属性不支持，已停止导入。");
    }
    const key = `${c.domain}\n${c.path}\n${c.name}`;
    if (seen.has(key)) throw new Error("Cookie 存在重复条目。");
    seen.add(key);
    const sameSite = {Strict:"strict",Lax:"lax",None:"no_restriction"}[c.sameSite];
    if (!sameSite) throw new Error("Cookie SameSite 属性不支持。");
    const d = {url:`https://${HOST}${c.path}`,name:c.name,value:c.value,path:c.path,
      secure:c.secure,httpOnly:c.httpOnly,sameSite};
    if (c.domain.startsWith(".")) d.domain = c.domain;
    if (c.expires !== -1) {
      if (!Number.isFinite(c.expires) || c.expires <= now) throw new Error("文件含已过期 Cookie，请重新导出。");
      d.expirationDate = c.expires;
    }
    return d;
  });
  if (!details.some(c => c.name === "SOURCEID_TGC" && c.value)) throw new Error("缺少学校 SSO 登录凭据。");
  return details;
}
