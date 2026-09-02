#!/usr/bin/env node
/**
 * Freezes the physical-direction CSS still in the tree exactly where it
 * stands, so the RTL conversion can only shrink.
 *
 * `margin-left`, `text-align: right`, `pl-4`, `translateX(-100%)` and their
 * relatives hard-code the Latin reading order. The conversion to logical
 * properties (#86) is being done in slices; the survivors are real, they are
 * listed below, and none of them is a licence to write another one. A
 * conversion without a gate is a conversion that ends the day it stops being
 * anybody's current task — docs/ui-overflow.md's truncation rule lived that
 * way for two releases before check-truncation.mjs was wired into CI.
 *
 * Decisions worth stating, because each has a cheaper alternative that is
 * worse:
 *
 *   - The baseline is per file, not a global total. A single number would let
 *     a new `margin-left` in one component hide behind a conversion in
 *     another, and it tells a reviewer nothing about where the debt is. A
 *     per-file map is self-locating, and its diff reads as progress: the
 *     entry drops, then the entry goes.
 *   - Staleness fails in BOTH directions. Above the baseline is new physical
 *     CSS. A file with hits that is not listed at all is new physical CSS in
 *     a file that had none. Below the baseline — or an entry for a file that
 *     is now clean or gone — is a ratchet that has stopped ratcheting: the
 *     next regression would land inside the slack and pass. Converting means
 *     editing this map in the same commit, which is the point.
 *   - The scan reads source text, not rendered styles. A Karma assertion
 *     would have to instantiate every component to see component-scoped SCSS
 *     and would still only cover the components somebody remembered.
 *
 * Exemptions, precisely:
 *
 *   - A line mentioning `env(safe-area-inset-` or `var(--safe-` is exempt.
 *     The notch insets are physical by specification; there is no logical
 *     spelling to convert them to.
 *   - A `/* direction:physical` marker in a comment exempts from the marker
 *     line through the closing brace of the immediately following balanced
 *     brace block — the block it annotates, nested braces included. It
 *     exempts nothing else: if no block opens before the enclosing one
 *     closes, the marker covers only its own line, which is a comment and
 *     never had hits to begin with. Annotate the block, not a bare
 *     declaration. Its live use is the drawer keyframes in
 *     main-layout.component.scss, where the animation is genuinely physical
 *     until a mirrored variant lands with the first RTL locale.
 *
 * Comments are blanked before scanning, offsets preserved, so prose about
 * direction — and there is a lot of it in the converted stylesheets,
 * explaining what was there before — is not a direction violation. The
 * marker is read from the raw text for that exact reason.
 *
 * `--print-baseline` prints the map for the current tree, sorted and
 * copy-pasteable; that is how the frozen baseline below was generated, and
 * how it should be regenerated after a conversion slice.
 *
 * `--self-test` runs the scanners over embedded fixtures — a must-hit list
 * and a must-not-hit list — and exits non-zero on any mismatch. The
 * must-not-hit list is the interesting half: `border-radius` is not
 * `border-r`, `flex-start` is not a start utility, `me-2`/`ms-2`/`ps-5` are
 * the logical utilities we are converting *to*, and `margin-inline-end` and
 * `text-align: end` are the finished product. A pattern that flags those
 * would make the gate unusable and get itself deleted. As with the other
 * gate scripts there is no .spec.ts: the self-test is the spec, and
 * direction:check chains it ahead of the live scan.
 *
 * What it deliberately cannot see:
 *   - Physical direction expressed some other way: a hard-coded
 *     `flex-direction: row` that assumes a reading order, a `::before`
 *     positioned by a magic number, a right-aligned column built out of
 *     `justify-content: flex-end`. Those are judgement calls, not greps.
 *   - Inline `style="margin-left: 4px"` in a template. Templates are scanned
 *     with the utility patterns only; an inline style attribute is a lint
 *     problem before it is a direction problem.
 *   - Styles arriving through Angular Material's own stylesheets, which are
 *     not ours to police here.
 *   - Utilities inside an inline component template. `collect()` walks
 *     `.scss` and `.html` only, so a physical utility written in a `template:`
 *     string in a `.ts` file is invisible here. Seven components in this tree
 *     use inline templates, three of them shared ones rendered on nearly
 *     every page. Scanning `.ts` would mean deciding what counts as a
 *     template string; the gate is deliberately cheaper than that, and this
 *     is the price.
 *   - Utility values that are not a digit. The margin/padding pattern ends in
 *     `-\d`, which is what keeps it off `ms-`/`me-` lookalikes and word
 *     fragments — but it also means `ml-auto`, `mr-px` and the arbitrary
 *     bracket form `ml-[10px]` score zero hits. The other four patterns are
 *     unaffected.
 *
 * Reference documentation lives in docs/rtl.md.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';

const SOURCE_DIR = 'src';
const DOC = 'docs/rtl.md';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.angular', 'coverage']);

/**
 * The physical direction still in the tree, per file. Generated by
 * `--print-baseline`; every number here is a debt, and the only legal edits
 * are downward.
 */
