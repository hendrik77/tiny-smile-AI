# Tiny Smile AI

AI emoji search for [Tinycast](https://tinycast.dev). Describe a feeling, situation or thing
("finally friday", "sorry for your loss", "deploy went fine", "pizza party in the rain") and pick
from emojis that fit, suggested by **the AI model you already set up in Tinycast**. It works like
Raycast's AI emoji picker.

Tinycast's own emoji picker matches emoji names only. This extension also understands meaning,
mood and slang.

## What you get

- **One command, "AI Emoji Search".** The grid lists the **AI picks** first, best fit first (24 by
  default), numbered "1.", "2.", and so on. Below them come the **name matches**: classic name and
  keyword matches, shown right away while the AI is still thinking, and as a fallback when there is
  no AI.
- **Tinycast does not show section titles in grids.** The titles "AI Suggestions · <model>",
  "Matching Names" and "Recently Used" only appear in Raycast. In Tinycast the numbering marks the
  AI picks, and the **search bar placeholder** tells you what you are looking at: "Emojis for
  “…”" for a launcher argument, "Emojis for selected text “…”" for a selection, "Results for “…”"
  for a remembered search you opened, "Recently used" and "your searches" for the start screen, and
  "Selection: …" while you collect several emojis. The model in use is visible via **Choose AI Model… (⌘M)** and in **Copy
  Diagnostics (⌘⇧D)**; the section title with the model name only shows in Raycast.
- **Selected text**: when the command starts without an argument, the selection of the frontmost
  app (read through the macOS Accessibility API) becomes the first search, and the AI request
  starts at once. The grid opens immediately and fills in when the selection has been read. With
  nothing selected, or without the Accessibility permission, nothing happens and you get the
  normal search. A selection longer than 300 characters is not used (and not sent anywhere), so
  a passage of a document stays local. Typing replaces it; clearing the field brings it back. Turn
  it off with the **Selected Text** preference.
- **Search from the launcher**: the command takes an optional text argument. Type the command's
  alias or name, then Tab/space for the argument, as Tinycast shows it (for example
  `finally friday`), and the results open straight away. The argument counts as an initial query
  shown while the field is empty (Tinycast cannot fill the field); typing replaces it. With an
  argument, the selected text is not read.
- **Skin tone** and **name search in your language** (German so far) via the settings below, and
  emojis you pick often move up within the name matches.
- **Recently used** emojis when the search field is empty, followed by your remembered searches
  (see Search memory).
- **Pick several emojis** (⌥⏎): **Add to Selection** puts the emoji in a small selection (up to 12,
  repeats allowed) and keeps the grid open. The selection is shown in the search bar placeholder
  ("Selection: 🎉🥳 — ⌥⏎ adds, ⏎ pastes"). While it is not empty, the first action is **Paste
  Selection** (then **Copy Selection**, **Remove Last from Selection** with ⌘⌫, **Clear
  Selection**). Pasting or copying it counts every emoji as used and empties it.
- **Tone**: the dropdown next to the search field (Any, Work, Casual, Playful) tells the AI what
  register to aim for. It is remembered, and a different tone asks again.
- **Insert As**: paste and copy the emoji itself, a GitHub `:tada:` shortcode or a Slack one, for
  apps that expect codes. An emoji without a code in the chosen set is inserted as the emoji.
- **Combinations**: besides single emojis the AI suggests up to three short sequences ("🎉🥳🍾"
  for "birthday"). Each is a tile whose title starts with "Combo ·"; Enter pastes the whole
  sequence. Turn it off with the **Combinations** preference.
- **Built-in answers**: about 265 very common searches in English and German ("thanks", "birthday",
  "sorry", "hungry", "danke" …) are answered at once from a table that ships with the extension.
  No AI is asked, so they cost nothing and work without any AI set up. They are only used with the
  tone "Any" (the table is tone-neutral), as are remembered searches (see below). Press **Refresh Suggestions (⌘R)** to ask the AI anyway.
  Turn them off with the **Built-in Answers** preference.
- **Search memory**: the extension remembers your searches and their answers. A search you ask
  again is shown at once, without calling the AI. The start screen lists them after the recents:
  one tile per search, showing its first emoji, titled "Search · …". **Show Results** opens it
  (type to search something else, **Back to Start** to return), **Forget This Search** (⌃X)
  removes one, **Clear Search Memory** removes all. A search enters the memory when the AI has
  answered it; the second time you ask it, it moves to the frequent searches, and picking an
  emoji counts double. What is stored: your searches and their answers, on this Mac only, in the
  extension's local storage. Like the built-in answers, the memory applies only to the tone "Any":
  with another tone, remembered answers are not used (the AI is asked, with that tone) and
  nothing is stored or counted. Selected text is never stored (it is not a deliberate search). Turn
  it off with the **Search Memory** preference; then nothing is read, stored or shown.
- **Refresh Suggestions (⌘R)**: asks the AI again for the current search, ignoring the remembered
  and built-in answer and the cache, and replaces what is shown (and stored). If it fails, the
  previous tiles stay and a message tells you why.
- **Enter** pastes the emoji into the app you came from. You can also copy the emoji (or set copy
  as the default action), copy its name (⌘⇧.) or its `:shortcode:` (⌘⌥S).
- **Choose AI Model… (⌘M)** lets emoji search use a different model than your Tinycast chat:
  every enabled Tinycast connection and model is listed, with "Tinycast Default" on top. The
  choice is remembered. Pick something small and fast (Claude Haiku, GPT-4.1 mini, Gemini Flash)
  and keep your big model for chat.
- Answers are cached per search, so repeating a search is instant and costs nothing. **Refresh
  Suggestions** bypasses the cache.

## Install

In Tinycast: **Settings → Extensions → Install New → Install from GitHub** and enter
`hendrik77/tiny-smile-AI`.

Or build it yourself and use **Add from folder**:

```bash
npm install
```

```bash
npx ray build -e dist -o dist
```

Then pick the `dist` folder in **Settings → Extensions → Install New → Add from folder**.

## How it uses Tinycast's AI settings

Tinycast runs Raycast extensions, but its runtime doesn't offer `AI.ask` to extensions. So this
extension reads the AI setup Tinycast already has and calls that model itself:

1. It reads Tinycast's AI connections and default model from Tinycast's preferences
   (`defaults export com.tinycast.app`).
2. It uses your **default AI model** from Tinycast → Settings → AI if it can:
   - **API connections**: OpenAI, Anthropic, Google Gemini, OpenRouter, OpenAI-compatible
     (Ollama, LM Studio, and others).
   - **Installed tools**: `claude` (Claude Code) and `codex`.
3. If the default is something an extension can't reach (Apple Intelligence, Grok, OpenCode,
   Cursor), it falls back to your first enabled API connection, then to an installed Claude
   Code or Codex tool.
