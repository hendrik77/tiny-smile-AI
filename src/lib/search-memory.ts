/**
 * Search memory: a recent tier (first ask) and a frequent tier (second ask on), with time-decayed
 * scores. Pure and immutable: `now` is always a parameter and every function returns new objects.
 */
export interface MemoryEntry {
  /** Normalized key. */
  query: string;
  /** As first typed, trimmed. */
  display: string;
  emojis: string[];
  combos: string[][];
  model: string;
  /** Decayed use count as of `last`. */
  score: number;
  last: number;
  asks: number;
}

export interface SearchMemory {
  recent: MemoryEntry[];
  frequent: MemoryEntry[];
}

export interface MemoryOptions {
  recentMax?: number;
  frequentMax?: number;
}

export interface MemoryAnswer {
  query: string;
  emojis: string[];
  combos?: string[][];
  model: string;
}

export const RECENT_MAX = 20;
export const FREQUENT_MAX = 200;
export const HALF_LIFE_DAYS = 30;
const HALF_LIFE_MS = HALF_LIFE_DAYS * 86_400_000;

export const emptyMemory: SearchMemory = Object.freeze({
  recent: Object.freeze([]) as unknown as MemoryEntry[],
  frequent: Object.freeze([]) as unknown as MemoryEntry[],
}) as SearchMemory;

export function normalizeMemoryQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

export function memoryScore(entry: { score: number; last: number }, now: number): number {
  const age = Math.max(0, now - entry.last);
  return entry.score * Math.pow(0.5, age / HALF_LIFE_MS);
}

const copyEntry = (e: MemoryEntry): MemoryEntry => ({
  ...e,
  emojis: [...e.emojis],
  combos: e.combos.map((c) => [...c]),
});

const limits = (o?: MemoryOptions) => ({
  recentMax: Math.max(0, o?.recentMax ?? RECENT_MAX),
  frequentMax: Math.max(0, o?.frequentMax ?? FREQUENT_MAX),
});

function capRecent(recent: MemoryEntry[], max: number): MemoryEntry[] {
  if (recent.length <= max) return recent;
  return recent
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.last - a.e.last || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.e);
}

function capFrequent(frequent: MemoryEntry[], max: number, now: number, keep?: string): MemoryEntry[] {
  if (frequent.length <= max) return frequent;
  const kept = frequent
    .map((e, i) => ({ e, i, s: e.query === keep ? Infinity : memoryScore(e, now) }))
    .sort((a, b) => b.s - a.s || b.e.last - a.e.last || a.i - b.i)
    .slice(0, max);
  return kept.sort((a, b) => a.i - b.i).map((x) => x.e);
}

function build(display: string, a: MemoryAnswer, key: string, now: number): MemoryEntry {
  return {
    query: key,
    display,
    emojis: [...a.emojis],
    combos: (a.combos ?? []).map((c) => [...c]),
    model: a.model,
    score: 1,
    last: now,
    asks: 1,
  };
}

/** Moves a touched entry (existing or new) into place and applies the caps. */
function touch(
  memory: SearchMemory,
  answer: MemoryAnswer | null,
  query: string,
  now: number,
  bonus: number,
  countAsk: boolean,
  options?: MemoryOptions,
): SearchMemory {
  const key = normalizeMemoryQuery(query);
  const { recentMax, frequentMax } = limits(options);
  const freqIdx = memory.frequent.findIndex((e) => e.query === key);
  const recIdx = memory.recent.findIndex((e) => e.query === key);
  const apply = (e: MemoryEntry): MemoryEntry => {
    const next = copyEntry(e);
    if (answer) {
      next.emojis = [...answer.emojis];
      next.combos = (answer.combos ?? []).map((c) => [...c]);
      next.model = answer.model;
    }
    next.score = memoryScore(e, now) + bonus;
    next.asks = e.asks + (countAsk ? 1 : 0);
    next.last = now;
    return next;
  };
  if (freqIdx >= 0) {
    const frequent = memory.frequent.map((e, i) => (i === freqIdx ? apply(e) : copyEntry(e)));
    return { recent: memory.recent.map(copyEntry), frequent };
  }
  if (recIdx >= 0) {
    const promoted = apply(memory.recent[recIdx]);
    const frequent = capFrequent([...memory.frequent.map(copyEntry), promoted], frequentMax, now, key);
    return { recent: memory.recent.filter((_, i) => i !== recIdx).map(copyEntry), frequent };
  }
  if (!answer) return { recent: memory.recent.map(copyEntry), frequent: memory.frequent.map(copyEntry) };
  const fresh = build(query.trim(), answer, key, now);
  return {
    recent: capRecent([fresh, ...memory.recent.map(copyEntry)], recentMax),
    frequent: memory.frequent.map(copyEntry),
  };
}

