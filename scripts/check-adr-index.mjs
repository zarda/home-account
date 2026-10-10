#!/usr/bin/env node
/**
 * Holds docs/ADR/README.md to the gap closures the records themselves state.
 *
 * When a record closes a gap an earlier one left, the index carries the
 * relation on both rows: the closer's status names the record it closed
 * ("closes a gap of 0006"), and the closed record's status names its closer
 * ("concurrent-edit gap closed by 0007"). The older row is the one that needs
 * the pointer. Its record's Known gaps still describe the gap as open, and
 * nothing in that record can say otherwise without rewriting it. Nothing kept
 * the two sides in step: the index is prose in a table, no build reads it, and
 * the review of a new record reads the new row, not the old one. #448 found
 * closures missing from one row or from both, claims that named the wrong
 * closer, and forty-one records nobody had swept.
 *
 * What it reads, per record, once normalised:
 *   - the header, everything above the first `## ` heading: every clause
 *     that pairs "closes" or "closing" with "gap" or "gaps", up to the next
 *     period. Every four-digit number in the clause is a record this one
 *     closes;
 *   - the body: every "Closed by [ADR] NNNN", in any case, credits NNNN with
 *     closing this record. Known-gaps bullets are annotated that way when a
 *     later record closes them.
 *
 * Decisions worth stating, because each has a cheaper alternative that is
 * worse:
 *
 *   - **Whitespace is collapsed before anything matches.** The records wrap
 *     at eighty columns, so "Closed by" and the record it names, or "closes
 *     a known gap in" and the link, land on different lines about as often
 *     as not. A line-oriented scan, or a pattern with a literal space in it,
 *     would miss every wrapped note and look clean.
 *   - **Every link loses its target.** `[0051](0051-….md)` becomes `[0051]`
 *     and `[ADR 0051](0051-….md)` becomes `[ADR 0051]` first. Otherwise the
 *     period in `.md` ends the clause at the first link, and a list of closed
 *     records loses every entry after it.
 *   - **`*` emphasis is dropped**, so "*Closed by* [0076]" reads as a note.
 *   - **A date's year is not a record.** `2026-10-11` holds four digits, and
 *     a title that closes something runs on through the status line's date.
 *   - **Code is stripped**, fenced blocks and inline spans alike. A record
 *     that quotes a closure as an example, a gate's fixture say, is not
 *     stating one.
 *   - **"Names" means the number appears in the row's status cell.** The
 *     gate does not judge the wording. "Closes a gap of 0006", "amended by
 *     0143, which closes its order gap" and "extends 0092; closes a gap of
 *     0092" all name it, and the README's own conventions decide how. A
 *     number in the decision column does not count, and neither does an
 *     issue number such as `#1012`.
 *   - **A pair the index deliberately words otherwise goes in ALLOWED**, with
 *     its reason, the way check-motion.mjs records a competing declaration,
 *     rather than being skipped. ALLOWED is empty, and empty is the goal: the
 *     clause runs on to its period, so it over-matches in a few headers
 *     ("extends the provenance [0060] put", "keeps the suggestion ladder of
 *     [0063]" in a sentence that also closes a gap), and in every one of them
 *     truthful wording on both rows satisfies it. ALLOWED goes stale in both
 *     directions: an entry for a pair the gate no longer reports fails, and
 *     so does an entry with no reason.
 *
 * What it deliberately cannot see:
 *   - A closure in a phrasing outside the two patterns: "Closes one of [N]",
 *     a closure stated in a body list item rather than a "Closed by" note, or
 *     a sentence that closes something without the word "gap". ("Closes
 *     [N]'s gaps" and "Closes the first of the known gaps [N]" pair "closes"
 *     with "gap", and are read.) Each is a false negative until the gate is
 *     taught it.
 *   - A period inside the clause ends it early: an abbreviation such as
 *     "e.g.", or a doc link whose own text holds one (`[../dates.md]`). A
 *     record named after it is not read.
 *   - A note naming two closers, "Closed by [N] and [M]", credits only N.
 *   - Whether either row's wording is true. A row that names the other
 *     number for any reason passes.
 *   - A closure the index states and no record does. The index is checked
 *     against the records, not the other way round.
 *
 * The index's conventions live in docs/ADR/README.md.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ADR_DIR = 'docs/ADR';
const INDEX = 'docs/ADR/README.md';

/** A record's file name: its four-digit number, a dash, a slug. */
const RECORD_FILE = /^(\d{4})-.*\.md$/;