4. Routes you switched off in Tinycast stay off.

API keys are read from the login Keychain, where Tinycast stores them (one item per connection).
The first time, **macOS asks whether `security` may read the "com.tinycast.app.ai-api-keys"
item**. Choose **Always Allow** so it doesn't ask again. Keys are only sent to the endpoint of their
own connection, and plain HTTP is only allowed for `localhost`.

When the extension runs in Raycast itself, it uses Raycast AI.

### Settings

| Preference           | Default  | What it does                                                                           |
| -------------------- | -------- | -------------------------------------------------------------------------------------- |
| Tinycast Channel     | Tinycast | Read settings from Tinycast, Tinycast Beta or Tinycast Dev                             |
| AI Suggestions       | 24       | How many emojis to ask for (12–48). Fewer means a shorter answer, so it arrives sooner |
| Speed                | On       | Ask thinking models to think as little as possible (see below)                         |
| Primary Action       | Paste    | Whether Enter pastes or copies                                                         |
| Skin Tone            | Default  | Skin tone applied to emojis that support one (shown, pasted and copied)                |
| Name Search Language | System   | Extra language for the instant name matches (English is always searched)               |
| Selected Text        | On       | Use the selection (up to 300 characters) as the first search when the command starts   |
| Insert As            | Emoji    | What Paste and Copy insert: the emoji, a GitHub shortcode or a Slack shortcode         |
| Combinations         | On       | Also ask the AI for a few ready-made emoji sequences                                   |
| Built-in Answers     | On       | Answer common searches from the built-in table, without the AI (tone "Any" only)       |
| Search Memory        | On       | Remember your searches and their answers on this Mac; show and reuse them              |

