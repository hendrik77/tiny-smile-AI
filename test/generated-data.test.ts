import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEmojiData } from "../scripts/build-emoji-data.mjs";
import { buildKeywordsDe } from "../scripts/build-keywords.mjs";

const committed = (name: string): unknown => JSON.parse(readFileSync(resolve(__dirname, "../src/data", name), "utf8"));

describe("generated data", () => {
  it("src/data/emoji.json is current (run `npm run build:data`)", () => {
    expect(committed("emoji.json")).toEqual(buildEmojiData());
  });

  it("src/data/keywords-de.json is current (run `npm run build:data`)", () => {
    expect(committed("keywords-de.json")).toEqual(buildKeywordsDe());
  });
});
