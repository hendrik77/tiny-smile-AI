# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-11-11

### Added

- Multi-pick: **Add to Selection** (⌥⏎) collects up to 12 emojis while the grid stays open;
  **Paste Selection**, **Copy Selection**, **Remove Last from Selection** (⌘⌫) and **Clear
  Selection**. The selection is shown in the search bar placeholder.
- Tone dropdown next to the search field (Any, Work, Casual, Playful), remembered and part of the
  cache key.
- Insert As preference: paste and copy the emoji, a GitHub shortcode or a Slack shortcode.
- Combinations: the AI also suggests short emoji sequences, shown as "Combo · …" tiles
  (preference **Combinations**).
- Built-in answers: about 265 common searches in English and German are answered at once without
  the AI (tone "Any" only; preference **Built-in Answers**).
- Search memory: your searches and their answers are remembered on this Mac, answered at once on
  repeat, and listed as "Search · …" tiles on the start screen with **Show Results**, **Forget This
  Search** (⌃X), **Clear Search Memory** and **Back to Start**. Selected text is never stored
  (preference **Search Memory**). Like the built-in answers it applies only to the tone "Any".
- **Refresh Suggestions** (⌘R): asks the AI again for the current search, bypassing built-in and
  remembered answers and the cache, and replaces the stored answer.
- Copy Diagnostics reports the answer source, the search memory counts and the built-in table
  (never any search text).

### Changed

- A selection longer than 300 characters is no longer used as the first search and is not sent to
  the AI provider; Copy Diagnostics says why it was not used. The launcher argument keeps its
  500-character cap.

### Fixed

- Emojis picked, or a model chosen, in the first moments after opening (before the stored recents,
  usage counts and model choice had been read) no longer overwrite or get lost against the stored
  data; clearing the recents in that moment sticks.
- A pick from a launcher-selected text no longer counts for a remembered search.
- Clearing the field and quickly typing something new no longer fires a request for the text that
  was cleared.

### Internal

- A test checks that `src/data/emoji.json` and `src/data/keywords-de.json` match their generators;
  `npm run build:data` regenerates both.
- `eval/` is now type-checked by `npm run typecheck`.
- Upgraded vitest to 5.x and ran `npm audit fix` for the development dependencies.

## [1.2.0] - 2026-11-10

### Added

- Selected Text preference (on by default): the selection of the frontmost app is used as the first
  search when the command starts.
- Launch section in Copy Diagnostics (query source, whether the selection was used, recents, usage
  entries); the selected text itself is never included.

### Changed

- One command: the separate "AI Emoji for Selected Text" command is gone, its behaviour is the
  default of AI Emoji Search. The selection is read in the background, so the grid opens at once,
  and nothing is shown when there is no selection.
- The search bar placeholder shows the state ("Emojis for selected text “…”", "Recently used"),
  because Tinycast hides grid section titles.

### Fixed

- The README no longer claims that the model name is visible in the grid; it is only in the
  section title in Raycast.

## [1.1.0] - 2026-11-10

### Added

- AI Emoji for Selected Text command: suggestions for the text selected in the frontmost app.
- Optional launcher argument for AI Emoji Search (`emoji finally friday`), shown as the initial
  query until you type.
- Skin Tone preference, applied to emojis that support one (shown, pasted and copied).
- Name Search Language preference with German name matching.
- Emojis you pick often rank higher in Matching Names.
- Language, system locale and skin tone in Copy Diagnostics.
- A repeatable suggestion evaluation script (`eval/`).

### Changed

- Longer queries wait longer before asking the AI (0.45 s, 0.65 s, 0.85 s).
- Identical searches in flight share one request.
- Claude Code and Codex tool requests stop after 20 s, API requests after 30 s.
- The README now says that typed and selected text is sent to the configured AI provider.
- Emoji data is generated into the repo (`scripts/build-emoji-data.mjs`), so each command bundle is
  self-contained and needs no package at runtime.

## [1.0.0] - 2026-11-09

### Added

- AI emoji search grid that reuses Tinycast's AI settings (connections and default model), with
  instant name matching while the AI is still answering.
- Model choice (⌘M): use a different Tinycast connection and model for emoji search than for chat.
- Minimal-thinking requests ("Fast answers" preference) using the lowest thinking level declared
  for the model in Tinycast.
- Fallback to the installed Claude Code and Codex tools when no API connection can be used.
- Copy Diagnostics (⌘⇧D) for bug reports, without API keys or header values.
- ESLint, Prettier and a GitHub Actions workflow (lint, typecheck, test, build) with
  `npm run lint`, `npm run format` and `npm run check`.
