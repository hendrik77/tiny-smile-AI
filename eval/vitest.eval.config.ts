import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Standalone config for the live suggestion evaluation. The normal `npm test` config only matches
// test/**, so this never runs in CI. Start it with `node scripts/eval-suggestions.mjs`.
export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  resolve: {
    alias: { "@raycast/api": fileURLToPath(new URL("../test/raycast-api-stub.ts", import.meta.url)) },
  },
  test: {
    include: ["eval/run.eval.ts"],
    environment: "node",
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 60 * 1000,
  },
});
