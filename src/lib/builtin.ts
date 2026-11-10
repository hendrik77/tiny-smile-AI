import data from "../data/builtin.json";
import { findEmoji } from "./emoji-data";
import { fold } from "./locale-keywords";
import type { EmojiEntry } from "./types";

// Hand-written answers for very common searches: { q: canonical query, a: aliases, e: 12 emojis, l: "de" for German }.
interface Row {
  q: string;
  a?: string[];
  l?: string;
  e: string[];
}

const rows = data as Row[];

/** Number of built-in answers. */
export const BUILTIN_COUNT = rows.length;

/** Lower-case, umlauts folded, only letters, digits and single spaces: "Glückwunsch!" and "glueckwunsch" meet below. */
export function normalizeBuiltinQuery(q: string): string {
  return fold(q)
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** "gluckwunsch" and "glueckwunsch" are the same word once ae/oe/ue are collapsed. */
function collapse(s: string): string {
  return s.replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u");
}

let index: Map<string, EmojiEntry[]> | undefined;

function buildIndex(): Map<string, EmojiEntry[]> {
  const map = new Map<string, EmojiEntry[]>();
  const collapsed: [string, EmojiEntry[]][] = [];
  for (const row of rows) {
    const entries = row.e.map((e) => findEmoji(e)).filter((e): e is EmojiEntry => e !== undefined);
    for (const key of [row.q, ...(row.a ?? [])]) {
      const n = normalizeBuiltinQuery(key);
      if (!n) continue;
      if (!map.has(n)) map.set(n, entries);
      collapsed.push([collapse(n), entries]);
    }
  }
  // Collapsed variants never shadow a real key.
  for (const [k, entries] of collapsed) if (!map.has(k)) map.set(k, entries);
  return map;
}

/** The built-in answer for a query (exact match on the normalized query or an alias), or null. */
export function lookupBuiltin(query: string, limit = 12): EmojiEntry[] | null {
  const n = normalizeBuiltinQuery(query);
  if (!n) return null;
  index ??= buildIndex();
  const hit = index.get(n) ?? index.get(collapse(n));
  return hit ? hit.slice(0, Math.max(0, limit)) : null;
}
