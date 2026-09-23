#!/usr/bin/env node
/**
 * Catches a `<mat-icon>` that carries an accessible name and is announced to
 * nobody.
 *
 * Angular Material's MatIcon sets `aria-hidden="true"` on its own host
 * element in its constructor, unless the template carries a *literal*
 * `aria-hidden` attribute. It reads that attribute through
 * `HostAttributeToken`, which sees the static text in the template and
 * nothing else — so `[attr.aria-hidden]="…"` does not satisfy it, and
 * neither does `role="img"` or `[attr.aria-label]`. An icon written to be
 * read is therefore hidden from the reader it was written for, and every
 * signal that something is wrong points the other way: the role is right,
 * the label is right, the tooltip works for a sighted user, and the rendered
 * DOM only disagrees at runtime.
 *
 * Three icons in this tree had exactly that shape — the amount and date
 * verification flags on the transaction form and the amount flag on the
 * import review card — and each was the only thing telling a screen-reader
 * user that a scanned figure needed checking. The correct spelling was
 * already here twice, on the split indicator in `transaction-list` and
 * `transaction-row`, so this is a class that had been met, solved, and never
 * swept for.
 *
 * Decisions worth stating, because each has a cheaper alternative that is
 * worse:
 *
 *   - **The rule keys on `mat-icon`, not on `role="img"`.** A `role="img"`
 *     on any other element is fine as written: nothing runs a constructor
 *     that hides it. `category-suggestion.component.html`'s confidence dot
 *     is a `<span role="img">` with a bound label and no `aria-hidden`, and
 *     it is correct. A rule scoped to the role would fail it and teach the
 *     next person to add a pointless attribute.
 *
 *   - **Any literal `aria-hidden` counts, whatever its value.** Not just
 *     `"false"`. An icon that carries a label *and* a literal
 *     `aria-hidden="true"` is a deliberate choice, and the tree has two of
 *     them: the date and currency flags on the import review card sit inside
 *     a button that carries its own `[attr.aria-label]`, so hiding the icon
 *     is what stops the button being announced twice. Demanding `"false"`
 *     would fail both and the fix would make the card worse.
 *
 *   - **An unlabelled icon is not this gate's business.** A decorative icon
 *     with no name needs nothing; MatIcon's default is already right for it.
 *     This checks only the icons that went to the trouble of having a name.
 *
 *   - **A source scan rather than a spec.** The defect is an interaction
 *     between a constructor and a template's literal text, so a Karma
 *     assertion has to instantiate the owning component to see one — and the
 *     three sites live in two components whose specs both blanked their
 *     templates, which is how all three survived. Reading the source catches
 *     every site, including the one added next month by the same copy-paste.
 *
 * What it deliberately cannot see:
 *   - An icon whose attributes arrive from a directive's host bindings or a
 *     spread rather than the template's own text. MatIcon reads the static
 *     attribute, so such an icon is hidden too, but there is no text pattern
 *     for it.
 *   - Whether a label is any *good*. An `aria-label` bound to an expression
 *     that resolves to an empty string passes here and announces nothing —
 *     the inverse defect, and one no source scan can judge.
 *   - `aria-labelledby`. It names another element as the accessible name and
 *     is not in use on any icon in this tree; adding it would need the same
 *     literal `aria-hidden`, and this gate would not say so.
 *   - An `<svg>` or `<i>` used as an icon instead of `<mat-icon>`. Nothing
 *     hides those, so nothing needs to un-hide them.
 *   - A `mat-icon` inside a string that is not a template at all — a test
 *     fixture in a `.spec.ts`, say. Spec files are skipped for that reason.
 *
 * A second, unrelated defect shares this file because it shares the shape:
 * Angular Material's `mat-spinner`, `mat-progress-bar` and
 * `mat-progress-spinner` all render `role="progressbar"` and none of them
 * takes a name from anywhere — unlike a button or a heading, a progressbar's
 * accessible name has no content to fall back to, so a bare one is silent by
 * construction, on every route, for as long as it is on screen. The fix is
 * either of two things, and only a human reading the surrounding markup can
 * choose which: a translated `[attr.aria-label]`, when the indicator is the
 * only thing saying work is happening; or a literal `aria-hidden="true"`,
 * when it sits inside a button or a `role="status"` that already carries
 * visible text and naming the indicator too would announce the same state
 * twice. This rule only checks that ONE of those two escape hatches was
 * used — same as the icon rule, it cannot tell a good `aria-label` from an
 * empty one, and it cannot tell whether the control an `aria-hidden`
 * indicator sits inside is actually the one announcing the state, only that
 * something declared the choice deliberately.
 *
 * Reference documentation lives in docs/accessibility.md.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const SOURCE_DIR = 'src/app';
const DOC = 'docs/accessibility.md';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.angular', 'coverage']);

/** The opening tag, which routinely spans several lines. */
const ICON_TAG = /<mat-icon\b([^>]*)>/g;

