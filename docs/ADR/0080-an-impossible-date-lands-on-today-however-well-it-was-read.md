# 80. An impossible date lands on today, however well it was read

**Status:** Accepted, implemented · **Date:** 2026-08-30 · **Issues:** #342

Closes a known gap of
[0074](0074-a-date-the-scan-cannot-vouch-for-lands-on-today.md). Reference
documentation lives in [../dates.md](../dates.md).

## Context

0074's net has three panels: a value nothing can parse, a value graded below
`VERIFY_FIELD_THRESHOLD`, and — for everything else — trust. That third panel
has a hole in it. A model that reads `2099-12-31` off a receipt clearly
enough to claim 0.9 confidence produces a row `resolveImportDate` has no
reason to doubt: it parsed, and it cleared the bar. Nothing downstream of the
reader asks whether the date it confidently claimed could actually be true.
0074's own "Known gaps" said so directly — no absurd-year guard exists
anywhere but the on-device regex parser's own future-date check, and only
that one lane ever consults it.

Prompt compliance was the whole defense. `receiptParse` and its siblings
already say never to invent today's date; nothing said anything about a date
the model might invent that is not today — a typo'd year, a stuck OCR digit,
a training-data date bleeding through. A well-formed, confidently-claimed
date that cannot be right sails past a threshold built to catch doubt,
because it is not doubtful. It is wrong in a way that reads exactly like
being right.

## Decision

**A parsed date still has to be a plausible one, not merely a parseable
one.** `resolveImportDate` gains a second test, checked before the confidence
threshold, that substitutes `now` for a graded date landing outside a window
built fresh from `now` itself: more than a day ahead, or more than ten
calendar years back.

| What arrived | What comes back |
|---|---|
| A value `parseDateInput` rejects | `now`, graded 0, marked assumed |
| A parseable, graded value more than a day ahead or over ten years back | `now`, the reader's own grade kept, marked assumed **and** implausible |
| A parseable, graded value inside the window but below `VERIFY_FIELD_THRESHOLD` | `now`, the reader's own grade kept, marked assumed |
| A parseable, graded value inside the window and at or above the threshold | the parsed date, grade kept |
| A parseable value nobody graded | the parsed date, no grade — however implausible its value |

### The window is measured from now, a day ahead and ten years back

The upper bound mirrors the regex parser's own future-date guard —
`parsed.getTime() > now.getTime() + DAY_MS` is the same one-day allowance
`receipt-text-parser.ts` already gives a same-day purchase read a few hours
ahead by a slow clock or a timezone slip. The lower bound is ten years,
computed with `setFullYear(now.getFullYear() - 10)` rather than a millisecond
constant: a decade is not a fixed span of milliseconds once leap years are in
it, and `Date`'s own calendar arithmetic answers the question exactly, where
a constant would drift.

The window is checked **before** the threshold, not after. A row that is
both implausible and low-confidence — an 11-year-old date graded 0.4 — is
therefore marked `dateImplausible`, the more specific of the two marks,
rather than the plain `dateAssumed` the threshold check alone would have
given it. Both checks still resolve to the same substitution; only the mark,
and the tooltip that reads it, differ.

### An ungraded row never enters the window

**The window applies only when `confidence !== undefined`.** This is the same
gate the threshold check already used, extended to cover the new one. A CSV
cell or a JSON backup row has no reader behind it to have claimed anything
about its date, implausible or otherwise — an eleven-year-old row is the
ordinary shape of a backup restore, not a defect to correct. Gating the
window on a grade existing at all is what keeps a years-old backup landing
on its own dates on re-import, rather than on today, en masse.

### The row keeps its grade, and gains a second mark

An implausible row keeps its `dateConfidence` untouched — the reading was
clear, and the mark says the *value*, not the grade, is the problem — and
adds `dateImplausible: true` alongside the existing `dateAssumed: true`.
Nothing reads `dateImplausible` on its own; every consumer that cares about a
substituted date already checks `dateAssumed`, and `dateImplausible` exists
only so the review card can pick which sentence to show.

### The chip keeps its label; the tooltip picks its wording

The review card's **Date set to today** chip is unchanged — the row is still
dated today, for a reason the icon already explains. `dateAssumedTooltip` now
takes the row and reads `dateImplausible` off it to choose between two
sentences: the existing "couldn't be read reliably" wording, and a new
`import.dateImplausibleTooltip` ("too far in the past or future to be
right"), added to all three catalogs. On a row graded 0.9 and marked
implausible, the per-cell verify flag stays dark: `needsVerification` reads
the same `fieldConfidence.date` the tooltip does, and 0.9 clears the bar.
That is deliberate — the grade is honest, only the value is not, and the
chip is where that story is told.

### The alternatives that were rejected

- **Checking plausibility on every row, graded or not.** Rejected above: it
  would treat "nobody looked" as "the reader was unsure," and redate an
  entire backup import to the day it was restored.
- **A single combined mark instead of two.** Collapsing `dateImplausible`
  into `dateAssumed` would lose the one thing that changed: what the review
  tooltip needs to say. Two marks cost one field; one mark would have cost a
  tooltip that quietly stopped being true for half its cases.
- **Re-checking the date against the receipt image itself.** No door here
  still holds the image at the point `resolveImportDate` runs, and building
  one to answer a question the value alone already answers well enough was
  more machinery than the bug warranted.

## Consequences

- **A genuinely decade-old, confidently-graded scan now lands on today,
  chip-marked.** That is an accepted casualty of a generous window: receipts
  do surface months late, and a household's own statements span years, so
  the window closes only on what is clearly absurd, not merely old.

## Things that only became apparent while building

- **The wizard smoke suite's new absurd-date case shares its wall-clock
  outcome with an existing doubtful-date case.** Both land the row on
  "today" against the real clock, and duplicate detection matches on date
  and amount together — so the new fixture needed an amount no sibling test
  in the file already used, or it would have collided with one rather than
  testing what it meant to.
- **`import-dto.utils.spec.ts` stays off the `test:dates` list.** Its
  assertions are instant- and offset-based against a mocked clock, the same
  shape ADR 0050 already exempted; a plausibility window built from `now`
  and calendar arithmetic does not change that.

## Known gaps

- **The window judges the value alone.** There is no re-check against the
  receipt image, so a date that is merely old rather than impossible — or an
  implausible one the model invented outright rather than misread — is not
  distinguished from the other by anything this record adds.
- **The manual form and the offline queue show no mark**, exactly as
  `dateAssumed` already did not before this record. Both are deliberate: the
  form's user is looking at an editable field, and the queue has no review
  surface to show a mark on.
