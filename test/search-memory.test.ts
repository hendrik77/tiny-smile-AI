import { describe, expect, it } from "vitest";
import {
  FREQUENT_MAX,
  HALF_LIFE_DAYS,
  RECENT_MAX,
  clearMemory,
  emptyMemory,
  forgetSearch,
  listSearches,
  lookupMemory,
  memoryScore,
  normalizeMemoryQuery,
  parseMemory,
  recordAnswer,
  recordPick,
  replaceAnswer,
  serializeMemory,
  type MemoryEntry,
  type SearchMemory,
} from "../src/lib/search-memory";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;
const ans = (query: string, emojis = ["🎉"], model = "m1") => ({ query, emojis, model });
const entry = (query: string, over: Partial<MemoryEntry> = {}): MemoryEntry => ({
  query,
  display: query,
  emojis: ["🎉"],
  combos: [],
  model: "m1",
  score: 1,
  last: NOW,
  asks: 1,
  ...over,
});
function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

describe("constants", () => {
  it("has the specified values", () => {
    expect(RECENT_MAX).toBe(20);
    expect(FREQUENT_MAX).toBe(200);
    expect(HALF_LIFE_DAYS).toBe(30);
    expect(emptyMemory).toEqual({ recent: [], frequent: [] });
  });
});

describe("normalizeMemoryQuery", () => {
  it("lower-cases, trims and collapses whitespace", () => {
    expect(normalizeMemoryQuery("  Finally \t Friday  ")).toBe("finally friday");
  });
});

describe("memoryScore", () => {
  it("decays at 0/30/60 days", () => {
    const e = entry("a", { score: 4 });
    expect(memoryScore(e, NOW)).toBeCloseTo(4);
    expect(memoryScore(e, NOW + 30 * DAY)).toBeCloseTo(2);
    expect(memoryScore(e, NOW + 60 * DAY)).toBeCloseTo(1);
  });
  it("never grows when now is before last", () => {
    expect(memoryScore(entry("a", { score: 2 }), NOW - DAY)).toBeCloseTo(2);
  });
});

