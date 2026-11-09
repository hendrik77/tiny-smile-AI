import { describe, it, expect } from "vitest";
import {
  decodeAISettings,
  listRawAIKeys,
  listRouteChoices,
  PROVIDER_TITLES,
  readTinycastAISettings,
  readTinycastAISettingsDetailed,
  resolveRoute,
  routeLabel,
} from "../src/lib/tinycast-settings";
import type { AIConnection, ExecFn, TinycastAISettings } from "../src/lib/types";

const data = (v: unknown) => new Uint8Array(Buffer.from(typeof v === "string" ? v : JSON.stringify(v)));
const C1 = "6F9619FF-8B86-D011-B42D-00C04FC964FF";
const C2 = "11111111-2222-3333-4444-555555555555";
const conn = (id: string, models: string[] = ["m1", "m2"]): AIConnection => ({
  id,
  name: "n" + id.slice(0, 2),
  provider: "anthropic",
  baseURL: "https://api.anthropic.com",
  models,
});

describe("decodeAISettings", () => {
  it("decodes connections, default model, and disabled routes", () => {
    const s = decodeAISettings({
      aiConnections: data(
        '[{"id":"' +
          C1 +
          '","name":"My Claude","provider":"anthropic","baseURL":"https:\\/\\/api.anthropic.com","models":["claude-sonnet-4-5"],"visionModels":[],"outputLimits":{}}]',
      ),
      aiDefaultModel: data({ api: { connection: C1, model: "gpt-4.1", effort: "low" } }),
      aiDisabledRoutes: ["api:X", "claude"],
    });
    expect(s.connections).toEqual([
      {
        id: C1,
        name: "My Claude",
        provider: "anthropic",
        baseURL: "https://api.anthropic.com",
        models: ["claude-sonnet-4-5"],
      },
    ]);
    expect(s.defaultModel).toEqual({ kind: "api", connection: C1, model: "gpt-4.1", effort: "low" });
    expect(s.disabledRoutes).toEqual(["api:X", "claude"]);
  });
  it("is tolerant of missing/invalid values", () => {
    expect(decodeAISettings({})).toEqual({
      connections: [],
      defaultModel: null,
      disabledRoutes: [],
      enabledInstalledProviders: [],
    });
    expect(decodeAISettings(null)).toEqual({
      connections: [],
      defaultModel: null,
      disabledRoutes: [],
      enabledInstalledProviders: [],
    });
    expect(decodeAISettings({ aiConnections: data("garbage"), aiDefaultModel: "x", aiDisabledRoutes: "y" })).toEqual({
      connections: [],
      defaultModel: null,
      disabledRoutes: [],
      enabledInstalledProviders: [],
    });
  });
  it("drops invalid connections and defaults models", () => {
    const s = decodeAISettings({
      aiConnections: data([
        { id: C1, name: "ok", provider: "openAI", baseURL: "https://api.openai.com/v1" },
        { name: "noid", provider: "openAI", baseURL: "x" },
        { id: "a", name: "nop", baseURL: "x" },
        { id: "b", name: "nourl", provider: "openAI" },
        { id: "c", name: "bad", provider: "mystery", baseURL: "x" },
        { id: "d", provider: "gemini", baseURL: "x", models: ["g", 3] },
        "str",
      ]),
    });
    expect(s.connections.map((c) => c.id)).toEqual([C1, "d"]);
    expect(s.connections[0].models).toEqual([]);
    expect(s.connections[1].models).toEqual(["g"]);
    expect(s.connections[1].name).toBe("d");
  });
  it("maps model selections", () => {
    const d = (v: unknown) => decodeAISettings({ aiDefaultModel: data(v) }).defaultModel;
    expect(d({ appleIntelligence: {} })).toEqual({ kind: "appleIntelligence" });
    expect(d({ claude: { model: "sonnet" } })).toEqual({ kind: "claude", model: "sonnet" });
    expect(d({ codex: { model: "gpt-5" } })).toEqual({ kind: "codex", model: "gpt-5" });
    expect(d({ chatGPT: { model: "gpt-5" } })).toEqual({ kind: "codex", model: "gpt-5" });
    expect(d({ grok: { model: "g" } })).toEqual({ kind: "grok", model: "g" });
    expect(d({ openCode: { model: "o" } })).toEqual({ kind: "openCode", model: "o" });
    expect(d({ cursor: {} })).toEqual({ kind: "cursor", model: "" });
    expect(d({ bogus: {} })).toBeNull();
    expect(d({ api: { model: "m" } })).toBeNull();
  });
});

