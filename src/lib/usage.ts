/** Decayed use counts per emoji. `count` is a score that halves every 30 days since `last`. */
export interface UsageStore {
  [emoji: string]: { count: number; last: number };
}

const HALF_LIFE_MS = 30 * 86_400_000;
export const MAX_USAGE_ENTRIES = 300;

export function usageScore(entry: { count: number; last: number }, now: number): number {
  const age = Math.max(0, now - entry.last);
  return entry.count * Math.pow(0.5, age / HALF_LIFE_MS);
}

function cap(store: UsageStore, now: number, keepKey?: string): UsageStore {
  const keys = Object.keys(store);
  if (keys.length <= MAX_USAGE_ENTRIES) return store;
  const keep = keys
    .map((k, i) => ({ k, i, s: k === keepKey ? Infinity : usageScore(store[k], now) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, MAX_USAGE_ENTRIES);
  const out: UsageStore = {};
  for (const { k } of keep) out[k] = store[k];
  return out;
}

export function recordUse(store: UsageStore, emoji: string, now: number): UsageStore {
  const next: UsageStore = {};
  for (const [k, v] of Object.entries(store)) next[k] = { count: v.count, last: v.last };
  const prev = store[emoji];
  next[emoji] = { count: (prev ? usageScore(prev, now) : 0) + 1, last: now };
  return cap(next, now, emoji);
}

/** Used entries first (score descending), everything else in original order. Stable, never mutates. */
export function rankByUsage<T extends { emoji: string }>(entries: T[], store: UsageStore, now: number): T[] {
  const scored = entries.map((e, i) => {
    const u = store[e.emoji];
    return { e, i, s: u ? usageScore(u, now) : 0 };
  });
  const used = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i);
  const rest = scored.filter((x) => !(x.s > 0));
  return [...used, ...rest].map((x) => x.e);
}

export function parseUsageStore(raw: unknown): UsageStore {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const store: UsageStore = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const { count, last } = v as { count?: unknown; last?: unknown };
    if (typeof count !== "number" || typeof last !== "number") continue;
    if (!Number.isFinite(count) || !Number.isFinite(last) || count <= 0) continue;
    store[k] = { count, last };
  }
  return cap(store, Math.max(0, ...Object.values(store).map((v) => v.last)));
}
