#!/usr/bin/env node
/**
 * The import bans in eslint.config.js actually apply to the files they were
 * written for.
 *
 * Flat config resolves each rule key to the last matching config object's
 * options, wholesale — so two blocks that overlap on `files` and both set
 * @typescript-eslint/no-restricted-imports disable each other silently. The
 * analytics ban sat dead exactly that way: the config still read as
 * enforced, lint stayed green, and a direct logEvent() in a component would
 * have shipped (#262). The config now states, per file population, the full
 * ban set that applies; this check resolves the real config for
 * representative files of every population and fails when what resolves
 * stops matching what is stated — in both directions, so a ban present
 * where it must not be fails as loudly as a ban that is missing.
 *
 * Why resolved outcomes rather than overlap detection: the fixed structure
 * is itself three overlapping blocks setting the same key on purpose — the
 * narrow owner blocks override the union block. An overlap detector would
 * flag the cure; asserting the outcome catches every mechanism that kills a
 * ban, including ones not invented yet.
 *
 * Three further rules ride the same mechanism through no-restricted-syntax,
 * and they share one options array precisely because a second block setting
 * the same key would replace it:
 *
 *   - firstValueFrom over a TransactionService or FirestoreService listener
 *     (docs/one-shot-reads.md, #427) — a warm cache's first emission is a
 *     plausible-looking subset, not the collection. What that ban can lose
 *     silently is a listener the alternation forgets, which is why this check
 *     also re-derives the census straight from both services and asserts
 *     every name it finds is named in the selector.
 *   - A dynamic import of an analytics SDK. no-restricted-imports reads
 *     static import DECLARATIONS only, so `await import('firebase/analytics')`
 *     walks past every ban above it; this one is an ImportExpression selector
 *     sitting in the same array as the pair above. analytics-transport.ts is
 *     exempt — its constructor default is exactly that import, kept out of
 *     the initial bundle — and that exemption block is where the pair above
 *     is most likely to be dropped by accident, so its resolved selector list
 *     is asserted here in both directions.
 *   - The built-in `date` and `number` pipes in a template (ADR 0058). Both
 *     are at zero sites, so nothing in the app would notice the ban dying —
 *     which is the exact condition under which the analytics ban died.
 *
 * `--self-test` exercises the extraction and diff helpers against known
 * shapes and exits non-zero if the checker itself is broken; npm's
 * lint-guards:check chains it first, as i18n:check and prompts:check do.
 *
 * What it deliberately cannot see:
 *   - A population nobody listed. It probes representative files; a future
 *     exemption block for a fourth SDK family needs a row in POPULATIONS.
 *   - An analytics SDK reached some other way than a specifier: a
 *     `require()`, a bare `import(variable)` whose value is computed, or a
 *     global the SDK attaches to `window`. The ImportExpression selector
 *     reads the literal specifier, so only a literal is covered.
 *   - Whether the rule would actually fire on a banned import in the app.
 *     This proves the ban is in force for the file; --self-test proves the
 *     rules fire, against fixtures.
 *   - A listener held in a variable and passed as an identifier — `const rows$ =
 *     this.transactionService.getTransactions(); await firstValueFrom(rows$)`
 *     — the argument is an Identifier, not a CallExpression, so neither selector
 *     matches.
 *   - A double-chained pipe — `x.getTransactions(...).pipe(a).pipe(b)` — the
 *     outer `.pipe`'s object is the inner `.pipe` call, whose property name is
 *     `pipe`, so selector 2 does not match.
 *   - Another service's listeners. The census walks TransactionService and
 *     FirestoreService only; a warm-cache read through a different service's
 *     own Observable method is outside it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { ESLint } from 'eslint';

const RULE_KEY = '@typescript-eslint/no-restricted-imports';
const SYNTAX_RULE_KEY = 'no-restricted-syntax';

const ANALYTICS_PATHS = ['@angular/fire/analytics', '@capacitor-firebase/analytics'];
const ANALYTICS_PATTERNS = ['firebase/analytics', 'firebase/analytics/*', '@firebase/analytics'];
const MODEL_PATHS = ['@google/generative-ai', 'openai', '@anthropic-ai/sdk'];

// One row per population eslint.config.js distinguishes; the files are
// representative, not exhaustive. A rename fails loudly below rather than
// silently narrowing coverage.
const POPULATIONS = [
  {
    label: 'ordinary app code — both bans',
    files: [
      'src/app/core/services/pwa.service.ts',
      'src/app/features/dashboard/dashboard.component.ts',
    ],
    expected: { paths: [...ANALYTICS_PATHS, ...MODEL_PATHS], patterns: ANALYTICS_PATTERNS },
  },
  {
    label: 'analytics owners — model ban only',
    files: [
      'src/app/core/services/analytics.service.ts',
      'src/app/core/services/analytics-transport.ts',
      'src/app/core/config/analytics.config.ts',
      'src/app/app.config.ts',
      'src/app/app.config.spec.ts',
    ],
    expected: { paths: MODEL_PATHS, patterns: [] },
  },
  {
    label: 'model providers — analytics ban only',
    files: [
      'src/app/core/services/gemini.service.ts',
      'src/app/core/services/openai.service.ts',
      'src/app/core/services/claude.service.ts',
      'src/app/core/services/openai.service.spec.ts',
    ],
    expected: { paths: ANALYTICS_PATHS, patterns: ANALYTICS_PATTERNS },
  },
];

// The alternation of listener methods the syntax ban names — kept here as a
// plain string, not imported, so a drift between this file and
// eslint.config.js shows up as a resolved-selector mismatch below rather than
// disappearing behind a shared constant.
const LISTENER_METHOD_ALTERNATION =
  'getTransactions|getTransactionById|getTransactionsInRange|getTransactionsWithReceipts|' +
  'getRecentTransactions|getExpensesInRange|getPeriodTotals|getPeriodCategoryTotals|' +
  'getTransactionDatesForMonth|getByDateRange|getByCategory|getMonthlyTotals|' +
  'subscribeToCollection|subscribeToDocument|subscribeToDocumentWithMetadata|watch';

// The services whose Observable methods are listeners the ban must name.
const LISTENER_SOURCES = [
  'src/app/core/services/transaction.service.ts',
  'src/app/core/services/firestore.service.ts',
];

const DIRECT_LISTENER_SELECTOR =
  `CallExpression[callee.name='firstValueFrom'] > CallExpression.arguments:first-child` +
  `[callee.property.name=/^(${LISTENER_METHOD_ALTERNATION})$/]`;

const PIPED_LISTENER_SELECTOR =
  `CallExpression[callee.name='firstValueFrom'] > CallExpression.arguments:first-child` +
  `[callee.property.name='pipe'][callee.object.callee.property.name=/^(${LISTENER_METHOD_ALTERNATION})$/]`;

// The built-in formatting pipes ADR 0058 swept out of every template. Both
// are at zero sites, so nothing would notice this ban dying — which is
// exactly the condition the analytics ban died under. Kept as plain strings
// here, not imported, so a drift from eslint.config.js shows up below.
const TEMPLATE_DATE_SELECTOR = 'BindingPipe[name="date"]';
const TEMPLATE_NUMBER_SELECTOR = 'BindingPipe[name="number"]';

// The dynamic half of the analytics ban. no-restricted-imports reads static
// declarations only, so import('@capacitor-firebase/analytics') passes it —
// which is why this one is a syntax selector and why it lives in the same
// array as the firstValueFrom pair rather than in a block of its own.
const DYNAMIC_ANALYTICS_IMPORT_SELECTOR =
  'ImportExpression[source.value=/^(@angular\\/fire\\/analytics|' +
  '@capacitor-firebase\\/analytics|@?firebase\\/analytics)/]';

const SYNTAX_POPULATIONS = [
  {
    label: 'app code under the firstValueFrom-listener and dynamic-analytics bans',
    files: [
      'src/app/core/services/insight-snapshot.service.ts',
      'src/app/features/transactions/transactions.component.ts',
    ],
    expectedSelectors: [
      DIRECT_LISTENER_SELECTOR,
      PIPED_LISTENER_SELECTOR,
      DYNAMIC_ANALYTICS_IMPORT_SELECTOR,
    ],
  },
  {
    // The one file that may load an analytics SDK on demand. Its exemption
    // block resolves last and replaces the options above wholesale, so what
    // must resolve here is the two firstValueFrom selectors and NOT the
    // analytics one — asserting the absence is as load-bearing as asserting
    // the presence, because the cheap way to write this exemption is to
    // forget to restate the pair.
    label: 'the analytics transport — the listener ban only',
    files: ['src/app/core/services/analytics-transport.ts'],
    expectedSelectors: [DIRECT_LISTENER_SELECTOR, PIPED_LISTENER_SELECTOR],
  },
  {
    label: 'templates under the built-in date/number pipe ban',
    files: [
      'src/app/features/reports/monthly-comparison/monthly-comparison.component.html',
      'src/app/shared/components/transaction-row/transaction-row.component.html',
    ],
    expectedSelectors: [TEMPLATE_DATE_SELECTOR, TEMPLATE_NUMBER_SELECTOR],
  },
];

// Specs are exempt (a spec double is not a warm cache), so the rule must
// resolve to nothing at all here, not to an empty rule.
const SYNTAX_EXEMPT_FILES = ['src/app/core/services/insight-snapshot.service.spec.ts'];

/**
 * Normalize a resolved rule entry to bare specifier lists. Accepts every
 * shape the rule schema allows — paths as {name, message} objects or bare
 * strings, patterns as {group: [...]} objects or bare strings, severity as
 * a number or its string alias — so a hand-edited config cannot confuse the
 * comparison. Returns null when the rule is absent.
 */