describe("reasoningOptions decoding", () => {
  const dec = (extra: Record<string, unknown>) =>
    decodeAISettings({
      aiConnections: data([
        { id: C1, name: "a", provider: "openAI", baseURL: "https://api.openai.com/v1", models: ["gpt-5"], ...extra },
      ]),
    }).connections[0];
  it("decodes efforts per model", () => {
    const c = dec({
      reasoningOptions: {
        "gpt-5": { efforts: ["default", "minimal", "low", "medium", "high"], defaultEffort: "default" },
      },
    });
    expect(c.reasoningEfforts).toEqual({ "gpt-5": ["default", "minimal", "low", "medium", "high"] });
  });
  it("omits the field for garbage or missing options", () => {
    expect("reasoningEfforts" in dec({})).toBe(false);
    expect("reasoningEfforts" in dec({ reasoningOptions: "x" })).toBe(false);
    expect(
      "reasoningEfforts" in dec({ reasoningOptions: { m: { efforts: "low" }, n: 3, o: { efforts: [1, 2] } } }),
    ).toBe(false);
  });
  it("keeps only string entries and valid models", () => {
    const c = dec({ reasoningOptions: { a: { efforts: ["low", 3, "high"] }, b: { nope: 1 } } });
    expect(c.reasoningEfforts).toEqual({ a: ["low", "high"] });
  });
});

describe("listRouteChoices", () => {
  const base = (o: Partial<TinycastAISettings>): TinycastAISettings => ({
    connections: [],
    defaultModel: null,
    disabledRoutes: [],
    enabledInstalledProviders: [],
    ...o,
  });
  it("returns [] for empty settings", () => {
    expect(listRouteChoices(base({}))).toEqual([]);
  });
  it("lists models in connection then model order with ids, sources and default flag", () => {
    const c1 = { ...conn(C1, ["a", "b"]), name: "  Mine " };
    const c2 = { ...conn(C2, ["z"]), name: "  ", provider: "gemini" as const };
    const r = listRouteChoices(
      base({ connections: [c1, c2], defaultModel: { kind: "api", connection: C1, model: "b" } }),
    );
    expect(r.map((x) => x.id)).toEqual([`api:${C1}:a`, `api:${C1}:b`, `api:${C2}:z`]);
    expect(r.map((x) => x.source)).toEqual(["Mine", "Mine", PROVIDER_TITLES.gemini]);
    expect(PROVIDER_TITLES.gemini).toBe("Google Gemini");
    expect(r.map((x) => x.isDefault)).toEqual([false, true, false]);
    expect(r[0]).toMatchObject({ model: "a", override: { kind: "api", connection: C1, model: "a" } });
  });
  it("excludes disabled connections", () => {
    const r = listRouteChoices(base({ connections: [conn(C1), conn(C2, ["z"])], disabledRoutes: ["api:" + C1] }));
    expect(r.map((x) => x.id)).toEqual([`api:${C2}:z`]);
  });
  it("includes a default model that is not in the list, first, flagged default", () => {
    const r = listRouteChoices(
      base({ connections: [conn(C1, ["a"])], defaultModel: { kind: "api", connection: C1, model: "odd" } }),
    );
    expect(r.map((x) => x.model)).toEqual(["odd", "a"]);
    expect(r.map((x) => x.isDefault)).toEqual([true, false]);
  });
  it("adds a cli choice for an enabled claude/codex default", () => {
    const r = listRouteChoices(
      base({ connections: [conn(C1, ["a"])], defaultModel: { kind: "claude", model: "sonnet" } }),
    );
    expect(r.find((x) => x.id === "cli:claude:sonnet")).toEqual({
      id: "cli:claude:sonnet",
      model: "sonnet",
      source: "Claude Code",
      override: { kind: "cli", tool: "claude", model: "sonnet" },
      isDefault: true,
    });
    expect(r.find((x) => x.id === `api:${C1}:a`)?.isDefault).toBe(false);
    const x = listRouteChoices(base({ defaultModel: { kind: "codex", model: "g" } }));
    expect(x[0]).toMatchObject({ id: "cli:codex:g", source: "Codex" });
    expect(listRouteChoices(base({ defaultModel: { kind: "codex", model: "g" }, disabledRoutes: ["codex"] }))).toEqual(
      [],
    );
  });
  it("flags the fall-forward route as default when the real default is unusable", () => {
    const r = listRouteChoices(
      base({ connections: [conn(C2, ["z", "y"])], defaultModel: { kind: "api", connection: C1, model: "m" } }),
    );
    expect(r.map((x) => x.isDefault)).toEqual([true, false]);
  });
  it("flags nothing when resolveRoute fails", () => {
    const r = listRouteChoices(base({ connections: [conn(C1, ["a"])], disabledRoutes: ["api:" + C1] }));
    expect(r).toEqual([]);
    const r2 = listRouteChoices(base({ connections: [conn(C1, [])] }));
    expect(r2.some((x) => x.isDefault)).toBe(false);
  });
});

