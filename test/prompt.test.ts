import { describe, expect, it } from "vitest";
import { buildEmojiPrompt } from "../src/lib/prompt";

describe("buildEmojiPrompt", () => {
  it("system prompt carries the contract", () => {
    const { system } = buildEmojiPrompt("fire", 12);
    expect(system).toMatch(/emoji expert/i);
    expect(system).toMatch(/JSON array/);
    expect(system).toContain("12");
    expect(system).toMatch(/skin/i);
    expect(system).toMatch(/slang/i);
  });
  it("user message has trimmed delimited query", () => {
    const { user } = buildEmojiPrompt("  pizza party  ", 5);
    expect(user).toContain("<query>pizza party</query>");
  });
  it("caps query at 500 chars", () => {
    const { user } = buildEmojiPrompt("a".repeat(900), 5);
    expect(user).toContain("a".repeat(500));
    expect(user).not.toContain("a".repeat(501));
  });
  it("clamps count", () => {
    expect(buildEmojiPrompt("x", 0).system).toContain("exactly 1 ");
    expect(buildEmojiPrompt("x", 1000).system).toContain("exactly 100 ");
    expect(buildEmojiPrompt("x", 7.9).system).toContain("exactly 7 ");
    expect(buildEmojiPrompt("x", NaN).system).toContain("exactly 1 ");
  });
});
