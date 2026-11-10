import { describe, expect, it, vi } from "vitest";
import {
  apiShape,
  assertSafeEndpoint,
  buildCliInvocation,
  buildHttpRequest,
  callApi,
  callCli,
  cliSearchPaths,
  describeHttpError,
  endpointURL,
  extractResponseText,
  fastestEffort,
  findExecutable,
} from "../src/lib/providers";
import type { AIConnection, EmojiPrompt, ExecFn, FetchFn } from "../src/lib/types";

const conn = (provider: AIConnection["provider"], baseURL: string): AIConnection => ({
  id: "ID",
  name: "n",
  provider,
  baseURL,
  models: [],
});
const prompt: EmojiPrompt = { system: "SYS", user: "USER" };

describe("apiShape", () => {
  it("maps providers", () => {
    expect(apiShape(conn("anthropic", "https://api.anthropic.com"))).toBe("anthropic");
    expect(apiShape(conn("openAI", "https://API.openai.com/v1"))).toBe("openAIResponses");
    expect(apiShape(conn("openAI", "https://example.com/v1"))).toBe("openAICompatible");
    expect(apiShape(conn("gemini", "https://generativelanguage.googleapis.com/v1beta/openai"))).toBe(
      "openAICompatible",
    );
    expect(apiShape(conn("openRouter", "https://openrouter.ai/api/v1"))).toBe("openAICompatible");
  });
});

describe("endpointURL", () => {
  it("openAIResponses", () => {
    const u = (b: string) => endpointURL(conn("openAI", b));
    expect(u("https://api.openai.com/v1")).toBe("https://api.openai.com/v1/responses");
    expect(u("  https://api.openai.com/v1/// ")).toBe("https://api.openai.com/v1/responses");
    expect(u("https://api.openai.com/v1/responses")).toBe("https://api.openai.com/v1/responses");
    expect(u("https://api.openai.com/v1/chat/completions/")).toBe("https://api.openai.com/v1/responses");
  });
  it("openAICompatible", () => {
    const u = (b: string) => endpointURL(conn("openRouter", b));
    expect(u("https://openrouter.ai/api/v1/")).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(u("https://openrouter.ai/api/v1/chat/completions")).toBe("https://openrouter.ai/api/v1/chat/completions");
  });
  it("anthropic", () => {
    const u = (b: string) => endpointURL(conn("anthropic", b));
    expect(u("https://api.anthropic.com")).toBe("https://api.anthropic.com/v1/messages");
    expect(u("https://api.anthropic.com/")).toBe("https://api.anthropic.com/v1/messages");
    expect(u("https://x.test/v1/messages")).toBe("https://x.test/v1/messages");
  });
});

describe("assertSafeEndpoint", () => {
  it("allows https and loopback http", () => {
    expect(() => assertSafeEndpoint("https://example.com/x")).not.toThrow();
    expect(() => assertSafeEndpoint("http://localhost:11434/v1")).not.toThrow();
    expect(() => assertSafeEndpoint("http://127.0.0.1:1234/v1")).not.toThrow();
    expect(() => assertSafeEndpoint("http://[::1]:1234/v1")).not.toThrow();
  });
  it("rejects others", () => {
    expect(() => assertSafeEndpoint("http://example.com/x")).toThrow();
    expect(() => assertSafeEndpoint("ftp://example.com/x")).toThrow();
    expect(() => assertSafeEndpoint("not a url")).toThrow();
  });
});

