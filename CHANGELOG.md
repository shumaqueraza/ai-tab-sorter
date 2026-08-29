# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [0.1.4] — 2026-08-29

The "make it look good" release: colors, collapsing, a stronger prompt, and fixes
for every issue reported from live v0.1.3 console logs.

### Added
- **Group colors** — new groups rotate through Firefox's valid native tab-group
  colors (`blue, cyan, green, yellow, orange, red, pink, purple, gray`; the old
  `turquoise` is not a valid color name and silently fell back to default).
  Reused groups keep their existing color. Pattern taken from working mods.
- **Auto-collapse after sorting** — new `mod.aitabsort.collapseGroups` pref
  (default on): every group the sort built/reused ends collapsed for a tidy
  strip, exactly like the classic AI groupers. Groups are temporarily expanded
  before `addTabs()` (moving tabs into a collapsed group is unreliable).
- **Much stronger prompt** — Darsh-style numbered rules: EXACT reuse of existing
  group names (no "Project Docs" → "Project Documentation" variations),
  domain-first naming for new groups (GitHub, YouTube, …), strict 1–2 word
  Title-Case format, plus a few-shot example block. Junk answers that echo the
  instructions ("We Need To Categorize", "Thus Tabs 1-3 Are", …) are filtered
  out by the response parser instead of becoming one-tab garbage groups.

### Fixed
- **Fetch Models was blocked by CSP in the settings page** (`connect-src …
  default-src chrome:` on about:preferences): the settings page now borrows the
  main browser window's fetch (where sorting already talks to providers) via
  `Services.wm.getMostRecentWindow("navigator:browser")` and only falls back to
  a local fetch.
- **Local files (`file://`) and most `about:` pages were never sent to the
  model** — the collector excluded them outright. Only truly internal pages
  (`chrome:`, `resource:`, `moz-extension:`, `data:`, `blob:`, and empty
  about: pages) are skipped now; local files are clustered on their filename.
- **Sort button flickering/jumping between two positions**: Sine hot-rebuilds
  the mod on every pref change WITHOUT unloading the old script, so v0.1.2's
  injector kept re-adding its button at the old anchor while v0.1.3 placed the
  twin beside Clear — the two fought constantly. Every script load now tags its
  own button with a run token and sweeps untagged/foreign AI-Tab-Sorter
  elements on mount, on strip mutations, and on a slow interval. A full restart
  still clears the last zombie permanently.
- Bigger completion budget (`max(512, 32/tab)` — weak models were truncating).

## [0.1.3] — 2026-08-29

Rebuilt on patterns copied from working Zen mods ("tidy" in particular). This is the
version where placement, settings UI and the grouping engine all match native behavior.

### Fixed
- **Sorting did nothing** (`moved: 0, created: 0 … skipped: N`): the engine called
  `gBrowser.moveTabToGroup()` — an API that does not exist in Zen. The engine now uses
  the verified native path used by working mods: `gBrowser.ungroupTab()` →
  `gBrowser.addTabGroup(members, {label, color, insertBefore})` (three option shapes
  tried) → `groupEl.addTabs(tabs)` → `gBrowser.removeTabGroup(el)` for abandoned/empty
  groups. In-place reconcile: groups whose name survives keep position + color, only
  changed tabs move, abandoned groups dissolve without the stacked-husk flicker.
- **Sort button was a big block away from Clear**: it is now a *twin* of Zen's native
  Clear control — same tag, same classes (minus `zen-workspace-close-unpinned-tabs-button`,
  which must stay unique or Zen's own lookup steals Clear's styling), inserted directly
  to Clear's LEFT: `⇅ Sort | Clear`. Clear is hover-revealed on some builds, so a
  mouseover watcher re-places the twin the moment Clear appears, and a workspace-change
  listener moves it into the active workspace.
- **⚙ settings button removed** — Sine already renders all settings in Zen Settings;
  a second entry point in the tab strip was redundant noise. The tab strip now contains
  exactly one addition: the Sort twin.
- **Fetch Models / model dropdown never appeared in the settings panel** — two root
  causes: (1) Sine renders pref rows with dots replaced by dashes (`#mod-aitabsort-model`,
  not `#mod.aitabsort.model`), so the enhancer's lookup never matched; (2) the script
  never ran in the settings page at all, because Sine's settings UI lives in the
  `about:preferences` tab, not `chrome://…/preferences.xhtml`. The include list now
  matches `about:preferences.*`, the enhancer targets the dashed id, scans forever
  (Sine wipes + rebuilds the mods list on every pref change), and builds the dropdown
  + button purely with `createXULElement` — no `innerHTML`, so the chrome sanitizer
  can never shred it (the v0.1.2 `Removing unsafe node: select/input/button` spam and
  the `providerSel is null` crash are gone with the removed panel).
- **All normal tabs of the workspace are now sorted** (previously only ungrouped tabs
  were candidates and grouped ones were silently skipped); multi-selecting tabs still
  sorts only the selection.
- Provider preset changes now auto-sync the base URL to the preset default (unless a
  custom URL was set), directly inside the settings panel.

### Removed
- The ⚙ popup settings panel and its gear button (all settings live in the Sine panel).
- The strip-bottom / periphery fallback button placements (the twin pattern makes them
  unnecessary; a button floating at the bottom of the tab strip was the wrong UX).

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
