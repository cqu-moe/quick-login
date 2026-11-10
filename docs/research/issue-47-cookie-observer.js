// Paste into QuickLogin's service-worker console; no Cookie values or tokens are printed.
(async () => {
  if (globalThis.quicklogin47) throw new Error("Observer already running; call await quicklogin47.stop() first.");
  const started = Date.now(), records = [], expected = new Map(), previousPlain = new Map();
  const originalFetch = globalThis.fetch;
  let baselineTgc = (await chrome.cookies.get({url:"https://sso.cqu.edu.cn/",name:"SOURCEID_TGC"}))?.value ?? null;
  let stopped = false;
  const pending = new Set();
  const key = c => `${c.storeId ?? ""}|${c.domain}|${c.path}|${c.name}`;
  const relevant = c => c.domain === ".cqu.edu.cn" || c.domain === "sso.cqu.edu.cn" || c.domain === ".sso.cqu.edu.cn";
  const metadata = c => ({ name: c.name, domain: c.domain, path: c.path,
    secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
    hostOnly: c.hostOnly, session: c.session, expires: c.expirationDate ?? c.expires ?? null });
  const record = (kind, detail) => {
    if (!stopped && records.length < 300) records.push({ ms: Date.now() - started, kind, ...detail });
  };
  // HTTPS-only permissions hide non-Secure cookies from getAll/onChanged, but get(url, name) can read them.
  const readCookies = async () => {
    const cookies = (await chrome.cookies.getAll({ domain: "cqu.edu.cn" })).filter(relevant);
    const targets = [...expected.values(), ...["SOURCEID_TGC", "rg_objectid", "sidTheme"].map(name => ({ name, path: "/" }))];
    const singles = await Promise.all(targets.map(c => chrome.cookies.get({ url: `https://sso.cqu.edu.cn${c.path}`, name: c.name })));
    return [...new Map([...cookies, ...singles.filter(Boolean)].filter(relevant).map(c => [key(c), c])).values()];
  };
  const snapshot = async label => {
    const cookies = await readCookies();
    const tgc = cookies.find(c => c.name === "SOURCEID_TGC");
    record("snapshot", { label, tgcPresent: !!tgc, tgcMatchesBaseline: tgc && baselineTgc !== null ? tgc.value === baselineTgc : null,
      cookies: cookies.map(metadata), comparison: [...expected.values()].map(e => {
      const c = cookies.find(c => c.name === e.name && c.domain === e.domain && c.path === e.path);
      return { ...metadata(e), present: !!c, valueMatches: c ? c.value === e.value : null,
        attributesMatch: c ? c.secure === e.secure && c.httpOnly === e.httpOnly &&
          c.sameSite === ({ Strict: "strict", Lax: "lax", None: "no_restriction" })[e.sameSite] &&
          c.session === (e.expires === -1) && (e.expires === -1 || Math.abs(c.expirationDate - e.expires) < 1) : null };
    }) });
    return "Snapshot recorded (no Cookie values).";
  };
  const changed = event => {
    const e = [...expected.values()].find(c => c.name === event.cookie.name && c.domain === event.cookie.domain && c.path === event.cookie.path);
    if (relevant(event.cookie)) record("cookie-change", {
      removed: event.removed, cause: event.cause, cookie: metadata(event.cookie),
      valueMatchesExport: e ? event.cookie.value === e.value : null,
    });
  };
  let sampling = false;
  const samplePlain = async () => {
    if (sampling || stopped) return;
    sampling = true;
    try {
      const plain = new Map((await readCookies()).filter(c => !c.secure).map(c => [key(c), c]));
      for (const id of new Set([...plain.keys(), ...previousPlain.keys()])) {
        const before = previousPlain.get(id), after = plain.get(id);
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        const c = after ?? before;
        const e = [...expected.values()].find(e => e.name === c.name && e.domain === c.domain && e.path === c.path);
        record("sampled-nonsecure-change", { removed: !after, cookie: metadata(c),
          valueChanged: before && after ? before.value !== after.value : null,
          valueMatchesExport: after && e ? after.value === e.value : null,
          ...(c.name === "SOURCEID_TGC" ? {valueMatchesBaseline:after && baselineTgc !== null ? after.value === baselineTgc : null} : {}) });
      }
      previousPlain.clear();
      for (const [id,c] of plain) previousPlain.set(id,c);
    } finally { sampling = false; }
  };
  const observedFetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    let url;
    try { url = new URL(typeof args[0] === "string" || args[0] instanceof URL ? args[0] : args[0].url); } catch { return response; }
    if (url.origin === "https://auth.cqu.moe" && /^\/api\/v1\/cqu\/quicklogin\/devices\/[^/]+\/exports$/.test(url.pathname)) {
      const job = response.clone().json().then(async body => {
        if (stopped) return;
        const cookies = body?.data?.cookies;
        record("export", { status: response.status, count: Array.isArray(cookies) ? cookies.length : null,
          sessionVersion: body?.data?.sessionVersion ?? null,
          tgcMatchesBaseline: Array.isArray(cookies) && baselineTgc !== null
            ? cookies.find(c => c.name === "SOURCEID_TGC")?.value === baselineTgc : null,
          cookies: Array.isArray(cookies) ? cookies.map(metadata) : [] });
        if (Array.isArray(cookies)) {
          expected.clear();
          for (const c of cookies) expected.set(key(c), c);
          await new Promise(resolve => setTimeout(resolve, 250));
          if (!stopped) await snapshot("250ms-after-export");
        }
      }).catch(() => record("export", { status: response.status, unreadable: true }));
      pending.add(job);
      void job.finally(() => pending.delete(job));
    }
    return response;
  };
  const stateChanged = (changes, area) => {
    const state = changes["quicklogin.state.v2"]?.newValue;
    if (area !== "local" || !state) return;
    record("extension-state", { schoolAccess:state.schoolAccess, localWriteState:state.localWriteState,
      sessionVersion:state.snapshot?.versions?.sessionVersion ?? null, cloudState:state.snapshot?.cloud?.state ?? null,
      recoveryFailed:state.loginRecovery?.failed ?? null, recoveryStage:state.loginRecovery?.stage ?? null,
      localError:state.localError ?? null });
  };
  const stop = async () => {
    clearTimeout(timer);
    clearInterval(poll);
    chrome.cookies.onChanged.removeListener(changed);
    chrome.storage.onChanged.removeListener(stateChanged);
    if (globalThis.fetch === observedFetch) globalThis.fetch = originalFetch;
    await Promise.allSettled([...pending]);
    await snapshot("final");
    stopped = true;
    expected.clear();
    previousPlain.clear();
    baselineTgc = null;
    delete globalThis.quicklogin47;
    return JSON.stringify({ observerVersion: 3, extensionVersion: chrome.runtime.getManifest().version,
      scope: "SSO cookie metadata and comparisons; non-Secure cookies sampled via get every 500ms; values omitted; writer unknown", records }, null, 2);
  };
  chrome.cookies.onChanged.addListener(changed);
  chrome.storage.onChanged.addListener(stateChanged);
  globalThis.fetch = observedFetch;
  const timer = setTimeout(() => { void stop().then(report => console.log(report)); }, 5 * 60_000);
  const poll = setInterval(() => { void samplePlain().catch(() => record("sampling-error", {})); }, 500);
  globalThis.quicklogin47 = { snapshot, stop };
  await snapshot("before");
  return "Observer started for five minutes. Reproduce, then run await quicklogin47.stop(); copy only that report.";
})();
