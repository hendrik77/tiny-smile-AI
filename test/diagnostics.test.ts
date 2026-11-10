import { describe, expect, it } from "vitest";
import { formatDiagnostics, redact, type DiagnosticsInput } from "../src/lib/diagnostics";
import type { TinycastAISettings } from "../src/lib/types";

const ID = "6F9619FF-8B86-D011-B42D-00C04FC964FF";
const ID2 = "11111111-2222-3333-4444-555555555555";

const settings: TinycastAISettings = {
  connections: [
    {
      id: ID,
      name: "My Claude",
      provider: "anthropic",
      baseURL: "https://user:pass@api.anthropic.com/v1?key=abc",
      models: ["claude-x", "claude-y"],
      reasoningEfforts: { "claude-x": ["low", "high"] },
    },
    { id: ID2, name: "Broken", provider: "openAICompatible", baseURL: "not a url", models: [] },
  ],
  defaultModel: { kind: "api", connection: ID, model: "claude-x" },
  disabledRoutes: [`api:${ID2}`, "codex"],
  enabledInstalledProviders: ["claude"],
};

function input(over: Partial<DiagnosticsInput> = {}): DiagnosticsInput {
  return {
    extensionVersion: "1.2.3",
    bundleId: "com.tinycast.app",
    rawKeys: [
      { name: "aiConnections", type: "data" },
      { name: "aiDisabledRoutes", type: "array" },
    ],
    settings,
    override: null,
    resolution: {
      ok: true,
      route: { kind: "api", connection: settings.connections[0], model: "claude-x" },
    },
    secrets: { apiKey: "found", headerNames: ["X-Org"] },
    effort: "low",
    minimizeThinking: true,
    resultCount: 24,
    raycastAI: false,
    ...over,
  };
}

describe("redact", () => {
  it("masks key-like strings", () => {
    const out = redact("bad sk-ant-abc123XYZ and Bearer abc.def and ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 ok");
    expect(out).not.toMatch(/sk-ant/);
    expect(out).not.toMatch(/abc\.def/);
    expect(out).not.toMatch(/ABCDEFGHIJKLMNOP/);
    expect(out).toContain("[redacted]");
    expect(out).toContain("bad");
  });
  it("keeps normal text", () => {
    expect(redact("HTTP 401: unauthorized")).toBe("HTTP 401: unauthorized");
  });
});

describe("formatDiagnostics", () => {
  const text = formatDiagnostics(input());

  it("has header", () => {
    expect(text).toContain("Tiny Smile AI diagnostics");
    expect(text).toContain("1.2.3");
    expect(text).toContain("com.tinycast.app");
    expect(text).toMatch(/Raycast AI: no/);
  });

  it("lists raw ai keys with types", () => {
    expect(text).toContain("Tinycast AI settings keys");
    expect(text).toContain("aiConnections: data");
    expect(text).toContain("aiDisabledRoutes: array");
  });

  it("prints settingsError instead of keys, redacted", () => {
    const t = formatDiagnostics(
      input({
        rawKeys: undefined,
        settings: undefined,
        resolution: undefined,
        secrets: undefined,
        settingsError: "boom sk-secretsecret1",
      }),
    );
    expect(t).toContain("boom");
    expect(t).not.toContain("sk-secretsecret1");
    expect(t).not.toContain("aiConnections: data");
  });

  it("shows default model with connection name", () => {
    expect(text).toMatch(/Default model[\s\S]*api[\s\S]*claude-x[\s\S]*My Claude/);
  });

  it("flags missing default connection", () => {
    const t = formatDiagnostics(
      input({ settings: { ...settings, defaultModel: { kind: "api", connection: "ZZZ", model: "m" } } }),
    );
    expect(t).toContain("(connection not found)");
  });

  it("shows non-api default kind", () => {
    const t = formatDiagnostics(input({ settings: { ...settings, defaultModel: { kind: "claude", model: "haiku" } } }));
    expect(t).toMatch(/claude.*haiku/);
  });

  it("shows connections with host only", () => {
    expect(text).toContain("My Claude");
    expect(text).toContain("anthropic");
    expect(text).toContain("https://api.anthropic.com");
    expect(text).toContain("claude-x, claude-y");
    expect(text).toContain("low, high");
    expect(text).toContain("(invalid URL)");
    expect(text).toContain("disabled");
  });

  it("never leaks URL parts", () => {
    expect(text).not.toContain("user:pass");
    expect(text).not.toContain("key=abc");
    expect(text).not.toContain("/v1");
  });

  it("replaces UUIDs in disabled routes by names", () => {
    expect(text).toMatch(/Disabled routes[\s\S]*api:Broken/);
    expect(text).toContain("codex");
    expect(text).toMatch(/Installed tools switched on[\s\S]*claude/);
  });

  it("shows choice and resolved route", () => {
    expect(text).toMatch(/Chosen for emoji search: Tinycast default/);
    expect(text).toContain("Resolved route: My Claude · claude-x");
    const t = formatDiagnostics(input({ override: { kind: "cli", tool: "claude", model: "haiku" } }));
    expect(t).toMatch(/Chosen for emoji search: .*claude.*haiku/);
  });

  it("shows failure reason", () => {
    const t = formatDiagnostics(
      input({ resolution: { ok: false, reason: "No AI provider is set up." }, secrets: undefined }),
    );
    expect(t).toContain("No AI provider is set up.");
  });

  it("shows api key status and header names only", () => {
    expect(text).toContain("API key: found");
    expect(text).toContain("Custom headers: X-Org");
    const t = formatDiagnostics(
      input({ secrets: { apiKey: "error", headerNames: [], error: "denied Bearer abcdefgh" } }),
    );
    expect(t).toContain("API key: error");
    expect(t).toContain("denied");
    expect(t).not.toContain("abcdefgh");
  });

  it("shows cli path or not found", () => {
    const route = { ok: true as const, route: { kind: "cli" as const, tool: "claude" as const, model: "" } };
    expect(
      formatDiagnostics(
        input({ resolution: route, secrets: undefined, cli: { tool: "claude", path: "/opt/homebrew/bin/claude" } }),
      ),
    ).toContain("Executable: /opt/homebrew/bin/claude");
    expect(
      formatDiagnostics(input({ resolution: route, secrets: undefined, cli: { tool: "claude", path: null } })),
    ).toContain("Executable: not found");
  });

  it("shows speed, suggestions and last error redacted", () => {
    expect(text).toMatch(/Minimize thinking: on/);
    expect(text).toMatch(/Effort sent: low/);
    expect(text).toMatch(/Suggestions: 24/);
    expect(text).not.toContain("Last error");
    const off = formatDiagnostics(
      input({ minimizeThinking: false, effort: null, lastError: "fail sk-abcdef123456 x" }),
    );
    expect(off).toMatch(/Minimize thinking: off/);
    expect(off).toMatch(/Effort sent: none/);
    expect(off).toContain("Last error: fail [redacted] x");
  });

  it("reports raycast AI", () => {
    const t = formatDiagnostics(
      input({ raycastAI: true, rawKeys: undefined, settings: undefined, resolution: undefined, secrets: undefined }),
    );
    expect(t).toMatch(/Raycast AI: yes/);
  });

  it("ends with a secret-free JSON fixture", () => {
    const m = text.match(/Fixture \(no secrets\)\n```json\n([\s\S]*?)\n```/);
    expect(m).toBeTruthy();
    const json = JSON.parse(m![1]);
    expect(json.defaultModel).toEqual({ kind: "api", connection: ID, model: "claude-x" });
    expect(json.connections[0]).toEqual({
      id: ID,
      name: "My Claude",
      provider: "anthropic",
      host: "https://api.anthropic.com",
      models: ["claude-x", "claude-y"],
      reasoningEfforts: { "claude-x": ["low", "high"] },
    });
    expect(json.disabledRoutes).toEqual([`api:${ID2}`, "codex"]);
    expect(json.enabledInstalledProviders).toEqual(["claude"]);
    expect(m![1]).not.toContain("baseURL");
  });

  it("never contains secrets in any combination", () => {
    const t = formatDiagnostics(
      input({ lastError: "x sk-live-ABCDEF123456", secrets: { apiKey: "found", headerNames: ["Authorization"] } }),
    );
    expect(t).not.toContain("sk-live");
  });
});

