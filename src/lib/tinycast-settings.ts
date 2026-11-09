import { parsePlistXML } from "./plist";
import type {
  AIConnection,
  AIRoute,
  ExecFn,
  ModelSelection,
  ProviderKind,
  RouteChoice,
  RouteOverride,
  RouteResolution,
  TinycastAISettings,
} from "./types";

const PROVIDERS: ProviderKind[] = ["openAI", "anthropic", "gemini", "openRouter", "openAICompatible"];

export const PROVIDER_TITLES: Record<ProviderKind, string> = {
  openAI: "OpenAI API",
  anthropic: "Anthropic Claude",
  gemini: "Google Gemini",
  openRouter: "OpenRouter",
  openAICompatible: "OpenAI Compatible",
};

const CLI_TITLES = { claude: "Claude Code", codex: "Codex" } as const;

export function routeLabel(route: AIRoute): string {
  if (route.kind === "cli") return `${CLI_TITLES[route.tool]} · ${route.model || "default model"}`;
  const name = route.connection.name.trim() || PROVIDER_TITLES[route.connection.provider];
  return `${name} · ${route.model}`;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function decodeJSONData(v: unknown): unknown {
  try {
    if (v instanceof Uint8Array) return JSON.parse(Buffer.from(v).toString("utf8"));
  } catch {
    // fall through
  }
  return undefined;
}

function decodeReasoningEfforts(v: unknown): Record<string, string[]> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [model, opt] of Object.entries(v)) {
    if (!isObj(opt) || !Array.isArray(opt.efforts)) continue;
    const efforts = opt.efforts.filter((x): x is string => typeof x === "string");
    if (efforts.length > 0) out[model] = efforts;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function decodeConnections(v: unknown): AIConnection[] {
  const json = decodeJSONData(v);
  if (!Array.isArray(json)) return [];
  const out: AIConnection[] = [];
  for (const e of json) {
    if (!isObj(e)) continue;
    const { id, provider, baseURL } = e;
    if (typeof id !== "string" || !id) continue;
    if (typeof provider !== "string" || !PROVIDERS.includes(provider as ProviderKind)) continue;
    if (typeof baseURL !== "string" || !baseURL) continue;
    const reasoningEfforts = decodeReasoningEfforts(e.reasoningOptions);
    out.push({
      id,
      name: typeof e.name === "string" ? e.name : id,
      provider: provider as ProviderKind,
      baseURL,
      models: Array.isArray(e.models) ? e.models.filter((m): m is string => typeof m === "string") : [],
      ...(reasoningEfforts ? { reasoningEfforts } : {}),
    });
  }
  return out;
}

function decodeSelection(v: unknown): ModelSelection | null {
  const json = decodeJSONData(v);
  if (!isObj(json)) return null;
  const key = Object.keys(json)[0];
  if (!key) return null;
  const body = isObj(json[key]) ? (json[key] as Record<string, unknown>) : {};
  const model = typeof body.model === "string" ? body.model : "";
  const effort = typeof body.effort === "string" ? { effort: body.effort } : {};
  switch (key) {
    case "appleIntelligence":
      return { kind: "appleIntelligence" };
    case "api":
      if (typeof body.connection !== "string" || !body.connection) return null;
      return { kind: "api", connection: body.connection, model, ...effort };
    case "chatGPT":
    case "codex":
      return { kind: "codex", model, ...effort };
    case "claude":
    case "grok":
    case "openCode":
    case "cursor":
      return { kind: key, model, ...effort };
    default:
      return null;
  }
}

function decodeStringList(v: unknown): string[] {
  const json = decodeJSONData(v);
  return Array.isArray(json) ? json.filter((x): x is string => typeof x === "string") : [];
}

export function decodeAISettings(plist: unknown): TinycastAISettings {
  const p = isObj(plist) ? plist : {};
  const routes = Array.isArray(p.aiDisabledRoutes)
    ? p.aiDisabledRoutes.filter((r): r is string => typeof r === "string")
    : [];
  return {
    connections: decodeConnections(p.aiConnections),
    defaultModel: decodeSelection(p.aiDefaultModel),
    disabledRoutes: routes,
    enabledInstalledProviders: decodeStringList(p.aiInstalledProviders),
  };
}

function plistType(v: unknown): string {
  if (v instanceof Uint8Array) return "data";
  if (Array.isArray(v)) return "array";
  if (isObj(v)) return "dict";
  if (typeof v === "string") return "string";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "real";
  return "unknown";
}

/** Every raw preference key starting with "ai" and its plist type, sorted by name. */
export function listRawAIKeys(plist: unknown): { name: string; type: string }[] {
  if (!isObj(plist)) return [];
  return Object.keys(plist)
    .filter((k) => k.startsWith("ai"))
    .sort()
    .map((name) => ({ name, type: plistType(plist[name]) }));
}

export async function readTinycastAISettings(bundleId: string, exec: ExecFn): Promise<TinycastAISettings> {
  return (await readTinycastAISettingsDetailed(bundleId, exec)).settings;
}

export async function readTinycastAISettingsDetailed(
  bundleId: string,
  exec: ExecFn,
): Promise<{ settings: TinycastAISettings; rawKeys: { name: string; type: string }[] }> {
  let stdout: string;
  try {
    ({ stdout } = await exec("/usr/bin/defaults", ["export", bundleId, "-"]));
  } catch {
    throw new Error(`Tinycast settings not found for ${bundleId}. Is Tinycast installed?`);
  }
  const plist = parsePlistXML(stdout);
  return { settings: decodeAISettings(plist), rawKeys: listRawAIKeys(plist) };
}

const SETUP_HINT = "Add an API connection in Tinycast → Settings → AI → Providers.";
const APPLE_HINT =
  "Add an API connection or switch on the Claude or Codex tool in Tinycast → Settings → AI → Providers.";
const UNSUPPORTED: Record<string, string> = { grok: "Grok", openCode: "OpenCode", cursor: "Cursor" };
const CLI_TOOLS = ["claude", "codex"] as const;
const CLAUDE_ALIASES = ["", "haiku", "sonnet", "opus"];

/** A claude/codex default is usable unless disabled; with an installed-tools list it must be in it. */
function cliDefaultUsable(settings: TinycastAISettings, kind: string): boolean {
  const { disabledRoutes, enabledInstalledProviders: on } = settings;
  return !disabledRoutes.includes(kind) && (on.length === 0 || on.includes(kind));
}

export function resolveRoute(settings: TinycastAISettings, override?: RouteOverride | null): RouteResolution {
  const { connections, defaultModel: def, disabledRoutes, enabledInstalledProviders: on } = settings;
  const enabled = (key: string) => !disabledRoutes.includes(key);

  if (override?.kind === "api") {
    const c = connections.find((x) => x.id === override.connection);
    if (c && enabled(`api:${c.id}`)) return { ok: true, route: { kind: "api", connection: c, model: override.model } };
  } else if (
    override?.kind === "cli" &&
    enabled(override.tool) &&
    (on.includes(override.tool) || def?.kind === override.tool)
  ) {
    return { ok: true, route: { kind: "cli", tool: override.tool, model: override.model } };
  }

  if (def?.kind === "api") {
    const c = connections.find((x) => x.id === def.connection);
    if (c && enabled(`api:${c.id}`)) return { ok: true, route: { kind: "api", connection: c, model: def.model } };
  } else if ((def?.kind === "claude" || def?.kind === "codex") && cliDefaultUsable(settings, def.kind)) {
    return { ok: true, route: { kind: "cli", tool: def.kind, model: def.model } };
  }

  const first = connections.find((c) => c.models.length > 0 && enabled(`api:${c.id}`));
  if (first) return { ok: true, route: { kind: "api", connection: first, model: first.models[0] } };

  for (const tool of CLI_TOOLS) {
    if (on.includes(tool) && enabled(tool)) return { ok: true, route: { kind: "cli", tool, model: "" } };
  }

  if (def?.kind === "appleIntelligence") {
    return { ok: false, reason: `Apple Intelligence can't be used by extensions. ${APPLE_HINT}` };
  }
  if (def && def.kind in UNSUPPORTED) {
    return { ok: false, reason: `${UNSUPPORTED[def.kind]} isn't supported yet. ${SETUP_HINT}` };
  }
  return { ok: false, reason: "No AI provider is set up. Add one in Tinycast → Settings → AI → Providers." };
}

export function listRouteChoices(settings: TinycastAISettings): RouteChoice[] {
  const { connections, defaultModel: def, disabledRoutes, enabledInstalledProviders: on } = settings;
  const enabled = (key: string) => !disabledRoutes.includes(key);
  const resolved = resolveRoute(settings);
  const out: RouteChoice[] = [];
  const isDefault = (r: RouteOverride) => {
    if (!resolved.ok) return false;
    const x = resolved.route;
    return r.kind === "api"
      ? x.kind === "api" && x.connection.id === r.connection && x.model === r.model
      : x.kind === "cli" && x.tool === r.tool && x.model === r.model;
  };
  const push = (id: string, source: string, override: RouteOverride) =>
    out.push({ id, model: override.model, source, override, isDefault: isDefault(override) });

  for (const c of connections) {
    if (!enabled(`api:${c.id}`)) continue;
    const source = c.name.trim() || PROVIDER_TITLES[c.provider];
    const models = [...c.models];
    if (def?.kind === "api" && def.connection === c.id && def.model && !models.includes(def.model)) {
      models.unshift(def.model);
    }
    for (const model of models) push(`api:${c.id}:${model}`, source, { kind: "api", connection: c.id, model });
  }
  for (const tool of CLI_TOOLS) {
    const defModel = def?.kind === tool ? def.model : "";
    let models: string[];
    if (on.includes(tool) && enabled(tool)) {
      models = tool === "claude" ? [...CLAUDE_ALIASES] : [""];
      if (defModel && !models.includes(defModel)) models.unshift(defModel);
    } else if (def?.kind === tool && cliDefaultUsable(settings, tool)) {
      models = [defModel];
    } else continue;
    for (const model of models) push(`cli:${tool}:${model}`, CLI_TITLES[tool], { kind: "cli", tool, model });
  }
  return out;
}
