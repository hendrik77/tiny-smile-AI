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
import { ComboActions, EmojiActions, EmptyActions, type ActionContext } from "./grid/actions";
import {
  MAX_SELECTION_LENGTH,
  systemLocale,
  useDebounced,
  useLaunchSelection,
  useModelOverride,
  useRecents,
  useTray,
  useUsage,
} from "./grid/hooks";
import { execFileAsync } from "./lib/exec";
import { parseInsertFormat } from "./lib/insert-format";
import { resolveLanguage } from "./lib/locale-keywords";
import { searchLocal } from "./lib/local-search";
import { parseTone, type Tone } from "./lib/prompt";
import { debounceDelay } from "./lib/request-policy";
import { applySkinTone, parseSkinTone } from "./lib/skin-tone";
import { rankByUsage } from "./lib/usage";
import { searchPlaceholder, shortenQuery } from "./lib/placeholder";
import type { LaunchInfo } from "./lib/diagnostics";
import { buildSections } from "./lib/sections";
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
  const locale = useMemo(systemLocale, []);
  const language = resolveLanguage(preferences.language, locale);

  const suggester = useRef<ReturnType<typeof createSuggester>>(null);
  if (!suggester.current) suggester.current = createSuggester(makeDeps());

  const useSelection = preferences.useSelection !== false;
  const hasTyped = useRef(false);
  const selection = useLaunchSelection(!argumentQuery && useSelection, hasTyped);
  const initialQuery = argumentQuery || (selection.status === "used" ? selection.text : "");
  const querySource: LaunchInfo["querySource"] = argumentQuery
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
  const model = useModelOverride();
  const modelKey = JSON.stringify(model.override);

  const loadChoices = (): Promise<RouteChoice[]> =>
    suggester.current?.listRoutes ? suggester.current.listRoutes(bundleId) : Promise.resolve([]);
  const lastError = useRef<string | undefined>(undefined);
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
    if (!model.ready) return;
    if (requestQuery.length < MIN_QUERY_LENGTH) {
      setAI({ query: requestQuery, emojis: [], combos: [] });
      setLoading(false);
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
  }, [requestQuery, bundleId, count, modelKey, model.ready, minimizeThinking, tone, wantCombos]);

  const local = useMemo(
    () => rankByUsage(searchLocal(query, 60, language), usage, Date.now()),
    [query, language, usage],
  );
  // Only show AI picks that belong to what is typed now, never a previous query's answer.
  const aiIsCurrent = ai.query === query && ai.modelKey === modelKey && ai.tone === tone;
  const aiForQuery = aiIsCurrent ? ai.emojis : [];
  const combosForQuery = aiIsCurrent && wantCombos ? ai.combos : [];
  const sections = buildSections({
    query,
    ai: aiForQuery,
    local,
    recents,
    combos: combosForQuery,
    aiTitle: ["AI Suggestions" + (fromInitial ? ` for “${shorten(query)}”` : ""), ai.label].filter(Boolean).join(" · "),
  });
  const waitingForAI = query.length >= MIN_QUERY_LENGTH && (loading || !aiIsCurrent);

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
    },
    chooseModel,
    onClearRecents: recents.length > 0 ? clear : undefined,
  };
  const trayFull = () => void showToast({ style: Toast.Style.Failure, title: "Selection is full" });

  return (
    <Grid
      columns={8}
      inset={Grid.Inset.Small}
      filtering={false}
      isLoading={waitingForAI}
      searchBarPlaceholder={searchPlaceholder({
        typed,
        initialQuery,
        source: querySource === "none" ? null : querySource,
        hasRecents: recents.length > 0,
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
            {section.id === "combos"
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
