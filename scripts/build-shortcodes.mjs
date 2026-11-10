// Builds src/data/shortcodes.json: emoji (as in our dataset) -> [github code, slack code],
// from emojibase-data. An empty string means "no code in that set".
// Usage: node scripts/build-shortcodes.mjs (also exports buildShortcodes for the freshness test)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const first = (v) => (Array.isArray(v) ? v[0] : v) ?? "";

const hex = (s) =>
  Array.from(s)
    .map((c) => c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0"))
    .join("-");

function lookup(table, emoji) {
  const full = hex(emoji);
  const bare = hex(emoji.replace(/️/g, ""));
  return first(table[full] ?? table[bare]);
}

/** Returns an object in dataset order: { emoji: [github, slack] } for emojis with at least one code. */
export function buildShortcodes() {
  const read = (n) => JSON.parse(readFileSync(require.resolve(`emojibase-data/en/shortcodes/${n}.json`), "utf8"));
  const github = read("github");
  const slack = read("iamcal");
  const rows = JSON.parse(readFileSync(resolve(root, "src/data/emoji.json"), "utf8"));
  const out = {};
  for (const [emoji] of rows) {
    const g = lookup(github, emoji);
    const s = lookup(slack, emoji);
    if (g || s) out[emoji] = [g, s];
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = buildShortcodes();
  const total = JSON.parse(readFileSync(resolve(root, "src/data/emoji.json"), "utf8")).length;
  const values = Object.values(out);
  const file = resolve(root, "src/data/shortcodes.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out) + "\n");
  console.log(
    `Wrote ${values.length}/${total} emojis to src/data/shortcodes.json ` +
      `(github ${values.filter((v) => v[0]).length}, slack ${values.filter((v) => v[1]).length})`,
  );
}