export function extractRestrictions(entry) {
  if (!entry) return null;
  const [rawSeverity, options = {}] = Array.isArray(entry) ? entry : [entry];
  const severityMap = { off: 0, warn: 1, error: 2 };
  const severity =
    typeof rawSeverity === 'number' ? rawSeverity : (severityMap[rawSeverity] ?? 0);

  const paths = (options.paths ?? []).map(p => (typeof p === 'string' ? p : p.name));
  const patterns = (options.patterns ?? []).flatMap(p =>
    typeof p === 'string' ? [p] : (p.group ?? [])
  );

  return { severity, paths, patterns };
}

/** Order-insensitive set comparison, naming what is missing and what is extra. */
export function diffSets(actual, expected) {
  const have = new Set(actual);
  const want = new Set(expected);
  return {
    missing: [...want].filter(entry => !have.has(entry)),
    unexpected: [...have].filter(entry => !want.has(entry)),
  };
}

/**
 * Normalize a resolved no-restricted-syntax entry to its selector strings.
 * Same defensiveness as extractRestrictions: severity as a number or its
 * string alias, and any number of {selector, message} option objects.
 * Returns null when the rule is absent — the shape a spec-exempt file must
 * resolve to.
 */
export function extractSyntaxSelectors(entry) {
  if (!entry) return null;
  const [rawSeverity, ...options] = Array.isArray(entry) ? entry : [entry];
  const severityMap = { off: 0, warn: 1, error: 2 };
  const severity =
    typeof rawSeverity === 'number' ? rawSeverity : (severityMap[rawSeverity] ?? 0);
  const selectors = options.map(option =>
    typeof option === 'string' ? option : option.selector
  );
  return { severity, selectors };
}

