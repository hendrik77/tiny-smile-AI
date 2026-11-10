# Tiny Smile AI — plan

Status: **1.2.0 released** (on `main`). Open work is listed under "Open work"; everything above it
describes what exists.

## Goal (the finished result)

A Tinycast extension, **AI Emoji Search**, that works like Raycast's AI emoji picker:

1. Open Tinycast, run **AI Emoji Search**, type anything: a word, a mood, a situation
   ("shipped the release friday night", "condolences", "pizza party in the rain"). Or start it with
   a text argument, or with text selected in the frontmost app.
2. After a short typing pause the extension asks **the AI model you already set up in
   Tinycast → Settings → AI** for fitting emojis.
3. The grid shows **every emoji the AI suggested** (up to the configured count, default 24), best
   fit first and numbered, followed by emojis whose name or keywords match the query, so classic
   search still works and there is always something to pick, even before the AI answers or when it
   fails. Tinycast draws no section titles in grids, so the search bar placeholder says what is
   shown.
4. Enter pastes the selected emoji into the frontmost app. Other actions: copy the emoji, copy its
   name or shortcode, choose the AI model (⌘M), copy diagnostics (⌘⇧D). With an empty search the
   grid shows recently used emojis.
5. Answers are cached per query, so repeating a search is instant and free.
6. When no usable AI route exists, the grid still offers name search, and a toast explains what to
   set up.

Install: **Settings → Extensions → Install New → Install from GitHub** (`hendrik77/tiny-smile-AI`),
or **Add from folder** after `npm run build`. Tinycast's link parser cannot read a `/tree/<ref>`
link whose branch name contains a slash, so install from `main`.

## Tinycast constraints (verified in its source, abue-ammar/tinycast)

These decide what the extension can do. Check them before planning a feature.

- **No `AI.ask`.** The runtime rejects it, and `environment.canAccess(AI)` is false, so the
  extension reads Tinycast's AI settings and calls the model itself.
- **Grids ignore `Grid.Section` titles and props.** Section titles only show in real Raycast.
- **The search field cannot be filled.** `searchText` is not read, so an argument or selected text
  is an _initial query_: its results show while the field is empty.
- **`getSelectedText()`** reads the selection through the Accessibility API of the app the palette
  displaced. It rejects when nothing is selected or the permission is missing; that is the normal
  case, not an error.
- **`fetch` does not stream and cannot be aborted in flight.** A timeout only bounds the caller.
- **Search-bar dropdowns** (`Grid.Dropdown`) are supported.

## How it reaches Tinycast's AI

| What                                                              | Where Tinycast keeps it                                                         | How the extension reads it                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Connections (`[AIConnection]` JSON: id, name, provider, baseURL…) | `UserDefaults` key `aiConnections` (Data)                                       | `defaults export <bundle id> -` → plist XML → base64 → JSON |
| Default model (`AIModelSelection` JSON)                           | `aiDefaultModel` (Data)                                                         | same                                                        |
| Routes switched off                                               | `aiDisabledRoutes` (`["api:<UUID>", …]`)                                        | same                                                        |
| Installed tools switched on (`["claude", "codex", …]`)            | `aiInstalledProviders` (Data)                                                   | same                                                        |
| API keys                                                          | Keychain generic password, `<bundle id>.ai-api-keys`, account = connection UUID | `security find-generic-password -s … -a … -w`               |
| Custom request headers                                            | Keychain `<bundle id>.ai-request-headers` (JSON object)                         | same                                                        |

Bundle id: `com.tinycast.app` (stable), `com.tinycast.app.beta`, `com.tinycast.app.dev`; a
preference picks the channel.

**Route resolution** (`resolveRoute`):

1. The model chosen with ⌘M, if its connection or tool is still usable.
2. Tinycast's default model, if it is an enabled API connection, or an enabled `claude` / `codex`
   tool that is switched on in Settings → AI → Providers.
3. The first enabled API connection with a model.
4. An installed `claude`, then `codex`, with the tool's own default model.
5. Otherwise no route: name search only, plus a toast. Apple Intelligence, Grok, OpenCode and
   Cursor cannot be used by an extension.

