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
// Ban method names that read from Firestore listeners (ADR 0034,
// docs/one-shot-reads.md, #427): firstValueFrom over one of these takes the
// listener's first emission, which under the persistent cache is whatever
// window the session happened to browse before — a plausible-looking
// subset, not the collection. The names are TransactionService's Observable
// methods plus subscribeToCollection, subscribeToDocument, and watch — this
// selector flags them wherever they are called, not just on TransactionService.
// Every production call site now goes through a `…Once`/`…FromServer` sibling
// that resolves once against the server; this bans the shape that read directly
// from the listener so it cannot come back. scripts/check-lint-guards.mjs
// re-derives the method list from TransactionService itself and fails the build
// if the alternation falls behind it.
const LISTENER_METHOD_ALTERNATION =
  "getTransactions|getTransactionById|getTransactionsInRange|getTransactionsWithReceipts|" +
  "getRecentTransactions|getExpensesInRange|getPeriodTotals|getPeriodCategoryTotals|" +
  "getTransactionDatesForMonth|getByDateRange|getByCategory|getMonthlyTotals|" +
  "subscribeToCollection|subscribeToDocument|watch";
const FIRST_VALUE_FROM_LISTENER_MESSAGE =
  "firstValueFrom takes a listener's first emission, which the persistent " +
  "cache can answer from a stale subset (docs/one-shot-reads.md). Use the " +
  "…Once/…FromServer sibling instead.";

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
    // ADR 0123's decision, expressed as a gate: a line that narrates a path
    // the code took is removed; a line that reports a real failure stays. So
    // console.warn and console.error remain legal — 109 of them are there on
    // purpose — and log/debug/info/trace do not. Sixteen narrating log lines
    // lived in core/services/ behind bracketed service tags, and they are
    // exactly the kind of thing nothing notices: they type-check, they lint,
    // they pass every spec, and they only show up as noise in a console
    // somebody happens to be reading.
    //
    // Specs are exempt because a spec that spies on console legitimately
    // names it, and core/services/testing/** is exempt because
    // silence-firebase-warnings.ts monkeypatches the console on purpose.
    files: ["src/app/**/*.ts"],
    ignores: ["**/*.spec.ts", "src/app/core/services/testing/**"],
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
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
    // Bans firstValueFrom over a TransactionService listener across app
    // code (see the alternation's comment above). Specs are ignored here,
    // not just left unmatched by `files`, because a fixture double calling
    // a listener method by the same name is not a warm cache — the rule has
    // nothing to say about a spec's own stand-in.
    files: ["src/app/**/*.ts"],
    ignores: ["**/*.spec.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.name='firstValueFrom'] > CallExpression.arguments:first-child" +
            `[callee.property.name=/^(${LISTENER_METHOD_ALTERNATION})$/]`,
          message: FIRST_VALUE_FROM_LISTENER_MESSAGE,
        },
        {
          selector:
            "CallExpression[callee.name='firstValueFrom'] > CallExpression.arguments:first-child" +
            "[callee.property.name='pipe']" +
            `[callee.object.callee.property.name=/^(${LISTENER_METHOD_ALTERNATION})$/]`,
          message: FIRST_VALUE_FROM_LISTENER_MESSAGE,
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