const BASELINE = {
  'src/app/features/about/about.component.scss': 1,
  'src/app/features/about/feedback-dialog/feedback-dialog.component.scss': 1,
  'src/app/features/ai/import/category-suggestion/category-suggestion.component.scss': 2,
  'src/app/features/ai/import/duplicate-warning/duplicate-warning.component.scss': 3,
  'src/app/features/ai/import/file-dropzone/file-dropzone.component.scss': 4,
  'src/app/features/ai/import/import-history/import-history.component.scss': 2,
  'src/app/features/ai/import/import-wizard/import-wizard.component.scss': 9,
  'src/app/features/ai/import/transaction-preview-table/transaction-preview-table.component.scss': 5,
  'src/app/features/ai/search-history/search-answer-history.component.scss': 1,
  'src/app/features/auth/login/login.component.scss': 3,
  'src/app/features/budgets/goals/goal-progress-card/goal-progress-card.component.scss': 2,
  'src/app/features/budgets/recurring-transactions/recurring-form-dialog/recurring-form-dialog.component.scss': 3,
  'src/app/features/budgets/recurring-transactions/recurring-transactions.component.scss': 1,
  'src/app/features/dashboard/spending-chart/spending-chart.component.scss': 2,
  'src/app/features/data/data-hub.component.scss': 1,
  'src/app/features/data/data-management/data-management.component.scss': 2,
  'src/app/features/reports/category-breakdown/category-breakdown.component.scss': 7,
  'src/app/features/reports/export-dialog/export-dialog.component.scss': 2,
  'src/app/features/reports/insights/insight-narrative/insight-narrative.component.scss': 1,
  'src/app/features/reports/insights/insights-tab.component.scss': 2,
  'src/app/features/reports/monthly-comparison/monthly-comparison.component.scss': 2,
  'src/app/features/reports/reports.component.scss': 3,
  'src/app/features/reports/spending-analysis/spending-analysis.component.scss': 1,
  'src/app/features/settings/ai-settings-page/ai-settings-page.component.scss': 2,
  'src/app/features/settings/category-manager/category-manager.component.scss': 2,
  'src/app/features/settings/profile-settings/profile-settings.component.scss': 2,
  'src/app/features/settings/settings.component.scss': 3,
  'src/app/features/transactions/camera-capture/camera-capture.component.scss': 3,
  'src/app/features/transactions/transaction-filters/transaction-filters.component.scss': 6,
  'src/app/features/transactions/transaction-form/transaction-form.component.scss': 13,
  'src/app/features/transactions/transaction-list/transaction-list.component.scss': 4,
  'src/app/shared/components/ai-search-dialog/ai-search-dialog.component.scss': 1,
  'src/app/shared/components/stat-card/stat-card.component.scss': 1,
  'src/app/shared/components/transaction-row/transaction-row.component.scss': 7,
  'src/app/shared/layout/header/header.component.scss': 2,
};

