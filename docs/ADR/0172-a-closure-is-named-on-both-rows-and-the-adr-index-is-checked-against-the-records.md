# 172. A closure is named on both rows, and the ADR index is checked against the records

**Status:** Accepted, implemented · **Date:** 2026-10-10 · **Issues:** #448

The index's conventions live in [README.md](README.md), whose *Format*
section now describes the gate. The root [../../README.md](../../README.md)
lists `npm run adr-index:check` in its scripts table and its CI paragraph.

Applies [0145](0145-a-class-found-by-reading-becomes-a-gate.md): a class
found by reading becomes a gate.

## Context

The index's status column records what later records did to earlier ones,
and that includes closing their Known gaps. The older row is the one that
needs the pointer. Its record still describes the gap as open, and a record
is written as it was true at the time, so nothing in it says otherwise.
Nothing kept the two rows in step. The index is prose in a table, no build
read it, and the review of a new record reads the new row, not the old one.

#448 triaged the records and found the column short:

- **Closures missing from one row or both.** The issue listed twelve. An
  enumeration with the normalisation and patterns the gate now uses (see
  *Decision*), its body pattern still case-sensitive, found 57 pairs, and 37
  of them were missing a side. Four of the 37 were on the issue's list.
  Twenty-two were stated by records written after the triage, and five were
  the over-matches the table under *`ALLOWED`* lists. The other six were
  closures in records the issue had triaged and missed: 0007's of 0006 and
  0053's of 0051, each missing from both rows; 0109's of 0106, missing from
  the closer's row; and 0079's and 0080's of 0074 and 0081's of 0075,
  missing from the closed rows.
- **Forty-one records nobody had swept.** 0129 to 0169 were written after
  the triage.
