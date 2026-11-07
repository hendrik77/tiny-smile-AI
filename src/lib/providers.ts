import type { AIConnection, EmojiPrompt, ExecFn, FetchFn } from "./types";

export type ApiShape = "anthropic" | "openAIResponses" | "openAICompatible";

const EMPTY_ANSWER = "The AI returned an empty answer";

function hostOf(baseURL: string): string | null {
  try {
    return new URL(baseURL.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function apiShape(conn: AIConnection): ApiShape {
  if (conn.provider === "anthropic") return "anthropic";
  if (conn.provider === "openAI" && hostOf(conn.baseURL) === "api.openai.com") return "openAIResponses";
  return "openAICompatible";
}

export function endpointURL(conn: AIConnection): string {
  const base = conn.baseURL.trim().replace(/\/+$/, "");
  switch (apiShape(conn)) {
    case "openAIResponses":
      if (base.endsWith("/responses")) return base;
      if (base.endsWith("/chat/completions")) return base.slice(0, -"/chat/completions".length) + "/responses";
      return `${base}/responses`;
    case "openAICompatible":
      return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
    case "anthropic":
      return base.endsWith("/messages") ? base : `${base}/v1/messages`;
  }
}

export function assertSafeEndpoint(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid AI endpoint URL: ${url}`);
  }
  if (parsed.protocol === "https:") return;
  if (parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname.toLowerCase())) return;
  throw new Error("Refusing to send the request: the AI endpoint must use https (http is only allowed for localhost).");
}

export function buildHttpRequest(
  conn: AIConnection,
  model: string,
  prompt: EmojiPrompt,
  apiKey: string | null,
  extraHeaders: Record<string, string>,
): { url: string; init: { method: "POST"; headers: Record<string, string>; body: string } } {
  const url = endpointURL(conn);
  assertSafeEndpoint(url);
  const shape = apiShape(conn);
  const headers: Record<string, string> = { "content-type": "application/json" };
  let body: unknown;

  if (shape === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    if (apiKey) headers["x-api-key"] = apiKey;
    body = { model, max_tokens: 1024, system: prompt.system, messages: [{ role: "user", content: prompt.user }] };
  } else if (shape === "openAIResponses") {
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    body = { model, instructions: prompt.system, input: prompt.user, store: false };
  } else {
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    if (conn.provider === "openRouter") {
      headers["HTTP-Referer"] = "https://github.com/hendrik77/tiny-smile-AI";
      headers["X-Title"] = "Tiny Smile AI";
    }
    body = {
      model,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      stream: false,
    };
  }

  for (const [k, v] of Object.entries(extraHeaders)) {
    if (k.toLowerCase() === "content-type") continue;
    headers[k] = v;
  }
  return { url, init: { method: "POST", headers, body: JSON.stringify(body) } };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const textOf = (v: unknown): string => (isObj(v) && typeof v.text === "string" ? v.text : "");

export function extractResponseText(shape: ApiShape, json: unknown): string {
  let text = "";
  if (isObj(json)) {
    if (shape === "anthropic") {
      text = asArray(json.content)
        .filter((p) => isObj(p) && p.type === "text")
        .map(textOf)
        .join("");
    } else if (shape === "openAIResponses") {
      if (typeof json.output_text === "string") text = json.output_text;
      if (!text.trim()) {
        text = asArray(json.output)
          .filter((item) => isObj(item) && item.type === "message")
          .flatMap((item) => asArray((item as Obj).content))
          .filter((c) => isObj(c) && c.type === "output_text")
          .map(textOf)
          .join("");
      }
    } else {
      const first = asArray(json.choices)[0];
      const content = isObj(first) && isObj(first.message) ? first.message.content : undefined;
      text = typeof content === "string" ? content : asArray(content).map(textOf).join("");
    }
  }
  if (!text.trim()) throw new Error(EMPTY_ANSWER);
  return text;
}

export function describeHttpError(status: number, body: string): string {
  let detail = body.trim();
  try {
    const parsed: unknown = JSON.parse(body);
    if (isObj(parsed)) {
      if (isObj(parsed.error) && typeof parsed.error.message === "string") detail = parsed.error.message;
      else if (typeof parsed.error === "string") detail = parsed.error;
      else if (typeof parsed.message === "string") detail = parsed.message;
    }
  } catch {
    // not JSON: use the raw body
  }
  let hint = "";
  if (status === 401 || status === 403) hint = "Check the API key in Tinycast → Settings → AI.";
  else if (status === 429) hint = "Rate limited — try again in a moment.";
  let msg = `AI request failed (${status})`;
  if (detail) msg += `: ${detail.slice(0, 200)}`;
  if (hint) msg += detail ? `. ${hint}` : ` ${hint}`;
  return msg.slice(0, 300);
}

export async function callApi(
  conn: AIConnection,
  model: string,
  prompt: EmojiPrompt,
  apiKey: string | null,
  extraHeaders: Record<string, string>,
  fetchFn: FetchFn,
): Promise<string> {
  const { url, init } = buildHttpRequest(conn, model, prompt, apiKey, extraHeaders);
  const res = await fetchFn(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(describeHttpError(res.status, text));
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("The AI answered with something that is not valid JSON.");
  }
  return extractResponseText(apiShape(conn), json);
}

export function buildCliInvocation(
  tool: "claude" | "codex",
  model: string,
  prompt: EmojiPrompt,
): { args: string[]; input?: string } {
  if (tool === "claude") {
    return {
      args: [
        "-p",
        ...(model ? ["--model", model] : []),
        "--output-format", "text",
        "--no-session-persistence",
        "--disallowedTools", "*",
        "--max-turns", "1",
        "--system-prompt", prompt.system,
        prompt.user,
      ],
    };
  }
  return {
    args: [
      "exec", "--skip-git-repo-check", "--sandbox", "read-only",
      ...(model ? ["--model", model] : []),
      `${prompt.system}\n\n${prompt.user}`,
    ],
  };
}

export function cliSearchPaths(home: string): string[] {
  return [
    `${home}/.local/bin`,
    `${home}/.claude/local`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    `${home}/.bun/bin`,
    `${home}/.volta/bin`,
    `${home}/.npm-global/bin`,
    "/usr/bin",
  ];
}

export function findExecutable(tool: string, home: string, exists: (p: string) => boolean): string | null {
  for (const dir of cliSearchPaths(home)) {
    const candidate = `${dir}/${tool}`;
    if (exists(candidate)) return candidate;
  }
  return null;
}

export async function callCli(
  tool: "claude" | "codex",
  model: string,
  prompt: EmojiPrompt,
  deps: { exec: ExecFn; home: string; exists: (p: string) => boolean },
): Promise<string> {
  const file = findExecutable(tool, deps.home, deps.exists);
  if (!file) {
    throw new Error(`Couldn't find the \`${tool}\` command. Install it, or pick an API model in Tinycast → Settings → AI.`);
  }
  const { args, input } = buildCliInvocation(tool, model, prompt);
  const { stdout } = await deps.exec(file, args, input === undefined ? { timeoutMs: 90000 } : { timeoutMs: 90000, input });
  const out = stdout.trim();
  if (!out) throw new Error(EMPTY_ANSWER);
  return out;
}
