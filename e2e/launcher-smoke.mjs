import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { chromium } from "playwright-core";
import { extensionBrowser } from "./browser.ts";

const execute = promisify(execFile);
const started = performance.now();
const output = resolve(".e2e/launcher-smoke-" + Date.now());
await mkdir(output, { mode: 0o700 });
process.env.QUICKLOGIN_E2E_ARTIFACTS = output;
delete process.env.QUICKLOGIN_E2E_TLS_SPKI;
delete process.env.QUICKLOGIN_E2E_PROXY;
const requiredFlags = ["--headless=new", "--password-store=basic", "--use-mock-keychain"];
const controller = new AbortController();
const batchPids = new Set();
const evidence = {
  kind: "single-launch-headless-extension-smoke",
  status: "running",
  launchAttempts: 0,
  timeoutMs: 30000,
  requiredFlags,
  authSuiteRun: false,
  screenshotsTaken: false,
  externalRequestsBlocked: 0,
  primaryFailures: [],
  cleanupFailures: [],
};
let lease;
let browser;
let proxy;
const timeout = setTimeout(() => controller.abort(new Error("Smoke verification exceeded 17 seconds")), 17000);
const watchdog = setTimeout(() => {
  controller.abort();
  for (const pid of batchPids) {
    try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") evidence.cleanupFailures.push(error.message); }
  }
  evidence.status = "failed";
  evidence.primaryFailures.push("Hard smoke deadline reached; no retry or fallback");
  evidence.elapsedMs = Math.round(performance.now() - started);
  writeFileSync(join(output, "report.json"), JSON.stringify(evidence, null, 2) + "\n");
  process.exit(1);
}, 29000);

function message(error) {
  if (error instanceof AggregateError) return error.message + ": " + error.errors.map(message).join("; ");
  return error instanceof Error ? error.message : String(error);
}

async function snapshotBatch(rootPid) {
  const { stdout } = await execute("/bin/ps", ["-axo", "pid=,ppid="], { timeout: 1000 });
  const parents = stdout.trim().split("\n").map(line => line.trim().split(/\s+/).map(Number));
  const found = new Set([rootPid]);
  let previous;
  do {
    previous = found.size;
    for (const [pid, parent] of parents) if (found.has(parent)) found.add(pid);
  } while (found.size !== previous);
  for (const pid of found) batchPids.add(pid);
}

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

