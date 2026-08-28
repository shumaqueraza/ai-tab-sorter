# AI Tab Sorter for Zen Browser

**Sort your tabs into smart groups with any AI — local or cloud — with one click.**

[![CI](https://github.com/shumaqueraza/ai-tab-sorter/actions/workflows/ci.yml/badge.svg)](../../actions)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Zen Mod](https://img.shields.io/badge/Zen-Browser%20Mod-7c3aed)](https://zen-browser.app/)
[![Sine](https://img.shields.io/badge/Sine-compatible-0ea5e9)](https://github.com/CosmoCreeper/Sine)

A [Zen Browser](https://zen-browser.app) mod (works with the [Sine](https://github.com/CosmoCreeper/Sine) mod manager) that adds a **⇅ Sort button above your tabs**. Click it and your open tabs are categorized by an LLM and organized into tab groups — **strictly on demand**, never in the background.

## ✨ Features

- **🖱️ One-click sorting** — a native-looking Sort button in the tab strip. Multi-select tabs to sort only your selection.
- **🔌 Any provider, fully customizable** — local first, cloud when you want it:
  - **Local:** Ollama, LM Studio, llama.cpp server (and any OpenAI-compatible local server)
  - **Cloud:** OpenAI, OpenRouter, Groq, Together, Mistral, Google Gemini
  - **Custom:** any base URL speaking the OpenAI-compatible protocol
- **⟳ Fetch Models button** — live-queries your provider's model-list endpoint (`/v1/models`, Ollama `/api/tags`, Gemini `/v1beta/models`) so you never type model names by hand.
- **▾ Model selector dropdown** — pick from the fetched list; your choice is remembered.
- **♻️ Group reuse** — the AI is told about your existing groups and reuses their exact names instead of spawning near-duplicates.
- **🛟 Offline fallback** — optional no-AI heuristic grouping (domain + keyword clustering) when the provider is unreachable.
- **🔒 Privacy modes** — send title+URL, title+hostname, or title only. Defaults to a local runtime; the panel always shows exactly where data would go.
- **🧩 Built on [Advanced Tab Groups](https://github.com/Vertex-Mods/Advanced-Tab-Groups)** — the best tab-groups experience for Zen provides the group UI; this mod provides the brain.

## 📦 Requirements

| Dependency | Why |
|---|---|
| [Advanced Tab Groups](https://github.com/Vertex-Mods/Advanced-Tab-Groups) | Provides the tab-groups UI & engine in Zen |
| [Sine](https://github.com/CosmoCreeper/Sine) *(recommended)* or fx-autoconfig | Loads the mod |
| An AI provider — e.g. free local [Ollama](https://ollama.com) | Does the categorization |

> ⚠️ Set `browser.tabs.groups.smart.enabled` = `false` in `about:config` — Zen's built-in smart grouping conflicts with mods that manage groups.

## 🚀 Install

> **Full step-by-step (with screenshots-worthy detail): [TESTING.md](TESTING.md)**

### Via Sine (recommended)
1. Install [Sine](https://github.com/CosmoCreeper/Sine) and [Advanced Tab Groups](https://github.com/Vertex-Mods/Advanced-Tab-Groups).
2. In Zen: Settings → Sine → add this repository: `shumaqueraza/ai-tab-sorter`.
3. Updates arrive automatically from `main`.

### Manual (fx-autoconfig)
1. Install [fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig).
2. Copy `ai-tab-sorter.uc.js` into your profile's `chrome/JS` folder.
3. Go to `about:support` → **Clear startup cache** → restart Zen.

### Set up a provider
1. Click the **⚙ button** next to the Sort button.
2. Pick a preset (e.g. *Ollama*), confirm the base URL.
3. Click **⟳ Fetch Models**, pick a model from the dropdown. Done.

For provider-specific setup (LM Studio server toggle, `OLLAMA_ORIGINS`, Gemini keys, rate limits), see [docs/PROVIDERS.md](docs/PROVIDERS.md).

## 🧠 How it works

```
click ⇅  →  snapshot active-workspace tabs  →  build batched prompt
         →  your model (local or cloud)      →  parse + repair
         →  reuse matching groups / create new ones via ATG
```

Titles + URLs are the only inputs (configurable). One batched call per ≤30 tabs, `temperature 0.1`, with a count-repair ladder for small local models, and a zero-network heuristic fallback (domain + keyword clustering) when the provider is unreachable. Full design in [docs/RESEARCH.md](docs/RESEARCH.md) · source-level teardown of every competing Zen AI tab mod in [docs/COMPETITORS.md](docs/COMPETITORS.md) · test walkthrough in [TESTING.md](TESTING.md).

## ⚙️ Settings

Basic settings live in Sine's mod preferences; everything (provider, keys, model, granularity, privacy, custom prompt) is in the mod's ⚙ panel. Stored via `about:config` under `mod.aitabsort.*`.

> 🔑 API keys are stored in your profile's `prefs.js` in plain text (a platform limitation shared by all Zen mods). Use low-scope keys, or stick to local providers.

## 🗺️ Roadmap

- [x] v0.1 — MVP: sort button, 10 provider presets (Ollama/LM Studio/llama.cpp/OpenAI/OpenRouter/Groq/Together/Mistral/Gemini/custom), Fetch Models + model dropdown, settings panel, group reuse, offline heuristic fallback, privacy modes
- [ ] v0.2 — chunked-session cache, JSON auto-detection, more granular per-provider diagnostics
- [ ] v0.3 — command palette integration, keyboard shortcut, session cache (0 API calls for unchanged tabs)
- [ ] v1.0 — Zen Mods Registry + Sine marketplace listing

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The stack is **vanilla JS, zero build step** — what runs is what's in the repo. PRs welcome, especially fixes for new Zen releases.

## 📄 License

[Apache-2.0](LICENSE) · © 2026 shumaqueraza
