import { describe, expect, it, vi } from "vitest";
import { createSuggester, NoRouteError, type SuggesterDeps } from "../src/lib/suggest";
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
  const fn = ((url: string, init: Parameters<FetchFn>[1]) =>
    (mock as unknown as FetchFn)(url, init)) as FetchFn & { mock: typeof mock };
  fn.mock = mock;
  return fn;
}

const anthropicAnswer = (answer: string) =>
  JSON.stringify({ content: [{ type: "text", text: answer }] });

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
    const suggest = createSuggester(
      deps({ exec, exists: (p) => p === "/opt/homebrew/bin/claude" }),
    );
    const result = await suggest("party", { bundleId: "com.tinycast.app", count: 24 });
    expect(result.emojis.map((e) => e.emoji)).toEqual(["🎉", "🥳"]);
    expect(result.routeLabel).toBe("Claude Code · sonnet");
    expect(exec.calls.some((c) => c[0] === "/opt/homebrew/bin/claude")).toBe(true);
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
    await expect(suggest("x", { bundleId: "com.tinycast.app", count: 24 })).rejects.toThrow(
      /didn't suggest any emoji/,
    );
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
