#!/usr/bin/env node
/**
 * Catches `repeat(N, minmax(0, minmax(0, 1fr)))` before it ships again (#450).
 *
 * A `minmax()` cannot be the max of another `minmax()` — CSS Grid's spec
 * disallows it — so a browser does not clamp the inner call and fall back to
 * something sensible; it drops the whole `grid-template-columns`
 * declaration. The rule above it in the cascade (often the mobile
 * single-column default) is what actually renders, so the page stays
 * single-column on tablet and desktop with no error anywhere: not in the
 * build, not in the console, not in a screenshot taken at the wrong width.
 * Eleven sites had exactly this shape, all six pages built the same way —
 * copy-pasted from wherever the pattern was first written.
 *
 * Why a source scan and not a spec: these are component-scoped stylesheets,
 * so a Karma assertion has to instantiate the component and measure the
 * rendered `grid-template-columns` to see one, and eleven TestBed
 * configurations would test the eleven sites we already know about and
 * nothing about the twelfth. Reading the source catches every site,
 * including one added tomorrow by the same copy-paste.
 *
 * What it deliberately cannot see:
 *   - A track rule that parses but is wrong: `repeat(3, minmax(0, 1fr))`
 *     where four columns were meant, or a breakpoint that never fires.
 *     Nothing about that is invalid CSS, so there is no text pattern for it —
 *     the six new specs pin the track *counts* the browser actually renders,
 *     which is the only way to catch that class of mistake.
 *   - The same double-`minmax` shape written into a `.ts` inline style or a
 *     `[style.grid-template-columns]` binding rather than a stylesheet. The
 *     defect this gate was written for is eleven `.scss` files; widening the
 *     scan to templates and inline styles is a different-shaped problem for
 *     when it actually appears.
 *   - `grid-template-columns` built up across a `@apply` of framework
 *     utilities rather than written as a literal value.
 *   - A `grid-template-columns` value wrapped across multiple lines: the
 *     pattern is matched one line at a time, so a nested `minmax(` split
 *     from its outer call by a line break is invisible to it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const SOURCE_DIR = 'src';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.angular', 'coverage']);

/** The invalid shape: a `minmax(` whose own argument list opens another. */
const NESTED_MINMAX = /minmax\([^()]*minmax\(/;

/**
 * Blanks comments while preserving every byte offset, so a line number taken
 * from the masked text still points at the real line. A nested `minmax`
 * written in a comment to explain what NOT to do is not itself the defect.
 * (Copied from check-direction.mjs, which copied it from check-truncation.mjs
 * — each gate script stays runnable on its own.)
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

/** Every `.scss` file's nested-`minmax` hits, as `{ line, text }`. */
function scanScss(source) {
  const masked = maskComments(source);
  const hits = [];
  masked.split('\n').forEach((line, index) => {
    if (NESTED_MINMAX.test(line)) {
      hits.push({ line: index + 1, text: line.trim() });
    }
  });
  return hits;
}

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (entry.endsWith('.scss')) found.push(path);
  }
  return found;
}

function posix(path) {
  return path.split(sep).join('/');
}

function run() {
  const files = walk(SOURCE_DIR);
  const offences = [];

  for (const file of files) {
    const hits = scanScss(readFileSync(file, 'utf8'));
    for (const hit of hits) {
      offences.push({ file: posix(file), ...hit });
    }
  }

  console.log(`Checked ${files.length} stylesheets for grid tracks a browser cannot parse.`);

  if (offences.length > 0) {
    offences.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
    console.error(`\n${offences.length} unparseable grid track declaration(s) found:\n`);
    for (const { file, line, text } of offences) {
      console.error(`  ${file}:${line}  ${text}`);
    }
    console.error(
      `\nA minmax() cannot be the max of another minmax() — the whole\n` +
        `grid-template-columns declaration is dropped, silently, by every browser.\n` +
        `Write \`repeat(N, minmax(0, 1fr))\` instead.\n`
    );
    process.exit(1);
  }

  console.log('No grid track declaration is unparseable.');
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

  const hits = (source) => scanScss(source).map((hit) => hit.text);

  // --- must hit -----------------------------------------------------------
  check(
    'the nested shape',
    hits('.a { grid-template-columns: repeat(3, minmax(0, minmax(0, 1fr))); }'),
    ['.a { grid-template-columns: repeat(3, minmax(0, minmax(0, 1fr))); }']
  );
  check(
    'the nested shape after a @media line',
    hits(
      '@media (min-width: 768px) {\n' +
        '  .a { grid-template-columns: repeat(2, minmax(0, minmax(0, 1fr))); }\n' +
        '}\n'
    ),
    ['.a { grid-template-columns: repeat(2, minmax(0, minmax(0, 1fr))); }']
  );

  // --- must not hit ---------------------------------------------------------
  check(
    'a plain repeat is fine',
    hits('.a { grid-template-columns: repeat(3, minmax(0, 1fr)); }'),
    []
  );
  check(
    'auto-fill with a pixel minimum is fine',
    hits('.a { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); }'),
    []
  );
  check(
    'the nested shape inside a line comment',
    hits('// grid-template-columns: repeat(3, minmax(0, minmax(0, 1fr)));\n.a { color: red; }'),
    []
  );
  check(
    'the nested shape inside a block comment',
    hits('/* grid-template-columns: repeat(3, minmax(0, minmax(0, 1fr))); */\n.a { color: red; }'),
    []
  );

  // --- reporting ------------------------------------------------------------
  check('line numbers survive masking', scanScss('\n\n.a { grid-template-columns: repeat(2, minmax(0, minmax(0, 1fr))); }')[0].line, 3);

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
  console.log(`check-grid-tracks self-test: ${results.length} passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  run();
}
