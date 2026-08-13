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
 * `--self-test` exercises the extraction and diff helpers against known
 * shapes and exits non-zero if the checker itself is broken; npm's
 * lint-guards:check chains it first, as i18n:check and prompts:check do.
 *
 * What it deliberately cannot see:
 *   - A population nobody listed. It probes representative files; a future
 *     exemption block for a fourth SDK family needs a row in POPULATIONS.
 *   - A dynamic import('firebase/analytics'). The rule flags static import
 *     declarations only; import() passes it, and the registry check cannot
 *     see one either.
 *   - Whether the rule would actually fire on a banned import. This proves
 *     the ban is in force for the file, not that ESLint works.
 */

import { existsSync } from 'node:fs';
import { ESLint } from 'eslint';

const RULE_KEY = '@typescript-eslint/no-restricted-imports';

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

  console.log(
    `Resolved ${RULE_KEY} for ${fileCount} files across ${POPULATIONS.length} populations.`
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

function selfTest() {
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
  selfTest();
} else {
  await run();
}
