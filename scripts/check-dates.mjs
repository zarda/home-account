#!/usr/bin/env node
/**
 * Runs the date audit greps docs/dates.md lists, so they stop being
 * reviewer instructions.
 *
 * Five shapes, each of which has already shipped a real bug here: an
 * end-of-day bound built by hand, a month end built by hand, a day key taken
 * from `toISOString()` (which names the UTC day, not the local one), a day
 * step written as a fixed 86 400 000 ms (which skips or repeats an hour
 * across a DST boundary), and `new Date(x.date)` re-parsing a string the
 * module already knows how to read. All five are legal TypeScript that
 * type-checks, lints and passes every spec at UTC — and CI runs at UTC, so
 * the two non-UTC `test:dates` passes are the only thing between them and a
 * user, and they only cover the specs somebody remembered to enumerate.
 * Nothing else in the repo looks for the shapes themselves: eslint.config.js
 * has no date rule, the other scripts under scripts/ read stylesheets,
 * catalogs, prompt call sites and component metadata, and two sweeps' worth
 * of stragglers (#248, #266, #267) is what reviewer-only greps cost.
 *
 * Decisions worth stating, because each has a cheaper alternative that is
 * worse:
 *
 *   - Specs are excluded from all five greps, not from the two the doc
 *     mentions. The contract docs/dates.md states is "nothing in PRODUCTION
 *     CODE outside this module", and a spec matches these shapes on purpose:
 *     an expectation literal is not arithmetic, about fifteen suites build
 *     their bounds as `new Date(y, m, d, 23, 59, 59, 999)` to assert against,
 *     and `reminder.service.spec.ts` spells a staleness horizon as
 *     `61 * 24 * 60 * 60 * 1000` in three places. Excluding only the first
 *     two greps — which is what the doc's prose says — ships this gate red on
 *     the fourth.
 *   - transaction-date.utils.ts is exempt from the first two greps and from
 *     neither of the others. It is the module every other file is supposed to
 *     call, so it is where an end-of-day and a month end are *meant* to be
 *     written by hand; it has no business taking a UTC day key or stepping a
 *     day in milliseconds, so those two still apply to it. A blanket
 *     file-level exemption would be one line shorter and would hide the two
 *     shapes the module is most likely to grow.
 *   - The `new Date(x.date)` grep is a per-file ratchet with a count, not a
 *     bare list of allowed files. Cloning a value already typed as a `Date`
 *     looks exactly like re-parsing a string, so the hits cannot be
 *     eliminated and the doc records each by name. A file-only allowlist —
 *     the cheaper shape — would let a sixth hit land in an already-listed
 *     file and say nothing; with a count, adding one is a deliberate edit to
 *     this table and to docs/dates.md's, in the same commit. Staleness fails
 *     in both directions, as check-direction.mjs's baseline does: a count
 *     that is too high is a ratchet that has stopped ratcheting.
 *   - Comments are blanked before scanning, offsets preserved. docs/dates.md
 *     is quoted at length inside these modules — `// the 23, 59, 59 bound
 *     belongs in endOfDay()` is the note that stops the next person putting
 *     it back, and prose about a shape is not that shape.
 *
 * What it deliberately cannot see:
 *   - A sixth shape. These are the five docs/dates.md lists because each one
 *     caught something; a hand-rolled quarter boundary or a week start built
 *     from `getDay()` is a judgement call, not a grep.
 *   - The same arithmetic split across two lines. Every pattern is
 *     line-oriented, so `const end = new Date(\n  y, m, d, 23, 59, 59, 999\n)`
 *     still matches (the literals share a line) but
 *     `x.getTime()\n  + 24 * 60 * 60 * 1000` does not.
 *   - The arithmetic done in a helper it cannot name. `addMilliseconds(t,
 *     DAY_MS)` is the same defect wearing a constant, and no text pattern
 *     reaches it.
 *   - date-fns. `addDays`, `endOfMonth` and friends are zone-correct and are
 *     the cure, not the disease, so nothing here looks at them.
 *   - A `.html` template. Templates cannot construct a `Date`; the shapes are
 *     all TypeScript.
 *   - Whether a hit is actually wrong. The fifth grep cannot be zero — the
 *     ratchet's job is to make each survivor a recorded decision rather than
 *     an accident.
 *
 * Reference documentation lives in docs/dates.md.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';

const SOURCE_DIR = 'src/app';
const DOC = 'docs/dates.md';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.angular', 'coverage']);

/** The module every other file is meant to call for a calendar bound. */
const DATE_MODULE = 'src/app/core/utils/transaction-date.utils.ts';

