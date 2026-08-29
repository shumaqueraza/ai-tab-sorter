// ==UserScript==
// @name           AI Tab Sorter
// @ignorecache
// ==/UserScript==
/*
 * AI Tab Sorter — on-demand, AI-powered tab grouping for Zen Browser.
 * v0.1.5 — Apache-2.0 licensed.
 *
 * Sort appears as a small twin of Zen's native "Clear" button (left of it,
 * in the workspace tabs header). Click = categorize the workspace's tabs
 * with any provider (Ollama / LM Studio / llama.cpp / OpenAI / OpenRouter /
 * Groq / Together / Mistral / Gemini / any OpenAI-compatible URL) and group
 * them with Zen's native tab groups. Strictly on-demand. Never closes tabs.
 *
 * All settings live in the Sine mod preferences (Zen Settings → mods →
 * AI Tab Sorter): this mod injects a model dropdown + ⟳ Fetch Models
 * button into that panel. No extra buttons are added to the tab strip.
 *
 * Engineering note: the twin-button placement (clone of the Clear control)
 * and the native group reconcile engine (ungroupTab / addTabGroup /
 * addTabs / removeTabGroup with the option-shape ladder) are adapted from
 * the open-source Zen mod "tidy" — battle-tested against Zen's DOM.
 *
 * Design docs: docs/RESEARCH.md · Providers: docs/PROVIDERS.md
 */

