// Runs the observed public bundle's refresh handler with synthetic tokens and no network.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";

assert.ok(process.argv[2], "Pass the downloaded app.5c6b3ede.js path");
const source = readFileSync(process.argv[2], "utf8");
const sourceSha256 = createHash("sha256").update(source).digest("hex");
assert.equal(sourceSha256, "488ff434b7f9f3645373eb05f6214155810c229ecbc984d637733c3c4b239dbb");
const start = source.indexOf("function Lr({config:");
const end = source.indexOf("function Nr(", start);
assert.ok(start >= 0 && end > start, "Observed login handler must be present");
const handler = source.slice(start, end);
const results = [];

for (const outcome of ["success", "http_401", "network_error"]) {
  let accessToken = "synthetic-access";
  let cleared = false;
  const redirects = [];
  const requests = [];
  const sandbox = vm.createContext({
    Mr: false,
    Dr: false,
    dr: { USER_INFO: "synthetic-user" },
    document: { removeEventListener() {} },
    sessionStorage: { getItem: () => null, removeItem() {} },
    window: { location: { replace: (url) => redirects.push(new URL(url).pathname) } },
  });
  const createLogin = vm.runInContext(`(${handler})`, sandbox, { timeout: 1000 });
  const login = createLogin({
    config: {
      useCas: true,
      authHost: "https://my.example.test",
      authUri: {
        refreshTokenUri: "https://my.example.test/authserver/oauth/token",
        redirect_cas_uri: "https://my.example.test/workspace/cas",
      },
    },
    auth: {
      getLocalToken: () => accessToken,
      getLocalRefreshToken: () => "synthetic-refresh",
      removeToken: () => { accessToken = ""; },
      removeAuth: () => { cleared = true; accessToken = ""; },
      setAuth: (value) => { accessToken = value.access_token; },
      getLocalUserInfo: () => ({}),
    },
    interceptor: async (request) => {
      requests.push(new URL(request.url).pathname);
      assert.equal(request.data.grant_type, "refresh_token");
      if (outcome === "network_error") throw new Error("synthetic network failure");
      if (outcome === "http_401") {
        throw Object.assign(new Error("synthetic HTTP 401"), { response: { status: 401 } });
      }
      return { status: 200, data: { access_token: "synthetic-new-access" } };
    },
  });
  await login.refreshToken();
  await new Promise(setImmediate);
  assert.deepEqual(requests, ["/authserver/oauth/token"]);
  const shouldLogout = outcome !== "success";
  assert.equal(cleared, shouldLogout);
  assert.deepEqual(redirects, shouldLogout ? ["/authserver/casLogout"] : []);
  if (!shouldLogout) assert.equal(accessToken, "synthetic-new-access");
  results.push({ outcome, clearedLocalAuth: cleared, redirects });
}

console.log(JSON.stringify({ sourceSha256, results }, null, 2));
