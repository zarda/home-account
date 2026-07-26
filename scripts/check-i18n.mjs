#!/usr/bin/env node
/**
 * Checks that every statically-written translation key resolves in every locale.
 *
 * TranslationService.t() returns the key itself when a lookup misses, and loading
 * a locale replaces the whole dictionary, so there is no fallback to English. A key
 * that is missing from one locale therefore renders as raw text like
 * `import.noTransactions` for users on that locale — silent in tests, visible in the UI.
 *
 * Key-set parity between locales is asserted in translation-keys.spec.ts, which runs
 * with the unit suite. This script covers the other half: keys referenced by the
 * source that no locale defines at all.
 *
 * Only literal keys can be checked. Dynamic keys (`'prefix.' + value | translate`,
 * `chip.labelKey | translate`) are skipped and counted in the summary.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const LOCALES = ['en', 'ja', 'tc'];
const I18N_DIR = 'src/assets/i18n';
const SOURCE_DIR = 'src/app';

/** `'some.key' | translate` inside a template. */
const PIPE_KEY = /'([A-Za-z0-9_.]+)'\s*\|\s*translate/g;
/** `t('some.key')` — the leading \b keeps `format(`, `at(` and friends out. */
const T_CALL_KEY = /\bt\(\s*'([A-Za-z0-9_.]+)'/g;
/** A `| translate` whose left side is not a single quoted literal. */
const DYNAMIC_PIPE = /\|\s*translate/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...walk(path));
    } else if (/\.(ts|html)$/.test(entry) && !/\.spec\.ts$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

function flatten(value, prefix = '', out = new Set()) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flatten(child, path, out);
    } else {
      out.add(path);
    }
  }
  return out;
}

const defined = {};
for (const locale of LOCALES) {
  defined[locale] = flatten(JSON.parse(readFileSync(join(I18N_DIR, `${locale}.json`), 'utf8')));
}

/** key -> Set of `file:line` that reference it */
const referenced = new Map();
let dynamicCount = 0;

for (const file of walk(SOURCE_DIR)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const pattern of [PIPE_KEY, T_CALL_KEY]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        const where = `${relative('.', file)}:${index + 1}`;
        const seen = referenced.get(match[1]) ?? new Set();
        seen.add(where);
        referenced.set(match[1], seen);
      }
    }
    // Count `| translate` occurrences that no literal-key match accounts for.
    const pipes = line.match(DYNAMIC_PIPE)?.length ?? 0;
    if (pipes > 0) {
      const literals = line.match(PIPE_KEY)?.length ?? 0;
      dynamicCount += Math.max(0, pipes - literals);
    }
  });
}

const failures = [];
for (const [key, sites] of [...referenced].sort(([a], [b]) => a.localeCompare(b))) {
  const missing = LOCALES.filter(locale => !defined[locale].has(key));
  if (missing.length > 0) {
    failures.push({ key, missing, sites: [...sites].sort() });
  }
}

console.log(
  `Checked ${referenced.size} literal keys ` +
    `(${dynamicCount} dynamic ${dynamicCount === 1 ? 'usage' : 'usages'} skipped) ` +
    `against ${LOCALES.map(l => `${l}:${defined[l].size}`).join(' ')}`
);

if (failures.length > 0) {
  console.error(`\n${failures.length} key(s) do not resolve in every locale:\n`);
  for (const { key, missing, sites } of failures) {
    console.error(`  ${key} — missing from ${missing.join(', ')}`);
    for (const site of sites) {
      console.error(`      ${site}`);
    }
  }
  console.error('\nAdd the key to every locale under src/assets/i18n/, or stop referencing it.');
  process.exit(1);
}

console.log('Every literal translation key resolves in every locale.');