/**
 * The four shapes that must return nothing in production code. `exempt`
 * names the files a shape is legitimately written in; `advice` is what to
 * write instead, printed beside the hit so the finding is actionable without
 * opening the doc.
 */
const AUDIT_GREPS = [
  {
    label: 'a hand-built end-of-day bound',
    pattern: /23, 59, 59|setHours\(23/g,
    exempt: [DATE_MODULE],
    advice: 'endOfDay() / periodWindow() in core/utils/transaction-date.utils.ts',
  },
  {
    label: 'a hand-built month end',
    pattern: /getMonth\(\) \+ 1, 0/g,
    exempt: [DATE_MODULE],
    advice: 'daysInMonth() / endOfMonth() in core/utils/transaction-date.utils.ts',
  },
  {
    label: 'a day key taken from a UTC instant',
    pattern: /toISOString\(\)\.split/g,
    exempt: [],
    advice: 'toDayKey() — toISOString() names the UTC day, which is yesterday for half the world',
  },
  {
    label: 'a day step written in milliseconds',
    pattern: /getTime\(\) [+-] .*24 \* 60 \* 60 \* 1000/g,
    exempt: [],
    advice: "date-fns addDays() — a fixed 86 400 000 ms step skips or repeats an hour across a DST boundary",
  },
];

/**
 * `new Date(x.date)` and its two siblings: re-parsing a string the module
 * already reads, or cloning a value that is already a `Date`. The two are
 * indistinguishable from the outside, so this one ratchets instead of
 * demanding zero.
 */
const CLONE_OR_PARSE = /new Date\([a-zA-Z0-9_$]+\.(date|startDate|endDate)\b/g;
const CLONE_ADVICE =
  'parseDateInput() unless the value is already typed Date — and record the clone in ' + DOC;

/**
 * Files that may hold a `new Date(x.date)`, with how many, and why. Every
 * row here has a row in docs/dates.md's table; the two tables change
 * together. Counts may only go down.
 */
const ALLOWED_CLONES = {
  'src/app/core/utils/import-review.utils.ts': {
    hits: 2,
    reason: 'CategorizedImportTransaction.date is typed Date — both sites clone, neither parses',
  },
  'src/app/features/dashboard/recent-transactions/recent-transactions.component.ts': {
    hits: 1,
    reason: 'cloning a value already typed as a Date, not parsing a string',
  },
  'src/app/features/reports/insights/insight-card/insight-card.component.ts': {
    hits: 2,
    reason: 'the legacy-ISO-instant fallback, reached only after parseDayKey returns null',
  },
};

/**
 * Blanks comments while preserving every byte offset, so a line number taken
 * from the masked text still points at the real line. Prose *about* a date
 * shape is not that shape, and these modules carry a lot of it — the note
 * saying why the bound moved into endOfDay() is what stops it moving back.
 * (Copied from check-direction.mjs, which needs the same thing for the same
 * reason; each gate script stays runnable on its own.)
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

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) found.push(path);
  }
  return found;
}

function posix(path) {
  return path.split(sep).join('/');
}

/** Every line of `source` matching `pattern`, comments blanked first. */
function linesMatching(source, pattern) {
  const hits = [];
  maskComments(source)
    .split('\n')
    .forEach((line, index) => {
      pattern.lastIndex = 0;
      if (pattern.test(line)) hits.push({ line: index + 1, text: line.trim() });
    });
  return hits;
}

/** Audit-grep hits in one production file, the file's own exemptions applied. */
export function scanAuditGreps(source, file) {
  const hits = [];
  for (const grep of AUDIT_GREPS) {
    if (grep.exempt.includes(file)) continue;
    for (const hit of linesMatching(source, grep.pattern)) {
      hits.push({ ...hit, label: grep.label, advice: grep.advice });
    }
  }
  return hits;
}

/** `new Date(x.date)` hits in one production file. */
export function scanClones(source) {
  return linesMatching(source, CLONE_OR_PARSE);
}

function run() {
  const files = walk(SOURCE_DIR);
  const auditFindings = [];
  const clonesByFile = new Map();

  for (const path of files) {
    const file = posix(path);
    const source = readFileSync(path, 'utf8');
    for (const hit of scanAuditGreps(source, file)) auditFindings.push({ file, ...hit });
    const clones = scanClones(source);
    if (clones.length > 0) clonesByFile.set(file, clones);
  }

  const cloneFindings = [];
  for (const [file, hits] of [...clonesByFile.entries()].sort()) {
    const allowed = ALLOWED_CLONES[file];
    if (allowed === undefined) {
      for (const hit of hits) {
        cloneFindings.push({
          file,
          ...hit,
          label: 'new Date(x.date) in a file the table does not list',
          advice: CLONE_ADVICE,
        });
      }
    } else if (hits.length > allowed.hits) {
      for (const hit of hits) {
        cloneFindings.push({
          file,
          ...hit,
          label: `${hits.length} clone(s), table says ${allowed.hits}`,
          advice: CLONE_ADVICE,
        });
      }
    } else if (hits.length < allowed.hits) {
      cloneFindings.push({
        file,
        line: 1,
        text: `${hits.length} clone(s) left but the table still says ${allowed.hits}`,
        label: 'the ratchet is stale — lower or remove the row',
        advice: `the matching row in ${DOC}`,
      });
    }
  }

  for (const file of Object.keys(ALLOWED_CLONES).sort()) {
    if (clonesByFile.has(file)) continue;
    cloneFindings.push({
      file,
      line: 1,
      text: `the table says ${ALLOWED_CLONES[file].hits} but the file is ${existsSync(file) ? 'clean' : 'gone'}`,
      label: 'the ratchet is stale — lower or remove the row',
      advice: `the matching row in ${DOC}`,
    });
  }

  const allowedTotal = Object.values(ALLOWED_CLONES).reduce((sum, row) => sum + row.hits, 0);
  console.log(
    `Checked ${files.length} production TypeScript files against ${AUDIT_GREPS.length} date audit ` +
      `greps, plus ${allowedTotal} recorded new Date(x.date) clone(s) in ` +
      `${Object.keys(ALLOWED_CLONES).length} file(s).`
  );

  const findings = [...auditFindings, ...cloneFindings].sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)
  );

  if (findings.length > 0) {
    console.error(`\n${findings.length} date audit hit(s) in production code:\n`);
    for (const finding of findings) {
      console.error(`  ${finding.file}:${finding.line}  ${finding.text}`);
      console.error(`      ${finding.label} → ${finding.advice}`);
    }
    console.error(
      `\nThese are the greps ${DOC} lists under "The audit greps"; each one has caught a\n` +
        `real bug. A calendar bound belongs in core/utils/transaction-date.utils.ts, and a\n` +
        `string that names a day is read by parseDateInput, never by new Date(). CI runs at\n` +
        `UTC, where every one of these shapes passes its specs. Reference: ${DOC}.\n`
    );
    process.exit(1);
  }

  console.log('No hand-rolled date arithmetic outside the module that owns it.');
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

  const audit = (source, file = 'src/app/features/x/x.component.ts') =>
    scanAuditGreps(source, file).map((hit) => hit.text);
  const clones = (source) => scanClones(source).map((hit) => hit.text);

  // --- must hit -----------------------------------------------------------
  check('an end-of-day literal', audit('const end = new Date(y, m, d, 23, 59, 59, 999);'), [
    'const end = new Date(y, m, d, 23, 59, 59, 999);',
  ]);
  check('setHours(23', audit('d.setHours(23, 59, 59, 999);'), ['d.setHours(23, 59, 59, 999);']);
  check('a hand-built month end', audit('const last = new Date(y, d.getMonth() + 1, 0);'), [
    'const last = new Date(y, d.getMonth() + 1, 0);',
  ]);
  check('a UTC day key', audit("const key = d.toISOString().split('T')[0];"), [
    "const key = d.toISOString().split('T')[0];",
  ]);
  check('a day step in milliseconds', audit('const t = d.getTime() + 24 * 60 * 60 * 1000;'), [
    'const t = d.getTime() + 24 * 60 * 60 * 1000;',
  ]);
  check('a multi-day step in milliseconds', audit('const t = d.getTime() - 30 * 24 * 60 * 60 * 1000;'), [
    'const t = d.getTime() - 30 * 24 * 60 * 60 * 1000;',
  ]);
  check('the day-key grep still applies to the date module', audit("d.toISOString().split('T')[0];", DATE_MODULE), [
    "d.toISOString().split('T')[0];",
  ]);
  check('the millisecond-step grep still applies to the date module', audit('d.getTime() + 24 * 60 * 60 * 1000;', DATE_MODULE), [
    'd.getTime() + 24 * 60 * 60 * 1000;',
  ]);
  check('a re-parsed date field', clones('const d = new Date(row.date);'), [
    'const d = new Date(row.date);',
  ]);
  check('a re-parsed range bound', clones('const d = new Date(filters.startDate);'), [
    'const d = new Date(filters.startDate);',
  ]);

  // --- must not hit -------------------------------------------------------
  // This half is the load-bearing one: every pattern below is legal code the
  // gate must wave through, and a gate that failed any of them would be
  // deleted within a week rather than obeyed.
  check('the date module may build its own end of day', audit('new Date(y, m, d, 23, 59, 59, 999);', DATE_MODULE), []);
  check('the date module may build its own month end', audit('new Date(y, d.getMonth() + 1, 0);', DATE_MODULE), []);
  check('prose about the bound in a line comment', audit('// the 23, 59, 59 bound belongs in endOfDay()'), []);
  check('prose about the bound in a block comment', audit('/* built with setHours(23, 59, 59, 999) before the sweep */'), []);
  check('prose about the step in a comment', audit('// was d.getTime() + 24 * 60 * 60 * 1000 until #266'), []);
  check('a month start is not a month end', audit('new Date(y, d.getMonth() + 1, 1);'), []);
  check('toISOString on its own', audit('const iso = d.toISOString();'), []);
  check('an hour in milliseconds', audit('const t = d.getTime() + 60 * 60 * 1000;'), []);
  check('a week built by date-fns', audit('const next = addDays(start, 7);'), []);
  check('endOfMonth from the module', audit('const end = endOfMonth(anchor);'), []);
  check('a field whose name merely starts with date', clones('const d = new Date(row.dateString);'), []);
  check('a field whose name merely starts with endDate', clones('const d = new Date(row.endDateKey);'), []);
  check('a bare new Date()', clones('const now = new Date();'), []);
  check('a date parsed through the module', clones('const d = parseDateInput(row.date);'), []);
  check('a clone named in a comment', clones('// new Date(row.date) lived here'), []);

  // --- reporting ----------------------------------------------------------
  check('line numbers survive masking', scanAuditGreps('\n\n// x\nconst end = new Date(y, m, d, 23, 59, 59, 999);', 'src/app/x.ts')[0].line, 4);
  check('a hit names what to write instead', scanAuditGreps("d.toISOString().split('T')[0];", 'src/app/x.ts')[0].advice.startsWith('toDayKey()'), true);
  check('the clone table is sorted and reasoned', Object.entries(ALLOWED_CLONES).every(([path, row]) => path.startsWith('src/app/') && row.hits > 0 && row.reason.length > 10), true);

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
  console.log(`check-dates self-test: ${results.length} passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  run();
}