/** Declarations that name a physical side. */
const SCSS_PATTERNS = [
  /(?<![-\w])(left|right)\s*:/g,
  /(margin|padding|border)-(left|right)\s*:/g,
  /text-align\s*:\s*(left|right)\b/g,
  /float\s*:\s*(left|right)\b/g,
  /translateX\(/g,
];

/**
 * Tailwind utilities that name a physical side. Applied to templates and to
 * `@apply` lines inside stylesheets, which are the same vocabulary.
 *
 * The lookarounds carry the whole weight here. `border-r` without one hits
 * `border-radius` in nearly two hundred places; `rounded-l` without the
 * trailing `(-|\b)` hits every `rounded-lg`; `ml-` without the leading
 * `(?<![-\w])` hits `html-2`-shaped fragments and the logical `ms-`/`me-`
 * utilities sit one letter away from the physical ones. The self-test pins
 * each of those.
 *
 * The `!?` on the first pattern is the app's important prefix, which is the
 * house spelling for overriding Material (`!px-4`, `!rounded-xl`) and so is
 * the likeliest way a physical margin gets written here. It is matched, not
 * stepped over: the four patterns below never excluded it, and a gate that
 * flagged `!text-right` while waving `!mr-2` through would be blind to the
 * exact form the conversion slice had to fix. The `(ml|mr|pl|pr)` alternation
 * is what keeps `!-me-2` — the converted spelling — out of it.
 */
const UTILITY_PATTERNS = [
  /(?<![-\w])!?-?(ml|mr|pl|pr)-\d/g,
  /(?<![-\w])text-(left|right)(?![-\w])/g,
  /(?<![-\w])(left|right)-\d/g,
  /(?<![-\w])rounded-(tl|tr|bl|br|l|r)(-|\b)/g,
  /(?<![-\w])border-(l|r)(-|\b)/g,
];

/** Lines whose physical direction has no logical spelling. */
const LINE_EXEMPT = /env\(safe-area-inset-|var\(--safe-/;

/** The block marker, read from raw text — masking would blank it. */
const MARKER = /direction:physical/;

/**
 * The logical spelling to reach for, most specific match first: `border-left`
 * must resolve before `border-l`, `rounded-tl` before `rounded-l`.
 */
const EQUIVALENTS = [
  [/^left\s*:/, 'inset-inline-start:'],
  [/^right\s*:/, 'inset-inline-end:'],
  [/^margin-left/, 'margin-inline-start'],
  [/^margin-right/, 'margin-inline-end'],
  [/^padding-left/, 'padding-inline-start'],
  [/^padding-right/, 'padding-inline-end'],
  [/^border-left/, 'border-inline-start'],
  [/^border-right/, 'border-inline-end'],
  [/^text-align\s*:\s*left/, 'text-align: start'],
  [/^text-align\s*:\s*right/, 'text-align: end'],
  [/^float\s*:\s*left/, 'float: inline-start'],
  [/^float\s*:\s*right/, 'float: inline-end'],
  [/^translateX\(/, 'an inset-inline offset, or a mirrored variant behind [dir="rtl"]'],
  // `!?` so the important-prefixed forms the first utility pattern now
  // matches still resolve to a suggestion rather than printing none.
  [/^!?-?ml-/, 'ms-*'],
  [/^!?-?mr-/, 'me-*'],
  [/^!?-?pl-/, 'ps-*'],
  [/^!?-?pr-/, 'pe-*'],
  [/^text-left/, 'text-start'],
  [/^text-right/, 'text-end'],
  [/^left-/, 'start-*'],
  [/^right-/, 'end-*'],
  [/^rounded-tl/, 'rounded-ss-*'],
  [/^rounded-tr/, 'rounded-se-*'],
  [/^rounded-bl/, 'rounded-es-*'],
  [/^rounded-br/, 'rounded-ee-*'],
  [/^rounded-l/, 'rounded-s-*'],
  [/^rounded-r/, 'rounded-e-*'],
  [/^border-l/, 'border-s-*'],
  [/^border-r/, 'border-e-*'],
];

/** The logical equivalent of a matched fragment, or null when none fits. */
export function logicalEquivalent(match) {
  const text = match.trim();
  for (const [pattern, replacement] of EQUIVALENTS) {
    if (pattern.test(text)) return replacement;
  }
  return null;
}

/**
 * Blanks comments while preserving every byte offset, so a line number taken
 * from the masked text still points at the real line. Prose *about*
 * direction is not a direction violation: the converted stylesheets explain
 * at length which physical property used to be there, and those notes are
 * the reason the next person does not put it back. (Copied from
 * check-truncation.mjs, which needs the same thing for the same reason.)
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

/**
 * The template flavour of the same idea. A template comment is `<!-- -->`,
 * which maskComments does not know about, and running the SCSS masker over
 * markup would read the `//` in an href as a line comment and blank the rest
 * of the attribute. Offsets are preserved the same way.
 */
export function maskHtmlComments(source) {
  const out = source.split('');
  let i = 0;
  let inComment = false;
  while (i < source.length) {
    if (!inComment && source.startsWith('<!--', i)) {
      inComment = true;
      for (let k = i; k < i + 4; k += 1) out[k] = ' ';
      i += 4;
      continue;
    }
    if (inComment && source.startsWith('-->', i)) {
      inComment = false;
      for (let k = i; k < i + 3; k += 1) out[k] = ' ';
      i += 3;
      continue;
    }
    if (inComment && source[i] !== '\n') out[i] = ' ';
    i += 1;
  }
  return out.join('');
}

function walk(dir, extensions, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, extensions, found);
    else if (extensions.some((ext) => entry.endsWith(ext))) found.push(path);
  }
  return found;
}

/**
 * The 1-based line ranges a `direction:physical` marker exempts: the marker
 * line through the closing brace of the immediately following balanced brace
 * block. Braces are counted in the masked text so a brace inside a comment
 * or a string cannot open or close a block. A marker with no block after it
 * — the enclosing block closes first, or the file ends — exempts only its
 * own line, which is the safe direction: the gate still fires.
 */
export function markerRanges(raw, masked) {
  const rawLines = raw.split('\n');
  const maskedLines = masked.split('\n');
  const ranges = [];

  for (let i = 0; i < rawLines.length; i += 1) {
    if (!MARKER.test(rawLines[i])) continue;

    let depth = 0;
    let opened = false;
    let end = i;
    for (let j = i + 1; j < maskedLines.length; j += 1) {
      for (const c of maskedLines[j]) {
        if (c === '{') { depth += 1; opened = true; }
        else if (c === '}') depth -= 1;
      }
      if (opened && depth <= 0) { end = j; break; }
      if (!opened && depth < 0) break; // the enclosing block closed first
    }
    ranges.push([i + 1, end + 1]);
  }
  return ranges;
}

function exempted(ranges, line) {
  return ranges.some(([from, to]) => line >= from && line <= to);
}

/**
 * Every match of `patterns` in `line`, deduplicated by start offset so two
 * patterns describing the same fragment count once.
 */
function matchesIn(line, patterns) {
  const byIndex = new Map();
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      if (!byIndex.has(match.index)) byIndex.set(match.index, match[0]);
      if (match[0] === '') pattern.lastIndex += 1;
    }
  }
  return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, text]) => text);
}

