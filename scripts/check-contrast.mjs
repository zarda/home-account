#!/usr/bin/env node
/**
 * Scores the colour pairs the app actually paints against WCAG AA, in all
 * four rendered modes.
 *
 * Every theme token in src/styles.scss was chosen by eye. That is how three
 * of the dark-mode chips shipped at 4.09, 4.10 and 3.00 — an income chip, a
 * warning banner and an expense chip, all under AA, all of them on the
 * dashboard — and nothing said so. Nothing could: contrast is a property of
 * a *pair*, and a stylesheet declares one token at a time. The high-contrast
 * palette in particular is described in its own comment as "bumped further
 * along the same neutral ramp", which is a statement about direction and
 * says nothing about whether the result clears 4.5:1.
 *
 * The acceptance line this replaces asked for "every --color-* pair in all
 * three modes". That is restated here, and the restatement is the point:
 *
 *   - **There are four rendered modes, not three.** `.high-contrast` and
 *     `.dark-theme.high-contrast` are separate blocks; light plus high
 *     contrast and dark plus high contrast resolve to different palettes.
 *   - **The two high-contrast blocks declare ZERO --color-* tokens.** They
 *     override --border-* and --text-* only. So a literal reading of "every
 *     --color-* pair in all three modes" is one third vacuous: the colour
 *     tokens are identical in the high-contrast modes to the ones underneath.
 *   - **Pairing cannot be derived from the names.** The base name is a FILL
 *     (chart bars, tinted chips), `-light` is a tinted BACKGROUND, and
 *     `-text` is the AA-corrected FOREGROUND — styles.scss says so in its own
 *     comment. Scoring every token as a foreground on --surface-card fails 14
 *     of 20 in light, and almost every one of those is a false positive: a
 *     chart bar has no contrast requirement against a card it never sits on.
 *
 * So the table below is hand written, and the table IS the audit. A row is
 * a pair the app paints, at the threshold that pair actually has to meet.
 *
 * Three buckets, and the difference between them is the whole design:
 *
 *   - PAIRS must pass, in every mode. A regression here fails the build.
 *   - EXEMPT are recorded and not scored, each with the reason it is not a
 *     requirement — a disabled control (WCAG 1.4.3 exempts those), a divider
 *     that is not a 1.4.11 component boundary, a combination nothing paints.
 *   - KNOWN_FAILURES are pairs that fail today, frozen at the ratio they
 *     measure, with what it would take to fix them. They may only improve,
 *     and when one reaches its threshold the script says so and asks to be
 *     promoted. Freezing rather than fixing is deliberate: a row here is a
 *     component reaching for the wrong token, or a brand colour whose
 *     replacement needs eyes on a screen, not a number in a script. The
 *     table is empty today — that is the mechanism working, not retired.
 *
 * Decisions worth stating, because each has a cheaper alternative that is
 * worse:
 *
 *   - It reads the stylesheet, not a rendered page. A Karma assertion would
 *     have to mount something in each of four modes and read
 *     getComputedStyle, which measures whatever that fixture happened to
 *     paint; this measures what the tokens promise, which is the thing that
 *     gets edited.
 *   - Declarations are merged across every block with the same selector, in
 *     file order, the way the cascade does. styles.scss declares
 *     `.dark-theme { color-scheme: dark; }` near the top and the real token
 *     block 200 lines later — taking the first match finds the wrong one and
 *     silently scores the dark modes with the light palette.
 *   - `var()` indirection is resolved. `--radius-card: var(--radius-md)` is
 *     the shape already in the file, and a colour token will be written that
 *     way sooner or later.
 *
 * What it deliberately cannot see:
 *   - A colour that is not a token: a hex literal in a component stylesheet,
 *     a Material default, a Tailwind utility class like `text-gray-500`. The
 *     axe-core pass in app.smoke.spec.ts is what meets those, on the rendered
 *     page — and it found two that this cannot.
 *   - Whether a pair is painted at all. The table says a pair exists; nothing
 *     re-checks that claim against the stylesheets, so a row can outlive its
 *     site.
 *   - Opacity. A token painted at 60% opacity measures its full-strength
 *     ratio here and a worse one on screen.
 *   - Large text. Every row is scored at the 4.5:1 normal-text threshold
 *     unless it names its own, which errs strict: a heading that clears 3:1
 *     and not 4.5:1 would fail here and be legal on screen.
 *   - A gradient, an image or a translucent overlay behind text.
 *
 * Reference documentation lives in docs/accessibility.md.
 */