/**
 * The names of every method in a service source whose declaration ends in
 * `): Observable<` — the census the firstValueFrom selector must cover.
 * A signature can wrap across lines (params one per line), so this tracks
 * paren depth from each method-start line rather than matching a single
 * line; it stops accumulating the moment the parameter list's parens
 * rebalance to zero, which is exactly where `): Observable<` would sit. A
 * type parameter list between the name and its parens (FirestoreService's
 * `subscribeToDocument<T>(`) is allowed for, as long as it holds no parens.
 */
export function observableMethods(source) {
  const startPattern =
    /^\s{2}(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*([a-zA-Z_$][\w$]*)\s*(?:<[^()]*>)?\s*\(/;
  const names = [];

  let pendingName = null;
  let buffer = '';
  let depth = 0;

  for (const line of source.split('\n')) {
    if (pendingName === null) {
      const match = line.match(startPattern);
      if (!match) continue;
      pendingName = match[1];
      buffer = '';
      depth = 0;
    }

    for (const ch of line) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
    }
    buffer += `${line}\n`;

    if (depth <= 0) {
      if (/\)\s*:\s*Observable</.test(buffer)) {
        names.push(pendingName);
      }
      pendingName = null;
    }
  }

  return names;
}

/** The alternation names out of a selector built like DIRECT_LISTENER_SELECTOR. */
export function selectorNames(selector) {
  const match = selector.match(/\/\^\(([^)]+)\)\$\//);
  return match ? match[1].split('|') : [];
}

