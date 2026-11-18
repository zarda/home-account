# 190. A review sentence names where its grade came from, and quotes a percentage only where a model reported one

**Status:** Accepted, implemented · **Date:** 2026-11-17 · **Issues:** #535

Reference documentation lives in [../receipt-import.md](../receipt-import.md),
[../import-fields.md](../import-fields.md),
[../accessibility.md](../accessibility.md) and [../e2e.md](../e2e.md).

The review card's category chip and two flags on what a cloud reader returned
quoted a percentage that no model had reported. The chip's dot read *High
confidence (95%) — the AI is confident about this category* for a category
answered from memory, *(100%)* for one the reviewer had picked, and Vision's
text-recognition confidence for one named on the device. A cloud receipt whose
amount was summed from its lines read *the AI was only 50% sure*, and a cloud
date that would not parse read *only 0% sure* of a date nothing had read, the
form holding today. Each figure was a grade the app stamped by policy, or a
measure of something else. [0186](0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)
fixed this class for the device's amount and date flags and listed the rest
under its Known gaps. This record carries the source beside every such grade
and lets the sentence choose on it.

Closes two gaps of [0186](0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md):
the two cloud flags that quote a percentage no model reported, and the
category chip's percentage.

Applies [0045](0045-a-confidence-grade-names-its-source.md) (a grade names
its source), [0171](0171-second-copies-fold-into-one-copy-of-each-helper.md)
(one sentence for the card and the form) and
[0187](0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)
(sentences end in the reader's stop).

## Context

A grade is one number on one scale, whatever stamped it. The dot's colour, the
flag and the needs-review counts are all read off its value, and that is as it
should be: a category nobody could place is red whether a model said 0.3 or
the app did. The sentence beside it is a different claim. *95%* says something
measured the category and found it 95 parts in 100 likely.

Of the sites that write a category's grade, one holds such a measurement: a
categorizer answer that carried its own number
(`applyCategorizations`). The others are policy. A remembered correction is
graded 0.95, a reviewer's pick and a backup's own id 1.0, a CSV's Category
cell 1.0, a category the extraction named 0.8, a categorizer answer with no
usable number 0.8, an answer the catalogue could not place 0.3 and a row
nobody categorized 0.1. A single-receipt row keeps its own `confidence`, which
on no lane measures the category: on the device it is Vision's confidence in
the text, and from a cloud reader it is 0.85 or 0.5 by whether the answer held
an amount and a merchant.

The amount and the date have the same split. A cloud reader reports
`amountConfidence` and `dateConfidence` of its own. Consolidation then stamps
0.5 on an amount it summed from the lines because no printed total was
reported, or whose printed total is more than half the larger figure away from
that sum; and every reader grades 0 a date the answer did not give, or gave in
a form nothing parses, dating the row now. After that the two kinds travel in
one field and cannot be told apart.

`fieldDoubtSentence` is the one helper the card and the form share for a
doubted amount or date (0171). Since 0186 it chose on `readOnDevice`: a device
row names the scan, every other row quotes its grade. Its spec pinned the
result for a grade nobody reported: *0 where it reported none*.

## Decision

### A grade's source travels beside it

`categorySource` sits beside `categoryConfidence` on the review row, and
`fieldDoubt` beside `fieldConfidence`. Both are review-step marks like
`readOnDevice`: set where the grade is stamped, carried by the spread through
a split and a merge's target, and never written.

| Source | Set where | Grade |
|---|---|---|
| `memory` | the ladder, for a merchant filed before | 0.95 |
| `reviewer` | a pick on the card | 1.0 |
| `backup` | a backup's id the account still holds on the row's side | 1.0 |
| `file` | a CSV's Category cell, matched exactly | 1.0 |
| `reader` | a category a cloud reader named while it read | 0.8, or the row's own |
| `device` | a category named on the device | the row's own |
| `reported` | a categorizer answer that carried its own number | that number |
| none | a floor, a fallback, an answer graded at the default | 0.8, 0.3, 0.1, 0 |

`fieldDoubt` holds `amount: 'itemSum'` or `'totalDisagrees'`, set by
`deriveAmount` beside the 0.5 it stamps, and `date: 'unread'`, set by each
reader beside the 0 it stamps for a date the answer did not give and by the
two callers that find a given date unparseable.

Nothing strips either mark on the way to Firestore, and nothing needs to:
`toCreateTransactionDTO` names the fields it writes, and neither mark is one
of `ImportRowFields`.

### `reported` is decided where the number is read

`applyCategorizations` marks an answer `reported` only when the id it names is
in the catalogue, fits the row's side and came with a finite number. The 0.8
it gives an answer with no usable number is a figure a model could have said,
so the mark is the only thing that tells the two apart afterwards. The ladder
hands its rows on as one type, memory rows and floors beside model answers, so
the source is a field of that type and each of the three writes its own.

### Every site that rebuilds a row carries the mark or drops it on purpose

Eleven sites build a row or its category field by field. Each now copies the
source, writes its own over the one it found, or clears it. Two are worth
naming. The CSV door grades a Category cell's name as the extraction's before
the exact match is applied over it, so `file` is written over `reader`. And a
type flip that files a row on its new side's catch-all clears the source and
stashes it in `movedCategory` beside the grade, so *Other income* does not go
on saying the reviewer filed this merchant here before, and a flip back
restores it.

### The chip's sentence chooses on the source

The dot's tooltip, which is also its accessible name, names the source:

| Source | English |
|---|---|
| `memory` | You filed this merchant here before |
| `reviewer` | You picked this category |
| `backup` | This category comes from the backup |
| `file` | This category is the one the file names |
| `reader` | Suggested when the receipt or statement was read — check that it fits |
| `device` | Suggested by the scan on this device — check that it fits |
| `reported` | the three band sentences, with their percentage |
| none, 0.5 and up | Suggested category — check that it fits |
| none, under 0.5 | No category could be suggested — please pick one |

The band still colours the dot. A device row at 0.4 is red and reads the
device's sentence.

### The flags say why

`fieldDoubtSentence` takes the row's `fieldDoubt` as a fifth argument. In
order: a device row names the scan; an amount with a basis says *no printed
total was read, so it is added up from the lines that were*, or *the printed
total is far from the sum of the lines read*; a date marked unread says *no
date could be read, so today's is filled in*; a grade a model reported is
quoted. A grade nobody reported and nothing explains reads the scan's
sentence, with no figure, where it read *0%*.

The form keeps the doubt of its last scan in `scanFieldDoubt`, set and cleared
with `scanFieldConfidence` at the same three sites. On the card a date under
the bar is already dated today and says so (`dateAssumed`), so the unread
sentence is the form's.

## What was rejected

- **Deciding the sentence from the grade's value.** 0.95 is memory today and
  could be a model's tomorrow; 0.8 is three sources already.
- **A boolean `reported` on the ladder's row.** The ladder returns memory
  rows, floors and model answers as one type, and the builders after it copy
  two fields. Memory could then be told from a floor only by its value.
- **Dropping the percentage everywhere.** A categorizer's own number is a
  measurement, and a cloud reader's amount and date grades are too. They
  stay.
- **Changing the grades to match the sentences**, so that a pick would be
  ungraded and a remembered category carry none. The dot's bands, the
  needs-review counts and the engine fallback read those numbers, and none of
  them is wrong about what it shows.
- **Carrying the source through to the transaction.** It describes a review
  step. A written row is the reviewer's, whatever suggested it.
- **The card's assumed-date sentence on the form**, as #535 proposes. It says
  *this row is dated today*, and the form has no row.
- **A separate flag for the reviewer's pick** in place of a source. It is a
  source: the chip reads one field.

## Consequences

- A category answered from memory, picked by hand, taken from a backup or a
  file, or named by a reader or the device says so, in English, Japanese and
  Traditional Chinese, and quotes no percentage. A screen reader hears the
  same sentence as the tooltip shows.
- A categorizer's own number is still quoted, in the band sentences.
- A cloud amount summed from its lines, and one whose printed total strays,
  are flagged as before and say why. So is a lone line with no printed total,
  which the same rule grades.
- A scan whose date the form filled in as today says that no date could be
  read.
- **A cloud grade with no number behind it no longer reads *0%*.** It reads
  the scan's sentence.
- The dot's bands, the flags that fire, the needs-review counts and every
  written field are unchanged.
- Two more optional fields ride the review row. A site that builds a row from
  scratch and forgets them shows the unsourced sentence, which claims nothing.

## What the browser runs found

### Run 1, on 17 November 2026

Emulators only, as Alex, at the pane's 1024px with the review card read again
at 375px, in English, Japanese and Traditional Chinese, served from this
branch's checkout; the bundle named `demo-home-account` alone. The console
held one error from first load to teardown, the venue's own: the 400 the Auth
emulator answers a session an earlier run had left on the origin. The pane was
hidden, so every read was taken from the DOM after the page settled; the
wizard's buttons, the category menu, the type toggle and the row checkbox were
pressed with real clicks. Journey 119 is that run. It has no provider and no
device, so it reaches the file, the reviewer, memory, the backup and the
unsourced sentences; the reader's, the device's and the two amount reasons are
the smoke case's and the specs'.

- A CSV whose Category cell named a category showed a green dot named *This
  category is the one the file names*; the row whose cell named none showed a
  red dot named *No category could be suggested — please pick one*.
- A pick from the chip's menu renamed that dot *You picked this category*.
- After that import, a second file with the same two merchants and no
  category showed both green, named *You filed this merchant here before*,
  and a merchant never seen unresolved.
- A flip of a remembered row to income filed it on *Other Income*, red and
  unresolved, with the category, its 0.95 and `memory` kept on the row; the
  flip back restored all three.
- A backup read through the wizard showed *This category comes from the
  backup* for an id the account holds, and the unresolved sentence for one it
  never had.
- Each sentence read in Japanese and in Traditional Chinese after a live
  switch with the card open, and none held a figure.
- At 375px nothing on the card ran past the viewport and every control on it
  had a name.

**Found:** nothing in the app. A fixture row was offered as a possible
duplicate of a seeded one of the same day and amount, which is the check
working.

Five rows were imported into Alex's emulator account, two and then three, with
the memory they leave, and the language was switched and put back. The run did
not switch to the dark theme.

## Departures from the issue

- **The source list is longer than the issue's.** It names memory, reviewer,
  backup, reader, model and floor. `file` is the CSV door's exact match,
  graded 1.0 and no backup; `device` and `reader` are split because the
  issue's acceptance asks for a device row's own sentence; the floor is the
  absence of a source.
- **The form's unparsed date takes a sentence of its own**, not the card's
  (above).
- **A date the answer did not give is marked too**, at the four reader sites
  that patch in today's date, as well as the two the issue names where a
  given date does not parse.
- **A grade nobody reported reads the scan's sentence.** The issue does not
  name the case; its spec pinned *0%*.
- **The two marks were proved unwritten by a smoke case**, which the issue
  does not ask for.

## Things that only became apparent while building

- The category grade a single-receipt row wears is a category measurement on
  no lane at all. The issue says so of the device; the cloud reader's is a
  two-valued score of the whole answer.
- The CSV door stamps a row twice. Written once, the source would have read
  *reader* on a row whose category came from the file.
- A flipped row's catch-all inherited the source through the card's own
  spread. The clearing has to be written as `undefined`, since leaving the
  key out keeps the old value.
- A merged group is rebuilt from its first line, so a mark on that line has to
  be copied by name; the lone-line branch spreads and carried it unasked.
- The compiler was no help with any of this: every new field is optional.

## Known gaps

- **The `reported` sentences still say *the AI is confident*.** They are true
  of the one source that keeps them, and were not reworded.
- **A categorizer answer with no number of its own reads the unsourced
  sentence**, the same words as a floor at 0.5 or above. Nothing says a model
  suggested it.
- **The smoke case cannot reach `reported`.** Its stand-in for the cloud
  provider sits above `applyCategorizations`, so that source is proved by unit
  specs alone.
- **A stale `fieldDoubt` stays on a row whose flag an edit answered.** The
  edit drops the grade, and the doubt is read only under a grade, so nothing
  shows it; it is not cleared.
- **The offline queue keeps a category's id and not its source.** A row
  drained from it is written without a review step, so nothing reads one.
- **The statement and CSV doors have no `device` rows** and the device has no
  `reported` ones. Each sentence exists for the lanes that can reach it; no
  gate holds a lane to its sources.
- **No device run.** The device's sentence was read through the converter in
  specs and in the emulator, never on an iPhone.
