import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseShard, stripShard, verifyShardAdmissions } from "./shard-evidence.mjs";

const execute = promisify(execFile);

assert.equal(parseShard("1/4").label, "1/4");
assert.throws(() => parseShard("4/4/core"), /INDEX\/TOTAL/);
assert.deepEqual(stripShard(["--shard", "1/4", "--grep", "test"]), ["--grep", "test"]);
assert.deepEqual(stripShard(["--shard=1/4", "test"]), ["test"]);

const native = await execute(process.execPath, [
  "node_modules/e2e/dist/cli/bin.js", "list", "--config", "e2e.config.ts", "--reporter", "json",
  "--grep-invert", "^QUICKLOGIN-03 ", "--shard", "1/4",
]);
const nativePairs = JSON.parse(native.stdout).pairs.filter(pair => pair.kind === "test" && pair.disposition === "run");
assert.ok(nativePairs.length > 0, "Native core shard selected no tests");
assert.ok(nativePairs.every(pair => !pair.titlePath.join(" ").startsWith("QUICKLOGIN-03 ")), "Native core shard selected device tests");
const zero = await execute(process.execPath, [
  "node_modules/e2e/dist/cli/bin.js", "list", "--config", "e2e.config.ts", "--reporter", "json",
  "--grep", "^QUICKLOGIN01_ZERO_SELECTION$", "--shard", "1/4", "--pass-with-no-tests",
], { env: { ...process.env, QUICKLOGIN_E2E_SHARD: "1/4" } });
const zeroPairs = JSON.parse(zero.stdout).pairs.filter(pair => pair.kind === "test" && pair.disposition === "run");
assert.equal(zeroPairs.length, 0, "Native zero selection unexpectedly selected tests");

const root = await mkdtemp(join(tmpdir(), "quicklogin-shards-"));
function admission({ suite, viewport = "desktop", shard = "1/4" }) {
  const total = suite === "core" ? 4 : 2;
  const fullSuite = Array.from({ length: total }, (_, index) => `${suite}-${index}`).sort();
  const shardIndex = Number(shard.split("/")[0]);
  const tests = fullSuite.slice(shardIndex - 1, shardIndex);
  const controls = shard === `1/${total}`
    ? suite === "devices" ? { device: ".e2e/device-control" } : {
        negative: ".e2e/negative",
        zero: ".e2e/zero",
        lifecycle: ".e2e/lifecycle",
      }
    : {};
  return {
    suite,
    viewport: { name: viewport },
    shard,
    actualTests: tests.map(id => ({ id })),
    fullSuiteIds: fullSuite,
    rounds: [
      { runId: `${suite}-${viewport}-${shard}-1`, tests },
      { runId: `${suite}-${viewport}-${shard}-2`, tests },
    ],
    controls,
    source: { extensionCommit: "a".repeat(40), authCommit: "b".repeat(40), backgroundSha256: "d".repeat(64) },
    problems: [],
  };
}

async function writeAll(mutate = admissions => admissions) {
  const values = [];
  for (const suite of ["core", "devices"]) {
    const total = suite === "core" ? 4 : 2;
    for (const viewport of ["desktop", "mobile"]) {
      for (let index = 1; index <= total; index += 1) values.push(admission({ suite, viewport, shard: `${index}/${total}` }));
    }
  }
  const path = join(root, `case-${crypto.randomUUID()}`);
  await mkdir(path);
  for (const [index, value] of mutate(values).entries()) {
    const artifact = join(path, `artifact-${index}`);
    await mkdir(artifact);
    await writeFile(join(artifact, "sanitization.json"), JSON.stringify(value));
  }
  return path;
}

const expectedSha = "a".repeat(40);
await verifyShardAdmissions(await writeAll(), expectedSha);
await assert.rejects(async () => verifyShardAdmissions(await writeAll(values => {
  values[1].shard = values[0].shard;
  return values;
}), expectedSha), /Duplicate E2E shard admission/);
await assert.rejects(async () => verifyShardAdmissions(await writeAll(values => {
  values[1].rounds.forEach(round => round.tests = [...round.tests, values[0].rounds[0].tests[0]]);
  values[1].actualTests = values[1].rounds[0].tests.map(id => ({ id }));
  return values;
}), expectedSha), /shard tests overlap/);
await assert.rejects(async () => verifyShardAdmissions(await writeAll(values => {
  values.slice(0, 4).forEach(value => value.fullSuiteIds = value.fullSuiteIds.slice(1));
  return values;
}), expectedSha), /shard union differs from full suite/);
await assert.rejects(async () => verifyShardAdmissions(await writeAll(values => {
  values[0].controls.negative = "missing";
  return values;
}), expectedSha), /missing negative control/);
await assert.rejects(async () => verifyShardAdmissions(await writeAll(), "c".repeat(40)), /extension commit differs/);
await rm(root, { recursive: true, force: true });
console.log("E2E shard evidence self-check passed");
