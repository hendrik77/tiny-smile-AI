import data from "unicode-emoji-json/data-by-emoji.json";
import emojilib from "emojilib";
import type { EmojiEntry } from "./types";

type RawEntry = { name: string; slug: string; group: string; skin_tone_support?: boolean };

export const EMOJIS: EmojiEntry[] = Object.entries(data as Record<string, RawEntry>).map(([emoji, raw]) => {
  const keywords: string[] = [];
  for (const k of emojilib[emoji] ?? []) {
    const kw = k.toLowerCase();
    if (kw !== raw.slug && !keywords.includes(kw)) keywords.push(kw);
  }
  return {
    emoji,
    name: raw.name,
    slug: raw.slug,
    group: raw.group,
    keywords,
    skinTone: raw.skin_tone_support === true,
  };
});

/** Strip variation selectors and skin tone modifiers, and trim, for comparison purposes. */
export function normalizeEmoji(s: string): string {
  return s.replace(/[︎️]|\u{1F3FB}|\u{1F3FC}|\u{1F3FD}|\u{1F3FE}|\u{1F3FF}/gu, "").trim();
}

const exactMap = new Map<string, EmojiEntry>();
const normalizedMap = new Map<string, EmojiEntry>();
const nameMap = new Map<string, EmojiEntry>();

function nameKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

for (const e of EMOJIS) {
  exactMap.set(e.emoji, e);
  const n = normalizeEmoji(e.emoji);
  if (n && !normalizedMap.has(n)) normalizedMap.set(n, e);
  for (const k of [nameKey(e.slug), nameKey(e.name)]) if (k && !nameMap.has(k)) nameMap.set(k, e);
}

export function findEmoji(s: string): EmojiEntry | undefined {
  const exact = exactMap.get(s) ?? exactMap.get(s.trim());
  if (exact) return exact;
  const n = normalizeEmoji(s);
  return n ? normalizedMap.get(n) : undefined;
}

export function getEmojiBySlugOrName(s: string): EmojiEntry | undefined {
  const k = nameKey(s);
  return k ? nameMap.get(k) : undefined;
}
