import { LocalStorage, getSelectedText } from "@raycast/api";
import React, { useEffect, useRef, useState } from "react";
import { findEmoji } from "../lib/emoji-data";
import { clearMemory, emptyMemory, parseMemory, serializeMemory, type SearchMemory } from "../lib/search-memory";
import { addToTray, clearTray, emptyTray, removeLast, TRAY_MAX, type Tray } from "../lib/tray";
import { parseUsageStore, recordUse, type UsageStore } from "../lib/usage";
import type { EmojiEntry, RouteOverride } from "../lib/types";

export const RECENTS_KEY = "recent-emojis";
export const MAX_RECENTS = 32;
export const MODEL_KEY = "model-override";
export const USAGE_KEY = "emoji-usage";
export const MEMORY_KEY = "search-memory";
/** Longer selections are not used, so a passage of a document never goes to the AI provider. */
export const MAX_SELECTION_LENGTH = 300;

/** Debounces typed text; an emptied field resets at once, so a retype never revives the old value. */
export function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  if (value === "" && debounced !== "") setDebounced("");
  useEffect(() => {
    if (value === "") return;
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return value === "" ? "" : debounced;
}

/** Recents and usage are written only after the stored value was read; earlier changes are merged in then. */
export function useRecents() {
  const [recents, setRecents] = useState<EmojiEntry[]>([]);
  const loaded = useRef(false);
  const settled = useRef(false);
  /** Remembered before the stored list was read, newest first. */
  const pending = useRef<EmojiEntry[]>([]);
  useEffect(() => {
    const finish = (raw: string | undefined) => {
      if (settled.current) return;
      let stored: EmojiEntry[] = [];
      try {
        const list: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(list)) {
          stored = list.map((e) => (typeof e === "string" ? findEmoji(e) : undefined)).filter(Boolean) as EmojiEntry[];
        }
      } catch {
        // A garbled list is simply forgotten.
      }
      loaded.current = true;
      const queued = pending.current;
      pending.current = [];
      if (queued.length === 0) return setRecents(stored);
      const seen = new Set<string>();
      const merged = [...queued, ...stored].filter((e) => !seen.has(e.emoji) && !!seen.add(e.emoji));
      const next = merged.slice(0, MAX_RECENTS);
      setRecents(next);
      LocalStorage.setItem(RECENTS_KEY, JSON.stringify(next.map((e) => e.emoji)));
    };
    LocalStorage.getItem<string>(RECENTS_KEY).then(finish, () => finish(undefined));
  }, []);

  function remember(entry: EmojiEntry) {
    if (!loaded.current) pending.current = [entry, ...pending.current.filter((e) => e.emoji !== entry.emoji)];
    setRecents((current) => {
      const next = [entry, ...current.filter((e) => e.emoji !== entry.emoji)].slice(0, MAX_RECENTS);
      if (loaded.current) LocalStorage.setItem(RECENTS_KEY, JSON.stringify(next.map((e) => e.emoji)));
      return next;
    });
  }

  function clear() {
    // Clearing before the read finished must not be undone by it.
    settled.current = true;
    pending.current = [];
    setRecents([]);
    LocalStorage.removeItem(RECENTS_KEY);
  }

  return { recents, remember, clear };
}

