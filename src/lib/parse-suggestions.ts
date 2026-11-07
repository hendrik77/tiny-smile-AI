import { findEmoji, getEmojiBySlugOrName } from "./emoji-data";
import type { EmojiEntry } from "./types";

/** Find index of the `]` matching the `[` at `start`, respecting JSON strings. -1 if none. */
function matchingBracket(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return i;
  }
  return -1;
}

/** All top-level parseable JSON arrays in the text, in order. */
function findArrays(text: string): unknown[][] {
  const found: unknown[][] = [];
  let i = text.indexOf("[");
  while (i !== -1) {
    const end = matchingBracket(text, i);
    let next = i + 1;
    if (end !== -1) {
      try {
        const v = JSON.parse(text.slice(i, end + 1));
        if (Array.isArray(v)) {
          found.push(v);
          next = end + 1;
        }
      } catch {
        // not JSON, keep scanning
      }
    }
    i = text.indexOf("[", next);
  }
  return found;
}

function resolveItem(item: unknown): EmojiEntry | undefined {
  if (typeof item === "string") return findEmoji(item) ?? getEmojiBySlugOrName(item);
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    for (const key of ["emoji", "character", "char", "name", "slug"]) {
      if (typeof o[key] === "string") {
        const r = resolveItem(o[key]);
        if (r) return r;
      }
    }
  }
  return undefined;
}

function dedupe(candidates: Iterable<EmojiEntry | undefined>, limit: number): EmojiEntry[] {
  const out: EmojiEntry[] = [];
  const seen = new Set<EmojiEntry>();
  for (const e of candidates) {
    if (out.length >= limit) break;
    if (e && !seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

function* graphemes(text: string): Iterable<string> {
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg) for (const s of new Seg(undefined, { granularity: "grapheme" }).segment(text)) yield s.segment;
  else yield* Array.from(text);
}

export function parseSuggestions(text: string, limit: number): EmojiEntry[] {
  if (limit <= 0 || !text) return [];
  const arrays = findArrays(text);
  for (let i = arrays.length - 1; i >= 0; i--) {
    const result = dedupe(arrays[i].map(resolveItem), limit);
    if (result.length > 0) return result;
  }
  const scanned: (EmojiEntry | undefined)[] = [];
  for (const g of graphemes(text)) if (!/^[\x00-\x7f]*$/.test(g)) scanned.push(findEmoji(g));
  return dedupe(scanned, limit);
}
