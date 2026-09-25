#!/usr/bin/env node
/**
 * Keeps the two reduced-motion kill-switches in src/styles.scss intact, and
 * keeps a component stylesheet from outrunning them.
 *
 * The app honours "reduce motion" twice over: once from the OS, through
 * `@media (prefers-reduced-motion: reduce)`, and once from the in-app
 * preference AccessibilityService writes as a `.reduced-motion` class on the
 * document — a system with no such setting still gets the choice. Both
 * collapse every animation and transition to 0.01ms rather than removing
 * them, so animation-end hooks still fire (ADR 0055). Both are `!important`
 * declarations on `*`, `*::before` and `*::after`.
 *
 * `*` is specificity zero. So an `!important` duration in a component
 * stylesheet — `transition: all 0.2s ease !important`, the spelling that
 * appears when somebody is fighting a Material default — ties on importance
 * and wins on specificity, and that component keeps animating for a reader
 * who asked it not to. Nothing else in the repo can see it: it is valid CSS
 * that renders, the build says nothing, no spec measures a duration under an
 * emulated preference, and a screenshot taken with motion enabled looks
 * right. Deleting one of the two kill-switches outright is just as quiet —
 * the app would still honour the OS preference and silently drop the in-app
 * one, which is the half nobody tests on their own machine.
 *
 * Decisions worth stating, because each has a cheaper alternative that is
 * worse:
 *
 *   - The rule is narrow on purpose, and the narrowness is the point. The
 *     obvious wider gate — "every component that animates declares its own
 *     reduced-motion block", or "every component handles forced-colors" —
 *     would assert nothing here: a global kill-switch already covers every
 *     component, so a per-component block is redundant by construction, and
 *     exactly two stylesheets declare `forced-colors` because exactly two
 *     paint their own focus and selection states. A gate demanding blocks
 *     that are already unnecessary is a gate that gets waived.
 *   - Only an `!important` duration counts. Without the flag a component
 *     declaration cannot reach the kill-switch at all, whatever its
 *     specificity, so flagging every `transition: 200ms` in the tree would
 *     bury the one line that matters under a hundred that do not.
 *   - A duration of about zero is a collapse, not a competition. `transition:
 *     none !important` and `animation-duration: 0.01ms !important` are the
 *     kill-switch's own spelling, so the check reads the value and lets them
 *     through rather than matching on the property name alone.
 *   - A declaration inside the component's own `prefers-reduced-motion` block
 *     is cooperating with the switch, not racing it, so the scan tracks brace
 *     depth and skips those blocks whole. Four component stylesheets have one.
 *   - A competing declaration that cannot be fixed at once is frozen in
 *     ALLOWED with its reason, the way check-direction.mjs freezes physical
 *     CSS, rather than failing the build with no way past or being quietly
 *     excluded. ALLOWED is empty, and empty is the goal: a row is a debt with
 *     a name, and staleness fails in both directions, so a repair edits this
 *     file in the same commit.
 *
 * What it deliberately cannot see:
 *   - A duration set from TypeScript — `element.style.transitionDuration` or
 *     an Angular animation built with `animate('200ms')`. Neither is CSS the
 *     kill-switch can reach in the first place; that is a code review
 *     question, not a cascade one.
 *   - A component that wins on the cascade some other way: an inline
 *     `style="transition: 2s"` attribute, which beats any stylesheet rule
 *     without needing `!important` at all.
 *   - Whether an animation should exist. A looping background float is a
 *     judgement call; all this checks is that the reader can stop it.
 *   - `forced-colors`. Two stylesheets declare it and no rule about the rest
 *     is defensible, so this says nothing about high-contrast mode — see
 *     docs/accessibility.md.
 *   - A value wrapped across lines. The declaration scan is line-oriented,
 *     like check-grid-tracks.mjs's.
 *
 * Reference documentation lives in docs/accessibility.md.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';

const GLOBAL_STYLESHEET = 'src/styles.scss';
const COMPONENT_DIR = 'src/app';
const DOC = 'docs/accessibility.md';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.angular', 'coverage']);

/**
 * What each kill-switch must still declare. Dropping any one of them changes
 * what "reduce motion" means without changing anything that fails: losing
 * `animation-iteration-count` leaves an infinite loop running at 0.01ms a
 * frame, and losing `scroll-behavior` leaves smooth scrolling on.
 */
const REQUIRED_PROPERTIES = [
  'animation-duration',
  'animation-iteration-count',
  'transition-duration',
  'scroll-behavior',
];

/** The universal selectors each kill-switch must still carry. */
const REQUIRED_SELECTORS = ['*', '*::before', '*::after'];

