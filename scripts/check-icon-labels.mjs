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

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('<mat-icon')) continue;
    const masked = maskComments(source);
    ICON_TAG.lastIndex = 0;
    let match;
    while ((match = ICON_TAG.exec(masked)) !== null) {
      icons++;
      if (NAMED.test(match[1])) named++;
    }
    for (const hit of scan(source)) {
      findings.push({ site: `${posix(file)}:${hit.line}`, attrs: hit.attrs });
    }
  }

  const templates = files.filter((file) => file.endsWith('.html')).length;
  console.log(
    `Checked ${icons} mat-icon tag(s) across ${templates} template(s) and ` +
      `${files.length - templates} inline-template source file(s): ${named} carry an accessible name.`
  );

  if (findings.length > 0) {
    findings.sort((a, b) => a.site.localeCompare(b.site));
    console.error(`\n${findings.length} icon(s) carry a name nothing can read:\n`);
    for (const finding of findings) {
      console.error(`  ${finding.site}  <mat-icon ${finding.attrs}>`);
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
    process.exit(1);
  }

  console.log(`Every named mat-icon carries a literal aria-hidden, so every one of them is announced as its author meant.`);
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
