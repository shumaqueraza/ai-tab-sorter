# Publishing to the Sine Mods Store

The store is a GitHub repository: **`sineorg/store`**. Its index is
[`marketplace.json`](https://raw.githubusercontent.com/sineorg/store/main/marketplace.json)
at the repo root, and each mod is packaged at `mods/<id>/mod.zip` (an exact
copy of the mod's GitHub repo zip, pinned to a commit). Advanced Tab Groups,
Nebula and 68 other mods ship this way.

**Why it's worth it:** mods installed from the store get
`origin: "store"` — their `.uc.js` scripts run WITHOUT the user having to
enable `sine.allow-unsafe-js`. Until you're listed, users must flip that
pref manually (our README documents this).

## Before you submit — repo checklist

1. Repo is public and pushed (`theme.json`, `ai-tab-sorter.uc.js`,
   `preferences.json`, `userChrome.css`, `README.md` at root).
2. `theme.json` has: `id`, `name` (< 25 chars), `description` (< 100 chars),
   `version`, `homepage`, `image`, `readme`, `preferences` URLs.
3. **Add `image.png` to the repo root** — a preview screenshot
   (~600×400) of the tab strip showing colored, collapsed groups after a
   sort. `theme.json` already points at it. Without it the store card has
   no thumbnail.
4. `sine.allow-unsafe-js` NOT required for basic validation, but test the
   mod once from your own repo URL first (Settings → Mods → the `+`).

## Submitting (pull request route)

1. **Fork** `github.com/sineorg/store`.
2. **Download your repo's zip** from the commit you pushed:
   `https://codeload.github.com/shumaqueraza/ai-tab-sorter/zip/refs/heads/main`
   (keep the single top-level folder exactly as codeload names it).
3. Place it in your fork as `mods/ai-tab-sorter/mod.zip`.
4. Add your entry to `marketplace.json` (alphabetical position). Paste and
   adjust:

```json
"ai-tab-sorter": {
  "id": "ai-tab-sorter",
  "homepage": "https://github.com/shumaqueraza/ai-tab-sorter",
  "author": "shumaqueraza",
  "name": "AI Tab Sorter",
  "description": "Sort tabs into smart groups with any AI — local or cloud.",
  "version": "0.1.7",
  "createdAt": "2026-08-29",
  "updatedAt": "2026-08-29",
  "readme": "https://raw.githubusercontent.com/shumaqueraza/ai-tab-sorter/main/README.md",
  "image": "https://raw.githubusercontent.com/shumaqueraza/ai-tab-sorter/main/image.png",
  "preferences": "https://raw.githubusercontent.com/shumaqueraza/ai-tab-sorter/main/preferences.json",
  "style": { "chrome": "userChrome.css" },
  "scripts": {
    "ai-tab-sorter.uc.js": {
      "include": [
        "chrome://browser/content/browser.xhtml",
        "about:preferences.*",
        "chrome://browser/content/preferences/preferences.xhtml.*"
      ]
    }
  },
  "tags": ["Zen Browser", "Tab Groups", "AI", "Tab Management"],
  "ai": "yes",
  "fork": ["zen"]
}
```

   (The maintainers' tooling fills `stars` and `commit` itself — you may
   omit them; they'll be added on the next sync. All other fields mirror
   what ATG / Nebula ship.)

5. Open a PR titled `Add ai-tab-sorter` with those two changes.

## Alternative (issue route)

Open an issue on `sineorg/store` titled **"Add ai-tab-sorter"** with your
repo URL + a screenshot; the maintainers' sync tooling generates the zip
and entry for you. This is how most small mods got listed.

## After you're listed

- **Updates are automatic**: Sine polls your repo's `theme.json` on the
  `main` branch — bump `version` there, push, and every store user gets
  the update. The store zip gets refreshed by the maintainers' sync.
- Store installs no longer require `sine.allow-unsafe-js` — consider
  softening that section in the README once listed.
