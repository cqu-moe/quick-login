import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { chromium } from "playwright-core";
import { captureArtifacts, extensionOrigin } from "./helpers.ts";
import { popupViewport } from "./viewport.ts";

const output = resolve(process.argv[2] ?? `.e2e/artifact-failure-${Date.now()}`);
assert(output.startsWith(resolve(".e2e") + sep), "Control output must stay inside this worktree's .e2e");
await mkdir(resolve(".e2e"), { recursive: true });
await mkdir(output, { recursive: false });
process.env.QUICKLOGIN_E2E_ARTIFACTS = output;
(globalThis as typeof globalThis & { __QUICKLOGIN_ATTEMPT_ID__?: string }).__QUICKLOGIN_ATTEMPT_ID__ = "artifact-failure-control";
const profile = await mkdtemp(join(output, "profile-"));
const evidence: Record<string, unknown> = { checks: [], cleanup: "pending" };
let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
const failures: unknown[] = [];
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: chromium.executablePath(), headless: true, viewport: popupViewport,
    chromiumSandbox: !(process.platform === "linux" && process.env.CI === "true"),
    proxy: { server: "http://127.0.0.1:9" },
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--password-store=basic", "--use-mock-keychain", "--no-first-run", "--enable-automation",
      `--disable-extensions-except=${resolve("dist")}`, `--load-extension=${resolve("dist")}`],
  });
  await context.route(/^https?:/, route => route.abort());
  const popup = await context.newPage();
  await popup.goto(`${extensionOrigin}/popup.html`);
  const debuggerSession = await context.newCDPSession(popup);
  const { arguments: arguments_ } = await debuggerSession.send("Browser.getBrowserCommandLine");
  evidence.launch = {
    headless: arguments_.some(value => value.startsWith("--headless")),
    basicPasswordStore: arguments_.includes("--password-store=basic"),
    mockKeychain: arguments_.includes("--use-mock-keychain"),
    disposableProfile: arguments_.includes(`--user-data-dir=${profile}`),
  };
  assert(Object.values(evidence.launch as object).every(Boolean));
  await debuggerSession.detach();
  const closed = await context.newPage();
  await closed.goto(`${extensionOrigin}/popup.html`);
  await closed.close();
  assert.equal(closed.isClosed(), true);

  const primary = new Error("Deliberate business failure after page closure");
  let caught: unknown;
  // Same failure-capture/rethrow boundary as journey.e2e.ts; real helper and Page.
  try {
    throw primary;
  } catch (error) {
    try {
      await captureArtifacts("closed-failure", [popup, closed], { error });
      throw error;
    } catch (failure) { caught = failure; }
  }
  evidence.observed = {
    primaryPreserved: caught instanceof AggregateError && caught.errors[0] === primary && caught.cause === primary,
    captureFailurePreserved: caught instanceof AggregateError && /closed/i.test(String(caught.errors[1])),
    message: caught instanceof Error ? caught.message : String(caught),
  };
  assert(caught instanceof AggregateError, "Capture failure must retain primary and secondary errors");
  assert.equal(caught.errors[0], primary);
  assert.equal(caught.cause, primary);
  assert.match(String(caught.errors[1]), /closed/i);
  assert.match(caught.message, /Deliberate business failure/);
  assert.match(caught.message, /closed/i);
  (evidence.checks as string[]).push("closed-page preserves both errors");

  await assert.rejects(captureArtifacts("closed-success", [closed]), /closed/i);
  (evidence.checks as string[]).push("closed-page capture without primary remains fatal");
  await popup.setViewportSize({ width: 391, height: 720 });
  await assert.rejects(captureArtifacts("wrong-viewport", [popup]), /Actual Web viewport mismatch/);
  (evidence.checks as string[]).push("success-path viewport mismatch remains fatal");
  await popup.setViewportSize({ width: 390, height: 720 });
  await captureArtifacts("valid-viewport", [popup]);
  const observations = (await readFile(join(output, "artifacts/viewports.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert(observations.some(item => item.actual.width === 390 && item.actual.height === 720));
  (evidence.checks as string[]).push("valid actual viewport capture succeeds");
  await assert.rejects(async () => {
    try { throw primary; }
    catch (error) {
      await captureArtifacts("business-failure", [popup], { error });
      throw error;
    }
  }, error => error === primary);
  (evidence.checks as string[]).push("successful capture preserves original business error identity");
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  failures.push(error);
} finally {
  try {
    await context?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    evidence.cleanup = "passed";
  } catch (error) {
    evidence.cleanup = "failed";
    failures.push(error);
  } finally {
    await writeFile(join(output, "control.json"), JSON.stringify(evidence, null, 2) + "\n");
    console.log(JSON.stringify(evidence));
  }
}
if (failures.length === 1) throw failures[0];
if (failures.length > 1) throw new AggregateError(failures, "Artifact control and cleanup failed");
