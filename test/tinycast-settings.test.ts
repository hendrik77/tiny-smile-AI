import { describe, it, expect } from "vitest";
import { decodeAISettings, readTinycastAISettings, resolveRoute } from "../src/lib/tinycast-settings";
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
        '[{"id":"' + C1 + '","name":"My Claude","provider":"anthropic","baseURL":"https:\\/\\/api.anthropic.com","models":["claude-sonnet-4-5"],"visionModels":[],"outputLimits":{}}]',
      ),
      aiDefaultModel: data({ api: { connection: C1, model: "gpt-4.1", effort: "low" } }),
      aiDisabledRoutes: ["api:X", "claude"],
    });
    expect(s.connections).toEqual([
      { id: C1, name: "My Claude", provider: "anthropic", baseURL: "https://api.anthropic.com", models: ["claude-sonnet-4-5"] },
    ]);
    expect(s.defaultModel).toEqual({ kind: "api", connection: C1, model: "gpt-4.1", effort: "low" });
    expect(s.disabledRoutes).toEqual(["api:X", "claude"]);
  });
  it("is tolerant of missing/invalid values", () => {
    expect(decodeAISettings({})).toEqual({ connections: [], defaultModel: null, disabledRoutes: [] });
    expect(decodeAISettings(null)).toEqual({ connections: [], defaultModel: null, disabledRoutes: [] });
    expect(
      decodeAISettings({ aiConnections: data("garbage"), aiDefaultModel: "x", aiDisabledRoutes: "y" }),
    ).toEqual({ connections: [], defaultModel: null, disabledRoutes: [] });
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
    expect(s).toEqual({ connections: [], defaultModel: { kind: "appleIntelligence" }, disabledRoutes: ["codex"] });
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
    ...o,
  });
  it("uses an enabled api default even if the model is not listed", () => {
    const c = conn(C1);
    const r = resolveRoute(
      base({ connections: [c], defaultModel: { kind: "api", connection: C1, model: "other" } }),
    );
    expect(r).toEqual({ ok: true, route: { kind: "api", connection: c, model: "other" } });
  });
  it("skips a disabled or missing api default and falls forward", () => {
    const c1 = conn(C1), c2 = conn(C2, ["z", "y"]);
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
        "Apple Intelligence can't be used by extensions. Add an API connection in Tinycast → Settings → AI → Providers.",
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
