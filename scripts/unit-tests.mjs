#!/usr/bin/env node
/**
 * unit-tests.mjs — dependency-free tests for the mod's pure modules.
 * The .uc.js exports PrefStore/ProviderHub/PromptBuilder/ResponseParser/
 * HeuristicSorter via a CommonJS seam; loaded here under Node.
 * Run: node --test scripts/unit-tests.mjs
 */
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const src = readFileSync("ai-tab-sorter.uc.js", "utf8");
const mod = { exports: {} };
new Function("module", "exports", src)(mod, mod.exports);
const { PrefStore, ProviderHub, PromptBuilder, ResponseParser, HeuristicSorter } = mod.exports;

/* ── module loading ─────────────────────────────────────────── */
test("mod loads under Node and exports pure modules", () => {
  for (const m of [PrefStore, ProviderHub, PromptBuilder, ResponseParser, HeuristicSorter]) {
    assert.equal(typeof m, "function");
  }
});

test("PrefStore has all default keys", () => {
  const d = PrefStore.DEFAULTS;
  for (const k of ["provider", "baseURL", "apiKey", "model", "granularity", "outputMode",
    "reuseGroups", "minGroupSize", "heuristicFallback", "payloadMode", "timeoutSec"]) {
    assert.ok(k in d, `missing default: ${k}`);
  }
  assert.equal(d.provider, "ollama");
  assert.equal(d.payloadMode, "title-url");
});

/* ── ProviderHub presets + pure helpers ─────────────────────── */
test("ProviderHub ships 10 presets with valid dialects", () => {
  const keys = Object.keys(ProviderHub.PRESETS);
  assert.equal(keys.length, 10);
  for (const [id, p] of Object.entries(ProviderHub.PRESETS)) {
    assert.ok(p.label, `${id} label`);
    assert.ok(["openai", "ollama", "gemini"].includes(p.dialect), `${id} dialect`);
    if (id !== "custom") assert.ok(p.baseURL.startsWith("http"), `${id} baseURL`);
  }
});

test("sanitizeBase strips trailing slashes only", () => {
  assert.equal(ProviderHub.sanitizeBase("http://localhost:11434/"), "http://localhost:11434");
  assert.equal(ProviderHub.sanitizeBase("http://localhost:11434///"), "http://localhost:11434");
  assert.equal(ProviderHub.sanitizeBase("https://api.openai.com/v1/"), "https://api.openai.com/v1");
  assert.equal(ProviderHub.sanitizeBase("  https://x.dev/v1  "), "https://x.dev/v1");
});

test("normalizeModels: OpenAI-compatible shape", () => {
  const out = ProviderHub.normalizeModels("openai", {
    data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o" }, { id: "babbage" }],
  });
  assert.deepEqual(out.map((m) => m.id), ["babbage", "gpt-4o", "gpt-4o-mini"]); // sorted
});

test("normalizeModels: Ollama shape with parameter sizes", () => {
  const out = ProviderHub.normalizeModels("ollama", {
    models: [
      { name: "llama3.1:8b", details: { parameter_size: "8.0B" } },
      { name: "qwen2.5:7b", details: {} },
    ],
  });
  assert.equal(out.length, 2);
  assert.equal(out.find((m) => m.id === "llama3.1:8b").label, "llama3.1:8b (8.0B)");
  assert.equal(out.find((m) => m.id === "qwen2.5:7b").label, "qwen2.5:7b");
});

