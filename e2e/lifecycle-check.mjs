import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdir, readFile, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const output = resolve(".e2e/lifecycle-" + Date.now());
await mkdir(output, { recursive: true });
const checks = [];

async function probe(name, { missingAuth = false, assertionFailure = false, providerFailure = false } = {}) {
  const run = join(output, name);
  const residue = join(run, "profiles", "controlled-residue.txt");
  const child = spawn(process.execPath, ["e2e/run.mjs", "--grep", "^tester-army rides"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      CI: process.env.CI,
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || "",
      QUICKLOGIN_E2E_BROWSERS_PATH: process.env.QUICKLOGIN_E2E_BROWSERS_PATH || "",
      QUICKLOGIN_E2E_AUTH_PATH: missingAuth ? join(output, "missing-auth-source") :
        process.env.QUICKLOGIN_E2E_AUTH_PATH || resolve("..", "QUICKLOGIN-02-deps", "auth"),
      QUICKLOGIN_E2E_AUTH_COMMIT: process.env.QUICKLOGIN_E2E_AUTH_COMMIT || "134f447284a676cacceb7dd0758be0290c3ca42c",
      QUICKLOGIN_E2E_OUTPUT: run,
      QUICKLOGIN_E2E_BREAK_ASSERTION: assertionFailure ? "1" : "",
      QUICKLOGIN_E2E_FAIL_PROVIDER_CLEANUP: providerFailure ? "1" : "",
      E2E_TELEMETRY_DISABLED: "1",
      DO_NOT_TRACK: "1",
    },
  });
  let log = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { log += chunk; });
  const ended = new Promise((done, fail) => {
    child.once("error", fail);
    child.once("exit", code => done(code ?? 1));
  });
  const timeout = setTimeout(() => child.kill("SIGTERM"), 30000);
  let planted = false;
  try {
    if (!missingAuth && !providerFailure) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && child.exitCode === null) {
        try {
          await stat(run);
          await mkdir(join(run, "profiles"), { recursive: true });
          await writeFile(residue, "Controlled synthetic cleanup residue\n");
          planted = true;
          break;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          await new Promise(done => setTimeout(done, 20));
        }
      }
      assert(planted, "Could not place the controlled cleanup residue");
    }
    const code = await ended;
    await writeFile(join(output, name + ".log"), log);
    const runtime = JSON.parse(await readFile(join(run, "runtime.json"), "utf8"));
    assert.equal(code, 1, "The wrapper must reject the controlled failure");
    if (missingAuth) {
      assert.equal(runtime.cleanup, "passed");
      assert.equal(runtime.runnerExitCode, undefined);
      assert(runtime.primaryFailures.some(message => message.includes("missing-auth-source")));
    } else if (providerFailure) {
      const report = JSON.parse(await readFile(join(run, "report.json"), "utf8"));
      assert.equal(runtime.runnerExitCode, 0);
      assert.equal(report.run.summary.passed, 1);
      const attempt = report.run.results.find(result => result.selected)?.attempts[0];
      assert.equal(attempt?.cleanup, "failed");
      assert(attempt.secondaryErrors.some(error => error.message.includes("Injected provider cleanup failure")));
      assert(runtime.primaryFailures.includes("Browser provider cleanup failed in framework attempt evidence"));
      assert.equal(runtime.cleanup, "passed");
    } else {
      const report = JSON.parse(await readFile(join(run, "report.json"), "utf8"));
      assert.equal(runtime.runnerExitCode, assertionFailure ? 1 : 0);
      assert.equal(report.run.summary.executed, 1);
      assert.equal(report.run.summary.failed, assertionFailure ? 1 : 0);
      assert.equal(report.run.summary.passed, assertionFailure ? 0 : 1);
      assert(runtime.cleanupFailures.some(message => message.includes("Browser profile cleanup failed")));
      assert(runtime.cleanup.startsWith("failed:"));
      if (assertionFailure) {
        const failure = report.run.results.find(result => result.selected)?.attempts[0]?.error;
        assert.equal(failure?.code, "ASSERTION_FAILED");
        assert.equal(failure.message, 'expected "forced-negative-control" to be "expected-failure"');
        assert(runtime.primaryFailures.includes("Runner exited with 1"));
        assert(log.includes("primary failure retained"));
      }
    }
    checks.push({ name, wrapperExitCode: code, runnerExitCode: runtime.runnerExitCode ?? null,
      cleanup: runtime.cleanup, bothFailuresRetained: assertionFailure });
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await ended;
    }
    if (planted) {
      await unlink(residue);
      await rmdir(join(run, "profiles"));
    }
  }
}

await probe("missing-auth", { missingAuth: true });
await probe("cleanup-only");
await probe("primary-and-cleanup", { assertionFailure: true });
await probe("provider-cleanup", { providerFailure: true });
await writeFile(join(output, "control.json"), JSON.stringify({
  status: "passed",
  checks,
  controlledResiduesRemoved: true,
}, null, 2) + "\n");
console.log("[quicklogin-e2e] four lifecycle failure controls passed: " + output);
