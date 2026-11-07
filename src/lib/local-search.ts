import { EMOJIS, findEmoji } from "./emoji-data";
import type { EmojiEntry } from "./types";

const splitWords = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

interface Indexed {
  entry: EmojiEntry;
  name: string;
  nameWords: string[];
  keywordWords: string[];
}

const INDEX: Indexed[] = EMOJIS.map((entry) => ({
  entry,
  name: entry.name.toLowerCase(),
  nameWords: splitWords(entry.name),
  keywordWords: entry.keywords.flatMap(splitWords),
}));

/** Lower is better; -1 = no match. */
function rank(item: Indexed, query: string, words: string[]): number {
  if (item.name === query) return 0;
  if (item.name.startsWith(query)) return 1;
  const inName = (w: string) => item.nameWords.some((nw) => nw.startsWith(w));
  if (words.every((w) => inName(w) || item.name.includes(w))) return 2;
  if (words.every((w) => inName(w) || item.name.includes(w) || item.keywordWords.some((kw) => kw.startsWith(w)))) {
    return 3;
  }
  return -1;
}

export function searchLocal(query: string, limit = 60): EmojiEntry[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q || limit <= 0) return [];
  const direct = findEmoji(query);
  if (direct) return [direct];
  const words = splitWords(q);
  if (words.length === 0) return [];
  const buckets: EmojiEntry[][] = [[], [], [], []];
  for (const item of INDEX) {
    const r = rank(item, q, words);
    if (r >= 0) buckets[r].push(item.entry);
  }
  return buckets.flat().slice(0, limit);
}
