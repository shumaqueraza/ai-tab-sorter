# Contributing to AI Tab Sorter

Thanks for helping! This mod is **vanilla JS with zero build step** — the file users run is exactly the file in this repo, so every PR ships instantly to Sine users on `main`.

## Dev setup

1. Clone the repo.
2. Install [Zen Browser](https://zen-browser.app) (stable channel; test alpha/beta before releases).
3. Install [Sine](https://github.com/CosmoCreeper/Sine), add this repo by name — or copy `ai-tab-sorter.uc.js` to your profile's `chrome/JS` folder via [fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig).
4. After changes: `about:support` → **Clear startup cache** → restart Zen. Console (`Ctrl+Shift+J`) shows `[AITabSorter]` logs when debug logging is on.

## Before opening a PR

```bash
npx eslint ai-tab-sorter.uc.js --max-warnings 0   # lint (privileged globals are declared)
node scripts/validate-manifests.mjs                    # theme.json + preferences.json spec
node --test scripts/unit-tests.mjs                     # pure-module tests
```

CI runs the same three commands.

## Rules of the road

- **Never break `main`** — Sine auto-updates users from it. Land risky work behind a default-off pref first.
- **Never call `removeTab()` in the sort path.** Sorting is structurally lossless; tab-discard features are explicitly out of scope.
- **Selector changes must extend the fallback chain**, not replace it (Zen renames tab-strip selectors across releases — this is what killed the predecessor mod).
- **Capability-probe, don't assume**: check `typeof gBrowser.addTabGroup === "function"`, ATG presence via `globalThis.advancedTabGroups`, workspace id before touching any tab or group.
- prefs live under `mod.aitabsort.*`; add new ones to `PrefStore.DEFAULTS`, `preferences.json` (if user-facing basics), and the panel.
- Keep every network call behind the `ProviderHub` abstraction with an `AbortController` timeout.

## Testing matrix (pre-release)

| Axis | Cases |
|---|---|
| Zen channel | stable / beta / alpha |
| ATG | installed (current) / not installed (expect graceful explanatory state) |
| Provider | Ollama / LM Studio / OpenAI-compat cloud / unreachable (heuristic fallback) |
| Sort scope | all ungrouped tabs / multi-selected tabs |
| Edge | 100+ tabs · 1 tab · already-grouped tabs · workspace switch mid-sort · collapsed target group |

## Commit style

Conventional commits: `fix: re-attach buttons on workspace switch`, `feat: gemini adapter`. Tag releases `vX.Y.Z` matching `theme.json.version` (CI validates).
