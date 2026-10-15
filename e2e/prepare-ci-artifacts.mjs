import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

const source = resolve(".e2e");
const destination = resolve(process.env.QUICKLOGIN_E2E_PUBLISH_DIR || "ci-e2e-artifacts");
if (!destination.startsWith(process.cwd() + "/")) throw new Error("Artifact destination must be in this worktree");
const requiredRuns = process.argv.length > 2 ? process.argv.slice(2) : ["ci-run-1", "ci-run-2"];
if (requiredRuns.length !== 2 || requiredRuns.some(name => !/^[a-zA-Z0-9_-]+$/.test(name))) {
  throw new Error("Specify exactly two independent run names below .e2e");
}
await mkdir(dirname(destination), { recursive: true });
await mkdir(destination);
const problems = [];
let expectedSource;
const copiedPaths = [];
const redactedPaths = [];
const excludedDirectories = new Set(["auth-runtime", "tls", "profiles"]);
const allowedExtensions = new Set([".json", ".log", ".txt", ".md", ".png"]);

function redact(text) {
  return text
    .replaceAll(process.cwd(), "<worktree>")
    .replaceAll(/quicklogin-[a-f0-9]{24}@example\.test/g, "[synthetic-email-redacted]")
    .replaceAll(/((?:https?|chrome-extension):\/\/[^\s"'<>?#\\]+)[?#][^\s"'<>\\]*/g, "$1?[query-redacted]")
    .replaceAll(/((?:authorization|set-cookie|cookie)\s*:\s*)[^\r\n"']+/gi, "$1[redacted]")
    .replaceAll(/("(?:accessToken|refreshToken|access_token|refresh_token|code_verifier|resumeTicket|password|otp)"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"')
    .replaceAll(/\b(?:access_token|refresh_token|code_verifier|resume_ticket|password|otp|code)=[^&\s"',}]+/gi, "[credential-redacted]")
    .replaceAll(/\bBearer\s+[a-zA-Z0-9._~+/-]+=*/gi, "Bearer [redacted]");
}

async function copySafe(current) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      problems.push("Symbolic link excluded: " + relative(source, path));
      continue;
    }
    if (entry.isDirectory()) {
      if (excludedDirectories.has(entry.name)) {
        problems.push("Uncleaned runtime state excluded: " + relative(source, path));
      } else {
        await copySafe(path);
      }
      continue;
    }
    if (!entry.isFile() || !allowedExtensions.has(extname(entry.name))) continue;
    const relativePath = relative(source, path);
    const target = join(destination, relativePath);
    await mkdir(dirname(target), { recursive: true });
    if (extname(path) === ".png") {
      // Only harness screenshots and captureArtifacts' input-masked synthetic pages reach here.
      await cp(path, target);
    } else {
      const original = await readFile(path, "utf8");
      const clean = redact(original);
      if (clean !== original) redactedPaths.push(relativePath);
      await writeFile(target, clean);
    }
    copiedPaths.push(relativePath);
  }
}

async function readRun(path) {
  return {
    runtime: JSON.parse(await readFile(join(path, "runtime.json"), "utf8")),
    report: JSON.parse(await readFile(join(path, "report.json"), "utf8")),
  };
}

function sourceOf(runtime) {
  return JSON.stringify([runtime.extensionCommit, runtime.authCommit, runtime.backgroundSha256]);
}

function sameSource(runtime) {
  return !expectedSource || (sourceOf(runtime) === expectedSource && runtime.sourceDirty === false);
}

async function findControl(prefix, valid) {
  let entries = [];
  try { entries = await readdir(source, { withFileTypes: true }); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const path = join(source, entry.name);
    candidates.push({ path, time: (await stat(path)).mtimeMs });
  }
  for (const candidate of candidates.sort((left, right) => right.time - left.time)) {
    try {
      if (await valid(candidate.path)) return candidate.path;
    } catch { /* Incomplete attempts remain local evidence; only a verified control counts. */ }
  }
  return undefined;
}

for (const name of requiredRuns) {
  const path = join(source, name);
  try {
    const { runtime, report } = await readRun(path);
    if (runtime.sourceDirty !== false || runtime.build?.sourceCommit !== runtime.extensionCommit || !runtime.backgroundSha256) {
      problems.push(name + " did not use a clean fixed build");
    }
    if (expectedSource && !sameSource(runtime)) problems.push("Independent runs used different source or build identities");
    expectedSource ??= sourceOf(runtime);
    if (runtime.groups?.some(group => group.sourceDirty !== false || sourceOf(group) !== sourceOf(runtime) || group.cleanup !== 'passed')) problems.push(name + ' has inconsistent or dirty isolated runtime evidence');
    const summary = report.run.summary;
    if (runtime.cleanup !== "passed" || report.run.status !== "passed" ||
        !summary.executed || summary.executed !== summary.selected || summary.passed !== summary.executed ||
        summary.failed || summary.skipped || summary.interrupted || report.run.errors.length) {
      problems.push(name + " was not a clean passing run");
    }
  } catch {
    problems.push(name + " has incomplete run evidence");
  }
  try { await copySafe(path); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

const negative = await findControl("negative-", async path => {
  const { runtime, report } = await readRun(join(path, "run"));
  const summary = report.run.summary;
  const error = report.run.results.find(result => result.selected)?.attempts[0]?.error;
  return sameSource(runtime) && runtime.cleanup === "passed" && summary.failed === 1 && summary.executed === 1 &&
    !summary.passed && !summary.skipped && error?.code === "ASSERTION_FAILED" &&
    error.message === 'expected "forced-negative-control" to be "expected-failure"';
});
const zero = await findControl("zero-", async path => {
  const runtime = JSON.parse(await readFile(join(path, "run/runtime.json"), "utf8"));
  const log = await readFile(join(path, "zero-selection.log"), "utf8");
  return sameSource(runtime) && runtime.cleanup === "passed" && runtime.runnerExitCode === 2 && log.includes("NO_TESTS");
});
const lifecycle = await findControl("lifecycle-", async path => {
  const result = JSON.parse(await readFile(join(path, "control.json"), "utf8"));
  const names = result.checks.map(check => check.name).sort();
  if (result.status !== "passed" || JSON.stringify(names) !== JSON.stringify([
    "cleanup-only", "missing-auth", "primary-and-cleanup", "provider-cleanup",
  ]) || result.controlledResiduesRemoved !== true) return false;
  for (const check of result.checks) {
    const runtime = JSON.parse(await readFile(join(path, check.name, "runtime.json"), "utf8"));
    if (!sameSource(runtime)) return false;
  }
  return true;
});
for (const [name, path] of [["negative", negative], ["zero", zero], ["lifecycle", lifecycle]]) {
  if (path) await copySafe(path);
  else problems.push("Verified " + name + " control is missing");
}
await writeFile(join(destination, "sanitization.json"), JSON.stringify({
  copiedFiles: copiedPaths.length,
  filesChangedByRedaction: redactedPaths,
  requestedRuns: requiredRuns,
  negativeControl: negative ? relative(source, negative) : "missing",
  zeroControl: zero ? relative(source, zero) : "missing",
  lifecycleControl: lifecycle ? relative(source, lifecycle) : "missing",
  excludedRuntimeState: ["Auth bundle, D1/DO storage", "TLS private key and certificate", "Chromium profiles"],
  problems,
}, null, 2) + "\n");
console.log("[quicklogin-e2e] sanitized " + copiedPaths.length + " files into " + relative(process.cwd(), destination));
if (problems.length) {
  for (const problem of problems) console.error("[quicklogin-e2e] " + problem);
  process.exitCode = 1;
}