export function useUsage() {
  const [usage, setUsage] = useState<UsageStore>({});
  const loaded = useRef(false);
  /** Uses before the stored counts were read: [emoji, time], oldest first. */
  const pending = useRef<[string, number][]>([]);
  useEffect(() => {
    const finish = (raw: string | undefined) => {
      let store = parseUsageStore(raw);
      const queued = pending.current;
      pending.current = [];
      loaded.current = true;
      for (const [emoji, at] of queued) store = recordUse(store, emoji, at);
      setUsage(store);
      if (queued.length > 0) LocalStorage.setItem(USAGE_KEY, JSON.stringify(store));
    };
    LocalStorage.getItem<string>(USAGE_KEY).then(finish, () => finish(undefined));
  }, []);

  function record(emoji: string) {
    const at = Date.now();
    if (!loaded.current) pending.current.push([emoji, at]);
    setUsage((current) => {
      const next = recordUse(current, emoji, at);
      if (loaded.current) LocalStorage.setItem(USAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  return { usage, record };
}

/**
 * Search memory, loaded from LocalStorage and saved on every change. Disabled: never read, never
 * written, always empty. `update` composes with earlier updates of the same tick and is ignored
 * until the stored memory is loaded (so a late load can never overwrite a change).
 */
export function useSearchMemory(enabled: boolean) {
  const [state, setState] = useState<{ ready: boolean; memory: SearchMemory }>({
    ready: !enabled,
    memory: emptyMemory,
  });
  const latest = useRef(state);
  const commit = (next: { ready: boolean; memory: SearchMemory }) => {
    latest.current = next;
    setState(next);
  };
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    LocalStorage.getItem<string>(MEMORY_KEY)
      .then((raw) => {
        if (!cancelled) commit({ ready: true, memory: parseMemory(raw) });
      })
      .catch(() => {
        if (!cancelled) commit({ ready: true, memory: emptyMemory });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  function update(change: (memory: SearchMemory) => SearchMemory) {
    if (!enabled || !latest.current.ready) return;
    const memory = change(latest.current.memory);
    if (memory === latest.current.memory) return;
    commit({ ready: true, memory });
    LocalStorage.setItem(MEMORY_KEY, serializeMemory(memory));
  }

  function clear() {
    if (!enabled) return;
    commit({ ready: true, memory: clearMemory() });
    LocalStorage.removeItem(MEMORY_KEY);
  }

  /** The latest memory, also inside callbacks that outlive a render. */
  const current = () => latest.current.memory;
  return { ready: state.ready, memory: state.memory, current, update, clear };
}

export function systemLocale(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || undefined;
  } catch {
    return undefined;
  }
}

export type SelectionState =
  { status: "pending" } | { status: "used"; text: string } | { status: "unused"; reason: string };

/** Reads the selection of the frontmost app in the background, once; never toasts. */
export function useLaunchSelection(enabled: boolean, hasTyped: React.RefObject<boolean>): SelectionState {
  const [state, setState] = useState<SelectionState>({ status: "pending" });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getSelectedText()
      .then((raw) => {
        if (cancelled) return;
        const text = (raw ?? "").trim();
        if (hasTyped.current) setState({ status: "unused", reason: "typed before the selection was read" });
        else if (!text) setState({ status: "unused", reason: "selection is blank" });
        else if (text.length > MAX_SELECTION_LENGTH)
          setState({ status: "unused", reason: `selection is longer than ${MAX_SELECTION_LENGTH} characters` });
        else setState({ status: "used", text });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: "unused", reason: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, hasTyped]);
  return state;
}

export function parseOverride(raw: string | undefined): RouteOverride | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.kind === "api" && typeof value.connection === "string" && typeof value.model === "string") {
      return { kind: "api", connection: value.connection, model: value.model };
    }
    if (
      value?.kind === "cli" &&
      (value.tool === "claude" || value.tool === "codex") &&
      typeof value.model === "string"
    ) {
      return { kind: "cli", tool: value.tool, model: value.model };
    }
  } catch {
    // A garbled choice falls back to Tinycast's default.
  }
  return null;
}

/** The model picked for emoji search; `null` follows Tinycast's default. `ready` is false until loaded. */
export function useModelOverride() {
  const [state, setState] = useState<{
    ready: boolean;
    override: RouteOverride | null;
  }>({
    ready: false,
    override: null,
  });
  useEffect(() => {
    LocalStorage.getItem<string>(MODEL_KEY)
      // A choice made before the stored one was read wins.
      .then((raw) => setState((s) => (s.ready ? s : { ready: true, override: parseOverride(raw) })))
      .catch(() => setState((s) => (s.ready ? s : { ready: true, override: null })));
  }, []);

  function choose(override: RouteOverride | null) {
    setState({ ready: true, override });
    if (override) LocalStorage.setItem(MODEL_KEY, JSON.stringify(override));
    else LocalStorage.removeItem(MODEL_KEY);
  }

  return { ...state, choose };
}

/** The multi-pick selection. Not persisted; holds dataset emojis, so the skin tone is applied when shown. */
export function useTray() {
  const [tray, setTray] = useState<Tray>(emptyTray());
  const current = useRef(tray);
  const update = (next: Tray) => {
    current.current = next;
    setTray(next);
  };

  const entries = tray.items.map((e) => findEmoji(e)).filter(Boolean) as EmojiEntry[];

  /** Adds the emojis in order; returns false when the tray filled up before all of them fit. */
  function add(emojis: string[]): boolean {
    let next = current.current;
    let fitted = true;
    for (const emoji of emojis) {
      const grown = addToTray(next, emoji);
      if (grown === next) fitted = false;
      next = grown;
    }
    update(next);
    return fitted;
  }

  return {
    entries,
    isFull: tray.items.length >= TRAY_MAX,
    add,
    removeLast: () => update(removeLast(current.current)),
    clear: () => update(clearTray()),
  };
}

export type TrayState = ReturnType<typeof useTray>;