describe("buildHttpRequest", () => {
  it("anthropic", () => {
    const r = buildHttpRequest(conn("anthropic", "https://api.anthropic.com"), "claude-x", prompt, "KEY", {});
    expect(r.url).toBe("https://api.anthropic.com/v1/messages");
    expect(r.init.method).toBe("POST");
    expect(r.init.headers).toEqual({
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": "KEY",
    });
    expect(JSON.parse(r.init.body)).toEqual({
      model: "claude-x",
      max_tokens: 1024,
      system: "SYS",
      messages: [{ role: "user", content: "USER" }],
    });
  });
  it("anthropic without key", () => {
    const r = buildHttpRequest(conn("anthropic", "https://a.test"), "m", prompt, null, {});
    expect(r.init.headers["x-api-key"]).toBeUndefined();
    const r2 = buildHttpRequest(conn("anthropic", "https://a.test"), "m", prompt, "", {});
    expect(r2.init.headers["x-api-key"]).toBeUndefined();
  });
  it("openAIResponses", () => {
    const r = buildHttpRequest(conn("openAI", "https://api.openai.com/v1"), "gpt", prompt, "K", {});
    expect(r.url).toBe("https://api.openai.com/v1/responses");
    expect(r.init.headers).toEqual({ "content-type": "application/json", Authorization: "Bearer K" });
    expect(JSON.parse(r.init.body)).toEqual({ model: "gpt", instructions: "SYS", input: "USER", store: false });
  });
  it("openAICompatible / Gemini", () => {
    const r = buildHttpRequest(
      conn("gemini", "https://generativelanguage.googleapis.com/v1beta/openai/"),
      "gemini-2.5-flash",
      prompt,
      "K",
      {},
    );
    expect(r.url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(r.init.headers).toEqual({ "content-type": "application/json", Authorization: "Bearer K" });
    expect(JSON.parse(r.init.body)).toEqual({
      model: "gemini-2.5-flash",
      messages: [
        { role: "system", content: "SYS" },
        { role: "user", content: "USER" },
      ],
      stream: false,
    });
  });
  it("openRouter headers", () => {
    const r = buildHttpRequest(conn("openRouter", "https://openrouter.ai/api/v1"), "m", prompt, "K", {});
    expect(r.init.headers).toEqual({
      "content-type": "application/json",
      Authorization: "Bearer K",
      "HTTP-Referer": "https://github.com/hendrik77/tiny-smile-AI",
      "X-Title": "Tiny Smile AI",
    });
  });
  it("no auth header without key", () => {
    const r = buildHttpRequest(conn("openAICompatible", "http://localhost:1234/v1"), "m", prompt, null, {});
    expect(r.init.headers).toEqual({ "content-type": "application/json" });
  });
  it("merges extra headers but keeps content-type", () => {
    const r = buildHttpRequest(conn("openAICompatible", "https://x.test/v1"), "m", prompt, "K", {
      "X-Custom": "1",
      "Content-Type": "text/plain",
    });
    expect(r.init.headers["X-Custom"]).toBe("1");
    expect(r.init.headers["content-type"]).toBe("application/json");
    expect(r.init.headers["Content-Type"]).toBeUndefined();
  });
  it("rejects unsafe endpoints", () => {
    expect(() => buildHttpRequest(conn("openAICompatible", "http://example.com/v1"), "m", prompt, "K", {})).toThrow();
  });
});

describe("extractResponseText", () => {
  it("anthropic", () => {
    const json = {
      content: [
        { type: "thinking", text: "no" },
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    };
    expect(extractResponseText("anthropic", json)).toBe("ab");
  });
  it("openAIResponses output_text", () => {
    expect(extractResponseText("openAIResponses", { output_text: "hi" })).toBe("hi");
  });
  it("openAIResponses output array", () => {
    const json = {
      output: [
        { type: "reasoning", content: [{ type: "output_text", text: "no" }] },
        {
          type: "message",
          content: [
            { type: "output_text", text: "x" },
            { type: "refusal", text: "n" },
            { type: "output_text", text: "y" },
          ],
        },
      ],
    };
    expect(extractResponseText("openAIResponses", json)).toBe("xy");
  });
  it("openAICompatible string and parts", () => {
    expect(extractResponseText("openAICompatible", { choices: [{ message: { content: "hey" } }] })).toBe("hey");
    expect(
      extractResponseText("openAICompatible", {
        choices: [
          {
            message: {
              content: [
                { type: "text", text: "a" },
                { type: "text", text: "b" },
              ],
            },
          },
        ],
      }),
    ).toBe("ab");
  });
  it("throws on empty/missing", () => {
    for (const [s, j] of [
      ["anthropic", { content: [] }],
      ["openAIResponses", { output: [] }],
      ["openAICompatible", { choices: [{ message: { content: null } }] }],
      ["openAICompatible", null],
      ["anthropic", "str"],
    ] as const) {
      expect(() => extractResponseText(s, j)).toThrow("The AI returned an empty answer");
    }
  });
});

describe("describeHttpError", () => {
  it("parses error.message", () => {
    expect(describeHttpError(400, JSON.stringify({ error: { message: "bad model" } }))).toBe(
      "AI request failed (400): bad model",
    );
  });
  it("parses error string and message", () => {
    expect(describeHttpError(500, JSON.stringify({ error: "boom" }))).toBe("AI request failed (500): boom");
    expect(describeHttpError(500, JSON.stringify({ message: "oops" }))).toBe("AI request failed (500): oops");
  });
  it("uses raw body when not JSON, and handles empty", () => {
    expect(describeHttpError(502, "Bad Gateway")).toBe("AI request failed (502): Bad Gateway");
    expect(describeHttpError(502, "")).toBe("AI request failed (502)");
  });
  it("adds hints", () => {
    expect(describeHttpError(401, JSON.stringify({ error: { message: "invalid x-api-key" } }))).toBe(
      "AI request failed (401): invalid x-api-key. Check the API key in Tinycast → Settings → AI.",
    );
    expect(describeHttpError(403, "")).toContain("Check the API key in Tinycast → Settings → AI.");
    expect(describeHttpError(429, "")).toContain("Rate limited — try again in a moment.");
  });
  it("truncates", () => {
    const msg = describeHttpError(500, "x".repeat(1000));
    expect(msg.length).toBeLessThanOrEqual(300);
  });
});

describe("callApi", () => {
  const c = conn("openAICompatible", "https://x.test/v1");
  const mk = (ok: boolean, status: number, body: string): FetchFn =>
    vi.fn(async () => ({ ok, status, text: async () => body }));
  it("returns text on success", async () => {
    const f = mk(true, 200, JSON.stringify({ choices: [{ message: { content: "😀" } }] }));
    await expect(callApi(c, "m", prompt, "K", {}, f)).resolves.toBe("😀");
    expect(f).toHaveBeenCalledWith("https://x.test/v1/chat/completions", expect.objectContaining({ method: "POST" }));
  });
  it("throws described error on 401", async () => {
    const f = mk(false, 401, JSON.stringify({ error: { message: "nope" } }));
    await expect(callApi(c, "m", prompt, "K", {}, f)).rejects.toThrow(/AI request failed \(401\): nope/);
  });
  it("throws friendly error on invalid JSON", async () => {
    await expect(callApi(c, "m", prompt, "K", {}, mk(true, 200, "<html>"))).rejects.toThrow(/valid JSON|invalid/i);
  });
});

describe("CLI", () => {
  it("claude argv", () => {
    expect(buildCliInvocation("claude", "haiku", prompt)).toEqual({
      args: [
        "-p",
        "--model",
        "haiku",
        "--output-format",
        "text",
        "--no-session-persistence",
        "--disallowedTools",
        "*",
        "--max-turns",
        "1",
        "--system-prompt",
        "SYS",
        "USER",
      ],
    });
    expect(buildCliInvocation("claude", "", prompt).args).not.toContain("--model");
  });
  it("codex argv", () => {
    expect(buildCliInvocation("codex", "gpt-5", prompt).args).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--model",
      "gpt-5",
      "SYS\n\nUSER",
    ]);
    expect(buildCliInvocation("codex", "", prompt).args).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "SYS\n\nUSER",
    ]);
  });
  it("search paths", () => {
    expect(cliSearchPaths("/h")).toEqual([
      "/h/.local/bin",
      "/h/.claude/local",
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/h/.bun/bin",
      "/h/.volta/bin",
      "/h/.npm-global/bin",
      "/usr/bin",
    ]);
  });
  it("findExecutable picks first existing", () => {
    const ex = new Set(["/usr/local/bin/claude", "/usr/bin/claude"]);
    expect(findExecutable("claude", "/h", (p) => ex.has(p))).toBe("/usr/local/bin/claude");
    expect(findExecutable("codex", "/h", (p) => ex.has(p))).toBeNull();
  });
  it("callCli runs and trims", async () => {
    const exec: ExecFn = vi.fn(async () => ({ stdout: "  😀 \n", stderr: "" }));
    const out = await callCli("claude", "haiku", prompt, {
      exec,
      home: "/h",
      exists: (p) => p === "/opt/homebrew/bin/claude",
    });
    expect(out).toBe("😀");
    expect(exec).toHaveBeenCalledWith(
      "/opt/homebrew/bin/claude",
      buildCliInvocation("claude", "haiku", prompt).args,
      expect.objectContaining({
        timeoutMs: 20000,
        env: expect.objectContaining({ PATH: expect.stringContaining("/opt/homebrew/bin") }),
      }),
    );
  });
  it("callCli passes PATH with search dirs, exec dir, then the existing PATH", async () => {
    const exec = vi.fn(async () => ({ stdout: "x", stderr: "" })) as unknown as ExecFn;
    await callCli("claude", "", prompt, {
      exec,
      home: "/h",
      exists: (p) => p === "/h/.nvm/x/claude" || p === "/usr/local/bin/claude",
      pathEnv: "/usr/bin:/custom/bin:/h/.local/bin",
    });
    const opts = (exec as unknown as ReturnType<typeof vi.fn>).mock.calls[0][2] as {
      env: { PATH: string };
      timeoutMs: number;
    };
    expect(opts.timeoutMs).toBe(20000);
    expect(opts.env.PATH).toBe(
      "/h/.local/bin:/h/.claude/local:/opt/homebrew/bin:/usr/local/bin:/h/.bun/bin:/h/.volta/bin:/h/.npm-global/bin:/usr/bin:/custom/bin",
    );
  });
  it("callCli errors", async () => {
    const exec: ExecFn = async () => ({ stdout: "  ", stderr: "" });
    await expect(callCli("claude", "m", prompt, { exec, home: "/h", exists: () => false })).rejects.toThrow(
      /Couldn't find the `claude` command/,
    );
    await expect(callCli("codex", "m", prompt, { exec, home: "/h", exists: () => true })).rejects.toThrow(
      "The AI returned an empty answer",
    );
  });
});

