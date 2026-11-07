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