/** A fenced block, ``` or ~~~, indented or not. An unclosed one runs to the end. */
const FENCE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[`~]*[ \t]*$|(?![\s\S]))/gm;

/** An inline code span: a run of backticks, then a run of the same length, within one paragraph. */
const CODE_SPAN = /(?<!`)(`+)(?!`)((?:(?!\n[ \t]*\n)[\s\S])+?)(?<!`)\1(?!`)/g;

/** A Markdown link, its text in group 1. */
const LINK = /\[([^\]]*)\]\([^)]*\)/g;

/** A header clause that closes something, up to the next period. */
const CLOSURE_CLAUSE = /\bclos(?:es|ing)\b[^.]*?\bgaps?\b[^.]*?(?:\.|$)/gi;

/**
 * A record number: four digits, not part of a longer number, not an issue,
 * and not the year of a date (`2026-10-11`).
 */
const RECORD_NUMBER = /(?<![#\d])\b\d{4}\b(?!-\d{2}-\d{2})/g;

/** A body note crediting a later record with closing this one. */
const CLOSED_BY = /Closed by \[?(?:ADR )?(\d{4})/gi;

/**
 * Closure pairs the index deliberately words otherwise, keyed `C→X` (C closes
 * a gap of X), each with its reason. An entry for a pair the gate no longer
 * reports fails, so a repair edits this table in the same commit.
 */
const ALLOWED = {};

/** An ALLOWED reason: a string with something in it. */
export function reasonValid(reason) {
  return typeof reason === 'string' && reason.trim().length > 0;
}

/** Fenced blocks and inline code spans removed. A block leaves its line break behind. */
export function stripCode(text) {
  return text.replace(FENCE, '\n').replace(CODE_SPAN, ' ');
}

/** Links reduced to their text, `*` emphasis dropped, and every run of whitespace to one space. */
export function normalise(text) {
  return text.replace(LINK, '[$1]').replace(/\*+/g, '').replace(/\s+/g, ' ');
}

/** A record's header (above its first `## `) and body, each normalised. */
export function readRecord(text) {
  const stripped = stripCode(text);
  const cut = stripped.search(/^## /m);
  return {
    header: normalise(cut === -1 ? stripped : stripped.slice(0, cut)),
    body: normalise(cut === -1 ? '' : stripped.slice(cut)),
  };
}

/** Every closure one record states, as { closer, closed, source }. */
export function closuresIn(number, text) {
  const { header, body } = readRecord(text);
  const found = [];
  for (const clause of header.matchAll(CLOSURE_CLAUSE)) {
    for (const closed of clause[0].matchAll(RECORD_NUMBER)) {
      found.push({ closer: number, closed: closed[0], source: `${number}'s header: ${clause[0].trim()}` });
    }
  }
  for (const note of body.matchAll(CLOSED_BY)) {
    const sentence = body.slice(note.index).match(/^[^.]*\.?/)[0];
    found.push({ closer: note[1], closed: number, source: `${number}'s body: ${sentence}` });
  }
  return found.filter((pair) => pair.closer !== pair.closed);
}

/**
 * The index's rows, keyed by the number in each row's link text. The value is
 * the status cell, or null for a row that does not have the table's four
 * cells — a pipe inside a title shifts every cell after it.
 */
export function readIndex(text) {
  const rows = new Map();
  for (const line of text.split('\n')) {
    const row = /^\|\s*\[(\d{4})\]\([^)]*\)\s*\|(.*)\|\s*$/.exec(line);
    if (row === null) continue;
    const cells = row[2].split(/(?<!\\)\|/);
    rows.set(row[1], cells.length === 3 ? cells[1].trim() : null);
  }
  return rows;
}

/** Whether a status cell names a record number. */
function names(status, number) {
  return typeof status === 'string' && new RegExp(`(?<![#\\d])\\b${number}\\b`).test(status);
}

/**
 * The records' closures against the index: each side a pair is missing, each
 * row the parser could not read, and each ALLOWED entry that no longer holds.
 */
export function audit(records, indexText, allowed) {
  const rows = readIndex(indexText);
  const pairs = new Map();
  for (const { number, text } of records) {
    for (const { closer, closed, source } of closuresIn(number, text)) {
      const key = `${closer}→${closed}`;
      if (!pairs.has(key)) pairs.set(key, { key, closer, closed, sources: [] });
      pairs.get(key).sources.push(source);
    }
  }

  const findings = [];
  const reported = new Set();
  for (const pair of [...pairs.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const missing = [];
    if (!names(rows.get(pair.closer), pair.closed)) missing.push(pair.closer);
    if (!names(rows.get(pair.closed), pair.closer)) missing.push(pair.closed);
    if (missing.length === 0) continue;
    reported.add(pair.key);
    if (Object.hasOwn(allowed, pair.key)) continue;
    for (const row of missing) {
      findings.push({ closer: pair.closer, closed: pair.closed, row, source: pair.sources[0] });
    }
  }

  const unreadable = [...rows].filter(([, status]) => status === null).map(([number]) => number);

  const stale = [];
  for (const [key, reason] of Object.entries(allowed).sort()) {
    if (!reasonValid(reason)) stale.push({ key, problem: 'has no reason' });
    if (!reported.has(key)) stale.push({ key, problem: 'is a pair the gate no longer reports' });
  }

  return { pairs: pairs.size, findings, unreadable, stale };
}

/** One finding as the gate prints it. */
export function describe(finding) {
  return `${finding.closer} → ${finding.closed}: missing on ${finding.row}'s row`;
}

/** The records in `dir`, in number order. The directory is flat, so the walk is one level. */
function walk(dir) {
  return readdirSync(dir)
    .filter((entry) => RECORD_FILE.test(entry))
    .sort()
    .map((entry) => ({ number: entry.slice(0, 4), text: readFileSync(join(dir, entry), 'utf8') }));
}

function run() {
  const records = walk(ADR_DIR);
  const { pairs, findings, unreadable, stale } = audit(records, readFileSync(INDEX, 'utf8'), ALLOWED);

  console.log(
    `Checked ${records.length} records against ${INDEX}: ${pairs} closure pair(s) stated ` +
      `(${Object.keys(ALLOWED).length} recorded in ALLOWED).`
  );

  if (unreadable.length > 0) {
    console.error(`\n${unreadable.length} index row(s) without the table's four cells:\n`);
    for (const number of unreadable) console.error(`  ${number}`);
    console.error('\nAn unescaped | in a title shifts the status into the wrong cell; escape it as \\|.\n');
  }

  if (stale.length > 0) {
    console.error(`\n${stale.length} problem(s) with ALLOWED:\n`);
    for (const { key, problem } of stale) console.error(`  ${key} ${problem}`);
    console.error('\nEdit or remove the entry in scripts/check-adr-index.mjs.\n');
  }

  if (findings.length > 0) {
    console.error(`\n${findings.length} closure side(s) missing from the index:\n`);
    for (const finding of findings) {
      console.error(`  ${describe(finding)}`);
      console.error(`      from ${finding.source.slice(0, 200)}`);
    }
    console.error(
      '\nThe index carries every closure on both rows: the closer\'s status names the record\n' +
        'it closed ("closes a gap of 0006"), and the closed record\'s status names its closer\n' +
        '("concurrent-edit gap closed by 0007"). Add the missing side in the row\'s own words.\n' +
        'A pair the index words otherwise on purpose goes in ALLOWED, with its reason.\n'
    );
  }

  if (unreadable.length > 0 || stale.length > 0 || findings.length > 0) {
    process.exit(1);
  }

  console.log('Every closure a record states is named on both of its rows.');
}

function selfTest() {
  const results = [];
  const check = (name, actual, expected) => {
    results.push({ name, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
  };

  const record = (number, header, body = '') => ({
    number,
    text: `# ${Number(number)}. A record\n\n**Status:** Accepted · **Date:** 2026-10-10\n\n${header}\n\n## Context\n\n${body}\n`,
  });
  const index = (rows) =>
    [
      '| # | Decision | Status | Date |',
      '|---|----------|--------|------|',
      ...Object.entries(rows).map(([number, status]) => `| [${number}](${number}-a-record.md) | A record | ${status} | 2026-10-10 |`),
    ].join('\n');
  const report = (records, rows, allowed = {}) => audit(records, index(rows), allowed).findings.map(describe);

  const closes0032 = record('0050', 'Closes a known gap of [0032](0032-a-sweep.md).');
  const wrappedHeader = record('0053', 'Closes a known gap in\n[0051](0051-a-grade.md), the one about grades.');
  const wrappedBody = record('0106', '', '- **The note is kept.** Closed by\n  [ADR 0109](0109-a-merge.md), #387.');
  const lowercaseBody = record('0092', '', '- **The web half.** Delivery closed by\n  [ADR 0104](0104-a-worker.md), #375.');
  const list = record('0147', 'Closes gaps of [0032](0032-a-sweep.md) and [0045](0045-a-grade.md).');
  const adrLinkList = record('0174', 'Closes gaps of [ADR 0032](0032-a-sweep.md) and [ADR 0045](0045-a-grade.md).');
  const emphasisedBody = record('0072', '', '- **The re-run door.** *Closed by* [0076](0076-a-door.md).');
  // A title that closes something runs on through the status line, whose
  // date is four digits and more.
  const titledWithDate = {
    number: '0174',
    text: '# 174. The import door closes the zone gap\n\n**Status:** Accepted · **Date:** 2026-10-11\n\nCloses a gap of [0002](0002-a.md).\n\n## Context\n',
  };

  // --- must hit -----------------------------------------------------------
  check(
    'a header closure missing on the closer\'s row',
    report([closes0032], { '0050': 'Accepted', '0032': 'Accepted; zone gap closed by 0050' }),
    ['0050 → 0032: missing on 0050\'s row']
  );
  check(
    'a header closure missing on the closed record\'s row',
    report([closes0032], { '0050': 'Accepted; closes a gap of 0032', '0032': 'Accepted' }),
    ['0050 → 0032: missing on 0032\'s row']
  );
  check(
    'a closure missing on both rows is reported once for each',
    report([closes0032], { '0050': 'Accepted', '0032': 'Accepted' }),
    ['0050 → 0032: missing on 0050\'s row', '0050 → 0032: missing on 0032\'s row']
  );
  check(
    'a header closure wrapped onto the next line',
    report([wrappedHeader], { '0053': 'Accepted', '0051': 'Accepted; grade gap closed by 0053' }),
    ['0053 → 0051: missing on 0053\'s row']
  );
  check(
    'a body note wrapped onto the next line',
    report([wrappedBody], { '0106': 'Accepted', '0109': 'Accepted; closes a gap of 0106' }),
    ['0109 → 0106: missing on 0106\'s row']
  );
  check(
    'a body note in lower case',
    report([lowercaseBody], { '0092': 'Accepted; delivery gap closed by 0104', '0104': 'Accepted; extends 0091' }),
    ['0104 → 0092: missing on 0104\'s row']
  );
  check(
    'a list of closed records with only the first named',
    report([list], {
      '0147': 'Accepted; closes a gap of 0032',
      '0032': 'Accepted; audit gap closed by 0147',
      '0045': 'Accepted; status gap closed by 0147',
    }),
    ['0147 → 0045: missing on 0147\'s row']
  );
  check(
    'a list of [ADR NNNN] links with only the first named',
    report([adrLinkList], {
      '0174': 'Accepted; closes a gap of 0032',
      '0032': 'Accepted; audit gap closed by 0174',
      '0045': 'Accepted; status gap closed by 0174',
    }),
    ['0174 → 0045: missing on 0174\'s row']
  );
  check(
    'an emphasised body note',
    report([emphasisedBody], { '0072': 'Accepted', '0076': 'Accepted; reverses a gap of 0072' }),
    ['0076 → 0072: missing on 0072\'s row']
  );
  check(
    'a closure in its -ing form',
    report([record('0129', 'Extends 0095, closing the photo gap 0095 left.')], { '0129': 'Accepted; extends 0095', '0095': 'Accepted' }),
    ['0129 → 0095: missing on 0095\'s row']
  );
  check(
    'a number in the decision column is not the status naming it',
    audit(
      [closes0032],
      '| [0050](0050-a.md) | Zone gaps after 0032 | Accepted | 2026-10-10 |\n' +
        '| [0032](0032-a.md) | A sweep | Accepted; zone gap closed by 0050 | 2026-10-10 |',
      {}
    ).findings.map(describe),
    ['0050 → 0032: missing on 0050\'s row']
  );
  check(
    'a closed record with no row at all',
    report([closes0032], { '0050': 'Accepted; closes a gap of 0032' }),
    ['0050 → 0032: missing on 0032\'s row']
  );

  // --- must not hit -------------------------------------------------------
  // Each must-hit shape with both rows naming the other: a gate that fired
  // on a correct index would be turned off within a week.
  check(
    'a header closure named on both rows',
    report([closes0032], { '0050': 'Accepted; closes a gap of 0032', '0032': 'Accepted; zone gap closed by 0050' }),
    []
  );
  check(
    'a wrapped header closure named on both rows',
    report([wrappedHeader], { '0053': 'Accepted; closes a gap of 0051', '0051': 'Accepted; grade gap closed by 0053' }),
    []
  );
  check(
    'a wrapped body note named on both rows',
    report([wrappedBody], { '0106': 'Accepted; note gap closed by 0109', '0109': 'Accepted; closes a gap of 0106' }),
    []
  );
  check(
    'a lower-case body note named on both rows',
    report([lowercaseBody], {
      '0092': 'Accepted; delivery gap closed by 0104',
      '0104': 'Accepted; extends 0092; closes a gap of 0092',
    }),
    []
  );
  check(
    'a list of closed records all named',
    report([list], {
      '0147': 'Accepted; closes gaps of 0032 and 0045',
      '0032': 'Accepted; audit gap closed by 0147',
      '0045': 'Accepted; status gap closed by 0147',
    }),
    []
  );
  check(
    'a list of [ADR NNNN] links all named',
    report([adrLinkList], {
      '0174': 'Accepted; closes gaps of 0032 and 0045',
      '0032': 'Accepted; audit gap closed by 0174',
      '0045': 'Accepted; status gap closed by 0174',
    }),
    []
  );
  check(
    'an emphasised body note named on both rows',
    report([emphasisedBody], { '0072': 'Accepted; re-run door added by 0076', '0076': 'Accepted; reverses a gap of 0072' }),
    []
  );
  check(
    'a date in a closure clause is not a record',
    report([titledWithDate], { '0174': 'Accepted; closes a gap of 0002', '0002': 'Accepted; zone gap closed by 0174' }),
    []
  );
  check('an amendment is not a closure', report([record('0059', 'Amends [0011](0011-the-csv.md).')], { '0059': 'Accepted', '0011': 'Accepted' }), []);
  check(
    'a closure inside a fenced block',
    report([record('0172', 'Quotes a fixture:\n\n```md\nA record.\n\nCloses a known gap of [0032](0032-a-sweep.md).\n```')], {
      '0172': 'Accepted',
      '0032': 'Accepted',
    }),
    []
  );
  check(
    'a closure inside an inline code span',
    report([record('0172', 'Quotes `Closes a known gap of [0032]` as a fixture.')], { '0172': 'Accepted', '0032': 'Accepted' }),
    []
  );
  check(
    'a closure inside an inline code span that wraps',
    report([record('0172', 'Quotes `Closes a known\ngap of [0032]` as a fixture.')], { '0172': 'Accepted', '0032': 'Accepted' }),
    []
  );
  check('an issue number in a closure', report([record('0140', 'Closes a gap of #1012.')], { '0140': 'Accepted' }), []);
  check(
    'a closure clause in the body is about other records',
    report([record('0110', '', 'Here 0108 closes a gap of 0103.')], { '0110': 'Accepted', '0108': 'Accepted', '0103': 'Accepted' }),
    []
  );
  check(
    'a clause ends at its period',
    report([record('0065', 'Closes a gap of [0008](0008-a.md). Extends [0060](0060-b.md).')], {
      '0065': 'Accepted; closes a gap of 0008',
      '0008': 'Accepted; diagnostic gap closed by 0065',
      '0060': 'Accepted',
    }),
    []
  );

  // --- ALLOWED ------------------------------------------------------------
  const missingCloser = { '0050': 'Accepted', '0032': 'Accepted; zone gap closed by 0050' };
  const bothNamed = { '0050': 'Accepted; closes a gap of 0032', '0032': 'Accepted; zone gap closed by 0050' };
  const allowedRun = (rows, allowed) => {
    const { findings, stale } = audit([closes0032], index(rows), allowed);
    return { findings: findings.map(describe), stale: stale.map(({ key, problem }) => `${key} ${problem}`) };
  };
  check('an allowed pair is not reported', allowedRun(missingCloser, { '0050→0032': 'worded as a sweep' }), {
    findings: [],
    stale: [],
  });
  check('an allowed pair the gate no longer reports is stale', allowedRun(bothNamed, { '0050→0032': 'worded as a sweep' }), {
    findings: [],
    stale: ['0050→0032 is a pair the gate no longer reports'],
  });
  check('an allowed pair with an empty reason fails', allowedRun(missingCloser, { '0050→0032': ' ' }), {
    findings: [],
    stale: ['0050→0032 has no reason'],
  });
  check('an allowed pair for no closure at all is stale', allowedRun(bothNamed, { '0007→0006': 'a reason' }), {
    findings: [],
    stale: ['0007→0006 is a pair the gate no longer reports'],
  });
  check('every allowed entry carries a reason', Object.values(ALLOWED).every(reasonValid), true);

  // --- reading ------------------------------------------------------------
  check('a number link loses its target', normalise('of [0051](0051-a.md)\n  and more'), 'of [0051] and more');
  check('a link with other text loses its target too', normalise('[ADR 0104](0104-a.md)'), '[ADR 0104]');
  check('the header ends at the first second-level heading', readRecord('# 1. A\n\nTop.\n\n## Context\n\nBelow.').header, '# 1. A Top. ');
  check(
    'a heading inside a fence does not end the header',
    readRecord('# 1. A\n\n```md\nAn example:\n\n## Not a heading\n```\n\nStill top.\n\n## Context\n').header,
    '# 1. A Still top. '
  );
  check('an unclosed fence runs to the end', stripCode('Top.\n```\nCloses a gap of 0032.\n'), 'Top.\n\n');
  check('a double-backtick span holding a backtick', stripCode('a `` x`y `` b'), 'a   b');
  check(
    'the row number comes from the link text',
    readIndex('| [0007](0006-elsewhere.md) | A | Accepted; closes a gap of 0006 | 2026-07-30 |').get('0007'),
    'Accepted; closes a gap of 0006'
  );
  check('a row with a pipe in its title is unreadable', audit([], '| [0007](0007-a.md) | A | B | Accepted | 2026-07-30 |', {}).unreadable, [
    '0007',
  ]);
  check(
    'a row with an escaped pipe in its title reads',
    readIndex('| [0007](0007-a.md) | A \\| B | Accepted | 2026-07-30 |').get('0007'),
    'Accepted'
  );
  check('a record never pairs with itself', closuresIn('0129', record('0129', 'Closes the gap 0129 left open.').text), []);

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
  console.log(`check-adr-index self-test: ${results.length} passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  run();
}
