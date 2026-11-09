import {
  AI,
  Action,
  ActionPanel,
  Cache,
  Clipboard,
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
import React, { useEffect, useMemo, useRef, useState } from "react";
import { findEmoji } from "./lib/emoji-data";
import { execFileAsync } from "./lib/exec";
import { searchLocal } from "./lib/local-search";
import { buildSections } from "./lib/sections";
import {
  NoRouteError,
  createSuggester,
  type SuggesterDeps,
} from "./lib/suggest";
import type {
  EmojiEntry,
  FetchFn,
  RouteChoice,
  RouteOverride,
} from "./lib/types";
import { version as extensionVersion } from "./lib/version";
import { ModelPicker } from "./model-picker";

const DEBOUNCE_MS = 450;
const MIN_QUERY_LENGTH = 2;
const RECENTS_KEY = "recent-emojis";
const MAX_RECENTS = 32;
const MODEL_KEY = "model-override";

interface AIState {
  query: string;
  modelKey?: string;
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
    raycastAsk: canUseRaycastAI()
      ? (prompt) => AI.ask(prompt, { creativity: "low" })
      : undefined,
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
          setRecents(
            list
              .map((e) => (typeof e === "string" ? findEmoji(e) : undefined))
              .filter(Boolean) as EmojiEntry[],
          );
        }
      } catch {
        // A garbled list is simply forgotten.
      }
    });
  }, []);

  function remember(entry: EmojiEntry) {
    setRecents((current) => {
      const next = [
        entry,
        ...current.filter((e) => e.emoji !== entry.emoji),
      ].slice(0, MAX_RECENTS);
      LocalStorage.setItem(
        RECENTS_KEY,
        JSON.stringify(next.map((e) => e.emoji)),
      );
      return next;
    });
  }

  function clear() {
    setRecents([]);
    LocalStorage.removeItem(RECENTS_KEY);
  }

  return { recents, remember, clear };
}

function parseOverride(raw: string | undefined): RouteOverride | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (
      value?.kind === "api" &&
      typeof value.connection === "string" &&
      typeof value.model === "string"
    ) {
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
function useModelOverride() {
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

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const bundleId = preferences.channel || "com.tinycast.app";
  const count = Number(preferences.resultCount) || 24;
  const pasteFirst = preferences.primaryAction !== "copy";
  const minimizeThinking = preferences.minimizeThinking !== false;

  const suggester = useRef<ReturnType<typeof createSuggester>>(null);
  if (!suggester.current) suggester.current = createSuggester(makeDeps());

  const [searchText, setSearchText] = useState("");
  const debouncedQuery = useDebounced(searchText.trim(), DEBOUNCE_MS);
  const [ai, setAI] = useState<AIState>({ query: "", emojis: [] });
  const [loading, setLoading] = useState(false);
  const { recents, remember, clear } = useRecents();
  const model = useModelOverride();
  const modelKey = JSON.stringify(model.override);

  const loadChoices = (): Promise<RouteChoice[]> =>
    suggester.current?.listRoutes
      ? suggester.current.listRoutes(bundleId)
      : Promise.resolve([]);
  const lastError = useRef<string | undefined>(undefined);
  const copyDiagnostics = async () => {
    const report = await suggester.current!.diagnose({
      bundleId,
      override: model.override,
      minimizeThinking,
      count,
      extensionVersion,
      lastError: lastError.current,
    });
    await Clipboard.copy(report);
    await showToast({
      style: Toast.Style.Success,
      title: "Diagnostics copied",
      message: "Paste them into a GitHub issue",
    });
  };
  const chooseModel = (
    <>
      <Action.Push
        title="Choose AI Model…"
        icon={Icon.Stars}
        shortcut={{ modifiers: ["cmd"], key: "m" }}
        target={
          <ModelPicker
            loadChoices={loadChoices}
            current={model.override}
            onChoose={model.choose}
          />
        }
      />
      <Action
        title="Copy Diagnostics"
        icon={Icon.Bug}
        shortcut={{ modifiers: ["cmd", "shift"], key: "d" }}
        onAction={copyDiagnostics}
      />
    </>
  );

  useEffect(() => {
    if (!model.ready) return;
    if (debouncedQuery.length < MIN_QUERY_LENGTH) {
      setAI({ query: debouncedQuery, emojis: [] });
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    suggester.current!(debouncedQuery, {
      bundleId,
      count,
      override: model.override,
      minimizeThinking,
    })
      .then((result) => {
        if (cancelled) return;
        lastError.current = undefined;
        setAI({
          query: debouncedQuery,
          modelKey,
          emojis: result.emojis,
          label: result.routeLabel,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        lastError.current = message;
        setAI({ query: debouncedQuery, modelKey, emojis: [], error: message });
        showToast({
          style: Toast.Style.Failure,
          title:
            error instanceof NoRouteError
              ? "No AI model available"
              : "AI emoji search failed",
          message,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    debouncedQuery,
    bundleId,
    count,
    modelKey,
    model.ready,
    minimizeThinking,
  ]);

  const query = searchText.trim();
  const local = useMemo(() => searchLocal(query, 60), [query]);
  // Only show AI picks that belong to what is typed now, never a previous query's answer.
  const aiIsCurrent = ai.query === query && ai.modelKey === modelKey;
  const aiForQuery = aiIsCurrent ? ai.emojis : [];
  const sections = buildSections({
    query,
    ai: aiForQuery,
    local,
    recents,
    aiTitle: ai.label ? `AI Suggestions · ${ai.label}` : "AI Suggestions",
  });
  const waitingForAI =
    query.length >= MIN_QUERY_LENGTH && (loading || !aiIsCurrent);

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
          actions={<ActionPanel>{chooseModel}</ActionPanel>}
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
              : aiIsCurrent && ai.error
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
                title={
                  section.id === "ai"
                    ? `${index + 1}. ${entry.name}`
                    : entry.name
                }
                keywords={entry.keywords}
                actions={
                  <EmojiActions
                    entry={entry}
                    pasteFirst={pasteFirst}
                    onUse={() => remember(entry)}
                    onClearRecents={recents.length > 0 ? clear : undefined}
                    chooseModel={chooseModel}
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
  chooseModel: React.ReactNode;
}) {
  const { entry, pasteFirst, onUse, onClearRecents, chooseModel } = props;
  const paste = (
    <Action.Paste
      key="paste"
      title="Paste Emoji"
      content={entry.emoji}
      onPaste={onUse}
    />
  );
  const copy = (
    <Action.CopyToClipboard
      key="copy"
      title="Copy Emoji"
      content={entry.emoji}
      onCopy={onUse}
    />
  );
  return (
    <ActionPanel title={entry.name}>
      <ActionPanel.Section>
        {pasteFirst ? [paste, copy] : [copy, paste]}
      </ActionPanel.Section>
      <ActionPanel.Section>{chooseModel}</ActionPanel.Section>
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
          <Action
            title="Clear Recently Used"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            onAction={onClearRecents}
          />
        ) : null}
      </ActionPanel.Section>
    </ActionPanel>
  );
}