/** Hits in a stylesheet: the declaration patterns, plus utilities on `@apply` lines. */
export function scanScss(source) {
  const masked = maskComments(source);
  const ranges = markerRanges(source, masked);
  const hits = [];

  masked.split('\n').forEach((line, index) => {
    const lineNumber = index + 1;
    if (LINE_EXEMPT.test(line)) return;
    if (exempted(ranges, lineNumber)) return;
    const patterns = line.includes('@apply')
      ? [...SCSS_PATTERNS, ...UTILITY_PATTERNS]
      : SCSS_PATTERNS;
    for (const match of matchesIn(line, patterns)) {
      hits.push({ line: lineNumber, match, text: line.trim() });
    }
  });

  return hits;
}

/** Hits in a template: the utility patterns only. */
export function scanHtml(source) {
  const masked = maskHtmlComments(source);
  const ranges = markerRanges(source, masked);
  const hits = [];

  masked.split('\n').forEach((line, index) => {
    const lineNumber = index + 1;
    if (LINE_EXEMPT.test(line)) return;
    if (exempted(ranges, lineNumber)) return;
    for (const match of matchesIn(line, UTILITY_PATTERNS)) {
      hits.push({ line: lineNumber, match, text: line.trim() });
    }
  });

  return hits;
}

function posix(path) {
  return path.split(sep).join('/');
}