import { readFileSync } from 'node:fs';

const STYLESHEET = 'src/styles.scss';
const DOC = 'docs/accessibility.md';

/** WCAG 2.1 thresholds. */
const AA_NORMAL = 4.5;

/**
 * The four palettes the app can render, each as the cascade order of the
 * blocks that build it. `.dark-theme.high-contrast` outranks `.high-contrast`
 * on specificity, so it comes last.
 */
const MODES = {
  light: [':root'],
  dark: [':root', '.dark-theme'],
  'light-hc': [':root', '.high-contrast'],
  'dark-hc': [':root', '.dark-theme', '.high-contrast', '.dark-theme.high-contrast'],
};

/** Pairs the app paints that must clear AA in every mode. */
const PAIRS = [
  { fg: '--text-primary', bg: '--surface-card', why: 'body copy on a card' },
  { fg: '--text-primary', bg: '--surface-background', why: 'body copy on the page' },
  { fg: '--text-secondary', bg: '--surface-card', why: 'secondary copy on a card' },
  { fg: '--text-secondary', bg: '--surface-background', why: 'secondary copy on the page' },
  { fg: '--text-muted', bg: '--surface-card', why: 'captions and hints on a card' },
  { fg: '--text-muted', bg: '--surface-muted', why: 'captions inside a nested chip or stat tile' },
  { fg: '--text-muted', bg: '--surface-background', why: 'captions on the page' },
  { fg: '--text-inverse', bg: '--color-primary', why: 'bottom-nav and period-selector labels on the primary fill' },
  { fg: '--color-primary', bg: '--surface-card', why: 'links and active labels on a card' },
  { fg: '--color-accent', bg: '--surface-card', why: 'accent labels on a card' },
  {
    fg: '--color-primary-text',
    bg: '--color-primary-light',
    why: "the stat-card neutral icon, the import preview badge, the period selector's toggle " +
      "and chip, the bottom-nav active pill, the profile-settings checked toggle",
  },
  { fg: '--color-income-text', bg: '--color-income-light', why: 'the income chip: stat cards, weekly recap' },
  { fg: '--color-income-text', bg: '--surface-card', why: 'an income amount as running text' },
  { fg: '--color-expense-text', bg: '--color-expense-light', why: 'the expense chip: stat cards, weekly recap, budget alert banner' },
  { fg: '--color-expense-text', bg: '--surface-card', why: 'an expense amount as running text' },
  { fg: '--color-warning-text', bg: '--color-warning-light', why: 'the warning banner: budget alerts, the recurring-rule chip' },
  { fg: '--color-warning-text', bg: '--surface-card', why: 'a warning as running text' },
  {
    fg: '--color-error-text',
    bg: '--color-error-light',
    why: "the login page's error banner and the transaction filters' clear-button hover",
  },
];

/** Pairs recorded and not scored, each with the reason it is not a rule. */
const EXEMPT = [
  {
    fg: '--text-disabled',
    bg: '--surface-card',
    why: 'WCAG 1.4.3 exempts text that is part of an inactive control — and dimming a disabled control is how it says it is disabled',
  },
  {
    fg: '--border-primary',
    bg: '--surface-card',
    why: 'a divider, not a component boundary: 1.4.11 asks for 3:1 on what identifies a control, and a hairline between two rows identifies nothing',
  },
  {
    fg: '--text-inverse',
    bg: '--color-error',
    why: 'nothing paints it — the two inverse-text sites (bottom-nav, period-selector) both sit on --color-primary, which is scored above',
  },
  {
    fg: '--text-inverse',
    bg: '--color-info',
    why: 'nothing paints it, as above',
  },
  {
    fg: '--text-inverse',
    bg: '--color-success',
    why: 'nothing paints it, as above',
  },
];