/** A duration-bearing declaration: `transition`, `animation`, either `-duration`. */
const MOTION_DECLARATION = /\b(transition|animation)(?:-duration)?\s*:([^;{}]*)/g;

/** Any `<number><s|ms>` inside a value. */
const DURATION = /([\d.]+)\s*(ms|s)\b/g;

/** A duration at or under this many milliseconds is a collapse, not a race. */
const COLLAPSED_MS = 1;

/**
 * Component declarations that outrun the kill-switch, each with its reason.
 * Counts may only go down: a new hit in any file fails, and a file listed
 * here whose count dropped or reached zero fails until this table is edited
 * to match, so a repair edits it in the same commit.
 */
const ALLOWED = {};

/** A row in ALLOWED: a positive integer hit count and a non-empty reason. */
export function allowedRowValid(row) {
  return (
    Number.isInteger(row.hits) &&
    row.hits > 0 &&
    typeof row.reason === 'string' &&
    row.reason.length > 0
  );
}

/**
 * Blanks comments while preserving every byte offset, so a line number taken
 * from the masked text still points at the real line, and a brace inside a
 * comment cannot open or close a block. (Copied from check-direction.mjs,
 * which copied it from check-truncation.mjs — each gate script stays
 * runnable on its own.)
 */
export function maskComments(source) {
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

/** The balanced `{...}` body opening at or after `from`, or null. */
function blockAfter(source, from) {
  const open = source.indexOf('{', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return { open, body: source.slice(open + 1, i) };
    }
  }
  return null;
}

/** The shortest duration a value declares, in milliseconds, or null. */
export function shortestDuration(value) {
  DURATION.lastIndex = 0;
  let match;
  let shortest = null;
  while ((match = DURATION.exec(value)) !== null) {
    const ms = match[2] === 's' ? Number(match[1]) * 1000 : Number(match[1]);
    if (shortest === null || ms < shortest) shortest = ms;
  }
  return shortest;
}

/**
 * The kill-switch state of the global stylesheet: for each switch, whether
 * its block was found, which required properties are missing, which are
 * declared without `!important`, and which universal selectors are gone.
 */
export function killSwitches(source) {
  const masked = maskComments(source);

  const read = (label, at) => {
    if (at === -1) return { label, found: false, missing: [], unflagged: [], selectors: [] };
    const outer = blockAfter(masked, at);
    if (outer === null) return { label, found: false, missing: [], unflagged: [], selectors: [] };
    // A media query wraps one more rule; a class rule is the rule itself.
    const inner = label === 'media' ? blockAfter(masked, outer.open + 1) : outer;
    const selectorText =
      label === 'media'
        ? masked.slice(outer.open + 1, inner === null ? outer.open + 1 : inner.open)
        : masked.slice(at, outer.open);
    const body = inner === null ? '' : inner.body;

    const missing = REQUIRED_PROPERTIES.filter(
      (property) => !new RegExp(`(^|[;{\\s])${property}\\s*:`).test(body)
    );
    const unflagged = REQUIRED_PROPERTIES.filter((property) => {
      const declaration = body.match(new RegExp(`(?:^|[;{\\s])${property}\\s*:([^;}]*)`));
      return declaration !== null && !declaration[1].includes('!important');
    });
    const selectors = REQUIRED_SELECTORS.filter((selector) => {
      const parts = selectorText
        .split(',')
        .map((part) => part.trim().replace(/^\.reduced-motion\s+/, ''));
      return !parts.includes(selector);
    });
    return { label, found: true, missing, unflagged, selectors };
  };

  return [
    read('media', masked.search(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/)),
    read('class', masked.search(/\.reduced-motion\b/)),
  ];
}

/**
 * Declarations in a component stylesheet that would outrun the kill-switch:
 * `!important`, a real duration, and not inside the file's own
 * `prefers-reduced-motion` block.
 */