(() => {
  "use strict";

  const VERSION = "0.1.5";
  const PREF_BRANCH = "mod.aitabsort.";
  const LOG_PREFIX = "[AITabSorter]";

  // Sine renders its mod-preferences UI inside the about:preferences tab
  // (and, on some builds, a chrome:// preferences window). Match both.
  const IS_PREFS = typeof location !== "undefined"
    && /^(about:preferences|chrome:\/\/browser\/content\/preferences)/.test(location.href);

  // Services is on the global of browser.xhtml but NOT reliably present on
  // about:preferences documents — resolve it once, tolerantly (also lets the
  // Node unit-test context import this file without a browser).
  const SVCS = (() => {
    try { if (typeof Services !== "undefined" && Services) return Services; } catch (_e) { /* not defined */ }
    try {
      if (typeof ChromeUtils !== "undefined" && ChromeUtils) {
        return ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services;
      }
    } catch (_e) { /* unreachable */ }
    return null;
  })();

  const log = (...args) => {
    try {
      if (SVCS && SVCS.prefs.getBoolPref(PREF_BRANCH + "debugLogging", false)) {
        console.log(LOG_PREFIX, ...args);
      }
    } catch (_e) { /* prefs unavailable */ }
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
      collapseGroups: true,
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
        const svc = SVCS.prefs;
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
        const svc = SVCS.prefs;
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
        if (!cfg.apiKey) throw new ProviderError("Gemini needs an API key.", "Get one at aistudio.google.com and paste it into the settings.");
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
      if (!cfg.model) throw new ProviderError("No model selected.", "Open Zen Settings → mods → AI Tab Sorter, click ⟳ Fetch Models and pick a model.");
      const maxTokens = Math.max(512, (opts.tabCount || 16) * 32);
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
      // Full context mode: URL path is EVIDENCE for the subject
      // (github.com/alice/mechanics-solutions → "Mechanics Solutions"),
      // and the meta description says what the page is actually about.
      const desc = String(data.description || "").trim();
      return `Title: ${title} | Host: ${host} | URL: ${String(data.url || "").slice(0, 200)}`
        + (desc ? ` | About: ${desc}` : "");
    }

    /** Build the batch prompt for one chunk. */
    static build(tabDataList, existingGroupLabels, cfg) {
      const mode = cfg.outputMode === "json";
      const tabLines = tabDataList
        .map((d, i) => `${i + 1}. ${this.payloadLine(d, cfg.payloadMode)}`)
        .join("\n");
      const existingNames = (existingGroupLabels || []).filter(Boolean);
      const existing = existingNames.length
        ? `GROUPS ALREADY IN THE STRIP: ${existingNames.join(" | ")}. When a tab belongs to one of them, output that EXACT full name (keeping any " / " part, identical spelling) — never a variation, never a shortened form.`
        : "GROUPS ALREADY IN THE STRIP: none — design a fresh taxonomy.";

      const rules = [
        "GROUP BY MEANING, NOT BY WEBSITE. What matters is what each tab is FOR — the project, subject, task or purpose it serves. Tabs on different sites that serve the same purpose MUST receive the same group name (a YouTube lecture, a PDF and a GitHub repo for the same course belong together).",
        "NEVER use a bare site/brand name as a group (\"GitHub\", \"Youtube\", \"Chatgpt\", \"Google\", \"Reddit\", \"Docs\", \"Search\", \"Pdf\"). A site name is allowed only when the tabs are ABOUT that site itself (its settings, its account, its administration).",
        "NAMING: name groups after the shared subject/project/task — e.g. \"Engineering Mechanics / Lectures\", \"Engineering Mechanics / Problem Sets\", \"Thesis Research\", \"Japan Trip / Booking\", \"Rust Learning / Tutorials\".",
        `HIERARCHY: use two-level names "Topic / Detail" when a topic has enough tabs to split into details (at least 2 tabs per detail group); use plain "Topic" when it does not. Max 3 words per level, Title Case. Sibling groups must repeat the identical Topic spelling so they sort together. ${this.GRANULARITY[cfg.granularity] || this.GRANULARITY[3]}`,
        "READ THE URL AS EVIDENCE, not as the label: github.com/alice/mechanics-solutions means the subject is mechanics solutions — the group is \"Engineering Mechanics / Solutions\", never \"Github\". File names and URL paths usually contain the real topic.",
        existing,
        "Every tab gets exactly one group name; tabs serving the same purpose MUST receive byte-identical names. Never echo these instructions as a name.",
      ];

      const example = [
        "Example —",
        "Tabs:",
        "1. Title: Lecture 3 — kinematics | Host: university.edu",
        "2. Title: mechanics-solutions · GitHub | Host: github.com",
        "3. Title: ES201 question paper | Host: university.edu",
        "4. Title: kinematics worked problems | Host: youtube.com",
        "5. Title: ChatGPT | Host: chatgpt.com",
        "6. Title: Claude | Host: claude.ai",
        "Correct output (lines mode):",
        "Engineering Mechanics / Lectures",
        "Engineering Mechanics / Problem Sets",
        "Engineering Mechanics / Problem Sets",
        "Engineering Mechanics / Lectures",
        "AI Chat Assistants",
        "AI Chat Assistants",
      ].join("\n");

      let output;
      if (mode) {
        output = [
          `Output ONLY a JSON array with exactly ${tabDataList.length} entries, one per tab, in input order:`,
          '[{"i":1,"c":"Engineering Mechanics / Lectures"}, {"i":2,"c":"AI Chat Assistants"}]',
          "No markdown, no code fences, no commentary — JSON only.",
        ].join("\n");
      } else {
        output = [
          `Output EXACTLY ${tabDataList.length} lines — line i is the group of tab i, same order as the input. Each line is "Topic" or "Topic / Detail" — nothing else, no numbering, no commentary.`,
        ].join("\n");
      }

      const custom = String(cfg.customPrompt || "").trim();
      const customSection = custom
        ? (custom.includes("{TAB_DATA_LIST}") || custom.includes("{EXISTING_CATEGORIES_LIST}")
            ? custom.replace(/{EXISTING_CATEGORIES_LIST}/g, existing).replace(/{TAB_DATA_LIST}/g, tabLines)
            : `Additional user instructions (high priority):\n${custom}`)
        : "";

      const parts = [
        "You are a professional research librarian organizing a researcher's browser session. Group the numbered tabs below by what they are actually for, so that related work sits together.",
        customSection,
        "Rules:",
        ...rules.map((r) => `- ${r}`),
        example,
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
      s = s.replace(/^(category|group|topic|label|title|tab|name)\s*[:-]\s*/i, "");
      s = s.replace(/[.\s]+$/, "");
      s = s.replace(/\s+/g, " ").trim();
      if (!s) return "";
      // Two-level names: normalize "a/b", "a // b", "a - b - c" spacing so
      // sibling groups compose identical "Topic / Detail" strings.
      if (s.includes("/") && !/^https?:/i.test(s)) s = s.replace(/\s*\/\s*/g, " / ");
      s = s.split(" ").slice(0, 6).join(" ");            // cap: "Topic words / Detail words"
      if (s.length > 50) s = s.slice(0, 50).trim();
      const titled = s.replace(/\b\p{L}[\p{L}\p{N}'&.-]*/gu, (w) =>
        w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)
      );
      // Instruction-echo junk from weak/reasoning models ("We Need To
      // Categorize", "Thus Tabs 1-3 Are", "Output", …) → no answer at all,
      // so the tab is simply left ungrouped instead of getting a garbage
      // one-tab group.
      if (/^(we |lets |let's|let us|thus |so |now |first[,.]|then |output|input|here |the (tabs|following|user)|note that|based on|to (do|categorize|output)|final answer)/i.test(titled)) return "";
      return titled;
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
   * TabCollector — workspace-aware snapshot (tidy-style scoping)
   * ══════════════════════════════════════════════════════════════ */
  class TabCollector {
    static alive(tab) {
      try { return !!tab && tab.isConnected && !tab.closing; } catch (_e) { return false; }
    }

    static valid(tab) {
      if (!this.alive(tab)) return false;
      if (tab.pinned) return false;
      if (tab.hasAttribute("zen-essential")) return false;
      if (tab.hasAttribute("zen-empty-tab")) return false;
      const g = tab.closest?.("tab-group");
      if (g && g.hasAttribute("split-view-group")) return false;
      try {
        const spec = tab.linkedBrowser?.currentURI?.spec || "";
        // Only truly internal chrome pages are skipped. Local files
        // (file://) and reader-mode articles are REAL content — the user
        // expects them to be grouped too.
        if (/^(chrome|resource|moz-extension|data|blob):/i.test(spec)) return false;
        if (/^about:(blank|newtab|new-tab|home|privatebrowsing|sessionrestore|welcome|session-history|profiling)\b/i.test(spec)) return false;
      } catch (_e) { /* unreadable URI — still sortable by title */ }
      return true;
    }

    /** The active workspace element (tidy's ladder — one <zen-workspace>
     *  per workspace exists in the DOM; only one is [active]). */
    static activeWorkspaceEl() {
      return (
        window.gZenWorkspaces?.activeWorkspaceElement
        || document.querySelector("zen-workspace[active]")
        || (typeof gBrowser !== "undefined" ? gBrowser.selectedTab?.closest?.("zen-workspace") : null)
        || document.querySelector("zen-workspace")
      );
    }

    /** The active workspace's tab section. */
    static activeSection() {
      return (
        (typeof gBrowser !== "undefined" ? gBrowser.selectedTab?.closest?.(".zen-workspace-tabs-section") : null)
        || document.querySelector(".zen-workspace-tabs-section[active]")
        || document.querySelector(".zen-workspace-tabs-section")
        || document.querySelector(".zen-workspace-normal-tabs-section")
      );
    }

    /**
     * Sort targets: multi-selected tabs if ≥2 selected, else ALL normal
     * tabs of the ACTIVE workspace (already-grouped tabs included — the
     * engine reconciles groups in place, it does not duplicate them).
     */
    static collect() {
      let selected = [];
      try {
        selected = (gBrowser.selectedTabs || []).filter((t) => this.valid(t));
      } catch (_e) { /* no multi-selection API */ }
      if (selected.length > 1) return selected;

      let candidates = [];
      const section = this.activeSection();
      if (section) candidates = [...section.querySelectorAll("tab, .tabbrowser-tab")];
      if (!candidates.length) {
        try { candidates = [...gBrowser.tabs]; } catch (_e) { /* nothing */ }
      }
      return candidates.filter((t) => this.valid(t));
    }

    /** Extract {title, hostname, url, description} for one tab. */
    static describe(tab) {
      let title = "";
      try { title = tab.getAttribute("label") || tab.querySelector(".tab-label, .tab-text")?.textContent || ""; } catch (_e) { /* noop */ }
      let url = "", hostname = "", description = "";
      try {
        const spec = tab.linkedBrowser?.currentURI?.spec || "";
        if (spec) {
          const u = new URL(spec);
          url = u.href;
          hostname = u.hostname;
          if (u.protocol === "file:") {
            // Local files: the filename is the "site" the model clusters on.
            const base = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || "")
              .replace(/\.[a-z0-9]+$/i, "");
            if (base) hostname = base;
          }
        }
      } catch (_e) { /* keep empty */ }
      // Meta description = what the page is ABOUT — the single richest hint
      // for conceptual grouping (Darsh's extractor). Best effort: privileged
      // pages and cross-origin frames simply yield "".
      try {
        const doc = tab.linkedBrowser?.contentDocument;
        const meta = doc?.querySelector?.('meta[name="description"]')
          || doc?.querySelector?.('meta[property="og:description"]');
        if (meta) description = String(meta.getAttribute?.("content") || "").trim().slice(0, 160);
      } catch (_e) { /* unreadable document */ }
      const clean = String(title).trim();
      const fallback = hostname && hostname !== "localhost" ? hostname.replace(/^www\./, "") : "";
      return {
        title: !clean || clean === "New Tab" || clean === "Loading..." || /^https?:\/\//i.test(clean)
          ? (fallback || clean || "Untitled")
          : clean,
        hostname,
        url,
        description,
      };
    }

    /** Named native groups in the active section: Map(normLabel → el). */
    static sectionGroups() {
      const map = new Map();
      const section = this.activeSection() || document;
      for (const g of section.querySelectorAll("tab-group")) {
        if (g.hasAttribute("split-view-group")) continue;
        const label = String(g.label ?? g.getAttribute("label") ?? "").trim();
        if (!label) continue;
        const key = label.toLowerCase();
        if (!map.has(key)) map.set(key, g);
      }
      return map;
    }

    /** Existing-group labels for the reuse hint in the prompt. */
    static existingLabels() {
      return [...this.sectionGroups().values()]
        .map((g) => String(g.label ?? g.getAttribute("label") ?? "").trim())
        .filter(Boolean);
    }
  }

  /* ══════════════════════════════════════════════════════════════
   * GroupingEngine — Zen native group reconcile (engine adapted from
   * the "tidy" Zen mod: ungroupTab → addTabGroup ladder → addTabs →
   * removeTabGroup; no invented APIs, everything verified working).
   * ══════════════════════════════════════════════════════════════ */
  class GroupingEngine {
    // Firefox/Zen's valid native tab-group color names (Darsh's set).
    static PALETTE = ["blue", "cyan", "green", "yellow", "orange", "red", "pink", "purple", "gray"];

    static getGroupTabs(el) {
      try { return el.tabs ? [...el.tabs] : [...el.querySelectorAll("tab, .tabbrowser-tab")]; }
      catch (_e) { return []; }
    }

    static hasLiveTabs(el) {
      return this.getGroupTabs(el).some((t) => TabCollector.alive(t));
    }

    /** Expand a collapsed group (moving tabs into a collapsed group is
     *  unreliable — Darsh expands first, so do we). */
    static expand(el) {
      try {
        if (el.getAttribute("collapsed") === "true") {
          el.setAttribute("collapsed", "false");
          el.querySelector(".tab-group-label")?.setAttribute("aria-expanded", "true");
        }
      } catch (_e) { /* non-fatal */ }
    }

    /** Collapse a group for a tidy strip (only groups we manage). */
    static collapse(el) {
      try {
        if (el.getAttribute("collapsed") !== "true") {
          el.setAttribute("collapsed", "true");
          el.querySelector(".tab-group-label")?.setAttribute("aria-expanded", "false");
        }
      } catch (_e) { /* non-fatal */ }
    }

    static dissolve(el, reason) {
      try { el.label = ""; el.removeAttribute?.("label"); } catch (_e) { /* non-fatal */ }
      for (const tab of this.getGroupTabs(el).filter((t) => TabCollector.alive(t))) {
        if (typeof gBrowser.ungroupTab !== "function") break;
        try { gBrowser.ungroupTab(tab); }
        catch (e) { log("ungroupTab failed while dissolving:", reason, e?.message); }
      }
      if (this.hasLiveTabs(el)) return; // teardown deferred; sweep finishes it
      try { gBrowser.removeTabGroup?.(el); }
      catch (e) { log("removeTabGroup failed while dissolving:", reason, e?.message); }
      if (el.isConnected) { try { el.remove(); } catch (_e) { /* already detached */ } }
    }

    /** Create one fresh native group (tidy's option-shape ladder — the
     *  first shape that doesn't throw wins; label/color re-set explicitly
     *  because some builds ignore the options). */
    static create(members, label, color) {
      if (typeof gBrowser.ungroupTab === "function") {
        for (const tab of members) {
          if (!tab.group) continue;
          try { gBrowser.ungroupTab(tab); }
          catch (e) { log("ungroupTab failed before creating group:", label, e?.message); }
        }
      }
      const anchor = members[0];
      const attempts = [
        { label, color, insertBefore: anchor },
        { label, color },
        { label, color, isUserTriggered: true },
      ];
      for (const options of attempts) {
        try {
          const group = gBrowser.addTabGroup(members, options);
          if (group) {
            try {
              if (label) { group.label = label; group.setAttribute("label", label); }
              if (color) { group.color = color; group.setAttribute("color", color); }
            } catch (_e) { /* non-fatal */ }
            return group;
          }
        } catch (e) {
          log(`addTabGroup attempt failed for "${label}":`, e?.message);
        }
      }
      return null;
    }

    /** Dissolve any group left empty, scoped to the active section. */
    static removeEmpty() {
      const section = TabCollector.activeSection() || document;
      let removed = 0;
      for (const el of [...section.querySelectorAll("tab-group")]) {
        if (this.hasLiveTabs(el)) continue;
        try {
          if (typeof gBrowser.removeTabGroup === "function") gBrowser.removeTabGroup(el);
          else el.remove();
          removed++;
        } catch (e) { log("empty-group sweep failed:", e?.message); }
      }
      return removed;
    }

    /**
     * Apply a plan [{name, tabs}] by reconciling against current groups:
     * groups whose name survives keep position + color (only changed tabs
     * move in via addTabs), new groups are created, abandoned groups
     * dissolve. Returns {moved, created, reused, skipped}.
     */
    static apply(plan, cfg = {}) {
      const stats = { moved: 0, created: 0, reused: 0, skipped: 0 };
      if (typeof gBrowser.addTabGroup !== "function") {
        throw new Error("gBrowser.addTabGroup is unavailable in this Zen build.");
      }
      const minSize = Math.max(1, Number(cfg.minGroupSize) || 1);
      const reuse = cfg.reuseGroups !== false;

      // Existing groups derived from the plan's own tabs (a tab that sits
      // in a group whose name survives keeps that group in place).
      const existing = new Map(); // normName → el
      for (const group of plan) {
        for (const tab of group.tabs) {
          if (!TabCollector.alive(tab)) continue;
          const el = tab.group;
          if (!el) continue;
          const name = String(el.label ?? el.getAttribute("label") ?? "").trim().toLowerCase();
          if (name && !existing.has(name)) existing.set(name, el);
        }
      }
      // When reuse is on, named groups in the section are also candidates.
      if (reuse) {
        for (const [name, el] of TabCollector.sectionGroups()) {
          if (!existing.has(name)) existing.set(name, el);
        }
      }

      // Dissolve abandoned groups BEFORE building, so stale labelled husks
      // never coexist with the fresh layout (avoids the re-sort flicker).
      const planNames = new Set(plan.map((g) => g.name.toLowerCase()));
      for (const [name, el] of existing) {
        if (planNames.has(name)) continue;
        if (!el.isConnected) continue;
        // Only dissolve groups that actually hold any of our tabs, or (with
        // reuse on) empty husks; never touch groups we know nothing about.
        const holdsPlanTabs = plan.some((g) => g.tabs.some((t) => t.group === el));
        if (!holdsPlanTabs && this.hasLiveTabs(el)) continue;
        log("dissolving abandoned group:", name);
        this.dissolve(el, "abandoned by plan");
      }

      const usedColors = new Set([...existing.values()]
        .filter((el) => el.isConnected)
        .map((el) => String(el.color ?? el.getAttribute("color") ?? "")));
      let paletteIdx = 0;
      const nextColor = () => {
        let color;
        do { color = this.PALETTE[paletteIdx++ % this.PALETTE.length]; }
        while (usedColors.has(color) && paletteIdx <= this.PALETTE.length * 2);
        usedColors.add(color);
        return color;
      };

      const applied = new Map(); // normName → group el (for the collapse pass)
      // Create in NAME order so two-level siblings ("Topic / A", "Topic / B")
      // end up adjacent in the strip — the closest thing to nested groups
      // Firefox's flat tab-group model allows.
      const ordered = [...plan].sort((a, b) => a.name.localeCompare(b.name));
      for (const group of ordered) {
        const live = group.tabs.filter((t) => TabCollector.alive(t));
        if (!live.length) continue;
        const el = existing.get(group.name.toLowerCase());

        if (el?.isConnected && typeof el.addTabs === "function") {
          // ── reuse in place: move in only the tabs not already here ──
          const toAdd = live.filter((tab) => tab.group !== el);
          if (toAdd.length) {
            this.expand(el); // collapsed groups swallow addTabs silently
            try {
              el.addTabs(toAdd);
              stats.moved += toAdd.length;
              log(`reused group "${group.name}" in place (+${toAdd.length} tabs)`);
            } catch (e) {
              log(`addTabs failed for "${group.name}":`, e?.message, "— creating a fresh group instead");
              const created = this.create(live, group.name, nextColor());
              if (created) { stats.created++; applied.set(group.name.toLowerCase(), created); } else { stats.skipped += live.length; }
            }
          } else {
            log(`group "${group.name}" already holds its tabs — nothing to move`);
          }
          stats.reused++;
          applied.set(group.name.toLowerCase(), el);
          continue;
        }

        if (live.length < minSize) {
          log(`group "${group.name}" has ${live.length} tab(s) < min ${minSize} — left ungrouped`);
          stats.skipped += live.length;
          continue;
        }

        const created = this.create(live, group.name, nextColor());
        if (created) {
          stats.created++;
          applied.set(group.name.toLowerCase(), created);
          log(`created group "${group.name}" (${live.length} tabs)`);
        } else {
          log(`FAILED to create group "${group.name}" (${live.length} tabs) — tabs left as-is`);
          stats.skipped += live.length;
        }
      }

      // Post-pass: collapse everything we built for a tidy strip.
      if (cfg.collapseGroups) {
        for (const el of applied.values()) {
          if (el?.isConnected) this.collapse(el);
        }
      }

      // Sweep empty husks (deferred teardowns land here), twice for safety.
      this.removeEmpty();
      setTimeout(() => this.removeEmpty(), 400);
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
      return typeof gBrowser !== "undefined" && typeof gBrowser.addTabGroup === "function";
    }

    static async sort() {
      if (this.#sorting) { log("sort already running"); return; }
      if (!this.capability()) {
        SortButton.setStatus("err", "This Zen build has no tab-group API — cannot sort", 6000);
        return;
      }
      const tabs = TabCollector.collect();
      if (tabs.length < 2) {
        SortButton.setStatus("err", "Need at least 2 sortable tabs (multi-select to sort a subset)", 5000);
        return;
      }

      this.#sorting = true;
      SortButton.setSorting(true, tabs.length);
      const t0 = Date.now();
      try {
        const cfg = ProviderHub.cfg();
        const existingLabels = TabCollector.existingLabels();

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
              SortButton.setStatus("err", `${e.message}${e.hint ? " — " + e.hint : ""}`, 8000);
              return;
            }
            categories = null;
            usedFallback = true;
          }
        } else {
          log("no model configured — using heuristic mode");
          usedFallback = true;
        }

        if (!categories) {
          const data = tabs.map((t) => TabCollector.describe(t));
          categories = HeuristicSorter.group(data, PrefStore.get("minGroupSize"));
        }

        // Build the plan: category → [tabs]; null/"Uncategorized" tabs stay ungrouped.
        const byCategory = new Map();
        let unclassified = 0;
        for (let i = 0; i < tabs.length; i++) {
          const cat = categories[i];
          if (!cat || cat === "Uncategorized") { unclassified++; continue; }
          if (!byCategory.has(cat)) byCategory.set(cat, []);
          byCategory.get(cat).push(tabs[i]);
        }
        const plan = [...byCategory.entries()].map(([name, groupTabs]) => ({ name, tabs: groupTabs }));

        if (!plan.length) {
          SortButton.setStatus("err", `No groups found for ${tabs.length} tabs (${unclassified} unclassified)`, 5000);
          console.info(LOG_PREFIX, `sort produced no plan`, { tabs: tabs.length, unclassified });
          return;
        }

        const stats = GroupingEngine.apply(plan, cfg);
        const ms = Date.now() - t0;
        const total = stats.created + stats.reused;
        const groupsWord = total === 1 ? "group" : "groups";
        SortButton.setStatus(
          "done",
          `${tabs.length} tabs → ${total} ${groupsWord} in ${(ms / 1000).toFixed(1)}s${usedFallback ? " (offline mode)" : ""}`,
          4000
        );
        console.info(LOG_PREFIX, `sorted ${tabs.length} tabs →`, { ...stats, unclassified }, `${ms}ms`);
      } catch (e) {
        console.error(LOG_PREFIX, "sort failed:", e);
        SortButton.setStatus("err", `Sort failed: ${e.message}`, 8000);
      } finally {
        this.#sorting = false;
        SortButton.setSorting(false);
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════
   * SortButton — a twin of Zen's native "Clear" control, inserted to
   * its LEFT inside the same header row (pattern adapted from "tidy":
   * clone Clear's tag + classes, never keep Clear's own control class
   * or Zen's first-match querySelector steals Clear's icon/styling).
   * ══════════════════════════════════════════════════════════════ */
  class SortButton {
    static ID = "ai-tab-sorter-sort-btn";
    static CLEAR_CLASS = "zen-workspace-close-unpinned-tabs-button";
    static LABEL = "⇅ Sort";
    static TOOLTIP = "AI Tab Sorter — group the tabs of this workspace (multi-select tabs to sort only those)";
    // Unique per script load: lets THIS load recognize its own twin and
    // sweep away buttons left by a PREVIOUS load (Sine hot-rebuilds the mod
    // on every pref change without unloading the old script — v0.1.2's
    // injector kept re-adding its button at the old anchor, which is what
    // made the Sort control "jump" between two positions).
    static RUN = "ats" + Math.random().toString(36).slice(2, 8);
    static #watchers = false;
    static #statusTimer = null;

    /** Zen's native "Clear" control. Fast path: its known class inside the
     *  active workspace. Fallback: text/label/tooltiptext scan (tidy). */
    static clearControl() {
      const scopes = [TabCollector.activeWorkspaceEl(), TabCollector.activeSection(), document].filter(Boolean);
      for (const scope of scopes) {
        try {
          const byClass = scope.querySelector("." + this.CLEAR_CLASS);
          if (byClass) return byClass;
        } catch (_e) { /* bad scope */ }
      }
      const seen = new Set();
      const selector = "toolbarbutton, button, label, span, hbox, vbox, toolbaritem, [label], [tooltiptext]";
      for (const scope of scopes) {
        for (const el of scope.querySelectorAll(selector)) {
          if (seen.has(el)) continue;
          seen.add(el);
          const label = (el.getAttribute?.("label") || "").trim().toLowerCase();
          const text = (el.textContent || "").trim().toLowerCase();
          const tip = (el.getAttribute?.("tooltiptext") || "").trim().toLowerCase();
          if (label === "clear" || text === "clear" || tip === "clear") return el;
        }
      }
      return null;
    }

    static build(clear) {
      const el = document.createElement(clear ? clear.tagName : "span");
      el.id = this.ID;
      el.dataset.atsRun = this.RUN;
      el.textContent = this.LABEL;
      el.setAttribute("label", this.LABEL);
      el.setAttribute("tooltiptext", this.TOOLTIP);
      el.title = this.TOOLTIP;
      el.className = clear ? clear.className : "ai-tab-sorter-fallback";
      if (clear) {
        // Keep Clear's look, but never its control class (see class docs).
        el.classList.remove(this.CLEAR_CLASS);
        el.dataset.twin = "1";
      }
      const sort = (e) => {
        e.preventDefault();
        e.stopPropagation();
        SortController.sort();
      };
      el.addEventListener("click", sort);
      el.addEventListener("command", sort); // XUL buttons fire command
      return el;
    }

    static #btn() { return document.getElementById(this.ID); }

    /** Remove any AI-Tab-Sorter button that does NOT belong to this load
     *  (stale twins from a Sine hot-rebuild, v0.1.2 legacy buttons/panels).
     *  Cheap: runs on mount + a slow interval, keeps exactly one button. */
    static #sweep() {
      try {
        for (const el of document.querySelectorAll(
          '[id^="ai-tab-sorter"], [data-ai-tab-sorter], .ai-tab-sorter-fallback, .ai-tab-sorter-panel'
        )) {
          if (el.dataset.atsRun === this.RUN) continue;
          el.remove();
        }
      } catch (_e) { /* non-fatal */ }
    }

    /** True when the twin exists AND sits immediately LEFT of the ACTIVE
     *  workspace's Clear control (a stale twin in another workspace does
     *  not count — workspace switches re-place it). */
    static twinIsCurrent() {
      const existing = this.#btn();
      if (!(existing?.dataset?.twin === "1" && existing.isConnected)) return false;
      const clear = this.clearControl();
      return (
        !!clear
        && existing.parentElement === clear.parentElement
        && existing.nextElementSibling === clear
      );
    }

    static placeTwin() {
      this.#sweep();
      if (this.twinIsCurrent()) return true;
      const clear = this.clearControl();
      if (!clear?.parentElement) return false;
      this.#btn()?.remove();
      clear.parentElement.insertBefore(this.build(clear), clear);
      log("Sort twin mounted left of the Clear button");
      return true;
    }

    static installWatchers() {
      if (this.#watchers) return;
      this.#watchers = true;
      // Clear is hover-revealed on some builds — re-place on any mouseover
      // (cheap: placeTwin early-returns once the twin is current).
      document.documentElement.addEventListener("mouseover", () => this.placeTwin(), true);
      // Zen re-renders the tabs strip constantly (group add/remove, labels) —
      // watch it so the twin re-attaches instantly instead of waiting for a
      // hover. Debounced to one frame.
      try {
        const strip = document.getElementById("tabbrowser-tabs");
        if (strip) {
          let queued = false;
          new MutationObserver(() => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => { queued = false; this.placeTwin(); });
          }).observe(strip, { childList: true, subtree: true });
        }
      } catch (_e) { /* hover watcher still covers us */ }
      // Slow sweep: kills buttons re-added by an older script load until the
      // browser is restarted (Sine hot-rebuild leaves old closures alive).
      setInterval(() => this.#sweep(), 2500);
      // One <zen-workspace> per workspace; the twin must follow the active one.
      try {
        const zw = window.gZenWorkspaces;
        if (typeof zw?.addChangeListeners === "function") {
          zw.addChangeListeners(() => this.placeTwin(), { once: false });
        }
      } catch (e) { log("workspace watcher failed:", e?.message); }
    }

    static ensure() {
      this.installWatchers();
      this.placeTwin();
    }

    static setSorting(on, tabCount = 0) {
      const btn = this.#btn();
      if (!btn) return;
      btn.dataset.busy = on ? "true" : "false";
      if (on) {
        btn.setAttribute("label", `↻ Sorting ${tabCount}…`);
        btn.textContent = `↻ Sorting ${tabCount}…`;
      } else {
        btn.setAttribute("label", this.LABEL);
        btn.textContent = this.LABEL;
      }
    }

    static setStatus(state, message, ms = 3000) {
      const btn = this.#btn();
      if (!btn) { console.info(LOG_PREFIX, message); return; }
      clearTimeout(this.#statusTimer);
      btn.dataset.state = state || "";
      btn.setAttribute("label", message);
      btn.textContent = message;
      this.#statusTimer = setTimeout(() => {
        delete btn.dataset.state;
        btn.setAttribute("label", this.LABEL);
        btn.textContent = this.LABEL;
      }, ms);
    }
  }

  /* ══════════════════════════════════════════════════════════════
   * SettingsPageEnhancer — runs in the settings page (about:
   * preferences), where Sine renders mod preferences. Sine builds
   * each pref row with id = pref property with dots REPLACED BY
   * DASHES (preferences.sys.mjs: prefEl.id = property.replace(
   * /\./g, "-")) → the model row is #mod-aitabsort-model. String
   * prefs save on the input's `change` event, so writing input.value
   * + dispatching change reuses Sine's own save path (pref set +
   * mods rebuild + restart toast). We inject:
   *   • a menulist (model dropdown, fed by the cached model list)
   *   • a "⟳ Fetch Models" button
   * Everything is built with createXULElement — NO innerHTML, so the
   * chrome-URL sanitizer can never strip it.
   * ══════════════════════════════════════════════════════════════ */
  class SettingsPageEnhancer {
    static MODEL_ROW = "mod-aitabsort-model";
    static PROVIDER_ROW = "mod-aitabsort-provider";
    static BASE_ROW = "mod-aitabsort-baseURL";
    static MENULIST_ID = "ats-model-menulist";
    static FETCH_BTN_ID = "ats-fetch-models-btn";
    static FETCH_ITEM = "__ats_fetch__";
    static #timer = null;
    static #observed = false;

    static init() {
      // Sine builds the mods list lazily and WIPES + rebuilds it on every
      // pref change (manager.rebuildMods) — scan forever, it's cheap.
      this.#scan();
      this.#timer = setInterval(() => this.#scan(), 1200);
      try {
        const obs = new MutationObserver(() => this.#scan());
        obs.observe(document.documentElement, { childList: true, subtree: true });
        this.#observed = true;
      } catch (_e) { /* polling still covers us */ }
      console.info(LOG_PREFIX, `settings enhancer active (v${VERSION}) — polling: ${!!this.#timer}, observer: ${this.#observed}`);
    }

    static #scan() {
      const row = document.getElementById(this.MODEL_ROW);
      if (row && row.isConnected && !row.querySelector("#" + this.MENULIST_ID)) {
        this.#enhanceModelRow(row);
      }
      this.#hookProviderRow();
    }

    static #cachedModels() {
      try { return JSON.parse(PrefStore.get("modelList") || "[]"); } catch (_e) { return []; }
    }

    static #setMenulistValue(ml, value, label) {
      try {
        ml.setAttribute("value", value ?? "");
        ml.setAttribute("label", label ?? value ?? "");
      } catch (_e) { /* non-fatal */ }
    }

    static #rebuildPopup(mp, models, currentValue) {
      for (const child of [...mp.children]) child.remove();
      const fetchItem = document.createXULElement("menuitem");
      fetchItem.setAttribute("value", this.FETCH_ITEM);
      fetchItem.setAttribute("label", "⟳ Fetch models from provider…");
      mp.append(fetchItem);
      const ids = new Set();
      if (currentValue && !models.some((m) => m.id === currentValue)) {
        const cur = document.createXULElement("menuitem");
        cur.setAttribute("value", currentValue);
        cur.setAttribute("label", `${currentValue} (current)`);
        mp.append(cur);
        ids.add(currentValue);
      }
      for (const m of models) {
        if (ids.has(m.id)) continue;
        const item = document.createXULElement("menuitem");
        item.setAttribute("value", m.id);
        item.setAttribute("label", m.label || m.id);
        mp.append(item);
        ids.add(m.id);
      }
    }

    static #enhanceModelRow(row) {
      try {
        const input = row.querySelector("input");
        if (!input) { log("model row found but has no input — skipping"); return; }

        const current = String(input.value || PrefStore.get("model") || "").trim();

        const ml = document.createXULElement("menulist");
        ml.id = this.MENULIST_ID;
        ml.setAttribute("editable", "false");
        ml.setAttribute("flex", "1");
        ml.setAttribute("tooltiptext", "Pick a model — use ⟳ inside the list to fetch the provider's models");
        const mp = document.createXULElement("menupopup");
        this.#rebuildPopup(mp, this.#cachedModels(), current);
        ml.append(mp);
        this.#setMenulistValue(ml, current, current || "(no model — fetch or type below)");

        ml.addEventListener("command", () => {
          const value = ml.getAttribute("value");
          if (!value || value === this.FETCH_ITEM) {
            this.#fetchModels();
            return;
          }
          this.#applyModel(input, value);
        });

        const btn = document.createXULElement("button");
        btn.id = this.FETCH_BTN_ID;
        btn.setAttribute("label", "⟳ Fetch Models");
        btn.setAttribute("tooltiptext", "Query the provider's /models endpoint and fill the dropdown");
        btn.addEventListener("command", () => this.#fetchModels());

        row.append(ml, btn);
        console.info(LOG_PREFIX, "model dropdown + Fetch Models injected into the settings panel");
      } catch (e) {
        console.error(LOG_PREFIX, "settings model-row enhancement failed:", e);
      }
    }

    static #applyModel(input, modelId) {
      PrefStore.set("model", modelId);
      try {
        input.value = modelId;
        input.dispatchEvent(new Event("change", { bubbles: true })); // Sine saves + rebuilds
      } catch (_e) { /* pref already set directly */ }
      console.info(LOG_PREFIX, "model set to:", modelId);
    }

    /** Find the main browser window and borrow its (CSP-free) fetch. */
    static #viaMainWindow() {
      try {
        const wm = SVCS?.wm;
        const win = wm?.getMostRecentWindow?.("navigator:browser")
          || [...(wm?.enumerate?.("navigator:browser") || [])].find(Boolean);
        if (win?.aiTabSorter?.providers?.listModels) return win.aiTabSorter.providers.listModels();
      } catch (_e) { /* fall back to local fetch */ }
      return null;
    }

    static async #fetchModels() {
      const btn = document.getElementById(this.FETCH_BTN_ID);
      const ml = document.getElementById(this.MENULIST_ID);
      const oldLabel = btn?.getAttribute("label");
      if (btn) btn.setAttribute("label", "Fetching…");
      if (btn) btn.setAttribute("disabled", "true");
      try {
        // about:preferences ships a CSP of `default-src chrome:` which BLOCKS
        // https:// fetches from this page. The main browser window has no
        // such CSP (that's where sorting fetches from) — so ask IT to run
        // the request for us. Falls back to a local fetch when no browser
        // window is around.
        const models = await (this.#viaMainWindow() ?? ProviderHub.listModels());
        PrefStore.set("modelList", JSON.stringify(models));
        if (ml?.isConnected) {
          const current = String(PrefStore.get("model") || "");
          this.#rebuildPopup(ml.firstElementChild, models, current);
          this.#setMenulistValue(ml, current, current || `✓ ${models.length} models — pick one ▾`);
          if (!current) this.#setMenulistValue(ml, "", `✓ ${models.length} models — pick one ▾`);
        }
        if (btn) {
          btn.setAttribute("label", `✓ ${models.length} models`);
          setTimeout(() => btn.setAttribute("label", oldLabel || "⟳ Fetch Models"), 4000);
        }
        console.info(LOG_PREFIX, `fetched ${models.length} models`);
      } catch (err) {
        if (btn) {
          btn.setAttribute("label", `✗ ${err.message}`);
          setTimeout(() => btn.setAttribute("label", oldLabel || "⟳ Fetch Models"), 6000);
        }
        console.error(LOG_PREFIX, "Fetch Models failed:", err);
      } finally {
        btn?.removeAttribute("disabled");
      }
    }

    /** When the provider preset changes, keep the base URL in sync (only
     *  if the user hasn't chosen a custom URL). Sine saves the provider
     *  itself; we just mirror the preset's default endpoint. */
    static #hookProviderRow() {
      const row = document.getElementById(this.PROVIDER_ROW);
      const ml = row?.querySelector("menulist");
      if (!row || !ml || ml.dataset.atsHooked) return;
      ml.dataset.atsHooked = "1";
      ml.addEventListener("command", () => {
        try {
          const id = ml.getAttribute("value");
          const preset = ProviderHub.PRESETS[id];
          if (!preset?.baseURL) return;
          const current = String(PrefStore.get("baseURL") || "").trim();
          const isPresetURL = !current || Object.values(ProviderHub.PRESETS).some((p) => p.baseURL === current);
          if (!isPresetURL) return; // user set a custom URL — leave it
          PrefStore.set("baseURL", preset.baseURL);
          const baseRow = document.getElementById(this.BASE_ROW);
          const baseInput = baseRow?.querySelector("input");
          if (baseInput) {
            baseInput.value = preset.baseURL;
            baseInput.dispatchEvent(new Event("change", { bubbles: true }));
          }
          log("provider changed → base URL synced to", preset.baseURL);
        } catch (e) { log("provider hook failed:", e); }
      });
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
        // Settings page: no tab strip — enhance the Sine prefs panel only.
        globalThis.aiTabSorter = { version: VERSION, prefs: PrefStore, providers: ProviderHub };
        SettingsPageEnhancer.init();
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
        if (SVCS.prefs.getBoolPref("browser.tabs.groups.smart.enabled", false)) {
          console.warn(LOG_PREFIX, "browser.tabs.groups.smart.enabled is TRUE — Zen's built-in AI grouping can conflict with this mod. Set it to false in about:config.");
        }
      } catch (_e) { /* noop */ }

      if (PrefStore.get("enabled") && PrefStore.get("showButtons")) {
        SortButton.ensure();
        // The Clear control can mount well after startup — timed retries;
        // the hover watcher covers everything after that.
        for (const delay of [500, 1500, 4000, 8000, 15000]) {
          setTimeout(() => SortButton.placeTwin(), delay);
        }
        console.info(LOG_PREFIX, `initialized v${VERSION} — Sort twin: ${SortButton.twinIsCurrent() ? "beside Clear ✓" : "waiting for the Clear control (hover the tabs header)"}`);
      } else {
        console.info(LOG_PREFIX, `initialized v${VERSION} — button hidden (enable it in the mod settings)`);
      }

      globalThis.aiTabSorter = {
        version: VERSION,
        sort: () => SortController.sort(),
        isSorting: () => SortController.isSorting(),
        prefs: PrefStore,
        providers: ProviderHub,
        button: SortButton,
      };
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
