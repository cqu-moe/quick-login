// Paste into QuickLogin's service-worker console, then sync once in the popup.
// Observe the existing export only; never print Cookie values, claims, or credentials.
(() => {
  const originalFetch = globalThis.fetch;
  const stop = () => {
    clearTimeout(timer);
    if (globalThis.fetch === observedFetch) globalThis.fetch = originalFetch;
  };
  const observedFetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    let url;
    try { url = new URL(typeof args[0] === "string" || args[0] instanceof URL ? args[0] : args[0].url); }
    catch { return response; }
    if (url.origin !== "https://auth.cqu.moe" || !/^\/api\/v1\/cqu\/quicklogin\/devices\/[^/]+\/exports$/.test(url.pathname)) return response;
    stop();
    void response.clone().json().then(async body => {
      const cookie = body?.data?.cookies?.find(c => c.name === "SOURCEID_TGC");
      let exp = null;
      try {
        const payload = cookie.value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        const value = JSON.parse(atob(payload + "=".repeat((4 - payload.length % 4) % 4))).exp;
        if (typeof value === "number" && Number.isFinite(value)) exp = value;
      } catch { /* An encrypted or opaque ticket has no readable expiry. */ }
      const state = (await chrome.storage.local.get("quicklogin.state.v2"))["quicklogin.state.v2"];
      const now = Date.now();
      console.log(JSON.stringify({ kind: "ticket-expiry", exportStatus: response.status,
        now, tgcPresent: !!cookie, expSeconds: exp,
        expiredByLocalClock: exp === null ? null : exp * 1000 <= now,
        remainingMinutes: exp === null ? null : Math.round((exp * 1000 - now) / 60000),
        cloudLoginAt: state?.snapshot?.cloud?.loginAt ?? null,
        cloudUsableUntil: state?.snapshot?.cloud?.usableUntil ?? null,
      }, null, 2));
    }).catch(() => console.log("Ticket expiry unavailable: export response unreadable."));
    return response;
  };
  const timer = setTimeout(() => {
    stop();
    console.log("Ticket expiry observer stopped: no export observed in two minutes.");
  }, 120_000);
  globalThis.fetch = observedFetch;
  console.log("Ticket expiry observer ready. Sync once; a short JSON report will print automatically.");
})();
