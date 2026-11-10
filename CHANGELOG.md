# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