describe("recordAnswer", () => {
  it("first ask goes to recent only", () => {
    const m = recordAnswer(emptyMemory, { ...ans("Finally  Friday"), combos: [["🎉", "🍻"]] }, NOW);
    expect(m.frequent).toEqual([]);
    expect(m.recent).toEqual([
      {
        query: "finally friday",
        display: "Finally  Friday".trim(),
        emojis: ["🎉"],
        combos: [["🎉", "🍻"]],
        model: "m1",
        score: 1,
        last: NOW,
        asks: 1,
      },
    ]);
  });
  it("defaults combos to an empty list", () => {
    expect(recordAnswer(emptyMemory, ans("a"), NOW).recent[0].combos).toEqual([]);
  });
  it("second ask promotes and removes from recent", () => {
    let m = recordAnswer(emptyMemory, ans("a"), NOW);
    m = recordAnswer(m, ans("a", ["🔥"], "m2"), NOW);
    expect(m.recent).toEqual([]);
    expect(m.frequent).toHaveLength(1);
    expect(m.frequent[0]).toMatchObject({ emojis: ["🔥"], model: "m2", score: 2, asks: 2, last: NOW });
  });
  it("third ask stays frequent with a growing score", () => {
    let m = recordAnswer(emptyMemory, ans("a"), NOW);
    m = recordAnswer(m, ans("a"), NOW);
    m = recordAnswer(m, ans("a"), NOW);
    expect(m.recent).toEqual([]);
    expect(m.frequent).toHaveLength(1);
    expect(m.frequent[0].score).toBeCloseTo(3);
    expect(m.frequent[0].asks).toBe(3);
  });
  it("decays the score before adding on re-ask", () => {
    let m = recordAnswer(emptyMemory, ans("a"), NOW);
    m = recordAnswer(m, ans("a"), NOW); // 2
    m = recordAnswer(m, ans("a"), NOW + 30 * DAY); // 1 + 1
    expect(m.frequent[0].score).toBeCloseTo(2);
    expect(m.frequent[0].last).toBe(NOW + 30 * DAY);
  });
  it("decays when promoting from recent", () => {
    let m = recordAnswer(emptyMemory, ans("a"), NOW);
    m = recordAnswer(m, ans("a"), NOW + 30 * DAY);
    expect(m.frequent[0].score).toBeCloseTo(1.5);
  });
  it("same entry for different spelling, display keeps the first", () => {
    let m = recordAnswer(emptyMemory, ans("  Finally  Friday "), NOW);
    m = recordAnswer(m, ans("finally friday"), NOW + 1);
    expect(m.recent).toEqual([]);
    expect(m.frequent).toHaveLength(1);
    expect(m.frequent[0].query).toBe("finally friday");
    expect(m.frequent[0].display).toBe("Finally  Friday");
  });
  it("new searches go to the front of recent", () => {
    let m = recordAnswer(emptyMemory, ans("a"), NOW);
    m = recordAnswer(m, ans("b"), NOW + 1);
    expect(m.recent.map((e) => e.query)).toEqual(["b", "a"]);
  });
  it("caps recent by dropping the oldest", () => {
    let m: SearchMemory = emptyMemory;
    for (let i = 0; i < RECENT_MAX + 3; i++) m = recordAnswer(m, ans(`q${i}`), NOW + i);
    expect(m.recent).toHaveLength(RECENT_MAX);
    expect(lookupMemory(m, "q0")).toBeNull();
    expect(lookupMemory(m, "q2")).toBeNull();
    expect(lookupMemory(m, "q3")).not.toBeNull();
  });
  it("respects options.recentMax", () => {
    let m: SearchMemory = emptyMemory;
    for (let i = 0; i < 5; i++) m = recordAnswer(m, ans(`q${i}`), NOW + i, { recentMax: 2 });
    expect(m.recent.map((e) => e.query)).toEqual(["q4", "q3"]);
  });
  it("frequent cap evicts the lowest decayed score", () => {
    const frequent = [entry("hi", { score: 10 }), entry("low", { score: 1.5 }), entry("mid", { score: 5 })];
    let m: SearchMemory = { recent: [entry("new")], frequent };
    m = recordAnswer(m, ans("new"), NOW, { frequentMax: 3 });
    expect(m.frequent.map((e) => e.query).sort()).toEqual(["hi", "mid", "new"]);
  });
  it("uses decayed scores for eviction", () => {
    const m0: SearchMemory = {
      recent: [entry("new")],
      frequent: [entry("old", { score: 8, last: NOW - 120 * DAY }), entry("fresh", { score: 2 })],
    };
    const m = recordAnswer(m0, ans("new"), NOW, { frequentMax: 2 });
    expect(m.frequent.map((e) => e.query).sort()).toEqual(["fresh", "new"]);
  });
  it("never evicts the touched entry", () => {
    const m0: SearchMemory = {
      recent: [entry("new")],
      frequent: [entry("a", { score: 50 }), entry("b", { score: 60 })],
    };
    const m = recordAnswer(m0, ans("new"), NOW, { frequentMax: 2 });
    expect(lookupMemory(m, "new")).not.toBeNull();
    expect(m.frequent).toHaveLength(2);
  });
  it("one-off searches never evict established frequent ones", () => {
    let m: SearchMemory = {
      recent: [],
      frequent: Array.from({ length: 3 }, (_, i) => entry(`f${i}`, { score: 5, asks: 5 })),
    };
    for (let i = 0; i < 100; i++) m = recordAnswer(m, ans(`once${i}`), NOW + i, { frequentMax: 3 });
    expect(m.frequent.map((e) => e.query)).toEqual(["f0", "f1", "f2"]);
    expect(m.recent).toHaveLength(RECENT_MAX);
  });
  it("does not mutate frozen input", () => {
    const m0 = deepFreeze<SearchMemory>({ recent: [entry("a")], frequent: [entry("b", { score: 3 })] });
    const a = deepFreeze(ans("a"));
    expect(() => recordAnswer(m0, a, NOW)).not.toThrow();
    expect(() => recordAnswer(m0, ans("b"), NOW)).not.toThrow();
    expect(() => recordAnswer(m0, ans("c"), NOW)).not.toThrow();
    expect(m0.recent).toHaveLength(1);
    expect(m0.frequent[0].score).toBe(3);
  });
});

