// Builds src/data/keywords-de.json from emojibase-data (German) for the emojis in our dataset.
// Usage: node scripts/build-keywords.mjs (also exports buildKeywordsDe for the freshness test)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const readJson = (spec) => JSON.parse(readFileSync(require.resolve(spec), "utf8"));
const strip = (s) => s.replace(/\uFE0F/g, "");

/** Returns the object that gets serialized: emoji -> German keywords. */
export function buildKeywordsDe() {
  const ours = Object.keys(readJson("unicode-emoji-json/data-by-emoji.json"));
  const german = readJson("emojibase-data/de/compact.json");
  const exact = new Map();
  const stripped = new Map();
  for (const e of german) {
    if (!exact.has(e.unicode)) exact.set(e.unicode, e);
    if (!stripped.has(strip(e.unicode))) stripped.set(strip(e.unicode), e);
  }
  const out = {};
  for (const emoji of ours) {
    const hit = exact.get(emoji) ?? stripped.get(strip(emoji));
    if (!hit) continue;
    const words = [];
    for (const w of [hit.label, ...(hit.tags ?? [])]) {
      const lw = String(w).toLowerCase().trim();
      if (lw && !words.includes(lw)) words.push(lw);
    }
    if (words.length === 0) continue;
    out[emoji] = words;
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = buildKeywordsDe();
  const file = resolve(root, "src/data/keywords-de.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out) + "\n");
  console.log(`German keywords for ${Object.keys(out).length} emojis -> ${file}`);
}