test("normalizeModels: Gemini shape strips models/ and filters embedders", () => {
  const out = ProviderHub.normalizeModels("gemini", {
    models: [
      { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
    ],
  });
  assert.deepEqual(out.map((m) => m.id), ["gemini-2.0-flash"]);
});

test("normalizeModels: garbage input → empty array, never throws", () => {
  assert.deepEqual(ProviderHub.normalizeModels("openai", null), []);
  assert.deepEqual(ProviderHub.normalizeModels("ollama", { nope: 1 }), []);
  assert.deepEqual(ProviderHub.normalizeModels("gemini", "broken"), []);
});

/* ── PromptBuilder ──────────────────────────────────────────── */
const CFG = {
  payloadMode: "title-url", granularity: 3, outputMode: "lines", customPrompt: "",
};

test("prompt embeds existing groups with exact-reuse rule", () => {
  const p = PromptBuilder.build([{ title: "PR 123", hostname: "github.com", url: "https://github.com/x/pull/123" }],
    ["Research", "Dev"], CFG);
  assert.ok(p.includes("- Research"));
  assert.ok(p.includes("- Dev"));
  assert.ok(p.toLowerCase().includes("exact"));
});

test("prompt respects payload privacy modes", () => {
  const tab = { title: "How to X", hostname: "secret.example", url: "https://secret.example/deep/path?token=1" };
  const full = PromptBuilder.build([tab], [], { ...CFG, payloadMode: "title-url" });
  const host = PromptBuilder.build([tab], [], { ...CFG, payloadMode: "title-host" });
  const title = PromptBuilder.build([tab], [], { ...CFG, payloadMode: "title" });
  assert.ok(full.includes("deep/path"));
  assert.ok(!host.includes("deep/path") && host.includes("secret.example"));
  assert.ok(!title.includes("secret.example"));
});

test("prompt line-count contract matches tab count; JSON mode differs", () => {
  const tabs = [1, 2, 3].map((i) => ({ title: `T${i}`, hostname: `h${i}.com`, url: `https://h${i}.com/` }));
  const lines = PromptBuilder.build(tabs, [], CFG);
  assert.ok(lines.includes("EXACTLY 3 lines"));
  const json = PromptBuilder.build(tabs, [], { ...CFG, outputMode: "json" });
  assert.ok(json.includes('"i"') && json.includes("3 entries"));
  assert.ok(!json.includes("EXACTLY 3 lines"));
});

test("granularity phrasing maps to all 5 levels", () => {
  for (const g of [1, 2, 3, 4, 5]) {
    const p = PromptBuilder.build([{ title: "t", hostname: "h.com", url: "u" }], [], { ...CFG, granularity: g });
    assert.ok(PromptBuilder.GRANULARITY[g].length > 5);
    assert.ok(p.includes(PromptBuilder.GRANULARITY[g]));
  }
});

test("custom prompt with placeholders substitutes; plain text is appended", () => {
  const withPh = PromptBuilder.build([{ title: "A", hostname: "a.com", url: "u" }], ["G1"],
    { ...CFG, customPrompt: "CATS:{TAB_DATA_LIST}|GROUPS:{EXISTING_CATEGORIES_LIST}" });
  assert.ok(withPh.includes("CATS:1. Title: A"));
  assert.ok(withPh.includes("|GROUPS:Existing groups (if a tab fits"));
  const plain = PromptBuilder.build([{ title: "A", hostname: "a.com", url: "u" }], [], { ...CFG, customPrompt: "Always answer in English." });
  assert.ok(plain.includes("Always answer in English."));
});

test("chunk splits correctly", () => {
  const items = Array.from({ length: 65 }, (_, i) => i);
  const chunks = PromptBuilder.chunk(items, 30);
  assert.deepEqual(chunks.map((c) => c.length), [30, 30, 5]);
  assert.equal(PromptBuilder.chunk([], 30).length, 0);
  assert.equal(PromptBuilder.chunk([1], 30).length, 1);
});

/* ── ResponseParser.normalizeCategory ───────────────────────── */
test("normalizeCategory strips common model noise", () => {
  assert.equal(ResponseParser.normalizeCategory("1. Dev"), "Dev");
  assert.equal(ResponseParser.normalizeCategory("2) Research"), "Research");
  assert.equal(ResponseParser.normalizeCategory("**Web Dev**"), "Web Dev");
  assert.equal(ResponseParser.normalizeCategory('"News"'), "News");
  assert.equal(ResponseParser.normalizeCategory("Category: Shopping"), "Shopping");
  assert.equal(ResponseParser.normalizeCategory("- travel."), "Travel");
  assert.equal(ResponseParser.normalizeCategory("  multiple   spaces  "), "Multiple Spaces");
  assert.equal(ResponseParser.normalizeCategory("python"), "Python");
  assert.equal(ResponseParser.normalizeCategory(""), "");
  assert.equal(ResponseParser.normalizeCategory(null), "");
});

test("normalizeCategory caps runaway labels", () => {
  const long = ResponseParser.normalizeCategory("one two three four five six seven eight");
  assert.ok(long.split(" ").length <= 4);
  assert.ok(long.length <= 40);
});

/* ── ResponseParser.parseLines repair ladder ────────────────── */
test("parseLines: exact count", () => {
  assert.deepEqual(
    ResponseParser.parseLines("Dev\nResearch\nDev", 3),
    ["Dev", "Research", "Dev"]
  );
});

test("parseLines: extra lines truncated", () => {
  const out = ResponseParser.parseLines("A\nB\nC\nD\nE", 3);
  assert.deepEqual(out, ["A", "B", "C"]);
});

test("parseLines: too few lines padded with Uncategorized", () => {
  const out = ResponseParser.parseLines("A", 3);
  assert.deepEqual(out, ["A", "Uncategorized", "Uncategorized"]);
});

test("parseLines: single tab uses first line", () => {
  assert.deepEqual(ResponseParser.parseLines("A\nB\nC", 1), ["A"]);
});

test("parseLines: empty/garbage → all null (skipped)", () => {
  assert.deepEqual(ResponseParser.parseLines("", 2), [null, null]);
  assert.deepEqual(ResponseParser.parseLines("   \n  \n", 2), [null, null]);
});

test("parseLines: repairs numbering and prefixes from small models", () => {
  const out = ResponseParser.parseLines("1. GitHub\n2) YouTube\n**News**", 3);
  assert.deepEqual(out, ["GitHub", "YouTube", "News"]);
});

/* ── ResponseParser.parseJSON ───────────────────────────────── */
test("parseJSON: clean array", () => {
  const out = ResponseParser.parseJSON('[{"i":1,"c":"Dev"},{"i":2,"c":"Dev"}]', 2);
  assert.deepEqual(out, ["Dev", "Dev"]);
});

test("parseJSON: tolerates wrapper chatter and alternate keys", () => {
  const wrapped = 'Here you go:\n[{"index":3,"category":"news"}]\nDone!';
  const out = ResponseParser.parseJSON(wrapped, 3);
  assert.deepEqual(out, [null, null, "News"]);
});

test("parseJSON: invalid → null (caller falls back to lines)", () => {
  assert.equal(ResponseParser.parseJSON("no brackets here", 3), null);
  assert.equal(ResponseParser.parseJSON("[broken json", 3), null);
  assert.equal(ResponseParser.parseJSON('{"not":"array"}', 3), null);
});

test("parseJSON: out-of-range indexes ignored", () => {
  const out = ResponseParser.parseJSON('[{"i":1,"c":"A"},{"i":9,"c":"X"}]', 2);
  assert.deepEqual(out, ["A", null]);
});

/* ── HeuristicSorter ────────────────────────────────────────── */
test("heuristic: hostname buckets + leftover singleton left ungrouped", () => {
  const tabs = [
    { title: "PR 1", hostname: "github.com", url: "u" },
    { title: "PR 2", hostname: "github.com", url: "u" },
    { title: "Watch x", hostname: "youtube.com", url: "u" },
    { title: "Watch y", hostname: "youtube.com", url: "u" },
    { title: "Lonely article", hostname: "obscure.blog", url: "u" },
  ];
  const out = HeuristicSorter.group(tabs, 2);
  assert.equal(out[0], out[1]);
  assert.equal(out[2], out[3]);
  assert.equal(out[4], null);
  assert.ok(["Github", "GitHub"].includes(out[0]) || /github/i.test(out[0]));
});

test("heuristic: keyword pass buckets cross-domain tabs", () => {
  const tabs = [
    { title: "Python tricks for pros", hostname: "blog.a.com", url: "u" },
    { title: "Python performance guide", hostname: "docs.b.org", url: "u" },
    { title: "Random cooking page", hostname: "food.c.net", url: "u" },
  ];
  const out = HeuristicSorter.group(tabs, 2);
  assert.equal(out[0], "Python");
  assert.equal(out[1], "Python");
  assert.equal(out[2], null);
});

test("heuristic: minGroupSize respected", () => {
  const tabs = [
    { title: "a1", hostname: "one.com", url: "u" },
    { title: "a2", hostname: "two.com", url: "u" },
  ];
  const out = HeuristicSorter.group(tabs, 3);
  assert.deepEqual(out, [null, null]);
});

test("heuristic: empty input safe", () => {
  assert.deepEqual(HeuristicSorter.group([], 2), []);
});

test("heuristic: stopwords filtered (web/site/page never bucket)", () => {
  const tabs = [
    { title: "web page", hostname: "a.com", url: "u" },
    { title: "web page 2", hostname: "b.com", url: "u" },
  ];
  const out = HeuristicSorter.group(tabs, 2);
  assert.deepEqual(out, [null, null]);
});
