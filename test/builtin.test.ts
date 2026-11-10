import { describe, expect, it } from "vitest";
import data from "../src/data/builtin.json";
import { findEmoji } from "../src/lib/emoji-data";
import { BUILTIN_COUNT, lookupBuiltin, normalizeBuiltinQuery } from "../src/lib/builtin";

interface Row {
  q: string;
  a?: string[];
  l?: string;
  e: string[];
}
const rows = data as Row[];
const SKIN = /[\u{1F3FB}-\u{1F3FF}]/u;
const glyphs = (q: string) => (lookupBuiltin(q) ?? []).map((e) => e.emoji);

describe("builtin.json", () => {
  it("has enough entries, German ones marked with l: de", () => {
    expect(rows.length).toBeGreaterThanOrEqual(240);
    expect(rows.filter((r) => r.l === "de").length).toBeGreaterThanOrEqual(55);
    expect(BUILTIN_COUNT).toBe(rows.length);
  });
  it("has unique normalized keys across queries and aliases", () => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      for (const k of [r.q, ...(r.a ?? [])]) {
        const n = normalizeBuiltinQuery(k);
        expect(n, `empty key for ${r.q}`).not.toBe("");
        expect(seen.has(n), `"${k}" in "${r.q}" duplicates "${seen.get(n)}"`).toBe(false);
        seen.set(n, r.q);
      }
    }
  });
  it("keeps canonical queries lower-case", () => {
    for (const r of rows) expect(r.q).toBe(r.q.toLowerCase());
  });
  it("has exactly 12 distinct, resolvable emojis per entry in dataset form", () => {
    for (const r of rows) {
      expect(r.e.length, r.q).toBe(12);
      expect(new Set(r.e).size, `duplicates in ${r.q}`).toBe(12);
      for (const em of r.e) {
        const found = findEmoji(em);
        expect(found, `${em} in ${r.q}`).toBeDefined();
        expect(found?.emoji, `${em} in ${r.q} is not in dataset form`).toBe(em);
        expect(SKIN.test(em), `skin tone in ${r.q}`).toBe(false);
      }
    }
  });
});

describe("normalizeBuiltinQuery", () => {
  it("lower-cases, trims, collapses whitespace and strips punctuation", () => {
    expect(normalizeBuiltinQuery("  Good   Morning!! ")).toBe("good morning");
    expect(normalizeBuiltinQuery("Don't worry.")).toBe("dont worry");
    expect(normalizeBuiltinQuery("thanks 🙏 ...")).toBe("thanks");
  });
  it("folds umlauts", () => {
    expect(normalizeBuiltinQuery("Tschüss")).toBe("tschuss");
    expect(normalizeBuiltinQuery("Straße")).toBe("strasse");
  });
});

describe("lookupBuiltin", () => {
  it("matches regardless of case, punctuation and whitespace", () => {
    expect(lookupBuiltin("Thanks")).not.toBeNull();
    expect(glyphs("  THANKS!!  ")).toEqual(glyphs("thanks"));
    expect(glyphs("good   morning.")).toEqual(glyphs("good morning"));
  });
  it("matches umlaut variants", () => {
    const a = glyphs("tschüss");
    expect(a.length).toBe(12);
    expect(glyphs("tschuess")).toEqual(a);
    expect(glyphs("tschuss")).toEqual(a);
    expect(glyphs("Herzlichen Glückwunsch")).toEqual(glyphs("herzlichen glueckwunsch"));
    expect(glyphs("gute besserung").length).toBe(12);
    expect(glyphs("müde")).toEqual(glyphs("muede"));
  });
  it("resolves aliases to the canonical entry", () => {
    expect(glyphs("thank you")).toEqual(glyphs("thanks"));
    expect(glyphs("thx")).toEqual(glyphs("thanks"));
    expect(glyphs("happy birthday")).toEqual(glyphs("birthday"));
    expect(glyphs("vielen dank")).toEqual(glyphs("danke"));
  });
  it("returns null on a miss or empty input", () => {
    expect(lookupBuiltin("quantum chromodynamics lecture")).toBeNull();
    expect(lookupBuiltin("")).toBeNull();
    expect(lookupBuiltin("   ")).toBeNull();
    expect(lookupBuiltin("!!!")).toBeNull();
  });
  it("returns dataset entries, 12 by default and honouring limit", () => {
    const all = lookupBuiltin("thanks");
    expect(all).toHaveLength(12);
    expect(all?.[0].name).toBeTruthy();
    expect(lookupBuiltin("thanks", 3)).toEqual(all?.slice(0, 3));
  });
  it("returns a fresh array each call", () => {
    const a = lookupBuiltin("thanks");
    a?.pop();
    expect(lookupBuiltin("thanks")).toHaveLength(12);
  });
  it("finds every canonical query and alias", () => {
    for (const r of rows) {
      for (const k of [r.q, ...(r.a ?? [])]) {
        expect(glyphs(k), k).toEqual(r.e);
      }
    }
  });
});

describe("tone", () => {
  it("keeps condolence entries free of party emojis", () => {
    for (const q of ["sorry for your loss", "mein beileid", "rest in peace", "get well soon", "gute besserung"]) {
      const g = glyphs(q);
      expect(g.length, q).toBe(12);
      for (const bad of ["🎉", "😂", "🥳", "🤣", "😆"]) expect(g, `${q} has ${bad}`).not.toContain(bad);
    }
  });
  it("has the obvious emojis for the basics", () => {
    expect(glyphs("thanks")).toContain("🙏");
    expect(glyphs("danke")).toContain("🙏");
    expect(glyphs("birthday")).toContain("🎂");
    expect(glyphs("birthday")).toContain("🎉");
    expect(glyphs("break a leg")).toEqual(glyphs("good luck"));
  });
});
