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
    files: ["**/*.html"],
    extends: [
      angular.configs.templateRecommended,
      angular.configs.templateAccessibility,
    ],
    rules: {},
  }
]);
