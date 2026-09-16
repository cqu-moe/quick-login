import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../dist/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const failures = [];
const pkg=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8"));
const lock=JSON.parse(await readFile(new URL("../package-lock.json",import.meta.url),"utf8"));
const sourceManifest=JSON.parse(await readFile(new URL("../public/manifest.json",import.meta.url),"utf8"));
const buildInfo=JSON.parse(await readFile(new URL("build-info.json",root),"utf8"));
if ([lock.version,lock.packages[""].version,sourceManifest.version,manifest.version,buildInfo.extensionVersion].some(version=>version!==pkg.version)) {
  failures.push("source, lockfile, manifest and built package versions differ");
}
if (buildInfo.protocolVersion!==3 || !/^[a-f0-9]{40}$/.test(buildInfo.sourceCommit) || !/^[a-f0-9]{64}$/.test(buildInfo.contractDigest)) failures.push("invalid build provenance");
const contract=await readFile(new URL("../src/shared/protocol-v3.generated.ts",import.meta.url),"utf8");
if (!contract.includes(`CONTRACT_DIGEST = '${buildInfo.contractDigest}'`)) failures.push("built protocol differs from current canonical contract");
if (JSON.stringify(manifest.externally_connectable)!==JSON.stringify({matches:["https://auth.cqu.moe/*"]})) failures.push("unexpected external messaging origins");
const exactPermissions = ["alarms", "cookies", "identity", "storage"];
const exactHosts = [
  "https://auth.cqu.moe/*",
  "https://sso.cqu.edu.cn/*",
  "https://us.i.posthog.com/*",
];

if (JSON.stringify([...manifest.permissions].sort()) !== JSON.stringify(exactPermissions)) {
  failures.push("manifest permissions differ from the approved list");
}
if (JSON.stringify([...manifest.host_permissions].sort()) !== JSON.stringify(exactHosts)) {
  failures.push("manifest host permissions differ from the approved list");
}

const referenced = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
].filter(Boolean);
for (const file of referenced) {
  try { await stat(new URL(file, root)); } catch { failures.push(`missing manifest file: ${file}`); }
}

async function files(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await files(new URL(`${relative}/`, root), relative));
    else result.push(relative);
  }
  return result;
}

const packaged = await files(root);
for (const name of packaged) {
  if (/\.map$|(^|\/)\.env|experiment|private.*key|\.pem$|\.key$/i.test(name)) {
    failures.push(`forbidden packaged file: ${name}`);
  }
  const text = await readFile(new URL(name, root), "utf8").catch(() => "");
  if (/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|client_secret|sourceMappingURL=/i.test(text)) {
    failures.push(`forbidden content in: ${name}`);
  }
  if (/\b(?:eval|Function)\s*\(/.test(text)) failures.push(`remote/dynamic code primitive in: ${name}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`package ok: ${packaged.length} files, ${referenced.length} manifest references`);
}
