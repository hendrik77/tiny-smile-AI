import { describe, expect, it } from "vitest";
import { parseAnswer, parseSuggestions } from "../src/lib/parse-suggestions";

const em = (t: string, l = 50) => parseSuggestions(t, l).map((e) => e.emoji);

describe("parseSuggestions", () => {
  it("plain array", () => {
    expect(em('["🔥","🚀","🎉"]')).toEqual(["🔥", "🚀", "🎉"]);
  });
  it("fenced json", () => {
    expect(em('```json\n["🔥", "🚀"]\n```')).toEqual(["🔥", "🚀"]);
  });
  it("prose + array + trailing text", () => {
    expect(em('Sure! Here you go: ["🔥","🎉"] Hope that helps [x]')).toEqual(["🔥", "🎉"]);
  });
  it("prefers last array", () => {
    expect(em('["🐶"] actually: ["🐱","🐭"]')).toEqual(["🐱", "🐭"]);
  });
  it("objects with emoji field", () => {
    expect(em('[{"emoji":"🔥","reason":"hot"},{"emoji":"🚀"}]')).toEqual(["🔥", "🚀"]);
  });
  it("slugs and names", () => {
    expect(em('["red_heart", ":fire:", "rocket", "Party Popper"]')).toEqual(["❤️", "🔥", "🚀", "🎉"]);
  });
  it("variation selectors and skin tones", () => {
    expect(em('["❤","👍🏽"]')).toEqual(["❤️", "👍"]);
  });
  it("ZWJ sequences", () => {
    expect(em('["👨‍👩‍👧"]')).toEqual(["👨‍👩‍👧"]);
  });
  it("drops unknowns and non-strings", () => {
    expect(em('["🔥", "zzz not an emoji", 5, null, "🚀"]')).toEqual(["🔥", "🚀"]);
  });
  it("de-duplicates incl. normalized dupes", () => {
    expect(em('["❤️","❤","🔥","🔥","👍","👍🏽"]')).toEqual(["❤️", "🔥", "👍"]);
  });
  it("caps at limit", () => {
    expect(em('["🔥","🚀","🎉"]', 2)).toEqual(["🔥", "🚀"]);
    expect(parseSuggestions('["🔥"]', 0)).toEqual([]);
  });
  it("falls back to scanning text", () => {
    expect(em("Try 🔥 and 🚀, also 👍🏽 and 🎉!")).toEqual(["🔥", "🚀", "👍", "🎉"]);
  });
  it("falls back when array is invalid JSON", () => {
    expect(em("[🔥, 🚀]")).toEqual(["🔥", "🚀"]);
  });
  it("garbage -> []", () => {
    expect(em("")).toEqual([]);
    expect(em("no emoji here 123 #*")).toEqual([]);
    expect(em("[[[ ]]] {")).toEqual([]);
  });
  it("brackets inside strings don't confuse", () => {
    expect(em('Note [1]: ["🔥","🚀"]')).toEqual(["🔥", "🚀"]);
  });
});

describe("parseAnswer", () => {
  const ans = (t: string, l = 50) => {
    const r = parseAnswer(t, l);
    return { emojis: r.emojis.map((e) => e.emoji), combos: r.combos.map((c) => c.map((e) => e.emoji)) };
  };
  it("object", () => {
    expect(ans('{"emojis":["🔥","🚀"],"combos":[["🎉","🥳"],["🔥","💯","🚀"]]}')).toEqual({
      emojis: ["🔥", "🚀"],
      combos: [
        ["🎉", "🥳"],
        ["🔥", "💯", "🚀"],
      ],
    });
  });
  it("fenced", () => {
    expect(ans('```json\n{"emojis":["🔥"],"combos":[["🎉","🥳"]]}\n```').combos).toEqual([["🎉", "🥳"]]);
  });
  it("prose around, last object wins", () => {
    const t = 'Hm {"emojis":["🐶"]} better: {"emojis":["🐱"],"combos":[["🎉","🥳"]]} done {x}';
    expect(ans(t)).toEqual({ emojis: ["🐱"], combos: [["🎉", "🥳"]] });
  });
  it("plain array falls back", () => {
    expect(ans('["🔥","🚀"]')).toEqual({ emojis: ["🔥", "🚀"], combos: [] });
  });
  it("object without combos", () => {
    expect(ans('{"emojis":["🔥"]}')).toEqual({ emojis: ["🔥"], combos: [] });
  });
  it("drops combos with unresolvable, too short or too long", () => {
    const t =
      '{"emojis":["🔥"],"combos":[["🎉","qqxxv not an emoji"],["🎉"],["🎉","🥳","🍾","🔥","🚀"],["🎉","🥳","🍾","🔥"],"nope",5]}';
    expect(ans(t).combos).toEqual([["🎉", "🥳", "🍾", "🔥"]]);
  });
  it("string combo is split by grapheme", () => {
    expect(ans('{"emojis":["🔥"],"combos":["🎉🥳🍾","👨‍👩‍👧❤️"]}').combos).toEqual([
      ["🎉", "🥳", "🍾"],
      ["👨‍👩‍👧", "❤️"],
    ]);
  });
  it("max 3 combos and duplicates dropped", () => {
    const t = '{"emojis":["🔥"],"combos":[["🎉","🥳"],["🎉","🥳"],["🔥","🚀"],["🐶","🐱"],["🍕","🍺"]]}';
    expect(ans(t).combos).toEqual([
      ["🎉", "🥳"],
      ["🔥", "🚀"],
      ["🐶", "🐱"],
    ]);
  });
  it("respects the emoji limit", () => {
    expect(ans('{"emojis":["🔥","🚀","🎉"]}', 2).emojis).toEqual(["🔥", "🚀"]);
  });
  it("garbage gives nothing", () => {
    expect(ans("no emoji here")).toEqual({ emojis: [], combos: [] });
    expect(ans("")).toEqual({ emojis: [], combos: [] });
    expect(ans('{"emojis": [')).toEqual({ emojis: [], combos: [] });
  });
});