describe("name search section", () => {
  it("reports language, system locale and skin tone", () => {
    const out = formatDiagnostics(input({ language: "de", systemLocale: "de-DE", skinTone: "medium" }));
    expect(out).toContain("## Name search");
    expect(out).toContain("Language: de");
    expect(out).toContain("System locale: de-DE");
    expect(out).toContain("Skin tone: medium");
  });
  it("says unknown when the locale is missing and defaults the rest", () => {
    const out = formatDiagnostics(input());
    expect(out).toContain("System locale: unknown");
    expect(out).toContain("Language: en");
    expect(out).toContain("Skin tone: none");
  });
});

describe("launch section", () => {
  const launch = (over: Partial<NonNullable<DiagnosticsInput["launch"]>> = {}) => ({
    querySource: "none" as const,
    selection: { status: "off" as const },
    recents: [] as string[],
    usageEntries: 0,
    ...over,
  });

  it("is omitted without launch info", () => {
    expect(formatDiagnostics(input())).not.toContain("## Launch");
  });
  it("reports argument source, preference off, recents and usage", () => {
    const out = formatDiagnostics(
      input({
        launch: launch({
          querySource: "argument",
          recents: ["🎉", "🥳", "🔥", "😀", "😂", "🙏", "👍", "❤️", "🐱", "🐶"],
          usageEntries: 12,
        }),
      }),
    );
    expect(out).toContain("## Launch");
    expect(out).toContain("Query source: argument");
    expect(out).toContain("Selected text: off (preference)");
    expect(out).toContain("Recents: 10 (🎉 🥳 🔥 😀 😂 🙏 👍 ❤️)");
    expect(out).not.toContain("🐱");
    expect(out).toContain("Usage entries: 12");
  });
  it("reports a used selection by length only", () => {
    const out = formatDiagnostics(
      input({ launch: launch({ querySource: "selection", selection: { status: "used", length: 42 } }) }),
    );
    expect(out).toContain("Query source: selected text");
    expect(out).toContain("Selected text: used (42 characters)");
    expect(out).toContain("Recents: 0");
  });
  it("reports why a selection was not used, redacted", () => {
    const out = formatDiagnostics(
      input({
        launch: launch({
          selection: { status: "unused", reason: "No selection sk-abcdefghijklmnop1234" },
        }),
      }),
    );
    expect(out).toContain("Query source: none");
    expect(out).toContain("Selected text: not used: No selection [redacted]");
  });
});

describe("tone and combinations lines", () => {
  it("prints them next to the speed settings", () => {
    const text = formatDiagnostics(input({ tone: "work", combos: true }));
    expect(text).toContain("Tone: work");
    expect(text).toContain("Combinations: on");
    expect(text.indexOf("Tone: work")).toBeGreaterThan(text.indexOf("## Speed"));
    expect(text.indexOf("Tone: work")).toBeLessThan(text.indexOf("## Name search"));
  });
  it("defaults to any and off", () => {
    const text = formatDiagnostics(input());
    expect(text).toContain("Tone: any");
    expect(text).toContain("Combinations: off");
  });
});
