// Builds src/data/emoji.json from unicode-emoji-json and emojilib, so the extension bundle
// contains its emoji data and needs no third-party package at runtime.
// Usage: node scripts/build-emoji-data.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const data = JSON.parse(readFileSync(require.resolve("unicode-emoji-json/data-by-emoji.json"), "utf8"));
const emojilib = require("emojilib");

const out = Object.entries(data).map(([emoji, raw]) => {
  const keywords = [];
  for (const k of emojilib[emoji] ?? []) {
    const kw = k.toLowerCase();
    if (kw !== raw.slug && !keywords.includes(kw)) keywords.push(kw);
  }
  // [emoji, name, slug, group, keywords, skinTone]
  return [emoji, raw.name, raw.slug, raw.group, keywords, raw.skin_tone_support === true ? 1 : 0];
});

const file = resolve(root, "src/data/emoji.json");
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out) + "\n");
console.log(`Wrote ${out.length} emojis to src/data/emoji.json`);