**Requests per API shape** (same rules as Tinycast's `AIHTTPConfiguration.endpointURL`):

- `anthropic` → `POST {base}/v1/messages`, `x-api-key`, `anthropic-version: 2023-06-01`.
- `openAI` with host `api.openai.com` → `POST {base}/responses` (Responses API).
- everything else (`gemini`, `openRouter`, `openAICompatible`, OpenAI on another host) →
  `POST {base}/chat/completions`, `Authorization: Bearer`.
- Custom headers are added; HTTP is accepted only for loopback hosts (Tinycast's policy).
- `claude` / `codex` run as child processes with a PATH that includes the usual install folders.

Inside real Raycast (`environment.canAccess(AI)` is true) the extension uses `AI.ask`.

## Architecture

```
src/
  ai-emoji-search.tsx        the command: passes the launcher argument to the grid
  emoji-grid.tsx             Grid UI: debounce, selection at launch, sections, actions, recents
  model-picker.tsx           ⌘M list of connections and models
  data/emoji.json            generated by scripts/build-emoji-data.mjs (unicode-emoji-json + emojilib)
  data/keywords-de.json      generated by scripts/build-keywords.mjs (emojibase-data, German)
  lib/emoji-data.ts          dataset, lookup, normalization
  lib/local-search.ts        name/keyword search, ranked, English and German
  lib/locale-keywords.ts     language resolution and umlaut folding
  lib/prompt.ts              system + user prompt asking for a JSON array of emojis
  lib/parse-suggestions.ts   model text → validated, de-duplicated emoji list
  lib/plist.ts               minimal XML plist parser
  lib/tinycast-settings.ts   decode the AI keys, resolve the route, list choices for ⌘M
  lib/keychain.ts            read secrets through `security`
  lib/providers.ts           HTTP requests / CLI argv per route, response extraction, timeouts, effort
  lib/suggest.ts             orchestrator: settings → route → call → parse, cache, in-flight reuse
  lib/request-policy.ts      debounce tiers and timeouts
  lib/exec.ts                promise wrapper around child_process.execFile (injectable)
  lib/sections.ts            what the grid shows (recents / AI / name matches)
  lib/placeholder.ts         search bar text that says what the grid shows
  lib/skin-tone.ts           apply a skin tone with valid sequences only
  lib/usage.ts               decaying usage store that ranks name matches
  lib/diagnostics.ts         the ⌘⇧D report, with secret redaction
  lib/eval-score.ts          scoring for the suggestion evaluation
eval/                        30 sample searches, runner and README (needs an API key, not in CI)
scripts/                     data builders, icon renderer, evaluation entry point
assets-src/icon.svg          icon source; assets/icon.png is rendered from it
test/                        vitest, one file per module; test/fixtures holds real Mac reports
```

Every module with I/O takes its dependencies (exec, fetch) as parameters, so all logic is unit
tested without macOS, Tinycast or network.

## Development approach

- **TDD:** tests first (vitest), then the implementation, then refactor. Sonnet sub-agents build
  independent modules in parallel; the UI is wired last by one agent, then reviewed.
- **Checks:** `npm run check` runs lint (ESLint + Prettier), typecheck, tests and build. The
  GitHub Actions workflow runs the same steps on every pull request and on pushes to `main`.
- **Integration test = real Macs.** The UI tests render the command with a mocked Raycast API, and
  Tinycast's own runtime harness was never run (executing the third-party code was declined in
  the build environment). Behaviour in Tinycast is checked on real Macs: ⌘⇧D copies a report, and
  reports that exposed a bug are kept as fixtures in `test/fixtures` and covered by
  `test/real-fixtures.test.ts`.

## Definition of done (every release)

- `npm run check` is green and the CI check passes on the pull request.
- Version bumped in `package.json`, entry in `CHANGELOG.md`, README updated (including the privacy
  note when data flows change).
- The features that cannot be tested here are listed in the pull request, and the next ⌘⇧D
  reports from a real Mac confirm them.

## Release history

### 1.0.0

- AI emoji search over Tinycast's own AI settings (API connections and the installed Claude Code
  and Codex tools), name matches shown at once, recents, paste/copy actions, per-query cache.
- Speed: ⌘M picks the model for emoji search; thinking models are asked for the lowest declared
  level, sent the way Tinycast sends it, with one retry without it on HTTP 400/422.
- Fallback to the installed Claude Code / Codex tools when Tinycast's default is Apple
  Intelligence (found on a real Mac, fixed, covered by a fixture).
- Copy Diagnostics (⌘⇧D): key names, route, key found or missing, never secrets.
- Project basics: ESLint, Prettier, CI, icon, changelog.

### 1.1.0

- **Request control:** debounce 450 ms up to 12 characters, 650 ms up to 30, 850 ms beyond;
  identical requests in flight share one call; 20 s limit for the Claude Code and Codex tools and
  30 s for API calls, each with a message that suggests a faster model.
- **Skin tone:** a preference applied to tiles, paste and copy. Seven two-person sequences are left
  unchanged because a single modifier would be invalid.
- **Usage ranking:** a 30-day half-life, capped at 300 entries; it only reorders name matches. The
  AI order is never changed, because the model's ranking is the product.
- **German name search:** labels and keywords for all 1914 emojis, chosen by a preference or the
  system language, with umlaut folding ("fröhlich", "frohlich", "froehlich").
- **Selected text and launcher argument**, first as a second command.
- **Evaluation:** 30 samples, scoring (hit rate in the top 8 and 24, forbidden hits) and a runner.
- **Self-contained bundle:** emoji data is generated into `src/data`; with two commands the build
  had started shipping the data packages as external `node_modules`.

### 1.2.0

- **One command.** The selected-text command is gone. `ai-emoji-search` reads the selection in the
  background when the **Selected Text** preference (default on) is set and no argument was given.
  The grid renders at once; a non-blank result becomes the initial query only if the user has not
  typed, and the AI request starts without debounce. A rejection or blank text does nothing and
  shows no toast.
