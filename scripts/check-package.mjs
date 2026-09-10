import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../dist/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const failures = [];
const exactPermissions = ["alarms", "cookies", "identity", "storage"];
const exactHosts = ["https://auth.cqu.moe/*", "https://sso.cqu.edu.cn/*"];

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
