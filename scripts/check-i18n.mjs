#!/usr/bin/env node
/**
 * Checks that every user-facing string reaches the translation catalog.
 *
 * TranslationService.t() returns the key itself when a lookup misses, and
 * loading a locale replaces the whole dictionary, so there is no fallback to
 * English: a missing key renders as raw text like `import.noTransactions` —
 * silent in tests, visible in the UI. Three scans:
 *
 *   1. Every statically-written translation key must resolve in every locale.
 *      `t(` calls are read with a balanced-argument walk over the whole file,
 *      not a per-line regex: a call whose first argument is a ternary or
 *      starts on the next line is seen too (#260 shipped through the old
 *      line-by-line pattern). A literal counts as a key only when it is
 *      dot-namespaced, so comparison literals inside the ternary condition
 *      (`filters.type === 'expense' ? …`) are not mistaken for keys.
 *   2. A catalog leaf may be a plural object — members drawn from the CLDR
 *      cardinal categories, string values (#272). Only en.json carries
 *      members; ja and tc need no number agreement and stay plain strings.
 *      flatten() records the bare path either way, so the key sets stay
 *      comparable across shapes.
 *   3. A template must not hard-code `aria-label="…"` text: screen-reader
 *      users would hear English on every locale, and nothing else notices
 *      (#273). The bound forms pass — `[attr.aria-label]="'…' | translate"`
 *      (the convention), `[aria-label]="expr"`, and `aria-label="{{ … }}"`.
 *
 * Key-set parity between locales is asserted in translation-keys.spec.ts,
 * which runs with the unit suite. Only literal keys can be checked; dynamic
 * keys (`'prefix.' + value | translate`, `t(chip.labelKey)`) are skipped and
 * counted in the summary. A commented-out call still counts as a reference —
 * that errs toward requiring keys that exist, never toward missing one.
 *
 * `--self-test` exercises the parser against known shapes and exits non-zero
 * if the checker itself is broken; npm's i18n:check chains it first, as
 * prompts:check does. Reference documentation lives in docs/i18n.md.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const LOCALES = ['en', 'ja', 'tc'];
const I18N_DIR = 'src/assets/i18n';
const SOURCE_DIR = 'src/app';

/** `'some.key' | translate` inside a template. */
const PIPE_KEY = /'([A-Za-z0-9_.]+)'\s*\|\s*translate/g;
/** A `| translate` whose left side is not a single quoted literal. */
const DYNAMIC_PIPE = /\|\s*translate/g;
/**
 * A literal `aria-label="…"` attribute. The bound forms never match: in
 * `[attr.aria-label]=` and `[aria-label]=` the name is followed by `]`, not
 * `=`, and the lookbehind keeps suffixed names (`data-aria-label`) out. The
 * lookahead exempts `aria-label="{{ … }}"`. (`aria-labelledby` never matches:
 * its name continues past `label`.)
 */
const STATIC_ARIA = /(?<![\w.[-])aria-label\s*=\s*"(?!\{\{)([^"]*)"/g;

const PLURAL_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

/** A leaf may be a plural object: every key a CLDR category, every value a string. */
function isPluralObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every(key => PLURAL_CATEGORIES.has(key)) &&
    Object.values(value).every(member => typeof member === 'string')
  );
}

function flatten(value, prefix = '', out = new Set()) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child) && !isPluralObject(child)) {
      flatten(child, path, out);
    } else {
      out.add(path);
    }
  }
  return out;
}

/**
 * Collects the keys named in the first argument of every `t(` call in a file.
 *
 * Walks the characters of the first argument — to the first top-level comma
 * or the balanced close — tracking paren depth and quote state, and gathers
 * every quoted literal shaped like a key (charset [A-Za-z0-9_.], at least one
 * dot). A first argument that yields no key-shaped literal (an identifier, a
 * template literal, `t(chip.labelKey)`) is dynamic: counted, not failed.
 * A call left unbalanced at end-of-file is ignored.
 */
function extractTCallKeys(text) {
  const keys = [];
  let dynamicCount = 0;
  const T_OPEN = /\bt\(/g;
  let open;
  while ((open = T_OPEN.exec(text)) !== null) {
    const literals = [];
    let depth = 1;
    let quote = null;
    let ended = false;
    let i = open.index + open[0].length;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (quote !== null) {
        if (ch === '\\') { i++; continue; }
        if (ch === quote.ch) {
          if (quote.ch !== '`') literals.push(text.slice(quote.start, i));
          quote = null;
        }
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { quote = { ch, start: i + 1 }; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) { ended = true; break; } }
      else if (ch === ',' && depth === 1) { ended = true; break; }
    }
    if (!ended) continue;
    const keyShaped = literals.filter(l => /^[A-Za-z0-9_.]+$/.test(l) && l.includes('.'));
    if (keyShaped.length > 0) {
      for (const key of keyShaped) keys.push({ key, index: open.index });
    } else {
      dynamicCount++;
    }
  }
  return { keys, dynamicCount };
}

