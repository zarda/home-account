# 99. The review step edits what it shows

**Status:** Accepted, implemented · **Date:** 2026-09-04 · **Issues:** #368

Reference documentation lives in [../import-fields.md](../import-fields.md)
and [../receipt-import.md](../receipt-import.md).

Amends [0062](0062-the-review-step-can-correct-every-field-the-import-writes.md),
whose title this record is the missing half of, and retires one sentence of
[0074](0074-a-date-the-scan-cannot-vouch-for-lands-on-today.md). Every edit
still lands before the single mapper of
[0059](0059-one-mapper-builds-every-imported-transaction.md), and the marks it
clears stay marks under
[0064](0064-the-country-comes-off-the-paper-before-the-phone.md).

## Context

0062 is titled "the review step can correct every field the import writes",
and it did not. What it delivered was the currency: a menu on the chip, a
fallback marker, an offer with a remove control. The date, the amount and the
description stayed read-only spans on a card whose whole purpose is the last
look before a write. A reviewer who could see that the total said ¥538 and the
row said ¥5,380 had exactly one move available, which was to import the wrong
figure and fix it in the ledger afterwards.

The card's own code said so. `replaceRow`'s comment closes with the reason it
exists — "a row carries state (`fieldConfidence`) an edit is supposed to
clear" — and no edit on that card could clear it, because no edit on that card
touched a graded field. The one mechanism built for corrections was serving
three fields that were never graded and none of the three that were.

0074 then made the gap sharp rather than merely wide. It moves a date the scan
cannot vouch for onto today, which is the right trade — a wrong date on
today's row is findable and a wrong date in 2024 is not — but it moves it on a
card with no way to move it back. The copy shipped with that record told the
user so in as many words: the tooltips ended by promising the date could be
fixed after the import. A record whose remedy is "leave the app and go and
find the row" is a record with a missing control, and the control belongs
where the doubt is shown.

Three smaller things were wrong in the same place, and each of them defeats a
correction rather than merely omitting one. They are in this record because a
correction that does not show on the card is not a correction:

- The category chip's `computed()`s read plain `@Input()`s. A plain input has
  no producer, so the computation ran once and cached the model's first guess
  for the life of the component — and `@for … track row.id` keeps that
  component alive across a row replacement. Pick a new category and the chip
  went on displaying the old one, with the old confidence dot.
- **Add notes** was a no-op. `initNotes` set `notes = ''` and the textarea
  rendered behind an `@if (row.notes)` truthiness gate, so it appeared only on
  a row that already had notes. The button that offered to add them could not.
- A country the reader concluded from an unaddressed receipt was written and
  never shown. The mapper builds `location: { country }` from `receiptCountry`,
  but the card rendered a location chip only where `row.location` existed. The
  pipeline made a choice about the row that the reviewer could neither see nor
  undo.

## Decision

**The card is the editor.** Every field the row carries and the import writes
is corrected where it is shown, and an answer clears exactly the doubt it
settles.

### The date is a button that opens a picker seeded with the row's own date

The date span becomes `<button type="button" class="date-chip">` opening a
per-row `<mat-datepicker touchUi>` through a hidden anchor input bound
`[value]="row.date"`. The seed is the whole point: the calendar opens on the
receipt's month with the receipt's day active, so the reviewer who read
"August 14" off the paper is one tap from it rather than navigating back from
today.

The picker is modal, so the button announces `aria-haspopup="dialog"` and
wears **no dropdown caret**. The caret is the currency chip's sign that a menu
drops from it, and giving the same mark to a control that opens a dialog would
make the two lie about each other.

### Amount and description are inline triggers

Each read-only span becomes a trigger that swaps itself for an input and swaps
back on the way out. A commit happens on Enter or on blur; Escape cancels and
leaves the row alone. Opening an editor commits nothing, and a guard stops the
Enter-then-blur pair committing the same value twice. `focusWhenRendered`
returns focus to the trigger the edit came from, so a keyboard reviewer is not
dropped at the top of the card after every correction.