describe("readTinycastAISettings", () => {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>aiDisabledRoutes</key><array><string>codex</string></array>
<key>aiDefaultModel</key><data>${Buffer.from('{"appleIntelligence":{}}').toString("base64")}</data></dict></plist>`;
  it("runs defaults export and decodes", async () => {
    const calls: Array<[string, string[]]> = [];
    const exec: ExecFn = async (f, a) => {
      calls.push([f, a]);
      return { stdout: plist, stderr: "" };
    };
    const s = await readTinycastAISettings("com.tinycast.app", exec);
    expect(calls).toEqual([["/usr/bin/defaults", ["export", "com.tinycast.app", "-"]]]);
    expect(s).toEqual({
      connections: [],
      defaultModel: { kind: "appleIntelligence" },
      disabledRoutes: ["codex"],
      enabledInstalledProviders: [],
    });
  });
  it("throws a helpful error when defaults fails", async () => {
    const exec: ExecFn = async () => {
      throw new Error("Domain com.x does not exist");
    };
    await expect(readTinycastAISettings("com.x", exec)).rejects.toThrow(
      "Tinycast settings not found for com.x. Is Tinycast installed?",
    );
  });
});

describe("resolveRoute", () => {
  const base = (o: Partial<TinycastAISettings>): TinycastAISettings => ({
    connections: [],
    defaultModel: null,
    disabledRoutes: [],
    enabledInstalledProviders: [],
    ...o,
  });
  it("uses an enabled api default even if the model is not listed", () => {
    const c = conn(C1);
    const r = resolveRoute(base({ connections: [c], defaultModel: { kind: "api", connection: C1, model: "other" } }));
    expect(r).toEqual({ ok: true, route: { kind: "api", connection: c, model: "other" } });
  });
  it("skips a disabled or missing api default and falls forward", () => {
    const c1 = conn(C1),
      c2 = conn(C2, ["z", "y"]);
    const d = { kind: "api", connection: C1, model: "m" } as const;
    expect(resolveRoute(base({ connections: [c1, c2], defaultModel: d, disabledRoutes: ["api:" + C1] }))).toEqual({
      ok: true,
      route: { kind: "api", connection: c2, model: "z" },
    });
    expect(resolveRoute(base({ connections: [c2], defaultModel: d }))).toEqual({
      ok: true,
      route: { kind: "api", connection: c2, model: "z" },
    });
  });
  it("uses enabled cli defaults", () => {
    expect(resolveRoute(base({ defaultModel: { kind: "claude", model: "sonnet" } }))).toEqual({
      ok: true,
      route: { kind: "cli", tool: "claude", model: "sonnet" },
    });
    expect(resolveRoute(base({ defaultModel: { kind: "codex", model: "gpt-5" } }))).toEqual({
      ok: true,
      route: { kind: "cli", tool: "codex", model: "gpt-5" },
    });
  });
  it("falls forward from a disabled cli default; skips connections without models", () => {
    const c = conn(C2, ["a"]);
    const r = resolveRoute(
      base({
        connections: [conn(C1, []), c],
        defaultModel: { kind: "claude", model: "s" },
        disabledRoutes: ["claude"],
      }),
    );
    expect(r).toEqual({ ok: true, route: { kind: "api", connection: c, model: "a" } });
  });
  it("explains failures", () => {
    expect(resolveRoute(base({ defaultModel: { kind: "appleIntelligence" } }))).toEqual({
      ok: false,
      reason:
        "Apple Intelligence can't be used by extensions. Add an API connection or switch on the Claude or Codex tool in Tinycast → Settings → AI → Providers.",
    });
    const g = resolveRoute(base({ defaultModel: { kind: "grok", model: "x" } }));
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reason).toMatch(/^Grok isn't supported yet/);
    const o = resolveRoute(base({ defaultModel: { kind: "openCode", model: "x" } }));
    if (!o.ok) expect(o.reason).toMatch(/^OpenCode isn't supported yet/);
    const cu = resolveRoute(base({ defaultModel: { kind: "cursor", model: "x" } }));
    if (!cu.ok) expect(cu.reason).toMatch(/^Cursor isn't supported yet/);
    expect(resolveRoute(base({}))).toEqual({
      ok: false,
      reason: "No AI provider is set up. Add one in Tinycast → Settings → AI → Providers.",
    });
  });
});

describe("resolveRoute with override", () => {
  const base = (o: Partial<TinycastAISettings>): TinycastAISettings => ({
    connections: [],
    defaultModel: null,
    disabledRoutes: [],
    enabledInstalledProviders: [],
    ...o,
  });
  const c1 = conn(C1),
    c2 = conn(C2, ["z"]);
  const def = { kind: "api", connection: C1, model: "m1" } as const;
  it("uses a valid api override, even for an unlisted model", () => {
    const s = base({ connections: [c1, c2], defaultModel: def });
    expect(resolveRoute(s, { kind: "api", connection: C2, model: "z" })).toEqual({
      ok: true,
      route: { kind: "api", connection: c2, model: "z" },
    });
    expect(resolveRoute(s, { kind: "api", connection: C2, model: "unlisted" })).toEqual({
      ok: true,
      route: { kind: "api", connection: c2, model: "unlisted" },
    });
  });
  it("falls back to the default for disabled/missing connections", () => {
    const expected = { ok: true, route: { kind: "api", connection: c1, model: "m1" } };
    const ov = { kind: "api", connection: C2, model: "z" } as const;
    expect(resolveRoute(base({ connections: [c1, c2], defaultModel: def, disabledRoutes: ["api:" + C2] }), ov)).toEqual(
      expected,
    );
    expect(resolveRoute(base({ connections: [c1], defaultModel: def }), ov)).toEqual(expected);
    expect(resolveRoute(base({ connections: [c1], defaultModel: def }), null)).toEqual(expected);
  });
  it("supports cli overrides when enabled", () => {
    const s = base({ connections: [c1], defaultModel: def, enabledInstalledProviders: ["codex"] });
    expect(resolveRoute(s, { kind: "cli", tool: "codex", model: "g" })).toEqual({
      ok: true,
      route: { kind: "cli", tool: "codex", model: "g" },
    });
    expect(resolveRoute({ ...s, disabledRoutes: ["codex"] }, { kind: "cli", tool: "codex", model: "g" })).toEqual({
      ok: true,
      route: { kind: "api", connection: c1, model: "m1" },
    });
  });
});

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");

describe("aiInstalledProviders decoding", () => {
  it("decodes the enabled installed tools", () => {
    expect(decodeAISettings({ aiInstalledProviders: data(["claude", "codex"]) }).enabledInstalledProviders).toEqual([
      "claude",
      "codex",
    ]);
  });
  it("is tolerant of garbage and a missing key", () => {
    expect(decodeAISettings({ aiInstalledProviders: data("garbage") }).enabledInstalledProviders).toEqual([]);
    expect(decodeAISettings({ aiInstalledProviders: "x" }).enabledInstalledProviders).toEqual([]);
    expect(decodeAISettings({ aiInstalledProviders: data({ a: 1 }) }).enabledInstalledProviders).toEqual([]);
    expect(decodeAISettings({}).enabledInstalledProviders).toEqual([]);
  });
  it("drops non-string entries", () => {
    expect(decodeAISettings({ aiInstalledProviders: data(["claude", 3, null]) }).enabledInstalledProviders).toEqual([
      "claude",
    ]);
  });
  it("reads the key from the plist", async () => {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>aiInstalledProviders</key><data>${b64(["claude"])}</data></dict></plist>`;
    const s = await readTinycastAISettings("x", async () => ({ stdout: plist, stderr: "" }));
    expect(s.enabledInstalledProviders).toEqual(["claude"]);
  });
});

