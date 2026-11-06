import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const shardTotals = { core: 4, devices: 2 };

export function parseShard(value) {
  if (!value) return null;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const index = match ? Number(match[1]) : 0;
  const total = match ? Number(match[2]) : 0;
  if (!index || !total || index > total) throw new Error("QUICKLOGIN_E2E_SHARD must be INDEX/TOTAL");
  return { index, total, label: `${index}/${total}` };
}

export function stripShard(args) {
  return args.filter((argument, index) =>
    argument !== "--shard" && !argument.startsWith("--shard=") && args[index - 1] !== "--shard");
}

async function admissionsUnder(root) {
  const admissions = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name);
    const admission = JSON.parse(await readFile(join(path, "sanitization.json"), "utf8"));
    admissions.push({ path, admission });
  }
  return admissions;
}

export async function verifyShardAdmissions(root, expectedCommit) {
  assert.match(expectedCommit ?? "", /^[a-f0-9]{40}$/, "Expected a checkout commit");
  const found = await admissionsUnder(root);
  assert.equal(found.length, 12, "Expected exactly 12 E2E shard admissions");
  const byKey = new Map();
  for (const { path, admission } of found) {
    assert.deepEqual(admission.problems, [], `${path}: source admission reported problems`);
    const key = `${admission.suite}:${admission.viewport.name}:${admission.shard}`;
    assert.ok(!byKey.has(key), `Duplicate E2E shard admission: ${key}`);
    byKey.set(key, admission);
  }

  const expectedKeys = [];
  for (const [suite, total] of Object.entries(shardTotals)) {
    for (const viewport of ["desktop", "mobile"]) {
      for (let index = 1; index <= total; index += 1) expectedKeys.push(`${suite}:${viewport}:${index}/${total}`);
    }
  }
  assert.deepEqual([...byKey.keys()].sort(), expectedKeys.sort(), "E2E shard admissions do not form the required matrix");

  const fullSuites = new Map();
  let provenance;
  const runIds = new Set();
  for (const [key, admission] of byKey) {
    const [suite, viewport, shard] = key.split(":");
    assert.equal(admission.rounds.length, 2, `${key}: expected two independent rounds`);
    assert.ok(admission.rounds.every(round => typeof round.runId === "string" && round.runId), `${key}: a round has no run identity`);
    assert.equal(new Set(admission.rounds.map(round => round.runId)).size, 2, `${key}: rounds reused a framework identity`);
    assert.ok(admission.rounds.every(round => Array.isArray(round.tests) && round.tests.length && round.tests.every(id => typeof id === "string" && id)), `${key}: a round has an invalid test ID`);
    for (const round of admission.rounds) {
      assert.ok(!runIds.has(round.runId), `${key}: reused a framework identity across shards`);
      runIds.add(round.runId);
    }
    assert.deepEqual(admission.actualTests.map(test => test.id), admission.rounds[0].tests, `${key}: aggregate differs from executed tests`);
    assert.deepEqual(admission.rounds[0].tests, admission.rounds[1].tests, `${key}: rounds executed different tests`);
    assert.ok(admission.fullSuiteIds.every(id => typeof id === "string" && id), `${key}: full-suite discovery contains an invalid test ID`);
    assert.deepEqual(admission.fullSuiteIds, [...new Set(admission.fullSuiteIds)].sort(), `${key}: full-suite IDs are invalid`);

    const fullKey = `${suite}:${viewport}`;
    const expectedFull = fullSuites.get(fullKey) ?? admission.fullSuiteIds;
    assert.deepEqual(admission.fullSuiteIds, expectedFull, `${fullKey}: full discovery differs between shards`);
    fullSuites.set(fullKey, expectedFull);

    assert.match(admission.source?.extensionCommit ?? "", /^[a-f0-9]{40}$/, `${key}: invalid extension commit`);
    assert.match(admission.source?.authCommit ?? "", /^[a-f0-9]{40}$/, `${key}: invalid Auth commit`);
    assert.match(admission.source?.backgroundSha256 ?? "", /^[a-f0-9]{64}$/, `${key}: invalid extension SHA-256`);
    assert.equal(admission.source.extensionCommit, expectedCommit, `${key}: extension commit differs from checkout`);
    const expectedSource = provenance ?? admission.source;
    assert.deepEqual(admission.source, expectedSource, "E2E provenance differs between shards");
    provenance ??= admission.source;

    const controlShard = shard === `1/${shardTotals[suite]}`;
    const expectedControls = controlShard
      ? suite === "devices" ? ["device"] : ["negative", "zero", "lifecycle"]
      : [];
    assert.deepEqual(Object.keys(admission.controls).sort(), expectedControls.sort(), `${key}: unexpected controls`);
    for (const name of expectedControls) {
      assert.equal(typeof admission.controls[name], "string", `${key}: missing ${name} control`);
      assert.notEqual(admission.controls[name], "missing", `${key}: missing ${name} control`);
      assert.notEqual(admission.controls[name], "not-assigned", `${key}: ${name} control is not assigned`);
      assert.notEqual(admission.controls[name], "", `${key}: ${name} control is empty`);
    }
  }

  for (const [suite, total] of Object.entries(shardTotals)) {
    for (const viewport of ["desktop", "mobile"]) {
      const tests = [];
      for (let index = 1; index <= total; index += 1) {
        tests.push(...byKey.get(`${suite}:${viewport}:${index}/${total}`).rounds[0].tests);
      }
      assert.equal(new Set(tests).size, tests.length, `${suite}:${viewport}: shard tests overlap`);
      assert.deepEqual([...new Set(tests)].sort(), fullSuites.get(`${suite}:${viewport}`), `${suite}:${viewport}: shard union differs from full suite`);
    }
  }
}