export function scanComponent(source) {
  const masked = maskComments(source);
  const hits = [];
  let depth = 0;
  let cooperatingFrom = null;

  masked.split('\n').forEach((line, index) => {
    const opensCooperating =
      cooperatingFrom === null && /@media[^{]*prefers-reduced-motion/.test(line);
    if (opensCooperating) cooperatingFrom = depth;

    if (cooperatingFrom === null) {
      MOTION_DECLARATION.lastIndex = 0;
      let match;
      while ((match = MOTION_DECLARATION.exec(line)) !== null) {
        const value = match[2];
        if (!value.includes('!important')) continue;
        const duration = shortestDuration(value);
        if (duration === null || duration <= COLLAPSED_MS) continue;
        hits.push({ line: index + 1, text: line.trim() });
      }
    }

    for (const ch of line) {
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (cooperatingFrom !== null && depth <= cooperatingFrom) cooperatingFrom = null;
      }
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
  const findings = [];
  const label = { media: '@media (prefers-reduced-motion: reduce)', class: '.reduced-motion' };

  for (const switchState of killSwitches(readFileSync(GLOBAL_STYLESHEET, 'utf8'))) {
    const name = label[switchState.label];
    if (!switchState.found) {
      findings.push({
        file: GLOBAL_STYLESHEET,
        line: 1,
        text: `the ${name} kill-switch is gone`,
        advice: 'both switches live in src/styles.scss; the app honours the OS and the in-app preference',
      });
      continue;
    }
    for (const property of switchState.missing) {
      findings.push({
        file: GLOBAL_STYLESHEET,
        line: 1,
        text: `${name} no longer declares ${property}`,
        advice: 'collapse it to its inert value rather than dropping it',
      });
    }
    for (const property of switchState.unflagged) {
      findings.push({
        file: GLOBAL_STYLESHEET,
        line: 1,
        text: `${name} declares ${property} without !important`,
        advice: 'a * selector is specificity zero — without the flag it loses to every component rule',
      });
    }
    for (const selector of switchState.selectors) {
      findings.push({
        file: GLOBAL_STYLESHEET,
        line: 1,
        text: `${name} no longer covers ${selector}`,
        advice: 'the switch must reach pseudo-elements too, which animate independently',
      });
    }
  }

  const files = walk(COMPONENT_DIR);
  const byFile = new Map();
  for (const path of files) {
    const hits = scanComponent(readFileSync(path, 'utf8'));
    if (hits.length > 0) byFile.set(posix(path), hits);
  }

  for (const [file, hits] of [...byFile.entries()].sort()) {
    const allowed = ALLOWED[file];
    if (allowed === undefined || hits.length > allowed.hits) {
      for (const hit of hits) {
        findings.push({
          file,
          ...hit,
          advice:
            'an !important duration ties the kill-switch on importance and beats it on ' +
            'specificity — drop the flag, or collapse it in this file\'s own reduced-motion block',
        });
      }
    } else if (hits.length < allowed.hits) {
      findings.push({
        file,
        line: 1,
        text: `${hits.length} competing declaration(s) left but ALLOWED still says ${allowed.hits}`,
        advice: 'the ratchet is stale — lower or remove the entry in scripts/check-motion.mjs',
      });
    }
  }

  for (const file of Object.keys(ALLOWED).sort()) {
    if (byFile.has(file)) continue;
    findings.push({
      file,
      line: 1,
      text: `ALLOWED says ${ALLOWED[file].hits} but the file is ${existsSync(file) ? 'clean' : 'gone'}`,
      advice: 'the ratchet is stale — lower or remove the entry in scripts/check-motion.mjs',
    });
  }

  const allowedTotal = Object.values(ALLOWED).reduce((sum, row) => sum + row.hits, 0);
  console.log(
    `Checked 2 reduced-motion kill-switches in ${GLOBAL_STYLESHEET} and ${files.length} component ` +
      `stylesheets for declarations that outrun them (${allowedTotal} recorded).`
  );

  if (findings.length > 0) {
    findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
    console.error(`\n${findings.length} reduced-motion problem(s):\n`);
    for (const finding of findings) {
      console.error(`  ${finding.file}:${finding.line}  ${finding.text}`);
      console.error(`      ${finding.advice}`);
    }
    console.error(
      `\nA reader who asked for less motion gets it from one of two kill-switches, both on\n` +
        `\`*\` and both !important. \`*\` is specificity zero, so an !important duration in a\n` +
        `component stylesheet wins and that component keeps moving. Reference: ${DOC}.\n`
    );
    process.exit(1);
  }

  console.log('Both kill-switches are intact, and nothing outruns them that is not recorded.');
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

  const hits = (source) => scanComponent(source).map((hit) => hit.text);

  const INTACT =
    '@media (prefers-reduced-motion: reduce) {\n' +
    '  *,\n  *::before,\n  *::after {\n' +
    '    animation-duration: 0.01ms !important;\n' +
    '    animation-iteration-count: 1 !important;\n' +
    '    transition-duration: 0.01ms !important;\n' +
    '    scroll-behavior: auto !important;\n' +
    '  }\n}\n' +
    '.reduced-motion *,\n.reduced-motion *::before,\n.reduced-motion *::after {\n' +
    '  animation-duration: 0.01ms !important;\n' +
    '  animation-iteration-count: 1 !important;\n' +
    '  transition-duration: 0.01ms !important;\n' +
    '  scroll-behavior: auto !important;\n' +
    '}\n';

  // --- must hit -----------------------------------------------------------
  check('an important transition shorthand', hits('.a { transition: all 0.2s ease !important; }'), [
    '.a { transition: all 0.2s ease !important; }',
  ]);
  check('an important transition-duration', hits('.a { transition-duration: 300ms !important; }'), [
    '.a { transition-duration: 300ms !important; }',
  ]);
  check('an important animation shorthand', hits('.a { animation: float 3s infinite !important; }'), [
    '.a { animation: float 3s infinite !important; }',
  ]);
  check(
    'an important declaration after the file closed its own reduced-motion block',
    hits(
      '@media (prefers-reduced-motion: reduce) {\n' +
        '  .a { animation: none; }\n' +
        '}\n' +
        '.b { transition: all 0.2s !important; }\n'
    ),
    ['.b { transition: all 0.2s !important; }']
  );
  check('a missing kill-switch is reported', killSwitches('.a { color: red; }')[0].found, false);
  check(
    'a kill-switch that dropped a property is reported',
    killSwitches(INTACT.replace('    scroll-behavior: auto !important;\n', '')).flatMap((s) => s.missing),
    ['scroll-behavior']
  );
  check(
    'a kill-switch that lost its flag is reported',
    killSwitches(INTACT.replace('  transition-duration: 0.01ms !important;', '  transition-duration: 0.01ms;'))
      .flatMap((s) => s.unflagged),
    ['transition-duration']
  );
  check(
    'a kill-switch that stopped covering a pseudo-element is reported',
    killSwitches(INTACT.replace('  *::after {', '  x {')).flatMap((s) => s.selectors),
    ['*::after']
  );

  // --- must not hit -------------------------------------------------------
  // The load-bearing half: every shape below is either the kill-switch's own
  // spelling or an ordinary component declaration that cannot reach it. A
  // gate that fired on these would be turned off within a week.
  check('the intact pair passes', killSwitches(INTACT).flatMap((s) => [...s.missing, ...s.unflagged, ...s.selectors]), []);
  check('both switches are found in the intact pair', killSwitches(INTACT).map((s) => s.found), [true, true]);
  check('a transition without the flag', hits('.a { transition: all 0.2s ease; }'), []);
  check('an animation without the flag', hits('.a { animation: float 3s infinite; }'), []);
  check('an important transition with no duration at all', hits('.a { transition: none !important; }'), []);
  check('the kill-switch spelling itself', hits('.a { transition-duration: 0.01ms !important; }'), []);
  check('a zero duration', hits('.a { animation-duration: 0s !important; }'), []);
  check('an important timing function', hits('.a { transition-timing-function: ease-in !important; }'), []);
  check('an important iteration count', hits('.a { animation-iteration-count: 1 !important; }'), []);
  check('an important transition property list', hits('.a { transition-property: opacity !important; }'), []);
  check('an important animation name', hits('.a { animation-name: float !important; }'), []);
  check(
    'a declaration inside the file\'s own reduced-motion block is cooperating',
    hits(
      '@media (prefers-reduced-motion: reduce) {\n' +
        '  .a { transition: all 0.01ms !important; }\n' +
        '  .b { animation: none !important; }\n' +
        '}\n'
    ),
    []
  );
  check(
    'a nested rule inside that block is still cooperating',
    hits(
      '@media (prefers-reduced-motion: reduce) {\n' +
        '  .a {\n    &:hover { transition: all 2s !important; }\n  }\n' +
        '}\n'
    ),
    []
  );
  check('a commented-out declaration', hits('// .a { transition: all 2s !important; }'), []);
  check('a block-commented declaration', hits('/* .a { transition: all 2s !important; } */'), []);

  // --- reporting ----------------------------------------------------------
  check('line numbers survive masking', scanComponent('\n\n.a { transition: all 2s !important; }')[0].line, 3);
  check('the shortest duration wins', shortestDuration('all 0.01ms, opacity 2s'), 0.01);
  check('seconds convert to milliseconds', shortestDuration('all 0.2s ease'), 200);
  check('a value with no duration reads null', shortestDuration('none'), null);
  check('a valid allowed row', allowedRowValid({ hits: 2, reason: 'a rule the reader cannot fix' }), true);
  check('an allowed row with zero hits', allowedRowValid({ hits: 0, reason: 'a rule the reader cannot fix' }), false);
  check('an allowed row missing a reason', allowedRowValid({ hits: 1 }), false);
  check('an allowed row with an empty reason', allowedRowValid({ hits: 1, reason: '' }), false);
  check('every allowed row carries a reason', Object.values(ALLOWED).every(allowedRowValid), true);

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
  console.log(`check-motion self-test: ${results.length} passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  run();
}