async function run() {
  const failures = [];
  const fail = message => failures.push(message);

  const eslint = new ESLint();
  let fileCount = 0;

  for (const population of POPULATIONS) {
    for (const file of population.files) {
      fileCount += 1;

      if (!existsSync(file)) {
        fail(`${file} (${population.label}) — representative file is gone; update POPULATIONS in this script`);
        continue;
      }

      const config = await eslint.calculateConfigForFile(file);
      const resolved = extractRestrictions(config.rules?.[RULE_KEY]);

      if (resolved === null) {
        fail(`${file} (${population.label}) — ${RULE_KEY} does not resolve at all`);
        continue;
      }
      if (resolved.severity !== 2) {
        fail(`${file} (${population.label}) — ${RULE_KEY} resolves at severity ${resolved.severity}, not error`);
      }

      for (const [kind, actual, expected] of [
        ['paths', resolved.paths, population.expected.paths],
        ['patterns', resolved.patterns, population.expected.patterns],
      ]) {
        const diff = diffSets(actual, expected);
        for (const entry of diff.missing) {
          fail(`${file} (${population.label}) — ${kind} entry ${entry} is missing from the resolved config`);
        }
        for (const entry of diff.unexpected) {
          fail(`${file} (${population.label}) — ${kind} entry ${entry} resolves here but this population should not carry it`);
        }
      }
    }
  }

  for (const population of SYNTAX_POPULATIONS) {
    for (const file of population.files) {
      fileCount += 1;

      if (!existsSync(file)) {
        fail(`${file} (${population.label}) — representative file is gone; update SYNTAX_POPULATIONS in this script`);
        continue;
      }

      const config = await eslint.calculateConfigForFile(file);
      const resolved = extractSyntaxSelectors(config.rules?.[SYNTAX_RULE_KEY]);

      if (resolved === null) {
        fail(`${file} (${population.label}) — ${SYNTAX_RULE_KEY} does not resolve at all`);
        continue;
      }
      if (resolved.severity !== 2) {
        fail(`${file} (${population.label}) — ${SYNTAX_RULE_KEY} resolves at severity ${resolved.severity}, not error`);
      }

      const diff = diffSets(resolved.selectors, population.expectedSelectors);
      for (const entry of diff.missing) {
        fail(`${file} (${population.label}) — expected selector is missing from the resolved config: ${entry}`);
      }
      for (const entry of diff.unexpected) {
        fail(`${file} (${population.label}) — unexpected selector resolves here: ${entry}`);
      }
    }
  }

  for (const file of SYNTAX_EXEMPT_FILES) {
    fileCount += 1;

    if (!existsSync(file)) {
      fail(`${file} (spec exemption) — representative file is gone; update SYNTAX_EXEMPT_FILES in this script`);
      continue;
    }

    const config = await eslint.calculateConfigForFile(file);
    if (config.rules?.[SYNTAX_RULE_KEY]) {
      fail(`${file} (spec exemption) — ${SYNTAX_RULE_KEY} resolves here but specs are exempt`);
    }
  }

  const named = new Set(selectorNames(DIRECT_LISTENER_SELECTOR));
  const census = [];
  for (const source of LISTENER_SOURCES) {
    const methods = observableMethods(readFileSync(source, 'utf8'));
    if (methods.length === 0) {
      fail(`${source} — no Observable method found; the census no longer reads this file's signatures`);
    }
    for (const method of methods) {
      census.push(method);
      if (!named.has(method)) {
        fail(
          `${source.split('/').pop()}'s ${method}(...) returns an Observable but is not named in the firstValueFrom selector's alternation`
        );
      }
    }
  }

  console.log(
    `Resolved ${RULE_KEY} for ${fileCount} files across ${POPULATIONS.length} populations, ` +
      `plus ${SYNTAX_RULE_KEY} against a ${census.length}-method listener census.`
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} problem(s):\n`);
    for (const failure of failures) {
      console.error(`  ${failure}`);
    }
    console.error(
      '\nA later flat-config block with the same rule key replaces the earlier' +
        '\noptions wholesale. Restate the full ban set for the population it' +
        '\ngoverns — see the consts at the top of eslint.config.js.'
    );
    process.exit(1);
  }

  console.log('Every import ban resolves for exactly the files it governs.');
}

async function selfTest() {
  const results = [];
  const check = (name, actual, expected) => {
    results.push({
      name,
      ok: JSON.stringify(actual) === JSON.stringify(expected),
      actual,
      expected,
    });
  };

  check(
    'reads paths written as objects',
    extractRestrictions([2, { paths: [{ name: 'openai', message: 'm' }] }]).paths,
    ['openai']
  );
  check(
    'reads paths written as bare strings',
    extractRestrictions([2, { paths: ['openai'] }]).paths,
    ['openai']
  );
  check(
    'reads a pattern group',
    extractRestrictions([2, { patterns: [{ group: ['firebase/analytics', 'firebase/analytics/*'] }] }])
      .patterns,
    ['firebase/analytics', 'firebase/analytics/*']
  );
  check(
    'reads patterns written as bare strings',
    extractRestrictions([2, { patterns: ['firebase/*'] }]).patterns,
    ['firebase/*']
  );
  check(
    'normalizes the severity string',
    extractRestrictions(['error', {}]).severity,
    2
  );
  check('a missing rule resolves to null', extractRestrictions(undefined), null);
  check(
    'order does not matter to the set diff',
    diffSets(['a', 'b'], ['b', 'a']),
    { missing: [], unexpected: [] }
  );
  check(
    'names the missing and the unexpected entry',
    diffSets(['a', 'x'], ['a', 'b']),
    { missing: ['b'], unexpected: ['x'] }
  );

  check(
    'a bare-string selector reads back',
    extractSyntaxSelectors([2, 'A', 'B']).selectors,
    ['A', 'B']
  );
  check(
    'an {selector, message} option reads back',
    extractSyntaxSelectors(['error', { selector: 'A', message: 'm' }]).selectors,
    ['A']
  );
  check('a missing syntax rule resolves to null', extractSyntaxSelectors(undefined), null);

  const observableMethodsFixture = [
    '  getTransactions(filters?: TransactionFilters): Observable<Transaction[]> {',
    '    return x;',
    '  }',
    '',
    '  getMonthlyTotals(',
    '    year: number,',
    '    month: number',
    '  ): Observable<MonthlyTotal> {',
    '    return y;',
    '  }',
    '',
    '  helperNotObservable(x: number): number {',
    '    return x;',
    '  }',
  ].join('\n');
  check(
    'observableMethods finds a single-line and a wrapped signature, skips a non-Observable method',
    observableMethods(observableMethodsFixture),
    ['getTransactions', 'getMonthlyTotals']
  );

  const genericMethodsFixture = [
    '  subscribeToDocument<T>(path: string): Observable<T | null> {',
    '    return x;',
    '  }',
    '',
    '  subscribeToCollection<T extends Record<string, unknown>>(',
    '    path: string',
    '  ): Observable<T[]> {',
    '    return y;',
    '  }',
    '',
    '  async getDocument<T>(path: string): Promise<T | null> {',
    '    return z;',
    '  }',
  ].join('\n');
  check(
    'observableMethods reads past a type parameter list, single-line and wrapped',
    observableMethods(genericMethodsFixture),
    ['subscribeToDocument', 'subscribeToCollection']
  );

  check(
    'selectorNames recovers every name in the alternation',
    selectorNames(DIRECT_LISTENER_SELECTOR),
    LISTENER_METHOD_ALTERNATION.split('|')
  );

  const fixtureEslint = new ESLint();
  const fixturePath = 'src/app/core/services/one-shot-fixture.ts';
  const countSyntaxMessages = lintResults =>
    lintResults.flatMap(result => result.messages).filter(m => m.ruleId === SYNTAX_RULE_KEY)
      .length;

  const directBad = await fixtureEslint.lintText(
    'declare const firstValueFrom: any;\n' +
      'class X {\n' +
      '  transactionService: any;\n' +
      '  async f() {\n' +
      '    return firstValueFrom(this.transactionService.getTransactionsInRange(1, 2));\n' +
      '  }\n' +
      '}\n',
    { filePath: fixturePath }
  );
  check('a direct firstValueFrom over a listener fails the rule once', countSyntaxMessages(directBad), 1);

  const pipedBad = await fixtureEslint.lintText(
    'declare const firstValueFrom: any;\n' +
      'declare const map: any;\n' +
      'class X {\n' +
      '  transactionService: any;\n' +
      '  async f() {\n' +
      '    return firstValueFrom(this.transactionService.getTransactionsInRange(1, 2).pipe(map(x => x)));\n' +
      '  }\n' +
      '}\n',
    { filePath: fixturePath }
  );
  check('a piped firstValueFrom over a listener fails the rule once', countSyntaxMessages(pipedBad), 1);

  // The anchored alternation: a name that only extends a listed one is not
  // covered by it, so the metadata listener must be named in its own right.
  const metadataBad = await fixtureEslint.lintText(
    'declare const firstValueFrom: any;\n' +
      'class X {\n' +
      '  firestore: any;\n' +
      '  async f() {\n' +
      "    return firstValueFrom(this.firestore.subscribeToDocumentWithMetadata('x'));\n" +
      '  }\n' +
      '}\n',
    { filePath: fixturePath }
  );
  check(
    'a firstValueFrom over the metadata listener fails the rule once',
    countSyntaxMessages(metadataBad),
    1
  );

  const good = await fixtureEslint.lintText(
    'declare const firstValueFrom: any;\n' +
      'class X {\n' +
      '  transactionService: any;\n' +
      '  async f() {\n' +
      '    return firstValueFrom(this.transactionService.getTransactionsInRangeOnce(1, 2));\n' +
      '  }\n' +
      '}\n',
    { filePath: fixturePath }
  );
  check('firstValueFrom over a …Once method passes the rule', countSyntaxMessages(good), 0);

  // The dynamic analytics import: every specifier the static ban covers, the
  // sub-path form, a model SDK that must pass, and the one exempt file.
  for (const specifier of [
    '@capacitor-firebase/analytics',
    '@angular/fire/analytics',
    'firebase/analytics',
    'firebase/analytics/lite',
    '@firebase/analytics',
  ]) {
    const dynamicBad = await fixtureEslint.lintText(
      `export async function f() { return import('${specifier}'); }\n`,
      { filePath: 'src/app/core/services/analytics-fixture.service.ts' }
    );
    check(`a dynamic import of ${specifier} fails the rule once`, countSyntaxMessages(dynamicBad), 1);
  }

  const modelSdkDynamic = await fixtureEslint.lintText(
    "export async function f() { return import('@anthropic-ai/sdk'); }\n",
    { filePath: 'src/app/core/services/analytics-fixture.service.ts' }
  );
  check(
    'a dynamic import of a model SDK is no-restricted-imports’ business, not this rule’s',
    countSyntaxMessages(modelSdkDynamic),
    0
  );

  const transportDynamic = await fixtureEslint.lintText(
    "export async function f() { return import('@capacitor-firebase/analytics'); }\n",
    { filePath: 'src/app/core/services/analytics-transport.ts' }
  );
  check('the analytics transport may still load its SDK', countSyntaxMessages(transportDynamic), 0);

  const transportListener = await fixtureEslint.lintText(
    'declare const firstValueFrom: any;\n' +
      'class X {\n' +
      '  transactionService: any;\n' +
      '  async f() {\n' +
      '    return firstValueFrom(this.transactionService.getTransactions());\n' +
      '  }\n' +
      '}\n',
    { filePath: 'src/app/core/services/analytics-transport.ts' }
  );
  check(
    'the analytics transport is still under the listener ban its exemption restates',
    countSyntaxMessages(transportListener),
    1
  );

  // The template half. @angular-eslint/template-parser publishes visitorKeys
  // and tags nodes with `type`, so ESLint's own selector engine walks the
  // template AST — that is the whole mechanism the pipe ban rests on, and it
  // is worth proving rather than assuming.
  const templatePath = 'src/app/features/about/pipe-fixture.component.html';
  const dateInTemplate = await fixtureEslint.lintText('<p>{{ at | date }}</p>\n', {
    filePath: templatePath,
  });
  check('a built-in date pipe in a template fails the rule once', countSyntaxMessages(dateInTemplate), 1);

  const numberInTemplate = await fixtureEslint.lintText('<p [title]="n | number">x</p>\n', {
    filePath: templatePath,
  });
  check('a built-in number pipe in a bound attribute fails the rule once', countSyntaxMessages(numberInTemplate), 1);

  const chainedInTemplate = await fixtureEslint.lintText('<p>{{ k | translate | date }}</p>\n', {
    filePath: templatePath,
  });
  check('a chained built-in pipe still fails the rule once', countSyntaxMessages(chainedInTemplate), 1);

  // The one built-in formatting pipe with no replacement to point at.
  const currencyInTemplate = await fixtureEslint.lintText('<p>{{ amount | currency }}</p>\n', {
    filePath: templatePath,
  });
  check('a currency pipe passes the rule', countSyntaxMessages(currencyInTemplate), 0);

  const localeInTemplate = await fixtureEslint.lintText(
    '<p>{{ at | localeDate }} {{ n | localeNumber }}</p>\n',
    { filePath: templatePath }
  );
  check('the replacement pipes pass the rule', countSyntaxMessages(localeInTemplate), 0);

  let failed = 0;
  for (const result of results) {
    if (result.ok) {
      console.log(`  ok  ${result.name}`);
    } else {
      failed += 1;
      console.error(`  FAIL ${result.name}`);
      console.error(`       expected ${JSON.stringify(result.expected)}`);
      console.error(`       actual   ${JSON.stringify(result.actual)}`);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} self-test failure(s) — the checker itself is broken.`);
    process.exit(1);
  }
  console.log(`check-lint-guards self-test: ${results.length} passed`);
}

if (process.argv.includes('--self-test')) {
  await selfTest();
} else {
  await run();
}
