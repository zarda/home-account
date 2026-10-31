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
 * A third ban, on the Material date modules, is a different shape: it has no
 * owner, so it is restated in all three blocks and every population carries it.
 * It names exports, not whole modules — MatDatepickerModule from
 * @angular/material/datepicker; MatNativeDateModule and NativeDateModule from
 * @angular/material/core — so a path is keyed with its importNames
 * (`name#A,B`, sorted) and a name dropped from the list is a missing entry
 * rather than a ban that quietly got narrower. A bare path keeps its bare name.
 * The ordinary population includes two specs, because a spec is where the
 * modules used to come back in (#500).
 *
 * Why resolved outcomes rather than overlap detection: the fixed structure
 * is itself three overlapping blocks setting the same key on purpose — the
 * narrow owner blocks override the union block. An overlap detector would
 * flag the cure; asserting the outcome catches every mechanism that kills a
 * ban, including ones not invented yet.
 *
 * Seven further rules ride the same mechanism through no-restricted-syntax.
 * The first three share one options array precisely because a second block
 * setting the same key would replace it; the three template rules (the pipe
 * ban, the sort-header rule and the track-by-name ban) govern templates and
 * share the template block's array, and the last governs specs, which the app
 * block ignores, so each has a block of its own:
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
 *   - A transaction type read with a default, `x.type || 'expense'`, plain or
 *     behind a cast (ADR 0162). `||` keeps any truthy answer, so a model's
 *     "Income", "refund" or "credit" went on as the row's type; the type reader
 *     in receipt-extraction.utils files exactly "income" as income and anything
 *     else as an expense. The selector sits in the app block's array beside the
 *     three above and is restated in the analytics transport's exemption block,
 *     the one later block that replaces that array under src/app, so both rows
 *     below list it. It is matched on the member name `type`: an optional
 *     chain (the transaction form's `transaction?.type || 'expense'` seed) and
 *     `??` (test data's default) are not reading an answer off a model or a
 *     file, and the self-test proves both stay legal.
 *   - The built-in `date`, `number` and `currency` pipes in a template (ADR
 *     0058). All three are at zero sites, so nothing in the app would notice
 *     the ban dying — which is the exact condition under which the analytics
 *     ban died.
 *   - A sortable column header with no bound description (#500). Material's
 *     sort header describes its action to a screen reader as the English
 *     word "Sort" unless the template binds `sortActionDescription`, so a
 *     `mat-sort-header` without the binding speaks English to a reader of any
 *     language. The selector sits in the template block's array beside the
 *     pipe bans, matches the header element whether the attribute is plain or
 *     bound, and is satisfied only by a binding: a static English
 *     `sortActionDescription="…"` still fails. Every header binds it today, so
 *     nothing in the app would notice the rule dying; the self-test's
 *     fixtures prove it fires.
 *   - A `@for` that tracks its items by name (ADR 0186): a track expression
 *     ending in `.name`, trailing whitespace allowed, since the template
 *     parser keeps it in the source. Two files can share a name (two iOS
 *     captures are both image.jpg), and a list keyed by it hands one row, and
 *     its preview, to the other. The selector sits in the template block's
 *     array beside the two above; it fires on the name read off the item,
 *     and leaves the item itself, an id, `$index` and a longer member that
 *     merely starts with `name` alone, which the self-test's fixtures prove.
 *   - A spec listening for a rejection nobody caught on window (#500,
 *     docs/testing.md): the `unhandledrejection` and `rejectionhandled` event
 *     names as any string literal, and the `onunhandledrejection` /
 *     `onrejectionhandled` handler properties. Angular-compiled code runs on
 *     ZoneAwarePromise, which reports through the zone and never as a DOM
 *     event, so such a spec asserts nothing. The spec block replaced a
 *     per-file exemption that only said specs resolve to no syntax rule at
 *     all; the population row below now says exactly which two selectors a
 *     spec resolves to, and the same row's unexpected direction keeps the
 *     exemption's old job — the app's firstValueFrom and dynamic-analytics
 *     selectors never reach a spec.
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
 *     rules fire, against fixtures: a static import of each banned module in
 *     a feature file, a spec, app.config.ts and each owner's own files.
 *   - A path restricted some other way than by importNames. The key reads
 *     importNames only, so an allowImportNames or allowTypeImports entry would
 *     key as the bare path.
 *   - A date module loaded by `import()`. no-restricted-imports reads static
 *     declarations, so `(await import('@angular/material/core')).NativeDateModule`
 *     walks past the date-module ban exactly as it does past the analytics one;
 *     no component has a reason to write it.
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
 *   - An event name built at run time (`'unhandled' + 'rejection'`), written
 *     as a template literal (a TemplateLiteral is not a Literal), or reached
 *     as a computed handler (`window['onunhandledrejection']`): the selectors
 *     read a literal name and a plain property name only.
 *   - A type default written some other way than a `||` on a member named
 *     `type`: a destructured `type || 'expense'`, a ternary, or a member called
 *     something else. The selector reads the one shape the five sites it
 *     replaced all had.
 *   - What a bound sort-header description says. The selector asks for a
 *     binding, not for the catalog key: `[sortActionDescription]="'Sort'"` is a
 *     binding and passes.
 *   - A list keyed by name some other way than a member read ending in
 *     `.name`: `track f['name']` (a keyed read), a track function
 *     (`track byName(f)`), or a name under another member (`track f.fileName`).
 *     The selector reads the track expression's source text, and only its
 *     ending.
 *   - App code listening for a rejection. The ban resolves for specs; the
 *     population row proves nothing about src/app outside *.spec.ts.
 *   - A detector that is merely too weak: a spec that never listens, but reads
 *     a caught rejection nowhere, passes this rule and still asserts nothing.
 *     The rule bans the listener, not the vacuous spec.
 *   - Native promises from source evaluated at run time. share-target-sw.spec.ts
 *     evaluates the service worker natively, where window DOES hear a
 *     rejection, so it is the one place the event is real; the ban does not
 *     flag it today only because that spec names no such event, and a spec of
 *     that shape would need a scoped exemption here, not a loosened selector.
 */

import { existsSync, readFileSync } from 'node:fs';
import { ESLint } from 'eslint';

const RULE_KEY = '@typescript-eslint/no-restricted-imports';
const SYNTAX_RULE_KEY = 'no-restricted-syntax';

const ANALYTICS_PATHS = ['@angular/fire/analytics', '@capacitor-firebase/analytics'];
const ANALYTICS_PATTERNS = ['firebase/analytics', 'firebase/analytics/*', '@firebase/analytics'];
const MODEL_PATHS = ['@google/generative-ai', 'openai', '@anthropic-ai/sdk'];
// The Material date modules, keyed the way extractRestrictions keys a path that
// bans only some of a module's exports: `name#A,B`, names sorted. Plain strings
// here, not imported, so a name dropped from the config's list is a missing
// entry below rather than a shared constant shrinking on both sides.
const DATE_MODULE_PATHS = [
  '@angular/material/datepicker#MatDatepickerModule',
  '@angular/material/core#MatNativeDateModule,NativeDateModule',
];

// One row per population eslint.config.js distinguishes; the files are
// representative, not exhaustive. A rename fails loudly below rather than
// silently narrowing coverage.
const POPULATIONS = [
  {
    // Specs resolve the same way: a spec that renders a picker provides an
    // adapter itself, and none may import a date module to get one. The
    // transaction-form spec is the one that used to re-import both.
    label: 'ordinary app code and specs — every ban',
    files: [
      'src/app/core/services/pwa.service.ts',
      'src/app/features/dashboard/dashboard.component.ts',
      'src/app/features/dashboard/dashboard.component.spec.ts',
      'src/app/features/transactions/transaction-form/transaction-form.component.spec.ts',
    ],
    expected: {
      paths: [...ANALYTICS_PATHS, ...MODEL_PATHS, ...DATE_MODULE_PATHS],
      patterns: ANALYTICS_PATTERNS,
    },
  },
  {
    label: 'analytics owners — model and date-module bans',
    files: [
      'src/app/core/services/analytics.service.ts',
      'src/app/core/services/analytics-transport.ts',
      'src/app/core/config/analytics.config.ts',
      'src/app/app.config.ts',
      'src/app/app.config.spec.ts',
    ],
    expected: { paths: [...MODEL_PATHS, ...DATE_MODULE_PATHS], patterns: [] },
  },
  {
    label: 'model providers — analytics and date-module bans',
    files: [
      'src/app/core/services/gemini.service.ts',
      'src/app/core/services/openai.service.ts',
      'src/app/core/services/claude.service.ts',
      'src/app/core/services/openai.service.spec.ts',
    ],
    expected: { paths: [...ANALYTICS_PATHS, ...DATE_MODULE_PATHS], patterns: ANALYTICS_PATTERNS },
  },
];

// The alternation of listener methods the syntax ban names — kept here as a
// plain string, not imported, so a drift between this file and
// eslint.config.js shows up as a resolved-selector mismatch below rather than
// disappearing behind a shared constant.
const LISTENER_METHOD_ALTERNATION =
  'getTransactions|getTransactionById|getTransactionsInRange|getTransactionsWithReceipts|' +
  'getRecentTransactions|getExpensesInRange|getPeriodTotals|getPeriodCategoryTotals|' +
  'getTransactionDatesForMonth|getByDateRange|' +
  'subscribeToCollection|subscribeToCollectionWithMetadata|subscribeToDocument|subscribeToDocumentWithMetadata|watch';

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

// The built-in formatting pipes ADR 0058 swept out of every template. All
// three are at zero sites, so nothing would notice this ban dying — which is
// exactly the condition the analytics ban died under. Kept as plain strings
// here, not imported, so a drift from eslint.config.js shows up below.
const TEMPLATE_DATE_SELECTOR = 'BindingPipe[name="date"]';
const TEMPLATE_NUMBER_SELECTOR = 'BindingPipe[name="number"]';
const TEMPLATE_CURRENCY_SELECTOR = 'BindingPipe[name="currency"]';

// A sortable column header that binds no description for its action. Material
// describes the sort button to a screen reader as the English word "Sort"
// unless the template binds `sortActionDescription`, so a header without the
// binding speaks English to every reader. Only a BINDING passes: a static
// `sortActionDescription="…"` is written in one language for all of them.
const TEMPLATE_SORT_HEADER_SELECTOR =
  'Element:has(> TextAttribute[name="mat-sort-header"], > BoundAttribute[name="mat-sort-header"])' +
  ':not(:has(> BoundAttribute[name="sortActionDescription"]))';

// A `@for` that tracks its items by name (ADR 0186). Two files can share a
// name, so a list keyed by it hands one row and its preview to the other. The
// template parser keeps trailing whitespace in the track source, so the
// pattern allows it. A plain string, not imported, so a drift from
// eslint.config.js shows up as a resolved-selector mismatch below.
const TEMPLATE_TRACK_BY_NAME_SELECTOR = 'ForLoopBlock[trackBy.source=/\\.name\\s*$/]';

// The dynamic half of the analytics ban. no-restricted-imports reads static
// declarations only, so import('@capacitor-firebase/analytics') passes it —
// which is why this one is a syntax selector and why it lives in the same
// array as the firstValueFrom pair rather than in a block of its own.
const DYNAMIC_ANALYTICS_IMPORT_SELECTOR =
  'ImportExpression[source.value=/^(@angular\\/fire\\/analytics|' +
  '@capacitor-firebase\\/analytics|@?firebase\\/analytics)/]';

// A transaction type read with a default: `x.type || 'expense'`, plain or behind
// a cast. A plain string, not imported, so a drift from eslint.config.js shows
// up as a resolved-selector mismatch below rather than disappearing behind a
// shared constant. It rides the app block's array with the three above and is
// restated in the analytics transport's exemption block.
const LOOSE_TYPE_DEFAULT_SELECTOR =
  "LogicalExpression[operator='||'][right.value=/^(expense|income)$/]" +
  ":matches([left.type='MemberExpression'][left.property.name='type'], " +
  "[left.type='MemberExpression'][left.property.value='type'], " +
  "[left.type='TSAsExpression'][left.expression.property.name='type'], " +
  "[left.type='TSAsExpression'][left.expression.property.value='type'])";

// The spec-only half: listening for a rejection nobody caught on window. Kept
// as plain strings, not imported, so a drift from eslint.config.js shows up
// as a resolved-selector mismatch below.
const REJECTION_EVENT_LITERAL_SELECTOR =
  'Literal[value=/^(unhandledrejection|rejectionhandled)$/]';
const REJECTION_EVENT_HANDLER_SELECTOR =
  'MemberExpression[property.name=/^on(unhandledrejection|rejectionhandled)$/]';

const SYNTAX_POPULATIONS = [
  {
    label: 'app code under the firstValueFrom-listener, dynamic-analytics and loose-type-default bans',
    files: [
      'src/app/core/services/insight-snapshot.service.ts',
      'src/app/features/transactions/transactions.component.ts',
    ],
    expectedSelectors: [
      DIRECT_LISTENER_SELECTOR,
      PIPED_LISTENER_SELECTOR,
      DYNAMIC_ANALYTICS_IMPORT_SELECTOR,
      LOOSE_TYPE_DEFAULT_SELECTOR,
    ],
  },
  {
    // The one file that may load an analytics SDK on demand. Its exemption
    // block resolves last and replaces the options above wholesale, so what
    // must resolve here is the two firstValueFrom selectors and NOT the
    // analytics one — asserting the absence is as load-bearing as asserting
    // the presence, because the cheap way to write this exemption is to
    // forget to restate the pair. The loose-type-default selector is restated
    // here too: this file is under src/app like any other, so the exemption
    // exempts it from the analytics selector alone.
    label: 'the analytics transport — the listener and loose-type-default bans only',
    files: ['src/app/core/services/analytics-transport.ts'],
    expectedSelectors: [
      DIRECT_LISTENER_SELECTOR,
      PIPED_LISTENER_SELECTOR,
      LOOSE_TYPE_DEFAULT_SELECTOR,
    ],
  },
  {
    label: 'templates under the built-in date/number/currency pipe, the sort-header description and the track-by-name bans',
    files: [
      'src/app/features/reports/monthly-comparison/monthly-comparison.component.html',
      'src/app/shared/components/transaction-row/transaction-row.component.html',
    ],
    expectedSelectors: [
      TEMPLATE_DATE_SELECTOR,
      TEMPLATE_NUMBER_SELECTOR,
      TEMPLATE_CURRENCY_SELECTOR,
      TEMPLATE_SORT_HEADER_SELECTOR,
      TEMPLATE_TRACK_BY_NAME_SELECTOR,
    ],
  },
  {
    // A spec double is not a warm cache, so the firstValueFrom pair and the
    // dynamic-analytics selector must NOT resolve here: the unexpected
    // direction is the old spec exemption's job, and it is as load-bearing as
    // the presence of the two rejection selectors. The three files are the
    // specs closest to the rule's origin (the snapshot services and the app
    // smoke); any *.spec.ts under src/app resolves the same way.
    label: 'specs under the uncaught-rejection-listener ban only',
    files: [
      'src/app/core/services/insight-snapshot.service.spec.ts',
      'src/app/core/services/widget-snapshot.service.spec.ts',
      'src/app/app.smoke.spec.ts',
    ],
    expectedSelectors: [REJECTION_EVENT_LITERAL_SELECTOR, REJECTION_EVENT_HANDLER_SELECTOR],
  },
];

/**
 * Normalize a resolved rule entry to bare specifier lists. Accepts every
 * shape the rule schema allows — paths as {name, message} objects or bare
 * strings, patterns as {group: [...]} objects or bare strings, severity as
 * a number or its string alias — so a hand-edited config cannot confuse the
 * comparison. Returns null when the rule is absent.
 *
 * A path that bans only some of a module's exports is keyed with them,
 * `name#A,B` (sorted, so the order they were written in is no diff): the ban
 * on MatDatepickerModule must not read as a ban on the whole of
 * @angular/material/datepicker, and a name dropped from the list must show as
 * a missing entry rather than leave the key it had. A bare path keeps its bare
 * name; an empty list is `name#`, which is not the bare ban (it restricts no
 * named import), so it cannot stand in for one.
 */
export function extractRestrictions(entry) {
  if (!entry) return null;
  const [rawSeverity, options = {}] = Array.isArray(entry) ? entry : [entry];
  const severityMap = { off: 0, warn: 1, error: 2 };
  const severity =
    typeof rawSeverity === 'number' ? rawSeverity : (severityMap[rawSeverity] ?? 0);

  const paths = (options.paths ?? []).map(p => {
    if (typeof p === 'string') return p;
    if (!Array.isArray(p.importNames)) return p.name;
    return `${p.name}#${[...p.importNames].sort().join(',')}`;
  });
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
 * Returns null when the rule is absent — the shape a file under no syntax
 * ban at all would resolve to.
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
    'reads a path’s importNames into its key',
    extractRestrictions([
      2,
      {
        paths: [
          {
            name: '@angular/material/core',
            importNames: ['MatNativeDateModule', 'NativeDateModule'],
            message: 'm',
          },
        ],
      },
    ]).paths,
    ['@angular/material/core#MatNativeDateModule,NativeDateModule']
  );
  check(
    'the importNames in a key do not depend on the order they were written in',
    extractRestrictions([
      2,
      {
        paths: [
          { name: '@angular/material/core', importNames: ['NativeDateModule', 'MatNativeDateModule'] },
        ],
      },
    ]).paths,
    ['@angular/material/core#MatNativeDateModule,NativeDateModule']
  );
  check(
    'a bare path keeps its bare name',
    extractRestrictions([2, { paths: [{ name: 'openai', message: 'm' }] }]).paths,
    ['openai']
  );
  check(
    'a dropped importName is a missing entry',
    diffSets(
      extractRestrictions([
        2,
        { paths: [{ name: '@angular/material/core', importNames: ['MatNativeDateModule'] }] },
      ]).paths,
      ['@angular/material/core#MatNativeDateModule,NativeDateModule']
    ),
    {
      missing: ['@angular/material/core#MatNativeDateModule,NativeDateModule'],
      unexpected: ['@angular/material/core#MatNativeDateModule'],
    }
  );
  check(
    'an empty importNames is not the bare ban',
    extractRestrictions([
      2,
      { paths: [{ name: '@angular/material/core', importNames: [] }] },
    ]).paths,
    ['@angular/material/core#']
  );
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
  const countImportMessages = lintResults =>
    lintResults.flatMap(result => result.messages).filter(m => m.ruleId === RULE_KEY).length;

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

  // The third built-in formatting pipe: its replacement is LocaleCurrencyPipe,
  // which asks CurrencyService for the amount in the account's language.
  const currencyInTemplate = await fixtureEslint.lintText('<p>{{ amount | currency }}</p>\n', {
    filePath: templatePath,
  });
  check('a currency pipe fails the rule once', countSyntaxMessages(currencyInTemplate), 1);

  const localeInTemplate = await fixtureEslint.lintText(
    "<p>{{ at | localeDate }} {{ n | localeNumber }} {{ a | localeCurrency:'USD' }}</p>\n",
    { filePath: templatePath }
  );
  check('the replacement pipes pass the rule', countSyntaxMessages(localeInTemplate), 0);

  // The sort-header half. A header's own description is the English "Sort"
  // unless the template binds one, so every shape of a sortable header must
  // fail without the binding and pass with it. `*matHeaderCellDef` hoists a
  // header's inputs onto the Template node the Element sits inside, which the
  // selector does not match, so a bound `[mat-sort-header]` fails once.
  const sortHeader = attributes =>
    '<table mat-table matSort><ng-container matColumnDef="d">' +
    `<th mat-header-cell *matHeaderCellDef ${attributes}>x</th>` +
    '</ng-container></table>\n';
  const sortHeaderCases = [
    ['a sortable header with no description', 'mat-sort-header', 1],
    ['a sortable header with a bound description', `mat-sort-header [sortActionDescription]="'k' | translate"`, 0],
    ['a bound sort header with no description', `[mat-sort-header]="'id'"`, 1],
    ['a bound sort header with a bound description', `[mat-sort-header]="'id'" [sortActionDescription]="'k' | translate"`, 0],
    ['a sortable header with a static description', 'mat-sort-header sortActionDescription="Sort"', 1],
    ['a header that is not sortable', '', 0],
  ];
  for (const [shape, attributes, expected] of sortHeaderCases) {
    const linted = await fixtureEslint.lintText(sortHeader(attributes), { filePath: templatePath });
    check(`${shape} ${expected === 0 ? 'passes' : 'fails'} the rule${expected === 0 ? '' : ' once'}`, countSyntaxMessages(linted), expected);
  }

  const twoSortHeaders = await fixtureEslint.lintText(
    '<table mat-table matSort>' +
      '<ng-container matColumnDef="a"><th mat-header-cell *matHeaderCellDef mat-sort-header [sortActionDescription]="\'k\' | translate">a</th></ng-container>' +
      '<ng-container matColumnDef="b"><th mat-header-cell *matHeaderCellDef mat-sort-header>b</th></ng-container>' +
      '</table>\n',
    { filePath: templatePath }
  );
  check('only the sort header that lacks a description fails the rule', countSyntaxMessages(twoSortHeaders), 1);

  // The track-by-name half (ADR 0186). Two files can share a name, so a list
  // tracked by it hands one row to the other. The template parser keeps the
  // whitespace after the expression in its source, so a name followed by a
  // space, or ending its own line, must fail as the plain one does; the item
  // itself, an id, a longer member that merely starts with `name` and the
  // index must not.
  const trackCases = [
    ['a list tracked by name', '@for (f of files; track f.name) {<p>{{ f.name }}</p>}', 1],
    ['a list tracked by name before a trailing space', '@for (f of files; track f.name ) {<p>{{ f.name }}</p>}', 1],
    ['a list tracked by a name on its own line', '@for (\n  f of files;\n  track f.name\n) {\n  <p>{{ f.name }}</p>\n}', 1],
    ['a list tracked by name beside its index', '@for (f of files; track f.name; let i = $index) {<p>{{ i }}</p>}', 1],
    ['a list tracked by the item itself', '@for (f of files; track f) {<p>{{ f.name }}</p>}', 0],
    ['a list tracked by id', '@for (f of files; track f.id) {<p>{{ f.name }}</p>}', 0],
    ['a list tracked by a member that starts with name', '@for (f of files; track f.nameKey) {<p>{{ f.name }}</p>}', 0],
    ['a list tracked by index', '@for (f of files; track $index) {<p>{{ f.name }}</p>}', 0],
  ];
  for (const [shape, source, expected] of trackCases) {
    const linted = await fixtureEslint.lintText(source + '\n', { filePath: templatePath });
    check(`${shape} ${expected === 0 ? 'passes' : 'fails'} the rule${expected === 0 ? '' : ' once'}`, countSyntaxMessages(linted), expected);
  }

  // The spec-only half: a listener for a rejection nobody caught. Each shape a
  // spec could use to hear one on window must fail the rule once, and the
  // shapes that only resemble one must not.
  const rejectionSpecPath = 'src/app/core/services/rejection-fixture.service.spec.ts';
  const listenerShapes = [
    ["window.addEventListener('unhandledrejection', () => {});", 'window.addEventListener'],
    ["globalThis.addEventListener('unhandledrejection', () => {});", 'globalThis.addEventListener'],
    ["addEventListener('unhandledrejection', () => {});", 'a bare addEventListener'],
    ["window.removeEventListener('unhandledrejection', () => {});", 'removeEventListener'],
    ["declare const fromEvent: any;\nfromEvent(window, 'unhandledrejection');", 'fromEvent(window, …)'],
    ["const name = 'unhandledrejection';", 'the event name held in a constant'],
    ["window.addEventListener('rejectionhandled', () => {});", 'rejectionhandled'],
    ['window.onunhandledrejection = () => {};', 'the onunhandledrejection property'],
    ['window.onrejectionhandled = () => {};', 'the onrejectionhandled property'],
  ];
  for (const [source, shape] of listenerShapes) {
    const rejectionBad = await fixtureEslint.lintText(`${source}\n`, { filePath: rejectionSpecPath });
    check(`a spec listening for a rejection via ${shape} fails the rule once`, countSyntaxMessages(rejectionBad), 1);
  }

  const rejectionGood = [
    ["window.addEventListener('error', () => {});", "a window 'error' listener"],
    ["declare const spyOn: any;\nspyOn(console, 'error');", "a spy on console 'error'"],
    ['declare const zone: any;\nzone.onError.subscribe(() => {});', 'a NgZone.onError subscription'],
    ["declare const it: any;\nit('leaves no unhandledrejection behind', () => {});", 'a title that merely names the event'],
  ];
  for (const [source, shape] of rejectionGood) {
    const rejectionOk = await fixtureEslint.lintText(`${source}\n`, { filePath: rejectionSpecPath });
    check(`${shape} passes the rule`, countSyntaxMessages(rejectionOk), 0);
  }

  // The ban is for specs. App code is under the other bans and has no
  // business listening either, but that is not this rule's to say.
  const rejectionInApp = await fixtureEslint.lintText(
    "window.addEventListener('unhandledrejection', () => {});\n",
    { filePath: 'src/app/core/services/rejection-fixture.service.ts' }
  );
  check('the same listener in app code is not this rule’s business', countSyntaxMessages(rejectionInApp), 0);

  // The loose type default. The five sites it replaced read a type off a model
  // or a file as `x.type || 'expense'`, plain or behind a cast; each shape of
  // that must fail once in app code, in the analytics transport's restated
  // block too, and the shapes that only resemble it must not.
  const typeDefaultAppPath = 'src/app/core/services/type-fixture.service.ts';
  const typeDefaultCases = [
    ['a member type read with an expense default in app code', typeDefaultAppPath,
      "declare const t: any;\nexport const type = t.type || 'expense';", 1],
    ['an income default on a member type read in app code', typeDefaultAppPath,
      "declare const t: any;\nexport const type = t.type || 'income';", 1],
    ['a computed type read with a default in app code', typeDefaultAppPath,
      "declare const t: any;\nexport const type = t['type'] || 'expense';", 1],
    ['a cast type read with a default in app code (the backup door’s shape)', typeDefaultAppPath,
      "declare const t: any;\nexport const type = (t['type'] as 'income' | 'expense') || 'expense';", 1],
    ['a member type read with a default in the analytics transport', 'src/app/core/services/analytics-transport.ts',
      "declare const t: any;\nexport const type = t.type || 'expense';", 1],
    ['an optional-chain type read with a default in app code', typeDefaultAppPath,
      "declare const t: any;\nexport const type = t?.type || 'expense';", 0],
    ['a nullish type default in app code', typeDefaultAppPath,
      "declare const t: any;\nexport const type = t.type ?? 'expense';", 0],
    ['a default on a member that is not a type in app code', typeDefaultAppPath,
      "declare const t: any;\nexport const kind = t.kind || 'expense';", 0],
    ['a type default that is not a transaction side in app code', typeDefaultAppPath,
      "declare const t: any;\nexport const type = t.type || 'unknown';", 0],
    ['the hitting form in a spec', 'src/app/core/services/type-fixture.service.spec.ts',
      "declare const t: any;\nexport const type = t.type || 'expense';", 0],
  ];
  for (const [shape, filePath, source, expected] of typeDefaultCases) {
    const linted = await fixtureEslint.lintText(`${source}\n`, { filePath });
    check(
      `${shape} ${expected === 0 ? 'passes' : 'fails'} the rule${expected === 0 ? '' : ' once'}`,
      countSyntaxMessages(linted),
      expected
    );
  }

  // The static import bans. The population probe above proves each ban
  // resolves for a file; these prove it fires, on a real import declaration,
  // in a feature file, in a spec, at app.config.ts and in each owner's own
  // files, where a block that restated a ban short would let one through. A
  // namespace import must fail too, and the standalone pieces and the
  // adapter provider that the date-module message points to must pass.
  const importCases = [
    ['a feature component importing MatDatepickerModule', 'src/app/features/about/date-fixture.component.ts',
      "import { MatDatepickerModule } from '@angular/material/datepicker';", 1],
    ['a spec importing MatDatepickerModule', 'src/app/features/about/date-fixture.component.spec.ts',
      "import { MatDatepickerModule } from '@angular/material/datepicker';", 1],
    ['app.config.ts importing MatNativeDateModule', 'src/app/app.config.ts',
      "import { MatNativeDateModule } from '@angular/material/core';", 1],
    ['a provider service importing NativeDateModule', 'src/app/core/services/openai.service.ts',
      "import { NativeDateModule } from '@angular/material/core';", 1],
    ['an analytics owner importing NativeDateModule', 'src/app/core/services/analytics.service.ts',
      "import { NativeDateModule } from '@angular/material/core';", 1],
    ['a namespace import of the datepicker entry point', 'src/app/features/about/date-fixture.component.ts',
      "import * as dp from '@angular/material/datepicker';", 1],
    ['an import of the standalone datepicker pieces', 'src/app/features/about/date-fixture.component.ts',
      "import { MatDatepicker, MatDatepickerInput, MatDatepickerToggle } from '@angular/material/datepicker';", 0],
    ['an import of the native adapter provider', 'src/app/features/about/date-fixture.component.spec.ts',
      "import { provideNativeDateAdapter } from '@angular/material/core';", 0],
    ['a feature component importing an analytics SDK path', 'src/app/features/about/analytics-fixture.component.ts',
      "import { Analytics } from '@angular/fire/analytics';", 1],
    ['a feature component importing the firebase/analytics pattern', 'src/app/features/about/analytics-fixture.component.ts',
      "import { getAnalytics } from 'firebase/analytics';", 1],
    ['a provider service importing an analytics SDK', 'src/app/core/services/gemini.service.ts',
      "import { getAnalytics } from 'firebase/analytics';", 1],
    ['an analytics owner importing its SDK', 'src/app/core/services/analytics.service.ts',
      "import { getAnalytics } from 'firebase/analytics';", 0],
    ['a feature component importing a model SDK', 'src/app/features/about/model-fixture.component.ts',
      "import OpenAI from 'openai';", 1],
    ['an analytics owner importing a model SDK', 'src/app/core/services/analytics.service.ts',
      "import OpenAI from 'openai';", 1],
    ['a provider service importing its model SDK', 'src/app/core/services/openai.service.ts',
      "import OpenAI from 'openai';", 0],
  ];
  for (const [shape, filePath, source, expected] of importCases) {
    const linted = await fixtureEslint.lintText(`${source}\n`, { filePath });
    check(
      `${shape} ${expected === 0 ? 'passes' : 'fails'} the rule${expected === 0 ? '' : ' once'}`,
      countImportMessages(linted),
      expected
    );
  }

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
