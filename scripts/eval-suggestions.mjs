#!/usr/bin/env node
// Live evaluation of the emoji suggestions. See eval/README.md.
// Runs eval/run.eval.ts through the project's vitest, so the real prompt, provider and parser are used.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!process.env.EVAL_API_KEY?.trim()) {
  console.error(
    [
      "EVAL_API_KEY is not set.",
      "",
      "Usage:",
      "  EVAL_API_KEY=... node scripts/eval-suggestions.mjs",
      "",
      "Optional environment variables:",
      '  EVAL_PROVIDER  "anthropic" (default) or "openai-compatible"',
      "  EVAL_MODEL     model id (default: claude-haiku-4-5)",
      "  EVAL_BASE_URL  API base URL (default depends on the provider)",
      "  EVAL_COUNT     emojis to request per query (default: 24)",
    ].join("\n"),
  );
  process.exit(2);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const result = spawnSync("npx", ["vitest", "run", "--config", "eval/vitest.eval.config.ts"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
