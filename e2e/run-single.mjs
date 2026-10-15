import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { startPinnedAuth } from "./auth-runtime.mjs";
import { createAuthTls, createEgressProxy } from "./network.mjs";
import { failureMessage } from "./lifecycle.mjs";

const root = process.cwd();
const output = resolve(process.env.QUICKLOGIN_E2E_OUTPUT || join(root, `.e2e/run-${Date.now()}`));
if (!output.startsWith(resolve(root, ".e2e") + "/")) throw new Error("E2E output must be a child of .e2e");
const authPath = process.env.QUICKLOGIN_E2E_AUTH_PATH || join(root, "..", "QUICKLOGIN-03-deps/auth");
const expectedCommit = process.env.QUICKLOGIN_E2E_AUTH_COMMIT || "870933794326b9d280dcf07f392c80c127fd7233";
await mkdir(dirname(output), { recursive: true });
await mkdir(output, { mode: 0o700 });

let runtime;
let tls;
let egress;
let child;
let interrupted = false;
let cleanupError = null;
const primaryErrors = [];
const chromiumServiceOrigins = new Set([
  "http://clients2.google.com",
  "https://clients2.google.com",
  "https://accounts.google.com",
  "https://www.google.com",
  "https://update.googleapis.com",
  "http://update.googleapis.com",
]);
const expectedDeniedCallback = "https://igfidegfgfoofnoncpmbcokbffjmmook.chromiumapp.org";
const evidence = { authCommit: expectedCommit, output, extensionPath: "dist", cleanup: "pending" };

function stopChild() {
  interrupted = true;
  process.exitCode = 1;
  if (child?.exitCode === null) child.kill("SIGTERM");
}
process.once("SIGINT", stopChild);
process.once("SIGTERM", stopChild);

