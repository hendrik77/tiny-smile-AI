import { routeLabel } from "./tinycast-settings";
import type { AIConnection, ModelSelection, RouteOverride, RouteResolution, TinycastAISettings } from "./types";

/** What happened at launch. Never carries the selected text itself. */
export interface LaunchInfo {
  querySource: "argument" | "selection" | "none";
  selection: { status: "off" } | { status: "used"; length: number } | { status: "unused"; reason?: string };
  recents: string[];
  usageEntries: number;
}

export interface DiagnosticsInput {
  extensionVersion: string;
  bundleId: string;
  settingsError?: string;
  rawKeys?: { name: string; type: string }[];
  settings?: TinycastAISettings;
  override: RouteOverride | null;
  resolution?: RouteResolution;
  secrets?: { apiKey: "found" | "missing" | "error"; headerNames: string[]; error?: string };
  cli?: { tool: string; path: string | null };
  effort?: string | null;
  minimizeThinking: boolean;
  resultCount: number;
  lastError?: string;
  raycastAI: boolean;
  language?: string;
  systemLocale?: string;
  skinTone?: string;
  tone?: string;
  combos?: boolean;
  launch?: LaunchInfo;
}

const MASK = "[redacted]";

/** Masks anything that looks like a key or token. */
const CLI_NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex" };

export function redact(text: string): string {
  return text
    .replace(/\bBearer\s+\S+/gi, MASK)
    .replace(/\bsk-[A-Za-z0-9_-]+/g, MASK)
    .replace(/[A-Za-z0-9+/=_-]{24,}/g, MASK);
}

/** scheme://host[:port] only; never userinfo, path or query. */
function hostOf(baseURL: string): string | null {
  try {
    const u = new URL(baseURL);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function describeSelection(sel: ModelSelection | null, connections: AIConnection[]): string {
  if (!sel) return "none";
  const model = "model" in sel && sel.model ? sel.model : "(none)";
  if (sel.kind === "api") {
    const c = connections.find((x) => x.id === sel.connection);
    return `api, ${model}, connection: ${c ? c.name : "(connection not found)"}`;
  }
  if (sel.kind === "appleIntelligence") return "appleIntelligence";
  return `${sel.kind}, ${model}`;
}

function describeOverride(o: RouteOverride | null, connections: AIConnection[]): string {
  if (!o) return "Tinycast default";
  if (o.kind === "cli") return `cli, ${o.tool}, ${o.model || "default model"}`;
  const c = connections.find((x) => x.id === o.connection);
  return `api, ${o.model}, connection: ${c ? c.name : "(connection not found)"}`;
}

function list(items: string[]): string {
  return items.length > 0 ? items.join(", ") : "none";
}

export function formatDiagnostics(input: DiagnosticsInput): string {
  const out: string[] = [];
  const section = (title: string) => out.push("", `## ${title}`);
  const { settings } = input;
  const connections = settings?.connections ?? [];

  out.push("Tiny Smile AI diagnostics");
  out.push(`Extension version: ${input.extensionVersion}`);
  out.push(`Bundle id: ${input.bundleId}`);
  out.push(`Raycast AI: ${input.raycastAI ? "yes" : "no"}`);

  if (!input.raycastAI) {
    section("Tinycast AI settings keys");
    if (input.settingsError) out.push(redact(input.settingsError));
    else if (!input.rawKeys || input.rawKeys.length === 0) out.push("(no keys starting with ai)");
    else for (const k of input.rawKeys) out.push(`${k.name}: ${k.type}`);
  }

  if (settings) {
    section("Default model");
    out.push(describeSelection(settings.defaultModel, connections));

    section("Connections");
    if (connections.length === 0) out.push("none");
    for (const c of connections) {
      const efforts = Object.entries(c.reasoningEfforts ?? {}).map(([m, e]) => `${m}: ${e.join(", ")}`);
      out.push(
        `- ${c.name} (${c.provider}) ${hostOf(c.baseURL) ?? "(invalid URL)"} ` +
          `${settings.disabledRoutes.includes(`api:${c.id}`) ? "disabled" : "enabled"}`,
      );
      out.push(`  Models: ${list(c.models)}`);
      if (efforts.length > 0) out.push(`  Reasoning levels: ${efforts.join("; ")}`);
    }

    section("Installed tools switched on");
    out.push(list(settings.enabledInstalledProviders));

    section("Disabled routes");
    out.push(
      list(
        settings.disabledRoutes.map((r) => {
          const id = r.startsWith("api:") ? r.slice(4) : null;
          const c = id ? connections.find((x) => x.id === id) : undefined;
          return c ? `api:${c.name}` : r;
        }),
      ),
    );
  }

  section("Route");
  out.push(`Chosen for emoji search: ${describeOverride(input.override, connections)}`);
  if (input.raycastAI) out.push("Resolved route: Raycast AI");
  else if (input.resolution?.ok) out.push(`Resolved route: ${routeLabel(input.resolution.route)}`);
  else if (input.resolution) out.push(`Resolved route: none (${redact(input.resolution.reason)})`);
  if (input.secrets) {
    out.push(`API key: ${input.secrets.apiKey}${input.secrets.error ? ` (${redact(input.secrets.error)})` : ""}`);
    out.push(`Custom headers: ${list(input.secrets.headerNames)}`);
  }
  if (input.cli) out.push(`Executable: ${input.cli.path ?? "not found"}`);

  section("Speed");
  out.push(`Minimize thinking: ${input.minimizeThinking ? "on" : "off"}`);
  if (input.cli) {
    out.push(`Effort sent: not used by the ${CLI_NAMES[input.cli.tool] ?? input.cli.tool} tool`);
  } else {
    out.push(`Effort sent: ${input.effort ?? "none"}`);
  }
  out.push(`Suggestions: ${input.resultCount}`);
  out.push(`Tone: ${input.tone ?? "any"}`);
  out.push(`Combinations: ${input.combos ? "on" : "off"}`);

  section("Name search");
  out.push(`Language: ${input.language ?? "en"}`);
  out.push(`System locale: ${input.systemLocale || "unknown"}`);
  out.push(`Skin tone: ${input.skinTone ?? "none"}`);

  if (input.launch) {
    const { launch } = input;
    section("Launch");
    out.push(`Query source: ${launch.querySource === "selection" ? "selected text" : launch.querySource}`);
    const sel = launch.selection;
    out.push(
      sel.status === "off"
        ? "Selected text: off (preference)"
        : sel.status === "used"
          ? `Selected text: used (${sel.length} characters)`
          : `Selected text: not used: ${redact(sel.reason || "no reason given")}`,
    );
    const first = launch.recents.slice(0, 8);
    out.push(`Recents: ${launch.recents.length}${first.length > 0 ? ` (${first.join(" ")})` : ""}`);
    out.push(`Usage entries: ${launch.usageEntries}`);
  }

  if (input.lastError) {
    section("Last error");
    out.push(`Last error: ${redact(input.lastError)}`);
  }

  section("Fixture (no secrets)");
  const fixture = {
    defaultModel: settings?.defaultModel ?? null,
    connections: connections.map((c) => ({
      id: c.id,
      name: c.name,
      provider: c.provider,
      host: hostOf(c.baseURL) ?? "(invalid URL)",
      models: c.models,
      reasoningEfforts: c.reasoningEfforts ?? {},
    })),
    disabledRoutes: settings?.disabledRoutes ?? [],
    enabledInstalledProviders: settings?.enabledInstalledProviders ?? [],
  };
  out.push("```json", JSON.stringify(fixture, null, 2), "```");
  return out.join("\n").replace(/^\n/, "") + "\n";
}
