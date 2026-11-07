import {
  AI,
  Action,
  ActionPanel,
  Cache,
  Grid,
  Icon,
  LocalStorage,
  Toast,
  environment,
  getPreferenceValues,
  showToast,
} from "@raycast/api";
import { existsSync } from "fs";
import { homedir } from "os";
import { useEffect, useMemo, useRef, useState } from "react";
import { findEmoji } from "./lib/emoji-data";
import { execFileAsync } from "./lib/exec";
import { searchLocal } from "./lib/local-search";
import { buildSections } from "./lib/sections";
import { NoRouteError, createSuggester, type SuggesterDeps } from "./lib/suggest";
import type { EmojiEntry, FetchFn } from "./lib/types";

const DEBOUNCE_MS = 450;
const MIN_QUERY_LENGTH = 2;
const RECENTS_KEY = "recent-emojis";
const MAX_RECENTS = 32;

interface AIState {
  query: string;
  emojis: EmojiEntry[];
  label?: string;
  error?: string;
}

function canUseRaycastAI(): boolean {
  try {
    return environment.canAccess(AI);
  } catch {
    return false;
  }
}

function makeDeps(): SuggesterDeps {
  return {
    exec: execFileAsync,
    fetch: ((url, init) => fetch(url, init)) as FetchFn,
    home: homedir(),
    exists: (path) => existsSync(path),
    cache: new Cache({ namespace: "ai-suggestions" }),
    raycastAsk: canUseRaycastAI() ? (prompt) => AI.ask(prompt, { creativity: "low" }) : undefined,
  };
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function useRecents() {
  const [recents, setRecents] = useState<EmojiEntry[]>([]);
  useEffect(() => {
    LocalStorage.getItem<string>(RECENTS_KEY).then((raw) => {
      try {
        const list: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(list)) {
          setRecents(list.map((e) => (typeof e === "string" ? findEmoji(e) : undefined)).filter(Boolean) as EmojiEntry[]);
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

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const bundleId = preferences.channel || "com.tinycast.app";
  const count = Number(preferences.resultCount) || 24;
  const pasteFirst = preferences.primaryAction !== "copy";

  const suggester = useRef<ReturnType<typeof createSuggester>>(null);
  if (!suggester.current) suggester.current = createSuggester(makeDeps());

  const [searchText, setSearchText] = useState("");
  const debouncedQuery = useDebounced(searchText.trim(), DEBOUNCE_MS);
  const [ai, setAI] = useState<AIState>({ query: "", emojis: [] });
  const [loading, setLoading] = useState(false);
  const { recents, remember, clear } = useRecents();

  useEffect(() => {
    if (debouncedQuery.length < MIN_QUERY_LENGTH) {
      setAI({ query: debouncedQuery, emojis: [] });
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    suggester.current!(debouncedQuery, { bundleId, count })
      .then((result) => {
        if (!cancelled) setAI({ query: debouncedQuery, emojis: result.emojis, label: result.routeLabel });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setAI({ query: debouncedQuery, emojis: [], error: message });
        showToast({
          style: Toast.Style.Failure,
          title: error instanceof NoRouteError ? "No AI model available" : "AI emoji search failed",
          message,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, bundleId, count]);

  const query = searchText.trim();
  const local = useMemo(() => searchLocal(query, 60), [query]);
  // Only show AI picks that belong to what is typed now, never a previous query's answer.
  const aiForQuery = ai.query === query ? ai.emojis : [];
  const sections = buildSections({
    query,
    ai: aiForQuery,
    local,
    recents,
    aiTitle: ai.label ? `AI Suggestions · ${ai.label}` : "AI Suggestions",
  });
  const waitingForAI = query.length >= MIN_QUERY_LENGTH && (loading || debouncedQuery !== query);

  return (
    <Grid
      columns={8}
      inset={Grid.Inset.Small}
      filtering={false}
      isLoading={waitingForAI}
      searchBarPlaceholder="Describe a feeling, situation or thing…"
      onSearchTextChange={setSearchText}
    >
      {sections.length === 0 ? (
        <Grid.EmptyView
          icon="🔎"
          title={
            !query
              ? "Describe what you want to express"
              : waitingForAI
                ? "Asking your AI for fitting emojis…"
                : "No emoji found"
          }
          description={
            !query
              ? "e.g. “finally friday”, “sorry for your loss”, “deploy went fine”"
              : ai.query === query && ai.error
                ? ai.error
                : undefined
          }
        />
      ) : (
        sections.map((section) => (
          <Grid.Section key={section.id} title={section.title}>
            {section.emojis.map((entry, index) => (
              <Grid.Item
                key={`${section.id}-${entry.emoji}`}
                content={entry.emoji}
                title={section.id === "ai" ? `${index + 1}. ${entry.name}` : entry.name}
                keywords={entry.keywords}
                actions={
                  <EmojiActions
                    entry={entry}
                    pasteFirst={pasteFirst}
                    onUse={() => remember(entry)}
                    onClearRecents={recents.length > 0 ? clear : undefined}
                  />
                }
              />
            ))}
          </Grid.Section>
        ))
      )}
    </Grid>
  );
}

function EmojiActions(props: {
  entry: EmojiEntry;
  pasteFirst: boolean;
  onUse: () => void;
  onClearRecents?: () => void;
}) {
  const { entry, pasteFirst, onUse, onClearRecents } = props;
  const paste = <Action.Paste key="paste" title="Paste Emoji" content={entry.emoji} onPaste={onUse} />;
  const copy = <Action.CopyToClipboard key="copy" title="Copy Emoji" content={entry.emoji} onCopy={onUse} />;
  return (
    <ActionPanel title={entry.name}>
      <ActionPanel.Section>{pasteFirst ? [paste, copy] : [copy, paste]}</ActionPanel.Section>
      <ActionPanel.Section>
        <Action.CopyToClipboard
          title="Copy Name"
          content={entry.name}
          shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
        />
        <Action.CopyToClipboard
          title="Copy Shortcode"
          content={`:${entry.slug}:`}
          shortcut={{ modifiers: ["cmd", "opt"], key: "c" }}
        />
        {onClearRecents ? (
          <Action title="Clear Recently Used" icon={Icon.Trash} style={Action.Style.Destructive} onAction={onClearRecents} />
        ) : null}
      </ActionPanel.Section>
    </ActionPanel>
  );
}
