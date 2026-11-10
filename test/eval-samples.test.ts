import { describe, expect, it } from "vitest";
import samples from "../eval/samples.json";
import { findEmoji } from "../src/lib/emoji-data";

type Sample = { query: string; expect: string[]; avoid: string[] };
const all = samples as Sample[];

describe("eval/samples.json", () => {
  it("has exactly 30 samples", () => {
    expect(all).toHaveLength(30);
  });

  it("has unique, non-empty queries", () => {
    const queries = all.map((s) => s.query.trim().toLowerCase());
    expect(queries.every((q) => q.length > 0)).toBe(true);
    expect(new Set(queries).size).toBe(all.length);
  });

  it("has only the expected keys with array values", () => {
    for (const s of all) {
      expect(Object.keys(s).sort()).toEqual(["avoid", "expect", "query"]);
      expect(Array.isArray(s.expect)).toBe(true);
      expect(Array.isArray(s.avoid)).toBe(true);
    }
  });

  it("has 1 to 6 expected emojis per sample", () => {
    for (const s of all) {
      expect(s.expect.length, s.query).toBeGreaterThanOrEqual(1);
      expect(s.expect.length, s.query).toBeLessThanOrEqual(6);
    }
  });

  it("resolves every emoji through findEmoji", () => {
    for (const s of all) {
      for (const e of [...s.expect, ...s.avoid]) expect(findEmoji(e), `${s.query}: ${e}`).toBeDefined();
    }
  });

  it("never lists an emoji in both expect and avoid", () => {
    for (const s of all) {
      const avoid = new Set(s.avoid.map((e) => findEmoji(e)?.emoji));
      for (const e of s.expect) expect(avoid.has(findEmoji(e)?.emoji), `${s.query}: ${e}`).toBe(false);
    }
  });

  it("covers at least 5 German queries", () => {
    const german = [
      "Feierabend",
      "Herzlichen Glückwunsch",
      "Gute Besserung",
      "Guten Morgen",
      "Danke schön",
      "Ich bin müde",
    ];
    expect(german.filter((q) => all.some((s) => s.query === q)).length).toBeGreaterThanOrEqual(5);
  });

  it("keeps the two tricky literal-reading cases", () => {
    const leg = all.find((s) => s.query === "break a leg");
    expect(leg?.avoid.map((e) => findEmoji(e)?.emoji)).toContain("🦵");
    const loss = all.find((s) => s.query === "sorry for your loss");
    const lossAvoid = loss?.avoid.map((e) => findEmoji(e)?.emoji);
    expect(lossAvoid).toContain("🎉");
    expect(lossAvoid).toContain("😂");
  });
});
