import { readApiKey, readRequestHeaders } from "./keychain";
import { parseSuggestions } from "./parse-suggestions";
import { buildEmojiPrompt } from "./prompt";
import { callApi, callCli, fastestEffort } from "./providers";
import { listRouteChoices, PROVIDER_TITLES, readTinycastAISettings, resolveRoute } from "./tinycast-settings";
import type {
  AIRoute,
  EmojiEntry,
  EmojiPrompt,
  ExecFn,
  FetchFn,
  RouteChoice,
  RouteOverride,
  TinycastAISettings,
} from "./types";
import { findEmoji } from "./emoji-data";

/** Thrown when Tinycast has no AI route the extension can use; the message says what to set up. */
export class NoRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoRouteError";
  }
}

export interface SuggestionCache {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface SuggesterDeps {
  exec: ExecFn;
  fetch: FetchFn;
  home: string;
  exists: (path: string) => boolean;
  /** Persistent cache (Raycast `Cache`); an in-memory one is always used as well. */
  cache?: SuggestionCache;
  /** Set when running inside Raycast, where `AI.ask` is available. */
  raycastAsk?: (prompt: string) => Promise<string>;
}

export interface SuggestOptions {
  bundleId: string;
  count: number;
  /** A model picked in the extension, overriding Tinycast's default. */
  override?: RouteOverride | null;
  /** Ask thinking models to think as little as possible (default true). */
  minimizeThinking?: boolean;
}

export interface SuggestResult {
  emojis: EmojiEntry[];
  routeLabel: string;
}

interface PreparedRoute {
  key: string;
  label: string;
  ask: (prompt: EmojiPrompt, minimizeThinking: boolean) => Promise<string>;
}

const CLI_TITLES = { claude: "Claude Code", codex: "Codex" } as const;

const CACHE_VERSION = "v2";

export function routeLabel(route: AIRoute): string {
  if (route.kind === "cli") return `${CLI_TITLES[route.tool]} · ${route.model}`;
  const name = route.connection.name.trim() || PROVIDER_TITLES[route.connection.provider];
  return `${name} · ${route.model}`;
}

/**
 * Returns a function that asks the AI for emojis. Tinycast's settings and the Keychain are read
 * once per suggester (i.e. once per opened command), and answers are cached by route + query.
 */
export function createSuggester(deps: SuggesterDeps) {
  const memory = new Map<string, string>();
  const routes = new Map<string, Promise<PreparedRoute>>();
  const settingsMemo = new Map<string, Promise<TinycastAISettings>>();
  const secrets = new Map<string, Promise<{ apiKey: string | null; headers: Record<string, string> }>>();

  /** Memoized per bundle id; a failed read is retried on the next call. */
  function settingsFor(bundleId: string): Promise<TinycastAISettings> {
    let pending = settingsMemo.get(bundleId);
    if (!pending) {
      pending = readTinycastAISettings(bundleId, deps.exec);
      pending.catch(() => settingsMemo.delete(bundleId));
      settingsMemo.set(bundleId, pending);
    }
    return pending;
  }

  function secretsFor(bundleId: string, connectionId: string) {
    const key = `${bundleId}|${connectionId}`;
    let pending = secrets.get(key);
    if (!pending) {
      pending = Promise.all([
        readApiKey(bundleId, connectionId, deps.exec),
        readRequestHeaders(bundleId, connectionId, deps.exec),
      ]).then(([apiKey, headers]) => ({ apiKey, headers }));
      pending.catch(() => secrets.delete(key));
      secrets.set(key, pending);
    }
    return pending;
  }

  async function prepare(bundleId: string, override: RouteOverride | null): Promise<PreparedRoute> {
    if (deps.raycastAsk) {
      const ask = deps.raycastAsk;
      return {
        key: "raycast",
        label: "Raycast AI",
        ask: (prompt) => ask(`${prompt.system}\n\n${prompt.user}`),
      };
    }
    const settings = await settingsFor(bundleId);
    const resolution = resolveRoute(settings, override);
    if (!resolution.ok) throw new NoRouteError(resolution.reason);
    const route = resolution.route;
    const label = routeLabel(route);

    if (route.kind === "cli") {
      return {
        key: `cli:${route.tool}:${route.model}`,
        label,
        ask: (prompt) =>
          callCli(route.tool, route.model, prompt, { exec: deps.exec, home: deps.home, exists: deps.exists }),
      };
    }

    const { connection, model } = route;
    const { apiKey, headers } = await secretsFor(bundleId, connection.id);
    return {
      key: `api:${connection.id}:${model}`,
      label,
      ask: (prompt, minimize) =>
        callApi(connection, model, prompt, apiKey, headers, deps.fetch, minimize ? fastestEffort(connection, model) : null),
    };
  }

  function preparedRoute(bundleId: string, override: RouteOverride | null): Promise<PreparedRoute> {
    const memoKey = `${bundleId}|${override ? JSON.stringify(override) : ""}`;
    let pending = routes.get(memoKey);
    if (!pending) {
      pending = prepare(bundleId, override);
      // A failed lookup (e.g. Keychain access denied) is retried on the next search.
      pending.catch(() => routes.delete(memoKey));
      routes.set(memoKey, pending);
    }
    return pending;
  }

  function readCache(key: string): EmojiEntry[] | undefined {
    const raw = memory.get(key) ?? deps.cache?.get(key);
    if (!raw) return undefined;
    try {
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return undefined;
      const entries = list.map((e) => (typeof e === "string" ? findEmoji(e) : undefined));
      return entries.filter((e): e is EmojiEntry => e !== undefined);
    } catch {
      return undefined;
    }
  }

  function writeCache(key: string, emojis: EmojiEntry[]) {
    const raw = JSON.stringify(emojis.map((e) => e.emoji));
    memory.set(key, raw);
    deps.cache?.set(key, raw);
  }

  async function suggest(query: string, options: SuggestOptions): Promise<SuggestResult> {
    const normalized = query.trim().replace(/\s+/g, " ").toLowerCase();
    if (!normalized) throw new Error("Type something to get emoji suggestions.");
    const count = Math.max(1, Math.min(100, Math.floor(options.count)));

    const route = await preparedRoute(options.bundleId, options.override ?? null);
    const minimize = options.minimizeThinking ?? true;
    const cacheKey = `${CACHE_VERSION}|${route.key}|${minimize ? "min" : "full"}|${count}|${normalized}`;
    const cached = readCache(cacheKey);
    if (cached && cached.length > 0) return { emojis: cached, routeLabel: route.label };

    const answer = await route.ask(buildEmojiPrompt(query.trim(), count), minimize);
    const emojis = parseSuggestions(answer, count);
    if (emojis.length === 0) throw new Error("The AI didn't suggest any emoji for this search.");
    writeCache(cacheKey, emojis);
    return { emojis, routeLabel: route.label };
  }

  /** The models the user can pick from; empty inside Raycast, where the model is fixed. */
  async function listRoutes(bundleId: string): Promise<RouteChoice[]> {
    if (deps.raycastAsk) return [];
    return listRouteChoices(await settingsFor(bundleId));
  }

  return Object.assign(suggest, { listRoutes });
}
