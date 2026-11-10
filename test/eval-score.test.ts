import { describe, expect, it } from "vitest";
import { formatReport, scoreSample, summarize, type SampleResult } from "../src/lib/eval-score";

const sample = { query: "pizza", expect: ["🍕", "🍅"], avoid: ["😂"] };

describe("scoreSample", () => {
  it("hits in top 8 with rank 1", () => {
    const r = scoreSample(sample, ["🍕", "🍔"]);
    expect(r).toEqual({
      query: "pizza",
      hitTop8: true,
      hitTop24: true,
      firstHitRank: 1,
      avoided: [],
      count: 2,
    });
  });

  it("reports the best (lowest) rank among expected emojis", () => {
    expect(scoreSample(sample, ["🍔", "🍅", "🍕"]).firstHitRank).toBe(2);
  });

  it("rank 8 is top 8, rank 9 is only top 24", () => {
    const filler = ["😀", "😃", "😄", "😁", "😆", "😅", "🤣"];
    const at8 = scoreSample(sample, [...filler, "🍕"]);
    expect(at8.firstHitRank).toBe(8);
    expect(at8.hitTop8).toBe(true);
    const at9 = scoreSample(sample, [...filler, "😂", "🍕"]);
    expect(at9.firstHitRank).toBe(9);
    expect(at9.hitTop8).toBe(false);
    expect(at9.hitTop24).toBe(true);
  });

  it("rank 24 counts, rank 25 does not", () => {
    const filler = EMOJI_FILLER.slice(0, 23);
    expect(scoreSample(sample, [...filler, "🍕"]).hitTop24).toBe(true);
    const miss = scoreSample(sample, [...EMOJI_FILLER.slice(0, 24), "🍕"]);
    expect(miss.hitTop24).toBe(false);
    expect(miss.firstHitRank).toBe(25);
  });

  it("returns no hit and null rank when nothing matches", () => {
    const r = scoreSample(sample, ["🍔", "🌮"]);
    expect(r.hitTop8).toBe(false);
    expect(r.hitTop24).toBe(false);
    expect(r.firstHitRank).toBeNull();
  });

  it("ignores variation selectors on either side", () => {
    const s = { query: "love", expect: ["❤️"], avoid: ["☀️"] };
    expect(scoreSample(s, ["❤"]).firstHitRank).toBe(1);
    expect(scoreSample(s, ["☀"]).avoided).toEqual(["☀️"]);
  });

  it("lists avoided emojis that were suggested, in avoid-list order, once each", () => {
    const s = { query: "x", expect: ["🍕"], avoid: ["😂", "🎉", "💀"] };
    expect(scoreSample(s, ["🎉", "🍕", "😂", "🎉"]).avoided).toEqual(["😂", "🎉"]);
  });

  it("counts avoided emojis even beyond the top 24", () => {
    const s = { query: "x", expect: ["🍕"], avoid: ["😂"] };
    expect(scoreSample(s, [...EMOJI_FILLER.slice(0, 30), "😂"]).avoided).toEqual(["😂"]);
  });

  it("handles empty suggestions", () => {
    const r = scoreSample(sample, []);
    expect(r).toMatchObject({ hitTop8: false, hitTop24: false, firstHitRank: null, avoided: [], count: 0 });
  });

  it("handles an empty avoid list", () => {
    expect(scoreSample({ query: "q", expect: ["🍕"], avoid: [] }, ["🍕"]).avoided).toEqual([]);
  });

  it("ignores unknown strings in suggestions without breaking ranks", () => {
    expect(scoreSample(sample, ["zzz", "🍕"]).firstHitRank).toBe(2);
  });

  it("counts every suggestion", () => {
    expect(scoreSample(sample, ["🍔", "🌮", "🍕"]).count).toBe(3);
  });
});

function result(over: Partial<SampleResult> = {}): SampleResult {
  return { query: "q", hitTop8: true, hitTop24: true, firstHitRank: 1, avoided: [], count: 24, ...over };
}

describe("summarize", () => {
  it("computes rates, violations and mean rank", () => {
    const s = summarize([
      result({ firstHitRank: 1 }),
      result({ hitTop8: false, firstHitRank: 10 }),
      result({ hitTop8: false, hitTop24: false, firstHitRank: null, avoided: ["😂", "🎉"] }),
      result({ firstHitRank: 4, avoided: ["💀"] }),
    ]);
    expect(s.samples).toBe(4);
    expect(s.top8Rate).toBeCloseTo(0.5);
    expect(s.top24Rate).toBeCloseTo(0.75);
    expect(s.avoidViolations).toBe(3);
    expect(s.meanFirstHitRank).toBeCloseTo(5);
  });

  it("returns null mean rank when nothing hit", () => {
    expect(summarize([result({ hitTop8: false, hitTop24: false, firstHitRank: null })]).meanFirstHitRank).toBeNull();
  });

  it("handles no results", () => {
    expect(summarize([])).toEqual({
      samples: 0,
      top8Rate: 0,
      top24Rate: 0,
      avoidViolations: 0,
      meanFirstHitRank: null,
    });
  });
});

describe("formatReport", () => {
  const rows: SampleResult[] = [
    result({ query: "pizza", firstHitRank: 1 }),
    result({ query: "break a leg", hitTop8: false, hitTop24: false, firstHitRank: null, avoided: ["🦵"], count: 20 }),
  ];

  it("contains header, one line per sample and the summary", () => {
    const text = formatReport(rows, summarize(rows));
    expect(text).toContain("Query");
    expect(text).toContain("Top 8");
    expect(text).toContain("Top 24");
    expect(text).toContain("pizza");
    expect(text).toContain("break a leg");
    expect(text).toContain("🦵");
    expect(text).toContain("Samples: 2");
    expect(text).toContain("Top-8 hit rate: 50.0%");
    expect(text).toContain("Top-24 hit rate: 50.0%");
    expect(text).toContain("Avoid violations: 1");
    expect(text).toContain("Mean first-hit rank: 1.0");
  });

  it("aligns columns: every data row has the same column start for the rank", () => {
    const lines = formatReport(rows, summarize(rows)).split("\n");
    const header = lines.find((l) => l.startsWith("Query"))!;
    const col = header.indexOf("Top 8");
    const pizza = lines.find((l) => l.startsWith("pizza"))!;
    const leg = lines.find((l) => l.startsWith("break a leg"))!;
    expect(pizza.slice(col, col + 3)).toBe("yes");
    expect(leg.slice(col, col + 2)).toBe("no");
  });

  it("shows a dash when there is no mean rank or hit", () => {
    const miss = [result({ query: "m", hitTop8: false, hitTop24: false, firstHitRank: null })];
    const text = formatReport(miss, summarize(miss));
    expect(text).toContain("Mean first-hit rank: -");
  });

  it("renders error rows for failed samples", () => {
    const text = formatReport([{ ...result({ query: "boom" }), error: "AI request failed (401)" }], summarize([]));
    expect(text).toContain("boom");
    expect(text).toContain("ERROR: AI request failed (401)");
  });
});

const EMOJI_FILLER = [
  "😀",
  "😃",
  "😄",
  "😁",
  "😆",
  "😅",
  "🤣",
  "🙂",
  "🙃",
  "😉",
  "😊",
  "😇",
  "🥰",
  "😍",
  "🤩",
  "😘",
  "😗",
  "😚",
  "😙",
  "😋",
  "😛",
  "😜",
  "🤪",
  "😝",
  "🤑",
  "🤗",
  "🤭",
  "🤫",
  "🤔",
  "🤐",
];
