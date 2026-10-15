import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const output = `.e2e/negative-${Date.now()}`;
await mkdir(output, { recursive: true });
const child = spawn(process.execPath, [
  "e2e/run.mjs", "--grep", "^tester-army rides a persistent Chromium context",
], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    CI: process.env.CI,
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || "",
    QUICKLOGIN_E2E_AUTH_PATH: process.env.QUICKLOGIN_E2E_AUTH_PATH || join(process.cwd(), "..", "QUICKLOGIN-02-deps", "auth"),
    QUICKLOGIN_E2E_AUTH_COMMIT: process.env.QUICKLOGIN_E2E_AUTH_COMMIT || "134f447284a676cacceb7dd0758be0290c3ca42c",
    QUICKLOGIN_E2E_BROWSERS_PATH: process.env.QUICKLOGIN_E2E_BROWSERS_PATH || "",
    QUICKLOGIN_E2E_BREAK_ASSERTION: "1",
    QUICKLOGIN_E2E_OUTPUT: resolve(output, "run"),
    E2E_TELEMETRY_DISABLED: "1",
    DO_NOT_TRACK: "1",
  },
});
let log = "";
for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { log += chunk; process.stdout.write(chunk); });
const code = await new Promise(resolve => child.once("exit", code => resolve(code ?? 1)));
await writeFile(join(output, "negative-control.log"), log);
const report = JSON.parse(await readFile(join(output, "run/report.json"), "utf8"));
const summary = report.run.summary;
const failure = report.run.results.find(result => result.selected)?.attempts[0]?.error;
if (code !== 1 || summary.failed !== 1 || summary.passed !== 0 || summary.executed !== 1 || summary.skipped ||
    failure?.code !== "ASSERTION_FAILED" || failure.message !== 'expected "forced-negative-control" to be "expected-failure"') {
  throw new Error("Negative control must fail exactly one executed test");
}
const runtime = JSON.parse(await readFile(join(output, "run/runtime.json"), "utf8"));
if (runtime.cleanup !== "passed") throw new Error("Negative-control cleanup failed");
console.log(`[quicklogin-e2e] expected assertion failure verified: ${output}`);
