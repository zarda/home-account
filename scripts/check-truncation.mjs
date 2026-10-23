#!/usr/bin/env node
/**
 * Enforces G3 in docs/ui-overflow.md: nothing in the app truncates.
 *
 * ADR 0010 decided this and swept the transaction row. The rule was written
 * down and the check was written down with it — as a grep, in the doc, that
 * the reader was invited to run. Thirteen `text-overflow: ellipsis`
 * declarations went on living through two releases anyway, because a check
 * nobody runs is a check that quietly stops being one. This is that grep,
 * wired into CI so it runs whether or not anybody remembers it.
 *
 * Why a script rather than a spec: these are component-scoped styles, so a
 * Karma assertion has to instantiate the component to see them, and thirteen
 * TestBed configurations would test the thirteen sites we already know about
 * and nothing about the fourteenth. Reading the source catches every site,
 * including ones added tomorrow.
 *
 * What it sees, in every .scss, .css, .ts and .html file under src/:
 *   - a `text-overflow:` declaration;
 *   - Tailwind's ellipsis utilities — `truncate`, `text-ellipsis` and the
 *     older `overflow-ellipsis` — as an `@apply` token, and as a class token
 *     in a template: `class="… truncate …"`, `[class.truncate]`, and the same
 *     inside a component's inline `template:` string, and in a component's
 *     host metadata: `host: { class: '… truncate …' }` and
 *     `'[class.truncate]'`. Each is `text-overflow: ellipsis` under another
 *     name, which the declaration grep read straight past: the dashboard's
 *     budget card cut *Food & Dining* to *Food & Dini…* through two
 *     `@apply truncate`s while this check reported that nothing truncates.
 *     Token-exact, with a variant prefix (`md:truncate`) or the important
 *     flag (`!truncate`) read through: `truncated-notice`, `truncate-x` and
 *     the word `truncated` in a string are not the utility.
 *
 * Comments are not code, so none of this is read inside one: line and block
 * comments in stylesheets and TypeScript, `<!-- -->` in .html templates. A
 * template is not JavaScript, so a `//` in a URL in its text is text. An
 * HTML comment inside an inline `template:` string is still read, as the
 * TypeScript string it sits in.
 *
 * What it deliberately cannot see:
 *   - A utility composed under another name: a plugin or a component class
 *     in tailwind.config.js that sets `text-overflow` outside src/ and is
 *     applied by its own name.
 *   - The utility spelled inside an expression. The check reads class lists
 *     and does not parse expressions, so it is blind to a key of an
 *     `[ngClass]` object (`{ truncate: long }`), a `[class]` or
 *     `classList.add()` argument, and a quoted token inside an interpolation
 *     in a class list (`class="a {{ long ? 'truncate' : '' }}"`).
 *   - `line-clamp` and any truncation built some other way: a fixed height
 *     over `overflow: hidden`, a slice() in a template. Geometry is what
 *     catches those, and shared/overflow-guard.spec.ts is where that lives.
 *   - `text-overflow` arriving through a third-party stylesheet. Material sets
 *     it on its own internals, which is not ours to police here.
 *
 * `--self-test` runs the scanner against the shapes it must and must not
 * report, so a change to the patterns cannot quietly blind it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const SOURCE_DIR = 'src';
const EXTENSIONS = ['.scss', '.css', '.ts', '.html'];
const TEMPLATE_EXTENSIONS = ['.html', '.ts'];
const DOC = 'docs/ui-overflow.md';

/** Tailwind 3's utilities that set `text-overflow: ellipsis`. */
const ELLIPSIS_UTILITIES = new Set(['truncate', 'text-ellipsis', 'overflow-ellipsis']);

/**
 * Blanks the comments of a stylesheet or a TypeScript file while preserving
 * every byte offset, so a line number taken from the masked text still points
 * at the real line. Prose *about* truncation is not a truncation: several
 * stylesheets explain at length why their `text-overflow` was deleted, and
 * those notes are the reason the next person does not put it back.
 */