- **Claims that were wrong.** See *Departures from the issue*.
- **Reference docs whose Known gaps had become issues and did not say so.**
  `widget.md` (#441) and `app-lock.md` (#447) were two. `dates.md` and
  `recurring.md` listed items that #435 and #432 had since dealt with.
- **`performance.md` counted a worker's prefetch of every lazy chunk** as a
  cost, for a worker nobody registered. That half is
  [0170](0170-the-animations-runtime-the-unregistered-worker-and-nine-dead-items-come-out.md)'s.
  The worker is gone, and 0170 corrects the gap of
  [0023](0023-the-initial-bundle-carries-only-the-entry-route.md) that
  described it.

Most closure notes in the records' bodies are hard-wrapped, so `Closed by`
and the number it names land on different lines about as often as not. A
line-oriented grep misses every wrapped note and still looks clean.

## Decision

**The index names every closure on both rows. The closer's status names the
record whose gap it closed, and the closed record's status names its closer.
`npm run adr-index:check` reads the closures the records state and fails when
either row leaves the other out.**

Each commit is cited by its subject.

### Both rows

`docs: the ADR index records both sides of every closure its records state`
rewrote 76 status cells and nothing else in any row. It kept the wording the
index already used. 0007's row reads `closes a gap of 0006`, and 0006's reads
`concurrent-edit gap closed by 0007`. When one record has several closers
they share a clause, as in 0032's `zone gap closed by 0050, audit gap by
0145`.

- **Every pair the enumeration found.** All 57 now name each other.
- **Closures the patterns cannot see.** Each was checked by reading both
  records:
  - 0018 and 0020 each close a gap of 0002: the deletion of its snapshots
    (#73) and the conversion of a detected group (#48);
  - 0074 closes 0013's parser date grade;
  - 0044 closes a gap of 0042, and 0118 one of 0045;
  - 0128 closes 0122's unused module, its part c;
  - 0059 closes a gap of 0011.
- **Amendments that close.** 0030 takes up three of 0016's four gaps. 0016
  reads `amended by 0030, which closes three of its gaps`, and 0030 reads
  `amends 0016 and closes three of its gaps`. 0143 and 0031, a pair the
  sweep below found, are worded the same way about 0031's order gap.
- **Narrowings are written as narrowings.** 0094 recounts the receipt quota
  from the bucket, but App Check is still off. So 0006 reads
  `quota gap narrowed by 0094`, and 0094 reads `narrows a gap of 0006`. The
  other narrowings are worded the same way: 0142's of 0015 and 0052, 0147's
  of 0013, 0063 and 0113, and 0149's of 0062.
- **The sweep of 0129 to 0169** added the back-pointers those records had
  never had. It also found three closures that were on neither row:
  - 0143 closes 0031's gap about a restored category's `order`.
  - 0145's `dates:check` is the audit that 0032 said nothing ran.
  - 0157 withholds receipt links from a household copy. That closes 0152's
    gap about receipt links reaching every member's device. The two rows
    already named each other because of the supersession, so a check of
    names alone had passed them.
- **0106e stays open.** See *Departures from the issue*.

The reference docs' Known gaps were checked against the open issues, and
each item an issue tracks now names it: `widget.md` (#441), `app-lock.md`
(#447), `rtl.md` and `accessibility.md` (#445), `smart-search.md` (#444),
`receipt-quota.md` (#378) and `reminders.md` (#446). `dates.md` now says that
`dates:check` came with ADR 0145 (#435), which narrowed its gap to what the
greps cannot see. `recurring.md` opens its Known gaps with what ADR 0141
(#432) repairs or refuses. The first five gaps are what remains after it.

### The gate

`build: adr-index:check holds the ADR index to the records` adds
`scripts/check-adr-index.mjs` and `npm run adr-index:check`. The script runs
its self-test, then reads the tree. CI runs it right after
`icon-labels:check`. It is copied from the shape of `check-motion.mjs` and
`check-material-imports.mjs`, not imported from them. That shape is a header
that says what the gate cannot see, a walk, a findings list, an `ALLOWED`
table and a `--self-test`.

**Normalisation.** Each record is normalised before anything matches:

1. Fenced blocks are stripped, whether they use backticks or tildes and
   whether or not they are indented. An unclosed fence runs to the end of
   the file. Inline code spans are stripped too, including a span of several
   backticks and one that wraps inside its paragraph. A record that quotes a
   closure, such as a gate's fixture, is not stating one. That is why this
   record quotes its examples in code.
2. Every link loses its target, so `[0051](0051-….md)` becomes `[0051]`
   and `[ADR 0051](0051-….md)` becomes `[ADR 0051]`. Otherwise the period in
   `.md` would end a clause at the first link, and a list of closed records
   would lose every entry after it.
3. `*` emphasis is dropped, so a note written `*Closed by* [0076]` reads as
   one.
4. Every run of whitespace becomes one space. A note wrapped between
   `Closed by` and its number then reads as one line.

The header is everything above the first `## ` heading. It is found after
the code is stripped, so a heading inside a fence does not end it.

**What a record states.**

- **Its header.** The gate reads every clause that pairs `closes` or
  `closing` with `gap` or `gaps`, up to the next period. Each four-digit
  number in that clause is a record this one closes, unless it follows a `#`
  or a digit or is the year of a date. So `Closes gaps of [0032] and [0045]`
  states two pairs, and `#1012` and `2026-10-11` state none.
- **Its body.** Every `Closed by NNNN`, `Closed by [NNNN]` or
  `Closed by [ADR NNNN]`, in any case, credits NNNN with closing the record
  that contains it. Known-gaps bullets are annotated that way when a later
  record closes them. 0092's note, for one, is in lower case.
- **Not a closure clause in its body.** A body sentence such as
  `0108 closes a gap of 0103` is about two other records. Only the header
  speaks for the record itself. A record never pairs with itself.

**The rule.** For each pair, the closer's status cell must name the closed
record, and the closed record's status cell must name the closer. A cell
names a record when it contains the number, with the same guard against a
leading `#` or digit. The gate does not judge the wording. Each of these
names its record: `closes a gap of 0006`,
`amended by 0143, which closes its order gap` and
`extends 0092; closes a gap of 0092`. How a row words it is up to the
README's conventions. A number in the decision column does not count. A
finding prints as `0050 → 0032: missing on 0032's row`, followed by the
sentence it came from.

The gate finds a row by the number in its link text and reads the third cell
as its status. An unescaped `|` in a title gives a row more than the table's
four cells and shifts the status into the wrong cell. Such a row is reported
as unreadable, not skipped.

**`ALLOWED`.** A pair the index words otherwise on purpose goes in
`ALLOWED`, keyed `C→X`, with its reason. This is how `check-motion.mjs`
records a competing declaration. The table starts empty, and the goal is to
keep it empty. A clause runs on to its period, so in four headers it also
picks up a record named for another reason. In each of them, wording that is
true on both rows satisfies the gate:

| Record | Where the clause runs on | Its row | The other row |
|---|---|---|---|
| 0065 | `extends the provenance [0060]` | `extends 0060` | `provenance extended by 0065` |
| 0100 | `which [0079] and [0080] had already widened twice` | `closes a gap of 0074 that 0079 and 0080 carried` | `invented-date gap closed by 0100`, on each |
| 0102 | `keeps the suggestion ladder of [0063]` | `keeps 0063's ladder` | `ladder kept by 0102` |
| 0125 | `applies [0114]'s rule` | `applies 0114 and 0048` | `its rule applied to a run's end by 0125` |

The 0100 wording is not only a way round the gate: the gap 0079 and 0080
carried is the one 0100 closes. `ALLOWED` goes stale in both directions. An
entry for a pair the gate no longer reports fails, and so does an entry with
an empty reason. A repair edits the table in the same commit.

**The self-test** has 42 cases and runs before the tree:

- **Twelve must hit.** Either side missing, then both. A wrapped header
  clause. A wrapped body note, and one in lower case. A list with one of its
  two records named, and a list of `[ADR NNNN]` links with one named. An
  emphasised body note. The `closing` form. A number only in the decision
  column. A closed record with no row.
- **Fifteen must not hit.** Each of the first five shapes with both rows
  named, and the `[ADR NNNN]` list and the emphasised note with both named.
  A date in a closure clause. An amendment. A closure in a fenced block. A
  closure in an inline span, and in a span that wraps. An issue number. A
  closure clause in the body. A clause that ends at its period.
- **Five cover `ALLOWED`.** A suppressed pair, a stale pair, an empty reason,
  an entry for no closure, and a check that every real entry has a reason.
- **Ten cover reading.** The link rewrite, of a number link and of a link
  with other text. The header cut. A heading inside a fence. An unclosed
  fence. A double-backtick span. The row number taken from the link text.
  Escaped and unescaped pipes. No self-pair.

Seventeen mutations of the script were tried. They ranged from dropping the
whitespace collapse to making the clause greedy, and each one failed at least
one case.

On the tree, the gate first ran over 169 records and found 58 pairs and no
findings. With this record it reads 172 records and 77 pairs, nineteen of
them stated by 0170 and 0171. It finds nothing, and `ALLOWED` is empty. The
emphasis strip added a 78th, 0076's closure of 0072, whose rows already
named each other.

## What was rejected

- **Judging the wording.** A gate that parsed each status cell for
  `closes a gap of` and `gap closed by` would force every row into two
  phrases or fail on rows that are true. Rows say a gap was narrowed,
  corrected, or closed by an amendment. One row's clause can be shared by
  three closers. The gate can prove that a number is in the cell, and the
  wording stays with the reviewer.
- **A line-oriented grep.** The notes are wrapped. It would miss most of
  them and look clean.
- **Reading closure clauses in the body.** The body is where a record
  discusses others, and a clause there is often about other records.
  The header speaks for the record itself. A Known-gaps note speaks for the
  later record that closed the gap.
- **Checking the index against the records the other way round.** A reverse
  check would require that every closure a row states is also stated by a
  record. It would fail on every closure the rows carry by hand, which
  includes most of the list under *Both rows*. The reverse reading was done
  once, by hand. It found two claims with no record behind them (see *Known
  gaps*).
- **Skipping an over-matched pair.** A skip with no reason goes stale
  without anyone seeing it. An `ALLOWED` entry carries its reason, and fails
  once the pair is gone.

## Consequences

- Every closure the gate reads, a header clause up to its first period or
  a `Closed by` note, is named on both of its rows. CI keeps it that way: a
  new record that closes a gap in either phrasing fails until the older row
  names it too, unless the clause ends early (see *Known gaps*).
- A record that quotes a closure as an example must put it in code. Outside
  code, a body sentence in the note's shape, `Closed by` and a number,
  credits that number with closing the record that quotes it.
- `docs/ADR/README.md`'s *Format* section describes the convention and the
  gate.
- The work for #448 edited only status cells and the reference docs' Known
  gaps. No existing record's body changed.
- No app code, rules, indexes or functions change.

## Departures from the issue

Three of the issue's claims were wrong, and two more were half right.

- **Wrong: 0074 closed 0013's date grade, not 0079.** 0013's gap is that
  the regex parser grades its date read and `ParsedReceiptText` exposes only
  the amount, so `fieldConfidence.date` stays undefined on the native path.
  0074 has the parser export that grade and the native lane report it, and
  its own notes say the parser had already done the work. 0079 closed a
  different gap, one of 0074's own: the multi-photo lanes that asked for no
  date grade.
- **Wrong: 0148 closed the 0037 retry, not 0131, and 0148's row already
  said so.** 0131 extends 0127 and touches no gap of 0037. Only 0037's row
  lacked the pointer. 0148's Context takes up two of 0037's gaps, the rate
  validation and the retry, so 0037's row names both.
- **Wrong: 0106e is still open.** It is 0106's fifth Known gap: the blank
  note is normalised at the merge and not at its producer. The issue read the
  comment in `import-review.utils.ts` as stale, left behind by a refactor
  that had closed the gap. But `AIStrategyService.convertParsedReceipt` still
  writes `notes: ''` for a receipt with neither details nor items, which is
  what the comment says.
  [0170](0170-the-animations-runtime-the-unregistered-worker-and-nine-dead-items-come-out.md)
  checked the same comment and found it accurate.
- **Half right: 0065 alone closed 0008's diagnostic-channel gap.** The
  issue also named 0075, which never mentions 0008 and extends 0065. Only
  0065 is written.
- **Half right: 0006's quota gap is narrowed, not closed.** App Check is
  still off, so 0094 is written as a narrowing.

## Departures from the plan

- **The plan's examples of the limit are read.** The plan gave
  `Closes [N]'s gaps` and `Closes the first of the known gaps [N]` as
  phrasings the patterns miss. In fact the clause runs from the verb to its
  period and takes every number in it, so both are read. The tree has one of
  each: 0158's `Closes [0156]'s two known gaps` and 0124's
  `Closes the first of the known gaps [0118] filed`. The phrasings the gate
  does miss are under *Known gaps*.
- **The body pattern ignores case.** The plan's pattern was case-sensitive.
  0092 writes its note as `Delivery closed by [ADR 0104]`, and the
  case-sensitive enumeration missed that pair. The gate found it, as its
  58th pair, and 0104's row gained `closes a gap of 0092`.
- **The gate reports what it cannot parse.** It reports a row without four
  cells as unreadable. It also strips indented, tilde and unclosed fences,
  and spans of several backticks, and it drops self-pairs. None of these was
  in the plan, and each has a fixture.

## Things that only became apparent while building

- **A name check misses a closure hidden by another relation.** 0157 and
  0152 already named each other through a supersession, so the closure of
  0152's receipt-link gap was on neither row and still passed. The gate
  passes such a pair too, for the same reason (see *Known gaps*).
- **A fence fixture passed without the fence strip.** The span pattern
  treated a triple-backtick fence as a span. The fence fixtures now carry a
  blank line, which no span crosses, so they fail when the fence strip is
  removed.
- **The whitespace collapse matters only in the body.** The header pattern
  uses `[^.]`, which crosses a line break, so a wrapped header clause matches
  without the collapse. The body pattern contains literal spaces, so it
  needs the collapse.

## Known gaps

- **It proves a mention, not a closure.** A status cell passes if it names
  the other number for any reason, such as the supersession between 0157 and
  0152. Whether the wording is true is still the reviewer's call.
- **Phrasings outside the two patterns are invisible.** The rows carry each
  of these by hand:
  - A pronoun, or a number before the verb, in place of the record being
    closed. For example 0129's `Applies [0095] and closes the gap it left
    open`, 0127's, which has the same shape for 0037, and 0166's
    `Closes three of its Known gaps`, which are 0132's.
  - A closure without the word gap, such as 0167's `Closes one of [0096]`.
  - A header saying that its own gap was closed. The header pattern reads
    only closes and closing, and the note pattern reads only the body.
    Examples are the `gap is closed by` on 0072's and 0035's status lines,
    and 0011's `0059 closed the writer/importer gap`.
  - A closure stated in body prose rather than in a note, such as 0157's
    receipt links (0152) and 0142's narrowing of 0015.
  - Any narrowing. No pattern reads narrows, so 0094's narrowing of 0006 and
    0147's of 0013 are held by hand.
- **A period inside a clause ends it early.** An abbreviation such as
  `e.g.`, or a doc link whose own text holds a period (`[../dates.md]`, which
  keeps its text when its target goes), ends the clause there, and a record
  named after it is not read. 0164's clause and one of 0165's end that way
  at their link to `../accessibility.md`, with no record after it. A rule of
  a period followed by a space would over-match through quotes that end in
  `."`.
- **A note naming two closers credits only the first.** In
  `Closed by [0181] and [0182]` the pattern takes 0181 and stops.
- **The index is checked against the records, not the reverse.** A
  closure the index states with no record behind it passes. Two were found
  and taken out of their rows: 0140's said `closes a gap of 0102`, though
  0140 never mentions 0102, and 0145's listed 0139 among the records whose
  gaps it closes, though 0145 mentions 0139 only to say that it kept that
  record's `firstValueFrom` lint selectors. Nothing would catch a third.
- **A closure kept by hand has no guard.** Nothing holds the hand-verified
  rows above or the phrasings the gate misses. An edit that drops one side
  passes.
- **A record missing from the index passes**, unless it is part of a pair.
  The gate checks closures, not whether every record has a row.
- **The reference docs are not checked.** Their Known gaps cite issue
  numbers only as current as the last sweep. Whoever files an issue for a
  doc gap has to cite it there.
