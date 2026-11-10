import { describe, expect, it } from "vitest";
import { EMOJIS } from "../src/lib/emoji-data";
import { formatEmoji, formatSequence, parseInsertFormat, shortcodeFor } from "../src/lib/insert-format";

const find = (e: string) => {
  const x = EMOJIS.find((m) => m.emoji === e);
  if (!x) throw new Error(e);
  return x;
};
// Every emoji has a Slack code; some newer ones have no GitHub code.
const noCode = EMOJIS.find((e) => shortcodeFor(e, "github") === null);

describe("insert format", () => {
  it("parses", () => {
    expect(parseInsertFormat("github")).toBe("github");
    expect(parseInsertFormat("slack")).toBe("slack");
    expect(parseInsertFormat("emoji")).toBe("emoji");
    expect(parseInsertFormat("x")).toBe("emoji");
    expect(parseInsertFormat(undefined)).toBe("emoji");
  });

  it("looks up shortcodes", () => {
    expect(shortcodeFor(find("🎉"), "github")).toBe("tada");
    expect(shortcodeFor(find("🎉"), "slack")).toBe("tada");
    expect(shortcodeFor(find("👍"), "github")).toBe("+1");
    expect(shortcodeFor(find("👍"), "slack")).toBe("+1");
  });

  it("formats", () => {
    expect(formatEmoji(find("🎉"), "emoji", "none")).toBe("🎉");
    expect(formatEmoji(find("🎉"), "github", "none")).toBe(":tada:");
    expect(formatEmoji(find("👍"), "slack", "dark")).toBe(":+1:");
    expect(formatEmoji(find("👍"), "emoji", "dark")).toBe("👍🏿");
  });

  it("falls back to the emoji when there is no code", () => {
    expect(noCode).toBeDefined();
    expect(formatEmoji(noCode!, "github", "none")).toBe(noCode!.emoji);
  });

  it("joins sequences", () => {
    const es = [find("🎉"), find("👍")];
    expect(formatSequence(es, "emoji", "none")).toBe("🎉👍");
    expect(formatSequence(es, "github", "none")).toBe(":tada: :+1:");
    expect(formatSequence([], "slack", "none")).toBe("");
  });
});
