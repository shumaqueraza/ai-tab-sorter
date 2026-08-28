# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [0.1.0] — 2026-08-29

First working release.

### Added
- **Sort button** injected above the tab strip (`.pinned-tabs-container-separator`, fallback `#tabbrowser-arrowscrollbox-periphery`), re-attached via `gZenWorkspaces` hooks + MutationObserver — survives workspace switches and strip rebuilds.
- **Settings panel** (native arrowpanel styling): provider preset, base URL, API key, granularity, output mode, min group size, payload privacy mode, timeout, group-reuse toggle, offline-fallback toggle, debug logging, live privacy flow disclosure, "Sort tabs now" action.
- **⟳ Fetch Models**: live model discovery — OpenAI-compatible `GET /v1/models`, Ollama `GET /api/tags` (with parameter sizes), Gemini `GET /v1beta/models` (filters embedder models). Model list cached across restarts.
- **Model selector dropdown** populated from fetched list; manual model names preserved.
- **10 provider presets**: Ollama, LM Studio, llama.cpp, OpenAI, OpenRouter, Groq, Together, Mistral, Google Gemini, Custom (any OpenAI-compatible URL).
- **Batch categorization**: numbered title/URL payloads, existing-group exact-name reuse, 5 granularity levels, lines + JSON output modes, `temperature 0.1`, dynamic token budgets, 30-tab chunking.
- **Response repair ladder**: numbering/bullet/bold/quote stripping, count-mismatch repair (truncate/pad/single-line), JSON recovery from chatty wrappers.
- **Offline heuristic fallback**: hostname buckets + shared-keyword buckets, respects min group size — works with zero AI configured.
- **Grouping engine**: reuse-or-create via `gBrowser.moveTabToGroup` / `gBrowser.addTabGroup`, collapsed-group expansion, post-verify + fallback lookup, 8-color rotation, workspace filtering, split-view/empty/pinned/internal-URI exclusions. Never closes tabs.
- **Selection mode**: multi-select tabs → sort only the selection.
- Sine + Zen Mods Registry packaging (`theme.json` with `style.chrome`, `preferences.json`), ESLint (flat config, privileged globals), manifest validator, 31 unit tests, GitHub Actions CI.