/**
 * Any spelling that gives the icon an accessible name: the explicit image
 * role, or an aria-label in literal, property or attribute-binding form.
 */
const NAMED = /role\s*=\s*"img"|aria-label/;

/**
 * A literal `aria-hidden="…"` attribute — the only thing MatIcon's
 * constructor reads. The lookbehind rejects the bound forms, whose names end
 * in `.` or `[`: `[attr.aria-hidden]=` and `[aria-hidden]=`.
 */
const LITERAL_HIDDEN = /(?<![\w.[-])aria-hidden\s*=\s*"/;

/** The opening tag of any of the three progress indicators. */
const PROGRESS_TAG = /<mat-(spinner|progress-bar|progress-spinner)\b([^>]*)>/g;

/**
 * Any spelling that names the indicator: a literal, property-bound or
 * attribute-bound `aria-label`, or `aria-labelledby` — which contains
 * `aria-label` as a substring, so the one test covers both.
 */
const PROGRESS_NAMED = /aria-label/;

/**
 * A literal `aria-hidden="true"`, and nothing looser than that. Unlike
 * MatIcon's constructor quirk above, nothing reads this attribute specially:
 * a bound `[attr.aria-hidden]` is just as invisible to a screen reader as
 * the literal form, but this gate cannot evaluate it, so it does not count —
 * and `aria-hidden="false"` is a value someone wrote on purpose, which this
 * rule takes at its word and still requires a name for.
 */
const PROGRESS_HIDDEN = /(?<![\w.[-])aria-hidden\s*=\s*"true"/;

/**
 * Blanks comments while preserving every byte offset, so a line number taken
 * from the masked text still points at the real line. Handles `//`, `/* *​/`
 * and `<!-- -->`; a commented-out icon is not an icon.
 * (Copied from check-direction.mjs, which copied it from check-truncation.mjs
 * — each gate script stays runnable on its own.)
 */
export function maskComments(source) {
  let out = '';
  let i = 0;
  let state = 'code';
  let quote = '';
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    const four = source.slice(i, i + 4);
    if (state === 'code') {
      if (quote) {
        if (source[i] === '\\') { out += source.slice(i, i + 2); i += 2; continue; }
        if (source[i] === quote) quote = '';
        out += source[i]; i += 1; continue;
      }
      if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
        quote = source[i]; out += source[i]; i += 1; continue;
      }
      if (two === '//') { state = 'line'; out += '  '; i += 2; continue; }
      if (two === '/*') { state = 'block'; out += '  '; i += 2; continue; }
      if (four === '<!--') { state = 'html'; out += '    '; i += 4; continue; }
      out += source[i]; i += 1; continue;
    }
    if (state === 'line') {
      if (source[i] === '\n') { state = 'code'; out += '\n'; i += 1; continue; }
      out += ' '; i += 1; continue;
    }
    if (state === 'block') {
      if (two === '*/') { state = 'code'; out += '  '; i += 2; continue; }
      out += source[i] === '\n' ? '\n' : ' '; i += 1; continue;
    }
    // html
    if (source.slice(i, i + 3) === '-->') { state = 'code'; out += '   '; i += 3; continue; }
    out += source[i] === '\n' ? '\n' : ' '; i += 1;
  }
  return out;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

/**
 * Every named icon in one file's source that carries no literal
 * `aria-hidden`. Returns `{ line, attrs }` for each.
 */
export function scan(source) {
  const masked = maskComments(source);
  const hits = [];
  ICON_TAG.lastIndex = 0;
  let match;
  while ((match = ICON_TAG.exec(masked)) !== null) {
    const attrs = match[1];
    if (!NAMED.test(attrs)) continue;
    if (LITERAL_HIDDEN.test(attrs)) continue;
    hits.push({ line: lineOf(masked, match.index), attrs: attrs.replace(/\s+/g, ' ').trim() });
  }
  return hits;
}

/**
 * Every progress indicator in one file's source that carries no accessible
 * name and no literal `aria-hidden="true"`. Returns `{ line, tag, attrs }`
 * for each.
 */
export function scanProgress(source) {
  const masked = maskComments(source);
  const hits = [];
  PROGRESS_TAG.lastIndex = 0;
  let match;
  while ((match = PROGRESS_TAG.exec(masked)) !== null) {
    const attrs = match[2];
    if (PROGRESS_NAMED.test(attrs)) continue;
    if (PROGRESS_HIDDEN.test(attrs)) continue;
    hits.push({
      line: lineOf(masked, match.index),
      tag: `mat-${match[1]}`,
      attrs: attrs.replace(/\s+/g, ' ').trim(),
    });
  }
  return hits;
}

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (entry.endsWith('.html') || (entry.endsWith('.ts') && !entry.endsWith('.spec.ts'))) {
      found.push(path);
    }
  }
  return found;
}