function maskComments(source) {
  const out = source.split('');
  let i = 0;
  let state = 'code'; // code | line | block | single | double | template
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (c === '/' && next === '*') { state = 'block'; out[i] = out[i + 1] = ' '; i += 2; continue; }
      if (c === '/' && next === '/') { state = 'line'; out[i] = out[i + 1] = ' '; i += 2; continue; }
      if (c === "'") state = 'single';
      else if (c === '"') state = 'double';
      else if (c === '`') state = 'template';
    } else if (state === 'block') {
      if (c === '*' && next === '/') { state = 'code'; out[i] = out[i + 1] = ' '; i += 2; continue; }
      if (c !== '\n') out[i] = ' ';
    } else if (state === 'line') {
      if (c === '\n') state = 'code';
      else out[i] = ' ';
    } else if (state === 'single' && c === "'" && source[i - 1] !== '\\') state = 'code';
    else if (state === 'double' && c === '"' && source[i - 1] !== '\\') state = 'code';
    else if (state === 'template' && c === '`' && source[i - 1] !== '\\') state = 'code';
    i += 1;
  }
  return out.join('');
}

/**
 * Blanks the `<!-- -->` comments of an .html template, preserving every byte
 * offset as maskComments does. Only those: `//` and `/*` in a template are
 * text (a URL in a sentence, `accept="image/*"`), and reading them as
 * JavaScript comments blanked the rest of the line, class list and all. An
 * unclosed comment runs to the end of the file, as it does in the parser.
 */
function maskHtmlComments(source) {
  return source.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/**
 * The utility a class or `@apply` token names, without its variants or its
 * important flag: `md:!truncate` and `[&>span]:truncate` are `truncate`. The
 * variant separator is the last colon outside an arbitrary-value bracket.
 */
function utilityOf(token) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i += 1) {
    const c = token[i];
    if (c === '[') depth += 1;
    else if (c === ']') depth = Math.max(0, depth - 1);
    else if (c === ':' && depth === 0) start = i + 1;
  }
  return token.slice(start).replace(/^!/, '');
}

/** Each whitespace-separated token of `text`, with its offset in the source. */
function* tokens(text, offset) {
  for (const match of text.matchAll(/\S+/g)) {
    yield { token: match[0], at: offset + match.index };
  }
}

/**
 * Every truncation in one file's source, as `{ at, what }`: `at` is a byte
 * offset into the source, `what` names what was seen.
 */
function scanSource(source, extension) {
  const masked = extension === '.html' ? maskHtmlComments(source) : maskComments(source);
  const found = [];
  /** Reports each ellipsis utility among the class tokens of `value`. */
  const classList = (value, valueAt, label) => {
    for (const { token, at } of tokens(value, valueAt)) {
      const utility = utilityOf(token);
      if (ELLIPSIS_UTILITIES.has(utility)) found.push({ at, what: `${label} ${utility}` });
    }
  };

  // The declaration, not the word. `text-overflow` appears in prose in half
  // a dozen comments explaining why it is gone, and those are masked above,
  // but requiring the colon costs nothing and makes the intent obvious.
  for (const match of masked.matchAll(/text-overflow\s*:/g)) {
    found.push({ at: match.index, what: 'text-overflow' });
  }

  // `@apply` in a stylesheet, or in a component's inline `styles`. The
  // tokens run to the end of the declaration, which may span lines.
  for (const match of masked.matchAll(/@apply\b([^;{}]*)/g)) {
    const bodyAt = match.index + match[0].length - match[1].length;
    for (const { token, at } of tokens(match[1], bodyAt)) {
      const utility = utilityOf(token);
      if (ELLIPSIS_UTILITIES.has(utility)) found.push({ at, what: `@apply ${utility}` });
    }
  }

  if (TEMPLATE_EXTENSIONS.includes(extension)) {
    // A static class list, in either quote. `[class]` and `ngClass` bind an
    // expression, not a list, and do not match `class=` here.
    for (const match of masked.matchAll(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const value = match[1] ?? match[2];
      classList(value, match.index + match[0].length - value.length - 1, 'class');
    }
    // Also a host binding, `host: { '[class.truncate]': 'long' }`. Read through
    // a variant and the important flag, as a class list is.
    for (const match of masked.matchAll(/\[class\.([^\]\s]+)\]/g)) {
      const utility = utilityOf(match[1]);
      if (ELLIPSIS_UTILITIES.has(utility)) found.push({ at: match.index, what: `[class.${utility}]` });
    }
  }

  // A component's host class, `host: { class: '…' }`: a static class list in
  // a TypeScript string. A key with an unquoted value (`class: string` in a
  // type) is not one.
  if (extension === '.ts') {
    for (const match of masked.matchAll(/(?:\bclass|'class'|"class")\s*:\s*(?:'([^'\n]*)'|"([^"\n]*)")/g)) {
      const value = match[1] ?? match[2];
      classList(value, match.index + match[0].length - value.length - 1, 'host class');
    }
  }

  const lines = masked.split('\n');
  return found
    .sort((a, b) => a.at - b.at)
    .map(({ at, what }) => {
      const line = masked.slice(0, at).split('\n').length;
      return { line, what, text: lines[line - 1].trim() };
    });
}

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) found.push(path);
  }
  return found;
}

