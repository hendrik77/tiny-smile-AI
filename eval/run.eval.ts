import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import samples from "./samples.json";
import { formatReport, scoreSample, summarize, type EvalSample, type SampleResult } from "../src/lib/eval-score";
import { parseSuggestions } from "../src/lib/parse-suggestions";
import { buildEmojiPrompt } from "../src/lib/prompt";
import { callApi } from "../src/lib/providers";
import type { AIConnection, FetchFn } from "../src/lib/types";

const DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 60_000;

const fetchFn: FetchFn = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { ok: res.ok, status: res.status, text: () => res.text() };
};

function buildConnection(): { conn: AIConnection; model: string; apiKey: string; count: number } {
  const apiKey = process.env.EVAL_API_KEY?.trim();
  if (!apiKey) throw new Error("EVAL_API_KEY is not set. Run via: node scripts/eval-suggestions.mjs");
  const kind = (process.env.EVAL_PROVIDER ?? "anthropic").trim();
  if (kind !== "anthropic" && kind !== "openai-compatible") {
    throw new Error(`EVAL_PROVIDER must be "anthropic" or "openai-compatible", got "${kind}"`);
  }
  const anthropic = kind === "anthropic";
  const model = process.env.EVAL_MODEL?.trim() || "claude-haiku-4-5";
  const baseURL =
    process.env.EVAL_BASE_URL?.trim() || (anthropic ? "https://api.anthropic.com" : "https://api.openai.com/v1");
  const count = Number.parseInt(process.env.EVAL_COUNT ?? "24", 10);
  const conn: AIConnection = {
    id: "EVAL",
    name: "eval",
    provider: anthropic ? "anthropic" : "openAICompatible",
    baseURL,
    models: [model],
  };
  return { conn, model, apiKey, count: Number.isFinite(count) && count > 0 ? count : 24 };
}

it("evaluates suggestion quality against the live API", async () => {
  const { conn, model, apiKey, count } = buildConnection();
  const scrub = (s: string) => s.split(apiKey).join("***");
  const results: SampleResult[] = [];
  for (const [i, sample] of (samples as EvalSample[]).entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
    try {
      const text = await callApi(conn, model, buildEmojiPrompt(sample.query, count), apiKey, {}, fetchFn);
      const suggested = parseSuggestions(text, count).map((e) => e.emoji);
      results.push(scoreSample(sample, suggested));
    } catch (err) {
      const message = scrub(err instanceof Error ? err.message : String(err));
      results.push({
        query: sample.query,
        hitTop8: false,
        hitTop24: false,
        firstHitRank: null,
        avoided: [],
        count: 0,
        error: message,
      });
    }
    console.log(`[${i + 1}/${samples.length}] ${sample.query}`);
  }
  const scored = results.filter((r) => r.error === undefined);
  const header = `Model: ${model} (${conn.provider}), count: ${count}\n\n`;
  const report = header + formatReport(results, summarize(scored));
  writeFileSync(fileURLToPath(new URL("./last-report.txt", import.meta.url)), report + "\n");
  console.log("\n" + report);
});
