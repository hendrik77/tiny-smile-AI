import { defineConfig, globalIgnores } from "eslint/config";
import raycastConfig from "@raycast/eslint-config";

export default defineConfig([
  globalIgnores(["dist/", "node_modules/", "raycast-env.d.ts", "assets/", "assets-src/", "scripts/"]),
  ...raycastConfig,
]);