try {
  const execute = promisify(execFile);
  evidence.extensionCommit = (await execute("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  evidence.sourceDirty = Boolean((await execute("git", ["status", "--porcelain"], { cwd: root })).stdout.trim());
  evidence.build = JSON.parse(await readFile(join(root, "dist/build-info.json"), "utf8"));
  if (evidence.build.sourceCommit !== evidence.extensionCommit) throw new Error("Extension build does not match HEAD; run npm run build");
  evidence.backgroundSha256 = createHash("sha256").update(await readFile(join(root, "dist/background.js"))).digest("hex");
  runtime = await startPinnedAuth({ authPath, outputDir: output, expectedCommit });
  tls = await createAuthTls({ outputDir: output, workerPort: runtime.workerPort, schoolRequest: runtime.schoolRequest, responseGate: runtime.responseGate, protect: runtime.protect, tokenUnavailable: runtime.tokenUnavailable });
  runtime.setNetworkReader(tls.readObservations);
  await chmod(tls.certificate, 0o644);

  egress = await createEgressProxy({ tlsPort: tls.port });
  if (interrupted) throw new Error("E2E run interrupted before the runner started");

  child = spawn(process.execPath, [
    "node_modules/e2e/dist/cli/bin.js", "run", "--config", "e2e.config.ts",
    "--reporter", "list", "--output", output, ...process.argv.slice(2),
  ], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      CI: process.env.CI,
      NODE_EXTRA_CA_CERTS: tls.certificate,
      PLAYWRIGHT_BROWSERS_PATH: process.env.QUICKLOGIN_E2E_BROWSERS_PATH || process.env.PLAYWRIGHT_BROWSERS_PATH || "",
      QUICKLOGIN_E2E_AUTH_PATH: authPath,
      QUICKLOGIN_E2E_CONTROL: runtime.controlOrigin,
      QUICKLOGIN_E2E_TLS_SPKI: tls.spkiPin,
      QUICKLOGIN_E2E_PROXY: `http://127.0.0.1:${egress.port}`,
      QUICKLOGIN_E2E_ARTIFACTS: output,
      QUICKLOGIN_E2E_BREAK_ASSERTION: process.env.QUICKLOGIN_E2E_BREAK_ASSERTION || "",
      QUICKLOGIN_E2E_BREAK_ALARM: process.env.QUICKLOGIN_E2E_BREAK_ALARM || "",
      QUICKLOGIN_E2E_BREAK_ACK: process.env.QUICKLOGIN_E2E_BREAK_ACK || "",
      QUICKLOGIN_E2E_FAIL_PROVIDER_CLEANUP: process.env.QUICKLOGIN_E2E_FAIL_PROVIDER_CLEANUP || "",
      E2E_TELEMETRY_DISABLED: "1",
      DO_NOT_TRACK: "1",
      WRANGLER_SEND_METRICS: "false",
    },
  });

  let log = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", chunk => {
      log += chunk;
      process.stdout.write(chunk);
    });
  }
  try {
    process.exitCode = await new Promise((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("exit", code => resolveExit(code ?? 1));
    });
    if (interrupted) process.exitCode = 1;
    evidence.runnerExitCode = process.exitCode;
    if (process.exitCode) primaryErrors.push(`Runner exited with ${process.exitCode}`);
    console.error(`[quicklogin-e2e] runner exited with ${process.exitCode}`);
  } finally {
    process.removeListener("SIGINT", stopChild);
    process.removeListener("SIGTERM", stopChild);
  }
  await writeFile(join(output, "runner.log"), log);

  const report = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
  if (!report.run.summary.executed || report.run.summary.skipped || report.run.summary.interrupted) {
    throw new Error("Required E2E suite was empty, skipped or interrupted");
  }
  // e2e 0.21 can report passed/exit 0 while recording provider cleanup as a
  // secondary attempt error. That is still a failed required gate.
  if (report.run.results.some(result => result.selected && result.attempts?.some(attempt =>
    attempt.cleanup === "failed" || attempt.secondaryErrors?.some(error => error.phase === "cleanup")))) {
    throw new Error("Browser provider cleanup failed in framework attempt evidence");
  }
  if (process.exitCode === 0 && (report.run.summary.failed || report.run.status !== "passed")) {
    throw new Error("Runner result mismatch");
  }
  evidence.deniedEgress = [...egress.denied];
  evidence.identities = runtime.identityCount();
  evidence.authNetwork = tls.readObservations();
  if (process.exitCode === 0 && report.run.results.some(result => result.selected && result.tags.includes("auth-device-registration"))) {
    evidence.oauth = tls.assertOAuthContracts();
  }
  await runtime.checkArtifacts(output, []);
} catch (error) {
  primaryErrors.push(failureMessage(error));
  evidence.startupCleanupErrors = (error.cleanupErrors ?? []).map(failureMessage);
  process.exitCode ||= 1;
  console.error(failureMessage(error));
} finally {
  const tasks = [];
  const deniedEgress = [...(egress?.denied ?? [])];
  const unexpectedDeniedEgress = deniedEgress.filter(origin =>
    !chromiumServiceOrigins.has(origin) && origin !== expectedDeniedCallback
  );
  evidence.deniedEgress = deniedEgress;
  evidence.unexpectedDeniedEgress = unexpectedDeniedEgress;
  if (egress) tasks.push(egress.close());
  if (tls) tasks.push(tls.close());
  if (runtime) tasks.push(runtime.close().then(() => {
    const school = runtime.schoolEvidence;
    if (school && (school.proxyObjectsRemoved !== true || !Array.isArray(school.removedProxyIds) || !school.removedProxyIds.length)) {
      throw new Error("Native school proxy cleanup lacks actual removed-proxy evidence");
    }
    if (school && (!school.school?.length || school.school.some(value =>
      value.profiles !== 0 || value.chromeProcesses !== 0 || !value.browserLaunches?.length ||
      value.browserLaunches.some(launch => !launch.headless || !launch.basicPasswordStore || !launch.mockKeychain || !launch.disposableProfile)
    ))) throw new Error("Native school browser lacks safe launch or final profile/process cleanup evidence");
    if (unexpectedDeniedEgress.length) {
      throw new Error(`Unexpected browser egress denied (${unexpectedDeniedEgress.join(", ")})`);
    }
  }).finally(() => { evidence.school = runtime.schoolEvidence; }));
  tasks.push(rmdir(join(output, "profiles")).catch(error => {
    if (error.code !== "ENOENT") throw new Error("Browser profile cleanup failed: residual state remains");
  }));
  const results = await Promise.allSettled(tasks);
  const cleanupFailures = [
    ...(evidence.startupCleanupErrors ?? []),
    ...results.filter(result => result.status === "rejected").map(result => failureMessage(result.reason)),
  ];
  cleanupError = cleanupFailures.length ? cleanupFailures.join("; ") : null;
  if (cleanupError) process.exitCode = 1;
  evidence.cleanup = cleanupError ? `failed: ${cleanupError}` : "passed";
  console.error(`[quicklogin-e2e] cleanup ${evidence.cleanup}`);
  evidence.primaryFailures = primaryErrors;
  evidence.cleanupFailures = cleanupFailures;
  if (primaryErrors.length && cleanupError) {
    console.error(`[quicklogin-e2e] primary failure retained: ${primaryErrors.join("; ")}`);
  }
  try {
    await writeFile(join(output, "runtime.json"), JSON.stringify(evidence, null, 2) + "\n");
  } catch {
    process.exitCode = 1;
  }
}
