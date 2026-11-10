import {
  AI,
  Action,
  Cache,
  Clipboard,
  Grid,
  Icon,
  Toast,
  environment,
  getPreferenceValues,
  showToast,
} from "@raycast/api";
import { existsSync } from "fs";
import { homedir } from "os";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ComboActions, EmojiActions, EmptyActions, SearchActions, type ActionContext } from "./grid/actions";
import {
  MAX_SELECTION_LENGTH,
  systemLocale,
  useDebounced,
  useLaunchSelection,
  useModelOverride,
  useRecents,
  useSearchMemory,
  useTray,
  useUsage,
} from "./grid/hooks";
import { BUILTIN_COUNT, lookupBuiltin } from "./lib/builtin";
import { findEmoji } from "./lib/emoji-data";
import { execFileAsync } from "./lib/exec";
import { parseInsertFormat } from "./lib/insert-format";
import { resolveLanguage } from "./lib/locale-keywords";
import { searchLocal } from "./lib/local-search";
import { parseTone, type Tone } from "./lib/prompt";
import { debounceDelay } from "./lib/request-policy";
import { applySkinTone, parseSkinTone } from "./lib/skin-tone";
import {
  forgetSearch,
  listSearches,
  lookupMemory,
  recordAnswer,
  recordPick,
  replaceAnswer,
  type MemoryEntry,
  type SearchMemory,
} from "./lib/search-memory";
import { rankByUsage } from "./lib/usage";
import { searchPlaceholder, shortenQuery } from "./lib/placeholder";
import type { LaunchInfo } from "./lib/diagnostics";
import { buildSections, type SearchTile } from "./lib/sections";
import { NoRouteError, createSuggester, type SuggesterDeps } from "./lib/suggest";
import type { EmojiEntry, FetchFn, RouteChoice } from "./lib/types";
import { version as extensionVersion } from "./lib/version";
import { ModelPicker } from "./model-picker";

export { MAX_SELECTION_LENGTH };

const MIN_QUERY_LENGTH = 2;
const MAX_INITIAL_QUERY = 500;
const MAX_TITLE_QUERY = 40;

interface AIState {
  query: string;
  modelKey?: string;
  tone?: Tone;
  emojis: EmojiEntry[];
  combos: EmojiEntry[][];
  label?: string;
  error?: string;
}

interface LocalAnswer {
  source: "memory" | "builtin";
  emojis: EmojiEntry[];
  combos: EmojiEntry[][];
  label: string;
  entry?: MemoryEntry;
}

const resolveAll = (list: string[]): EmojiEntry[] =>
  list.map((e) => findEmoji(e)).filter((e): e is EmojiEntry => e !== undefined);