### Shortcuts

| Shortcut | Action                                                                      |
| -------- | --------------------------------------------------------------------------- |
| ⏎        | Paste the emoji (or the selection, when there is one); copy if you chose it |
| ⌥⏎       | Add to Selection                                                            |
| ⌘⌫       | Remove Last from Selection                                                  |
| ⌘R       | Refresh Suggestions                                                         |
| ⌃X       | Forget This Search (on a search tile)                                       |
| ⌘M       | Choose AI Model…                                                            |
| ⌘⇧D      | Copy Diagnostics                                                            |
| ⌘⇧.      | Copy Name                                                                   |
| ⌘⌥S      | Copy Shortcode (or Copy Emoji, with Insert As set to a shortcode)           |

### Speed

How long a search takes depends almost entirely on the model:

- **Use a small model.** Pick one with **Choose AI Model… (⌘M)**. Haiku-, mini- and Flash-class
  models usually answer in one to three seconds.
- **Fast answers (on by default).** If you declared thinking levels for a model in Tinycast
  (Settings → AI → the connection's model), the extension sends the lowest one ("none",
  "minimal" or "low"), using the same request fields Tinycast uses. If a provider rejects that
  field, the request is retried once without it.
- **Fewer suggestions.** 12 instead of 24 halves what the model has to write.
- **Longer queries wait a little longer.** The search starts after a short pause in typing: 0.45 s
  for short queries, more for longer ones. A search that takes too long is stopped after 20 s
  (Claude Code and Codex tools) or 30 s (API connections).
- **API connections are faster than installed tools.** `claude` and `codex` start a whole program
  for every search, which adds a few seconds.

## Privacy

What you type is sent to the AI provider configured in Tinycast (or run through the local Claude
Code / Codex tool). With **Selected Text** on, the selection of the frontmost app is read when the
command starts and sent the same way, like typed text, but only when it is at most 300 characters
long; a longer selection is ignored and never sent. Turn the preference off to avoid this
altogether. Nothing is read when you give the command an argument. Answers from the built-in table
and from search memory send nothing to the AI. Name search, recents, usage ranking and search
memory stay on your Mac: search memory keeps the searches you typed (or gave as an argument) and
their answers in the extension's local storage, never the selected text. **Clear Search Memory**
deletes it, and the **Search Memory** preference stops it.

## Troubleshooting

- **"No AI model available"**: add an API connection in Tinycast → Settings → AI → Providers, or
  switch on the Claude/Codex tool there. Name search keeps working without AI. When Tinycast's
  default is Apple Intelligence, the extension falls back to your first API connection, then to
  the installed Claude tool, then Codex; use **Choose AI Model… (⌘M)** to pick one explicitly.
- **"Could not read API key from the keychain"**: you denied Keychain access. Run the search again
  and choose **Always Allow**.
- **"Couldn't find the `claude` command"**: the extension looks in `~/.local/bin`,
  `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.bun/bin`, `~/.volta/bin`,
  `~/.npm-global/bin` and `/usr/bin`.

- **Report a problem**: press **⌘⇧D** (Copy Diagnostics) in the grid and paste the result into a
  GitHub issue. The report contains no API keys or header values, only names, hosts and model ids,
  and counts for the search memory, never the searches themselves.

## Development

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run format
```

```bash
npx ray build -e dist -o dist
```

Run everything CI runs (lint, typecheck, tests, build) in one go:

```bash
npm run check
```

The code is split into small, dependency-injected modules under `src/lib/` (dataset, local search,
prompt, response parsing, plist reader, Tinycast settings, Keychain, providers, orchestrator), each
with vitest tests in `test/`. See [PLAN.md](PLAN.md) for the design.

The suggestion evaluation script and its samples are described in [eval/README.md](eval/README.md).

Emoji data comes from [unicode-emoji-json](https://github.com/muan/unicode-emoji-json) and
[emojilib](https://github.com/muan/emojilib).

## License

MIT