/** Literal aria-label offences with their character index. */
function findStaticAriaLabels(text) {
  const offences = [];
  STATIC_ARIA.lastIndex = 0;
  let match;
  while ((match = STATIC_ARIA.exec(text)) !== null) {
    offences.push({ index: match.index, value: match[1] });
  }
  return offences;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

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

function run() {
  const defined = {};
  for (const locale of LOCALES) {
    defined[locale] = flatten(JSON.parse(readFileSync(join(I18N_DIR, `${locale}.json`), 'utf8')));
  }

  /** key -> Set of `file:line` that reference it */
  const referenced = new Map();
  let dynamicCount = 0;
  const ariaOffences = [];

  for (const file of walk(SOURCE_DIR)) {
    const text = readFileSync(file, 'utf8');
    const where = index => `${relative('.', file)}:${lineOf(text, index)}`;

    const calls = extractTCallKeys(text);
    dynamicCount += calls.dynamicCount;
    for (const { key, index } of calls.keys) {
      const seen = referenced.get(key) ?? new Set();
      seen.add(where(index));
      referenced.set(key, seen);
    }

    text.split('\n').forEach((line, lineIndex) => {
      PIPE_KEY.lastIndex = 0;
      let match;
      while ((match = PIPE_KEY.exec(line)) !== null) {
        const seen = referenced.get(match[1]) ?? new Set();
        seen.add(`${relative('.', file)}:${lineIndex + 1}`);
        referenced.set(match[1], seen);
      }
      // Count `| translate` occurrences that no literal-key match accounts for.
      const pipes = line.match(DYNAMIC_PIPE)?.length ?? 0;
      if (pipes > 0) {
        const literals = line.match(PIPE_KEY)?.length ?? 0;
        dynamicCount += Math.max(0, pipes - literals);
      }
    });

    if (file.endsWith('.html')) {
      for (const offence of findStaticAriaLabels(text)) {
        ariaOffences.push({ site: where(offence.index), value: offence.value });
      }
    }
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

  let failed = false;
  if (failures.length > 0) {
    failed = true;
    console.error(`\n${failures.length} key(s) do not resolve in every locale:\n`);
    for (const { key, missing, sites } of failures) {
      console.error(`  ${key} — missing from ${missing.join(', ')}`);
      for (const site of sites) console.error(`      ${site}`);
    }
    console.error('\nAdd the key to every locale under src/assets/i18n/ (see docs/i18n.md), or stop referencing it.');
  }
  if (ariaOffences.length > 0) {
    failed = true;
    console.error(`\n${ariaOffences.length} hard-coded aria-label(s) — screen readers hear English on every locale:\n`);
    for (const { site, value } of ariaOffences.sort((a, b) => a.site.localeCompare(b.site))) {
      console.error(`  ${site} aria-label="${value}"`);
    }
    console.error('\nBind it instead: [attr.aria-label]="\'some.key\' | translate" (see docs/i18n.md).');
  }
  if (failed) process.exit(1);

  console.log('Every literal translation key resolves in every locale, and no template hard-codes an aria-label.');
}

function selfTest() {
  const cases = [];
  function check(name, actual, expected) {
    cases.push({ name, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
  }
  const calledKeys = text => extractTCallKeys(text).keys.map(k => k.key);

  check('reads a same-line t() key', calledKeys("this.translationService.t('common.save')"), ['common.save']);
  check(
    'reads both keys of a split call with a ternary first argument',
    calledKeys("this.translationService.t(\n  filters.type === 'expense' ? 'common.expense' : 'common.income');"),
    ['common.expense', 'common.income']
  );
  check(
    'does not take the comparison literal in the condition for a key',
    calledKeys("t(kind === 'expense' ? 'a.b' : 'c.d')"),
    ['a.b', 'c.d']
  );
  check('stops at the first top-level comma', calledKeys("t('import.verifyAmount', { percent })"), ['import.verifyAmount']);
  check('reads a key through nested parens in the argument', calledKeys("t((flag ? 'a.b' : 'c.d'))"), ['a.b', 'c.d']);
  check('counts an identifier argument as dynamic', extractTCallKeys('this.t(chip.labelKey)').dynamicCount, 1);
  check('counts a template-literal argument as dynamic', extractTCallKeys('t(`insights.stale_${reason}`)').dynamicCount, 1);
  check('keeps format( and friends out', calledKeys("format('a.b')"), []);
  check('ignores a call left unbalanced at end-of-file', calledKeys("t('a.b'"), []);
  check('a quoted paren does not end the argument', calledKeys("t(cond ? 'a.b' : ')' + x)"), ['a.b']);

  check('flattens a plural object as one leaf', [...flatten({ a: { one: 'x', other: 'y' } })], ['a']);
  check('recurses into an ordinary namespace', [...flatten({ a: { b: 'x' } })], ['a.b']);
  check('a CLDR-named member holding an object is a namespace, not a plural', [...flatten({ a: { one: { b: 'x' } } })], ['a.one.b']);
  check('a namespace with one stray key is not a plural leaf', [...flatten({ a: { one: 'x', extra: 'y' } })], ['a.one', 'a.extra']);

  check('flags a static aria-label', findStaticAriaLabels('<button aria-label="User menu">').map(o => o.value), ['User menu']);
  check('allows [attr.aria-label] bound through translate', findStaticAriaLabels(`<button [attr.aria-label]="'common.userMenu' | translate">`), []);
  check('allows a bound [aria-label]', findStaticAriaLabels('<div [aria-label]="label()">'), []);
  check('allows an interpolated aria-label', findStaticAriaLabels(`<div aria-label="{{ 'k.x' | translate }}">`), []);
  check('does not flag aria-labelledby', findStaticAriaLabels('<div aria-labelledby="title-id">'), []);

  PIPE_KEY.lastIndex = 0;
  check('reads a pipe key', PIPE_KEY.exec(`{{ 'common.save' | translate }}`)?.[1], 'common.save');

  const failed = cases.filter(c => !c.ok);
  for (const c of cases) {
    console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}`);
    if (!c.ok) {
      console.error(`       expected ${JSON.stringify(c.expected)}`);
      console.error(`       actual   ${JSON.stringify(c.actual)}`);
    }
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} self-test failure(s) — the checker itself is broken.`);
    process.exit(1);
  }
  console.log(`check-i18n self-test: ${cases.length} passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  run();
}
