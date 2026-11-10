import { describe, expect, it, vi } from "vitest";
import { createSuggester, NoRouteError, routeLabel, type SuggesterDeps } from "../src/lib/suggest";
import type { ExecFn, FetchFn } from "../src/lib/types";

const CONN_ID = "6F9619FF-8B86-D011-B42D-00C04FC964FF";

function plistWith(entries: Record<string, string>): string {
  const body = Object.entries(entries)
    .map(([k, v]) => `<key>${k}</key>${v}`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>${body}</dict></plist>`;
}

const b64 = (o: unknown) => `<data>${Buffer.from(JSON.stringify(o)).toString("base64")}</data>`;

const anthropicPlist = plistWith({
  aiConnections: b64([
    { id: CONN_ID, name: "Claude", provider: "anthropic", baseURL: "https://api.anthropic.com", models: ["claude-x"] },
  ]),
  aiDefaultModel: b64({ api: { connection: CONN_ID, model: "claude-x" } }),
});

function makeExec(plist: string, opts: { key?: string | null } = {}): ExecFn & { calls: string[][] } {
  const calls: string[][] = [];
  const fn = (async (file: string, args: string[]) => {
    calls.push([file, ...args]);
    if (file.endsWith("defaults")) return { stdout: plist, stderr: "" };
    if (file.endsWith("security")) {
      if (args.includes("com.tinycast.app.ai-api-keys")) {
        if (opts.key === null) throw new Error("security: The specified item could not be found in the keychain.");
        return { stdout: `${opts.key ?? "sk-test"}\n`, stderr: "" };
      }
      throw new Error("security: The specified item could not be found in the keychain.");
    }
    if (file.endsWith("claude")) return { stdout: '["🎉","🥳"]', stderr: "" };
    throw new Error(`unexpected exec ${file}`);
  }) as ExecFn & { calls: string[][] };
  fn.calls = calls;
  return fn;
}

function makeFetch(text: string, status = 200): FetchFn & { mock: ReturnType<typeof vi.fn> } {
  const mock = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => text }));
  const fn = ((url: string, init: Parameters<FetchFn>[1]) => (mock as unknown as FetchFn)(url, init)) as FetchFn & {
    mock: typeof mock;
  };
  fn.mock = mock;
  return fn;
}

const anthropicAnswer = (answer: string) => JSON.stringify({ content: [{ type: "text", text: answer }] });

function deps(over: Partial<SuggesterDeps> = {}): SuggesterDeps {
  return {
    exec: makeExec(anthropicPlist),
    fetch: makeFetch(anthropicAnswer('["🔥","💯","🚀"]')),
    home: "/Users/me",
    exists: () => false,
    ...over,
  };
}

describe("createSuggester", () => {
  it("asks the Tinycast default API route and returns dataset entries", async () => {
    const d = deps();
    const suggest = createSuggester(d);
    const result = await suggest("awesome launch", { bundleId: "com.tinycast.app", count: 24 });
    expect(result.emojis.map((e) => e.emoji)).toEqual(["🔥", "💯", "🚀"]);
    expect(result.routeLabel).toBe("Claude · claude-x");
    const [url, init] = (d.fetch as unknown as { mock: ReturnType<typeof vi.fn> }).mock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("sk-test");
    expect(JSON.parse(init.body).messages[0].content).toContain("awesome launch");
  });

  it("caches answers per route, count and normalized query", async () => {
    const d = deps();
    const suggest = createSuggester(d);
    await suggest("Party", { bundleId: "com.tinycast.app", count: 24 });
    await suggest("  party ", { bundleId: "com.tinycast.app", count: 24 });
    expect((d.fetch as unknown as { mock: ReturnType<typeof vi.fn> }).mock).toHaveBeenCalledTimes(1);
    await suggest("party", { bundleId: "com.tinycast.app", count: 12 });
    expect((d.fetch as unknown as { mock: ReturnType<typeof vi.fn> }).mock).toHaveBeenCalledTimes(2);
  });

  it("shares one request between concurrent identical calls", async () => {
    const d = deps();
    const suggest = createSuggester(d);
    const o = { bundleId: "com.tinycast.app", count: 24 };
    const [a, b] = await Promise.all([suggest("party", o), suggest(" Party ", o)]);
    expect(a.emojis.map((e) => e.emoji)).toEqual(["🔥", "💯", "🚀"]);
    expect(b.emojis).toEqual(a.emojis);
    expect((d.fetch as unknown as { mock: ReturnType<typeof vi.fn> }).mock).toHaveBeenCalledTimes(1);
  });

  it("does not share requests between different queries", async () => {
    const d = deps();
    const suggest = createSuggester(d);
    const o = { bundleId: "com.tinycast.app", count: 24 };
    await Promise.all([suggest("party", o), suggest("cake", o)]);
    expect((d.fetch as unknown as { mock: ReturnType<typeof vi.fn> }).mock).toHaveBeenCalledTimes(2);
  });

  it("does not memoize failures: the next call asks again", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "down" })
      .mockResolvedValue({ ok: true, status: 200, text: async () => anthropicAnswer('["🔥"]') });
    const d = deps({ fetch: ((u: string, i: Parameters<FetchFn>[1]) => mock(u, i)) as FetchFn });
    const suggest = createSuggester(d);
    const o = { bundleId: "com.tinycast.app", count: 24 };
    const first = suggest("party", o);
    const second = suggest("party", o);
    await expect(first).rejects.toThrow(/500/);
    await expect(second).rejects.toThrow(/500/);
    expect(mock).toHaveBeenCalledTimes(1);
    await expect(suggest("party", o)).resolves.toBeTruthy();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("uses a persistent cache when provided", async () => {
    const store = new Map<string, string>();
    const cache = { get: (k: string) => store.get(k), set: (k: string, v: string) => void store.set(k, v) };
    await createSuggester(deps({ cache }))("party", { bundleId: "com.tinycast.app", count: 24 });
    const d2 = deps({ cache, fetch: makeFetch("boom", 500) });
    const result = await createSuggester(d2)("party", { bundleId: "com.tinycast.app", count: 24 });
    expect(result.emojis.map((e) => e.emoji)).toEqual(["🔥", "💯", "🚀"]);
  });

  it("reads settings and the key only once per suggester session", async () => {
    const exec = makeExec(anthropicPlist);
    const suggest = createSuggester(deps({ exec }));
    await suggest("a", { bundleId: "com.tinycast.app", count: 24 });
    await suggest("b", { bundleId: "com.tinycast.app", count: 24 });
    const defaultsCalls = exec.calls.filter((c) => c[0].endsWith("defaults"));
    const keyCalls = exec.calls.filter((c) => c.includes("com.tinycast.app.ai-api-keys"));
    expect(defaultsCalls).toHaveLength(1);
    expect(keyCalls).toHaveLength(1);
  });

  it("throws NoRouteError with Tinycast's reason when nothing usable is configured", async () => {
    const plist = plistWith({ aiDefaultModel: b64({ appleIntelligence: {} }) });
    const suggest = createSuggester(deps({ exec: makeExec(plist) }));
    const error = await suggest("x", { bundleId: "com.tinycast.app", count: 24 }).catch((e) => e);
    expect(error).toBeInstanceOf(NoRouteError);
    expect(error.message).toMatch(/Apple Intelligence/);
  });

  it("uses the claude CLI route", async () => {
    const plist = plistWith({ aiDefaultModel: b64({ claude: { model: "sonnet" } }) });
    const exec = makeExec(plist);
    const suggest = createSuggester(deps({ exec, exists: (p) => p === "/opt/homebrew/bin/claude" }));
    const result = await suggest("party", { bundleId: "com.tinycast.app", count: 24 });
    expect(result.emojis.map((e) => e.emoji)).toEqual(["🎉", "🥳"]);
    expect(result.routeLabel).toBe("Claude Code · sonnet");
    expect(exec.calls.some((c) => c[0] === "/opt/homebrew/bin/claude")).toBe(true);
  });

  it("uses an enabled installed claude when the default is Apple Intelligence", async () => {
    const plist = plistWith({
      aiDefaultModel: b64({ appleIntelligence: {} }),
      aiInstalledProviders: b64(["claude"]),
    });
    const exec = makeExec(plist);
    const suggest = createSuggester(deps({ exec, exists: (p) => p === "/opt/homebrew/bin/claude" }));
    const result = await suggest("party", { bundleId: "com.tinycast.app", count: 24 });
    expect(result.routeLabel).toBe("Claude Code · default model");
    const call = exec.calls.find((c) => c[0] === "/opt/homebrew/bin/claude");
    expect(call).toBeTruthy();
    expect(call).not.toContain("--model");
  });

  it("prefers Raycast AI when running inside Raycast", async () => {
    const raycastAsk = vi.fn(async () => "Here you go: 🌧️ 🍕");
    const d = deps({ raycastAsk });
    const result = await createSuggester(d)("pizza rain", { bundleId: "com.tinycast.app", count: 24 });
    expect(result.emojis.map((e) => e.emoji)).toEqual(["🌧️", "🍕"]);
    expect(result.routeLabel).toBe("Raycast AI");
    expect((d.exec as ExecFn & { calls: string[][] }).calls).toHaveLength(0);
  });

  it("fails clearly when the answer holds no known emoji", async () => {
    const suggest = createSuggester(deps({ fetch: makeFetch(anthropicAnswer("I cannot help with that.")) }));
    await expect(suggest("x", { bundleId: "com.tinycast.app", count: 24 })).rejects.toThrow(/didn't suggest any emoji/);
  });

  it("surfaces HTTP errors and does not cache them", async () => {
    const fetch = makeFetch(JSON.stringify({ error: { message: "invalid x-api-key" } }), 401);
    const suggest = createSuggester(deps({ fetch }));
    await expect(suggest("x", { bundleId: "com.tinycast.app", count: 24 })).rejects.toThrow(/401/);
    await expect(suggest("x", { bundleId: "com.tinycast.app", count: 24 })).rejects.toThrow(/401/);
    expect((fetch as unknown as { mock: ReturnType<typeof vi.fn> }).mock).toHaveBeenCalledTimes(2);
  });

  it("caps results at count", async () => {
    const many = JSON.stringify(["😀", "😃", "😄", "😁", "😆"]);
    const suggest = createSuggester(deps({ fetch: makeFetch(anthropicAnswer(many)) }));
    const result = await suggest("happy", { bundleId: "com.tinycast.app", count: 3 });
    expect(result.emojis).toHaveLength(3);
  });

  it("rejects an empty query without calling anything", async () => {
    const d = deps();
    await expect(createSuggester(d)("   ", { bundleId: "com.tinycast.app", count: 24 })).rejects.toThrow();
    expect((d.exec as ExecFn & { calls: string[][] }).calls).toHaveLength(0);
  });
});

describe("model override, listRoutes and minimizeThinking", () => {
  const OTHER = "11111111-2222-3333-4444-555555555555";
  const multiPlist = plistWith({
    aiConnections: b64([
      {
        id: CONN_ID,
        name: "Claude",
        provider: "anthropic",
        baseURL: "https://api.anthropic.com",
        models: ["claude-x", "claude-y"],
        reasoningOptions: { "claude-x": { efforts: ["default", "low", "high"], defaultEffort: "default" } },
      },
      { id: OTHER, name: "", provider: "openRouter", baseURL: "https://openrouter.ai/api/v1", models: ["or-m"] },
    ]),
    aiDefaultModel: b64({ api: { connection: CONN_ID, model: "claude-x" } }),
  });
  const opts = { bundleId: "com.tinycast.app", count: 24 };
  const sent = (d: SuggesterDeps) =>
    (d.fetch as unknown as { mock: ReturnType<typeof vi.fn> }).mock.mock.calls.map((c) => ({
      url: c[0] as string,
      body: JSON.parse(c[1].body),
    }));

  it("override changes the route and label", async () => {
    const d = deps({
      exec: makeExec(multiPlist),
      fetch: makeFetch(JSON.stringify({ choices: [{ message: { content: '["🔥"]' } }] })),
    });
    const suggest = createSuggester(d);
    const r = await suggest("party", { ...opts, override: { kind: "api", connection: OTHER, model: "or-m" } });
    expect(r.routeLabel).toBe("OpenRouter · or-m");
    expect(sent(d)[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("switching override does not re-run defaults export or re-read the same key", async () => {
    const exec = makeExec(multiPlist);
    const d = deps({ exec, fetch: makeFetch(anthropicAnswer('["🔥"]')) });
    const suggest = createSuggester(d);
    const a = { kind: "api", connection: CONN_ID, model: "claude-y" } as const;
    const b = { kind: "api", connection: CONN_ID, model: "claude-x" } as const;
    await suggest("p", { ...opts, override: a });
    await suggest("p", { ...opts, override: b });
    await suggest("p", { ...opts, override: null });
    await suggest("p2", { ...opts, override: a });
    expect(exec.calls.filter((c) => c[0].endsWith("defaults"))).toHaveLength(1);
    expect(exec.calls.filter((c) => c.includes("com.tinycast.app.ai-api-keys"))).toHaveLength(1);
  });

  it("an unusable override falls back to the Tinycast default", async () => {
    const suggest = createSuggester(deps({ exec: makeExec(multiPlist) }));
    const r = await suggest("p", { ...opts, override: { kind: "api", connection: "GONE", model: "x" } });
    expect(r.routeLabel).toBe("Claude · claude-x");
  });

  it("cache keys differ per override", async () => {
    const d = deps({ exec: makeExec(multiPlist), fetch: makeFetch(anthropicAnswer('["🔥"]')) });
    const suggest = createSuggester(d);
    await suggest("p", opts);
    await suggest("p", { ...opts, override: { kind: "api", connection: CONN_ID, model: "claude-y" } });
    expect(sent(d)).toHaveLength(2);
    await suggest("p", { ...opts, override: { kind: "api", connection: CONN_ID, model: "claude-y" } });
    expect(sent(d)).toHaveLength(2);
  });

  it("listRoutes lists choices from the memoized settings", async () => {
    const exec = makeExec(multiPlist);
    const suggest = createSuggester(deps({ exec }));
    const list = await suggest.listRoutes("com.tinycast.app");
    expect(list.map((c) => [c.id, c.source, c.isDefault])).toEqual([
      [`api:${CONN_ID}:claude-x`, "Claude", true],
      [`api:${CONN_ID}:claude-y`, "Claude", false],
      [`api:${OTHER}:or-m`, "OpenRouter", false],
    ]);
    await suggest("p", opts);
    await suggest.listRoutes("com.tinycast.app");
    expect(exec.calls.filter((c) => c[0].endsWith("defaults"))).toHaveLength(1);
  });

  it("listRoutes returns [] with raycastAsk", async () => {
    const suggest = createSuggester(deps({ raycastAsk: async () => "🍕" }));
    expect(await suggest.listRoutes("com.tinycast.app")).toEqual([]);
  });

  it("sends the fastest declared effort by default and omits it when minimizeThinking is false", async () => {
    const d = deps({ exec: makeExec(multiPlist) });
    const suggest = createSuggester(d);
    await suggest("p", opts);
    await suggest("p", { ...opts, minimizeThinking: false });
    const [first, second] = sent(d);
    expect(first.body.output_config).toEqual({ effort: "low" });
    expect(second.body.output_config).toBeUndefined();
  });

  it("claude-y has no declared effort, so none is sent", async () => {
    const d = deps({ exec: makeExec(multiPlist) });
    await createSuggester(d)("p", { ...opts, override: { kind: "api", connection: CONN_ID, model: "claude-y" } });
    expect(sent(d)[0].body.output_config).toBeUndefined();
  });
});

describe("routeLabel for CLI default models", () => {
  it("shows default model for an empty model", () => {
    expect(routeLabel({ kind: "cli", tool: "claude", model: "" })).toBe("Claude Code · default model");
    expect(routeLabel({ kind: "cli", tool: "codex", model: "" })).toBe("Codex · default model");
    expect(routeLabel({ kind: "cli", tool: "claude", model: "opus" })).toBe("Claude Code · opus");
  });
});

describe("diagnose", () => {
  it("passes language, locale and skin tone into the report", async () => {
    const report = await createSuggester(deps({ raycastAsk: async () => "" })).diagnose({
      ...base,
      language: "de",
      systemLocale: "de-DE",
      skinTone: "dark",
    });
    expect(report).toContain("Language: de");
    expect(report).toContain("System locale: de-DE");
    expect(report).toContain("Skin tone: dark");
  });

  const base = { bundleId: "com.tinycast.app", count: 24, extensionVersion: "1.0.0" };

  it("reports an API route without leaking the key", async () => {
    const d = deps();
    const report = await createSuggester(d).diagnose(base);
    expect(report).toContain("Tiny Smile AI diagnostics");
    expect(report).toContain("Resolved route: Claude · claude-x");
    expect(report).toContain("API key: found");
    expect(report).toContain("aiConnections: data");
    expect(report).toContain("https://api.anthropic.com");
    expect(report).not.toContain("sk-test");
    expect(report).toContain("Raycast AI: no");
  });

  it("reports a missing API key", async () => {
    const report = await createSuggester(deps({ exec: makeExec(anthropicPlist, { key: null }) })).diagnose(base);
    expect(report).toContain("API key: missing");
  });

  it("reports a Keychain failure as a line", async () => {
    const exec = (async (file: string) => {
      if (file.endsWith("security")) throw new Error("security: User interaction is not allowed.");
      return { stdout: anthropicPlist, stderr: "" };
    }) as ExecFn;
    const report = await createSuggester(deps({ exec })).diagnose(base);
    expect(report).toContain("API key: error");
    expect(report).toContain("User interaction is not allowed");
  });

  it("includes the no-route reason", async () => {
    const report = await createSuggester(deps({ exec: makeExec(plistWith({})) })).diagnose(base);
    expect(report).toContain("No AI provider is set up");
  });

  it("never throws when settings are unreadable", async () => {
    const exec = (async () => {
      throw new Error("nope");
    }) as unknown as ExecFn;
    const report = await createSuggester(deps({ exec })).diagnose({ ...base, lastError: "boom" });
    expect(report).toContain("Tinycast settings not found");
    expect(report).toContain("Last error: boom");
  });

  it("shows the CLI executable path", async () => {
    const exec = makeExec(plistWith({ aiDefaultModel: b64({ claude: { model: "sonnet" } }) }));
    const report = await createSuggester(deps({ exec, exists: (p) => p === "/opt/homebrew/bin/claude" })).diagnose(
      base,
    );
    expect(report).toContain("Executable: /opt/homebrew/bin/claude");
    const none = await createSuggester(deps({ exec })).diagnose(base);
    expect(none).toContain("Executable: not found");
  });

  it("reports the effort that would be sent", async () => {
    const plist = plistWith({
      aiConnections: b64([
        {
          id: CONN_ID,
          name: "Claude",
          provider: "anthropic",
          baseURL: "https://api.anthropic.com",
          models: ["claude-x"],
          reasoningOptions: { "claude-x": { efforts: ["default", "low", "high"] } },
        },
      ]),
      aiDefaultModel: b64({ api: { connection: CONN_ID, model: "claude-x" } }),
    });
    const suggest = createSuggester(deps({ exec: makeExec(plist) }));
    expect(await suggest.diagnose(base)).toContain("Effort sent: low");
    expect(await suggest.diagnose({ ...base, minimizeThinking: false })).toContain("Effort sent: none");
  });

  it("reuses memoized settings and secrets", async () => {
    const exec = makeExec(anthropicPlist);
    const suggest = createSuggester(deps({ exec }));
    await suggest("party", { bundleId: base.bundleId, count: 24 });
    const before = exec.calls.length;
    await suggest.diagnose(base);
    expect(exec.calls.length).toBe(before);
    expect(exec.calls.filter((c) => c[0].endsWith("defaults"))).toHaveLength(1);
  });

  it("reports Raycast AI and skips Tinycast reads", async () => {
    const exec = makeExec(anthropicPlist);
    const report = await createSuggester(deps({ exec, raycastAsk: async () => "🍕" })).diagnose(base);
    expect(report).toContain("Raycast AI: yes");
    expect(exec.calls).toHaveLength(0);
  });
});