/** An answer that needs no AI: a remembered search, else (for tone "any") the built-in table. */
function localAnswer(
  query: string,
  o: { memory: SearchMemory | null; builtin: boolean; tone: Tone; forced: boolean },
): LocalAnswer | null {
  if (o.forced || query.length < MIN_QUERY_LENGTH) return null;
  const hit = o.memory ? lookupMemory(o.memory, query) : null;
  if (hit) {
    const emojis = resolveAll(hit.emojis);
    if (emojis.length > 0) {
      const combos = hit.combos.map(resolveAll).filter((c) => c.length >= 2);
      return { source: "memory", emojis, combos, label: hit.model, entry: hit };
    }
  }
  if (o.builtin && o.tone === "any") {
    const emojis = lookupBuiltin(query);
    if (emojis) return { source: "builtin", emojis, combos: [], label: "Built-in" };
  }
  return null;
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

const shorten = (query: string) => shortenQuery(query, MAX_TITLE_QUERY);

function cleanQuery(text: string | undefined): string {
  return (text ?? "").trim().slice(0, MAX_INITIAL_QUERY).trim();
}

export function EmojiGrid(props: { argumentQuery?: string }) {
  const argumentQuery = cleanQuery(props.argumentQuery);
  const preferences = getPreferenceValues<Preferences>();
  const bundleId = preferences.channel || "com.tinycast.app";
  const count = Number(preferences.resultCount) || 24;
  const pasteFirst = preferences.primaryAction !== "copy";
  const minimizeThinking = preferences.minimizeThinking !== false;
  const skinTone = parseSkinTone(preferences.skinTone);
  const format = parseInsertFormat(preferences.pasteFormat);
  const wantCombos = preferences.combos !== false;
  const useBuiltin = preferences.builtin !== false;
  const memoryOn = preferences.searchMemory !== false;
  const locale = useMemo(systemLocale, []);
  const language = resolveLanguage(preferences.language, locale);

  const suggester = useRef<ReturnType<typeof createSuggester>>(null);
  if (!suggester.current) suggester.current = createSuggester(makeDeps());

  const useSelection = preferences.useSelection !== false;
  const hasTyped = useRef(false);
  const selection = useLaunchSelection(!argumentQuery && useSelection, hasTyped);
  // A remembered search chosen on the empty screen counts as the initial query and wins.
  const [chosen, setChosen] = useState("");
  const initialQuery = chosen || argumentQuery || (selection.status === "used" ? selection.text : "");
  const querySource: LaunchInfo["querySource"] = chosen
    ? "memory"
    : argumentQuery
      ? "argument"
      : selection.status === "used"
        ? "selection"
        : "none";

  const [searchText, setSearchText] = useState("");
  const typed = searchText.trim();
  const debouncedTyped = useDebounced(typed, debounceDelay(typed));
  // Typed text wins and waits for a pause; the initial query starts right away.
  const requestQuery = typed ? debouncedTyped : initialQuery;
  const query = typed || initialQuery;
  const fromInitial = !typed && initialQuery !== "";
  const [ai, setAI] = useState<AIState>({ query: "", emojis: [], combos: [] });
  const [loading, setLoading] = useState(false);
  const { recents, remember, clear } = useRecents();
  const { usage, record } = useUsage();
  const tray = useTray();
  // Tinycast owns the dropdown and reports the stored choice through onChange on the first commit.
  const [tone, setTone] = useState<Tone>("any");
  const memory = useSearchMemory(memoryOn);
  const [refreshing, setRefreshing] = useState(false);
  const model = useModelOverride();
  const modelKey = JSON.stringify(model.override);

  const loadChoices = (): Promise<RouteChoice[]> =>
    suggester.current?.listRoutes ? suggester.current.listRoutes(bundleId) : Promise.resolve([]);
  const lastError = useRef<string | undefined>(undefined);
  const queryRef = useRef(query);
  queryRef.current = query;
  // The query whose built-in/remembered answer was replaced by a refresh; a later request for it asks the AI.
  const forcedQuery = useRef<string | null>(null);
  // Queries already counted as an ask in this visit.
  const counted = useRef(new Set<string>());
  // Selected text is not a deliberate search: it is never remembered.
  const fromSelection = !typed && querySource === "selection";
  const copyDiagnostics = async () => {
    const report = await suggester.current!.diagnose({
      bundleId,
      override: model.override,
      minimizeThinking,
      count,
      extensionVersion,
      lastError: lastError.current,
      language,
      systemLocale: locale,
      skinTone,
      tone,
      combos: wantCombos,
      insertFormat: format,
      launch: {
        querySource,
        selection: !useSelection
          ? { status: "off" }
          : argumentQuery
            ? { status: "unused", reason: "an argument was given" }
            : selection.status === "used"
              ? { status: "used", length: selection.text.length }
              : { status: "unused", reason: selection.status === "unused" ? selection.reason : "not read yet" },
        recents: recents.map((e) => e.emoji),
        usageEntries: Object.keys(usage).length,
        answerSource,
        searchMemory: memoryOn
          ? { recent: memory.memory.recent.length, frequent: memory.memory.frequent.length }
          : "off",
        builtin: useBuiltin ? { entries: BUILTIN_COUNT } : "off",
      },
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
        target={<ModelPicker loadChoices={loadChoices} current={model.override} onChoose={model.choose} />}
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
    if (!model.ready || !memory.ready) return;
    if (requestQuery.length < MIN_QUERY_LENGTH) {
      setAI({ query: requestQuery, emojis: [], combos: [] });
      setLoading(false);
      return;
    }
    if (forcedQuery.current !== requestQuery) forcedQuery.current = null;
    // Captured now: the request belongs to the text it was made for, whatever is typed later.
    const recordable = memoryOn && !(!typed && querySource === "selection");
    const local = localAnswer(requestQuery, {
      memory: memoryOn ? memory.current() : null,
      builtin: useBuiltin,
      tone,
      forced: forcedQuery.current === requestQuery,
    });
    if (local) {
      setLoading(false);
      // Staying on a remembered search counts as asking it again (once per visit).
      const { entry } = local;
      if (entry && recordable && !counted.current.has(entry.query)) {
        counted.current.add(entry.query);
        memory.update((m) =>
          recordAnswer(
            m,
            { query: entry.display, emojis: entry.emojis, combos: entry.combos, model: entry.model },
            Date.now(),
          ),
        );
      }
      return;
    }
    let cancelled = false;
    setLoading(true);
    suggester.current!(requestQuery, {
      bundleId,
      count,
      override: model.override,
      minimizeThinking,
      tone,
      combos: wantCombos,
    })
      .then((result) => {
        if (cancelled) return;
        lastError.current = undefined;
        setAI({
          query: requestQuery,
          modelKey,
          tone,
          emojis: result.emojis,
          combos: result.combos ?? [],
          label: result.routeLabel,
        });
        if (recordable) {
          counted.current.add(requestQuery.toLowerCase().replace(/\s+/g, " "));
          const answer = {
            query: requestQuery,
            emojis: result.emojis.map((e) => e.emoji),
            combos: (result.combos ?? []).map((c) => c.map((e) => e.emoji)),
            model: result.routeLabel,
          };
          memory.update((m) =>
            lookupMemory(m, requestQuery) ? replaceAnswer(m, answer, Date.now()) : recordAnswer(m, answer, Date.now()),
          );
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        lastError.current = message;
        setAI({ query: requestQuery, modelKey, tone, emojis: [], combos: [], error: message });
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
  }, [
    requestQuery,
    bundleId,
    count,
    modelKey,
    model.ready,
    memory.ready,
    minimizeThinking,
    tone,
    wantCombos,
    memoryOn,
    useBuiltin,
  ]);

  /** Refresh Suggestions: asks the AI for the shown query, bypassing memory, built-in answers and the cache. */
  const refresh = () => {
    const asked = query;
    if (asked.length < MIN_QUERY_LENGTH || refreshing) return;
    const recordable = memoryOn && !fromSelection;
    const askedTone = tone;
    const askedKey = modelKey;
    setRefreshing(true);
    suggester.current!(asked, {
      bundleId,
      count,
      override: model.override,
      minimizeThinking,
      tone: askedTone,
      combos: wantCombos,
      refresh: true,
    })
      .then((result) => {
        lastError.current = undefined;
        forcedQuery.current = asked;
        if (recordable || (memoryOn && lookupMemory(memory.current(), asked))) {
          memory.update((m) =>
            replaceAnswer(
              m,
              {
                query: asked,
                emojis: result.emojis.map((e) => e.emoji),
                combos: (result.combos ?? []).map((c) => c.map((e) => e.emoji)),
                model: result.routeLabel,
              },
              Date.now(),
            ),
          );
        }
        if (queryRef.current === asked) {
          setAI({
            query: asked,
            modelKey: askedKey,
            tone: askedTone,
            emojis: result.emojis,
            combos: result.combos ?? [],
            label: result.routeLabel,
          });
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        lastError.current = message;
        void showToast({
          style: Toast.Style.Failure,
          title: error instanceof NoRouteError ? "No AI model available" : "AI emoji search failed",
          message,
        });
      })
      .finally(() => setRefreshing(false));
  };

  const local = useMemo(
    () => rankByUsage(searchLocal(query, 60, language), usage, Date.now()),
    [query, language, usage],
  );
  // Only show AI picks that belong to what is typed now, never a previous query's answer.
  const aiIsCurrent = ai.query === query && ai.modelKey === modelKey && ai.tone === tone;
  const aiShown = aiIsCurrent && ai.emojis.length > 0;
  // One source per query: a fresh AI answer, else a remembered search, else the built-in table.
  const localShown = aiShown
    ? null
    : localAnswer(query, {
        memory: memoryOn ? memory.memory : null,
        builtin: useBuiltin,
        tone,
        forced: forcedQuery.current === query,
      });
  const answerSource: NonNullable<LaunchInfo["answerSource"]> = aiShown
    ? "ai"
    : localShown
      ? localShown.source === "builtin"
        ? "builtin"
        : "memory"
      : "none";
  const shownEmojis = aiShown ? ai.emojis : (localShown?.emojis ?? []);
  const shownCombos = wantCombos ? (aiShown ? ai.combos : (localShown?.combos ?? [])) : [];
  const shownLabel = aiShown ? ai.label : localShown?.label;
  const forPart = fromInitial ? ` for “${shorten(query)}”` : "";
  const answerTitle =
    answerSource === "builtin" ? "Built-in Answer" : answerSource === "memory" ? "Remembered Answer" : "AI Suggestions";
  const searchTiles: SearchTile[] = useMemo(
    () =>
      memoryOn
        ? listSearches(memory.memory, Date.now(), 16).flatMap((e) => {
            const emoji = findEmoji(e.emojis[0]);
            return emoji ? [{ query: e.query, display: e.display, emoji }] : [];
          })
        : [],
    [memory.memory, memoryOn],
  );
  const sections = buildSections({
    query,
    ai: shownEmojis,
    local,
    recents,
    combos: shownCombos,
    searches: searchTiles,
    aiTitle: [answerTitle + forPart, shownLabel].filter(Boolean).join(" · "),
  });
  const waitingForAI = query.length >= MIN_QUERY_LENGTH && !localShown && (loading || !aiIsCurrent);

  const ctx: ActionContext = {
    format,
    skinTone,
    pasteFirst,
    tray,
    onUse: (entries) => {
      entries.forEach((entry) => {
        remember(entry);
        record(entry.emoji);
      });
      if (memoryOn && query.length >= MIN_QUERY_LENGTH) {
        const now = Date.now();
        memory.update((m) => {
          if (lookupMemory(m, query)) return recordPick(m, query, now);
          // A built-in answer the user picked from becomes a remembered search (never from selected text).
          if (answerSource !== "builtin" || fromSelection) return m;
          const emojis = shownEmojis.map((e) => e.emoji);
          return recordPick(recordAnswer(m, { query, emojis, model: "Built-in" }, now), query, now);
        });
      }
    },
    chooseModel,
    onClearRecents: recents.length > 0 ? clear : undefined,
    refresh: query.length >= MIN_QUERY_LENGTH ? refresh : undefined,
    back: chosen ? () => setChosen("") : undefined,
  };
  const searchActions = {
    show: (display: string) => setChosen(display),
    forget: (q: string) => memory.update((m) => forgetSearch(m, q)),
    clear: memory.clear,
  };
  const trayFull = () => void showToast({ style: Toast.Style.Failure, title: "Selection is full" });

  return (
    <Grid
      columns={8}
      inset={Grid.Inset.Small}
      filtering={false}
      isLoading={waitingForAI || refreshing}
      searchBarPlaceholder={searchPlaceholder({
        typed,
        initialQuery,
        source: querySource === "none" ? null : querySource,
        hasRecents: recents.length > 0,
        hasSearches: searchTiles.length > 0,
        tray: tray.entries.map((e) => applySkinTone(e, skinTone)),
      })}
      searchBarAccessory={
        <Grid.Dropdown tooltip="Tone" storeValue onChange={(value) => setTone(parseTone(value))}>
          <Grid.Dropdown.Item title="Any Tone" value="any" />
          <Grid.Dropdown.Item title="Work" value="work" />
          <Grid.Dropdown.Item title="Casual" value="casual" />
          <Grid.Dropdown.Item title="Playful" value="playful" />
        </Grid.Dropdown>
      }
      onSearchTextChange={(text) => {
        if (text.trim()) hasTyped.current = true;
        setSearchText(text);
      }}
    >
      {sections.length === 0 ? (
        <Grid.EmptyView
          icon="🔎"
          actions={<EmptyActions ctx={ctx} />}
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
            {section.id === "searches"
              ? (section.searches ?? []).map((tile) => (
                  <Grid.Item
                    key={`searches-${tile.query}`}
                    content={applySkinTone(tile.emoji, skinTone)}
                    title={`Search · ${shorten(tile.display)}`}
                    keywords={[tile.display]}
                    actions={
                      <SearchActions query={tile.query} display={tile.display} ctx={ctx} searches={searchActions} />
                    }
                  />
                ))
              : section.id === "combos"
                ? (section.combos ?? []).map((combo, index) => {
                    const title = `Combo · ${combo.map((e) => e.name).join(" + ")}`;
                    return (
                      <Grid.Item
                        key={`combos-${index}-${combo.map((e) => e.emoji).join("")}`}
                        content={combo.map((e) => applySkinTone(e, skinTone)).join("")}
                        title={title}
                        keywords={combo.map((e) => e.name)}
                        actions={<ComboActions combo={combo} title={title} ctx={ctx} onTrayFull={trayFull} />}
                      />
                    );
                  })
                : section.emojis.map((entry, index) => (
                    <Grid.Item
                      key={`${section.id}-${entry.emoji}`}
                      content={applySkinTone(entry, skinTone)}
                      title={section.id === "ai" ? `${index + 1}. ${entry.name}` : entry.name}
                      keywords={entry.keywords}
                      actions={<EmojiActions entry={entry} ctx={ctx} onTrayFull={trayFull} />}
                    />
                  ))}
          </Grid.Section>
        ))
      )}
    </Grid>
  );
}
