import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    restoreMocks: true,
    include: ["docs/research/2026-10-22-ux-audit/*.test.ts"],
  },
});
