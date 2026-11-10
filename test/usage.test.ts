import { describe, expect, it } from "vitest";
import { parseUsageStore, rankByUsage, recordUse, usageScore, type UsageStore } from "../src/lib/usage";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

describe("usageScore", () => {
  it("halves every 30 days", () => {
    const e = { count: 4, last: NOW };
    expect(usageScore(e, NOW)).toBeCloseTo(4);
    expect(usageScore(e, NOW + 30 * DAY)).toBeCloseTo(2);
    expect(usageScore(e, NOW + 60 * DAY)).toBeCloseTo(1);
  });
  it("does not grow when now is before last", () => {
    expect(usageScore({ count: 2, last: NOW }, NOW - DAY)).toBeCloseTo(2);
  });
});

describe("recordUse", () => {
  it("adds 1 for new emojis", () => {
    expect(recordUse({}, "🔥", NOW)).toEqual({ "🔥": { count: 1, last: NOW } });
  });
  it("decays the existing score before adding 1", () => {
    const s = recordUse({ "🔥": { count: 4, last: NOW } }, "🔥", NOW + 30 * DAY);
    expect(s["🔥"].count).toBeCloseTo(3);
    expect(s["🔥"].last).toBe(NOW + 30 * DAY);
  });
  it("does not mutate the input", () => {
    const store: UsageStore = { "🔥": { count: 1, last: NOW } };
    const copy = JSON.parse(JSON.stringify(store));
    const out = recordUse(store, "🔥", NOW + DAY);
    expect(store).toEqual(copy);
    expect(out).not.toBe(store);
    expect(out["🔥"]).not.toBe(store["🔥"]);
  });
  it("caps at 300 entries by dropping the lowest current scores", () => {
    let store: UsageStore = {};
    for (let i = 0; i < 300; i++) store[`e${i}`] = { count: 10 + i, last: NOW };
    store["old"] = { count: 0.5, last: NOW };
    store = recordUse(store, "new", NOW);
    expect(Object.keys(store).length).toBe(300);
    expect(store["new"]).toBeDefined();
    expect(store["old"]).toBeUndefined();
    expect(store["e0"]).toBeUndefined();
    expect(store["e299"]).toBeDefined();
  });
  it("never evicts the emoji just recorded", () => {
    const store: UsageStore = {};
    for (let i = 0; i < 300; i++) store[`e${i}`] = { count: 100, last: NOW };
    const out = recordUse(store, "new", NOW);
    expect(out["new"]).toEqual({ count: 1, last: NOW });
    expect(Object.keys(out).length).toBe(300);
  });
  it("evicts by decayed score, not raw count", () => {
    let store: UsageStore = { stale: { count: 50, last: NOW - 300 * DAY } };
    for (let i = 0; i < 299; i++) store[`e${i}`] = { count: 2, last: NOW };
    store = recordUse(store, "new", NOW);
    expect(store["stale"]).toBeUndefined();
    expect(Object.keys(store).length).toBe(300);
  });
});

describe("rankByUsage", () => {
  const items = ["a", "b", "c", "d", "e"].map((emoji) => ({ emoji }));
  it("puts used entries first by score, rest in original order", () => {
    const store: UsageStore = { d: { count: 1, last: NOW }, b: { count: 3, last: NOW } };
    expect(rankByUsage(items, store, NOW).map((x) => x.emoji)).toEqual(["b", "d", "a", "c", "e"]);
  });
  it("is stable for equal scores and returns a new array", () => {
    const store: UsageStore = { e: { count: 2, last: NOW }, c: { count: 2, last: NOW } };
    const out = rankByUsage(items, store, NOW);
    expect(out.map((x) => x.emoji)).toEqual(["c", "e", "a", "b", "d"]);
    expect(out).not.toBe(items);
    expect(items.map((x) => x.emoji)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("returns the original order for an empty store", () => {
    expect(rankByUsage(items, {}, NOW)).toEqual(items);
  });
  it("accounts for decay", () => {
    const store: UsageStore = { a: { count: 3, last: NOW - 90 * DAY }, b: { count: 1, last: NOW } };
    expect(
      rankByUsage(items, store, NOW)
        .map((x) => x.emoji)
        .slice(0, 2),
    ).toEqual(["b", "a"]);
  });
});

describe("parseUsageStore", () => {
  it("parses JSON strings and objects", () => {
    const store = { "🔥": { count: 2, last: NOW } };
    expect(parseUsageStore(JSON.stringify(store))).toEqual(store);
    expect(parseUsageStore(store)).toEqual(store);
  });
  it("returns an empty store for garbage", () => {
    for (const v of [undefined, null, 5, "", "not json", "[1,2]", "null", [], true])
      expect(parseUsageStore(v)).toEqual({});
  });
  it("drops invalid entries and keeps valid ones", () => {
    const raw = {
      ok: { count: 1.5, last: 10 },
      neg: { count: -1, last: 10 },
      nan: { count: "x", last: 10 },
      inf: { count: Infinity, last: 1 },
      nolast: { count: 1 },
      nul: null,
      str: "x",
      zero: { count: 0, last: 5 },
    };
    expect(parseUsageStore(raw)).toEqual({ ok: { count: 1.5, last: 10 } });
  });
  it("caps oversized stores at 300 entries", () => {
    const raw: Record<string, unknown> = {};
    for (let i = 0; i < 400; i++) raw[`e${i}`] = { count: i + 1, last: NOW };
    const out = parseUsageStore(raw);
    expect(Object.keys(out).length).toBe(300);
    expect(out["e399"]).toBeDefined();
    expect(out["e0"]).toBeUndefined();
  });
});
