// ==UserScript==
// @name           AI Tab Sorter
// @ignorecache
// ==/UserScript==
/*
 * AI Tab Sorter — on-demand, AI-powered tab grouping for Zen Browser.
 * v0.1.0 — Apache-2.0 licensed. Requires Advanced Tab Groups:
 *   https://github.com/Vertex-Mods/Advanced-Tab-Groups
 *
 * Sort button appears above your tabs. Click = categorize open tabs with
 * any provider (Ollama / LM Studio / llama.cpp / OpenAI / OpenRouter / Groq /
 * Together / Mistral / Gemini / any OpenAI-compatible URL) and group them.
 * Strictly on-demand. Never sorts in the background. Never closes tabs.
 *
 * Design docs: docs/RESEARCH.md · Providers: docs/PROVIDERS.md
 */

(() => {
  "use strict";

  const VERSION = "0.1.2";
  const PREF_BRANCH = "mod.aitabsort.";
  const LOG_PREFIX = "[AITabSorter]";
  // Settings page (Sine renders mod prefs here) — we enhance it instead of
  // injecting tab-strip UI.
  const IS_PREFS = typeof location !== "undefined"
    && location.href.startsWith("chrome://browser/content/preferences");

  const log = (...args) => {
    try {
      if (Services.prefs.getBoolPref(PREF_BRANCH + "debugLogging", false)) {
        console.log(LOG_PREFIX, ...args);
      }
    } catch (_e) { /* prefs unavailable (Node test context) */ }
  };

  /* ══════════════════════════════════════════════════════════════
   * PrefStore — typed access to mod.aitabsort.* with defaults
   * ══════════════════════════════════════════════════════════════ */
  class PrefStore {
    static DEFAULTS = {
      enabled: true,
      provider: "ollama",
      baseURL: "http://localhost:11434",
      apiKey: "",
      model: "",
      modelList: "[]",           // cached JSON array from Fetch Models
      granularity: 3,            // 1 broad … 5 fine-grained
      outputMode: "lines",       // lines | json
      reuseGroups: true,
      minGroupSize: 2,
      heuristicFallback: true,
      payloadMode: "title-url",  // title-url | title-host | title
      customPrompt: "",
      timeoutSec: 120,
      showButtons: true,
      debugLogging: false,
    };

    static get(key) {
      const def = this.DEFAULTS[key];
      try {
        const svc = Services.prefs;
        const name = PREF_BRANCH + key;
        if (!svc.prefHasUserValue(name)) return def;
        switch (svc.getPrefType(name)) {
          case svc.PREF_STRING: return svc.getStringPref(name);
          case svc.PREF_INT:    return svc.getIntPref(name);
          case svc.PREF_BOOL:   return svc.getBoolPref(name);
        }
      } catch (e) { log("pref read failed", key, e); }
      return def;
    }

    static set(key, value) {
      try {
        const name = PREF_BRANCH + key;
        const svc = Services.prefs;
        if (typeof value === "boolean") svc.setBoolPref(name, value);
        else if (typeof value === "number") svc.setIntPref(name, value);
        else svc.setStringPref(name, String(value ?? ""));
      } catch (e) { log("pref write failed", key, e); }
    }

    static all() {
      const out = {};
      for (const k of Object.keys(this.DEFAULTS)) out[k] = this.get(k);
      return out;
    }
  }

  /* ══════════════════════════════════════════════════════════════
   * ProviderHub — presets, dialects (openai | ollama | gemini),
   * model-list normalization, categorization calls
   * ══════════════════════════════════════════════════════════════ */
  class ProviderError extends Error {
    constructor(message, hint) {
      super(message);
      this.name = "ProviderError";
      this.hint = hint || "";
    }
  }

  async function fetchJSON(url, { method = "GET", headers = {}, body = null, timeoutSec = 120 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(1, timeoutSec) * 1000);
    let res;
    try {
      res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    } catch (e) {
      if (e && e.name === "AbortError") {
        throw new ProviderError(`Request timed out after ${timeoutSec}s: ${url}`, "Increase the timeout in the mod settings, or use a faster/smaller model.");
      }
      throw new ProviderError(
        `Cannot reach ${url}`,
        "Is the server running? Check the base URL and port (Ollama: `ollama serve` · LM Studio: start the Local Server)."
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const errJson = await res.json();
        detail = errJson?.error?.message || errJson?.message || detail;
      } catch (_e) { /* non-JSON error body */ }
      let hint = "";
      if (res.status === 401 || res.status === 403) hint = "Check your API key.";
      else if (res.status === 404) hint = "Check the base URL (for OpenAI-compatible services it usually ends with /v1).";
      else if (res.status === 429) hint = "Rate limited — wait a moment or switch provider/model.";
      throw new ProviderError(`HTTP ${res.status} from ${url}: ${detail}`, hint);
    }
    return res.json();
  }

  class ProviderHub {
    static PRESETS = {
      ollama:     { label: "Ollama (local)",           baseURL: "http://localhost:11434",                          auth: false, dialect: "ollama" },
      lmstudio:   { label: "LM Studio (local)",        baseURL: "http://localhost:1234/v1",                        auth: false, dialect: "openai" },
      llamacpp:   { label: "llama.cpp server (local)", baseURL: "http://localhost:8080/v1",                        auth: false, dialect: "openai" },
      openai:     { label: "OpenAI",                   baseURL: "https://api.openai.com/v1",                       auth: true,  dialect: "openai" },
      openrouter: { label: "OpenRouter",               baseURL: "https://openrouter.ai/api/v1",                    auth: true,  dialect: "openai" },
      groq:       { label: "Groq",                     baseURL: "https://api.groq.com/openai/v1",                  auth: true,  dialect: "openai" },
      together:   { label: "Together",                 baseURL: "https://api.together.xyz/v1",                     auth: true,  dialect: "openai" },
      mistral:    { label: "Mistral",                  baseURL: "https://api.mistral.ai/v1",                       auth: true,  dialect: "openai" },
      gemini:     { label: "Google Gemini",            baseURL: "https://generativelanguage.googleapis.com",       auth: true,  dialect: "gemini" },
      custom:     { label: "Custom (OpenAI-compatible)", baseURL: "",                                              auth: null,  dialect: "openai" },
    };

    /** Resolve the active provider config (preset defaults + user overrides). */
    static cfg() {
      const p = PrefStore.all();
      const preset = this.PRESETS[p.provider] || this.PRESETS.custom;
      return {
        ...p,
        dialect: preset.dialect,
        baseURL: this.sanitizeBase(p.baseURL || preset.baseURL),
        needsAuth: preset.auth,
      };
    }

    static sanitizeBase(url) {
      const trimmed = String(url || "").trim().replace(/\/+$/, "");
      return trimmed;
    }

    static authHeaders(cfg) {
      return cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {};
    }

    /** Pure: normalize a model-list response → [{id, label}] (unit-tested). */
    static normalizeModels(dialect, json) {
      const out = [];
      try {
        if (dialect === "ollama") {
          for (const m of json?.models || []) {
            if (m?.name) out.push({ id: m.name, label: m.details?.parameter_size ? `${m.name} (${m.details.parameter_size})` : m.name });
          }
        } else if (dialect === "gemini") {
          for (const m of json?.models || []) {
            const methods = m?.supportedGenerationMethods;
            if (methods && !methods.includes("generateContent")) continue;
            const id = String(m?.name || "").replace(/^models\//, "");
            if (id) out.push({ id, label: id });
          }
        } else { // openai-compatible
          const list = json?.data || json?.models || [];
          for (const m of list) {
            const id = m?.id || m?.name;
            if (id) out.push({ id, label: id });
          }
        }
      } catch (_e) { return []; }
      out.sort((a, b) => a.label.localeCompare(b.label));
      return out;
    }

    /** Fetch models for the "Fetch Models" button. */
    static async listModels(cfgOverride) {
      const cfg = cfgOverride || this.cfg();
      if (!cfg.baseURL) throw new ProviderError("No base URL configured.", "Pick a provider preset and set the base URL first.");
      let url;
      const headers = { ...this.authHeaders(cfg) };
      if (cfg.dialect === "ollama") {
        url = `${cfg.baseURL}/api/tags`;
      } else if (cfg.dialect === "gemini") {
        if (!cfg.apiKey) throw new ProviderError("Gemini needs an API key.", "Get one at aistudio.google.com and paste it in the panel.");
        url = `${cfg.baseURL}/v1beta/models?key=${encodeURIComponent(cfg.apiKey)}`;
      } else {
        url = `${cfg.baseURL}/models`;
      }
      const json = await fetchJSON(url, { headers, timeoutSec: cfg.timeoutSec });
      const models = this.normalizeModels(cfg.dialect, json);
      if (!models.length) throw new ProviderError("Provider returned an empty model list.", "Is a model loaded / your key valid for listing models?");
      return models;
    }

    /** One categorization call → raw model text. */
    static async categorize(cfg, prompt, opts = {}) {
      if (!cfg.baseURL) throw new ProviderError("No base URL configured.");
      if (!cfg.model) throw new ProviderError("No model selected.", "Open the ⚙ panel, click Fetch Models and pick a model.");
      const maxTokens = Math.max(256, (opts.tabCount || 16) * 16);
      let url, headers, body;

      if (cfg.dialect === "ollama") {
        url = `${cfg.baseURL}/api/chat`;
        headers = { "Content-Type": "application/json" };
        body = JSON.stringify({
          model: cfg.model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          ...(opts.json ? { format: "json" } : {}),
          options: { temperature: 0.1, num_predict: maxTokens },
        });
      } else if (cfg.dialect === "gemini") {
        url = `${cfg.baseURL}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey || "")}`;
        headers = { "Content-Type": "application/json" };
        body = JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: maxTokens,
            ...(opts.json ? { responseMimeType: "application/json" } : {}),
          },
        });
      } else { // openai-compatible
        url = `${cfg.baseURL}/chat/completions`;
        headers = { "Content-Type": "application/json", ...this.authHeaders(cfg) };
        body = JSON.stringify({
          model: cfg.model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: maxTokens,
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        });
      }

      const json = await fetchJSON(url, { method: "POST", headers, body, timeoutSec: cfg.timeoutSec });

      let text;
      if (cfg.dialect === "ollama") text = json?.message?.content;
      else if (cfg.dialect === "gemini") {
        text = json?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("");
        if (!text) {
          const why = json?.promptFeedback?.blockReason || json?.candidates?.[0]?.finishReason;
          throw new ProviderError(`Gemini returned no content${why ? ` (${why})` : ""}.`, "Try again, or lower the tab count per request.");
        }
      } else {
        text = json?.choices?.[0]?.message?.content;
        if (!text && json?.error) throw new ProviderError(String(json.error.message || "Provider error"));
      }
      if (!text) throw new ProviderError("Provider returned an empty response.");
      return String(text).trim();
    }
  }

  /* ══════════════════════════════════════════════════════════════
   * PromptBuilder — batched tab payloads + existing-group reuse
   * ══════════════════════════════════════════════════════════════ */
  class PromptBuilder {
    static GRANULARITY = {
      1: "Use BROAD categories: merge topics aggressively (aim for 3-6 groups total).",
      2: "Use fairly broad categories (aim for 4-8 groups total).",
      3: "Use natural, balanced categories (aim for 6-10 groups total).",
      4: "Use fairly specific categories (aim for 8-14 groups total).",
      5: "Use fine-grained, specific categories (12+ groups is fine).",
    };

    static payloadLine(data, mode) {
      const title = String(data.title || "Untitled").slice(0, 120);
      if (mode === "title") return `Title: ${title}`;
      const host = String(data.hostname || "").replace(/^www\./, "");
      if (mode === "title-host") return `Title: ${title} | Host: ${host}`;
      return `Title: ${title} | Host: ${host} | URL: ${String(data.url || "").slice(0, 200)}`;
    }

    /** Build the batch prompt for one chunk. */
    static build(tabDataList, existingGroupLabels, cfg) {
      const mode = cfg.outputMode === "json";
      const tabLines = tabDataList
        .map((d, i) => `${i + 1}. ${this.payloadLine(d, cfg.payloadMode)}`)
        .join("\n");
      const existing = (existingGroupLabels || []).length
        ? `Existing groups (if a tab fits one of these, REUSE that EXACT name — do not create variations):\n${existingGroupLabels.map((n) => `- ${n}`).join("\n")}`
        : "Existing groups: none yet.";

      const rules = [
        this.GRANULARITY[cfg.granularity] || this.GRANULARITY[3],
        "Consistency is critical: the same logical topic MUST get the identical name across all lines.",
        "Category format: 1-2 words, Title Case (e.g. \"GitHub\", \"Web Dev\", \"News\").",
        existing,
      ];

      let output;
      if (mode) {
        output = [
          `Output ONLY a JSON array with exactly ${tabDataList.length} entries, one per tab, in input order:`,
          '[{"i":1,"c":"Category"}, {"i":2,"c":"Category"}, ...]',
          "No markdown, no code fences, no commentary — JSON only.",
        ].join("\n");
      } else {
        output = [
          `Output EXACTLY ${tabDataList.length} lines — one category per line, in the same order as the tabs.`,
          "No numbering, no explanations, no markdown — just the category names.",
        ].join("\n");
      }

      const custom = String(cfg.customPrompt || "").trim();
      const customSection = custom
        ? (custom.includes("{TAB_DATA_LIST}") || custom.includes("{EXISTING_CATEGORIES_LIST}")
            ? custom.replace(/{EXISTING_CATEGORIES_LIST}/g, existing).replace(/{TAB_DATA_LIST}/g, tabLines)
            : `Additional user instructions (high priority):\n${custom}`)
        : "";

      const parts = [
        "You are a precise tab organizer for a web browser. Categorize the numbered tabs below.",
        customSection,
        "Rules:",
        ...rules.map((r) => `- ${r}`),
        "Tabs:",
        tabLines,
        "Output:",
        output,
      ];
      return parts.filter(Boolean).join("\n\n");
    }

    /** Chunk tab data so small local models aren't overwhelmed. */
    static chunk(list, size = 30) {
      const n = Math.max(1, size);
      const out = [];
      for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
      return out;
    }
  }

  /* ══════════════════════════════════════════════════════════════
   * ResponseParser — parse + repair ladder (tolerant of small models)
   * ══════════════════════════════════════════════════════════════ */
  class ResponseParser {
    /** Clean one raw category line → normalized Title-Case name. */
    static normalizeCategory(raw) {
      let s = String(raw || "").trim();
      s = s.replace(/^\d+\s*[.):-]\s*/, "");            // "1." "2)" "3 -"
      s = s.replace(/^[-*•]\s*/, "");                    // bullets
      s = s.replace(/^\**|\**$/g, "");                   // **bold**
      s = s.replace(/^["'`]+|["'`]+$/g, "");             // quotes
      s = s.replace(/^(category|group|topic|label)\s*[:-]\s*/i, "");
      s = s.replace(/[.\s]+$/, "");
      s = s.replace(/\s+/g, " ").trim();
      if (!s) return "";
      s = s.split(" ").slice(0, 4).join(" ");            // cap at 4 words
      if (s.length > 40) s = s.slice(0, 40).trim();
      return s.replace(/\b\p{L}[\p{L}\p{N}'&.-]*/gu, (w) =>
        w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)
      );
    }

    /**
     * Lines mode with repair ladder:
     * exact → single-line fix → truncate extras → pad "Uncategorized".
     */
    static parseLines(text, expectedCount) {
      const lines = String(text || "")
        .split(/\r?\n/)
        .map((l) => this.normalizeCategory(l))
        .filter(Boolean);
      if (!lines.length || expectedCount < 1) {
        return Array.from({ length: Math.max(0, expectedCount) }, () => null);
      }
      if (expectedCount === 1) return [lines[0]];
      let cats;
      if (lines.length >= expectedCount) cats = lines.slice(0, expectedCount);
      else cats = [...lines, ...Array.from({ length: expectedCount - lines.length }, () => "Uncategorized")];
      return cats;
    }

    /** Strict-ish JSON parse: [{"i":1,"c":"X"}]. Returns array | null. */
    static parseJSON(text, expectedCount) {
      const raw = String(text || "");
      const start = raw.indexOf("[");
      const end = raw.lastIndexOf("]");
      if (start === -1 || end <= start) return null;
      let arr;
      try { arr = JSON.parse(raw.slice(start, end + 1)); } catch (_e) { return null; }
      if (!Array.isArray(arr)) return null;
      const cats = Array.from({ length: expectedCount }, () => null);
      for (const e of arr) {
        const i = Number(e?.i ?? e?.index);
        const c = e?.c ?? e?.category;
        const name = this.normalizeCategory(c);
        if (Number.isInteger(i) && i >= 1 && i <= expectedCount && name) cats[i - 1] = name;
      }
      return cats.some(Boolean) ? cats : null;
    }
  }

  /* ══════════════════════════════════════════════════════════════
   * HeuristicSorter — offline fallback (hostname + keyword buckets)
   * ══════════════════════════════════════════════════════════════ */
  class HeuristicSorter {
    static STOPWORDS = new Set(("the a an and or but for nor so yet to of in on at by with from into over after before " +
      "is are was were be been being it its it's this that these those you your we our they their he she his her " +
      "not no do does did how why what when where who which will would can could should shall may might must " +
      "new best top guide review vs get make made just out about more most other some any all " +
      "com net org www http https github youtube google reddit twitter x com docs doc home index page site web app").split(/\s+/));

    static tokens(title) {
      return String(title || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s'-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !this.STOPWORDS.has(w) && !/^\d+$/.test(w));
    }

    /**
     * Pure: [{title, hostname, url}] → category|null per input.
     * Pass 1: same-hostname buckets. Pass 2: shared significant keyword.
     * Buckets smaller than minGroupSize → null (leave ungrouped).
     */
    static group(tabDataList, minGroupSize = 2) {
      const n = tabDataList.length;
      const result = Array.from({ length: n }, () => null);

      // Pass 1 — hostname buckets
      const byHost = new Map();
      tabDataList.forEach((d, i) => {
        const h = String(d.hostname || "").replace(/^www\./, "").toLowerCase();
        if (!h) return;
        if (!byHost.has(h)) byHost.set(h, []);
        byHost.get(h).push(i);
      });
      for (const [host, idxs] of byHost) {
        if (host.length < 4 || host === "localhost" || host === "127.0.0.1") continue;
        if (idxs.length >= minGroupSize) {
          const label = host.split(".")[0].replace(/(^|-)([a-z])/g, (_, p1, p2) => (p1 ? " " : "") + p2.toUpperCase());
          idxs.forEach((i) => { result[i] = label; });
        }
      }

      // Pass 2 — keyword buckets for the rest
      const rest = [];
      for (let i = 0; i < n; i++) if (!result[i]) rest.push(i);
      const df = new Map(); // word → tab indexes
      for (const i of rest) {
        const seen = new Set(this.tokens(tabDataList[i].title));
        for (const w of seen) {
          if (!df.has(w)) df.set(w, []);
          df.get(w).push(i);
        }
      }
      const candidateWords = [...df.entries()]
        .filter(([, idxs]) => idxs.length >= minGroupSize)
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
      for (const [word, idxs] of candidateWords) {
        const free = idxs.filter((i) => !result[i]);
        if (free.length < minGroupSize) continue;
        const label = word.charAt(0).toUpperCase() + word.slice(1);
        free.forEach((i) => { result[i] = label; });
      }
      return result;
    }
  }

  /* ══════════════════════════════════════════════════════════════
   * TabCollector — workspace-aware snapshot with exclusion rules
   * ══════════════════════════════════════════════════════════════ */
  class TabCollector {
    static valid(tab) {
      if (!tab || !tab.isConnected || tab.pinned) return false;
      if (tab.hasAttribute("zen-empty-tab")) return false;
      const g = tab.closest?.("tab-group");
      if (g && g.hasAttribute("split-view-group")) return false;
      try {
        const spec = tab.linkedBrowser?.currentURI?.spec || "";
        if (/^(about|chrome|resource|moz-extension|file):/i.test(spec)) return false;
      } catch (_e) { /* unreadable URI — still sortable by title */ }
      return true;
    }

    /** Sort targets: multi-selected tabs if ≥2 selected, else ungrouped
     *  tabs of the ACTIVE workspace. */
    static collect() {
      const selected = (gBrowser.selectedTabs || []).filter((t) => this.valid(t));
      if (selected.length > 1) return selected;

      let candidates = [];
      try {
        const strip = gZenWorkspaces?.activeWorkspaceStrip;
        if (strip) candidates = [...strip.querySelectorAll("tab")];
      } catch (_e) { /* fall through */ }
      if (!candidates.length) candidates = [...gBrowser.tabs];
      return candidates.filter((t) => this.valid(t) && !t.closest?.("tab-group"));
    }

    /** Extract {title, hostname, url} for one tab. */
    static describe(tab) {
      let title = "";
      try { title = tab.getAttribute("label") || tab.querySelector(".tab-label, .tab-text")?.textContent || ""; } catch (_e) { /* noop */ }
      let url = "", hostname = "";
      try {
        const spec = tab.linkedBrowser?.currentURI?.spec || "";
        if (spec && !spec.startsWith("about:")) {
          const u = new URL(spec);
          url = u.href;
          hostname = u.hostname;
        }
      } catch (_e) { /* keep empty */ }
      const clean = String(title).trim();
      const fallback = hostname && hostname !== "localhost" ? hostname.replace(/^www\./, "") : "";
      return {
        title: !clean || clean === "New Tab" || clean === "Loading..." || /^https?:\/\//i.test(clean)
          ? (fallback || clean || "Untitled")
          : clean,
        hostname,
        url,
      };
    }

    /** Groups of the active workspace: [{label, el}]. Prefers the ATG
     *  interop surface when present; falls back to raw gBrowser.tabGroups. */
    static existingGroups() {
      let groups;
      try {
        groups = [...gBrowser.tabGroups].filter((g) => g.tagName === "tab-group");
      } catch (_e) { return []; }
      const activeWs = gZenWorkspaces?.activeWorkspace?.uuid || null;
      const inWorkspace = groups.filter((g) => {
        if (g.hasAttribute("split-view-group")) return false;
        const wsId = g.getAttribute("zen-workspace-id")
          || this.firstTabWorkspace(g)
          || (activeWs ? activeWs : null);
        return !activeWs || !wsId || wsId === activeWs;
      });
      return inWorkspace
        .filter((g) => g.label)
        .map((g) => ({ label: g.label, el: g }));
    }

    static firstTabWorkspace(group) {
      try {
        const t = group.querySelector("tab");
        return t?.getAttribute("zen-workspace-id") || null;
      } catch (_e) { return null; }
    }
  }

  /* ══════════════════════════════════════════════════════════════
   * GroupingEngine — drives native group APIs (reuse-or-create)
   * ══════════════════════════════════════════════════════════════ */
  class GroupingEngine {
    static PALETTE = ["blue", "turquoise", "green", "yellow", "orange", "red", "pink", "purple"];
    static #colorIdx = 0;

    static expand(group) {
      try {
        if (group.getAttribute("collapsed") === "true") {
          group.setAttribute("collapsed", "false");
          group.querySelector(".tab-group-label")?.setAttribute("aria-expanded", "true");
        }
      } catch (_e) { /* noop */ }
    }

    static nextColor(existingGroups) {
      const used = new Set(existingGroups.map((g) => {
        const c = g.el?.color || "";
        return String(c).split("-").pop();
      }));
      for (let i = 0; i < this.PALETTE.length; i++) {
        const color = this.PALETTE[(this.#colorIdx + i) % this.PALETTE.length];
        if (!used.has(color)) {
          this.#colorIdx = (this.#colorIdx + i + 1) % this.PALETTE.length;
          return color;
        }
      }
      return this.PALETTE[this.#colorIdx++ % this.PALETTE.length];
    }

    static findByLabel(label, existingGroups) {
      return existingGroups.find((g) => g.label === label && g.el?.isConnected) || null;
    }

    /**
     * assignments: [{tab, category}] → apply. Returns
     * {moved, created, reused, skipped} counts. NEVER removes tabs.
     */
    static apply(assignments) {
      const cfg = PrefStore.all();
      const existing = TabCollector.existingGroups();
      const byCategory = new Map();
      for (const a of assignments) {
        if (!a.category || !a.tab?.isConnected) continue;
        if (!byCategory.has(a.category)) byCategory.set(a.category, []);
        byCategory.get(a.category).push(a.tab);
      }

      const stats = { moved: 0, created: 0, reused: 0, skipped: 0 };
      const ordered = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);

      for (const [category, tabs] of ordered) {
        const live = tabs.filter((t) => t.isConnected);
        if (!live.length) continue;
        const group = cfg.reuseGroups ? this.findByLabel(category, existing) : null;

        if (group) {
          // ── reuse existing group ──
          this.expand(group.el);
          for (const tab of live) {
            if (tab.closest("tab-group") === group.el) { stats.skipped++; continue; }
            try {
              gBrowser.moveTabToGroup(tab, group.el);
              stats.moved++;
            } catch (e) {
              log("moveTabToGroup failed", category, e);
              stats.skipped++;
            }
          }
          stats.reused++;
        } else if (live.length >= Math.max(1, cfg.minGroupSize) || category === "Uncategorized") {
          if (live.length < Math.max(1, cfg.minGroupSize)) { stats.skipped += live.length; continue; }
          // ── create new group ──
          try {
            const el = gBrowser.addTabGroup(live, {
              label: category,
              color: this.nextColor(existing),
              insertBefore: live[0],
            });
            if (el && el.isConnected) {
              existing.push({ label: category, el });
              stats.created++;
            } else {
              // addTabGroup may throw/return disconnected — fallback lookup
              const fb = this.findByLabel(category, TabCollector.existingGroups());
              if (fb) { existing.push(fb); stats.created++; }
              else { log("addTabGroup produced no group for", category); stats.skipped += live.length; }
            }
          } catch (e) {
            log("addTabGroup failed", category, e);
            const fb = this.findByLabel(category, TabCollector.existingGroups());
            if (fb) { existing.push(fb); stats.created++; }
            else stats.skipped += live.length;
          }
        } else {
          stats.skipped += live.length; // below min group size, no existing match
        }
      }
      return stats;
    }
  }

  /* ══════════════════════════════════════════════════════════════
   * SortController — orchestrates one on-demand sort
   * ══════════════════════════════════════════════════════════════ */
  class SortController {
    static #sorting = false;
    static isSorting() { return this.#sorting; }

    static capability() {
      if (typeof gBrowser !== "undefined" && typeof gBrowser.addTabGroup === "function") return true;
      return false;
    }

    static async sort() {
      if (this.#sorting) { log("sort already running"); return; }
      if (!this.capability()) {
        ButtonInjector.setStatus("error", "Tab groups unavailable — install Advanced Tab Groups", 6000);
        return;
      }
      const tabs = TabCollector.collect();
      if (tabs.length < 2) {
        ButtonInjector.setStatus("error", "Need at least 2 sortable tabs (select tabs to sort only them)", 4000);
        return;
      }

      this.#sorting = true;
      ButtonInjector.setSorting(true, tabs.length);
      const t0 = Date.now();
      try {
        const cfg = ProviderHub.cfg();
        const data = tabs.map((t) => TabCollector.describe(t));
        const existingLabels = TabCollector.existingGroups().map((g) => g.label);

        let categories = null;
        let usedFallback = false;
        if (cfg.model) {
          try {
            categories = [];
            for (const chunkTabs of PromptBuilder.chunk(tabs)) {
              const chunkData = chunkTabs.map((t) => TabCollector.describe(t));
              const prompt = PromptBuilder.build(chunkData, existingLabels, cfg);
              const text = await ProviderHub.categorize(cfg, prompt, {
                tabCount: chunkTabs.length,
                json: cfg.outputMode === "json",
              });
              const parsed = cfg.outputMode === "json"
                ? (ResponseParser.parseJSON(text, chunkTabs.length) || ResponseParser.parseLines(text, chunkTabs.length))
                : ResponseParser.parseLines(text, chunkTabs.length);
              categories.push(...parsed);
            }
          } catch (e) {
            log("provider failed:", e.message, e.hint || "");
            if (!PrefStore.get("heuristicFallback")) {
              ButtonInjector.setStatus("error", `${e.message}${e.hint ? " — " + e.hint : ""}`, 8000);
              return;
            }
            categories = null;
          }
        } else {
          log("no model configured — using heuristic mode");
        }

        if (!categories) {
          categories = HeuristicSorter.group(data, PrefStore.get("minGroupSize"));
          usedFallback = !PrefStore.get("model") ? false : true;
        }

        // Drop nulls and (optionally) Uncategorized singles before applying
        const existingSet = new Set(existingLabels);
        const assignments = [];
        for (let i = 0; i < tabs.length; i++) {
          const cat = categories[i];
          if (!cat) continue;
          if (cat === "Uncategorized" && !existingSet.has("Uncategorized")) continue;
          assignments.push({ tab: tabs[i], category: cat });
        }

        const stats = GroupingEngine.apply(assignments);
        const ms = Date.now() - t0;
        const total = stats.created + stats.reused;
        const groupsWord = total === 1 ? "group" : "groups";
        ButtonInjector.setStatus(
          "done",
          `${assignments.length} tabs → ${total} ${groupsWord} in ${(ms / 1000).toFixed(1)}s${usedFallback ? " (offline fallback)" : ""}`,
          4000
        );
        console.info(LOG_PREFIX, `sorted ${tabs.length} tabs →`, stats, `${ms}ms`);
      } catch (e) {
        console.error(LOG_PREFIX, "sort failed:", e);
        ButtonInjector.setStatus("error", `Sort failed: ${e.message}`, 8000);
      } finally {
        this.#sorting = false;
        ButtonInjector.setSorting(false);
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════
   * SettingsPanel — native popup: provider, Fetch Models, model
   * selector, behavior + privacy options
   * ══════════════════════════════════════════════════════════════ */
  const HTMLNS = "http://www.w3.org/1999/xhtml";

  class SettingsPanel {
    static #panel = null;
    static #els = {};

    static ensure() { /* panel is built lazily by open() */ }

    static #h(tag, attrs = {}, ...children) {
      const el = document.createElementNS(HTMLNS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      for (const c of children) if (c) el.append(c);
      return el;
    }

    static #build() {
      if (this.#panel?.isConnected) return this.#panel;
      this.#panel?.remove();

      const root = this.#h("div", { class: "ats-root" });
      root.innerHTML = `
        <div class="ats-head"><span class="ats-title">AI Tab Sorter</span><span class="ats-ver">v${VERSION}</span></div>

        <div class="ats-l">Provider</div>
        <select id="ats-provider"></select>

        <div class="ats-l">Base URL</div>
        <input id="ats-base" type="text" spellcheck="false" placeholder="http://localhost:11434"/>

        <div id="ats-key-row">
          <div class="ats-l">API key</div>
          <input id="ats-key" type="password" spellcheck="false" placeholder="not needed for local runtimes"/>
        </div>

        <div class="ats-modelrow">
          <button id="ats-fetch">⟳ Fetch Models</button>
          <select id="ats-model"></select>
        </div>
        <div id="ats-status" class="ats-status"></div>

        <div class="ats-sep"></div>

        <div class="ats-grid">
          <span class="ats-l">Granularity</span>
          <select id="ats-gran">
            <option value="1">Broadest (3-6 groups)</option>
            <option value="2">Broad</option>
            <option value="3" selected="selected">Balanced</option>
            <option value="4">Specific</option>
            <option value="5">Finest (12+ groups)</option>
          </select>
          <span class="ats-l">Output</span>
          <select id="ats-out">
            <option value="lines" selected="selected">Simple lines (works everywhere)</option>
            <option value="json">JSON (strict models)</option>
          </select>
          <span class="ats-l">Min group size</span>
          <input id="ats-min" type="number" min="1" max="10" step="1"/>
          <span class="ats-l">Data sent</span>
          <select id="ats-payload">
            <option value="title-url" selected="selected">Title + full URL</option>
            <option value="title-host">Title + hostname</option>
            <option value="title">Title only</option>
          </select>
          <span class="ats-l">Timeout</span>
          <input id="ats-timeout" type="number" min="10" max="600" step="5"/>
        </div>

        <label class="ats-check"><input type="checkbox" id="ats-reuse"/> Reuse existing groups by name</label>
        <label class="ats-check"><input type="checkbox" id="ats-fallback"/> Offline fallback when provider unreachable</label>
        <label class="ats-check"><input type="checkbox" id="ats-debug"/> Debug logging in console</label>

        <div class="ats-sep"></div>
        <div id="ats-flow" class="ats-flow"></div>
        <button id="ats-sort" class="ats-primary">⇅ Sort tabs now</button>
      `;

      const providerSel = root.querySelector("#ats-provider");
      for (const [value, p] of Object.entries(ProviderHub.PRESETS)) {
        const o = this.#h("option", { value });
        o.textContent = p.label;
        providerSel.append(o);
      }

      this.#panel = document.createXULElement("panel");
      this.#panel.id = "ai-tab-sorter-panel";
      this.#panel.setAttribute("type", "arrow");
      this.#panel.setAttribute("class", "ai-tab-sorter-panel");
      this.#panel.setAttribute("noautofocus", "true");
      this.#panel.append(root);
      (document.getElementById("mainPopupSet") || document.documentElement).append(this.#panel);

      this.#els = {
        provider: providerSel,
        base: root.querySelector("#ats-base"),
        keyRow: root.querySelector("#ats-key-row"),
        key: root.querySelector("#ats-key"),
        fetchBtn: root.querySelector("#ats-fetch"),
        model: root.querySelector("#ats-model"),
        status: root.querySelector("#ats-status"),
        gran: root.querySelector("#ats-gran"),
        out: root.querySelector("#ats-out"),
        min: root.querySelector("#ats-min"),
        payload: root.querySelector("#ats-payload"),
        timeout: root.querySelector("#ats-timeout"),
        reuse: root.querySelector("#ats-reuse"),
        fallback: root.querySelector("#ats-fallback"),
        debug: root.querySelector("#ats-debug"),
        flow: root.querySelector("#ats-flow"),
        sort: root.querySelector("#ats-sort"),
      };
      this.#wire();
      return this.#panel;
    }

    static #wire() {
      const e = this.#els;
      e.provider.addEventListener("command", () => this.#onProviderChange());
      e.base.addEventListener("change", () => { PrefStore.set("baseURL", e.base.value.trim()); this.#refreshFlow(); });
      e.key.addEventListener("change", () => PrefStore.set("apiKey", e.key.value.trim()));
      e.model.addEventListener("command", () => PrefStore.set("model", e.model.value));
      e.gran.addEventListener("command", () => PrefStore.set("granularity", Number(e.gran.value)));
      e.out.addEventListener("command", () => PrefStore.set("outputMode", e.out.value));
      e.min.addEventListener("change", () => PrefStore.set("minGroupSize", Math.min(10, Math.max(1, Number(e.min.value) || 2))));
      e.payload.addEventListener("command", () => { PrefStore.set("payloadMode", e.payload.value); this.#refreshFlow(); });
      e.timeout.addEventListener("change", () => PrefStore.set("timeoutSec", Math.min(600, Math.max(10, Number(e.timeout.value) || 120))));
      e.reuse.addEventListener("command", () => PrefStore.set("reuseGroups", e.reuse.checked));
      e.fallback.addEventListener("command", () => PrefStore.set("heuristicFallback", e.fallback.checked));
      e.debug.addEventListener("command", () => PrefStore.set("debugLogging", e.debug.checked));
      e.fetchBtn.addEventListener("command", () => this.#fetchModels());
      e.sort.addEventListener("command", () => { this.#panel.hidePopup(); SortController.sort(); });
    }

    static #onProviderChange() {
      const id = this.#els.provider.value;
      const preset = ProviderHub.PRESETS[id];
      const currentBase = this.#els.base.value.trim();
      const isOtherPreset = Object.values(ProviderHub.PRESETS).some((p) => p.baseURL === currentBase);
      if (!currentBase || isOtherPreset) {
        this.#els.base.value = preset.baseURL;
        PrefStore.set("baseURL", preset.baseURL);
      }
      PrefStore.set("provider", id);
      this.#els.keyRow.style.display = preset.auth === false ? "none" : "";
      this.#refreshFlow();
    }

    static #status(text, kind = "") {
      const s = this.#els.status;
      s.textContent = text || "";
      s.className = `ats-status${kind ? " " + kind : ""}`;
    }

    static #refreshFlow() {
      const cfg = ProviderHub.cfg();
      const payload = { "title-url": "titles + URLs", "title-host": "titles + hostnames", "title": "titles only" }[cfg.payloadMode] || "titles + URLs";
      const local = /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(cfg.baseURL);
      this.#els.flow.textContent = `Sends ${payload} → ${cfg.baseURL || "(no base URL)"}${local ? " · stays on your machine" : " · ⚠ leaves your machine"}`;
      this.#els.flow.classList.toggle("ats-warn", !local && !!cfg.baseURL);
    }

    static #populateModels(models, currentModel) {
      const sel = this.#els.model;
      sel.textContent = "";
      if (!models.length) {
        const o = this.#h("option", { value: "" });
        o.textContent = "— no models fetched —";
        sel.append(o);
        return;
      }
      const ids = new Set();
      if (currentModel && !models.some((m) => m.id === currentModel)) {
        const o = this.#h("option", { value: currentModel });
        o.textContent = `${currentModel} (typed)`;
        sel.append(o);
        ids.add(currentModel);
      }
      for (const m of models) {
        const o = this.#h("option", { value: m.id });
        o.textContent = m.label || m.id;
        sel.append(o);
        ids.add(m.id);
      }
      sel.value = models.some((m) => m.id === currentModel) ? currentModel : (sel.firstElementChild?.value || "");
      PrefStore.set("model", sel.value);
    }

    static async #fetchModels() {
      const btn = this.#els.fetchBtn;
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = "Fetching…";
      const t0 = Date.now();
      try {
        const models = await ProviderHub.listModels();
        PrefStore.set("modelList", JSON.stringify(models));
        this.#populateModels(models, PrefStore.get("model"));
        this.#status(`✓ ${models.length} models · ${Date.now() - t0}ms`, "ok");
      } catch (err) {
        this.#status(`✗ ${err.message}${err.hint ? " — " + err.hint : ""}`, "err");
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    }

    static open(anchor) {
      const panel = this.#build();
      const e = this.#els;
      const cfg = PrefStore.all();
      e.provider.value = cfg.provider;
      e.base.value = cfg.baseURL;
      e.key.value = cfg.apiKey;
      e.gran.value = String(cfg.granularity);
      e.out.value = cfg.outputMode;
      e.min.value = String(cfg.minGroupSize);
      e.payload.value = cfg.payloadMode;
      e.timeout.value = String(cfg.timeoutSec);
      e.reuse.checked = cfg.reuseGroups;
      e.fallback.checked = cfg.heuristicFallback;
      e.debug.checked = cfg.debugLogging;
      e.keyRow.style.display = (ProviderHub.PRESETS[cfg.provider]?.auth === false) ? "none" : "";
      let cached;
      try { cached = JSON.parse(cfg.modelList || "[]"); } catch (_e2) { cached = []; }
      this.#populateModels(cached, cfg.model);
      this.#status("");
      this.#refreshFlow();
      panel.openPopup(anchor, "after_start", 6, 0, false, null);
    }
  }

  /* ══════════════════════════════════════════════════════════════
   * ButtonInjector — Sort + ⚙ buttons above the tab strip,
   * re-attached through workspace hooks + MutationObserver
   * ══════════════════════════════════════════════════════════════ */
  class ButtonInjector {
    static SORT_ID = "ai-tab-sorter-sort-btn";
    static GEAR_ID = "ai-tab-sorter-gear-btn";
    static #statusTimer = null;
    static #observer = null;
    static #reattachTimer = null;

    static anchors() {
      // 1) Current Zen vertical layout: the normal-tabs section of the active
      //    workspace strip (same container ATG inserts its groups into).
      try {
        const strip = window.gZenWorkspaces?.activeWorkspaceStrip;
        const sec = strip?.querySelector(".zen-workspace-normal-tabs-section");
        if (sec) return [sec];
      } catch (_e) { /* fall through */ }
      // 2) Any workspace strips present (Zen keeps inactive ones in DOM).
      const secs = document.querySelectorAll(".zen-workspace-normal-tabs-section");
      if (secs.length) return [secs[0]];
      // 3) Classic periphery (new-tab button container).
      const periphery = document.querySelector("#tabbrowser-arrowscrollbox-periphery");
      if (periphery) return [periphery];
      // 4) Last resort: the tabs container itself.
      const tabs = document.querySelector("#tabbrowser-tabs");
      return tabs ? [tabs] : [];
    }

    /** Locate a header "Clear"-style action button to sit beside (user request:
     *  Sort belongs next to Clear in the workspace header, not at strip bottom). */
    static findHeaderAction() {
      try {
        const strip = window.gZenWorkspaces?.activeWorkspaceStrip
          || document.querySelector(".zen-workspace-normal-tabs-section")?.parentElement;
        if (!strip) return null;
        for (const el of strip.querySelectorAll("button, toolbarbutton, label, span")) {
          const t = (el.getAttribute("label") || el.textContent || "").trim().toLowerCase();
          if (t && (t === "clear" || t === "clear all" || t === "clean")) return el;
        }
      } catch (_e) { /* fall through */ }
      return null;
    }

    static ensure() {
      if (!PrefStore.get("enabled") || !PrefStore.get("showButtons")) return;

      // Where a button wants to live this pass: right after the header Clear
      // button → else just above the tabs section (under the header row) →
      // else the legacy periphery/tabs fallbacks.
      const placement = () => {
        const clearBtn = this.findHeaderAction();
        if (clearBtn?.isConnected) return { insert: (b) => clearBtn.after(b) };
        const sec = document.querySelector(".zen-workspace-normal-tabs-section");
        if (sec?.parentElement) return { insert: (b) => sec.parentElement.insertBefore(b, sec) };
        const periphery = document.querySelector("#tabbrowser-arrowscrollbox-periphery");
        if (periphery) return { insert: (b) => periphery.before(b) };
        const tabs = document.querySelector("#tabbrowser-tabs");
        if (tabs) return { insert: (b) => tabs.append(b) };
        return null;
      };

      const place = (id, tooltip, onClick) => {
        let btn = document.getElementById(id);
        const spot = placement();
        if (!spot) {
          if (!this.#warnedNoAnchor) {
            this.#warnedNoAnchor = true;
            console.info(LOG_PREFIX, "no tab-strip anchor found yet — will keep retrying");
          }
          return;
        }
        if (!btn || !btn.isConnected) {
          try {
            btn = window.MozXULElement.parseXULToFragment(
              `<toolbarbutton id="${id}" class="ai-tab-sorter-btn" tooltiptext="${tooltip}"/>`
            ).firstChild;
            btn.addEventListener("command", onClick);
          } catch (e) { log("button injection failed", e); return; }
        }
        // (Re)position: Zen rebuilds strips; also upgrades old bottom placement.
        try { spot.insert(btn); } catch (_e) { /* already in place */ }
      };

      place(this.SORT_ID, "AI Tab Sorter — sort tabs into groups (select tabs to sort only them)",
        () => SortController.sort());
      // Gear follows the sort button.
      const sortBtn = document.getElementById(this.SORT_ID);
      if (sortBtn?.isConnected) {
        let gear = document.getElementById(this.GEAR_ID);
        if (!gear || !gear.isConnected) {
          try {
            gear = window.MozXULElement.parseXULToFragment(
              `<toolbarbutton id="${this.GEAR_ID}" class="ai-tab-sorter-btn" tooltiptext="AI Tab Sorter settings"/>`
            ).firstChild;
            gear.addEventListener("command", () => SettingsPanel.open(gear));
            sortBtn.after(gear);
          } catch (e) { log("gear button injection failed", e); }
        } else {
          try { sortBtn.after(gear); } catch (_e) { /* in place */ }
        }
      }
    }

    static #warnedNoAnchor = false;

    static setSorting(on, tabCount = 0) {
      const btn = document.getElementById(this.SORT_ID);
      if (!btn) return;
      btn.classList.toggle("ai-sorting", !!on);
      if (on) btn.setAttribute("tooltiptext", `Sorting ${tabCount} tabs…`);
    }

    static setStatus(state, message, ms = 3000) {
      const btn = document.getElementById(this.SORT_ID);
      if (!btn) { console.info(LOG_PREFIX, message); return; }
      clearTimeout(this.#statusTimer);
      btn.classList.remove("ats-done", "ats-err");
      btn.setAttribute("tooltiptext", message);
      if (state) btn.classList.add(state === "done" ? "ats-done" : "ats-err");
      this.#statusTimer = setTimeout(() => {
        btn.classList.remove("ats-done", "ats-err");
        btn.setAttribute("tooltiptext", "AI Tab Sorter — sort tabs into groups (select tabs to sort only them)");
      }, ms);
    }

    static reattachHooks() {
      // 1) Zen workspace hooks — strip rebuilds destroy injected buttons
      try {
        const ws = window.gZenWorkspaces;
        if (ws && !ws.__aiTabSorterHooked) {
          ws.__aiTabSorterHooked = true;
          for (const name of ["onTabBrowserInserted", "updateTabsContainers", "changeWorkspace"]) {
            const orig = ws[name];
            if (typeof orig !== "function") continue;
            ws[name] = function hooked(...args) {
              const r = orig.apply(this, args);
              setTimeout(() => ButtonInjector.ensure(), 150);
              return r;
            };
          }
        }
      } catch (e) { log("workspace hook failed", e); }

      // 2) MutationObserver — belt & braces for any strip restructuring
      try {
        const tc = document.getElementById("tabbrowser-tabs");
        if (tc && !this.#observer) {
          this.#observer = new MutationObserver(() => {
            clearTimeout(this.#reattachTimer);
            this.#reattachTimer = setTimeout(() => this.ensure(), 400);
          });
          this.#observer.observe(tc, { childList: true, subtree: true });
        }
      } catch (e) { log("observer setup failed", e); }
    }
  }

  /* ══════════════════════════════════════════════════════════════
   * SettingsPageEnhancer — puts ⟳ Fetch Models INSIDE the Sine mod
   * settings panel, right next to the "Model name" field (user-facing
   * request). Runs only in preferences.xhtml. Sine gives each pref row
   * id = pref property; string prefs save on the input's `change` event,
   * so picking a model reuses Sine's own save path + restart toast.
   * ══════════════════════════════════════════════════════════════ */
  class SettingsPageEnhancer {
    static MODEL_ROW_ID = "mod.aitabsort.model";
    static #timer = null;
    static #enhanced = new WeakSet();

    static init() {
      // The Mods section builds lazily — poll for the row for up to 2 min.
      let tries = 0;
      this.#timer = setInterval(() => {
        tries += 1;
        const row = document.getElementById(this.MODEL_ROW_ID);
        if (row) {
          clearInterval(this.#timer);
          this.#enhance(row);
        } else if (tries > 300) {
          clearInterval(this.#timer);
        }
      }, 400);
      // Zen rebuilds rows when switching settings categories.
      try {
        const obs = new MutationObserver(() => {
          const row = document.getElementById(this.MODEL_ROW_ID);
          if (row && !this.#enhanced.has(row)) this.#enhance(row);
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
      } catch (_e) { /* non-fatal */ }
    }

    static #enhance(row) {
      if (this.#enhanced.has(row) || !row.isConnected) return;
      this.#enhanced.add(row);
      try {
        const btn = document.createXULElement("toolbarbutton");
        btn.setAttribute("label", "⟳ Fetch Models");
        btn.setAttribute("tooltiptext", "Query the provider's model list and pick one");
        btn.style.cssText = "min-height:28px;padding:2px 8px;cursor:pointer;";
        btn.addEventListener("command", () => this.#fetch(row, btn));
        row.appendChild(btn);
        console.info(LOG_PREFIX, "Fetch Models added to settings panel (Model row)");
      } catch (e) { log("settings enhancer failed", e); }
    }

    static async #fetch(row, btn) {
      const oldLabel = btn.getAttribute("label");
      btn.setAttribute("label", "Fetching…");
      try {
        const models = await ProviderHub.listModels();
        PrefStore.set("modelList", JSON.stringify(models));
        btn.setAttribute("label", `✓ ${models.length} models — pick one ▾`);
        this.#showPicker(row, btn, models);
      } catch (err) {
        btn.setAttribute("label", `✗ ${err.message}`);
        setTimeout(() => btn.setAttribute("label", oldLabel), 4000);
        console.error(LOG_PREFIX, "settings Fetch Models failed:", err);
        return;
      }
      setTimeout(() => btn.setAttribute("label", oldLabel), 6000);
    }

    static #showPicker(row, btn, models) {
      const picker = document.createXULElement("panel");
      picker.setAttribute("type", "arrow");
      picker.style.cssText = "-moz-appearance:none;appearance:none;";
      const box = document.createXULElement("vbox");
      box.style.cssText = "max-height:300px;overflow:auto;min-width:260px;padding:4px;";
      for (const m of models) {
        const item = document.createXULElement("toolbarbutton");
        item.setAttribute("label", m.label || m.id);
        item.style.cssText = "padding:3px 8px;text-align:start;cursor:pointer;";
        item.addEventListener("command", () => {
          this.#applyModel(row, m.id);
          picker.hidePopup();
          picker.remove();
        });
        box.appendChild(item);
      }
      picker.appendChild(box);
      document.documentElement.appendChild(picker);
      picker.addEventListener("popuphidden", () => picker.remove(), { once: true });
      picker.openPopup(btn, "after_start", 0, 0, false, null);
    }

    static #applyModel(row, modelId) {
      PrefStore.set("model", modelId);
      // Drive Sine's own save path so the input UI + pref stay in sync.
      try {
        const input = row.querySelector("input[type=text], input:not([type])");
        if (input) {
          input.value = modelId;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } catch (_e) { /* pref already set directly */ }
    }
  }

  /* ══════════════════════════════════════════════════════════════
   * Bootstrap — dependency-wait init
   * ══════════════════════════════════════════════════════════════ */
  class Bootstrap {
    static waitForDeps(timeoutMs = 15000) {
      return new Promise((resolve) => {
        const t0 = Date.now();
        const tick = () => {
          if (typeof gBrowser !== "undefined" && typeof gZenWorkspaces !== "undefined") return resolve(true);
          if (Date.now() - t0 > timeoutMs) return resolve(false);
          setTimeout(tick, 250);
        };
        tick();
      });
    }

    static async init() {
      if (typeof document === "undefined") return; // Node unit-test context
      if (IS_PREFS) {
        // Settings window: no tab strip — enhance the Sine prefs panel instead.
        globalThis.aiTabSorter = { version: VERSION, prefs: PrefStore, providers: ProviderHub };
        SettingsPageEnhancer.init();
        console.info(LOG_PREFIX, `settings-page enhancer active (v${VERSION})`);
        return;
      }
      if (document.readyState === "loading") {
        await new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));
      }
      const ready = await this.waitForDeps();
      if (!ready) {
        console.warn(LOG_PREFIX, "gBrowser/gZenWorkspaces never appeared — mod inert this session");
        return;
      }

      // Zen's built-in AI grouping fights mods that manage groups — warn.
      try {
        if (Services.prefs.getBoolPref("browser.tabs.groups.smart.enabled", false)) {
          console.warn(LOG_PREFIX, "browser.tabs.groups.smart.enabled is TRUE — Zen's built-in AI grouping can conflict with this mod. Set it to false in about:config.");
        }
      } catch (_e) { /* noop */ }

      if (typeof gBrowser.addTabGroup !== "function") {
        console.warn(LOG_PREFIX, "gBrowser.addTabGroup missing — install Advanced Tab Groups (github.com/Vertex-Mods/Advanced-Tab-Groups) for the group UI.");
      }

      if (PrefStore.get("enabled") && PrefStore.get("showButtons")) {
        ButtonInjector.ensure();
        ButtonInjector.reattachHooks();
        // Workspace strips can mount well after startup — keep retrying.
        for (const delay of [500, 1000, 3000, 7000, 15000]) {
          setTimeout(() => ButtonInjector.ensure(), delay);
        }
      } else {
        console.info(LOG_PREFIX, `buttons hidden (enabled=${PrefStore.get("enabled")}, showButtons=${PrefStore.get("showButtons")}) — toggle in Sine mod preferences`);
      }

      globalThis.aiTabSorter = {
        version: VERSION,
        sort: () => SortController.sort(),
        openSettings: (btn) => SettingsPanel.open(btn || document.getElementById(ButtonInjector.GEAR_ID)),
        isSorting: () => SortController.isSorting(),
        prefs: PrefStore,
        providers: ProviderHub,
        buttons: ButtonInjector,
      };
      console.info(LOG_PREFIX, `initialized v${VERSION} — buttons: ${document.getElementById(ButtonInjector.SORT_ID) ? "injected" : "pending anchor"}`);
      log("initialized v" + VERSION);
    }
  }

  // Node test seam — pure modules importable without a browser.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      VERSION, PrefStore, ProviderHub, PromptBuilder,
      ResponseParser, HeuristicSorter,
    };
  }

  if (typeof document !== "undefined") {
    Bootstrap.init();
  }
})();