describe("resolveRoute with installed tools", () => {
  const base = (o: Partial<TinycastAISettings>): TinycastAISettings => ({
    connections: [],
    defaultModel: { kind: "appleIntelligence" },
    disabledRoutes: [],
    enabledInstalledProviders: [],
    ...o,
  });
  it("Apple default + claude installed -> claude CLI default model", () => {
    expect(resolveRoute(base({ enabledInstalledProviders: ["claude"] }))).toEqual({
      ok: true,
      route: { kind: "cli", tool: "claude", model: "" },
    });
  });
  it("Apple default + API connection + claude installed -> API wins", () => {
    const c = conn(C1, ["m1"]);
    expect(resolveRoute(base({ connections: [c], enabledInstalledProviders: ["claude"] }))).toEqual({
      ok: true,
      route: { kind: "api", connection: c, model: "m1" },
    });
  });
  it("falls back to codex when only codex is enabled; claude preferred over codex", () => {
    expect(resolveRoute(base({ enabledInstalledProviders: ["codex"] }))).toEqual({
      ok: true,
      route: { kind: "cli", tool: "codex", model: "" },
    });
    expect(resolveRoute(base({ enabledInstalledProviders: ["codex", "claude"] }))).toEqual({
      ok: true,
      route: { kind: "cli", tool: "claude", model: "" },
    });
  });
  it("skips fallback tools listed in disabledRoutes", () => {
    const r = resolveRoute(base({ enabledInstalledProviders: ["claude", "codex"], disabledRoutes: ["claude"] }));
    expect(r).toEqual({ ok: true, route: { kind: "cli", tool: "codex", model: "" } });
  });
  it("claude default not enabled-installed while the key is present falls forward", () => {
    const def = { kind: "claude", model: "sonnet" } as const;
    expect(resolveRoute(base({ defaultModel: def, enabledInstalledProviders: ["codex"] }))).toEqual({
      ok: true,
      route: { kind: "cli", tool: "codex", model: "" },
    });
    const c = conn(C1, ["m1"]);
    expect(resolveRoute(base({ defaultModel: def, connections: [c], enabledInstalledProviders: ["codex"] }))).toEqual({
      ok: true,
      route: { kind: "api", connection: c, model: "m1" },
    });
  });
  it("claude default enabled-installed is used with its model", () => {
    expect(
      resolveRoute(base({ defaultModel: { kind: "claude", model: "sonnet" }, enabledInstalledProviders: ["claude"] })),
    ).toEqual({
      ok: true,
      route: { kind: "cli", tool: "claude", model: "sonnet" },
    });
  });
  it("cli override valid when the tool is enabled-installed or is the default's tool", () => {
    const ov = { kind: "cli", tool: "claude", model: "opus" } as const;
    expect(resolveRoute(base({ enabledInstalledProviders: ["claude"] }), ov)).toEqual({
      ok: true,
      route: { kind: "cli", tool: "claude", model: "opus" },
    });
    expect(resolveRoute(base({ defaultModel: { kind: "claude", model: "s" } }), ov)).toEqual({
      ok: true,
      route: { kind: "cli", tool: "claude", model: "opus" },
    });
    expect(resolveRoute(base({}), ov).ok).toBe(false);
  });
  it("uses the new Apple message and still fails with nothing configured", () => {
    const r = resolveRoute(base({}));
    expect(r).toEqual({
      ok: false,
      reason:
        "Apple Intelligence can't be used by extensions. Add an API connection or switch on the Claude or Codex tool in Tinycast → Settings → AI → Providers.",
    });
    expect(resolveRoute(base({ defaultModel: null })).ok).toBe(false);
  });
});