/**
 * Pairs that fail today, frozen at what they measure. `floors` is per mode
 * and may only rise, with a fix; a row that reaches its threshold is
 * reported so it moves up into PAIRS rather than sitting here passing.
 * Empty is the goal state, and the bucket stays for the next pair that
 * fails. This script finds no pair on its own — it scores the pairs these
 * tables name — so a component that paints a fill token as text instead of
 * its `-text` sibling is met in one of two places. Written into PAIRS, its
 * pair fails the build, and lands here only when someone moves it by hand,
 * as a row with its reason and its measured floors, until it is fixed. Found
 * by the axe pass on a route that pass renders, it fails the smoke
 * walkthrough instead, and is frozen, if at all, in axe.ts's
 * KNOWN_VIOLATIONS, by rule id per route with its reason — never here.
 */
const KNOWN_FAILURES = [];

/**
 * `--color-*` tokens no pair above names, and why none does. Every one is a
 * fill or a stroke: a chart bar, an icon beside its own text label, a hover
 * background. WCAG 1.4.11 asks 3:1 of a graphic only where it is required to
 * understand the content, and an icon that repeats its own label is not.
 * --self-test asserts this list plus the tables cover every --color-* the
 * light palette declares, so a new token cannot be added unaudited.
 */
const NOT_PAINTED = {
  '--color-primary-dark': 'a hover/active fill under an icon button; nothing sits on it as text',
  '--color-accent-light': 'a border colour and one decorative header glyph',
  '--color-income': "a fill — bars, dots, toggles' tints; never text",
  '--color-expense': "a fill — bars, dots, toggles' tints; never text",
  '--color-success': 'an icon colour beside its own label (the import wizard\'s success states)',
  '--color-success-light': 'declared and unused',
  '--color-warning': 'an icon and a border colour beside their own labels; the readable warning token is --color-warning-text',
  '--color-info': 'an icon and a left border on a callout that carries its own text in --text-primary',
  '--color-info-light': 'declared and unused',
};

/** Every block with this selector, merged in file order, as the cascade does. */
export function declarations(source, selector) {
  const out = {};
  const pattern = new RegExp(
    `(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`,
    'g'
  );
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const open = source.indexOf('{', match.index + match[1].length);
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) continue;
    for (const declaration of source.slice(open + 1, end).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      out[declaration[1]] = declaration[2].trim();
    }
    pattern.lastIndex = open + 1;
  }
  return out;
}

/** The value of `token` in a stack of blocks, `var()` indirection followed. */
export function resolve(token, layers, depth = 0) {
  if (depth > 10) return null;
  let value = null;
  for (const layer of layers) {
    if (layer[token] !== undefined) value = layer[token];
  }
  if (value === null) return null;
  const indirect = value.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/);
  return indirect ? resolve(indirect[1], layers, depth + 1) : value;
}

/** `#rgb` or `#rrggbb` to its three channels, or null. */
export function channels(colour) {
  const hex = (colour ?? '').trim().replace('#', '');
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(hex)) return null;
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
}