describe("recordPick", () => {
  it("adds 2 to a frequent entry after decay", () => {
    const m0: SearchMemory = { recent: [], frequent: [entry("a", { score: 4, asks: 3 })] };
    const m = recordPick(m0, "A", NOW + 30 * DAY);
    expect(m.frequent[0].score).toBeCloseTo(4);
    expect(m.frequent[0].last).toBe(NOW + 30 * DAY);
    expect(m.frequent[0].asks).toBe(3);
  });
  it("promotes from recent with +2", () => {
    const m0: SearchMemory = { recent: [entry("a")], frequent: [] };
    const m = recordPick(m0, "a", NOW);
    expect(m.recent).toEqual([]);
    expect(m.frequent[0].score).toBeCloseTo(3);
  });
  it("leaves unknown queries unchanged", () => {
    const m0: SearchMemory = { recent: [entry("a")], frequent: [] };
    expect(recordPick(m0, "zzz", NOW)).toEqual(m0);
  });
  it("does not mutate frozen input", () => {
    const m0 = deepFreeze<SearchMemory>({ recent: [entry("a")], frequent: [entry("b")] });
    expect(() => recordPick(m0, "a", NOW)).not.toThrow();
    expect(() => recordPick(m0, "b", NOW)).not.toThrow();
  });
  it("respects frequentMax when promoting", () => {
    const m0: SearchMemory = { recent: [entry("a")], frequent: [entry("b", { score: 9 }), entry("c", { score: 1 })] };
    const m = recordPick(m0, "a", NOW, { frequentMax: 2 });
    expect(m.frequent.map((e) => e.query).sort()).toEqual(["a", "b"]);
  });
});

describe("replaceAnswer", () => {
  it("replaces the answer without changing score or asks", () => {
    const m0: SearchMemory = { recent: [], frequent: [entry("a", { score: 4, asks: 3 })] };
    const m = replaceAnswer(m0, { ...ans("a", ["🔥"], "m2"), combos: [["🔥", "🔥"]] }, NOW + 5 * DAY);
    expect(m.frequent[0]).toMatchObject({
      emojis: ["🔥"],
      model: "m2",
      combos: [["🔥", "🔥"]],
      score: 4,
      asks: 3,
      last: NOW,
    });
  });
  it("works on recent entries", () => {
    const m = replaceAnswer({ recent: [entry("a")], frequent: [] }, ans("a", ["🔥"]), NOW);
    expect(m.recent[0]).toMatchObject({ emojis: ["🔥"], score: 1, asks: 1 });
  });
  it("inserts into recent when unknown", () => {
    const m = replaceAnswer(emptyMemory, ans("New One"), NOW);
    expect(m.recent).toHaveLength(1);
    expect(m.recent[0]).toMatchObject({ query: "new one", display: "New One", score: 1, asks: 1 });
  });
  it("does not mutate frozen input", () => {
    const m0 = deepFreeze<SearchMemory>({ recent: [entry("a")], frequent: [entry("b")] });
    expect(() => replaceAnswer(m0, ans("a"), NOW)).not.toThrow();
    expect(() => replaceAnswer(m0, ans("b"), NOW)).not.toThrow();
    expect(() => replaceAnswer(m0, ans("c"), NOW)).not.toThrow();
  });
});

describe("lookup, forget, clear", () => {
  const m: SearchMemory = { recent: [entry("a")], frequent: [entry("b")] };
  it("finds in either tier, normalizing", () => {
    expect(lookupMemory(m, " A ")?.query).toBe("a");
    expect(lookupMemory(m, "B")?.query).toBe("b");
    expect(lookupMemory(m, "c")).toBeNull();
  });
  it("forgets from either tier without mutating", () => {
    const f = deepFreeze({ ...m });
    expect(forgetSearch(f, "a").recent).toEqual([]);
    expect(forgetSearch(f, "B").frequent).toEqual([]);
    expect(forgetSearch(f, "a").frequent).toHaveLength(1);
  });
  it("clears everything", () => {
    expect(clearMemory()).toEqual({ recent: [], frequent: [] });
  });
});

