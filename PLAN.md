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

## Future versions

Not scheduled yet. Each item comes from the project review after 1.0.0.

### Stop depending on Tinycast's internals

The extension reads Tinycast's private preference keys (`aiConnections`, `aiDefaultModel`,
`aiDisabledRoutes`, `aiInstalledProviders`) and its Keychain items. A Tinycast update can rename
any of them and break the extension without warning.

- Open an issue (or pull request) at `abue-ammar/tinycast` asking for `AI.ask` support in the
  extension runtime, backed by Tinycast's own provider layer.
- The extension already uses `AI.ask` whenever `environment.canAccess(AI)` is true, so it would
  switch over without a code change. That would also remove the Keychain prompt and make Apple
  Intelligence, Grok, OpenCode and Cursor usable.
- Until then: keep the settings reader, and use the Copy Diagnostics key list to spot renamed
  keys early.

### Waste fewer AI calls and fail faster

- Every typing pause of 450 ms sends a paid request, and a request for an outdated query still
  runs to the end. Wait longer after longer queries, and reuse a request that is already in
  flight for the same query.
- The Claude Code and Codex tools get up to 90 seconds before a search gives up. Cut the timeout
  to about 20 seconds with a clear message that suggests a faster model.
- Say in the README that what is typed is sent to the configured AI provider.

### Measure and improve the suggestions

- The prompt has never been evaluated. Collect about 30 sample searches with emojis that should
  appear, run them against a real model, and tune the prompt and the default count from the
  results. Keep the samples as a repeatable script, outside the unit tests because it needs a key.
- Skin-tone preference: the prompt currently forbids skin tones; apply the chosen tone to emojis
  that support one.
- Rank emojis that are picked often higher, in both the AI and the name sections.

### Emoji for the selected text

A second command that reads the text selected in the frontmost app (`getSelectedText`, which
Tinycast's runtime supports), asks the AI for fitting emojis and opens the grid already filled.
With nothing selected it says so and opens the normal search.

### Search straight from the launcher

Give the command a text argument, so `emoji finally friday` typed in Tinycast's main bar lands
directly in the results. Tinycast passes `props.arguments` to extension commands. The argument is
optional; without it the command opens as it does today.

### Name search in the user's language

The "Matching Names" section only knows English names and keywords, so a German query finds
nothing until the AI answers. Add keyword sets for other languages (CLDR annotations), starting
with German, chosen from the system language, with English always searched as well.

### Pick several emojis in one go

An "Add to Selection" action that puts the emoji in a small tray and keeps the grid open, plus
"Paste Selection" and "Copy Selection" for the whole sequence. A single pick keeps working as
it does today.

### Built-in answers for common searches

Ship a table of a few hundred frequent searches ("happy", "thanks", "birthday", "sorry") with
emojis prepared in advance. They appear instantly, cost nothing and work with no AI set up; the
AI still answers everything else. The table is generated once with a model by a script and
checked into the repo, so it can be regenerated.

Suggested order: launcher argument and selected text first (small, and they remove typing from
the most frequent uses); the built-in table last (most work).

### Tone switch next to the search field

A dropdown in the grid's search bar (Tinycast supports `Grid.Dropdown`) with "Any", "Work",
"Casual" and "Playful". The choice is added to the prompt and to the cache key, and it is
remembered between launches.

### Ready-made combinations

Ask the AI for two or three short sequences as well (for "birthday": 🎉🥳🍾), shown in their own
"Combinations" section and pasted as one. The answer format changes from a plain array to an
object with `emojis` and `combos`; the parser keeps accepting the plain array.

### Paste in the format the app expects

A choice of what gets inserted: the emoji itself, a Slack or GitHub shortcode (`:tada:`), or a
gitmoji code for commit messages. Needs the real Slack/GitHub name lists (gemoji), because the
Unicode-based slugs used by "Copy Shortcode" today don't always match.

### Search memory: recent and most-asked searches

Today's cache is keyed by model and query and only makes a repeat fast. Add a second, long-lived
store that learns which searches are asked most, and keeps their answers.

- **Two tiers.** A small _recent_ tier (the last 20 searches) and a _frequent_ tier (up to 200
  searches, configurable). A search enters the recent tier when it is first answered and is
  promoted to the frequent tier the second time it is asked. This keeps one-off searches from
  pushing out established ones.
- **What an entry holds.** The normalized query, its emojis, the model that answered, a use
  count, and the time it was last used.
- **What counts as a use.** Asking the search counts once; picking an emoji from it counts
  double, because that shows the answer was useful.
- **Eviction.** When the frequent tier is full, drop the entry with the lowest score. The score
  is the use count with a time decay (halved every 30 days without use), so old habits fade and
  the store ends up holding the searches asked most over time.
- **Where it shows.** Answers from the store appear instantly, for any model, before the AI is
  asked. The empty screen lists "Frequent Searches" and "Recent Searches"; picking one fills the
  search field.
- **Control.** Actions "Refresh Suggestions" (ask the AI again and replace the stored answer),
  "Forget This Search" and "Clear Search Memory".
- **Storage.** `LocalStorage`, one JSON document, because Raycast's `Cache` may evict entries on
  its own. The store logic is a pure module with unit tests for promotion, scoring, decay and
  eviction.
