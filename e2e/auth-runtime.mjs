import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { grantSchoolDevicePolicy } from "./school-policy.mjs";
import { schoolPlatform } from "./school-platform.mjs";
import { closeServer, listenLoopback } from "./lifecycle.mjs";

const execute = promisify(execFile);
const AUTH_ORIGIN = "https://auth.cqu.moe";
const EXTENSION_ID = "igfidegfgfoofnoncpmbcokbffjmmook";
const CLIENT_ID = "cqu-quicklogin-chrome";

function officialClient(now) {
  return {
    id: randomUUID(),
    clientId: CLIENT_ID,
    clientSecret: null,
    disabled: 0,
    skipConsent: 1,
    enableEndSession: 0,
    subjectType: "public",
    scopes: JSON.stringify(["openid", "offline_access", "cqu:quicklogin:device"]),
    userId: null,
    createdAt: now,
    updatedAt: now,
    name: "CQU 快捷登录",
    uri: null,
    icon: null,
    contacts: null,
    tos: null,
    policy: null,
    softwareId: null,
    softwareVersion: null,
    softwareStatement: null,
    redirectUris: JSON.stringify([`https://${EXTENSION_ID}.chromiumapp.org/`]),
    postLogoutRedirectUris: "[]",
    tokenEndpointAuthMethod: "none",
    grantTypes: JSON.stringify(["authorization_code", "refresh_token"]),
    responseTypes: JSON.stringify(["code"]),
    public: 1,
    type: null,
    requirePKCE: 1,
    referenceId: null,
    metadata: JSON.stringify({
      quickloginOfficial: true,
      extensionOrigin: `chrome-extension://${EXTENSION_ID}`,
    }),
    applicationType: "web",
  };
}

async function readJsonBody(request) {
  let text = "";
  for await (const chunk of request) text += chunk;
  return text ? JSON.parse(text) : {};
}

