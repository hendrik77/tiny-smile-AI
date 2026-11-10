import { findEmoji } from "./emoji-data";

export interface EvalSample {
  query: string;
  /** At least one of these should appear in the suggestions. */
  expect: string[];
  /** None of these should appear. */
  avoid: string[];
}

export interface SampleResult {
  query: string;
  hitTop8: boolean;
  hitTop24: boolean;
  /** 1-based rank of the best expected emoji, or null if none was suggested. */
  firstHitRank: number | null;
  /** Avoid-list emojis that were suggested (anywhere in the list). */
  avoided: string[];
  count: number;
  /** Set when the request failed; the row is then excluded from scoring. */
  error?: string;
}

export interface Summary {
  samples: number;
  top8Rate: number;
  top24Rate: number;
  avoidViolations: number;
  meanFirstHitRank: number | null;
}

/** Comparison key that ignores variation selectors and skin tones; falls back to the raw string. */
function key(s: string): string {
  return findEmoji(s)?.emoji ?? s;
}

export function scoreSample(sample: EvalSample, suggested: string[]): SampleResult {
  const keys = suggested.map(key);
  const wanted = new Set(sample.expect.map(key));
  const idx = keys.findIndex((k) => wanted.has(k));
  const firstHitRank = idx === -1 ? null : idx + 1;
  const suggestedSet = new Set(keys);
  const avoided = sample.avoid.filter((e, i, all) => all.indexOf(e) === i && suggestedSet.has(key(e)));
  return {
    query: sample.query,
    hitTop8: firstHitRank !== null && firstHitRank <= 8,
    hitTop24: firstHitRank !== null && firstHitRank <= 24,
    firstHitRank,
    avoided,
    count: suggested.length,
  };
}

export function summarize(results: SampleResult[]): Summary {
  const n = results.length;
  const ranks = results.flatMap((r) => (r.firstHitRank === null ? [] : [r.firstHitRank]));
  return {
    samples: n,
    top8Rate: n ? results.filter((r) => r.hitTop8).length / n : 0,
    top24Rate: n ? results.filter((r) => r.hitTop24).length / n : 0,
    avoidViolations: results.reduce((sum, r) => sum + r.avoided.length, 0),
    meanFirstHitRank: ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null,
  };
}

const MAX_QUERY_WIDTH = 40;

function pad(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - s.length));
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function formatReport(results: SampleResult[], summary: Summary): string {
  const clip = (q: string) => (q.length > MAX_QUERY_WIDTH ? `${q.slice(0, MAX_QUERY_WIDTH - 1)}…` : q);
  const qWidth = Math.max("Query".length, ...results.map((r) => clip(r.query).length));
  const cols = [6, 6, 5, 5]; // Top 8, Top 24, Rank, Count
  const line = (q: string, a: string, b: string, c: string, d: string, e: string) =>
    [pad(q, qWidth), pad(a, cols[0]), pad(b, cols[1]), pad(c, cols[2]), pad(d, cols[3]), e].join("  ").trimEnd();
  const lines = [line("Query", "Top 8", "Top 24", "Rank", "Count", "Avoided")];
  lines.push("-".repeat(qWidth + 2 + cols.reduce((a, b) => a + b + 2, 0) + 7));
  for (const r of results) {
    if (r.error !== undefined) {
      lines.push(line(clip(r.query), "-", "-", "-", "-", `ERROR: ${r.error}`));
      continue;
    }
    lines.push(
      line(
        clip(r.query),
        r.hitTop8 ? "yes" : "no",
        r.hitTop24 ? "yes" : "no",
        r.firstHitRank === null ? "-" : String(r.firstHitRank),
        String(r.count),
        r.avoided.join(" "),
      ),
    );
  }
  const errors = results.filter((r) => r.error !== undefined).length;
  lines.push(
    "",
    `Samples: ${summary.samples}`,
    `Top-8 hit rate: ${pct(summary.top8Rate)}`,
    `Top-24 hit rate: ${pct(summary.top24Rate)}`,
    `Avoid violations: ${summary.avoidViolations}`,
    `Mean first-hit rank: ${summary.meanFirstHitRank === null ? "-" : summary.meanFirstHitRank.toFixed(1)}`,
  );
  if (errors > 0) lines.push(`Errors (not scored): ${errors}`);
  return lines.join("\n");
}
