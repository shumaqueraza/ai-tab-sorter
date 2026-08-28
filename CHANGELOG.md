# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [0.1.2] — 2026-08-29

First fully-working release on a real machine (validated on Zen + Sine 2.x, Windows).

### Fixed
- **⚙ panel crashed on open** (`DOMException: invalid string`): in XUL documents `innerHTML` is parsed with XML rules, and one bare attribute (`<option … selected>`) is illegal XML — the whole panel markup failed to parse, so Fetch Models was unreachable. All markup is now XML-well-formed.
- **Sort button position**: now placed right beside the workspace-header Clear button (auto-detected at runtime); falls back to just under the header row instead of the strip bottom.

### Added
- **Fetch Models inside the Sine settings panel** — a ⟳ Fetch Models button is injected next to the "Model name" field in Zen Settings → Mods (script now also runs in `preferences.xhtml`). Picking a model from the popup writes the pref through Sine's own save path (input + change event), showing its restart toast.
- README + TESTING now document the `sine.allow-unsafe-js = true` requirement — Sine silently refuses to execute JS from non-store repos without it (this cost a full debugging session).

## [0.1.1] — 2026-08-29

Critical fix: mod installed via Sine but never executed.

### Fixed
- **Script path mismatch (the big one):** `theme.json` declared the script as `ai-tab-sorter.uc.js` while the file lived at `src/ai-tab-sorter.uc.js`. Sine resolves script keys from the repo root → silent 404 → mod installed but completely dead (no button, no console output). The script now lives at the repo root, mirroring the proven Advanced-Tab-Groups layout.
- **Button anchors for Zen's vertical tab strip:** replaced the stale `.pinned-tabs-container-separator` primary anchor with the current-Zen chain used by ATG: active workspace strip's `.zen-workspace-normal-tabs-section` → any strip section → `#tabbrowser-arrowscrollbox-periphery` → `#tabbrowser-tabs`.
- **Silent failure mode:** init now always logs one `console.info` line (`initialized v… — buttons: injected|pending anchor`), disabled state explains itself, and the no-anchor warning prints once instead of being hidden behind the debug pref.

### Added
- `changeWorkspace` hook — re-injects buttons on every workspace switch, not just strip rebuilds.
- Longer injection retry ladder (0.5s/1s/3s/7s/15s) for slow-mounting workspace strips.
- **CI regression guard:** `validate-manifests.mjs` now fails if any `theme.json` script key or style file does not exist at its declared path — this exact bug can never ship again.

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
