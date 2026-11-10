import { describe, expect, it } from "vitest";
import data from "emojibase-data/en/data.json";
import { EMOJIS, findEmoji } from "../src/lib/emoji-data";
import { SKIN_TONE_EXCLUDED, applySkinTone, parseSkinTone } from "../src/lib/skin-tone";
import type { SkinTone } from "../src/lib/types";

const TONES: SkinTone[] = ["light", "medium-light", "medium", "medium-dark", "dark"];
const MODIFIERS = ["🏻", "🏼", "🏽", "🏾", "🏿"];
const byEmoji = (e: string) => EMOJIS.find((x) => x.emoji === e)!;
const countModifiers = (s: string) => [...s].filter((c) => MODIFIERS.includes(c)).length;

describe("EmojiEntry.skinTone", () => {
  it("comes from skin_tone_support", () => {
    expect(byEmoji("👍").skinTone).toBe(true);
    expect(byEmoji("✌️").skinTone).toBe(true);
    expect(byEmoji("🔥").skinTone).toBe(false);
    expect(byEmoji("😀").skinTone).toBe(false);
    expect(EMOJIS.filter((e) => e.skinTone).length).toBeGreaterThan(300);
  });
});

describe("parseSkinTone", () => {
  it("accepts valid values and falls back to none", () => {
    for (const t of ["none", ...TONES]) expect(parseSkinTone(t)).toBe(t);
    for (const v of [undefined, null, 3, "", "Dark", "brown", {}, []]) expect(parseSkinTone(v)).toBe("none");
  });
});

describe("applySkinTone", () => {
  it("returns the emoji unchanged for none or unsupported entries", () => {
    expect(applySkinTone(byEmoji("👍"), "none")).toBe("👍");
    expect(applySkinTone(byEmoji("🔥"), "dark")).toBe("🔥");
  });
  it("matches known-correct sequences", () => {
    const cases: [string, SkinTone, string][] = [
      ["👍", "medium", "👍🏽"],
      ["👍", "light", "👍🏻"],
      ["👍", "dark", "👍🏿"],
      ["✌️", "medium", "✌🏽"],
      ["🕵️‍♂️", "medium", "🕵🏽‍♂️"],
      ["🧑‍💻", "medium", "🧑🏽‍💻"],
      ["👩‍🚀", "medium-light", "👩🏼‍🚀"],
      ["🏌️‍♀️", "medium-dark", "🏌🏾‍♀️"],
      ["🤝", "dark", "🤝🏿"],
      ["👫", "light", "👫🏻"],
      ["🚶‍♀️‍➡️", "medium", "🚶🏽‍♀️‍➡️"],
    ];
    for (const [emoji, tone, expected] of cases) {
      expect(byEmoji(emoji).skinTone, emoji).toBe(true);
      expect(applySkinTone(byEmoji(emoji), tone), emoji).toBe(expected);
    }
  });
  it("leaves the documented two-person emojis unchanged", () => {
    expect(SKIN_TONE_EXCLUDED.length).toBe(7);
    for (const emoji of SKIN_TONE_EXCLUDED) {
      expect(byEmoji(emoji).skinTone, emoji).toBe(true);
      expect(applySkinTone(byEmoji(emoji), "medium")).toBe(emoji);
    }
  });
  it("produces one modifier and resolves back for every supported entry and tone", () => {
    for (const e of EMOJIS.filter((x) => x.skinTone && !SKIN_TONE_EXCLUDED.includes(x.emoji))) {
      for (const tone of TONES) {
        const r = applySkinTone(e, tone);
        expect(countModifiers(r), `${e.name} ${tone}`).toBe(1);
        expect(findEmoji(r)?.emoji, `${e.name} ${tone}`).toBe(e.emoji);
      }
    }
  });
  it("matches the emojibase RGI skin variants for every supported entry", () => {
    const toneNumber: Record<string, number> = { light: 1, "medium-light": 2, medium: 3, "medium-dark": 4, dark: 5 };
    const norm = (s: string) => s.replace(/️/g, "");
    type Raw = { emoji: string; skins?: { tone: number | number[]; emoji: string }[] };
    const raw = data as Raw[];
    for (const e of EMOJIS.filter((x) => x.skinTone && !SKIN_TONE_EXCLUDED.includes(x.emoji))) {
      const m = raw.find((r) => norm(r.emoji) === norm(e.emoji))!;
      for (const tone of TONES) {
        const expected = m.skins!.find((s) => s.tone === toneNumber[tone])!.emoji;
        expect(applySkinTone(e, tone), `${e.name} ${tone}`).toBe(expected);
      }
    }
  });
});
