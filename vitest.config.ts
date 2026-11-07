import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // @raycast/api ships no runnable entry; command tests mock it, this alias only lets it resolve.
    alias: { "@raycast/api": fileURLToPath(new URL("./test/raycast-api-stub.ts", import.meta.url)) },
  },
  test: { include: ["test/**/*.test.ts", "test/**/*.test.tsx"], environment: "node" },
});