export async function startPinnedAuth({ authPath, outputDir, expectedCommit }) {
  const authRoot = resolve(authPath);
  const commit = (await execute("git", ["-C", authRoot, "rev-parse", "HEAD"])).stdout.trim();
  if (commit !== expectedCommit) throw new Error("Auth commit does not match the pinned dependency");
  if ((await execute("git", ["-C", authRoot, "status", "--porcelain", "--untracked-files=no"])).stdout.trim()) {
    throw new Error("Pinned Auth dependency has tracked modifications");
  }
  await readFile(join(authRoot, "frontend/dist/index.html"));

  const runtimeDir = join(outputDir, "auth-runtime");
  await mkdir(runtimeDir, { recursive: true });
  let heldPath = null, heldResponses = 0;
  let releaseGate;
  let gate = Promise.resolve();
  function releaseNetwork() { heldPath = null; releaseGate?.(); }
  let prepareAccount;
  let school;
  let activeSchoolUser;
  const schoolEnabled = process.env.QUICKLOGIN_E2E_SCHOOL === "1";
  const mails = new Map();
  const identities = new Map();
  const unexpected = [];
  const observedSecrets = new Set();
  let mf;
  let db;
  let controlOrigin = "";
  let workerPort = 0;
  let readObservations = () => [];

  const control = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        response.writeHead(200, { "content-type": "application/json" }).end("{\"ok\":true}");
      } else if (request.method === "POST" && url.pathname === "/identity") {
        const { key, school: bindSchool = false } = await readJsonBody(request);
        if (typeof key !== "string" || !/^[a-z0-9-]{1,64}$/.test(key)) throw new Error("INVALID_IDENTITY_KEY");
        let identity = identities.get(key);
        if (!identity) {
          const email = `quicklogin-${randomBytes(12).toString("hex")}@example.test`;
          const password = `Ql-${randomBytes(24).toString("base64url")}!`;
          const originalFetch = globalThis.fetch;
          globalThis.fetch = (input, init) => {
            const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
            const target = url.origin === AUTH_ORIGIN
              ? new URL(`${url.pathname}${url.search}`, `http://127.0.0.1:${workerPort}`)
              : url;
            return originalFetch(target, init);
          };
          try {
            identity = await prepareAccount({
              origin: AUTH_ORIGIN,
              controlOrigin,
              db,
            }, { email, password, name: `QuickLogin E2E ${key}` });
            if (bindSchool) {
              if (!school) throw new Error("School runtime was not configured");
              school.addUser(identity.userId);
              activeSchoolUser = identity.userId;
              await grantSchoolDevicePolicy(authRoot, { origin: AUTH_ORIGIN, controlOrigin, db }, identity.userId, school.sensitive);
              const { prepareSchoolBinding } = await import(pathToFileURL(join(authRoot, "e2e/school/prepare-binding.mjs")).href);
              await prepareSchoolBinding({ origin: AUTH_ORIGIN, controlOrigin, db, prepare: async () => identity }, { email, password });
            }
          } finally {
            globalThis.fetch = originalFetch;
          }
          identities.set(key, identity);
        }
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(identity));
      } else if (request.method === "POST" && url.pathname === "/relay") {
        const input = await readJsonBody(request);
        if (input.hold === true) {
          if (!["exports", "receipts"].includes(input.path)) throw new Error("Invalid transport gate");
          releaseNetwork(); heldPath = input.path; heldResponses = 0;
          gate = new Promise(done => { releaseGate = done; });
        } else if (input.hold === false) releaseNetwork();
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ heldResponses }));
      } else if (request.method === "POST" && url.pathname === "/school") {
        if (!school || !activeSchoolUser) throw new Error("No active school identity");
        const { changes } = await readJsonBody(request);
        const device = await db.prepare("SELECT device_id FROM quicklogin_device_projection WHERE user_id=? LIMIT 1").bind(activeSchoolUser).first();
        const value = await school.control(device ? `quicklogin:${activeSchoolUser}:${device.device_id}` : activeSchoolUser, "control", changes);
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
      } else if (request.method === "POST" && url.pathname === "/protect") {
        if (!school) throw new Error("No school runtime");
        const { values } = await readJsonBody(request);
        if (!Array.isArray(values) || values.some(value => typeof value !== "string" || !value)) throw new Error("Invalid protected values");
        for (const value of values) school.sensitive.add(value);
        response.writeHead(204).end();
      } else if (request.method === "GET" && url.pathname === "/network") {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(readObservations()));
      } else if (request.method === "GET" && url.pathname === "/mail") {
        response.writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ otp: mails.get(url.searchParams.get("email")) ?? null }));
      } else if (request.method === "GET" && url.pathname === "/state") {
        const userId = url.searchParams.get("userId") ?? "";
        if (!/^[a-zA-Z0-9_-]+$/.test(userId)) throw new Error("INVALID_USER");
        const devices = await db.prepare(
          "SELECT device_id AS deviceId, payload_json AS payload FROM quicklogin_device_projection WHERE user_id=?"
        ).bind(userId).all();
        const counts = await db.prepare(
          "SELECT count(*) AS refreshTokens FROM oauthRefreshToken WHERE userId=?"
        ).bind(userId).first();
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
          devices: devices.results.map(row => ({
            deviceId: row.deviceId,
            ...JSON.parse(row.payload),
          })),
          refreshTokens: Number(counts?.refreshTokens ?? 0),
        }));
      } else if (request.method === "POST" && url.pathname === "/oauth-client") {
        const { mode } = await readJsonBody(request);
        if (mode !== "official" && mode !== "wrong_redirect") throw new Error("INVALID_MODE");
        const redirect = mode === "official"
          ? JSON.stringify([`https://${EXTENSION_ID}.chromiumapp.org/`])
          : JSON.stringify(["https://synthetic-wrong.example.test/callback"]);
        await db.prepare("UPDATE oauthClient SET redirectUris=?, updatedAt=? WHERE clientId=?")
          .bind(redirect, new Date().toISOString(), CLIENT_ID).run();
        response.writeHead(204).end();
      } else if (request.method === "GET" && url.pathname === "/oauth-client") {
        const row = await db.prepare(
          "SELECT clientId, redirectUris, scopes, grantTypes, responseTypes, tokenEndpointAuthMethod, requirePKCE, disabled, metadata FROM oauthClient WHERE clientId=?"
        ).bind(CLIENT_ID).first();
        if (!row) throw new Error("OFFICIAL_CLIENT_MISSING");
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(row));
      } else {
        response.writeHead(404).end();
      }
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" })
        .end(JSON.stringify({ error: error instanceof Error ? error.message : "CONTROL_FAILED" }));
    }
  });

  try {
    ({ prepareAccount } = await import(pathToFileURL(join(authRoot, "e2e/prepare-account.mjs")).href));
    await execute(process.execPath, [
      join(authRoot, "node_modules/wrangler/bin/wrangler.js"),
      "deploy", "--dry-run", "--config", join(authRoot, schoolEnabled ? "e2e/school/wrangler.jsonc" : "e2e/wrangler.jsonc"),
      "--outdir", join(runtimeDir, "bundle"),
    ], {
      cwd: runtimeDir,
      env: {
        PATH: process.env.PATH,
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_LOG_PATH: join(runtimeDir, "bundle", "build.log"),
      },
    });

    const reserve = createServer();
    workerPort = await listenLoopback(reserve);
    await closeServer(reserve);

    const requireAuth = createRequire(join(authRoot, "package.json"));
    const { Miniflare, Log, LogLevel } = requireAuth("miniflare");
    if (schoolEnabled) school = await schoolPlatform(authRoot, resolve("e2e/school"));
    const authOptions = {
      name: "quicklogin-consumer-auth",
      host: "127.0.0.1",
      port: workerPort,
      modules: [{
        type: "ESModule",
        path: join(runtimeDir, schoolEnabled ? "bundle/worker.js" : "bundle/index.js"),
        contents: await readFile(join(runtimeDir, schoolEnabled ? "bundle/worker.js" : "bundle/index.js"), "utf8"),
      }],
      compatibilityDate: "2026-05-01",
      compatibilityFlags: ["nodejs_compat"],
      log: new Log(LogLevel.ERROR),
      d1Databases: { DATABASE: "quicklogin-consumer-auth" },
      d1Persist: join(runtimeDir, "d1"),
      durableObjects: {
        CQU_SESSION: "CquSessionDO",
        CQU_LOGIN: { className: "CquLoginContainer", useSQLite: true },
        CQU_QUICKLOGIN_ACCOUNT: { className: "CquQuickloginAccountDO", useSQLite: true },
        CQU_QUICKLOGIN_DEVICE: { className: "CquQuickloginDeviceDO", useSQLite: true },
      },
      bindings: {
        BETTER_AUTH_URL: AUTH_ORIGIN,
        BETTER_AUTH_SECRET: "synthetic-quicklogin-e2e-secret-never-use-outside-tests",
        ENCRYPTION_KEY: "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
        RESEND_API_KEY: "re_synthetic",
        ENVIRONMENT: "development",
        BIND_EMAIL_DOMAIN: "example.test",
        QUICKLOGIN_DEVICE_MODE: "on",
        QUICKLOGIN_CLIENT_ID: CLIENT_ID,
        QUICKLOGIN_EXTENSION_ORIGIN: `chrome-extension://${EXTENSION_ID}`,
      },
      assets: {
        workerName: "quicklogin-consumer-auth",
        directory: join(authRoot, "frontend/dist"),
        binding: "ASSETS",
        routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true },
        assetConfig: { not_found_handling: "single-page-application" },
      },
      outboundService: async request => {
        const url = new URL(request.url);
        if (url.origin === "https://api.resend.com" && url.pathname === "/emails" && request.method === "POST") {
          const mail = await request.json();
          const otp = mail.html?.match(/letter-spacing:6px">(\d{6})</)?.[1];
          if (!otp) throw new Error("Unexpected external email payload");
          for (const recipient of [].concat(mail.to)) {
            if (!recipient.endsWith("@example.test")) throw new Error("Non-synthetic email denied");
            mails.set(recipient, otp);
          }
          return Response.json({ id: randomUUID() });
        }
        unexpected.push(url.origin);
        return new Response("Unexpected external request denied", { status: 502 });
      },
    };
    mf = new Miniflare(school ? school.configure(authOptions) : authOptions);
    await mf.ready;
    db = await mf.getD1Database("DATABASE", school ? "quicklogin-consumer-auth" : undefined);
    if (school) await school.ready(mf, db);

    for (const file of (await readdir(join(authRoot, "drizzle/migrations"))).filter(file => file.endsWith(".sql")).sort()) {
      const sql = await readFile(join(authRoot, "drizzle/migrations", file), "utf8");
      const statements = sql.replace(/^\s*--.*$/gm, "").split(";").map(value => value.trim()).filter(Boolean);
      for (const statement of statements) await db.prepare(statement).run();
    }
    await db.prepare("INSERT INTO entitlement_config(key,value) VALUES ('invitation_required','1')").run();
    const client = officialClient(new Date().toISOString());
    const columns = Object.keys(client);
    await db.prepare(`INSERT INTO oauthClient(${columns.map(column => `\`${column}\``).join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
      .bind(...columns.map(column => client[column])).run();

    controlOrigin = `http://127.0.0.1:${await listenLoopback(control)}`;
    return {
      commit,
      protect(values) { for (const value of values) if (typeof value === "string" && value) observedSecrets.add(value); },
      schoolEvidence: school?.outcomes,
      async responseGate(path) { if (heldPath && path.endsWith(`/${heldPath}`)) { heldResponses++; await gate; } },
      async schoolRequest(method, path, headers, body) {
        if (!school || !activeSchoolUser) throw new Error("No school identity for browser transport");
        const device = await db.prepare("SELECT device_id FROM quicklogin_device_projection WHERE user_id=? LIMIT 1").bind(activeSchoolUser).first();
        if (!device) throw new Error("No registered device for school browser transport");
        return school.control(`quicklogin:${activeSchoolUser}:${device.device_id}`, "browser", { method, path, cookie: headers.cookie ?? "", body });
      },
      workerPort,
      controlOrigin,
      identityCount: () => identities.size,
      setNetworkReader: reader => { readObservations = reader; },
      async checkArtifacts(directory, sensitiveValues) {
        const secrets = [...observedSecrets, ...sensitiveValues, ...(school?.sensitive ?? []), ...identities.values().map(identity => identity.password), ...mails.values()];
        async function inspect(current) {
          for (const entry of await readdir(current, { withFileTypes: true })) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) await inspect(path);
            else if (/\.(json|txt|md|log)$/.test(entry.name)) {
              const text = await readFile(path, "utf8");
              if (secrets.some(value => value && text.includes(value))) throw new Error("Sensitive synthetic value found in E2E text artifacts");
            }
          }
        }
        await inspect(directory);
      },
      async close() {
        releaseNetwork();
        const before = await Promise.allSettled([school?.beforeClose()]);
        const results = await Promise.allSettled([
          closeServer(control),
          mf.dispose(),
        ]);
        results.push(...before, ...await Promise.allSettled([rm(runtimeDir, { recursive: true, force: true }), school?.close()]));
        const failures = results.filter(result => result.status === "rejected");
        if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Auth runtime cleanup failed");
        if (unexpected.length) throw new Error(`Unexpected Worker egress denied (${unexpected.length} requests)`);
      },
    };
  } catch (error) {
    const before = await Promise.allSettled([school?.beforeClose()]);
    const cleanup = [...before, ...await Promise.allSettled([closeServer(control), mf?.dispose()])];
    cleanup.push(...await Promise.allSettled([school?.close()]));
    cleanup.push(...await Promise.allSettled([rm(runtimeDir, { recursive: true, force: true })]));
    const failures = cleanup.filter(result => result.status === "rejected");
    if (failures.length) {
      const failure = new AggregateError([error, ...failures.map(result => result.reason)], "Auth startup and cleanup both failed");
      failure.cleanupErrors = failures.map(result => result.reason);
      throw failure;
    }
    throw error;
  }
}