function run() {
  const files = walk(SOURCE_DIR);
  const offences = [];

  for (const file of files) {
    for (const hit of scanSource(readFileSync(file, 'utf8'), extname(file))) {
      offences.push({ file, ...hit });
    }
  }

  console.log(`Checked ${files.length} source files for truncation.`);

  if (offences.length > 0) {
    console.error(`\n${offences.length} truncation(s) found:\n`);
    for (const { file, line, what, text } of offences) {
      console.error(`  ${file}:${line}  ${text}  (${what})`);
    }
    console.error(
      `\nG3 in ${DOC}: nothing truncates. Text wraps — with \`overflow-wrap: anywhere\`\n` +
        `where the content may contain an unbreakable run — and a value that must stay on\n` +
        `one line carries appFitText and scales to the 12px floor instead.\n` +
        `Tailwind's \`truncate\`, \`text-ellipsis\` and \`overflow-ellipsis\` utilities are\n` +
        `\`text-overflow: ellipsis\` under another name, applied with @apply or as a class.\n`
    );
    process.exit(1);
  }

  console.log('Nothing truncates.');
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

  const hits = (source, extension) => scanSource(source, extension).map((hit) => hit.what);

  // --- must hit -----------------------------------------------------------
  check('@apply truncate among other utilities', hits('.a { @apply text-sm font-medium truncate; }', '.scss'), [
    '@apply truncate',
  ]);
  check('@apply truncate alone', hits('.a { @apply truncate; }', '.scss'), ['@apply truncate']);
  check('@apply text-ellipsis', hits('.a { @apply text-ellipsis; }', '.scss'), ['@apply text-ellipsis']);
  check('@apply overflow-ellipsis', hits('.a { @apply overflow-ellipsis; }', '.scss'), ['@apply overflow-ellipsis']);
  check('@apply truncate in a .css file', hits('.a { @apply truncate; }', '.css'), ['@apply truncate']);
  check('@apply truncate behind a variant', hits('.a { @apply md:truncate; }', '.scss'), ['@apply truncate']);
  check('@apply truncate with the important flag', hits('.a { @apply sm:!truncate; }', '.scss'), [
    '@apply truncate',
  ]);
  check('@apply truncate on the next line of the declaration', hits('.a {\n  @apply text-sm\n    truncate;\n}', '.scss'), [
    '@apply truncate',
  ]);
  check(
    '@apply truncate in a component\'s inline styles',
    hits('@Component({ styles: [`.a { @apply truncate; }`] })', '.ts'),
    ['@apply truncate']
  );
  check('a text-overflow declaration', hits('.a { text-overflow: ellipsis; }', '.scss'), ['text-overflow']);
  check('truncate in a class list', hits('<span class="a truncate b"></span>', '.html'), ['class truncate']);
  check('truncate in a single-quoted class list', hits("<span class='truncate'></span>", '.html'), [
    'class truncate',
  ]);
  check('text-ellipsis in a class list', hits('<span class="text-ellipsis"></span>', '.html'), [
    'class text-ellipsis',
  ]);
  check('truncate beside an interpolation', hits('<span class="a {{ b }} truncate"></span>', '.html'), [
    'class truncate',
  ]);
  check('a [class.truncate] binding', hits('<span [class.truncate]="x"></span>', '.html'), ['[class.truncate]']);
  check(
    'truncate in an inline template',
    hits('@Component({ template: `<span class="truncate">{{ name }}</span>` })', '.ts'),
    ['class truncate']
  );
  check(
    'a [class.text-ellipsis] binding in an inline template',
    hits('@Component({ template: `<span [class.text-ellipsis]="long"></span>` })', '.ts'),
    ['[class.text-ellipsis]']
  );
  check(
    'each utility on a line is named',
    hits('<span class="truncate text-ellipsis"></span>', '.html'),
    ['class truncate', 'class text-ellipsis']
  );
  check('a host class', hits("host: { class: 'truncate' },", '.ts'), ['host class truncate']);
  check('a host class under a quoted key, behind a variant', hits('host: { \'class\': "a md:truncate" },', '.ts'), [
    'host class truncate',
  ]);
  check('a host [class.truncate] binding', hits("host: { '[class.truncate]': 'long' },", '.ts'), [
    '[class.truncate]',
  ]);
  // A binding reads through a variant and the important flag, as a class
  // list does: `md:truncate` and `!truncate` are the utility.
  check('a [class.md:truncate] binding', hits('<span [class.md:truncate]="x"></span>', '.html'), [
    '[class.truncate]',
  ]);
  check('a [class.!truncate] binding', hits('<span [class.!truncate]="x"></span>', '.html'), [
    '[class.truncate]',
  ]);
  check('a host [class.md:truncate] binding', hits("host: { '[class.md:truncate]': 'long' },", '.ts'), [
    '[class.truncate]',
  ]);
  check('a host [class.!truncate] binding', hits("host: { '[class.!truncate]': 'long' },", '.ts'), [
    '[class.truncate]',
  ]);
  // A template is not JavaScript: `//` in a URL used to blank the rest of
  // the line, and `/*` in text used to blank the rest of the file.
  check(
    'a class list after a URL in template text',
    hits('<p>see https://x.test <span class="truncate">x</span></p>', '.html'),
    ['class truncate']
  );
  check(
    'a class list after a /* in template text',
    hits('<p>a glob like *.csv or /* matches</p>\n<span class="truncate"></span>', '.html'),
    ['class truncate']
  );

  // --- must not hit -------------------------------------------------------
  // The app has a `truncated-notice` class, and `truncated` is a word in
  // strings and comments. A gate that fired on those would be turned off.
  check('a class named truncated-notice', hits('.truncated-notice {}', '.scss'), []);
  check('truncated-notice in a class list', hits('<p class="truncated-notice"></p>', '.html'), []);
  check('a line comment', hits('// truncate was here', '.scss'), []);
  check('a line comment quoting a class list', hits('// <span class="truncate"> was here', '.ts'), []);
  check('a block comment', hits('/* @apply truncate */', '.scss'), []);
  check('the word in a TS string', hits("const reason = 'truncated';", '.ts'), []);
  check('a utility that only starts with truncate', hits('.a { @apply truncate-x; }', '.scss'), []);
  check('text-overflow in prose, with no colon', hits('<p>Nothing here sets text-overflow on the box.</p>', '.html'), []);
  check('a [class.truncated] binding', hits('<p [class.truncated]="x"></p>', '.html'), []);
  check('text-clip, which does not shorten', hits('<span class="text-clip"></span>', '.html'), []);
  check('line-clamp, which geometry catches instead', hits('.a { @apply line-clamp-2; }', '.scss'), []);
  check('a class list in a stylesheet is not a template', hits('.a { content: "class=\'truncate\'"; }', '.scss'), []);
  check('a TypeScript class declaration', hits('export class TruncateService {}', '.ts'), []);
  check('an HTML comment', hits('<!-- <span class="truncate"> -->', '.html'), []);
  check('an HTML comment over several lines', hits('<!--\n  <span class="truncate">\n-->', '.html'), []);
  check('a host class that only starts with truncate', hits("host: { class: 'probe-row truncated-notice' },", '.ts'), []);
  check('a class key typed, not valued', hits('interface Cell { class: string }', '.ts'), []);
  // Blind by design, as the header says: the check does not parse
  // expressions. These pin the gap so closing it is a decision.
  check('blind: a key of an [ngClass] object', hits('<span [ngClass]="{ truncate: long }"></span>', '.html'), []);
  check(
    'blind: a quoted token inside an interpolation',
    hits('<span class="a {{ long ? \'truncate\' : \'\' }}"></span>', '.html'),
    []
  );

  // --- reporting ----------------------------------------------------------
  check(
    'line numbers survive masking',
    scanSource('/* one\n   two */\n.a { @apply truncate; }', '.scss').map((hit) => hit.line),
    [3]
  );
  check(
    'a multi-line @apply is reported on the token\'s own line',
    scanSource('.a {\n  @apply text-sm\n    truncate;\n}', '.scss').map((hit) => hit.line),
    [3]
  );
  check(
    'line numbers survive an HTML comment',
    scanSource('<!--\n  <span class="truncate">\n-->\n<span class="truncate"></span>', '.html').map((hit) => hit.line),
    [4]
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
  console.log(`check-truncation self-test: ${results.length} passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  run();
}
