// @ts-check
const eslint = require("@eslint/js");
const { defineConfig } = require("eslint/config");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");

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
    // Analytics SDK access is funnelled through AnalyticsService: the consent
    // gate, the no-op paths and the parameter allowlist all live in one place,
    // and the registry check can only see call sites that go through it. A
    // direct logEvent() in a component would bypass all three at once, and
    // nothing else would notice.
    files: ["src/app/**/*.ts"],
    // The globs cover the matching *.spec.ts too: the service's own specs and
    // app.config.spec.ts legitimately import the SDK to assert the wiring.
    ignores: [
      "src/app/core/services/analytics*.ts",
      "src/app/core/config/analytics*.ts",
      "src/app/app.config*.ts",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@angular/fire/analytics",
              message:
                "Use AnalyticsService. It owns the consent gate, the no-op paths and the parameter allowlist.",
            },
            {
              name: "@capacitor-firebase/analytics",
              message: "Use AnalyticsService. The native transport is selected inside it.",
            },
          ],
          patterns: [
            {
              group: ["firebase/analytics", "firebase/analytics/*", "@firebase/analytics"],
              message:
                "Use AnalyticsService. It owns the consent gate, the no-op paths and the parameter allowlist.",
            },
          ],
        },
      ],
    },
  },
  {
    // Model SDK access is confined to the three provider services. The prompt
    // registry check can only prove parity over the call sites it can see, and
    // it looks at exactly these three files — a fourth file issuing its own
    // model call would be invisible to it, and would be free to carry its own
    // unregistered prompt. Same argument as the analytics block above, applied
    // to a second SDK family.
    files: ["src/app/**/*.ts"],
    // The globs cover the matching *.spec.ts too: each provider's own spec
    // legitimately imports its SDK to type the fake client.
    ignores: [
      "src/app/core/services/gemini.service*.ts",
      "src/app/core/services/openai.service*.ts",
      "src/app/core/services/claude.service*.ts",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
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
          ],
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
