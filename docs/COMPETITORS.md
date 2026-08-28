# Deep Dive — Every Zen Browser AI Tab-Sorter / Grouper Mod, and How It Works

> Source-level analysis of all AI tab-grouping mods discoverable for Zen Browser (GitHub search: `zen tab group`, `zen browser ai tab`, `topic:zen-mods`, `zen tidy tabs`, `zen tab sorter/organizer`, plus the Zen Mods / Sine ecosystem). Every claim below was verified by reading the mod's actual source, not its README. Last audited: 2026-08-29.

---

## 0. The Landscape at a Glance

| # | Mod | ★ | Providers | Trigger | Group engine | Status |
|---|-----|---|-----------|---------|--------------|--------|
| 1 | [Darsh-A/Ai-TabGroups-ZenBrowser](https://github.com/Darsh-A/Ai-TabGroups-ZenBrowser) | 161 | Gemini / Ollama / Mistral (hardcoded) | Sort+Clear buttons in separator | `gBrowser.addTabGroup` | **Dead** (author-confirmed) |
| 2 | [PCOffline/zen-tidy-tabs](https://github.com/PCOffline/zen-tidy-tabs) | 0 | OpenRouter only | Tidy button + modal settings | `tab-group` DOM | Active |
| 3 | [KarlRombauts/zen-ai-tab-sort](https://github.com/KarlRombauts/zen-ai-tab-sort) | 0 | Gemini / Claude / OpenAI (+Ollama) | Button + **zenCommandSet command** | `gBrowser.addTabGroup` | Active |
| 4 | [alexiscrocilla/Zen-Tabs-Organiser](https://github.com/alexiscrocilla/Zen-Tabs-Organiser) | 0 | OpenAI / Gemini / Ollama / Mistral / **Firefox built-in ML** | Button | `gBrowser.addTabGroup` | Active |
| 5 | [Merchant-Of-Life/Cat-Organizer](https://github.com/Merchant-Of-Life/Cat-Organizer) | 1 | Gemini / Ollama / custom (ES-module providers) | Button + navbar button | **3-strategy fallback** | Active |
| 6 | [pranavchavda/espressobot-zen-tab-organizer](https://github.com/pranavchavda/espressobot-zen-tab-organizer) | 1 | OpenRouter only | Navbar toolbar button | `gBrowser.addTabGroup` | Active |
| 7 | [thiago-zampronio/zen-spacekeeper](https://github.com/thiago-zampronio/zen-spacekeeper) | 1 | none (rules) | **Automatic** as you browse | `gBrowser.addTabGroup` | Active |
| 8 | yaasin-raki2/zen-tab-group-mod | 0 | none (manual UI) | — | "Dia-style" groups | Active |
| 9 | onecircle-publish/zen-browser-mod-ai-tabs | 0 | ? | ? | ? | Empty/inaccessible repo |

**Takeaway:** the field is crowded with 0–1★ single-maintainer mods, one dead 161★ mod with a hungry audience, and zero mods that combine multi-provider support with model discovery. No mod in this list has a Fetch Models button or a model dropdown.

---

## 1. Darsh-A/Ai-TabGroups-ZenBrowser — the 161★ one (dead)

The mod this project was asked to study (`tab_sort_clear.uc.js`, 1,717 lines + `clear.uc.js`, 222 lines).

**How it works:**
- **Injection:** Sort + Clear buttons appended to *every* `.pinned-tabs-container-separator`, falling back to `#tabbrowser-arrowscrollbox-periphery`. Also wires a `<command id="cmd_zenSortTabs"/>` into `commandset#zenCommandSet` and listens for its `command` events.
- **Tab collection:** `gBrowser.selectedTabs` (multi-select aware) else all non-pinned tabs; skips internal URIs.
- **Tab enrichment (unique!):** beyond title+URL+hostname it scrapes the live page's `<meta name="description">` via `browser.contentDocument` (200-char cap), and for junk titles ("New Tab", raw URL strings) substitutes the hostname or first path segment.
- **AI layer:** exactly 3 providers — Gemini 2.0 flash (default), Ollama (`/api/generate`), Mistral — selected by pref `extensions.tabgroups.ai_model` = `'1'|'2'|'3'`. Manual install requires **editing a CONFIG object in the source**.
- **Grouping:** parses topic lines from the response, reuses groups by exact `.tab-group-label` text match (`gBrowser.moveTabToGroup`), else `gBrowser.addTabGroup(tabs, {label, color})`, with post-checks that the returned element `isConnected`.
- **The Clear script calls `gBrowser.removeTab()`** — closes tabs, the exact failure class our mod refuses to implement.

**Why it died (author's own README):** "Currently broken due to discontinuation of support for tab-groups officially from the zen team and clashing with its new features." Concretely: its primary anchor `.pinned-tabs-container-separator` vanished from Zen's DOM, Zen's native group changes moved the API, and `browser.tabs.groups.smart.enabled` conflicts were never auto-detected. 161★ of users with nowhere to go.

---

## 2. PCOffline/zen-tidy-tabs — the prompt-engineering benchmark (1,822 lines)

OpenRouter-only, but the most sophisticated **request engineering** in the field:

- **Prompt is Arc's "Tidy Tabs" doctrine, written out:** group by what the user is *doing* (a project/task), not by website — "a wiki page, a YouTube video, and a store page about the same game are one group"; name an **expandable category** ("Wynncraft" over "Gaming", "Chicken Recipes" over "Grandma's Chicken Soup"); the current `group` of a tab is "a strong hint, not a command"; group count is clamped between `min/maxGroups` derived from tab count ÷ `targetTabsPerGroup`.
- **Schema enforcement ladder:** tries `response_format: json_schema` (strict) → `json_object` → none, catching HTTP 400s that match `/response_format|json schema/i` and retrying with the weaker format. This is how you get reliable JSON out of arbitrary OpenRouter models.
- **Token budgeting:** `max_tokens = max(ceiling, tabCount × tokensPerTab + buffer)` — never truncates on big sessions.
- **Determinism:** fixed `seed` + low temperature, "cheap models produce consistent, clean JSON".
- **Timeout:** `AbortController` so a hung request "can never lock the Tidy button indefinitely".
- **DOM: the modern, resilient pattern** — resolves the active workspace as `doc.querySelector("zen-workspace[active]")` → `gBrowser.selectedTab.closest("zen-workspace")` → first `zen-workspace`; the tabs section as `.zen-workspace-tabs-section` with the same closest()-first chain. This is why it still works while Darsh doesn't.
- **Settings live in an HTML modal** (password input for the key, segmented controls), not Sine prefs.

---

## 3. KarlRombauts/zen-ai-tab-sort — the performance tuner (1,918 lines)

- **Providers:** Gemini / Claude (Anthropic `/v1/messages`) / OpenAI, each with pref-driven key+model.
- **Killer trick — Gemini latency:** disables "thinking" on flash-tier models: "~11s → ~1.4s with equal or better grouping", and guards against Pro models that 400 when you try. Single most valuable provider-specific optimization found in this audit.
- **Command integration:** registers `cmd_zenSortTabs` in `commandset#zenCommandSet` — this is Zen's native command system, meaning the sort can be bound to **keyboard shortcuts / command palette**, not just the button. On command it resolves `gZenWorkspaces.activeWorkspaceElement`, picks the separator *without* `.has-no-sortable-tabs`, and plays a "brushing" animation on the button.
- **Workspace-scoped reuse:** finds reusable groups via `tab-group:has(tab[zen-workspace-id="X"])` — groups are matched only inside the current workspace.

---

## 4. alexiscrocilla/Zen-Tabs-Organiser — the local-ML unicorn (1,925 lines)

The only mod offering a **zero-key, zero-network, on-device** AI option, and the most interesting idea in the entire audit:

- **Uses Firefox's own built-in ML engine** — `ChromeUtils.importESModule("chrome://global/content/ml/EngineProcess.sys.mjs")` → `createEngine()` with:
  - `Mozilla/smart-tab-embedding` (feature-extraction) — the *same model* Firefox's Smart Tab Grouping uses;
  - `Mozilla/smart-tab-topic` (text2text-generation) for naming clusters.
  Models download once from HuggingFace (120s first-run budget); the mod flips `browser.ml.enable` on only when the local provider is actually chosen.
- **Clustering pipeline:** embed every tab title (mean pooling + normalize) → agglomerate by **cosine similarity ≥ 0.45** → reuse an existing group when its name's similarity to the cluster centroid ≥ 0.55 (+0.1 reuse boost) → name the cluster with the topic model (`max_new_tokens: 8`, temp 0.7) fed with deduped keywords from the titles.
- **Cloud providers:** OpenAI (`gpt-4o-mini` default), Gemini (`:generateContent?key=`), Ollama (`num_predict: tabs × 15`, temp 0.1), Mistral — with an "Arc Tidy Tabs style" prompt template.
- **No-provider fallback:** domain clustering, zero network.

---

## 5. Merchant-Of-Life/Cat-Organizer — the architecture showcase (ES modules)

- **Clean multi-file layout:** `ai.mjs`, `groups.mjs`, `tabs.mjs`, `rules.mjs`, `notify.mjs`, `providers/{base,gemini,ollama,custom}.mjs`, a `browser-hooks.mjs`, and an `unload.mjs` that (rare!) tears everything down cleanly.
- **Group creation strategy pattern** — detect once at startup, then use:
  1. `gBrowser.addTabGroup()` (native, preferred),
  2. direct DOM creation of the `<tab-group>` custom element,
  3. **synthetic click on the hidden context-menu item** `context_addTabGroup` (documented as "most fragile").
  Three layers of defense against Zen/Firefox API churn — the direct answer to how a group mod survives browser updates.
- **AI-assigned colors:** the model returns a color name; the mod maps it to `addTabGroup` color values.
- **Completion notifications** via the system notification service.

---

## 6. espressobot-zen-tab-organizer — the guard-checker (1,337 lines)

- OpenRouter only; navbar toolbar button built with an `h()` hyperscript helper (HTML-in-JS, onboarding steps inline: "1. Get a key from openrouter.ai").
- **Explicitly capability-checks the group engine:** warns `"gBrowser.addTabGroup not available — is browser.tabs.groups.enabled set?"` instead of failing silently — the exact UX our v0.1.0 lacked (and v0.1.1 now logs).
- AI returns group **colors**, mapped onto `addTabGroup` values.

---

## 7. zen-spacekeeper — the anti-pattern control group

Non-AI, automatic grouping **as you browse** (rules by site domain, scoped to Spaces). Included as the contrast case: it's the always-on model this project explicitly rejects — on-demand is not just a preference, it's what keeps sorting predictable, private, and debuggable.

---

## 8. Cross-Cutting Patterns (what the survivors converge on)

1. **Group engine:** everyone uses `gBrowser.addTabGroup()` + `moveTabToGroup()`; the strongest mods (Cat) wrap it in fallback strategies. None manage groups purely through ATG's own API — ATG *is* the native engine re-enabled.
2. **DOM resolution:** the alive mods resolve workspace context via `zen-workspace[active]` / `closest()` chains / `gZenWorkspaces.activeWorkspaceElement`; the dead mod cached a class selector (`.pinned-tabs-container-separator`) as its primary anchor. **Lesson: never love a selector — always resolve fresh, prefer `closest()` from a live tab.**
3. **`commandset#zenCommandSet` is Zen's official extension point** for commands (Darsh and Karl both register `cmd_zenSortTabs`) — free keyboard-shortcut and palette integration.
4. **JSON reliability is a ladder:** json_schema → json_object → raw text, with 400-detection and retry (Tidy). Everyone else just hopes.
5. **Token budgets scale with tab count** (Tidy's `tokensPerTab`, Organiser's `num_predict = tabs × 15`) — fixed `max_tokens` truncates on big sessions.
6. **Colors are cheap delight:** two mods let the model pick group colors and map them to native values.
7. **Signal enrichment tradeoff:** Darsh's `<meta name="description">` scrape gives better clusters but costs cross-origin permission dances; everyone else uses title+URL only.
8. **Determinism knobs matter:** fixed seed + temp ≈ 0.1 (Tidy, Organiser, Karl) because "creative" grouping feels broken to users.
9. **Timeouts are non-negotiable:** AbortController around every fetch; a locked sort button reads as data loss to users.
10. **The graveyard is the market:** the only mod with an audience is dead, and its issue tracker is full of people asking for a successor.

---

## 9. Where ai-tab-sorter Stands Against All of This

**Already unique (no competitor has it):**
- Fetch Models button + model dropdown (live `/models` discovery across 3 API dialects)
- 10 provider presets incl. LM Studio / llama.cpp / Groq / Together, plus any custom OpenAI-compatible base URL
- Privacy payload modes (title+URL / title+host / title-only) with live data-flow disclosure
- Response-repair ladder + offline heuristic fallback + 31 unit tests + CI

**Steal-list for v0.2 (ranked by value ÷ effort):**
1. Register `cmd_zenSortTabs` in `commandset#zenCommandSet` → keyboard shortcut / palette support (Karl, Darsh)
2. Gemini: disable "thinking" on flash models → ~8× latency (Karl)
3. `response_format` json_schema → json_object → none ladder for OpenAI-compat providers (Tidy)
4. Scale `max_tokens` with tab count (Tidy/Organiser)
5. AI-chosen group colors mapped to native palette (espresso, Cat)
6. **"Firefox Local (no key)" provider preset** using the built-in `Mozilla/smart-tab-embedding` + `smart-tab-topic` engine (Organiser) — zero-config private AI, a genuinely differentiated feature
7. Fuzzy existing-group reuse (embedding similarity ≥ 0.55, Organiser) instead of exact-name match
8. Optional "rich signal" payload mode scraping `<meta name="description">` (Darsh)
