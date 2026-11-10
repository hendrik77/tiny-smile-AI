import { LocalStorage, getSelectedText } from "@raycast/api";
import React, { useEffect, useRef, useState } from "react";
import { findEmoji } from "../lib/emoji-data";
import { addToTray, clearTray, emptyTray, removeLast, TRAY_MAX, type Tray } from "../lib/tray";
import { parseUsageStore, recordUse, type UsageStore } from "../lib/usage";
import type { EmojiEntry, RouteOverride } from "../lib/types";

export const RECENTS_KEY = "recent-emojis";
export const MAX_RECENTS = 32;
export const MODEL_KEY = "model-override";
export const USAGE_KEY = "emoji-usage";
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

export function useRecents() {
  const [recents, setRecents] = useState<EmojiEntry[]>([]);
  useEffect(() => {
    LocalStorage.getItem<string>(RECENTS_KEY).then((raw) => {
      try {
        const list: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(list)) {
          setRecents(
            list.map((e) => (typeof e === "string" ? findEmoji(e) : undefined)).filter(Boolean) as EmojiEntry[],
          );
        }
      } catch {
        // A garbled list is simply forgotten.
      }
    });
  }, []);

  function remember(entry: EmojiEntry) {
    setRecents((current) => {
      const next = [entry, ...current.filter((e) => e.emoji !== entry.emoji)].slice(0, MAX_RECENTS);
      LocalStorage.setItem(RECENTS_KEY, JSON.stringify(next.map((e) => e.emoji)));
      return next;
    });
  }

  function clear() {
    setRecents([]);
    LocalStorage.removeItem(RECENTS_KEY);
  }

  return { recents, remember, clear };
}

export function useUsage() {
  const [usage, setUsage] = useState<UsageStore>({});
  useEffect(() => {
    LocalStorage.getItem<string>(USAGE_KEY)
      .then((raw) => setUsage((current) => ({ ...parseUsageStore(raw), ...current })))
      .catch(() => {});
  }, []);

  function record(emoji: string) {
    setUsage((current) => {
      const next = recordUse(current, emoji, Date.now());
      LocalStorage.setItem(USAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  return { usage, record };
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
      .then((raw) => setState({ ready: true, override: parseOverride(raw) }))
      .catch(() => setState({ ready: true, override: null }));
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
