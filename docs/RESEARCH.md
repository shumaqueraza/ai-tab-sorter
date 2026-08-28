# Building an AI Tab-Sorter Mod for Zen Browser
## Deep-Dive Research & Build Plan

**Working name:** `AI Tab Sorter` (Zen store name must be < 25 chars — "AI Tab Sorter" = 13 ✓)
**Repo name:** `shumaqueraza/ai-tab-sorter`
**Date:** 2026-08-29
**Status:** Research complete — ready to build

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [The Zen Mod Ecosystem — How Mods Actually Work](#2-the-zen-mod-ecosystem--how-mods-actually-work)
3. [Tab Management in Zen — Why It's "Kinda Broken"](#3-tab-management-in-zen--why-its-kinda-broken)
4. [Competitor Teardowns](#4-competitor-teardowns)
5. [AI Provider Landscape & Integration Design](#5-ai-provider-landscape--integration-design)
6. [Proposed Architecture](#6-proposed-architecture)
7. [UI / UX Specification](#7-ui--ux-specification)
8. [Settings Schema](#8-settings-schema)
9. [Tech Stack & Engineering Practices](#9-tech-stack--engineering-practices)
10. [Feature Comparison Matrix](#10-feature-comparison-matrix)
11. [Risks, Limits & Mitigations](#11-risks-limits--mitigations)
12. [Roadmap v0.1 → v1.0](#12-roadmap-v01--v10)
13. [Publishing & Distribution Guide](#13-publishing--distribution-guide)
14. [Appendix A — API Cheat Sheet](#appendix-a--api-cheat-sheet)
15. [Appendix B — DOM Selector Cheat Sheet](#appendix-b--dom-selector-cheat-sheet)
16. [Appendix C — References](#appendix-c--references)

---

## 1. Executive Summary

Zen Browser is a Firefox-based browser with vertical tabs, workspaces, and a thriving "mods" ecosystem that works fundamentally differently from Chrome/Firefox extensions: mods are **privileged JavaScript files (`.uc.js`) injected into the browser chrome** (`browser.xhtml`) via a bootloader, styled with `userChrome.css`, and managed by a community mod manager called **Sine** or listed on the official **Zen Mods Registry**.

The single most important finding of this research:

> **Zen does not natively support tab groups.** The Zen team marked native tab groups as *not planned*. Zen's own organization primitives are **Workspaces** (isolated tab sets per workspace) and **Tab Folders** (vertical tab stacking). The wildly popular mod **Advanced Tab Groups (ATG)** — 385★, actively maintained, v3.6.0 released Aug 24, 2026 — resurrects the tab-group code that Zen *inherits from upstream Firefox 137+* but keeps disabled, by force-enabling `browser.tabs.groups.enabled` and rebuilding the entire group UI around Firefox's native group engine (`gBrowser.addTabGroup()`, `tab-group` XUL elements, `gBrowser.tabGroups`).

The second most important finding:

> **The only prior AI-grouping mod for Zen (Darsh's Ai-TabGroups-ZenBrowser) is officially broken and abandoned.** Its own README states it broke due to Zen's tab-group changes and clashes with Zen's new features. It also hardcoded exactly three providers (Gemini, Ollama, Mistral) selected by editing a config block — no custom provider support, no model discovery, which is precisely the gap our mod fills.

**Our mod therefore positions itself as:** a Sine-compatible, ATG-dependent, on-demand AI tab sorter with a first-class provider layer — any local runtime (Ollama, LM Studio, llama.cpp, Jan) or any cloud API (OpenAI, OpenRouter, Groq, Together, Mistral, Gemini) via the OpenAI-compatible protocol — with a **Fetch Models button** that live-queries the provider's `/models` endpoint and a **model selector dropdown**, exactly as you specified. Trigger is strictly **on-demand**: a Sort button injected into the tab strip (the pattern users know from Darsh's mod and other sorters), with zero background categorization.

The stack (per your choices): **Vanilla JS, no build step**, native Zen look (Photon-style settings panel), Markdown docs, Apache-2.0 license, GitHub Actions CI (ESLint + manifest validation), publishable to both Sine and the Zen Mods Registry.

---

## 2. The Zen Mod Ecosystem — How Mods Actually Work

### 2.1 The three layers of the mod stack

A Zen "mod" is not a WebExtension. It runs with **full browser chrome privileges** — the same power as the browser's own UI code. The stack has three layers:

| Layer | Technology | Role |
|---|---|---|
| **Bootloader** | [fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig) (by MrOtherGuy) | Injects scripts into browser windows at startup. Sine ships/installs its own copy. Manual installs use fx-autoconfig directly. |
| **Mod manager** | [Sine](https://github.com/CosmoCreeper/Sine) (1.4k★, MPL-2.0) | Community manager for Firefox-based browsers. Injects itself into `about:preferences`, provides a marketplace, per-mod settings UI, auto-updates pulled straight from your GitHub repo (no PR needed for updates). |
| **Registry / Store** | Zen Mods Registry (`zen-browser.app/mods`) | Official curated store. Submission via GitHub issue → bot analyzes → PR → merged. The bot **auto-syncs updates from your repo** once listed. |

**Key strategic fact:** Sine reads the *same* `theme.json` + `preferences.json` format the Zen store uses ("Sine … offers support for userChrome, userContent, the Zen mod format (chrome), and mods missing typically necessary metadata"). Ship one format, be installable everywhere. ATG does exactly this — it's simultaneously on Sine's marketplace and the Zen store.

### 2.2 What a mod package physically contains

From the actual ATG repo (verified against its `main` branch):

```
advanced-tab-groups/
├── theme.json                  ← manifest: id, scripts, prefs URL, version, author…
├── preferences.json            ← declares the settings UI (checkbox/dropdown/string)
├── advanced-tab-groups.uc.js   ← the mod itself (2,263 lines of privileged JS)
├── userChrome.css              ← tab-strip styling (215 lines)
├── README.md / CHANGELOG.md / LICENSE / image.png
```

#### `theme.json` — the manifest (real ATG example, abridged)

```json
{
  "id": "advanced-tab-groups",
  "name": "Advanced Tab Groups",
  "description": "Tab Groups for Zen Browser",
  "scripts": {
    "advanced-tab-groups.uc.js": {
      "include": ["chrome://browser/content/browser.xhtml"]
    }
  },
  "homepage": "https://github.com/Vertex-Mods/Advanced-Tab-Groups",
  "preferences": "https://raw.githubusercontent.com/Vertex-Mods/Advanced-Tab-Groups/main/preferences.json",
  "readme": "https://raw.githubusercontent.com/.../README.md",
  "style": { "chrome": "userChrome.css" },
  "author": "Vertex",
  "version": "3.6.0",
  "tags": ["Zen Browser", "Vertical Tabs", "Tab Groups", "Tab Folders", "12th"],
  "createdAt": "2025-05-25",
  "updatedAt": "2026-08-24",
  "ai": "yes",
  "fork": ["zen"]
}
```

The critical field is `scripts` → `include`. It tells the bootloader *which documents* the script should run in. Mods that touch the tab strip use `chrome://browser/content/browser.xhtml` (the main browser window). This is how we will load both the sorter UI and the settings panel.

#### `preferences.json` — declarative settings UI (official spec, verified)

The Zen docs define exactly three types — `checkbox`, `dropdown`, `string` — plus structural fields:

```json
[
  { "property": "mod.mymod.enable_dark_mode",
    "label": "Enable dark mode",
    "type": "checkbox",
    "default": "true" },

  { "property": "mod.mymod.background_color",
    "label": "Background color",
    "type": "dropdown",
    "options": [
      { "label": "Green", "value": "green" },
      { "label": "Blue",  "value": "blue"  }
    ] },

  { "type": "separator", "label": "Configurations" }
]
```

Full field reference: `property` (must follow Firefox pref naming, e.g. `mod.mymod.x`), `label`, `type`, `options` (dropdown only; `value` must be string/int, no whitespace/special chars), `default` (optional), `placeholder` (optional, string type), `disabledOn` (optional; array of `macos`/`linux`/`windows`).

**Design consequence:** the declarative UI can host *simple* settings (enable/disable, provider preset dropdown, base URL, API key, model name as a plain string). But it **cannot** host a "Fetch Models" button or a dynamic dropdown populated at runtime — the spec has no button type. Therefore our provider/model configuration must live in a **custom settings panel we render ourselves** inside `browser.xhtml` (full privileges, native Zen look), while still exposing the basic fields through `preferences.json` so users on plain Sine/Zen-store installs without opening our panel can configure everything. Both write to the same `Services.prefs` branch, so they stay in sync automatically.

### 2.3 What runs inside a `.uc.js` file

A `.uc.js` script executes in the **main browser window context** with chrome privileges. Concretely, from the ATG and Darsh sources, a mod can freely use:

- **`Services.prefs`** — read/write about:config preferences (typed access: `getStringPref`, `getBoolPref`, `getIntPref`, `prefHasUserValue`), the standard persistence layer for mod settings.
- **`gBrowser`** — the tabbrowser: `gBrowser.tabs`, `gBrowser.selectedTabs`, `gBrowser.addTabGroup()`, `gBrowser.moveTabToGroup()`, `gBrowser.removeTab()`, `gBrowser.tabGroups`, `gBrowser.tabContainer`.
- **`window.MozXULElement.parseXULToFragment()`** — the sanctioned way to create real XUL elements (e.g. `<toolbarbutton>`, `<command>`) rather than only HTML.
- **`document` / DOM** — the browser window's live DOM: query and inject into the tab strip, commandsets, panels, popups.
- **`fetch()`** — network requests from the privileged context. Darsh's mod fetches `localhost:11434` (Ollama) and Google's Gemini endpoint directly; this is our proof that **cross-origin fetch to any local or cloud provider works from a mod** without CORS extensions.
- **Zen globals** — `gZenWorkspaces` (workspaces API: `activeWorkspace`, `switchToWorkspace`, `getWorkspaces()`), `window.ZenLibrarySpaces` (the Zen Library sidebar class), `ZenThemePicker`, `SessionStore`.
- **`globalThis`** — for inter-mod communication: ATG publishes `globalThis.advancedTabGroups` and `globalThis.debugAdvancedTabGroups`, which is exactly how our mod will *detect* ATG's presence and read its group state.

#### The `// ==UserScript==` header

fx-autoconfig files start with a tiny metadata header (ATG's):

```js
// ==UserScript==
// @name           Advanced Tab Groups
// @ignorecache
// ==/UserScript==
```

### 2.4 Installation & update mechanics

- **Sine (recommended for users):** installer per-OS → Sine appears inside `about:preferences` → user adds mod from marketplace or by repo name → Sine pulls files straight from the repo's `main` branch. **Updates are automatic** — Sine re-pulls on browser start (user-controllable per mod). This is a huge maintenance win: ship to `main`, everyone gets it.
- **Manual:** install fx-autoconfig → enable `toolkit.legacyUserProfileCustomizations.stylesheets` → drop files into the profile's `chrome/JS` folder → clear startup cache via `about:support` → restart.
- **Zen Mods Registry:** submit once via issue; the registry bot generates the listing and tracks your repo for updates. Requirements (official, verified): name < 25 chars, description < 100 chars, 600×400 PNG screenshot, valid README, preferences declared as JSON, open source, no malicious code.

---

## 3. Tab Management in Zen — Why It's "Kinda Broken"

This section consolidates why tab management in Zen feels broken, what the actual primitives are, and every landmine a tab mod must dodge. This is the domain knowledge that separates a working mod from a broken one.

### 3.1 The four organization primitives

1. **Workspaces** — Zen's flagship: completely isolated tab sets with separate tab strips (think virtual desktops). Implemented via `gZenWorkspaces`; each tab/group carries a `zen-workspace-id` attribute; strips are rendered per workspace (`gZenWorkspaces.activeWorkspaceStrip`). Tabs from other workspaces are hidden but alive.
2. **Tab Folders** — Zen's native vertical stacking of tabs (one tab sits "on top of" others). Implemented with `zen-folder` XUL elements inside `gBrowser.tabContainer`. Zen's officially blessed grouping answer.
3. **Tab Groups (upstream Firefox code, disabled by Zen)** — Firefox 137 shipped real tab groups: `tab-group` elements, `gBrowser.addTabGroup(tabs, {label, color, insertBefore})`, `gBrowser.moveTabToGroup(tab, group)`, `gBrowser.removeTabGroup(group)`, `gBrowser.tabGroups` array, `browser.tabs.groups.*` prefs, and 18 built-in group colors. **Zen inherits all of this code but ships it disabled** (`browser.tabs.groups.enabled` = false) and hides the UI, because the Zen team decided tab groups were *not planned* as a Zen feature (confirmed by the "not planned" label on the request issue and community discussions).
4. **Smart Tab Groups (Firefox 141+ AI feature, also inherited)** — Firefox's built-in on-device AI grouping: MiniLM embeddings + clustering + the `Mozilla/smart-tab-topic` label generator, running locally through the Firefox AI Runtime. Toggled by `browser.tabs.groups.smart.enabled`. **This must be OFF when using ATG** — Darsh's install instructions explicitly require setting it to `false`, and its behavior clashes with group-managing mods.

### 3.2 What "broken" actually means — the concrete failure modes

From Zen's issue tracker, ATG's changelog, and community threads, the brokenness decomposes into specific, addressable failure modes:

| # | Failure mode | Evidence | Impact on our mod |
|---|---|---|---|
| 1 | **Native groups disabled + UI removed** — the engine exists but no way to create groups | Zen "not planned" decision; ATG force-enables `browser.tabs.groups.enabled` | We depend on ATG to provide the group UI; we never build group UI ourselves |
| 2 | **Frequent tab-strip DOM churn** — Zen renames/restructures selectors across releases | Darsh's code carries 6+ selector fallbacks (`zen-workspace-tabs-sectionide-separator`, `.pinned-tabs-container-separator`, `#tabbrowser-arrowscrollbox-periphery`…); ATG re-queries at runtime | Sort-button injection must use multi-selector fallback chains + a MutationObserver re-attach loop, never a single hardcoded selector |
| 3 | **Workspaces × groups interplay** — groups don't auto-hide in wrong workspaces | ATG patches `gZenWorkspaces.switchToWorkspace` and manually manages visibility per `zen-workspace-id`; ATG v3.6.0 just added "Move to Space" actions | Our sorter must only ever touch tabs/groups whose `zen-workspace-id` matches the active workspace |
| 4 | **Zen Library misrenders groups as folders** — the Library sidebar didn't understand groups | ATG 3.6.0 changelog: "Added Zen Library Spaces rendering … so tab groups no longer appear as folders" (patches `ZenLibrarySpaces.prototype.renderItemRecursive`) | Not our problem (ATG's), but validates that deep Zen patches are needed and maintained upstream of us |
| 5 | **Regression breakage on Zen updates** — upstream merges periodically break grouping | Zen issue #10167 "tab groups do not group tabs anymore" (post-update regression, closed) | Version-pin awareness: detect failures at runtime, degrade gracefully, log loudly, never wedge the tab strip |
| 6 | **Group state not persisted** — collapse/color states lost on restart | ATG implements `applySavedColors/Icons/CollapsedStates` itself via SessionStore-adjacent storage | Our AI never needs collapsed states; we only read labels/colors — keep our surface area minimal |
| 7 | **Split-view groups conflict** — Zen's split view also creates group-like structures | ATG explicitly skips groups with the `split-view-group` attribute | Our grouping engine must skip `split-view-group` groups and `zen-empty-tab` tabs |
| 8 | **Smart-groups engine fights mods** — Firefox's AI grouping acts on the same structures | Darsh's README: set `browser.tabs.groups.smart.enabled` = `false` | Our installer/init checks and (with user consent via pref) force-disables it |

### 3.3 The tab-DOM anatomy a sorter must know

Verified selectors and attributes from both mods' source:

- Tab elements: `tab` inside `gBrowser.tabContainer`; skip tabs with `pinned="true"`, `zen-empty-tab` attribute, disconnected tabs (`tab.isConnected === false`).
- Multi-select: `gBrowser.selectedTabs` (array) — the API for "sort only what I highlighted".
- Group elements: `tab-group` elements; `gBrowser.isTabGroup(item)`; `gBrowser.tabGroups` (filter to `tagName === "tab-group"`); group `.label`, `.id`, `.color`, `collapsed` attribute, `.tab-group-label` child.
- Workspace binding: `group.getAttribute("zen-workspace-id")` or inherit from first tab.
- Button anchor points (in preference order, with fallback): `.pinned-tabs-container-separator` (the divider between pinned and unpinned tabs — the classic "above tabs" spot) → `#tabbrowser-arrowscrollbox-periphery`.
- Command registration: `commandset#zenCommandSet` + `<command id="cmd_zenSortTabs"/>` + `<toolbarbutton command="cmd_zenSortTabs"/>` — the native XUL way to wire buttons to actions (also makes commands discoverable by other mods / command palettes).
- Re-attach triggers: hook `gZenWorkspaces.onTabBrowserInserted` and `updateTabsContainers` (call originals first, then re-inject buttons) — workspace switches rebuild the strip and destroy injected buttons.

### 3.4 The grouping engine API we will drive

Firefox's native API (proven by Darsh's working v4.x code path):

```js
// Create a group from N tabs, with label/color/insertion point
const group = gBrowser.addTabGroup(tabsArray, {
  label: "Research",
  color: "blue",            // one of the 18 named group colors
  insertBefore: firstTab    // element to insert the group before
});

// Move a single tab into an existing group element
gBrowser.moveTabToGroup(tab, existingGroupElement);

// Expand a collapsed group before moving tabs in (real Darsh quirk-handling)
if (group.getAttribute("collapsed") === "true") {
  group.setAttribute("collapsed", "false");
  group.querySelector(".tab-group-label")
       ?.setAttribute("aria-expanded", "true");
}
```

Edge cases Darsh's code taught us to handle: `addTabGroup` sometimes throws or returns a disconnected element → always verify `newGroup.isConnected`, fall back to finding the group by label + workspace; always check `tab.closest("tab-group")` before moving to skip tabs already in the target group; batch-create groups in label order to keep the strip deterministic.

---

## 4. Competitor Teardowns

### 4.1 Advanced Tab Groups (Vertex-Mods) — the foundation

- **What:** 2,263-line `.uc.js` + `userChrome.css`. Re-enables Firefox tab groups in Zen and rebuilds the entire UX: custom group editor menus (it *removes* Firefox's built-in group editor), favicon-derived group colors, emoji/SVG icon pickers, persisted collapse states, close buttons, context menus (rename, ungroup, move-to-space), Arc-style visual mode, workspace-aware visibility, Zen Library integration.
- **Architecture:** single `class AdvancedTabGroups` with a private `#initTabGroupListener`; `init()` awaits dependencies (`SessionStore`, `gZenWorkspaces`, `gZenThemePicker` — it polls until they exist), applies saved state, sets up MutationObservers, listens for custom `TabGroupCreate` events, patches `switchToWorkspace` and the Library prototype, and re-processes groups on a 1s/1.5s delayed schedule to catch stragglers.
- **Prefs it owns:** `browser.tabs.groups.enabled` (force `true`), `browser.tabs.groups.arc-style`, `browser.tabs.groups.allow-emojis`, plus legacy `tab.groups.fill-folders` / `tab.groups.theme-folders`.
- **Interoperability:** publishes `globalThis.advancedTabGroups` and `globalThis.debugAdvancedTabGroups` (with `getGroups()` returning `{id, label, collapsed, …}`).
- **Status:** very active — 385★, 400 commits, v3.6.0 shipped days before this writing; MIT licensed; lineage: Anoms12's original → Vertex-Mods continuation (Darsh's README still points at Anoms12's).
- **What we take from it:**
  1. **Hard dependency, not reimplementation.** Our mod consumes groups; ATG provides them. We detect `globalThis.advancedTabGroups` and use its debug API to enumerate groups cheaply, falling back to raw `gBrowser.tabGroups`.
  2. The dependency-wait pattern (poll for globals before init).
  3. The re-process-on-delay pattern to survive Zen's async strip rebuilds.
  4. Its `theme.json`/`preferences.json` as our packaging template.

### 4.2 Ai-TabGroups-ZenBrowser (Darsh-A) — the closest ancestor

- **What:** single 1,717-line `tab_sort_clear.uc.js`. Two buttons injected on the pinned-tabs separator: **⇅ Sort** and **↓ Clear** (closes ungrouped, non-pinned, non-active tabs with a CSS animation). Sort = two-phase: (1) manual pre-grouping via common-word frequency in titles/URLs with a configurable threshold, (2) one batched AI call for the remainder.
- **Provider layer (the thing you liked, and its limits):** exactly three hardcoded providers — Gemini (`generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=`), Ollama (`/api/generate`), Mistral — selected by a pref integer (1/2/3). Model names typed by hand as strings. API key stored in a pref or edited in-file. **No custom base URLs beyond Ollama's endpoint, no OpenAI-compatible target, no model discovery — confirming the gap our mod fills.**
- **Prompting (excellent — we adopt the bones):** a batch prompt listing numbered tabs (`Title/URL/Description`), passing in **existing group names** with an explicit instruction to reuse them *exactly* (prevents near-duplicate groups like "Project Docs" vs "Project Documentation"), output format = one category per line, count must equal input count, 1–2 words Title Case. Robust mismatch repair: single-tab correction, truncate-extra-lines, "Uncategorized" for missing lines.
- **Resilience patterns worth copying verbatim in spirit:** dynamic `maxOutputTokens`/`num_predict` estimation (`tabs × 16`), per-provider error messages that decode API error bodies (Gemini 400 invalid-key vs 403 permission vs safety-block `blockReason`/`finishReason`), the `isSorting` re-entrancy guard, workspace filtering, skip-pinned/empty/selected/disconnected tabs.
- **UI details:** buttons are real XUL `<toolbarbutton>`s wired through a `<command>` in `commandset#zenCommandSet`; while sorting, the separator gets a `separator-is-sorting` class driving a CSS animation plus a JS color-cycling interval (indicator feedback); buttons re-injected via `gZenWorkspaces` hooks; 3s minimum indicator display.
- **Status: broken & unmaintained** — README banner: *"Currently broken due to discontinuation support for tab-groups officially from the zen team and clashing with its new features… PRs welcomed."* Last real updates mid-2025; also conflicts with Zen's smart groups. **The demand it proved:** hundreds of users want exactly this workflow; its issue tracker is full of "please fix" — a ready audience for a maintained successor.
- **Why it broke (technical):** it predates the ATG rework — it targets Zen's older group behavior + Anoms12's ATG; Zen's strip restructuring (workspace-sectioned strips, new separators) plus the smart-groups clash left its selector chains and grouping calls unreliable. Lesson: **build selector-fallback chains, runtime capability detection, and an ATG-version handshake instead of assuming DOM shape.**

### 4.3 Firefox Smart Tab Groups (Mozilla, 141+) — the "how the big boys do it" reference

Mozilla's engineering blog + the open-source `mozilla/smart-tab-grouping` repo describe the pipeline: tab titles → **MiniLM sentence embeddings** (on-device, Firefox AI Runtime / Transformers.js) → **dimensionality reduction + clustering** (UMAP + HDBSCAN in the reference implementation) → group → **fine-tuned topic model** (`Mozilla/smart-tab-topic`, a T5-style encoder-decoder) generates the 1–3 word group label from member titles. Fully local, no network, model downloadable/removable (`browser.ml.chat` adjacent prefs; `browser.tabs.groups.smart.enabled` master switch).

**Takeaways for us:** (a) validate the two-stage "cluster → label" decomposition — our single LLM call fuses both, which is fine, but our *heuristic fallback* (phase 1 without AI) mirrors it; (b) evidence that **titles alone are sufficient signal** — Mozilla doesn't send URLs to a model at all; (c) local-first is the privacy gold standard — our Ollama/LM Studio defaults match it, and our privacy mode (hostname-only) sits between; (d) known ops pain: on-device models caused CPU/battery complaints — reinforces our choice of *on-demand, user-triggered* sorting (never background).

### 4.4 Chrome-ecosystem AI tab organizers (category scan)

The Chrome Web Store pattern (AI Tab Organizer & peers, plus products like aitabmanager.com): MV3 extension → `chrome.tabs.group()` + `chrome.tabGroups.update()` → send titles+URLs to a hosted LLM → rebuild groups. Commercial ones (Arc's declutter, Opera Tab Sets) are closed. Their common UX grammar, which users already know and expect:

1. One prominent action: **"Organize/Sort tabs"** button — on-demand, never silent background sorting. ✓ matches your chosen default
2. **Group-reuse awareness** (fold into existing groups when they fit).
3. A tiny settings surface: provider, model, granularity ("few large groups" ↔ "many small groups").
4. Feedback during sort (spinner on the button / strip).

None of them run in Zen (Chrome-only APIs, and Zen lacks an extension API into its strip), and none offer custom local providers — our niche is exactly the intersection: **Zen's privileged mod platform + any provider you like, local or cloud.**

---

## 5. AI Provider Landscape & Integration Design

### 5.1 The protocol reality: one spec to rule them all

The OpenAI Chat Completions protocol has become the *lingua franca* of LLM serving. Everything below speaks it, which means one adapter covers the entire field:

| Runtime / Service | Default base | List models | Chat |
|---|---|---|---|
| **Ollama** (local) | `http://localhost:11434` | native `GET /api/tags` **and** OpenAI-compat `GET /v1/models` | native `POST /api/chat` / `POST /api/generate` **and** `POST /v1/chat/completions` |
| **LM Studio** (local) | `http://localhost:1234/v1` | `GET /v1/models` | `POST /v1/chat/completions` |
| **llama.cpp server** (local) | `http://localhost:8080/v1` | `GET /v1/models` | `POST /v1/chat/completions` |
| **Jan / vLLM / TGI / text-gen-webui** (local) | `http://localhost:1337/v1` etc. | `GET /v1/models` | `POST /v1/chat/completions` |
| **OpenAI** | `https://api.openai.com/v1` | `GET /v1/models` (auth) | `POST /v1/chat/completions` |
| **OpenRouter** (400+ models) | `https://openrouter.ai/api/v1` | `GET /v1/models` (no auth needed to list) | `POST /v1/chat/completions` |
| **Groq / Together / Mistral / DeepSeek / Cerebras / Zhipu…** | `https://api.x.ai/v1`-style | `GET /v1/models` | `POST /v1/chat/completions` |
| **Google Gemini** (the outlier) | `https://generativelanguage.googleapis.com` | `GET /v1beta/models?key=` | `POST /v1beta/models/{model}:generateContent` |

Verified: Ollama's docs confirm the OpenAI-compatibility surface (`/v1/models`, `/v1/chat/completions`); LM Studio ships the same. Gemini also offers an OpenAI-compat layer, but its native endpoint is more complete — we keep a dedicated adapter.

### 5.2 The Provider abstraction (core of our mod)

```js
// Every adapter implements exactly this shape:
interface ProviderAdapter {
  // For the Fetch Models button — hits the provider's model-list endpoint.
  listModels(cfg)            → [{ id: "llama3.1:8b", label: "…", context? }]

  // One-shot categorization call.
  categorize(cfg, prompt, opts) → text | {json}
}
```

**Model-list normalization** (why the Fetch Models button "just works" everywhere):

```js
// OpenAI-compatible:  GET {base}/v1/models   → { data: [{ id }] }
// Ollama native:      GET {base}/api/tags    → { models: [{ name, details }] }
// Gemini native:      GET {base}/v1beta/models?key=K → { models: [{ name: "models/gemini-2.5-flash" }] }  → strip "models/" prefix
```

Built-in **presets** (one click in the panel, editable): Ollama, LM Studio, llama.cpp, OpenAI, OpenRouter, Groq, Together, Mistral, Gemini — plus the universal **"Custom (OpenAI-compatible)"** preset where the user supplies name + base URL + optional key. That single preset covers every present and future OpenAI-compat service, local or cloud — the "very customizable" requirement satisfied by construction.

**Networking facts we rely on (all proven by Darsh's shipped code):** `fetch()` from the privileged chrome context reaches `localhost` and cloud APIs cross-origin without a CORS proxy; JSON bodies + `Authorization: Bearer` headers work; timeouts must be self-imposed via `AbortController` (local models can think for minutes — default 120s, configurable).

### 5.3 Prompting & parsing strategy

Adopt Darsh's proven bones, harden them:

- **Input per tab:** `Title` + `hostname` + `path` (privacy mode: hostname only; Mozilla's local approach shows titles alone suffice — hostname adds a lot for little exposure).
- **Existing-group reuse:** pass current group labels of the active workspace with strict exact-name-reuse instructions.
- **Output contract — two modes:**
  - **Lines mode** (default, works on every model incl. tiny locals): one category per line, count = tab count, "1–2 words, Title Case" — cheapest tokens, easiest repair.
  - **JSON mode** (opt-in; auto-preferred when provider supports it): `[{\"i\":1,\"c\":\"Research\"}]` via `response_format: {type:\"json_object\"}` on OpenAI-compat; strict-parse with fallback to lines mode.
- **Repair ladder:** exact-count → single-line correction → truncate extras → pad "Uncategorized" (Darsh's ladder, kept).
- **Chunking:** batches of ≤ 30 tabs per call (tiny local models degrade past that); merge category names across chunks with an exact-match policy.
- **Determinism:** `temperature: 0.1` (Darsh uses the same), `max_tokens ≈ tabs × 16` floor 256.
- **Heuristic fallback (phase 0, always available):** domain + common-word clustering à la Darsh phase-1 so the mod still organizes *something* when the provider is unreachable — and doubles as the "no AI, just tidy" mode.

### 5.4 Privacy & key handling (documented honestly)

- Default preset is **Ollama on localhost** — nothing leaves the machine unless the user chooses a cloud preset. The panel will show a one-line data-flow disclosure that updates with the chosen provider ("Tabs' titles+URLs → api.openai.com").
- Privacy toggle: hostname-only payloads; another toggle to exclude pinned/incognito-origin tabs (`moz-extension://`, `about:` pages are always excluded as unuseful).
- API keys persist in `Services.prefs` (plaintext in `prefs.js` in the profile) — same as every existing Zen mod; we document it plainly, add a "clear key" button, and never log keys. (Real OS-keychain integration is impossible from mod context; being transparent beats pretending.)

---

## 6. Proposed Architecture

### 6.1 High-level data flow

```
┌───────────────────────── browser.xhtml (privileged) ─────────────────────────┐
│                                                                              │
│  [⇅ Sort button]      [⚙ panel button]        (injected into the            │
│        │                    │                  pinned-tabs separator,       │
│        ▼                    ▼                  re-attached by               │
│   SortController        SettingsPanel           workspace hooks)            │
│        │                    │                                            │
│        │  1. collect        │  reads/writes                               │
│        ▼                    ▼                                             │
│   TabCollector ──────► PrefStore (Services.prefs: mod.aitabsort.*)         │
│   (active workspace,                                  │                    │
│    skip pinned/empty/                                 │                    │
│    split/about/selected?)                              │                    │
│        │                                               │                    │
│        ▼  2. build prompt                               │                   │
│   PromptBuilder ◄── existing labels (ATG or gBrowser)   │                   │
│        │                                               │                    │
│        ▼  3. call                                       ▼                   │
│   ProviderHub ──► ProviderAdapter (ollama|lmstudio|openai-compat|gemini)   │
│        │                 listModels() → [Fetch Models ▾] in SettingsPanel   │
│        ▼  4. parse + repair                                                   │
│   ResponseParser → assignments [{tab, category}]                              │
│        │                                                                      │
│        ▼  5. execute (fallback: heuristic pass if provider failed)             │
│   GroupingEngine ─► gBrowser.moveTabToGroup / gBrowser.addTabGroup            │
│        │                    (workspace-checked, split-view-skipped)           │
│        ▼                                                                      │
│   ATG renders & persists the groups (we never touch group UI)                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Module layout (single `.uc.js`, sectioned like a small kernel)

Per your vanilla-JS choice: **one self-contained `ai-tab-sorter.uc.js`**, internally organized as ES classes in one IIFE (mirrors ATG's shape — the community-idiomatic pattern that Sine/fx-autoconfig load directly), each unit-testable by exporting through `globalThis` under a debug namespace:

| Section | Class / role |
|---|---|
| PrefStore | typed get/set + defaults + change observers over `mod.aitabsort.*` |
| ProviderRegistry | preset table + `ProviderAdapter` implementations + `listModels()` normalization + `AbortController` timeouts |
| PromptBuilder | lines/JSON modes, existing-group injection, chunking, privacy filter |
| ResponseParser | parse + repair ladder + title-casing normalization |
| HeuristicSorter | offline fallback (domain/word-frequency clustering) |
| TabCollector | workspace-aware tab snapshot + exclusion rules + multi-select support |
| GroupingEngine | diff plan (reuse vs create), drives `gBrowser.*`, post-verify (`isConnected`) |
| SortController | orchestrates 1–5, `isSorting` re-entrancy guard, button spinner states, error toasts |
| SettingsPanel | native-looking popup (XUL `<panel>` + HTML content) with provider picker, base URL, key, **[Fetch Models]**, model `<menulist>`, granularity slider, privacy toggles |
| ButtonInjector | XUL buttons + command registration + fallback selector chain + re-attach observers |
| Bootstrap | dependency-wait (ATG optional-check, gZenWorkspaces poll), init sequencing |

Cross-cutting: a tiny `log()` gated by a debug pref (`[AITabSorter]` prefix, like ATG), and a capability probe that checks `typeof gBrowser.addTabGroup === "function"` at init — if groups are unavailable, the button shows an explanatory popup pointing to the ATG install page instead of silently failing.

---

## 7. UI / UX Specification

**Style: Native Zen (Photon) look** — the panel and buttons use Firefox/Zen's own design tokens so they read as part of the browser, not a foreign app.

### 7.1 The Sort button (on-demand trigger)

- Location: injected into **`.pinned-tabs-container-separator`** (the thin divider above the unpinned tabs — exactly where Darsh's users expect it), fallback `#tabbrowser-arrowscrollbox-periphery`, re-attached via `gZenWorkspaces` hooks + MutationObserver.
- Rendering: real XUL `<toolbarbutton>` wired through `commandset#zenCommandSet` (`cmd_aiTabSort`), styled with native vars — `--lwt-toolbarbutton-*` backgrounds/hover, `--toolbarbutton-icon-fill` for the glyph, standard `toolbarbutton-1` class so hover/active states match Zen's own buttons. Icon: a clean sort/layers glyph via `list-style-image` + `mask-image` (crisp on light/dark; no emoji).
- States: **idle → sorting** (icon spins via CSS `animation`, tooltip "Sorting N tabs…", button disabled) **→ done ✓ (1.2s) / error ⚠ (tooltip shows message, click to open panel diagnostics)**. Sorting indicator also tints the separator (subtle accent, 1s min display) — Darsh's pattern, toned down.
- **Multi-select aware:** if `gBrowser.selectedTabs.length > 1`, sorts only the selection (tooltip updates to say so). This is the fine-grained control users praised in Darsh.
- Secondary **⚙ gear button** (same injection point) opens the settings panel. Right-click on sort button = quick menu (Sort all / Sort selected / Open settings).
- A `--hidden` pref can hide the buttons entirely for command-palette-only users (v0.3+: register commands into Vertex's Zen-Command-Palette if present).

### 7.2 The settings panel

- Implementation: XUL `<panel type=\"arrow\">` anchored to the gear button — the same popup chrome Zen's own UI uses (`panelui` styles, `-moz-appearance` surfaces, Photon spacing, `--zen-primary-color` accents, system font stack via `font: message-box`). Content is HTML inside the panel for easier layout.
- Layout (single column, grouped sections, ~360px wide):

```
┌ AI Tab Sorter ──────────────────────────┐
│ Provider   [ Ollama ▾ ]                 │  ← preset menulist
│ Base URL   [ http://localhost:11434 ]   │  ← auto-filled per preset, editable
│ API Key    [ •••••••• ]        (cloud)  │  ← password field, hidden for local
│                                           │
│ [ ⟳ Fetch Models ]   [ llama3.1:8b ▾ ]  │  ← THE feature pair: button queries
│                                           │     the /models endpoint, dropdown
│                                           │     lists results; status line below
│                                           │     ("12 models · 214ms")
│ ── Behavior ─────────────────────────── │
│ Granularity      [ Balanced ────●── ]   │  ← few-large ↔ many-small groups
│ Output mode      [ Simple lines ▾ ]     │  ← lines / JSON (auto-disabled per
│                                           │     provider capability)
│ Min group size   [ 2 ] stepper           │
│ ✓ Reuse existing groups                  │
│ ✓ Heuristic fallback when offline        │
│ ── Privacy ──────────────────────────── │
│ Payload          [ Title + URL ▾ ]      │  ← / hostname only / title only
│ ⓘ Data flow: titles+URLs → localhost    │  ← live disclosure line
│ ── Advanced ─────────────────────────── │
│ Custom prompt… (textarea, collapsible)  │
│ Timeout [120]s   Debug logging ☐        │
└──────────────────────────────────────────┘
```

- The **Fetch Models** flow: click → spinner → `listModels()` with the current base URL/key → populate dropdown (id + friendly label), select persists to pref; error state shows the provider's actual message inline ("ECONNREFUSED — is Ollama running?"). This is your must-have feature, given top billing.
- Panel edits write straight to `PrefStore` (so the Sine preferences page and the panel always agree — same prefs underneath).

---

## 8. Settings Schema

All under `mod.aitabsort.*` (Sine-visible via `preferences.json`; the panel writes the same keys):

| Pref | Type | Default | Surface |
|---|---|---|---|
| `enabled` | bool | `true` | both |
| `provider` | string | `"ollama"` | both (dropdown: ollama / lmstudio / llamacpp / openai / openrouter / groq / together / mistral / gemini / custom) |
| `baseURL` | string | `http://localhost:11434` | both (string) |
| `apiKey` | string | `""` | both (string; panel masks) |
| `model` | string | `""` | both (string; panel = dropdown after Fetch) |
| `granularity` | int 1–5 | `3` | panel only |
| `outputMode` | string | `"lines"` | panel only (lines/json/auto) |
| `reuseGroups` | bool | `true` | both |
| `minGroupSize` | int | `2` | panel only |
| `heuristicFallback` | bool | `true` | both |
| `payloadMode` | string | `"title-url"` | both (dropdown) |
| `customPrompt` | string | `""` | panel only |
| `timeoutSec` | int | `120` | panel only |
| `showButtons` | bool | `true` | both |
| `debugLogging` | bool | `false` | both |

`preferences.json` ships with a friendly subset (the "both" rows) so plain-Sine users are fully functional without ever opening our panel; the panel adds the long tail. `browser.tabs.groups.smart.enabled` is *checked* at init (warn + offer to disable) but never silently forced — good citizenship, and it goes in the README instead.

---

## 9. Tech Stack & Engineering Practices

**Core decision (per your choice): Vanilla JS, zero build step.** The file that runs in the browser *is* the file in the repo — no dist folder, no bundler risk, community PRs review the real code. This is also the dominant idiom of the Zen mod community (ATG, Darsh, most Sine mods), lowering the contribution barrier.

What "industry grade" adds around that core:

| Concern | Tool / practice |
|---|---|
| **Linting** | ESLint (flat config) with `globals` declared explicitly (`gBrowser`, `Services`, `MozXULElement`, `gZenWorkspaces`…), `no-unused-vars`, `no-undef` strict — catches the classic mod bug class (typos in privileged globals) before users do |
| **Manifest CI** | `scripts/validate-manifests.mjs` (Node, no deps): validates `theme.json` against the documented schema (required fields, `include` targets, version semver, URLs resolve to this repo's raw paths) and `preferences.json` against the official field spec (types, option value charset, defaults present) — fails CI on drift |
| **Unit-testable core** | `PromptBuilder`, `ResponseParser`, `HeuristicSorter`, provider normalization are pure functions exported via `globalThis.__aiTabSorterTest__` *and* a CommonJS guard, so Node can `require()` and test them with a dependency-free harness (`node --test`) — no jsdom needed since these units touch no DOM |
| **CI (GitHub Actions)** | on push/PR: `npm run lint` + `manifest check` + unit tests; on tag: zip release artifact (for manual fx-autoconfig users) with the version stamped |
| **Docs** | README (install via Sine + manual, provider setup table, troubleshooting matrix), `docs/PROVIDERS.md` (endpoint reference + per-provider gotchas: LM Studio CORS toggle, Ollama `OLLAMA_ORIGINS`, Gemini free-tier rate limits), `CONTRIBUTING.md` (Zen-version testing matrix: stable/beta/alpha), `CHANGELOG.md` (Keep-a-Changelog) |
| **Versioning** | Semver; `theme.json.version` single source of truth; validator enforces sync with git tag |
| **Releases** | GitHub Releases with screenshots/GIF; Sine users get updates automatically from `main` — no action needed |

**Deliberately rejected:** TypeScript+Vite bundling (you chose vanilla; also splits community PR surface from shipped artifact), Playwright E2E against a real Zen instance (Zen alpha DOM churn makes recorded selectors a maintenance treadmill disproportionate to a v0.x mod; the manual test matrix + pure-unit coverage is the pragmatic 80/20 for this ecosystem — revisit at v1.0).

---

## 10. Feature Comparison Matrix

| Capability | **AI Tab Sorter (ours)** | Darsh AI TabGroups | Advanced Tab Groups | Firefox Smart Groups | Chrome AI organizers |
|---|---|---|---|---|---|
| Runs in Zen | ✅ | ⚠️ broken by Zen updates | ✅ | ❌ (Zen hides it) | ❌ |
| Group engine | ATG / native | native (pre-rework) | native, re-enabled | native | chrome.tabGroups |
| **Custom providers (any OpenAI-compat)** | ✅ presets + custom base URL | ❌ 3 hardcoded | n/a | n/a | ❌ fixed vendor |
| **Fetch models button** | ✅ `/v1/models` · `/api/tags` · `/v1beta/models` | ❌ type model by hand | n/a | n/a | ❌ |
| **Model selector dropdown** | ✅ live-populated | ❌ | n/a | n/a | rare |
| Local runtimes (Ollama/LM Studio/llama.cpp) | ✅ all | ⚠️ Ollama only | n/a | ✅ hidden on-device | ❌ |
| Cloud (OpenAI/OpenRouter/Groq/Mistral/Gemini/Together) | ✅ | ⚠️ Gemini+Mistral | n/a | ❌ | ✅ vendor-locked |
| On-demand sort button above tabs | ✅ | ✅ | n/a | manual menu | ✅ |
| Sort only selected tabs | ✅ | ✅ | n/a | n/a | some |
| Reuse existing groups | ✅ | ✅ | n/a | n/a | some |
| Offline heuristic fallback | ✅ | ✅ (phase 1) | n/a | n/a | ❌ |
| Privacy modes (hostname-only) | ✅ | ❌ full URL sent | n/a | ✅ fully local | ❌ |
| Settings UI | native panel + Sine prefs | edit config in file / Sine basics | Sine prefs | about:config | extension page |
| Workspace-aware | ✅ | ✅ | ✅ | ✅ | n/a |
| Maintained (2026) | 🆕 this project | ❌ archived-broken | ✅ very active | ✅ | ✅ |
| License | MIT | — | MIT | MPL-2.0 | proprietary |

---

## 11. Risks, Limits & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Zen DOM churn breaks button injection** (it broke Darsh) | High — every Zen release | Medium | Fallback selector chains; MutationObserver re-attach; workspace hooks; if all anchors fail → fall back to a toolbar button in the navbar; log + surface visible diagnostics |
| **Upstream group engine regresses again** (issue #10167 precedent) | Medium | High | Capability probe at init; runtime verify after every `addTabGroup`; never leave tabs half-moved (all-or-per-category commit); pin support matrix in README per Zen channel |
| **ATG breaking changes** (it evolves fast) | Medium | Medium | Prefer public `gBrowser` APIs over ATG internals; use `globalThis.advancedTabGroups` only as *optional* fast-path (enumerate groups); declare tested-against ATG version range; graceful degradation to raw native groups |
| **Cloud provider API/rate limits** (Gemini free-tier 429s, etc.) | High (free tiers) | Low | Retry-with-backoff once, clear per-provider error strings (Darsh's 400/403/blockReason decoding), chunked requests stay small, suggest local fallback in the error toast |
| **Local runtime not running / wrong port** | High (first-run) | Low | Fetch Models & sort check connectivity first; ECONNREFUSED message with the exact URL tried + per-runtime hint (Ollama serve / LM Studio server toggle) |
| **API keys in plaintext prefs** | Certain (platform limit) | Medium | Document plainly; mask in UI; "Clear key" button; never log; recommend low-scope keys; local-first defaults |
| **Privacy: URLs to cloud** | User-dependent | Medium | Default = local provider; payload-mode selector; live data-flow disclosure line in panel; README section |
| **Model output garbage / mismatched counts** | Medium (small locals) | Medium | Repair ladder + JSON mode + min-group-size threshold + heuristic fallback; per-chunk sanity checks |
| **Tab loss during sorting** (worst-case user harm) | Low | Critical | Never `removeTab` in the sort path at all (Clear-type actions are explicitly out of scope for v0.x); moves are reversible (Ctrl+Shift+Z group-aware); all operations idempotent per category |
| **Mod conflict** (other tab mods, smart groups) | Medium | Medium | Init-time detection of `browser.tabs.groups.smart.enabled` → warn + offer disable; skip `split-view-group`; publish known-conflicts list |
| **Single-maintainer bus factor** | Medium | Medium | Tiny dependency-free codebase; `globalThis` debug namespace for community triage; CONTRIBUTING test matrix; Apache-2.0 + welcoming issue templates |

---

## 12. Roadmap v0.1 → v1.0

**v0.1 — MVP (the proof)** · *Target: 1–2 weeks of evenings*
- ButtonInjector (separator + fallback chain + hooks), SortController with re-entrancy guard
- TabCollector (workspace filter, exclusions, multi-select), GroupingEngine (reuse-or-create, post-verify)
- ProviderHub with **Ollama + Custom-OpenAI-compat + Gemini** adapters; lines-mode prompt + repair ladder
- Minimal panel: preset, base URL, key, **Fetch Models + model dropdown** (the must-haves)
- `theme.json` + `preferences.json` + README + LICENSE + CI (lint + manifest validate)
- ✅ *Acceptance:* sorts 30 mixed tabs on Ollama and on an OpenAI-compat cloud key; groups survive restart; re-sort merges into existing groups; button survives a workspace switch.

**v0.2 — Resilience & polish**
- Heuristic fallback + offline mode; JSON output mode (auto where supported); chunking for >30 tabs
- LM Studio + llama.cpp + OpenRouter/Groq presets; timeout controls; per-provider error decoding
- Full panel (granularity, payload modes, custom prompt); error toasts + diagnostics view
- ✅ *Acceptance:* provider unplugged mid-run → heuristic completes with zero user-visible errors; 100-tab stress test passes.

**v0.3 — Integration**
- Zen-Command-Palette commands (if present); keyboard shortcut pref; right-click quick menu
- Group color strategy options (match ATG favicon-color when available)
- Session cache (don't re-ask about unchanged tabs); i18n scaffold (fluent strings)
- ✅ *Acceptance:* command-palette entry sorts from keyboard; repeat sort of unchanged tab set makes 0 API calls.

**v1.0 — Publication**
- Zen Mods Registry submission (name/desc/screenshot per guidelines); Sine marketplace listing
- docs polish (PROVIDERS.md matrix, GIF demos, troubleshooting); community triage kit (debug namespace + `about:zen-aisort` style diagnostics dump)
- Test matrix sign-off across Zen stable/beta/alpha + ATG current
- ✅ *Acceptance:* listed on Zen store + Sine; 2 weeks no critical issues; external contributor PR merged.

*Explicitly out of scope for v1.x:* background/auto-categorization (your call: on-demand only), closing/discarding tabs, bookmark management, model downloads.

---

## 13. Publishing & Distribution Guide

1. **Repo hygiene first:** README with GIF, Apache-2.0 `LICENSE`, `CONTRIBUTING.md` (incl. Zen-version test matrix), issue templates (bug = Zen version + ATG version + provider + console excerpt), semantic PR titles, `main` = always-installable (Sine pulls it directly — never break `main`).
2. **Sine:** nothing to submit — a valid `theme.json` at repo root with `preferences` pointing at the raw `preferences.json` URL makes it installable by repo name instantly, and updates flow automatically. Optionally request listing on the marketplace site via their issue template.
3. **Zen Mods Registry:** create a submission issue → bot generates PR → merged if guidelines met: **name < 25 chars** ("AI Tab Sorter" ✓), **description < 100 chars** (proposed: *"Sort tabs into smart groups with any AI — local Ollama/LM Studio or cloud providers."* = 88 ✓), 600×400 PNG screenshot, valid README, preferences as JSON. After listing, the bot tracks your repo for updates.
4. **Community:** post to r/zen_browser (Darsh's audience is literally asking for a maintained successor in its issue tracker — link it), Zen Discord `#mods` channel, and ATG's discussions (cross-compatibility goodwill; Vertex-Mods also maintains Zen-Command-Palette — future integration partner).
5. **Version cadence:** patch fixes within 48h of Zen-channel breakage reports when possible — this single behavior is what separates thriving Zen mods (ATG) from dead ones (Darsh).

---

## Appendix A — API Cheat Sheet

```js
// ── Groups (privileged) ─────────────────────────────────────────
gBrowser.addTabGroup(tabs[], { label, color, insertBefore }) → groupEl
gBrowser.moveTabToGroup(tab, groupEl)
gBrowser.removeTabGroup(groupEl)
gBrowser.tabGroups                 // all group elements (filter tagName === "tab-group")
gBrowser.isTabGroup(node) / gBrowser.isTab(tab)
group.label / group.id / group.color / group.hasAttribute("collapsed")

// ── Tabs ────────────────────────────────────────────────────────
gBrowser.tabs / gBrowser.selectedTabs
tab.pinned / tab.isConnected / tab.linkedBrowser.currentURI.spec
tab.getAttribute("zen-workspace-id") / tab.hasAttribute("zen-empty-tab")
gBrowser.removeTab(tab, { animate, skipSessionStore, closeWindowWithLastTab })

// ── Zen ─────────────────────────────────────────────────────────
gZenWorkspaces.activeWorkspace / .activeWorkspaceStrip / .getWorkspaces()
gZenWorkspaces.switchToWorkspace(...)          // ATG wraps this; we piggyback
window.ZenLibrarySpaces                        // Library sidebar class (ATG patches)
Services.prefs.{get|set}{String,Bool,Int}Pref(name[, def])
window.MozXULElement.parseXULToFragment(xulString)

// ── Providers (fetch from chrome context — no CORS issues) ─────
// OpenAI-compat: GET {base}/v1/models → {data:[{id}]};  POST {base}/v1/chat/completions
//                {model, messages, temperature, max_tokens, response_format?}
// Ollama native: GET {base}/api/tags → {models:[{name}]};
//                POST {base}/api/chat {model, messages, stream:false, options:{temperature,num_predict}}
// Gemini:        GET {base}/v1beta/models?key=K → {models:[{name:"models/…"}]}
//                POST {base}/v1beta/models/{m}:generateContent?key=K
//                {contents:[{parts:[{text}]}], generationConfig:{maxOutputTokens}}
```

## Appendix B — DOM Selector Cheat Sheet

```
#zenCommandSet                                   commandset for <command> registration
.pinned-tabs-container-separator                 primary button anchor (divider above unpinned tabs)
#tabbrowser-arrowscrollbox-periphery             fallback anchor
[zen-workspace-tabs-sectionide-separator]        alt separator variant (Darsh fallback)
tab-group / .tab-group-label                     group elements
zen-folder                                       Zen tab folders (leave alone)
tab[zen-empty-tab], [split-view-group]           always skip
#zen-workspaces-button                           workspace pill (ATG visibility observer anchor)
```

## Appendix C — References

- Zen Mods Registry docs — marketplace, preferences spec, submission guidelines: `docs.zen-browser.app/themes-store/*`
- Sine (mod manager): `github.com/CosmoCreeper/Sine` · fx-autoconfig: `github.com/MrOtherGuy/fx-autoconfig`
- Advanced Tab Groups (dependency): `github.com/Vertex-Mods/Advanced-Tab-Groups` (v3.6.0 source audited for this report)
- Darsh AI TabGroups (predecessor, broken): `github.com/Darsh-A/Ai-TabGroups-ZenBrowser` (v4.11.0 source audited)
- Mozilla smart tab grouping: `blog.mozilla.org/en/firefox/ai-tab-groups` · `github.com/mozilla/smart-tab-grouping` · `huggingface.co/Mozilla/smart-tab-topic`
- Zen tab-group history: issue #10167 regression; "not planned" native groups; r/zen_browser threads (Tab group is dead; tab groups finally here?)
- Ollama OpenAI compatibility: `docs.ollama.com/api/openai-compatibility` · LM Studio local server docs
- Zen workspaces user docs: `docs.zen-browser.app/user-manual/workspaces`
