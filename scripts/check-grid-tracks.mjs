#!/usr/bin/env node
/**
 * Catches the two `grid-template-columns` shapes docs/ui-overflow.md's G2
 * rule bans: `repeat(N, minmax(0, minmax(0, 1fr)))` (#450) and a bare `1fr`
 * track.
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
 * A bare `1fr` is the older half of the same rule and fails in the opposite
 * direction: it is valid CSS that renders, so nothing anywhere complains,
 * but an `fr` track's automatic minimum is `min-content`. The column refuses
 * to go below its widest unbreakable word — a merchant name, a pasted URL,
 * an amount at font scale 1.3 — and pushes its neighbours out of the card
 * instead of wrapping. `minmax(0, 1fr)` is the same track with the floor
 * removed, which is why every column in this app is spelled that way.
 *
 * Why a source scan and not a spec: these are component-scoped stylesheets,
 * so a Karma assertion has to instantiate the component and measure the
 * rendered `grid-template-columns` to see one, and eleven TestBed
 * configurations would test the eleven sites we already know about and
 * nothing about the twelfth. Reading the source catches every site,
 * including one added tomorrow by the same copy-paste.
 *
 * The bare-`1fr` half strips every `minmax(…)` call out of the value and
 * then looks for a surviving `fr`, rather than matching the shell grep the
 * rule shipped with (`grep 1fr | grep -v minmax(`). That grep judges a whole
 * line, so `minmax(0, 2fr) 1fr` — a repaired track beside an unrepaired one,
 * which is exactly how a half-done sweep leaves a file — reads as clean.
 * Stripping judges each track.
 *
 * What it deliberately cannot see:
 *   - A track rule that parses but is wrong: `repeat(3, minmax(0, 1fr))`
 *     where four columns were meant, or a breakpoint that never fires.
 *     Nothing about that is invalid CSS, so there is no text pattern for it —
 *     the six new specs pin the track *counts* the browser actually renders,
 *     which is the only way to catch that class of mistake.
 *   - Either shape written into a `.ts` inline style or a
 *     `[style.grid-template-columns]` binding rather than a stylesheet. The
 *     defect this gate was written for is eleven `.scss` files; widening the
 *     scan to templates and inline styles is a different-shaped problem for
 *     when it actually appears. No template or `.ts` file in the tree sets
 *     the property today.
 *   - `grid-template-columns` built up across a `@apply` of framework
 *     utilities rather than written as a literal value, or an `fr` reaching
 *     the property through a `var(--x)` declared elsewhere.
 *   - A `grid-template-columns` value wrapped across multiple lines: both
 *     patterns are matched one line at a time, so a nested `minmax(` split
 *     from its outer call by a line break is invisible, and a value whose
 *     parentheses do not balance on its own line is skipped by the bare-`1fr`
 *     half — counted and named on stdout rather than passed over in silence.
 *   - `grid-template-rows`, `grid-auto-columns` and the `grid-template`
 *     shorthand. G2 is a rule about columns, because it is horizontal
 *     overflow that breaks a card; nothing in the tree sets any of the three.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const SOURCE_DIR = 'src';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.angular', 'coverage']);

/** The invalid shape: a `minmax(` whose own argument list opens another. */
const NESTED_MINMAX = /minmax\([^()]*minmax\(/;

/**
 * A `grid-template-columns` declaration, value captured up to whichever of
 * `;` or `}` ends it — the last declaration in a one-line block may omit its
 * semicolon. An empty terminator means the value runs on to the next line.
 */
const COLUMNS_DECLARATION = /grid-template-columns\s*:([^;}]*)([;}]?)/;

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

/**
 * `value` with every balanced `minmax(…)` call removed, innermost first, so
 * what is left is the tracks nobody floored. Returns null when the
 * parentheses do not balance — a value wrapped across lines, which this
 * line-oriented scan cannot judge and must not guess at.
 */
