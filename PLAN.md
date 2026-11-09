# Tiny Smile AI — plan

## Goal (the finished result)

A Tinycast extension, **AI Emoji Search**, that works like Raycast's AI emoji picker:

1. Open Tinycast, run **AI Emoji Search**, type anything: a word, a mood, a situation
   ("shipped the release friday night", "condolences", "pizza party in the rain").
2. After a short typing pause the extension asks **the AI model you already set up in
   Tinycast → Settings → AI** for fitting emojis.
3. A grid shows **every emoji the AI suggested** (up to the configured count, default 24),
   best fit first, in an **AI Suggestions** section. Below it, a **Matching Names** section lists
   emojis whose name or keywords contain the query, so classic search still works and there is
   always something to pick, even before the AI answers or when it fails.
4. Enter pastes the selected emoji into the frontmost app. Other actions: copy the emoji, copy its
   name. With an empty search the grid shows recently used emojis.
5. Answers are cached per query, so repeating a search is instant and free.
6. When no usable AI route exists, the grid still offers name search, and a toast explains what to
   set up.

Tinycast installs it with **Settings → Extensions → Install New → Install from GitHub**
(`hendrik77/tiny-smile-AI`) or **Add from folder** after `npm run build`.

## Why an extension, and how it reaches Tinycast's AI

Tinycast runs Raycast-API extensions in an embedded runtime, but `AI.ask` there throws by design
(`Scripts/raycast-runtime/src/api/index.js` in Tinycast). So the extension reads Tinycast's own
AI configuration and calls the model itself:

| What                                                                                    | Where Tinycast keeps it                                                                 | How the extension reads it                                  |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Connections (`[AIConnection]` JSON: id, name, provider, baseURL, models)                | `UserDefaults` key `aiConnections` (Data)                                               | `defaults export <bundle id> -` → plist XML → base64 → JSON |
| Default model (`AIModelSelection` JSON, e.g. `{"api":{"connection":UUID,"model":"…"}}`) | `aiDefaultModel` (Data)                                                                 | same                                                        |
| Routes switched off                                                                     | `aiDisabledRoutes` (`["api:<UUID>", "claude", …]`)                                      | same                                                        |
| API keys                                                                                | Keychain generic password, service `<bundle id>.ai-api-keys`, account = connection UUID | `security find-generic-password -s … -a … -w`               |
| Custom request headers                                                                  | Keychain `<bundle id>.ai-request-headers` (JSON object)                                 | same                                                        |

Bundle id: `com.tinycast.app` (stable), `com.tinycast.app.beta`, `com.tinycast.app.dev` — a
preference picks the channel.

Route resolution (mirrors Tinycast's fall-forward):

1. The default model, if it is an enabled API connection or an enabled `claude` / `codex` CLI route.
2. Otherwise (Apple Intelligence cannot be reached from an extension; Grok/OpenCode/Cursor not
   supported) the first enabled API connection with a model.
3. Otherwise no route → name search only, plus an explanatory toast.

Requests per API shape (same rules as Tinycast's `AIHTTPConfiguration.endpointURL`):

- `anthropic` → `POST {base}/v1/messages`, `x-api-key`, `anthropic-version: 2023-06-01`.
- `openAI` with host `api.openai.com` → `POST {base}/responses` (Responses API).
- everything else (`gemini`, `openRouter`, `openAICompatible`, OpenAI on another host) →
  `POST {base}/chat/completions`, `Authorization: Bearer`.
- Custom headers are added; HTTP is accepted only for loopback hosts (Tinycast's policy).

When running inside real Raycast (`environment.canAccess(AI)` is true) the extension uses `AI.ask`.

## Speed (added after first use)

- **Model choice:** a "Choose AI Model…" action (⌘M) lists every enabled Tinycast connection and
  model (`listRouteChoices`). The pick is stored in LocalStorage and passed as a `RouteOverride`;
  `resolveRoute` ignores an override whose connection is gone or switched off.
- **Minimal thinking:** `fastestEffort` picks the lowest declared level for the model ("none" >
  "minimal" > "low"). It is sent the way Tinycast sends it: Responses `reasoning.effort`,
  OpenRouter `reasoning.effort`, gateway "none" as `thinking: {type: disabled}`, other
  OpenAI-compatible `reasoning_effort`, Anthropic `output_config.effort`. On HTTP 400/422 the
  request is retried once without it.

## Architecture

```
src/
  ai-emoji-search.tsx        Grid UI (debounce, sections, actions, recents)
  lib/emoji-data.ts          emoji dataset (unicode-emoji-json + emojilib keywords), lookup/normalize
  lib/local-search.ts        name/keyword search, ranked
  lib/prompt.ts              system + user prompt asking for a JSON array of emojis
  lib/parse-suggestions.ts   model text → validated, de-duplicated emoji list
  lib/plist.ts               minimal XML plist parser (dict/array/string/data/integer/real/bool/date)
  lib/tinycast-settings.ts   decode the AI keys from the plist, resolve the route
  lib/keychain.ts            read secrets through `security`
  lib/providers.ts           build HTTP requests / CLI argv per route, extract text from responses
  lib/suggest.ts             orchestrator: settings → route → call → parse, with cache
  lib/exec.ts                promise wrapper around child_process.execFile (injectable)
test/                        vitest unit tests, one file per lib module
```

Every module with I/O takes its dependencies (exec, fetch) as parameters, so all logic is unit
tested without macOS, Tinycast or network.

## Development approach

TDD: for each `lib/` module write failing tests first (vitest), then the implementation, then
refactor. Sub-agents build independent modules in parallel; the UI is assembled last, then the
whole extension is built with `ray build -e dist` and booted in Tinycast's own runtime harness
(`Scripts/raycast-runtime/test.mjs`) to check it renders.

## Done when

- `npm test` green, `npm run lint`/typecheck clean, `npm run build` produces `dist/ai-emoji-search.js`.
- The bundle boots in Tinycast's runtime harness and renders the grid (recents / name matches)
  and, with a stubbed AI response, the AI Suggestions section.
- README explains install, how AI settings are reused, the Keychain prompt, and limitations.

## Project basics (review item 4)

Goal: every pull request is checked automatically, the code has one enforced style, and the
extension has a real icon.

1. **Lint and format**
   - ESLint (flat config, `@raycast/eslint-config`) and Prettier (`printWidth` 120, matching the
     existing code).
   - Scripts: `npm run lint` (eslint + `prettier --check`), `npm run format`, and `npm run check`
     (lint, typecheck, test, build in that order).
   - Fix every finding; no rule is switched off to get green, except for generated files
     (`raycast-env.d.ts`, `dist/`).
2. **CI**
   - `.github/workflows/ci.yml`: on pull requests and pushes to `main`, Node 22, `npm ci`, then
     lint, typecheck, test, build. One job, npm cache, read-only permissions, cancel superseded runs.
3. **Icon**
   - `assets/icon.png`, 512×512, transparent background, readable at 32 px: a smiling emoji face
     with an AI sparkle. Source kept as `assets-src/icon.svg`, rendered by `scripts/render-icon.mjs`
     (Playwright Chromium, already on the dev machine), so it can be regenerated.
4. **Housekeeping**
   - `CHANGELOG.md` with the history so far (1.0.0).
   - README Development section lists the new scripts.

Done when `npm run check` is green locally and the CI workflow file is on the branch.