async function bounded(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Smoke operation timed out")), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

try {
  proxy = createServer((_request, response) => {
    evidence.externalRequestsBlocked++;
    response.writeHead(403).end();
  });
  proxy.on("connect", (_request, socket) => {
    evidence.externalRequestsBlocked++;
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  await new Promise((done, fail) => {
    proxy.once("error", fail);
    proxy.listen(0, "127.0.0.1", done);
  });
  process.env.QUICKLOGIN_E2E_PROXY = "http://127.0.0.1:" + proxy.address().port;
  evidence.launchAttempts++;
  lease = await extensionBrowser.acquire({
    runId: "single-launch-keychain-smoke",
    targetName: "headless-extension",
    slot: 0,
    slots: 1,
    attemptId: "only-attempt",
    env: {},
    signal: controller.signal,
    log: line => console.log("[launcher-smoke] " + line),
  });
  const pid = lease.child?.pid;
  assert.equal(typeof pid, "number", "Launcher returned no owned Chromium PID");
  batchPids.add(pid);
  controller.signal.throwIfAborted();
  const { stdout } = await execute("/bin/ps", ["-ww", "-p", String(pid), "-o", "command="], { timeout: 1000 });
  const command = stdout.trim();
  for (const flag of requiredFlags) assert(command.split(/\s+/).includes(flag), "Actual process is missing " + flag);
  assert(lease.profile.startsWith(join(output, "profiles", "chromium-")), "Profile is not isolated under this smoke output");
  assert(command.includes("--user-data-dir=" + lease.profile), "Actual process is not using this smoke profile");
  assert(command.includes("--load-extension=" + join(process.cwd(), "dist")), "Actual build is not loaded");
  evidence.actualProcessCommand = command;
  evidence.mainPid = pid;
  evidence.profile = relative(process.cwd(), lease.profile);
  evidence.processFlagsVerified = true;
  await snapshotBatch(pid);

  browser = await chromium.connectOverCDP(lease.cdpEndpoint, { timeout: 4000 });
  controller.signal.throwIfAborted();
  const context = browser.contexts()[0];
  assert(context, "Persistent Chromium context is missing");
  const workerUrl = "chrome-extension://igfidegfgfoofnoncpmbcokbffjmmook/background.js";
  const worker = context.serviceWorkers().find(item => item.url() === workerUrl) ??
    await context.waitForEvent("serviceworker", { predicate: item => item.url() === workerUrl, timeout: 3000 });
  controller.signal.throwIfAborted();
  assert.equal(await bounded(worker.evaluate(() => chrome.runtime.id), 2000), "igfidegfgfoofnoncpmbcokbffjmmook");
  const page = await context.newPage();
  await page.goto("chrome-extension://igfidegfgfoofnoncpmbcokbffjmmook/popup.html", { waitUntil: "domcontentloaded", timeout: 3000 });
  const extensionId = await bounded(page.evaluate(() => chrome.runtime.id), 2000);
  assert.equal(extensionId, "igfidegfgfoofnoncpmbcokbffjmmook");
  controller.signal.throwIfAborted();
  evidence.extensionId = extensionId;
  evidence.serviceWorkerUrl = worker.url();
  evidence.serviceWorkerRuntimeIdVerified = true;
  evidence.browserVersion = browser.version();
  evidence.build = JSON.parse(await readFile("dist/build-info.json", "utf8"));
  await snapshotBatch(pid);
} catch (error) {
  evidence.primaryFailures.push(message(error));
} finally {
  clearTimeout(timeout);
  controller.abort();
  if (lease) {
    try { await extensionBrowser.release(lease, {
      runId: "single-launch-keychain-smoke",
      targetName: "headless-extension",
      env: {},
      signal: AbortSignal.timeout(8000),
      log: () => {},
    }); }
    catch (error) { evidence.cleanupFailures.push(message(error)); }
  }
  if (browser) {
    try { await bounded(browser.close(), 1000); }
    catch (error) { evidence.cleanupFailures.push(message(error)); }
  }
  if (proxy?.listening) {
    try { await bounded(new Promise((done, fail) => {
      proxy.close(error => error ? fail(error) : done());
      proxy.closeAllConnections();
    }), 1000); }
    catch (error) { evidence.cleanupFailures.push(message(error)); }
  }
  const deadline = performance.now() + 2000;
  let remaining;
  do {
    remaining = [...batchPids].filter(alive);
    if (!remaining.length) break;
    await new Promise(done => setTimeout(done, 50));
  } while (performance.now() < deadline);
  evidence.batchPidsBeforeClose = [...batchPids].sort((a, b) => a - b);
  evidence.batchPidsAfterClose = remaining;
  if (remaining.length) {
    evidence.cleanupFailures.push("Owned batch PIDs remained after close: " + remaining.join(","));
    for (const pid of remaining) {
      try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") evidence.cleanupFailures.push(message(error)); }
    }
  }
  if (lease) {
    try { await stat(lease.profile); evidence.cleanupFailures.push("Smoke profile remained after close"); }
    catch (error) { if (error.code !== "ENOENT") evidence.cleanupFailures.push(message(error)); else evidence.profileRemoved = true; }
  }
  evidence.elapsedMs = Math.round(performance.now() - started);
  evidence.status = evidence.primaryFailures.length || evidence.cleanupFailures.length || evidence.launchAttempts !== 1 ||
    !evidence.serviceWorkerRuntimeIdVerified || !evidence.processFlagsVerified || !evidence.profileRemoved ? "failed" : "passed";
  await writeFile(join(output, "report.json"), JSON.stringify(evidence, null, 2) + "\n");
  clearTimeout(watchdog);
  console.log(JSON.stringify({ status: evidence.status, launches: evidence.launchAttempts, elapsedMs: evidence.elapsedMs,
    ownedPids: evidence.batchPidsBeforeClose, remainingPids: evidence.batchPidsAfterClose, report: relative(process.cwd(), join(output, "report.json")),
    primaryFailures: evidence.primaryFailures, cleanupFailures: evidence.cleanupFailures }));
  if (evidence.status !== "passed") process.exitCode = 1;
}