- **State in the search bar.** Because Tinycast hides section titles, the placeholder shows the
  initial query or "Recently used". AI tiles stay numbered.
- **Diagnostics** gained a Launch section (source, whether the selection was used, recents, usage
  entries) and never contain the selected text.
- **Docs corrected:** the model name is not visible in Tinycast's grid, only in Raycast, via ⌘M
  and in the diagnostics.

## Open work

Suggested order: 1 and 2 first (they need no new design), then 3 to 5 (small features), then 6 to
8 (more work).

### Not yet verified on a real Mac

German name search (needs the system on German or the preference set), skin tone, and the
launcher argument. Confirm with the next ⌘⇧D report and a short manual check.

### Housekeeping

- **Protect `main`:** a ruleset that blocks force pushes and deletion and requires the CI check
  `check`. The build environment cannot change repository settings, so the owner sets it up in
  GitHub (Settings → Rules).

### 1. Measure and improve the suggestions

The evaluation exists but has never run against a real model.

- Run it with a real key (`eval/README.md`), then tune the prompt and the default count from the
  results.
- Rank emojis that are picked often higher in the AI section as well? Decide after the run; today
  the model's order is kept.

### 2. Stop depending on Tinycast's internals

The extension reads Tinycast's private preference keys and Keychain items. A Tinycast update can
rename any of them and break the extension without warning.

- Open an issue (or pull request) at `abue-ammar/tinycast` asking for `AI.ask` support in the
  extension runtime, backed by Tinycast's own provider layer.
- The extension already uses `AI.ask` whenever `environment.canAccess(AI)` is true, so it would
  switch over without a code change. That would also remove the Keychain prompt and make Apple
  Intelligence, Grok, OpenCode and Cursor usable.
- Until then, the key list in Copy Diagnostics shows renamed keys early.

### 3. Pick several emojis in one go

An "Add to Selection" action that puts the emoji in a small tray and keeps the grid open, plus
"Paste Selection" and "Copy Selection" for the whole sequence. A single pick keeps working as it
does today. The tray needs a visible place; with no section titles, the search bar placeholder
can show the tray ("Selection: 🎉🥳 — Enter adds, ⌘⏎ pastes").

### 4. Tone switch next to the search field

A search-bar dropdown (`Grid.Dropdown`) with "Any", "Work", "Casual" and "Playful". The choice is
added to the prompt and to the cache key, and it is remembered between launches.

### 5. Paste in the format the app expects

A choice of what gets inserted: the emoji itself, a Slack or GitHub shortcode (`:tada:`), or a
gitmoji code for commit messages. Needs the real Slack/GitHub name lists (gemoji), because the
Unicode-based slugs used by "Copy Shortcode" today don't always match.

### 6. Built-in answers for common searches

A table of a few hundred frequent searches ("happy", "thanks", "birthday", "sorry") with emojis
prepared in advance. They appear instantly, cost nothing and work with no AI set up; the AI still
answers everything else. The table is generated once with a model by a script and checked into
the repo, so it can be regenerated.

### 7. Ready-made combinations

Ask the AI for two or three short sequences as well (for "birthday": 🎉🥳🍾). Tinycast shows no
section titles, so a combination is a tile whose content is the whole sequence and whose title
starts with "Combo". The answer format changes from a plain array to an object with `emojis` and
`combos`; the parser keeps accepting the plain array.

### 8. Search memory: recent and most-asked searches

Today's cache is keyed by model and query and only makes a repeat fast. Add a second, long-lived
store that learns which searches are asked most, and keeps their answers.

- **Two tiers.** A small _recent_ tier (the last 20 searches) and a _frequent_ tier (up to 200
  searches, configurable). A search enters the recent tier when it is first answered and is
  promoted to the frequent tier the second time it is asked. This keeps one-off searches from
  pushing out established ones.
- **What an entry holds.** The normalized query, its emojis, the model that answered, a use count,
  and the time it was last used.
- **What counts as a use.** Asking the search counts once; picking an emoji from it counts double,
  because that shows the answer was useful.
- **Eviction.** When the frequent tier is full, drop the entry with the lowest score. The score is
  the use count with a time decay (halved every 30 days without use), so old habits fade and the
  store ends up holding the searches asked most over time.
- **Where it shows.** Answers from the store appear instantly, for any model, before the AI is
  asked. The empty screen shows one tile per remembered search: the search's best emoji as the
  content and the query as the title. Selecting it shows that search's results as the initial
  query (Tinycast cannot fill the search field), and typing replaces it.
- **Control.** Actions "Refresh Suggestions" (ask the AI again and replace the stored answer),
  "Forget This Search" and "Clear Search Memory".
- **Storage.** `LocalStorage`, one JSON document, because Raycast's `Cache` may evict entries on
  its own. The store logic is a pure module with unit tests for promotion, scoring, decay and
  eviction.