function posix(path) {
  return path.split(sep).join('/');
}

function run() {
  const files = walk(SOURCE_DIR);
  const findings = [];
  let icons = 0;
  let named = 0;
  let progressTags = 0;
  let progressNamed = 0;

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const hasIcon = source.includes('<mat-icon');
    // A file with a progress indicator and no mat-icon must still be read,
    // for the progress rule below.
    const hasProgress = /<mat-(spinner|progress-bar|progress-spinner)\b/.test(source);
    if (!hasIcon && !hasProgress) continue;
    const masked = maskComments(source);

    if (hasIcon) {
      ICON_TAG.lastIndex = 0;
      let match;
      while ((match = ICON_TAG.exec(masked)) !== null) {
        icons++;
        if (NAMED.test(match[1])) named++;
      }
      for (const hit of scan(source)) {
        findings.push({ rule: 'icon', site: `${posix(file)}:${hit.line}`, tag: 'mat-icon', attrs: hit.attrs });
      }
    }

    if (hasProgress) {
      PROGRESS_TAG.lastIndex = 0;
      let match;
      while ((match = PROGRESS_TAG.exec(masked)) !== null) {
        progressTags++;
        if (PROGRESS_NAMED.test(match[2]) || PROGRESS_HIDDEN.test(match[2])) progressNamed++;
      }
      for (const hit of scanProgress(source)) {
        findings.push({ rule: 'progress', site: `${posix(file)}:${hit.line}`, tag: hit.tag, attrs: hit.attrs });
      }
    }
  }

  const templates = files.filter((file) => file.endsWith('.html')).length;
  console.log(
    `Checked ${icons} mat-icon tag(s) across ${templates} template(s) and ` +
      `${files.length - templates} inline-template source file(s): ${named} carry an accessible name.`
  );
  console.log(
    `Checked ${progressTags} progress indicator tag(s) (mat-spinner, mat-progress-bar, ` +
      `mat-progress-spinner): ${progressNamed} carry a name or are hidden inside a control ` +
      `that already announces it.`
  );

  if (findings.length > 0) {
    findings.sort((a, b) => a.site.localeCompare(b.site));
    const iconFindings = findings.filter((f) => f.rule === 'icon');
    const progressFindings = findings.filter((f) => f.rule === 'progress');

    if (iconFindings.length > 0) {
      console.error(`\n${iconFindings.length} icon(s) carry a name nothing can read:\n`);
      for (const finding of iconFindings) {
        console.error(`  ${finding.site}  <${finding.tag} ${finding.attrs}>`);
        console.error(`    → add a literal aria-hidden="false"\n`);
      }
      console.error(
        `MatIcon sets aria-hidden="true" on itself at construction unless the\n` +
          `template carries a literal aria-hidden attribute — a bound\n` +
          `[attr.aria-hidden] does not count, because HostAttributeToken reads the\n` +
          `static attribute. So role="img" and a bound aria-label are not enough on\n` +
          `their own, and the icon is announced to nobody. Write aria-hidden="false"\n` +
          `beside the label, as transaction-list.component.html:135 does. An icon\n` +
          `that is meant to stay silent inside an already-labelled control takes a\n` +
          `literal aria-hidden="true" instead, which this check accepts.\n` +
          `Reference: ${DOC}.\n`
      );
    }

    if (progressFindings.length > 0) {
      console.error(`\n${progressFindings.length} progress indicator(s) carry no accessible name:\n`);
      for (const finding of progressFindings) {
        console.error(`  ${finding.site}  <${finding.tag} ${finding.attrs}>`);
        console.error(`    → add [attr.aria-label] with a translated key, or a literal\n` +
          `      aria-hidden="true" if a control around it already announces the state\n`);
      }
      console.error(
        `mat-spinner, mat-progress-bar and mat-progress-spinner all render\n` +
          `role="progressbar" with no accessible name of their own — there is no\n` +
          `content for one to come from, unlike a button or a heading. Name it with a\n` +
          `translated [attr.aria-label], or hide the redundant progressbar node with a\n` +
          `literal aria-hidden="true" when it sits inside a button or role="status"\n` +
          `that already carries visible text for the same state.\n` +
          `Reference: ${DOC}.\n`
      );
    }

    process.exit(1);
  }

  console.log(
    `Every named mat-icon carries a literal aria-hidden, and every progress indicator ` +
      `carries a name or is hidden inside the control that already announces it.`
  );
}

