import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const output = `.e2e/zero-${Date.now()}`;
await mkdir(output, { recursive: true });
const child = spawn(process.execPath, [
  "e2e/run.mjs", "--grep", "^QUICKLOGIN01_ZERO_SELECTION$",
], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    CI: process.env.CI,
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || "",
    QUICKLOGIN_E2E_AUTH_PATH: process.env.QUICKLOGIN_E2E_AUTH_PATH || join(process.cwd(), "..", "QUICKLOGIN-03-deps", "auth"),
    QUICKLOGIN_E2E_VIEWPORT: process.env.QUICKLOGIN_E2E_VIEWPORT || "desktop",
    QUICKLOGIN_E2E_AUTH_COMMIT: process.env.QUICKLOGIN_E2E_AUTH_COMMIT || "870933794326b9d280dcf07f392c80c127fd7233",
    QUICKLOGIN_E2E_BROWSERS_PATH: process.env.QUICKLOGIN_E2E_BROWSERS_PATH || "",
    QUICKLOGIN_E2E_OUTPUT: resolve(output, "run"),
    E2E_TELEMETRY_DISABLED: "1",
    DO_NOT_TRACK: "1",
  },
});
let log = "";
for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { log += chunk; process.stdout.write(chunk); });
const code = await new Promise(resolve => child.once("exit", code => resolve(code ?? 1)));
await writeFile(join(output, "zero-selection.log"), log);
if (code !== 2 || !log.includes("NO_TESTS")) throw new Error("Zero-test selection must fail with NO_TESTS");
try {
  const runtime = JSON.parse(await readFile(join(output, "run/runtime.json"), "utf8"));
  if (runtime.cleanup !== "passed") throw new Error("Zero-selection cleanup failed");
  if (runtime.runnerExitCode !== 2) throw new Error("Zero-selection runner did not reject collection");
} catch (error) {
  throw new Error(`Zero-selection cleanup evidence was unavailable (${error.code ?? error.message})`);
}
console.log(`[quicklogin-e2e] zero-selection failure verified: ${output}`);
