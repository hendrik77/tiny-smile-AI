import { describe, expect, it } from "vitest";
import { EMOJIS, findEmoji, getEmojiBySlugOrName, normalizeEmoji } from "../src/lib/emoji-data";

describe("EMOJIS", () => {
  it("has the full dataset in order", () => {
    expect(EMOJIS.length).toBeGreaterThan(1800);
    expect(EMOJIS[0].emoji).toBe("😀");
    expect(EMOJIS[0].name).toBe("grinning face");
  });
  it("keywords are lower-case, unique and exclude slug", () => {
    for (const e of EMOJIS) {
      expect(e.keywords).not.toContain(e.slug);
      expect(new Set(e.keywords).size).toBe(e.keywords.length);
      for (const k of e.keywords) expect(k).toBe(k.toLowerCase());
    }
    expect(findEmoji("❤️")!.keywords).toContain("love");
  });
});

describe("normalizeEmoji", () => {
  it("strips variation selectors, skin tones and whitespace", () => {
    expect(normalizeEmoji("❤️")).toBe("❤");
    expect(normalizeEmoji("☺︎")).toBe("☺");
    expect(normalizeEmoji("👍🏽")).toBe("👍");
    expect(normalizeEmoji("  🔥 ")).toBe("🔥");
  });
});

describe("findEmoji", () => {
  it("finds exact and normalized", () => {
    expect(findEmoji("🔥")!.name).toBe("fire");
    expect(findEmoji("❤")!.emoji).toBe("❤️");
    expect(findEmoji("👍🏽")!.emoji).toBe("👍");
    expect(findEmoji("👨‍👩‍👧")!.name).toContain("family");
  });
  it("returns undefined for unknown", () => {
    expect(findEmoji("abc")).toBeUndefined();
    expect(findEmoji("")).toBeUndefined();
  });
});

describe("getEmojiBySlugOrName", () => {
  it("accepts slug, name and colon forms", () => {
    for (const s of ["red_heart", "red heart", ":red_heart:", "RED Heart", " :Red_Heart: "]) {
      expect(getEmojiBySlugOrName(s)!.emoji).toBe("❤️");
    }
    expect(getEmojiBySlugOrName("nope_nothing")).toBeUndefined();
  });
});