/** A search was answered: counts once; the second ask promotes it to the frequent tier. */
export function recordAnswer(
  memory: SearchMemory,
  answer: MemoryAnswer,
  now: number,
  options?: MemoryOptions,
): SearchMemory {
  return touch(memory, answer, answer.query, now, 1, true, options);
}

/** An emoji was picked from this search: counts double. Unknown queries are ignored. */
export function recordPick(memory: SearchMemory, query: string, now: number, options?: MemoryOptions): SearchMemory {
  return touch(memory, null, query, now, 2, false, options);
}

/** Refresh: replaces the stored answer, keeping score, asks and last. Unknown queries enter recent. */
export function replaceAnswer(
  memory: SearchMemory,
  answer: MemoryAnswer,
  now: number,
  options?: MemoryOptions,
): SearchMemory {
  const key = normalizeMemoryQuery(answer.query);
  const swap = (e: MemoryEntry): MemoryEntry =>
    e.query === key
      ? { ...e, emojis: [...answer.emojis], combos: (answer.combos ?? []).map((c) => [...c]), model: answer.model }
      : copyEntry(e);
  if (lookupMemory(memory, key)) {
    return { recent: memory.recent.map(swap), frequent: memory.frequent.map(swap) };
  }
  const { recentMax } = limits(options);
  return {
    recent: capRecent([build(answer.query.trim(), answer, key, now), ...memory.recent.map(copyEntry)], recentMax),
    frequent: memory.frequent.map(copyEntry),
  };
}

export function lookupMemory(memory: SearchMemory, query: string): MemoryEntry | null {
  const key = normalizeMemoryQuery(query);
  return memory.frequent.find((e) => e.query === key) ?? memory.recent.find((e) => e.query === key) ?? null;
}

export function forgetSearch(memory: SearchMemory, query: string): SearchMemory {
  const key = normalizeMemoryQuery(query);
  return {
    recent: memory.recent.filter((e) => e.query !== key).map(copyEntry),
    frequent: memory.frequent.filter((e) => e.query !== key).map(copyEntry),
  };
}

export function clearMemory(): SearchMemory {
  return { recent: [], frequent: [] };
}

/** Frequent first (decayed score, then recency), then recent by recency; no duplicates. */
export function listSearches(memory: SearchMemory, now: number, limit = 16): MemoryEntry[] {
  const freq = memory.frequent
    .map((e, i) => ({ e, i, s: memoryScore(e, now) }))
    .sort((a, b) => b.s - a.s || b.e.last - a.e.last || a.i - b.i)
    .map((x) => x.e);
  const rec = memory.recent
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.last - a.e.last || a.i - b.i)
    .map((x) => x.e);
  const seen = new Set<string>();
  const out: MemoryEntry[] = [];
  for (const e of [...freq, ...rec]) {
    if (seen.has(e.query)) continue;
    seen.add(e.query);
    out.push(copyEntry(e));
    if (out.length >= limit) break;
  }
  return out;
}

function parseEntry(v: unknown): MemoryEntry | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.query !== "string" || !o.query) return null;
  if (!Array.isArray(o.emojis) || o.emojis.length === 0 || !o.emojis.every((x) => typeof x === "string")) return null;
  const { score, last, asks } = o;
  if (typeof score !== "number" || typeof last !== "number" || typeof asks !== "number") return null;
  if (!Number.isFinite(score) || !Number.isFinite(last) || !Number.isFinite(asks)) return null;
  const combos = Array.isArray(o.combos)
    ? o.combos.filter((c): c is string[] => Array.isArray(c) && c.length > 0 && c.every((x) => typeof x === "string"))
    : [];
  return {
    query: o.query,
    display: typeof o.display === "string" && o.display ? o.display : o.query,
    emojis: [...(o.emojis as string[])],
    combos: combos.map((c) => [...c]),
    model: typeof o.model === "string" ? o.model : "",
    score,
    last,
    asks,
  };
}

export function parseMemory(raw: unknown, options?: MemoryOptions): SearchMemory {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return clearMemory();
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return clearMemory();
  const { recentMax, frequentMax } = limits(options);
  const o = value as Record<string, unknown>;
  const list = (x: unknown): MemoryEntry[] =>
    Array.isArray(x) ? x.map(parseEntry).filter((e): e is MemoryEntry => e !== null) : [];
  const seen = new Set<string>();
  const dedupe = (entries: MemoryEntry[]) =>
    entries.filter((e) => {
      if (seen.has(e.query)) return false;
      seen.add(e.query);
      return true;
    });
  const frequent = dedupe(list(o.frequent));
  const recent = dedupe(list(o.recent));
  const ref = Math.max(0, ...frequent.map((e) => e.last));
  recent.sort((a, b) => b.last - a.last);
  return { recent: capRecent(recent, recentMax), frequent: capFrequent(frequent, frequentMax, ref) };
}

export function serializeMemory(memory: SearchMemory): string {
  return JSON.stringify({ recent: memory.recent, frequent: memory.frequent });
}
