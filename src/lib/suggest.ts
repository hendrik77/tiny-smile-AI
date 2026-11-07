import { readApiKey, readRequestHeaders } from "./keychain";
import { parseSuggestions } from "./parse-suggestions";
import { buildEmojiPrompt } from "./prompt";
import { callApi, callCli } from "./providers";
import { readTinycastAISettings, resolveRoute } from "./tinycast-settings";
import type { AIRoute, EmojiEntry, EmojiPrompt, ExecFn, FetchFn, ProviderKind } from "./types";
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
}

export interface SuggestResult {
  emojis: EmojiEntry[];
  routeLabel: string;
}

interface PreparedRoute {
  key: string;
  label: string;
  ask: (prompt: EmojiPrompt) => Promise<string>;
}

const PROVIDER_TITLES: Record<ProviderKind, string> = {
  openAI: "OpenAI API",
  anthropic: "Anthropic Claude",
  gemini: "Google Gemini",
  openRouter: "OpenRouter",
  openAICompatible: "OpenAI Compatible",
};

const CLI_TITLES = { claude: "Claude Code", codex: "Codex" } as const;

const CACHE_VERSION = "v1";

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

  async function prepare(bundleId: string): Promise<PreparedRoute> {
    if (deps.raycastAsk) {
      const ask = deps.raycastAsk;
      return {
        key: "raycast",
        label: "Raycast AI",
        ask: (prompt) => ask(`${prompt.system}\n\n${prompt.user}`),
      };
    }
    const settings = await readTinycastAISettings(bundleId, deps.exec);
    const resolution = resolveRoute(settings);
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
    const [apiKey, headers] = await Promise.all([
      readApiKey(bundleId, connection.id, deps.exec),
      readRequestHeaders(bundleId, connection.id, deps.exec),
    ]);
    return {
      key: `api:${connection.id}:${model}`,
      label,
      ask: (prompt) => callApi(connection, model, prompt, apiKey, headers, deps.fetch),
    };
  }

  function preparedRoute(bundleId: string): Promise<PreparedRoute> {
    let pending = routes.get(bundleId);
    if (!pending) {
      pending = prepare(bundleId);
      // A failed lookup (e.g. Keychain access denied) is retried on the next search.
      pending.catch(() => routes.delete(bundleId));
      routes.set(bundleId, pending);
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

  return async function suggest(query: string, options: SuggestOptions): Promise<SuggestResult> {
    const normalized = query.trim().replace(/\s+/g, " ").toLowerCase();
    if (!normalized) throw new Error("Type something to get emoji suggestions.");
    const count = Math.max(1, Math.min(100, Math.floor(options.count)));

    const route = await preparedRoute(options.bundleId);
    const cacheKey = `${CACHE_VERSION}|${route.key}|${count}|${normalized}`;
    const cached = readCache(cacheKey);
    if (cached && cached.length > 0) return { emojis: cached, routeLabel: route.label };

    const answer = await route.ask(buildEmojiPrompt(query.trim(), count));
    const emojis = parseSuggestions(answer, count);
    if (emojis.length === 0) throw new Error("The AI didn't suggest any emoji for this search.");
    writeCache(cacheKey, emojis);
    return { emojis, routeLabel: route.label };
  };
}