function selfTest() {
  const cases = [];
  function check(name, actual, expected) {
    cases.push({ name, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
  }
  const lines = (source) => scan(source).map((hit) => hit.line);

  // --- must hit ---
  check(
    'role=img with a bound label and no literal aria-hidden',
    lines('<mat-icon role="img" [attr.aria-label]="tip()">error_outline</mat-icon>'),
    [1]
  );
  check(
    'the real shape, spread over several lines',
    lines(
      '<mat-icon\n  matIconSuffix\n  class="verify-flag"\n  [matTooltip]="tip()"\n' +
        '  role="img"\n  [attr.aria-label]="tip()"\n>error_outline</mat-icon>'
    ),
    [1]
  );
  check('a literal aria-label alone', lines('<mat-icon aria-label="Close">close</mat-icon>'), [1]);
  check('a property-bound aria-label alone', lines('<mat-icon [aria-label]="x">a</mat-icon>'), [1]);
  check(
    'a bound aria-hidden does not count as literal',
    lines('<mat-icon role="img" [attr.aria-hidden]="false" [attr.aria-label]="x">a</mat-icon>'),
    [1]
  );
  check(
    'two in one file report both lines',
    lines('<mat-icon role="img" [attr.aria-label]="a">x</mat-icon>\n<div></div>\n<mat-icon aria-label="b">y</mat-icon>'),
    [1, 3]
  );

  // --- must not hit: the load-bearing half ---
  check(
    'the correct spelling, already shipping',
    lines('<mat-icon class="split-indicator" role="img" aria-hidden="false" [attr.aria-label]="k | translate">call_split</mat-icon>'),
    []
  );
  check(
    'deliberately silent inside an already-labelled control',
    lines('<mat-icon class="verify-flag" [matTooltip]="t()" aria-hidden="true">error_outline</mat-icon>'),
    []
  );
  check('a plain decorative icon with no name', lines('<mat-icon>close</mat-icon>'), []);
  check('a decorative icon that is explicitly hidden', lines('<mat-icon aria-hidden="true">check</mat-icon>'), []);
  check(
    'a span with role=img is not a mat-icon',
    lines('<span class="confidence-dot" role="img" [attr.aria-label]="label()"></span>'),
    []
  );
  check(
    'a labelled button wrapping an unnamed icon',
    lines('<button [attr.aria-label]="label()"><mat-icon aria-hidden="true">close</mat-icon></button>'),
    []
  );
  check('aria-labelledby is not an aria-label', lines('<mat-icon aria-labelledby="x" aria-hidden="true">a</mat-icon>'), []);

  // --- comments ---
  check(
    'a commented-out icon is not an icon (html comment)',
    lines('<!-- <mat-icon role="img" [attr.aria-label]="x">a</mat-icon> -->'),
    []
  );
  check(
    'a line comment in an inline template is masked',
    lines('// <mat-icon role="img" [attr.aria-label]="x">a</mat-icon>\n<mat-icon aria-label="b">y</mat-icon>'),
    [2]
  );

  // --- reporting ---
  check(
    'the reported attributes are collapsed to one line',
    scan('<mat-icon\n  role="img"\n  [attr.aria-label]="x"\n>a</mat-icon>').map((hit) => hit.attrs),
    ['role="img" [attr.aria-label]="x"']
  );

  // --- the progress rule: must hit ---
  const progressLines = (source) => scanProgress(source).map((hit) => hit.line);

  check('a bare mat-progress-bar hits', progressLines('<mat-progress-bar mode="determinate"></mat-progress-bar>'), [1]);
  check('a bare mat-spinner hits', progressLines('<mat-spinner diameter="20"></mat-spinner>'), [1]);
  check('a bare mat-progress-spinner hits', progressLines('<mat-progress-spinner diameter="20"></mat-progress-spinner>'), [1]);
  check(
    'a bound [attr.aria-hidden] does not count as literal, so it still hits',
    progressLines('<mat-spinner [attr.aria-hidden]="true"></mat-spinner>'),
    [1]
  );
  check(
    'aria-hidden="false" does not hide it from the tree, so it still hits',
    progressLines('<mat-progress-bar aria-hidden="false"></mat-progress-bar>'),
    [1]
  );

  // --- the progress rule: must not hit (the load-bearing half) ---
  check('a literal aria-label names it', progressLines('<mat-spinner aria-label="Loading"></mat-spinner>'), []);
  check(
    'a bound [attr.aria-label] names it',
    progressLines('<mat-progress-bar [attr.aria-label]="label() | translate"></mat-progress-bar>'),
    []
  );
  check('aria-labelledby names it', progressLines('<mat-progress-bar aria-labelledby="x"></mat-progress-bar>'), []);
  check(
    'a literal aria-hidden="true" hides it inside a control that already announces the state',
    progressLines('<mat-spinner aria-hidden="true"></mat-spinner>'),
    []
  );

  // --- the progress rule: comments ---
  check(
    'a commented-out progress bar is not a progress bar (html comment)',
    progressLines('<!-- <mat-progress-bar></mat-progress-bar> -->'),
    []
  );
  check(
    'a line comment in an inline template is masked, the next tag still checked',
    progressLines('// <mat-spinner></mat-spinner>\n<mat-progress-bar></mat-progress-bar>'),
    [2]
  );

  // --- the progress rule: reporting ---
  check(
    'the reported attributes are collapsed to one line',
    scanProgress('<mat-progress-bar\n  mode="determinate"\n  [value]="v"\n></mat-progress-bar>').map(
      (hit) => hit.attrs
    ),
    ['mode="determinate" [value]="v"']
  );

  const failed = cases.filter((c) => !c.ok);
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
  console.log(`check-icon-labels self-test: ${cases.length} passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  run();
}
