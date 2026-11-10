import { describe, expect, it } from "vitest";
import { searchLocal } from "../src/lib/local-search";

const names = (q: string, l?: number) => searchLocal(q, l).map((e) => e.name);

describe("searchLocal", () => {
  it("returns [] for empty/whitespace", () => {
    expect(searchLocal("")).toEqual([]);
    expect(searchLocal("   ")).toEqual([]);
  });
  it("exact name first", () => {
    expect(names("fire")[0]).toBe("fire");
    expect(names("FIRE")[0]).toBe("fire");
  });
  it("name-prefix ranks before keyword-only", () => {
    const r = names("red heart");
    expect(r[0]).toBe("red heart");
  });
  it("prefix of words matches", () => {
    expect(names("pizz")).toContain("pizza");
  });
  it("all words must match", () => {
    const r = names("grinning cat");
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((n) => n.includes("cat"))).toBe(true);
  });
  it("keyword-only match works", () => {
    expect(names("valentines")).toContain("red heart");
  });
  it("name matches rank above keyword-only", () => {
    const r = searchLocal("heart");
    const firstKeywordOnly = r.findIndex((e) => !e.name.split(" ").some((w) => w.startsWith("heart")));
    const lastNameMatch = r.map((e) => e.name.split(" ").some((w) => w.startsWith("heart"))).lastIndexOf(true);
    if (firstKeywordOnly >= 0) expect(lastNameMatch).toBeLessThan(firstKeywordOnly);
  });
  it("respects limit", () => {
    expect(searchLocal("face", 5)).toHaveLength(5);
    expect(searchLocal("face").length).toBeLessThanOrEqual(60);
  });
  it("emoji query returns that emoji", () => {
    expect(searchLocal("🔥").map((e) => e.name)).toEqual(["fire"]);
    expect(searchLocal("👍🏽")[0].emoji).toBe("👍");
  });
  it("no matches", () => {
    expect(searchLocal("zzzzqqq")).toEqual([]);
  });
});

describe("searchLocal with language de", () => {
  const de = (q: string, l?: number) => searchLocal(q, l, "de");
  it("feuer finds fire first", () => {
    expect(de("feuer")[0].name).toBe("fire");
    expect(de("Feuer")[0].name).toBe("fire");
  });
  it("herz finds red heart", () => {
    expect(de("herz").map((e) => e.emoji)).toContain("❤️");
  });
  it("froehlich, fröhlich and frohlich find a smiling face", () => {
    for (const q of ["froehlich", "fröhlich", "frohlich"]) {
      expect(de(q).map((e) => e.emoji)).toContain("😀");
    }
  });
  it("English queries still work", () => {
    expect(de("fire")[0].name).toBe("fire");
    expect(de("pizz").map((e) => e.name)).toContain("pizza");
  });
  it("language en does not match German words", () => {
    expect(searchLocal("feuer", 60, "en")).toEqual([]);
    expect(searchLocal("feuer")).toEqual([]);
  });
  it("no duplicates and respects limit", () => {
    const r = de("herz");
    expect(new Set(r.map((e) => e.emoji)).size).toBe(r.length);
    expect(de("gesicht", 5)).toHaveLength(5);
    expect(de("gesicht").length).toBeLessThanOrEqual(60);
  });
  it("better tier wins over dataset order", () => {
    // exact German label beats keyword-only English matches
    expect(de("feuer")[0].emoji).toBe("🔥");
  });
  it("emoji query unchanged", () => {
    expect(de("🔥").map((e) => e.name)).toEqual(["fire"]);
  });
  it("no matches", () => {
    expect(de("zzzzqqq")).toEqual([]);
  });
});