describe("fastestEffort", () => {
  const withEfforts = (efforts?: Record<string, string[]>): AIConnection => ({
    ...conn("openAI", "https://api.openai.com/v1"),
    ...(efforts ? { reasoningEfforts: efforts } : {}),
  });
  it("prefers none over minimal over low and ignores default", () => {
    expect(fastestEffort(withEfforts({ m: ["default", "low", "none", "minimal"] }), "m")).toBe("none");
    expect(fastestEffort(withEfforts({ m: ["default", "low", "minimal", "high"] }), "m")).toBe("minimal");
    expect(fastestEffort(withEfforts({ m: ["default", "medium", "low"] }), "m")).toBe("low");
  });
  it("is null with only medium/high, undeclared, or other models", () => {
    expect(fastestEffort(withEfforts({ m: ["default", "medium", "high"] }), "m")).toBeNull();
    expect(fastestEffort(withEfforts(), "m")).toBeNull();
    expect(fastestEffort(withEfforts({ other: ["low"] }), "m")).toBeNull();
  });
});

describe("buildHttpRequest with effort", () => {
  const body = (c: AIConnection, effort: string | null) =>
    JSON.parse(buildHttpRequest(c, "m", prompt, "K", {}, effort).init.body);
  it("openAI Responses: reasoning.effort", () => {
    expect(body(conn("openAI", "https://api.openai.com/v1"), "minimal").reasoning).toEqual({ effort: "minimal" });
  });
  it("anthropic: output_config.effort", () => {
    expect(body(conn("anthropic", "https://api.anthropic.com"), "low").output_config).toEqual({ effort: "low" });
  });
  it("openRouter: reasoning.effort", () => {
    const b = body(conn("openRouter", "https://openrouter.ai/api/v1"), "none");
    expect(b.reasoning).toEqual({ effort: "none" });
    expect(b.reasoning_effort).toBeUndefined();
  });
  it("compatible: reasoning_effort", () => {
    const b = body(conn("gemini", "https://generativelanguage.googleapis.com/v1beta/openai"), "none");
    expect(b.reasoning_effort).toBe("none");
    expect(b.thinking).toBeUndefined();
    expect(body(conn("openAICompatible", "https://api.openai.com/v1"), "low").reasoning_effort).toBe("low");
  });
  it("gateway with none: thinking disabled, no reasoning_effort", () => {
    const b = body(conn("openAICompatible", "https://gateway.example.com/v1"), "none");
    expect(b.thinking).toEqual({ type: "disabled" });
    expect(b.reasoning_effort).toBeUndefined();
    const b2 = body(conn("openAI", "https://proxy.example.com/v1/"), "none");
    expect(b2.thinking).toEqual({ type: "disabled" });
    const b3 = body(conn("openAICompatible", "https://gateway.example.com/v1"), "low");
    expect(b3.reasoning_effort).toBe("low");
    expect(b3.thinking).toBeUndefined();
  });
  it("adds nothing when effort is null", () => {
    for (const c of [
      conn("openAI", "https://api.openai.com/v1"),
      conn("anthropic", "https://api.anthropic.com"),
      conn("openRouter", "https://openrouter.ai/api/v1"),
      conn("openAICompatible", "https://gateway.example.com/v1"),
    ]) {
      const b = body(c, null);
      for (const k of ["reasoning", "reasoning_effort", "thinking", "output_config"]) expect(b[k]).toBeUndefined();
    }
  });
});