export function withoutMinmax(value) {
  let out = value;
  for (;;) {
    const start = out.search(/minmax\s*\(/);
    if (start === -1) break;
    const open = out.indexOf('(', start);
    let depth = 0;
    let close = -1;
    for (let i = open; i < out.length; i += 1) {
      if (out[i] === '(') depth += 1;
      else if (out[i] === ')') {
        depth -= 1;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close === -1) return null;
    out = out.slice(0, start) + out.slice(close + 1);
  }
  let depth = 0;
  for (const ch of out) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (depth < 0) return null;
  }
  return depth === 0 ? out : null;
}

/** Whether a `grid-template-columns` value declares a track with no floor. */
export function hasBareFr(value) {
  const stripped = withoutMinmax(value);
  return stripped !== null && /(?<![\w-])[\d.]*fr(?![\w-])/.test(stripped);
}

/**
 * Every hit in one stylesheet, as `{ line, text, rule }`. `unbalanced` counts
 * the `grid-template-columns` declarations whose value did not close on its
 * own line — the bare-`1fr` half's one blind spot, reported rather than
 * silently passed.
 */
function scanScss(source) {
  const masked = maskComments(source);
  const hits = [];
  let unbalanced = 0;

  masked.split('\n').forEach((line, index) => {
    if (NESTED_MINMAX.test(line)) {
      hits.push({ line: index + 1, text: line.trim(), rule: 'nested' });
    }
    const declaration = line.match(COLUMNS_DECLARATION);
    if (declaration === null) return;
    if (declaration[2] === '' || withoutMinmax(declaration[1]) === null) {
      unbalanced += 1;
      return;
    }
    if (hasBareFr(declaration[1])) {
      hits.push({ line: index + 1, text: line.trim(), rule: 'bare-fr' });
    }
  });

  return { hits, unbalanced };
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

const ADVICE = {
  nested:
    'a minmax() inside a minmax() — every browser drops the whole declaration, silently',
  'bare-fr':
    "an fr track with no floor — its automatic minimum is min-content, so the column " +
    'refuses to shrink and pushes its neighbours out',
};

function run() {
  const files = walk(SOURCE_DIR);
  const offences = [];
  let unbalanced = 0;

  for (const file of files) {
    const scan = scanScss(readFileSync(file, 'utf8'));
    unbalanced += scan.unbalanced;
    for (const hit of scan.hits) {
      offences.push({ file: posix(file), ...hit });
    }
  }

  console.log(
    `Checked ${files.length} stylesheets for grid tracks a browser cannot parse and for fr ` +
      'tracks with no floor.'
  );
  console.log(
    unbalanced === 0
      ? 'Skipped 0 grid-template-columns values that did not close on their own line.'
      : `Skipped ${unbalanced} grid-template-columns value(s) that did not close on their own line.`
  );

  if (offences.length > 0) {
    offences.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
    console.error(`\n${offences.length} grid track declaration(s) off G2:\n`);
    for (const { file, line, text, rule } of offences) {
      console.error(`  ${file}:${line}  ${text}`);
      console.error(`      ${ADVICE[rule]}`);
    }
    console.error(
      `\nEvery column in this app is \`minmax(0, 1fr)\` — the floor removed, the track still\n` +
        `equal. Write \`repeat(N, minmax(0, 1fr))\`, never \`repeat(N, 1fr)\` and never a\n` +
        `minmax() nested inside another. Reference: docs/ui-overflow.md, rule G2.\n`
    );
    process.exit(1);
  }

  console.log('No grid track declaration is unparseable, and every fr track carries a floor.');
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

  const hits = (source) => scanScss(source).hits.map((hit) => hit.text);
  const rules = (source) => scanScss(source).hits.map((hit) => hit.rule);

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
  check('a bare single track', rules('.a { grid-template-columns: 1fr; }'), ['bare-fr']);
  check('a bare repeat', rules('.a { grid-template-columns: repeat(3, 1fr); }'), ['bare-fr']);
  check('a bare track beside a fixed one', rules('.a { grid-template-columns: 200px 1fr; }'), ['bare-fr']);
  check('a weighted bare track', rules('.a { grid-template-columns: 2fr 1fr; }'), ['bare-fr']);
  check('a fractional bare track', rules('.a { grid-template-columns: 0.5fr auto; }'), ['bare-fr']);
  // The shell grep the rule shipped with judges the whole line, so a repaired
  // track beside an unrepaired one — exactly how a half-done sweep leaves a
  // file — reads as clean to it. Stripping judges each track.
  check(
    'a bare track hiding beside a floored one',
    rules('.a { grid-template-columns: minmax(0, 2fr) 1fr; }'),
    ['bare-fr']
  );
  check(
    'a bare track inside a repeat beside a floored one',
    rules('.a { grid-template-columns: repeat(2, minmax(0, 1fr)) 1fr; }'),
    ['bare-fr']
  );
  check(
    'a declaration closed by the block rather than a semicolon',
    rules('.a { grid-template-columns: 1fr }'),
    ['bare-fr']
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
    'a single floored track is fine',
    hits('.a { grid-template-columns: minmax(0, 1fr); }'),
    []
  );
  check(
    'two floored tracks of different weights are fine',
    hits('.a { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }'),
    []
  );
  check(
    'no fr at all is fine',
    hits('.a { grid-template-columns: auto 200px max-content; }'),
    []
  );
  // `fr` is a unit, not a word fragment: a custom property or a class name
  // that happens to contain the letters is not a track.
  check(
    'a custom property whose name contains fr is not a track',
    hits('.a { grid-template-columns: var(--frame-width) minmax(0, 1fr); }'),
    []
  );
  check(
    'another property with 1fr is not grid-template-columns',
    hits('.a { grid-template-rows: 1fr; }'),
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
  check(
    'a bare track inside a comment',
    hits('// grid-template-columns: repeat(3, 1fr);\n.a { color: red; }'),
    []
  );

  // --- the skipped value ----------------------------------------------------
  check(
    'a value wrapped across lines is skipped, not guessed at',
    scanScss('.a {\n  grid-template-columns:\n    repeat(3, 1fr);\n}'),
    { hits: [], unbalanced: 1 }
  );
  check(
    'a value that closes on its own line is not skipped',
    scanScss('.a { grid-template-columns: repeat(3, minmax(0, 1fr)); }').unbalanced,
    0
  );

  // --- the stripper ---------------------------------------------------------
  check('strips a plain minmax', withoutMinmax('repeat(3, minmax(0, 1fr))'), 'repeat(3, )');
  check('strips a nested minmax whole', withoutMinmax('minmax(0, minmax(0, 1fr))'), '');
  check('leaves a bare track behind', withoutMinmax('minmax(0, 2fr) 1fr'), ' 1fr');
  check('refuses an unbalanced value', withoutMinmax('repeat(3, minmax(0, 1fr)'), null);

  // --- reporting ------------------------------------------------------------
  check('line numbers survive masking', scanScss('\n\n.a { grid-template-columns: repeat(2, minmax(0, minmax(0, 1fr))); }').hits[0].line, 3);
  check('each rule names what is wrong with it', Object.keys(ADVICE).sort(), ['bare-fr', 'nested']);

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