An emptied description is a reviewer starting over, not a row that reads as
nothing: it closes and changes nothing.

### Every edit goes through `replaceRow`, and an answer clears what it settles

No edit mutates the `@Input()` object. `replaceRow` writes a new row identity,
which is what makes a correction visible to anything reading the row — the
last in-place mutation on the card (the notes field) went with this wave.

What an answer clears is decided in one place per field:

| The edit | What it clears |
|---|---|
| A picked date, Keep, or bulk Keep | `dateAssumed`, `dateImplausible`, the date's grade, and sets `dateReviewed` |
| A typed amount | the amount's grade, through `withoutFieldConfidence` |
| A picked currency | `currencyFellBack` and the standing offer, as 0062 already had it |

The date's three doors share one private `dateAnswered(row)` helper. Three
call sites clearing four things by hand is three chances to clear three of
them, and the helper is the reason a picked day and a kept day settle a row
identically.

`withoutFieldConfidence` returns **absent**, not `{}`, once the last entry
goes. Absent is the documented "nobody graded it" shape — the one CSV, JSON
and hand-typed rows carry — and `needsVerification` already reads a missing
grade as nobody doubting the value.

### `dateReviewed` is a mark, on 0074's terms

It rides `CategorizedImportTransaction` beside `dateAssumed`, lives between
extraction and confirm, and is pinned by spec as absent from the DTO. It
records that a human answered, which stops being interesting the moment the
row is written; 0064's rule that a mark cannot reach a document holds without
an exception.

### `parseAmountInput` reads what a receipt prints

A hand-typed figure comes off paper, so the parser takes a currency symbol,
spaces and either grouping convention, and refuses everything it cannot read
rather than guessing.

**Full-width digits are folded first.** The plan scoped the strip set to
ASCII. A ja or tc reviewer types with the IME on, `\d` is ASCII, and `１２３`
therefore stripped to nothing — the editor closed, said nothing, and left the
wrong figure standing, on precisely the locales this editor was built for.
`commitAmount` carries an IME-composition guard for the same reason: a commit
fired mid-composition reads a half-formed string.

**A shape check rejects a malformed figure.** `parseFloat` takes a prefix and
stops, so `1.234.567` would have come back as 1.234 and the lakh-grouped
`1,23,456` as 1.23456 — plausible figures nobody typed, written onto a money
field whose verify flag the same commit drops. Either every comma is a group
separator or none is; anything else is refused.

The sign never comes from the text. `type` owns income against expense, and a
minus typed into the amount would flip a row where nothing said it had.

### The three defeated corrections

`CategorySuggestionComponent` moves to signal inputs, so its `computed()`s
have a producer and track the row they are given. The country the reader
concluded gets a chip of its own, shown when `receiptCountry` is set with no
printed address, and its remove control clears `location` and `receiptCountry`
together — clearing the slot alone would let the country the reviewer just
dismissed be rebuilt from the mark. Notes open through a `notesOpen` set and a
`draftNotes` map rather than a truthiness gate, and commit through
`replaceRow` on the way out.

### The alternatives that were rejected

- **A row-edit dialog.** This is 0062's own width argument, unchanged: the
  card is 288px at its narrowest, and a chip costs its own width only, while a
  dialog costs a modal, a form, a dirty-state question and a second place for
  the row's rules to live.
- **Leaving the fix to after the import.** The status quo, and what the
  shipped copy promised. It is a real answer for a typo and no answer at all
  for a date, which is the field whose whole failure mode is that the row
  becomes hard to find.
- **Re-dating a picked date to the instant**, the way 0074 re-dates an assumed
  one. A picked day is a day. The instant rule exists so an assumed row sorts
  to the top of today where the user will see it; a reviewer who has just
  chosen August 14th is not asking to be shown it again.