/** Every file with at least one hit, keyed by its repo-relative path. */
function collect() {
  const files = walk(SOURCE_DIR, ['.scss', '.html']);
  const found = new Map();

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const hits = file.endsWith('.scss') ? scanScss(source) : scanHtml(source);
    if (hits.length > 0) found.set(posix(file), hits);
  }

  return { files, found };
}

function printBaseline() {
  const { found } = collect();
  const paths = [...found.keys()].sort();
  console.log('const BASELINE = {');
  for (const path of paths) {
    console.log(`  '${path}': ${found.get(path).length},`);
  }
  console.log('};');
  console.error(
    `\n${paths.length} file(s), ${paths.reduce((sum, p) => sum + found.get(p).length, 0)} hit(s).`
  );
}

function describe(hit, file) {
  const logical = logicalEquivalent(hit.match);
  const advice = logical ? `  → ${logical}` : '';
  return `    ${file}:${hit.line}  ${hit.text}${advice}`;
}

function run() {
  const { files, found } = collect();
  const problems = [];

  for (const [file, hits] of [...found.entries()].sort()) {
    const allowed = BASELINE[file];
    if (allowed === undefined) {
      problems.push(
        `${file} — ${hits.length} physical direction hit(s) in a file the baseline does not list:\n` +
          hits.map((hit) => describe(hit, file)).join('\n')
      );
    } else if (hits.length > allowed) {
      problems.push(
        `${file} — ${hits.length} physical direction hit(s), baseline ${allowed}:\n` +
          hits.map((hit) => describe(hit, file)).join('\n')
      );
    } else if (hits.length < allowed) {
      problems.push(
        `${file} — ${hits.length} hit(s) but the baseline still says ${allowed}; ` +
          'the ratchet is stale — lower or remove the entry.'
      );
    }
  }

  for (const file of Object.keys(BASELINE).sort()) {
    if (found.has(file)) continue;
    const gone = !existsSync(file);
    problems.push(
      `${file} — baseline says ${BASELINE[file]} but the file is ${gone ? 'gone' : 'clean'}; ` +
        'the ratchet is stale — lower or remove the entry.'
    );
  }

  const scss = files.filter((file) => file.endsWith('.scss')).length;
  console.log(
    `Checked ${scss} stylesheets and ${files.length - scss} templates for physical direction.`
  );

  if (problems.length > 0) {
    console.error(`\n${problems.length} file(s) off the direction baseline:\n`);
    for (const problem of problems) console.error(`  ${problem}\n`);
    console.error(
      `The baseline in scripts/check-direction.mjs freezes the physical direction that\n` +
        `was already here; it may only shrink. Write the logical property instead —\n` +
        `inset-inline-start, margin-inline-start, text-align: start, ms-*/me-*/ps-*/pe-* —\n` +
        `and when a conversion lands, lower or remove that file's entry in the same\n` +
        `commit. \`node scripts/check-direction.mjs --print-baseline\` prints the map for\n` +
        `the current tree. Reference: ${DOC}.\n`
    );
    process.exit(1);
  }

  const total = Object.values(BASELINE).reduce((sum, count) => sum + count, 0);
  console.log(
    `Physical direction is where the baseline says it is: ${total} hit(s) in ${Object.keys(BASELINE).length} file(s).`
  );
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

  const scssHits = (source) => scanScss(source).map((hit) => hit.match);
  const htmlHits = (source) => scanHtml(source).map((hit) => hit.match);

  // --- must hit -----------------------------------------------------------
  check('a physical offset', scssHits('.a { left: 0; }'), ['left:']);
  check('the other physical offset', scssHits('.a { right: 4px; }'), ['right:']);
  check('a physical margin', scssHits('.a { margin-left: 8px; }'), ['margin-left:']);
  check('a physical padding', scssHits('.a { padding-right: 8px; }'), ['padding-right:']);
  check('a physical border', scssHits('.a { border-left: 1px solid; }'), ['border-left:']);
  check('a physical text alignment', scssHits('.a { text-align: right; }'), ['text-align: right']);
  check('a float', scssHits('.a { float: left; }'), ['float: left']);
  check('a horizontal translate', scssHits('.a { transform: translateX(-100%); }'), ['translateX(']);
  check('two hits on one line count twice', scssHits('.a { margin-left: 0; padding-left: 0; }'), [
    'margin-left:',
    'padding-left:',
  ]);
  check('utilities inside @apply', scssHits('.a { @apply ml-2 text-right; }'), ['ml-2', 'text-right']);
  check('a physical margin utility', htmlHits('<div class="ml-2"></div>'), ['ml-2']);
  check('a negative physical margin utility', htmlHits('<div class="-mr-1"></div>'), ['-mr-1']);
  // The important prefix is the house spelling for overriding Material, and
  // `!-mr-2` is literally the form the conversion slice had to fix.
  check('an important-prefixed physical margin utility', htmlHits('<div class="!mr-2"></div>'), [
    '!mr-2',
  ]);
  check(
    'an important-prefixed negative physical margin utility',
    htmlHits('<div class="!-mr-2"></div>'),
    ['!-mr-2']
  );
  check('an important-prefixed utility behind a variant', htmlHits('<div class="md:!pl-4"></div>'), [
    '!pl-4',
  ]);
  check('a physical padding utility', htmlHits('<div class="pl-4 pr-2"></div>'), ['pl-4', 'pr-2']);
  check('a physical text alignment utility', htmlHits('<p class="text-left">x</p>'), ['text-left']);
  check('a physical inset utility', htmlHits('<div class="right-0"></div>'), ['right-0']);
  check('a physical corner utility', htmlHits('<div class="rounded-l-lg"></div>'), ['rounded-l-']);
  check('a physical corner utility, one corner', htmlHits('<div class="rounded-tr-md"></div>'), [
    'rounded-tr-',
  ]);
  check('a physical border-side utility', htmlHits('<div class="border-r-2"></div>'), ['border-r-']);

  // --- must not hit -------------------------------------------------------
  check('border-radius is not border-r', htmlHits('<div class="border-radius"></div>'), []);
  check('border-radius the declaration', scssHits('.a { border-radius: 8px; }'), []);
  check('rounded-lg is not rounded-l', htmlHits('<div class="rounded-lg rounded-full"></div>'), []);
  check('flex-start is not a side', scssHits('.a { align-items: flex-start; }'), []);
  check('flex-end is not a side', scssHits('.a { justify-content: flex-end; }'), []);
  check('the logical margin utilities', htmlHits('<div class="me-2 ms-2 ps-5 pe-3"></div>'), []);
  // The converted spelling, important prefix and all: matching `!` must not
  // drag `me`/`ms` into the alternation.
  check('the important-prefixed logical margin utility', htmlHits('<div class="!-me-2"></div>'), []);
  check('the important-prefixed logical utilities', htmlHits('<div class="!ms-2 !pe-3"></div>'), []);
  check('the logical margin utilities inside @apply', scssHits('.a { @apply ms-2 me-4; }'), []);
  check('the logical corner and border utilities', htmlHits('<div class="rounded-s-lg border-e"></div>'), []);
  check('the logical alignment utilities', htmlHits('<p class="text-start text-end">x</p>'), []);
  check('margin-inline-end', scssHits('.a { margin-inline-end: 8px; }'), []);
  check('inset-inline-start', scssHits('.a { inset-inline-start: 0; }'), []);
  check('text-align: end', scssHits('.a { text-align: end; }'), []);
  check('a custom property naming a side', scssHits('.a { --drawer-left: 0; }'), []);
  check('a vertical translate', scssHits('.a { transform: translateY(-100%); }'), []);
  check('prose in a block comment', scssHits('/* was margin-left: 8px before the sweep */\n.a { color: red; }'), []);
  check('prose in a line comment', scssHits('// text-align: right lived here\n.a { color: red; }'), []);
  check('prose in a template comment', htmlHits('<!-- the old markup used ml-2 -->\n<div></div>'), []);
  // The `//` in an href is not a line comment: the template masker blanks
  // `<!-- -->` and nothing else, so the rest of the line is still scanned.
  check('a url does not blank the rest of the line', htmlHits('<a href="https://x/y" class="ml-2">x</a>'), [
    'ml-2',
  ]);

  // --- exemptions ---------------------------------------------------------
  check('a safe-area inset', scssHits('.a { padding-left: env(safe-area-inset-left); }'), []);
  check('a safe-area variable', scssHits('.a { left: var(--safe-left); }'), []);
  check(
    'a marker exempts the block it annotates',
    scssHits(
      '/* direction:physical — drawer slide */\n' +
        '@keyframes slideIn {\n' +
        '  from { transform: translateX(-100%); }\n' +
        '  to { transform: translateX(0); }\n' +
        '}\n' +
        '.after { margin-left: 8px; }\n'
    ),
    ['margin-left:']
  );
  check(
    'the marker exempts one block, not the file',
    scssHits(
      '.before { margin-left: 8px; }\n' +
        '/* direction:physical */\n' +
        '.slide { transform: translateX(-100%); }\n' +
        '.after { padding-left: 8px; }\n'
    ),
    ['margin-left:', 'padding-left:']
  );
  check(
    'a marker with no block after it exempts nothing',
    scssHits('.a {\n  /* direction:physical */\n  margin-left: 8px;\n}\n'),
    ['margin-left:']
  );
  check(
    'the marker range covers the whole balanced block',
    markerRanges(
      '/* direction:physical */\n@keyframes s {\n  from { left: 0; }\n  to { left: 10px; }\n}\n',
      '/* direction:physical */\n@keyframes s {\n  from { left: 0; }\n  to { left: 10px; }\n}\n'
    ),
    [[1, 5]]
  );

  // --- reporting ----------------------------------------------------------
  check('line numbers survive masking', scanScss('\n\n.a { margin-left: 0; }')[0].line, 3);
  check('names the logical replacement', logicalEquivalent('margin-left:'), 'margin-inline-start');
  check('border-left resolves before border-l', logicalEquivalent('border-left:'), 'border-inline-start');
  check('rounded-tl resolves before rounded-l', logicalEquivalent('rounded-tl-'), 'rounded-ss-*');
  check('an offset keeps its colon', logicalEquivalent('left:'), 'inset-inline-start:');
  check('a negative utility resolves', logicalEquivalent('-mr-1'), 'me-*');

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
  console.log(`check-direction self-test: ${results.length} passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else if (process.argv.includes('--print-baseline')) {
  printBaseline();
} else {
  run();
}
