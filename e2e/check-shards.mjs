import { execFileSync } from "node:child_process";
import { verifyShardAdmissions } from "./shard-evidence.mjs";

const root = process.argv[2];
if (!root) throw new Error("Usage: node e2e/check-shards.mjs <downloaded-artifacts-directory>");
await verifyShardAdmissions(root, execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
console.log("E2E shard admission ok: 12 partitions, two rounds each");
