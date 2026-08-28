#!/usr/bin/env node
/**
 * validate-manifests.mjs — CI guard for Sine / Zen Mods Registry compliance.
 * Zero dependencies. Fails (exit 1) with a readable report when:
 *  - theme.json misses required fields or has an invalid shape
 *  - version is not semver
 *  - preferences.json violates the official Zen preferences spec
 *  - referenced URLs do not point at this repository's raw paths
 */
import { readFileSync, existsSync } from "node:fs";

const fail = (msgs) => {
  console.error("✖ manifest validation failed:\n" + msgs.map((m) => `  - ${m}`).join("\n"));
  process.exit(1);
};

const errors = [];

/* ── theme.json ─────────────────────────────────────────────── */
let theme;
try {
  theme = JSON.parse(readFileSync("theme.json", "utf8"));
} catch (e) {
  fail([`theme.json is not valid JSON: ${e.message}`]);
}

const REQUIRED = ["id", "name", "description", "scripts", "author", "version"];
for (const key of REQUIRED) {
  if (!(key in theme)) errors.push(`theme.json: missing required field "${key}"`);
}

// Zen Mods Registry rules: name < 25 chars, description < 100 chars.
if (theme.name && theme.name.length >= 25) errors.push(`theme.json: name must be < 25 characters (got ${theme.name.length})`);
if (theme.description && theme.description.length >= 100) errors.push(`theme.json: description must be < 100 characters (got ${theme.description.length})`);

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(theme.version || "")) errors.push(`theme.json: version "${theme.version}" is not semver`);

// Every script entry must declare an include list targeting browser.xhtml,
// AND the script file must actually exist at that path in the repo — a 404
// script key means Sine silently installs a dead mod (v0.1.0 bug).
for (const [file, def] of Object.entries(theme.scripts || {})) {
  if (!existsSync(file)) {
    errors.push(`theme.json: scripts["${file}"] — file does not exist at repo root "${file}" (Sine resolves script keys from the repo root)`);
  }
  if (!Array.isArray(def?.include) || def.include.length === 0) {
    errors.push(`theme.json: scripts["${file}"].include must be a non-empty array`);
  }
  if (!def.include?.includes("chrome://browser/content/browser.xhtml")) {
    errors.push(`theme.json: scripts["${file}"] should include "chrome://browser/content/browser.xhtml" for tab-strip access`);
  }
}

// Raw URLs should point at this repo's main branch (Sine auto-update path).
for (const field of ["preferences", "readme"]) {
  const url = theme[field];
  if (url && !/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/main\//.test(url)) {
    errors.push(`theme.json: "${field}" should be a raw.githubusercontent.com .../main/ URL`);
  }
}

// Style files referenced by theme.json must exist too.
for (const scope of ["chrome", "content"]) {
  const f = theme.style?.[scope];
  if (f && !existsSync(f)) errors.push(`theme.json: style.${scope} → "${f}" does not exist in the repo`);
}

/* ── preferences.json ───────────────────────────────────────── */
let prefs;
try {
  prefs = JSON.parse(readFileSync("preferences.json", "utf8"));
} catch (e) {
  fail([`preferences.json is not valid JSON: ${e.message}`]);
}

if (!Array.isArray(prefs)) fail(["preferences.json: root must be an array"]);

const TYPES = new Set(["checkbox", "dropdown", "string", "separator"]);
const seen = new Set();

for (const [i, pref] of prefs.entries()) {
  const at = `preferences.json[${i}]`;

  if (!TYPES.has(pref.type)) errors.push(`${at}: invalid type "${pref.type}" (allowed: ${[...TYPES].join(", ")})`);

  if (pref.type === "separator") continue;

  if (!pref.property) { errors.push(`${at}: missing "property"`); continue; }
  if (seen.has(pref.property)) errors.push(`${at}: duplicate property "${pref.property}"`);
  seen.add(pref.property);

  if (!/^[\w.-]+$/.test(pref.property)) errors.push(`${at}: property "${pref.property}" does not follow Firefox pref naming`);
  if (!pref.label) errors.push(`${at}: missing "label"`);

  if (pref.type === "dropdown") {
    if (!Array.isArray(pref.options) || pref.options.length === 0) {
      errors.push(`${at}: dropdown requires non-empty "options"`);
    } else {
      pref.options.forEach((opt, j) => {
        if (!opt.label) errors.push(`${at}: options[${j}] missing label`);
        const v = opt.value;
        if (typeof v !== "string" && typeof v !== "number") errors.push(`${at}: options[${j}].value must be string or number`);
        if (typeof v === "string" && !/^\S+$/.test(v)) errors.push(`${at}: options[${j}].value "${v}" must not contain whitespace/special chars`);
      });
      if (pref.default != null && !pref.options.some((o) => o.value === pref.default)) {
        errors.push(`${at}: default "${pref.default}" is not one of the option values`);
      }
    }
  }
}

/* ── cross-file: every pref referenced by theme/scripts exists ─ */

if (errors.length) fail(errors);
console.log(`✔ manifests valid — theme v${theme.version}, ${prefs.length} preference entries`);
