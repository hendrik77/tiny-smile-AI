# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
