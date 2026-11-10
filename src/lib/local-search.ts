import { EMOJIS, findEmoji } from "./emoji-data";
import { fold, localKeywords, type Language } from "./locale-keywords";
import type { EmojiEntry } from "./types";

const splitWords = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

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

interface Folded {
  entry: EmojiEntry;
  label: string;
  labelWords: string[];
  words: string[];
}

let foldedDe: Folded[] | undefined;

function foldedIndex(language: Language): Folded[] {
  const kw = localKeywords(language);
  if (!kw) return [];
  foldedDe ??= EMOJIS.flatMap((entry) => {
    const k = kw.get(entry.emoji);
    if (!k) return [];
    return [
      {
        entry,
        label: fold(k.label),
        labelWords: splitWords(fold(k.label)),
        words: k.words.flatMap((w) => splitWords(fold(w))),
      },
    ];
  });
  return foldedDe;
}

function rankLocal(item: Folded, query: string, words: string[]): number {
  if (item.label === query) return 0;
  if (item.label.startsWith(query)) return 1;
  const inLabel = (w: string) => item.labelWords.some((lw) => lw.startsWith(w));
  if (words.every((w) => inLabel(w) || item.label.includes(w))) return 2;
  if (words.every((w) => inLabel(w) || item.label.includes(w) || item.words.some((kw) => kw.startsWith(w)))) return 3;
  return -1;
}

/** Folded query plus a variant with ae/oe/ue collapsed to a/o/u ("froehlich" -> "frohlich"). */
function queryVariants(q: string): string[] {
  const folded = fold(q);
  const collapsed = folded.replace(/([aou])e/g, "$1");
  return collapsed === folded ? [folded] : [folded, collapsed];
}

export function searchLocal(query: string, limit = 60, language: Language = "en"): EmojiEntry[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q || limit <= 0) return [];
  const direct = findEmoji(query);
  if (direct) return [direct];
  const words = splitWords(q);
  if (words.length === 0) return [];
  const best = new Map<EmojiEntry, number>();
  for (const item of INDEX) {
    const r = rank(item, q, words);
    if (r >= 0) best.set(item.entry, r);
  }
  for (const variant of queryVariants(q)) {
    const vWords = splitWords(variant);
    if (vWords.length === 0) continue;
    for (const item of foldedIndex(language)) {
      const r = rankLocal(item, variant, vWords);
      if (r >= 0 && r < (best.get(item.entry) ?? 4)) best.set(item.entry, r);
    }
  }
  const buckets: EmojiEntry[][] = [[], [], [], []];
  for (const entry of EMOJIS) {
    const r = best.get(entry);
    if (r !== undefined) buckets[r].push(entry);
  }
  return buckets.flat().slice(0, limit);
}