/** WCAG 2.1 relative luminance. */
export function luminance([r, g, b]) {
  const linear = [r, g, b].map(value => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG 2.1 contrast ratio, rounded to two places the way a report reads it. */
export function contrastRatio(foreground, background) {
  const fg = channels(foreground);
  const bg = channels(background);
  if (fg === null || bg === null) return null;
  const a = luminance(fg);
  const b = luminance(bg);
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

/** Every mode's palette, built from one stylesheet's text. */
export function palettes(source) {
  const blocks = {};
  for (const selector of new Set(Object.values(MODES).flat())) {
    blocks[selector] = declarations(source, selector);
  }
  return Object.fromEntries(
    Object.entries(MODES).map(([mode, stack]) => [mode, stack.map(selector => blocks[selector])])
  );
}

/** The ratio a pair measures in one mode, or a reason it could not be scored. */
function score(pair, layers) {
  const foreground = resolve(pair.fg, layers);
  const background = resolve(pair.bg, layers);
  if (foreground === null) return { error: `${pair.fg} is not declared` };
  if (background === null) return { error: `${pair.bg} is not declared` };
  const ratio = contrastRatio(foreground, background);
  if (ratio === null) {
    return { error: `${foreground} / ${background} is not a hex colour this script can read` };
  }
  return { ratio, foreground, background };
}

/**
 * What one frozen row measures in one mode against its floor: a finding when
 * it got worse than the ratio it was frozen at, a finding asking to be
 * promoted once it clears its threshold, and null while it still fails no
 * worse than it did. A function of its own so --self-test can hand it a
 * synthetic row — the production table is empty, and a self-test that read
 * it would check nothing.
 */
export function frozenRowFinding(pair, mode, layers) {
  const threshold = pair.threshold ?? AA_NORMAL;
  const floor = pair.floors[mode];
  const result = score(pair, layers);
  if (result.error) return result.error;
  if (result.ratio < floor) {
    return (
      `${result.ratio}:1 is worse than the ${floor}:1 this pair was frozen at — a known ` +
      'failure may only improve'
    );
  }
  if (result.ratio >= threshold) {
    return (
      `${result.ratio}:1 now clears ${threshold}:1 — move this row out of KNOWN_FAILURES ` +
      'and into PAIRS so it cannot slip back'
    );
  }
  return null;
}

/**
 * Every finding the tables produce over a set of resolved palettes, and how
 * many pairings were scored. A required pair is scored in every mode handed
 * in and fails only under its threshold, so one measuring exactly on it
 * passes; a frozen row is scored only in the modes it names a floor for.
 * Separate from run() so --self-test can hand it tables of its own — the
 * production KNOWN_FAILURES is empty, and a loop only ever given that would
 * never be seen to report a frozen row.
 */
export function findingsFor(pairs, knownFailures, resolved) {
  const findings = [];
  let scored = 0;

  for (const pair of pairs) {
    const threshold = pair.threshold ?? AA_NORMAL;
    for (const [mode, layers] of Object.entries(resolved)) {
      scored += 1;
      const result = score(pair, layers);
      if (result.error) {
        findings.push({ pair, mode, text: result.error });
        continue;
      }
      if (result.ratio < threshold) {
        findings.push({
          pair,
          mode,
          text:
            `${result.foreground} on ${result.background} is ${result.ratio}:1, under ${threshold}:1 ` +
            `— ${pair.why}`,
        });
      }
    }
  }

  for (const pair of knownFailures) {
    for (const mode of Object.keys(pair.floors)) {
      scored += 1;
      const text = frozenRowFinding(pair, mode, resolved[mode]);
      if (text) findings.push({ pair, mode, text });
    }
  }

  return { findings, scored };
}

function run() {
  const source = readFileSync(STYLESHEET, 'utf8');
  const { findings, scored } = findingsFor(PAIRS, KNOWN_FAILURES, palettes(source));

  console.log(
    `Scored ${scored} colour pairings across ${Object.keys(MODES).length} rendered modes ` +
      `(${PAIRS.length} required, ${KNOWN_FAILURES.length} frozen, ${EXEMPT.length} exempt, ` +
      `${Object.keys(NOT_PAINTED).length} tokens painted only as fills).`
  );

  if (findings.length > 0) {
    findings.sort((a, b) => {
      const left = `${a.pair.fg}|${a.pair.bg}|${a.mode}`;
      const right = `${b.pair.fg}|${b.pair.bg}|${b.mode}`;
      return left.localeCompare(right);
    });
    console.error(`\n${findings.length} contrast problem(s):\n`);
    for (const finding of findings) {
      console.error(`  ${STYLESHEET}:${finding.mode}  ${finding.pair.fg} on ${finding.pair.bg}`);
      console.error(`      ${finding.text}`);
    }
    console.error(
      `\nContrast is a property of a PAIR, so a token cannot be judged on its own and no\n` +
        `stylesheet can say whether it reads. The table in scripts/check-contrast.mjs is the\n` +
        `audit: fix the token, or move the row and say why. Reference: ${DOC}.\n`
    );
    process.exit(1);
  }

  console.log('Every required colour pairing clears WCAG AA in all four modes.');
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

  // --- the arithmetic, against WCAG's own worked values --------------------
  check('black on white is 21:1', contrastRatio('#000000', '#ffffff'), 21);
  check('white on white is 1:1', contrastRatio('#ffffff', '#ffffff'), 1);
  check('the ratio is symmetric', contrastRatio('#ffffff', '#767676'), contrastRatio('#767676', '#ffffff'));
  check('a known-passing pair clears AA', contrastRatio('#767676', '#ffffff') >= 4.5, true);
  check('a known-failing pair does not', contrastRatio('#999999', '#ffffff') >= 4.5, false);
  check('three-digit hex expands', contrastRatio('#fff', '#000'), 21);
  check('a value that is not a hex colour reads null', contrastRatio('rgba(0,0,0,0.5)', '#ffffff'), null);
  check('a missing value reads null', contrastRatio(null, '#ffffff'), null);

  // --- the parser ----------------------------------------------------------
  // The trap this exists for: styles.scss declares `.dark-theme { color-scheme:
  // dark; }` near the top and the real token block two hundred lines later.
  // Taking the first match scores the dark modes with the light palette and
  // reports every dark pair as passing.
  const twoBlocks =
    '.dark-theme {\n  color-scheme: dark;\n}\n\n' +
    'body { color: red; }\n\n' +
    '.dark-theme {\n  --surface-card: #1e1e1e;\n  --text-primary: #ffffff;\n}\n';
  check(
    'merges every block with the same selector, in file order',
    declarations(twoBlocks, '.dark-theme'),
    { '--surface-card': '#1e1e1e', '--text-primary': '#ffffff' }
  );
  check(
    'a later declaration of the same token wins',
    declarations('.a {\n  --x: #111;\n}\n.a {\n  --x: #222;\n}\n', '.a'),
    { '--x': '#222' }
  );
  check(
    'a nested block does not end the outer one early',
    declarations('.a {\n  --x: #111;\n  &:hover { color: red; }\n  --y: #222;\n}\n', '.a'),
    { '--x': '#111', '--y': '#222' }
  );
  check('a selector that is a prefix of another is not matched', declarations('.ab {\n  --x: #111;\n}\n', '.a'), {});
  check('a missing selector reads empty', declarations('.b { --x: #111; }', '.a'), {});

  // --- resolution ----------------------------------------------------------
  check('a later layer overrides an earlier one', resolve('--x', [{ '--x': '#111' }, { '--x': '#222' }]), '#222');
  check('a layer that does not declare it leaves the earlier value', resolve('--x', [{ '--x': '#111' }, { '--y': '#222' }]), '#111');
  check('var() indirection is followed', resolve('--a', [{ '--a': 'var(--b)', '--b': '#333' }]), '#333');
  check('indirection across layers is followed', resolve('--a', [{ '--a': 'var(--b)', '--b': '#111' }, { '--b': '#222' }]), '#222');
  check('an undeclared token reads null', resolve('--nope', [{ '--x': '#111' }]), null);
  check('a var() cycle gives up rather than hanging', resolve('--a', [{ '--a': 'var(--b)', '--b': 'var(--a)' }]), null);

  // --- the table covers the palette ----------------------------------------
  // A new --color-* token cannot be added without a row here or a reason in
  // NOT_PAINTED. This is the half that keeps the audit from going stale
  // quietly: an unaudited token is indistinguishable from an audited one.
  const source = readFileSync(STYLESHEET, 'utf8');
  const lightTokens = Object.keys(declarations(source, ':root')).filter(token =>
    token.startsWith('--color-')
  );
  const named = new Set([
    ...PAIRS.flatMap(pair => [pair.fg, pair.bg]),
    ...EXEMPT.flatMap(pair => [pair.fg, pair.bg]),
    ...KNOWN_FAILURES.flatMap(pair => [pair.fg, pair.bg]),
    ...Object.keys(NOT_PAINTED),
  ]);
  check('every --color-* token is in a table or named as a fill', lightTokens.filter(token => !named.has(token)), []);
  check('the light palette was read at all', lightTokens.length >= 20, true);
  check(
    'nothing is listed as unpainted and scored at the same time',
    Object.keys(NOT_PAINTED).filter(token =>
      [...PAIRS, ...KNOWN_FAILURES].some(pair => pair.fg === token || pair.bg === token)
    ),
    []
  );
  check(
    'every exempt and frozen row carries a reason',
    [...EXEMPT, ...KNOWN_FAILURES, ...PAIRS].filter(pair => !pair.why || pair.why.length < 15),
    []
  );
  check(
    'every frozen row names the modes it fails in',
    KNOWN_FAILURES.filter(pair => Object.keys(pair.floors ?? {}).length === 0),
    []
  );

  // --- the ratchet, on a synthetic frozen row ------------------------------
  // #777777 on white is 4.48:1, just under AA; the row is frozen there.
  const frozen = { fg: '--fg', bg: '--bg', floors: { light: 4.48 }, why: 'a fixture row for the ratchet' };
  const on = foreground => [{ '--fg': foreground, '--bg': '#ffffff' }];
  check('a frozen row at its floor passes', frozenRowFinding(frozen, 'light', on('#777777')), null);
  check(
    'a frozen row worse than its floor fails',
    frozenRowFinding(frozen, 'light', on('#888888'))?.startsWith('3.54:1 is worse than the 4.48:1'),
    true
  );
  check(
    'a frozen row that now clears asks to be promoted',
    frozenRowFinding(frozen, 'light', on('#595959'))?.includes('move this row out of KNOWN_FAILURES'),
    true
  );
  check(
    'a frozen row whose token went missing says so',
    frozenRowFinding(frozen, 'light', [{ '--bg': '#ffffff' }]),
    '--fg is not declared'
  );

  // --- the run loop, on synthetic tables ------------------------------------
  // run() hands findingsFor the production tables; these hand it their own,
  // so the loop's comparisons are checked as run() makes them — including a
  // frozen row's finding, which the empty KNOWN_FAILURES never reaches.
  // #148484 on white measures 4.5:1 to two decimal places —
  // AA's own line, which a required pair need only reach.
  const required = { fg: '--fg', bg: '--bg', why: 'a fixture row for the loop' };
  const texts = ({ findings }) => findings.map(finding => `${finding.mode}: ${finding.text}`);
  check('the boundary fixture measures exactly AA', contrastRatio('#148484', '#ffffff'), AA_NORMAL);
  check(
    'a required pair exactly on its threshold passes',
    texts(findingsFor([required], [], { light: on('#148484') })),
    []
  );
  check(
    'a required pair a hundredth under its threshold fails',
    texts(findingsFor([{ ...required, threshold: 4.49 }], [], { light: on('#777777') })),
    ['light: #777777 on #ffffff is 4.48:1, under 4.49:1 — a fixture row for the loop']
  );
  check(
    'the loop reports a frozen row worse than its floor',
    texts(findingsFor([], [frozen], { light: on('#888888') })),
    ['light: 3.54:1 is worse than the 4.48:1 this pair was frozen at — a known failure may only improve']
  );
  check(
    'the loop scores a frozen row only in the modes it names a floor for',
    findingsFor([], [frozen], { light: on('#777777'), dark: on('#888888') }).scored,
    1
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
  console.log(`check-contrast self-test: ${results.length} passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  run();
}
