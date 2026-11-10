// Builds src/data/keywords-de.json from emojibase-data (German) for the emojis in our dataset.
// Usage: node scripts/build-keywords.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const readJson = (spec) => JSON.parse(readFileSync(require.resolve(spec), "utf8"));

const ours = Object.keys(readJson("unicode-emoji-json/data-by-emoji.json"));
const german = readJson("emojibase-data/de/compact.json");

const strip = (s) => s.replace(/️/g, "");
const exact = new Map();
const stripped = new Map();
for (const e of german) {
  if (!exact.has(e.unicode)) exact.set(e.unicode, e);
  if (!stripped.has(strip(e.unicode))) stripped.set(strip(e.unicode), e);
}

const out = {};
let count = 0;
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
  count++;
}

const file = resolve(root, "src/data/keywords-de.json");
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out) + "\n");
console.log(`German keywords for ${count} of ${ours.length} emojis -> ${file}`);
