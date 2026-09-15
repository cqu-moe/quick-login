import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const generated=await readFile(new URL("../src/shared/protocol-v3.generated.ts",import.meta.url),"utf8");
const marker=/\nexport const CONTRACT_DIGEST = '([a-f0-9]{64})' as const;\n$/;
const expected=generated.match(marker)?.[1];
const source=generated.slice(generated.indexOf("\n")+1).replace(marker,"");
const actual=createHash("sha256").update(source).digest("hex");
if (!expected || actual!==expected) throw new Error("QuickLogin canonical contract digest mismatch; regenerate from Auth");
console.log(`contract ok: ${actual}`);
