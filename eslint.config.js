// @ts-check
const eslint = require("@eslint/js");
const { defineConfig } = require("eslint/config");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");

// Two SDK families are confined to the files that own them: the analytics
// SDKs to AnalyticsService and its wiring (ADR 0003), the model SDKs to the
// three provider services (ADR 0005). Flat config resolves a rule key to the
// LAST matching config object's options, replaced wholesale — two blocks that
// overlap on `files` and both set no-restricted-imports silently disable each
// other, which is how the analytics ban died once (#262, ADR 0038). So each
// ban is declared once here, and every block below restates the full set that
// applies to its files. scripts/check-lint-guards.mjs resolves the real
// config per file population and fails the build when a ban stops applying.
const ANALYTICS_IMPORT_PATHS = [
  {
    name: "@angular/fire/analytics",
    message:
      "Use AnalyticsService. It owns the consent gate, the no-op paths and the parameter allowlist.",
  },
  {
    name: "@capacitor-firebase/analytics",
    message: "Use AnalyticsService. The native transport is selected inside it.",
  },
];
const ANALYTICS_IMPORT_PATTERNS = [
  {
    group: ["firebase/analytics", "firebase/analytics/*", "@firebase/analytics"],
    message:
      "Use AnalyticsService. It owns the consent gate, the no-op paths and the parameter allowlist.",
  },
];
const MODEL_IMPORT_PATHS = [
  {
    name: "@google/generative-ai",
    message:
      "Use CloudLLMProviderService. Prompts live in src/app/core/prompts and are parity-checked across providers.",
  },
  {
    name: "openai",
    message:
      "Use CloudLLMProviderService. Prompts live in src/app/core/prompts and are parity-checked across providers.",
  },
  {
    name: "@anthropic-ai/sdk",
    message:
      "Use CloudLLMProviderService. Prompts live in src/app/core/prompts and are parity-checked across providers.",
  },
];

module.exports = defineConfig([
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      "@angular-eslint/directive-selector": [
        "error",
        {
          type: "attribute",
          prefix: "app",
          style: "camelCase",
        },
      ],
      "@angular-eslint/component-selector": [
        "error",
        {
          type: "element",
          prefix: "app",
          style: "kebab-case",
        },
      ],
      // Every component checks with OnPush (ADR 0024). Default change
      // detection re-checks the whole tree on every event, timer and network
      // response; the app is signal-driven throughout, so the strategy is
      // free. This rule is here because the cost of the exception is invisible
      // — a component left on default is not a bug anyone would notice, it is
      // just work the browser repeats forever.
      "@angular-eslint/prefer-on-push-component-change-detection": "error",
    },
  },
  {
    // Both bans, for everything in the app. A direct logEvent() in a
    // component would bypass the consent gate, the no-op paths and the
    // parameter allowlist at once, and nothing else would notice; a fourth
    // file issuing its own model call would be invisible to the prompt
    // registry check and free to carry its own unregistered prompt. The two
    // narrower blocks below win over this one for the files that own an SDK.
    files: ["src/app/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [...ANALYTICS_IMPORT_PATHS, ...MODEL_IMPORT_PATHS],
          patterns: [...ANALYTICS_IMPORT_PATTERNS],
        },
      ],
    },
  },
  {
    // The analytics owners may import the analytics SDKs and must still not
    // import a model SDK. This block matches them instead of ignoring them,
    // so it resolves last — and because a later block's options replace the
    // earlier ones wholesale, it restates the model ban in full. The globs
    // cover the matching *.spec.ts too: the service's own specs and
    // app.config.spec.ts legitimately import the SDK to assert the wiring.
    files: [
      "src/app/core/services/analytics*.ts",
      "src/app/core/config/analytics*.ts",
      "src/app/app.config*.ts",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { paths: [...MODEL_IMPORT_PATHS] },
      ],
    },
  },
  {
    // The three provider services may import their model SDKs and must still
    // not import an analytics SDK — restated in full for the same reason.
    // The globs cover the matching *.spec.ts too: each provider's own spec
    // legitimately imports its SDK to type the fake client.
    files: [
      "src/app/core/services/gemini.service*.ts",
      "src/app/core/services/openai.service*.ts",
      "src/app/core/services/claude.service*.ts",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [...ANALYTICS_IMPORT_PATHS],
          patterns: [...ANALYTICS_IMPORT_PATTERNS],
        },
      ],
    },
  },
  {
    files: ["**/*.html"],
    extends: [
      angular.configs.templateRecommended,
      angular.configs.templateAccessibility,
    ],
    rules: {},
  }
]);