describe("listRouteChoices with installed tools", () => {
  const base = (o: Partial<TinycastAISettings>): TinycastAISettings => ({
    connections: [],
    defaultModel: { kind: "appleIntelligence" },
    disabledRoutes: [],
    enabledInstalledProviders: [],
    ...o,
  });
  it("lists claude default model and aliases; default flag on the resolved one", () => {
    const r = listRouteChoices(base({ enabledInstalledProviders: ["claude"] }));
    expect(r.map((x) => x.id)).toEqual(["cli:claude:", "cli:claude:haiku", "cli:claude:sonnet", "cli:claude:opus"]);
    expect(r.every((x) => x.source === "Claude Code")).toBe(true);
    expect(r.map((x) => x.isDefault)).toEqual([true, false, false, false]);
    expect(r[0].override).toEqual({ kind: "cli", tool: "claude", model: "" });
  });
  it("lists codex default plus the default's codex model", () => {
    const r = listRouteChoices(
      base({ defaultModel: { kind: "codex", model: "gpt-5" }, enabledInstalledProviders: ["codex"] }),
    );
    expect(r.map((x) => x.id)).toEqual(["cli:codex:gpt-5", "cli:codex:"]);
    expect(r.map((x) => x.isDefault)).toEqual([true, false]);
    expect(r.every((x) => x.source === "Codex")).toBe(true);
  });
  it("includes the default claude model exactly once", () => {
    const odd = listRouteChoices(
      base({ defaultModel: { kind: "claude", model: "claude-x" }, enabledInstalledProviders: ["claude"] }),
    );
    expect(odd.map((x) => x.model)).toEqual(["claude-x", "", "haiku", "sonnet", "opus"]);
    expect(odd.filter((x) => x.isDefault).map((x) => x.model)).toEqual(["claude-x"]);
    const known = listRouteChoices(
      base({ defaultModel: { kind: "claude", model: "sonnet" }, enabledInstalledProviders: ["claude"] }),
    );
    expect(known.map((x) => x.model)).toEqual(["", "haiku", "sonnet", "opus"]);
    expect(known.filter((x) => x.isDefault).map((x) => x.model)).toEqual(["sonnet"]);
  });
  it("omits tools that are not enabled or are disabled", () => {
    expect(listRouteChoices(base({}))).toEqual([]);
    expect(listRouteChoices(base({ enabledInstalledProviders: ["claude"], disabledRoutes: ["claude"] }))).toEqual([]);
  });
});

