import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "auth-source": resolve(process.env.AUTH_REPO_DIR ?? "../../../auth", "src") } },
  test: {
    environment: "jsdom",
    restoreMocks: true,
    include: ["docs/research/2026-09-15-protocol-020/protocol-gaps.test.ts"],
  },
});
