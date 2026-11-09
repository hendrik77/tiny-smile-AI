# Tiny Smile AI

AI emoji search for [Tinycast](https://tinycast.dev). Describe a feeling, situation or thing
("finally friday", "sorry for your loss", "deploy went fine", "pizza party in the rain") and pick
from emojis that fit, suggested by **the AI model you already set up in Tinycast**. It works like
Raycast's AI emoji picker.

Tinycast's own emoji picker matches emoji names only. This extension also understands meaning,
mood and slang.

## What you get

- **AI Suggestions**: every emoji the model picked (24 by default), best fit first. The section
  title shows which Tinycast model answered.
- **Matching Names**: classic name and keyword matches, shown right away while the AI is still
  thinking, and as a fallback when there's no AI.
- **Recently Used** when the search field is empty.
- **Enter** pastes the emoji into the app you came from. You can also copy the emoji (or set copy
  as the default action), copy its name (⌘⇧C) or its `:shortcode:` (⌘⌥C).
- **Choose AI Model… (⌘M)** lets emoji search use a different model than your Tinycast chat:
  every enabled Tinycast connection and model is listed, with "Tinycast Default" on top. The
  choice is remembered. Pick something small and fast (Claude Haiku, GPT-4.1 mini, Gemini Flash)
  and keep your big model for chat.
- Answers are cached per search, so repeating a search is instant and costs nothing.

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
   Cursor), it falls back to your first enabled API connection.
4. Routes you switched off in Tinycast stay off.

API keys are read from the login Keychain, where Tinycast stores them (one item per connection).
The first time, **macOS asks whether `security` may read the "com.tinycast.app.ai-api-keys"
item**. Choose **Always Allow** so it doesn't ask again. Keys are only sent to the endpoint of their
own connection, and plain HTTP is only allowed for `localhost`.

When the extension runs in Raycast itself, it uses Raycast AI.

### Settings

| Preference | Default | What it does |
| --- | --- | --- |
| Tinycast Channel | Tinycast | Read settings from Tinycast, Tinycast Beta or Tinycast Dev |
| AI Suggestions | 24 | How many emojis to ask for (12–48). Fewer means a shorter answer, so it arrives sooner |
| Speed | On | Ask thinking models to think as little as possible (see below) |
| Primary Action | Paste | Whether Enter pastes or copies |

### Speed

How long a search takes depends almost entirely on the model:

- **Use a small model.** Pick one with **Choose AI Model… (⌘M)**. Haiku-, mini- and Flash-class
  models usually answer in one to three seconds.
- **Fast answers (on by default).** If you declared thinking levels for a model in Tinycast
  (Settings → AI → the connection's model), the extension sends the lowest one ("none",
  "minimal" or "low"), using the same request fields Tinycast uses. If a provider rejects that
  field, the request is retried once without it.
- **Fewer suggestions.** 12 instead of 24 halves what the model has to write.
- **API connections are faster than installed tools.** `claude` and `codex` start a whole program
  for every search, which adds a few seconds.

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
  GitHub issue. The report contains no API keys or header values, only names, hosts and model ids.

## Development

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npx ray build -e dist -o dist
```

The code is split into small, dependency-injected modules under `src/lib/` (dataset, local search,
prompt, response parsing, plist reader, Tinycast settings, Keychain, providers, orchestrator), each
with vitest tests in `test/`. See [PLAN.md](PLAN.md) for the design.

Emoji data comes from [unicode-emoji-json](https://github.com/muan/unicode-emoji-json) and
[emojilib](https://github.com/muan/emojilib).

## License

MIT
