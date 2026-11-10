import { describe, expect, it } from "vitest";
import { buildSections } from "../src/lib/sections";
import { findEmoji } from "../src/lib/emoji-data";

const e = (s: string) => findEmoji(s)!;

describe("buildSections", () => {
  it("shows recents for an empty query", () => {
    const s = buildSections({ query: " ", ai: [], local: [], recents: [e("🔥"), e("🎉")] });
    expect(s).toEqual([{ id: "recent", title: "Recently Used", emojis: [e("🔥"), e("🎉")] }]);
  });

  it("shows nothing for an empty query without recents", () => {
    expect(buildSections({ query: "", ai: [], local: [], recents: [] })).toEqual([]);
  });

  it("shows AI suggestions first and name matches without duplicates", () => {
    const s = buildSections({
      query: "fire",
      ai: [e("🔥"), e("🚒")],
      local: [e("🔥"), e("🧯"), e("🚒"), e("🎆")],
      recents: [e("🎉")],
      aiTitle: "AI Suggestions · Claude",
    });
    expect(s.map((x) => x.id)).toEqual(["ai", "local"]);
    expect(s[0]).toEqual({ id: "ai", title: "AI Suggestions · Claude", emojis: [e("🔥"), e("🚒")] });
    expect(s[1].emojis).toEqual([e("🧯"), e("🎆")]);
    expect(s[1].title).toBe("Matching Names");
  });

  it("omits empty sections", () => {
    const s = buildSections({ query: "zzz", ai: [], local: [], recents: [] });
    expect(s).toEqual([]);
    const only = buildSections({ query: "x", ai: [e("❌")], local: [e("❌")], recents: [] });
    expect(only.map((x) => x.id)).toEqual(["ai"]);
  });

  it("caps name matches", () => {
    const local = [e("😀"), e("😃"), e("😄"), e("😁")];
    const s = buildSections({ query: "x", ai: [], local, recents: [], localLimit: 2 });
    expect(s[0].emojis).toHaveLength(2);
  });
});

describe("buildSections combos", () => {
  const combo = [e("🎉"), e("🥳")];
  it("puts combos right after the AI tiles", () => {
    const s = buildSections({ query: "party", ai: [e("🔥")], local: [e("🚒")], recents: [], combos: [combo] });
    expect(s.map((x) => x.id)).toEqual(["ai", "combos", "local"]);
    expect(s[1]).toEqual({ id: "combos", title: "Combinations", emojis: [], combos: [combo] });
  });
  it("shows combos without AI tiles, never for an empty query", () => {
    expect(buildSections({ query: "party", ai: [], local: [], recents: [], combos: [combo] }).map((x) => x.id)).toEqual(
      ["combos"],
    );
    expect(buildSections({ query: "", ai: [], local: [], recents: [], combos: [combo] })).toEqual([]);
  });
});

describe("buildSections searches", () => {
  const tile = (query: string, emoji: string) => ({ query, display: query, emoji: e(emoji) });
  it("puts search tiles after the recents on the empty screen", () => {
    const searches = [tile("party", "🎉"), tile("thanks", "🙏")];
    const s = buildSections({ query: "", ai: [], local: [], recents: [e("🔥")], searches });
    expect(s.map((x) => x.id)).toEqual(["recent", "searches"]);
    expect(s[1]).toEqual({ id: "searches", title: "Searches", emojis: [], searches });
  });
  it("shows only the searches without recents", () => {
    expect(buildSections({ query: "", ai: [], local: [], recents: [], searches: [tile("a b", "🎉")] })).toHaveLength(1);
  });
  it("never shows them while there is a query", () => {
    const s = buildSections({ query: "x", ai: [], local: [], recents: [], searches: [tile("party", "🎉")] });
    expect(s).toEqual([]);
  });
});