- **Committing on every keystroke.** A duplicate re-check reads history
  ([0101](0101-a-corrected-row-is-checked-for-duplicates-again.md)), and a
  half-typed `54` is a different figure from `540`.
- **Clearing the whole `fieldConfidence` object on any edit.** An amount the
  reviewer retyped says nothing about a date nobody has looked at.

## Consequences

- **A graded row can leave the review step ungraded**, because that is what a
  human answering the question means. Anything downstream reading
  `fieldConfidence` to mean "the model was unsure" now also has to accept its
  absence as "somebody checked".
- **The card grows a second control column at narrow widths.** The date button
  and the currency chip do not share a line on a phone-width card; the meta
  row wraps, which is what it is built to do.
- **The category chip re-computes on every row replacement.** That is the
  fix, and it is also more work per emission than the cached value was — small
  against a card that already rebuilds its row array on every edit.
- **A country chip appears on receipts that never showed one.** Rows whose
  country came from a printed address are unchanged; the new chip is for the
  rows where the pipeline had concluded something silently.
- **`import.dateAssumed` is retired.** The chip it labelled no longer exists
  in that form, and its wording promised a post-import fix that is no longer
  the remedy.

## Things that only became apparent while building

- **The category chip had never shown a correction, and the sibling card's own
  comment forbids the pattern that caused it.** `computed()` over a plain
  `@Input()` reads a value with no producer: it evaluates once and caches
  forever. It looked correct because the parent's array is replaced on every
  emission, so the *list* re-rendered while the reused component inside it did
  not. Nothing failed loudly, and the defect was invisible to any test that
  set the input once.
- **"Add notes" opened nothing at all.** A button, a handler, a textarea and a
  gate that made the textarea unreachable from the button — notes could be
  edited only on a row that already had them, which is the one case where the
  button is not needed.
- **Every flagged row's accessible name carried a double full stop.** The
  reason strings end in `.` or `。` and the label joined them with `. `, so
  screen readers heard "…keep it, or pick another day.. Change date". A
  terminator-aware join fixed it, and it existed for as long as the flagged
  labels have.
- **The layout argument for dropping the caret did not survive measurement.**
  The question was asked because the caret looked like it might be costing a
  line at 288px. Measured, `.meta-info` is 174px there, while the date button
  and the currency chip need 212px side by side with the caret (126 + 6 + 80)
  and 190px without it — both over. They wrap either way, the type toggle
  wraps with them, and the caret buys no line at all. The caret was dropped on
  its semantic reason alone: the button opens a dialog. An earlier figure of a
  194px meta row, and the ~342px threshold derived from it, was arithmetic on
  the wrong content width and is not a measurement of anything.
- **The picker's seed had no test.** `[value]="row.date"` is the entire reason
  the calendar opens on the receipt's month, and it is the sort of binding
  that reads as decorative. Nothing exercised it until a DOM case opened the
  picker and read the active cell — and asserted no "today" cell was rendered,
  since a calendar that ignored the seed would land on the current month.

## Known gaps

- **An unparseable amount still closes the editor silently**, keeping the old
  figure. Refusing a malformed figure is right; refusing it without a word is
  not. The decided fix is to hold the editor open with `aria-invalid` and a
  short hint, and it is not in this wave.
- **`notesOpen` is only ever added to.** An Add-notes tap cannot be undone —
  there is no Escape on that control, and an empty textarea stays on the card
  for the rest of the review.
- **A ja or tc tooltip joins two sentences with a Latin `". "`.** The
  terminator-aware join strips the CJK stop correctly and then appends an
  ASCII one. One locale-aware joiner shared by the card's `withReason` and the
  form's `verifyFieldTooltip` would close it.
- **The question chip's Change button opens the same dialog and does not say
  so.** `aria-haspopup="dialog"` is on the date button only.
- **`currencyChipLabel` and `currencyOfferLabel` still join with a bare
  `. `.** Their reasons carry no stop today, so nothing doubles; they are one
  reworded string away from the defect that was just fixed next door.