describe("callApi effort retry", () => {
  const c = conn("openAICompatible", "https://x.test/v1");
  const ok = JSON.stringify({ choices: [{ message: { content: "😀" } }] });
  const seq = (...rs: Array<[number, string]>) => {
    const f = vi.fn(async () => {
      const [status, body] = rs.shift()!;
      return { ok: status < 300, status, text: async () => body };
    });
    return f as unknown as FetchFn & ReturnType<typeof vi.fn>;
  };
  const bodies = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((x) => JSON.parse(x[1].body));
  it.each([400, 422])("retries once without effort after %i", async (status) => {
    const f = seq([status, "bad field"], [200, ok]);
    await expect(callApi(c, "m", prompt, "K", {}, f, "low")).resolves.toBe("😀");
    const [first, second] = bodies(f);
    expect(first.reasoning_effort).toBe("low");
    expect(second.reasoning_effort).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("returns the retry's error if it fails too", async () => {
    const f = seq([400, "{}"], [500, "boom"]);
    await expect(callApi(c, "m", prompt, "K", {}, f, "low")).rejects.toThrow(/\(500\)/);
  });
  it("does not retry 400 without effort", async () => {
    const f = seq([400, "bad"]);
    await expect(callApi(c, "m", prompt, "K", {}, f)).rejects.toThrow(/400/);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("does not retry 401 with effort", async () => {
    const f = seq([401, "no"]);
    await expect(callApi(c, "m", prompt, "K", {}, f, "low")).rejects.toThrow(/401/);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("CLI timeout message", () => {
  const timedOut: ExecFn = async () => {
    throw Object.assign(new Error("killed"), { timedOut: true });
  };
  it("names the tool and the limit", async () => {
    await expect(callCli("claude", "m", prompt, { exec: timedOut, home: "/h", exists: () => true })).rejects.toThrow(
      "The Claude Code tool took longer than 20 seconds. Pick a faster model with ⌘M or add an API connection.",
    );
    await expect(callCli("codex", "m", prompt, { exec: timedOut, home: "/h", exists: () => true })).rejects.toThrow(
      /^The Codex tool took longer than 20 seconds\./,
    );
  });
  it("keeps other failures as they are", async () => {
    const exec: ExecFn = async () => {
      throw new Error("boom");
    };
    await expect(callCli("claude", "m", prompt, { exec, home: "/h", exists: () => true })).rejects.toThrow("boom");
  });
});

describe("callApi timeout", () => {
  const c = conn("openAICompatible", "https://x.test/v1");
  const ok = JSON.stringify({ choices: [{ message: { content: "😀" } }] });
  const msg = "The AI didn't answer within 30 seconds. Pick a faster model with ⌘M.";
  const never = (): FetchFn => vi.fn(() => new Promise(() => {})) as unknown as FetchFn;

  it("rejects when the fetch never settles", async () => {
    vi.useFakeTimers();
    try {
      const p = callApi(c, "m", prompt, "K", {}, never());
      const assertion = expect(p).rejects.toThrow(msg);
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
  it("uses an injected timeout", async () => {
    vi.useFakeTimers();
    try {
      const p = callApi(c, "m", prompt, "K", {}, never(), null, 1000);
      const assertion = expect(p).rejects.toThrow(/within 1 second|within 30 seconds/);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
  it("clears the timer when the fetch settles", async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn(async () => ({ ok: true, status: 200, text: async () => ok })) as unknown as FetchFn;
      await expect(callApi(c, "m", prompt, "K", {}, f)).resolves.toBe("😀");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("gives each attempt its own timeout when retrying without effort", async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const f = vi.fn(() => {
        n++;
        if (n === 1)
          return new Promise((r) => setTimeout(() => r({ ok: false, status: 400, text: async () => "bad" }), 20000));
        return Promise.resolve({ ok: true, status: 200, text: async () => ok });
      }) as unknown as FetchFn;
      const p = callApi(c, "m", prompt, "K", {}, f, "low");
      await vi.advanceTimersByTimeAsync(20000);
      await expect(p).resolves.toBe("😀");
      expect(f).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
