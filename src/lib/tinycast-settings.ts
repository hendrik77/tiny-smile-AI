import { parsePlistXML } from "./plist";
import type {
  AIConnection,
  ExecFn,
  ModelSelection,
  ProviderKind,
  RouteResolution,
  TinycastAISettings,
} from "./types";

const PROVIDERS: ProviderKind[] = ["openAI", "anthropic", "gemini", "openRouter", "openAICompatible"];

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
    out.push({
      id,
      name: typeof e.name === "string" ? e.name : id,
      provider: provider as ProviderKind,
      baseURL,
      models: Array.isArray(e.models) ? e.models.filter((m): m is string => typeof m === "string") : [],
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

export function decodeAISettings(plist: unknown): TinycastAISettings {
  const p = isObj(plist) ? plist : {};
  const routes = Array.isArray(p.aiDisabledRoutes)
    ? p.aiDisabledRoutes.filter((r): r is string => typeof r === "string")
    : [];
  return {
    connections: decodeConnections(p.aiConnections),
    defaultModel: decodeSelection(p.aiDefaultModel),
    disabledRoutes: routes,
  };
}

export async function readTinycastAISettings(bundleId: string, exec: ExecFn): Promise<TinycastAISettings> {
  let stdout: string;
  try {
    ({ stdout } = await exec("/usr/bin/defaults", ["export", bundleId, "-"]));
  } catch {
    throw new Error(`Tinycast settings not found for ${bundleId}. Is Tinycast installed?`);
  }
  return decodeAISettings(parsePlistXML(stdout));
}

const SETUP_HINT = "Add an API connection in Tinycast → Settings → AI → Providers.";
const UNSUPPORTED: Record<string, string> = { grok: "Grok", openCode: "OpenCode", cursor: "Cursor" };

export function resolveRoute(settings: TinycastAISettings): RouteResolution {
  const { connections, defaultModel: def, disabledRoutes } = settings;
  const enabled = (key: string) => !disabledRoutes.includes(key);

  if (def?.kind === "api") {
    const c = connections.find((x) => x.id === def.connection);
    if (c && enabled(`api:${c.id}`)) return { ok: true, route: { kind: "api", connection: c, model: def.model } };
  } else if ((def?.kind === "claude" || def?.kind === "codex") && enabled(def.kind)) {
    return { ok: true, route: { kind: "cli", tool: def.kind, model: def.model } };
  }

  const first = connections.find((c) => c.models.length > 0 && enabled(`api:${c.id}`));
  if (first) return { ok: true, route: { kind: "api", connection: first, model: first.models[0] } };

  if (def?.kind === "appleIntelligence") {
    return { ok: false, reason: `Apple Intelligence can't be used by extensions. ${SETUP_HINT}` };
  }
  if (def && def.kind in UNSUPPORTED) {
    return { ok: false, reason: `${UNSUPPORTED[def.kind]} isn't supported yet. ${SETUP_HINT}` };
  }
  return { ok: false, reason: "No AI provider is set up. Add one in Tinycast → Settings → AI → Providers." };
}
