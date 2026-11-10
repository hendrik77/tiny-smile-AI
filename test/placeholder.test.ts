import { describe, expect, it } from "vitest";
import { DEFAULT_PLACEHOLDER, searchPlaceholder, shortenQuery } from "../src/lib/placeholder";

const base = { typed: "", initialQuery: "", source: null, hasRecents: false } as const;

describe("shortenQuery", () => {
  it("collapses whitespace and cuts at the limit with an ellipsis", () => {
    expect(shortenQuery("a  b\n c", 30)).toBe("a b c");
    const out = shortenQuery("x".repeat(60), 30);
    expect(out.length).toBe(30);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("searchPlaceholder", () => {
  it("uses the default when nothing is special", () => {
    expect(searchPlaceholder(base)).toBe(DEFAULT_PLACEHOLDER);
    expect(DEFAULT_PLACEHOLDER).toBe("Describe a feeling, situation or thing…");
  });
  it("describes an argument query", () => {
    expect(searchPlaceholder({ ...base, initialQuery: "finally friday", source: "argument" })).toBe(
      "Emojis for “finally friday” — type to search something else",
    );
  });
  it("describes a selection query", () => {
    expect(searchPlaceholder({ ...base, initialQuery: "finally friday", source: "selection" })).toBe(
      "Emojis for selected text “finally friday” — type to search something else",
    );
  });
  it("shortens a long query to 30 characters", () => {
    const out = searchPlaceholder({ ...base, initialQuery: "y".repeat(100), source: "selection" });
    expect(out).toContain(`“${"y".repeat(29)}…”`);
  });
  it("shows the recents hint for an empty field", () => {
    expect(searchPlaceholder({ ...base, hasRecents: true })).toBe(
      "Recently used — describe a feeling, situation or thing…",
    );
  });
  it("falls back to the default once the user typed", () => {
    expect(
      searchPlaceholder({ typed: "party", initialQuery: "finally friday", source: "argument", hasRecents: true }),
    ).toBe(DEFAULT_PLACEHOLDER);
  });
  it("prefers the initial query over recents", () => {
    expect(searchPlaceholder({ ...base, initialQuery: "hi", source: "argument", hasRecents: true })).toContain(
      "Emojis for “hi”",
    );
  });
});