describe("listSearches", () => {
  const m: SearchMemory = {
    frequent: [
      entry("low", { score: 2 }),
      entry("high", { score: 9 }),
      entry("tieOld", { score: 5, last: NOW - DAY }),
      entry("tieNew", { score: 5, last: NOW - DAY }),
    ],
    recent: [entry("r1", { last: NOW - 5 }), entry("r2", { last: NOW - 1 }), entry("high", { last: NOW })],
  };
  it("orders frequent by decayed score, then recent by last, without duplicates", () => {
    const names = listSearches(m, NOW).map((e) => e.query);
    expect(names).toEqual(["high", "tieOld", "tieNew", "low", "r2", "r1"].map((n) => n));
    expect(new Set(names).size).toBe(names.length);
  });
  it("breaks score ties by recency", () => {
    const t: SearchMemory = {
      recent: [],
      frequent: [entry("old", { score: 3, last: NOW - 10 }), entry("new", { score: 3, last: NOW })],
    };
    expect(listSearches(t, NOW - 10).map((e) => e.query)).toEqual(["new", "old"]);
  });
  it("uses decay for ordering", () => {
    const d: SearchMemory = {
      recent: [],
      frequent: [entry("old", { score: 8, last: NOW - 90 * DAY }), entry("fresh", { score: 2 })],
    };
    expect(listSearches(d, NOW).map((e) => e.query)).toEqual(["fresh", "old"]);
  });
  it("caps at the limit, default 16", () => {
    const big: SearchMemory = {
      recent: [],
      frequent: Array.from({ length: 30 }, (_, i) => entry(`q${i}`, { score: i + 1 })),
    };
    expect(listSearches(big, NOW)).toHaveLength(16);
    expect(listSearches(big, NOW, 3).map((e) => e.query)).toEqual(["q29", "q28", "q27"]);
  });
});

describe("parseMemory / serializeMemory", () => {
  it("round-trips", () => {
    const m: SearchMemory = { recent: [entry("a")], frequent: [entry("b", { score: 3, asks: 2 })] };
    expect(parseMemory(serializeMemory(m))).toEqual(m);
    expect(parseMemory(m)).toEqual(m);
  });
  it("returns empty on garbage", () => {
    for (const g of [undefined, null, 5, "not json", "[]", "null", [], "{}", '{"recent":5,"frequent":"x"}']) {
      expect(parseMemory(g)).toEqual(emptyMemory);
    }
  });
  it("drops malformed entries", () => {
    const good = entry("good");
    const raw = {
      recent: [
        good,
        { ...entry("x"), query: 5 },
        { ...entry("noemoji"), emojis: [] },
        { ...entry("nan"), score: Number.NaN },
        { ...entry("inf"), last: Infinity },
        { ...entry("badasks"), asks: "3" },
        null,
        "str",
      ],
      frequent: [],
    };
    expect(parseMemory(JSON.stringify(raw)).recent).toEqual([good]);
  });
  it("tolerates missing combos", () => {
    const rest: Partial<MemoryEntry> = entry("a");
    delete rest.combos;
    expect(parseMemory({ recent: [rest], frequent: [] }).recent[0].combos).toEqual([]);
  });
  it("de-duplicates by query, frequent wins", () => {
    const m = parseMemory({
      recent: [entry("a"), entry("a"), entry("r")],
      frequent: [entry("a", { score: 7 })],
    });
    expect(m.recent.map((e) => e.query)).toEqual(["r"]);
    expect(m.frequent).toHaveLength(1);
    expect(m.frequent[0].score).toBe(7);
  });
  it("enforces caps", () => {
    const raw = {
      recent: Array.from({ length: 30 }, (_, i) => entry(`r${i}`, { last: NOW + i })),
      frequent: Array.from({ length: 205 }, (_, i) => entry(`f${i}`, { score: i + 1 })),
    };
    const m = parseMemory(raw);
    expect(m.recent).toHaveLength(RECENT_MAX);
    expect(m.recent[0].query).toBe("r29");
    expect(m.frequent).toHaveLength(FREQUENT_MAX);
    expect(lookupMemory(m, "f0")).toBeNull();
    expect(lookupMemory(m, "f204")).not.toBeNull();
    const small = parseMemory(raw, { recentMax: 2, frequentMax: 3 });
    expect(small.recent).toHaveLength(2);
    expect(small.frequent).toHaveLength(3);
  });
});
