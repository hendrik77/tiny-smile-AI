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
  /**
   * Reasoning levels declared per model (`reasoningOptions[model].efforts` in Tinycast),
   * e.g. { "gpt-5": ["default", "minimal", "low", "medium", "high"] }. Absent = none declared.
   */
  reasoningEfforts?: Record<string, string[]>;
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
  /** Installed CLI tools switched on in Tinycast (`aiInstalledProviders`), e.g. ["claude", "codex"]. */
  enabledInstalledProviders: string[];
}

/** What the extension will actually call. */
export type AIRoute =
  | { kind: "api"; connection: AIConnection; model: string }
  | { kind: "cli"; tool: "claude" | "codex"; model: string };

/** A route the user picked in the extension, overriding Tinycast's default model. */
export type RouteOverride =
  | { kind: "api"; connection: string; model: string }
  | { kind: "cli"; tool: "claude" | "codex"; model: string };

/** One entry of the in-command model picker. */
export interface RouteChoice {
  /** Stable id, e.g. "api:<UUID>:<model>" or "cli:claude:<model>". */
  id: string;
  /** The model id, e.g. "claude-haiku-4-5". */
  model: string;
  /** Connection or tool name, e.g. "Anthropic Claude" or "Claude Code". */
  source: string;
  override: RouteOverride;
  /** True for the route Tinycast's default model resolves to. */
  isDefault: boolean;
}

/** Result of resolving a route: either a route, or a human readable reason why none is usable. */
export type RouteResolution = { ok: true; route: AIRoute } | { ok: false; reason: string };

/** Injectable process runner (wraps child_process.execFile). */
export type ExecFn = (
  file: string,
  args: string[],
  options?: { timeoutMs?: number; input?: string; env?: Record<string, string> },
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