describe("listRawAIKeys", () => {
  it("lists only ai* keys, sorted, with plist types", () => {
    const keys = listRawAIKeys({
      zeta: "x",
      aiZ: 1.5,
      aiConnections: data("[]"),
      aiDisabledRoutes: [],
      aiMap: {},
      aiFlag: true,
      aiName: "s",
      aiCount: 3,
      aiOdd: null,
    });
    expect(keys).toEqual([
      { name: "aiConnections", type: "data" },
      { name: "aiCount", type: "integer" },
      { name: "aiDisabledRoutes", type: "array" },
      { name: "aiFlag", type: "boolean" },
      { name: "aiMap", type: "dict" },
      { name: "aiName", type: "string" },
      { name: "aiOdd", type: "unknown" },
      { name: "aiZ", type: "real" },
    ]);
  });
  it("tolerates non-objects", () => {
    expect(listRawAIKeys(null)).toEqual([]);
    expect(listRawAIKeys("x")).toEqual([]);
  });
});

describe("readTinycastAISettingsDetailed", () => {
  it("returns settings and raw keys", async () => {
    const plist = `<?xml version="1.0"?><plist version="1.0"><dict><key>aiDisabledRoutes</key><array><string>claude</string></array><key>other</key><string>x</string></dict></plist>`;
    const r = await readTinycastAISettingsDetailed("x", async () => ({ stdout: plist, stderr: "" }));
    expect(r.settings.disabledRoutes).toEqual(["claude"]);
    expect(r.rawKeys).toEqual([{ name: "aiDisabledRoutes", type: "array" }]);
  });
});

describe("routeLabel", () => {
  it("labels api and cli routes", () => {
    expect(routeLabel({ kind: "cli", tool: "claude", model: "" })).toBe("Claude Code · default model");
    expect(routeLabel({ kind: "api", connection: conn(C1), model: "m" })).toBe(
      "nC1 · m".replace("nC1", "n" + C1.slice(0, 2)),
    );
  });
});
