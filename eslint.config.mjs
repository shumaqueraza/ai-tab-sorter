import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["*.uc.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: {
        // Firefox/Zen privileged globals available in browser.xhtml context
        ...globals.browser,
        Services: "readonly",
        gBrowser: "readonly",
        gZenWorkspaces: "readonly",
        SessionStore: "readonly",
        ChromeUtils: "readonly",
        Cu: "readonly",
       Cc: "readonly",
        Ci: "readonly",
        window: "readonly",
        document: "readonly",
        MozXULElement: "readonly",
        ZenLibrarySpaces: "readonly",
        globalThis: "readonly",
        module: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "no-undef": "error",
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error",
      "no-console": "off", // privileged mod context — console is the logging channel
    },
  },
  {
    ignores: ["node_modules/**", "scripts/**"],
  },
];
