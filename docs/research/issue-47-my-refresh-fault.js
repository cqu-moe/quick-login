// Run once in the logged-in my.cqu.edu.cn page Console. This can sign out school SSO.
// Fails one OAuth refresh locally; the site's own error handler performs any logout.
(() => {
  if (location.origin !== "https://my.cqu.edu.cn" || !location.pathname.startsWith("/workspace")) {
    throw new Error("Run on the logged-in teaching portal workspace.");
  }
  const login = document.querySelector("#app")?.__vue__?.$u?.plugins?.login;
  if (typeof login?.refreshToken !== "function") throw new Error("Current page login module was not found.");
  const prototype = XMLHttpRequest.prototype;
  const open = prototype.open, send = prototype.send;
  const targets = new WeakSet();
  let injected = false;
  const restore = () => {
    clearTimeout(timer);
    if (prototype.open === observedOpen) prototype.open = open;
    if (prototype.send === observedSend) prototype.send = send;
  };
  function observedOpen(method, url, ...rest) {
    const target = new URL(url, location.href);
    if (String(method).toUpperCase() === "POST" && target.origin === location.origin && target.pathname === "/authserver/oauth/token") {
      targets.add(this);
    } else targets.delete(this);
    return open.call(this, method, url, ...rest);
  }
  function observedSend(...args) {
    if (!injected && targets.has(this)) {
      injected = true;
      restore();
      console.info(JSON.stringify({ kind: "issue47-refresh-fault", injected: true, networkRequestSent: false }));
      queueMicrotask(() => this.dispatchEvent(new ProgressEvent("error")));
      return;
    }
    return send.apply(this, args);
  }
  const timer = setTimeout(() => {
    restore();
    console.info(JSON.stringify({ kind: "issue47-refresh-fault", injected: false, reason: "no-refresh-request" }));
  }, 10_000);
  prototype.open = observedOpen;
  prototype.send = observedSend;
  try {
    Promise.resolve(login.refreshToken()).catch(() => {
      restore();
      console.info(JSON.stringify({ kind: "issue47-refresh-fault", injected, handlerRejected: true }));
    });
  } catch {
    restore();
    throw new Error("The page could not start the refresh handler; interception has been removed.");
  }
})();
