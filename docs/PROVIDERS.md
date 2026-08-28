# Provider Setup Guide

Every provider the mod supports, how to turn it on, and its gotchas.
The mod speaks three dialects — **OpenAI-compatible** (covers almost everything), **Ollama native**, and **Gemini native**.

## Quick reference

| Preset | Default base URL | Auth | List models endpoint | Notes |
|---|---|---|---|---|
| Ollama | `http://localhost:11434` | none | `GET /api/tags` (+ `/v1/models`) | zero-setup local default |
| LM Studio | `http://localhost:1234/v1` | none | `GET /v1/models` | server must be started in app |
| llama.cpp | `http://localhost:8080/v1` | none | `GET /v1/models` | `llama-server` |
| OpenAI | `https://api.openai.com/v1` | API key | `GET /v1/models` | |
| OpenRouter | `https://openrouter.ai/api/v1` | API key | `GET /v1/models` | 400+ models, lists without auth |
| Groq | `https://api.groq.com/openai/v1` | API key | `GET /v1/models` | very fast inference |
| Together | `https://api.together.xyz/v1` | API key | `GET /v1/models` | |
| Mistral | `https://api.mistral.ai/v1` | API key | `GET /v1/models` | |
| Gemini | `https://generativelanguage.googleapis.com` | API key | `GET /v1beta/models?key=` | free tier has low RPM |
| Custom | *you decide* | optional | `GET {base}/models` | any OpenAI-compatible service |

## Local setups

### Ollama (recommended default)
```bash
ollama serve                       # usually already running as a service
ollama pull llama3.1:8b            # or qwen2.5:7b / mistral:7b — any instruct model works
```
- Fetch Models lists everything `ollama list` shows.
- If requests are refused from the browser, start with `OLLAMA_ORIGINS=* ollama serve` (rarely needed — the mod fetches from a privileged context).

### LM Studio
1. Load a model → **Local Server** tab → **Start Server** (port 1234).
2. In the mod panel choose the **LM Studio** preset → **⟳ Fetch Models**.
- If listing fails, enable **"Serve on local network"** / CORS in LM Studio's server settings and retry.

### llama.cpp
```bash
llama-server -m your-model.gguf --port 8080
```
Preset **llama.cpp server** → Fetch Models.

## Cloud setups
1. Pick the preset, paste your API key (keys are stored in `prefs.js` in your profile — use low-scope keys).
2. **⟳ Fetch Models** → choose a model. Cheaper/faster models are plenty for categorization (e.g. `gpt-4o-mini`, `groq/llama-3.1-8b-instant`, `gemini-2.0-flash`).

### Gemini notes
- Free tier rate limits are low — if you sort frequently, prefer OpenRouter's free Gemini endpoints or a local model.
- The error panel decodes Google's 400 (bad key) / 403 (permission) / 429 (rate) responses with plain-language hints.

## Custom provider (anything OpenAI-compatible)
Set preset **Custom**, paste the base URL up to (but not including) `/chat/completions` — e.g. `http://localhost:1337/v1` for Jan, `https://api.deepseek.com/v1`, your vLLM/TGI deployment. Optional key. Fetch Models works against `{base}/models`.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Fetch Models: "connection refused" | Local runtime not running, or wrong port — the error shows the exact URL tried |
| Fetch Models: 401/403 | Missing or wrong API key |
| Sort finishes but groups are "Uncategorized" | Model too small — pick a larger instruct model, or enable JSON mode |
| Sort errors after Zen update | Check the [ATG repo](https://github.com/Vertex-Mods/Advanced-Tab-Groups) for a matching update; both mods must be current |
| Nothing happens at all | Enable debug logging in ⚙ panel, open browser console (`Ctrl+Shift+J`), filter `[AITabSorter]` |
