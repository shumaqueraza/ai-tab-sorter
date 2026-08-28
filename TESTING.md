# Testing Guide — from GitHub to sorted tabs

Two paths: **A) Sine + GitHub** (the recommended, realistic flow — tests exactly what users will do) and **B) manual fx-autoconfig** (fastest local loop, no GitHub needed).

---

## Prerequisites (both paths)

1. **Zen Browser** — get it from [zen-browser.app](https://zen-browser.app).
2. **Advanced Tab Groups (ATG)** — the group engine this mod drives:
   - Install [Sine](https://github.com/CosmoCreeper/Sine) (see below), then add ATG from its marketplace/repo: `Vertex-Mods/Advanced-Tab-Groups`
   - Verify after restart: right-click a tab → "Add tab to group" exists, or `about:config` → `browser.tabs.groups.enabled` is `true`.
3. **Disable Zen's built-in AI grouping** (it conflicts):
   - `about:config` → `browser.tabs.groups.smart.enabled` → **false**
4. **A provider**, easiest first:
   - **Ollama**: install from [ollama.com](https://ollama.com), then in a terminal:
     ```bash
     ollama pull llama3.1:8b     # ~4.7 GB; or `qwen2.5:7b`, `mistral:7b`
     ollama list                  # confirm it's there
     ```
     Ollama's service usually starts automatically (`ollama serve` if not).

---

## Path A — Sine, loading the mod from GitHub

### Step 0 — Install Sine (once)
1. Go to [Sine releases](https://github.com/CosmoCreeper/Sine/releases).
2. Download the installer for your OS (Windows/Linux: run it; macOS: unquarantine first — instructions on the release page).
3. Fully restart Zen. Sine now appears inside Settings (`about:preferences`).

### Step 1 — Push this repo to GitHub
```bash
cd ai-tab-sorter
git init && git add -A && git commit -m "feat: AI Tab Sorter v0.1.0"
git remote add origin https://github.com/shumaqueraza/ai-tab-sorter.git
git branch -M main
git push -u origin main
```
Sine pulls **straight from your `main` branch** — the `theme.json` at the repo root is the manifest it reads.

### Step 2 — Install ATG (if not done) and this mod via Sine
1. Zen → Settings → **Sine** → Marketplace (or "Add mod") → install **Advanced Tab Groups**.
2. In Sine, choose **Add mod / test unpublished mod** → enter your repo:
   `https://github.com/shumaqueraza/ai-tab-sorter`
3. Install → restart Zen when prompted.

### Step 3 — Verify the mod is alive
1. Look at the tab strip divider **between pinned and unpinned tabs**:
   you should see the **⇅ sort button** and the **sliders ⚙ button**.
2. No buttons? Open the Browser Console (`Ctrl+Shift+J`), filter `AITabSorter`.
   - `[AITabSorter] initialized v0.1.0` (with debug logging on) = mod is running.
   - Warning about `gBrowser.addTabGroup` = ATG isn't installed/enabled yet.
   - Nothing at all = Sine didn't load it; check it's enabled in Sine's mod list.

### Step 4 — Configure a provider (Fetch Models!)
1. Click the **⚙ button** next to the sort button.
2. Provider should read **Ollama (local)**, base URL `http://localhost:11434`.
3. Click **⟳ Fetch Models** → expect `✓ N models · …ms` and the dropdown fills.
4. Pick `llama3.1:8b` (or whatever you pulled). Close the panel.

**Cloud variant (optional):** pick OpenAI/OpenRouter/etc., paste API key → Fetch Models → choose a model. The footer line turns red and says "leaves your machine" — that's the privacy disclosure working.

### Step 5 — Sort!
1. Open 8–15 messy tabs (GitHub, YouTube, docs, news, shopping…).
2. Click **⇅**. The icon spins while the model thinks (a few seconds locally).
3. Expect: tabs collapse into **colored, labeled tab groups** (rendered by ATG), button turns **green** with a summary like `11 tabs → 4 groups in 6.3s`.
4. Open more related tabs → click **⇅** again → new tabs should **join the existing groups by name** (group-reuse behavior).
5. Ctrl+Shift-select a few tabs → click **⇅** → only those tabs get sorted (selection mode).

### Step 6 — Update flow (the Sine magic)
Push any change to `main`, bump `version` in `theme.json`, commit. Users' Sine pulls the update automatically on next browser start. To test it yourself: make a trivial change, push, restart Zen, check the version in the ⚙ panel header.

---

## Path B — Manual (fx-autoconfig, no GitHub)

1. Install [fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig) (its README has per-OS steps).
2. `about:config` → `toolkit.legacyUserProfileCustomizations.stylesheets` → **true**.
3. Find your profile folder: `about:support` → "Profile Folder" → Open.
4. Copy into the profile:
   - `src/ai-tab-sorter.uc.js` → `chrome/JS/`
   - `userChrome.css` → `chrome/` (append if you already have one)
5. `about:support` → **Clear startup cache** → restart Zen.
6. Continue at Step 3 above.

---

## Debug console API

With the mod running, the Browser Console (`Ctrl+Shift+J`) exposes:

```js
aiTabSorter.version        // "0.1.0"
aiTabSorter.sort()         // trigger a sort programmatically
aiTabSorter.openSettings() // open the panel
aiTabSorter.isSorting()    // busy flag
aiTabSorter.prefs.all()    // current settings snapshot
```

Enable **Debug logging** in the ⚙ panel for verbose `[AITabSorter]` traces.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| No buttons in the tab strip | Enable "Show Sort and Settings buttons" in Sine's mod prefs or ⚙; pin any tab once (creates the separator anchor), then restart; check console for `no tab-strip anchor found` |
| Fetch Models: "Cannot reach http://localhost:11434" | `ollama serve` isn't running, or wrong port |
| Fetch Models: 401/403 | Wrong/missing API key |
| Fetch Models: 404 | Base URL wrong — for OpenAI-compatible services it must include `/v1` |
| Sort ends instantly, nothing happens | < 2 sortable tabs, or all tabs already grouped — select tabs explicitly and retry |
| Everything goes to "Uncategorized" | Model too small — try `llama3.1:8b`+, or switch Output mode to JSON in ⚙ |
| Groups don't appear at all | ATG missing/disabled — check `browser.tabs.groups.enabled` is true and ATG is installed |
| Sorts weird after Zen update | Check ATG repo for updates; both mods must be current |
| Buttons vanish on workspace switch | They should re-attach in <1s via the hooks; if not, file an issue with console output |

---

## Pre-publish checklist

- [x] Repo URLs + author set everywhere (theme.json, README, LICENSE → `shumaqueraza/ai-tab-sorter`)
- [ ] `npm run` checks pass locally: `npx eslint src/ai-tab-sorter.uc.js` · `node scripts/validate-manifests.mjs` · `node --test scripts/unit-tests.mjs`
- [ ] Tested Path A end-to-end from the GitHub repo (Sine is what users use)
- [ ] Tested: Ollama + one cloud provider, sort-all + sort-selected, group reuse
- [ ] Screenshot 600×400 PNG recorded for the Zen Mods Registry submission
- [ ] `theme.json` version = git tag (`v0.1.0`)
