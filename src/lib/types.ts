// Shared contracts between the lib modules. Keep this file free of runtime code.

/** One emoji from the bundled dataset. */
export interface EmojiEntry {
  /** The emoji character sequence exactly as in the dataset (fully qualified, e.g. "❤️"). */
  emoji: string;
  /** Unicode CLDR name, e.g. "red heart". */
  name: string;
  /** e.g. "red_heart". */
  slug: string;
  /** e.g. "Smileys & Emotion". */
  group: string;
  /** Lower-case search keywords (from emojilib), without the slug itself. */
  keywords: string[];
}

/** Tinycast's `AIProviderKind` raw values. */
export type ProviderKind = "openAI" | "anthropic" | "gemini" | "openRouter" | "openAICompatible";

/** Tinycast's `AIConnection` as stored (JSON) in UserDefaults `aiConnections`. */
export interface AIConnection {
  id: string; // UUID, upper-case as Swift encodes it
  name: string;
  provider: ProviderKind;
  baseURL: string;
  models: string[];
}

/** Tinycast's `AIModelSelection` (decoded from `aiDefaultModel`). */
export type ModelSelection =
  | { kind: "appleIntelligence" }
  | { kind: "api"; connection: string; model: string; effort?: string }
  | { kind: "codex" | "claude" | "grok" | "openCode" | "cursor"; model: string; effort?: string };

/** The AI-related part of Tinycast's settings. */
export interface TinycastAISettings {
  connections: AIConnection[];
  defaultModel: ModelSelection | null;
  /** `AIModelSource.storageKey` values: "appleIntelligence", "claude", "codex", "api:<UUID>", … */
  disabledRoutes: string[];
}

/** What the extension will actually call. */
export type AIRoute =
  | { kind: "api"; connection: AIConnection; model: string }
  | { kind: "cli"; tool: "claude" | "codex"; model: string };

/** Result of resolving a route: either a route, or a human readable reason why none is usable. */
export type RouteResolution = { ok: true; route: AIRoute } | { ok: false; reason: string };

/** Injectable process runner (wraps child_process.execFile). */
export type ExecFn = (
  file: string,
  args: string[],
  options?: { timeoutMs?: number; input?: string },
) => Promise<{ stdout: string; stderr: string }>;

/** Injectable fetch subset. */
export type FetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** The prompt sent to whatever model. */
export interface EmojiPrompt {
  system: string;
  user: string;
}
