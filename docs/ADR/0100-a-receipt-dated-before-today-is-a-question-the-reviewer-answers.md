# 100. A receipt dated before today is a question the reviewer answers

**Status:** Accepted, implemented · **Date:** 2026-09-04 · **Issues:** #368

Reference documentation lives in [../receipt-import.md](../receipt-import.md)
and [../dates.md](../dates.md).

Closes a gap of
[0074](0074-a-date-the-scan-cannot-vouch-for-lands-on-today.md), which
[0079](0079-the-multi-photo-lanes-grade-the-dates-they-read.md) and
[0080](0080-an-impossible-date-lands-on-today-however-well-it-was-read.md)
had already widened twice. Depends on the date editor of
[0099](0099-the-review-step-edits-what-it-shows.md): a question with no
control that answers it is another chip.

## Context

0074's argument is about asymmetry, and it is correct. A transaction wrongly
dated today sits at the top of the list the user is already reading, one tap
from the date field. The same misreading filed in 2024 is four hundred rows
down a windowed pager, in a month whose total has already been read and
believed. So a date the scan cannot vouch for lands on today, and 0079 and
0080 extended the same treatment to the lanes that graded nothing and to
values no plausible calendar contains.

Every one of those records is about a reading the app **doubts**. None of them
touches the case underneath: a date the reader was confident about and simply
got wrong. `03/04` read cleanly as March 4th on a receipt printed April 3rd
grades 0.9, passes the bar, contains no implausibility, and arrives silently
filed five months out. That is the same unfindable row 0074 was written to
prevent, reached by a route 0074 cannot see, because the model's confidence is
evidence about the model and not about the paper.

The chip that has stood on that card since `fieldConfidence` existed is a
request for the user's attention, and 0074 already recorded what that is worth:
a request for attention is defeated by inattention, which is the ordinary case
for a dozen receipts confirmed in one tap. The gap 0074 left is not a gap in
the grading. It is that nothing in the import ever *stopped*.

## Decision

**On a receipt row, a date that is not today is a question the reviewer must
answer before the import moves.**

A selected row is asked when it is dated on any day but today, or when it was
assumed onto today by 0074's resolver. Keep answers it; a picked date answers
it; a bulk **Keep all dates** answers a whole trip's worth in one tap. Until
every asked row is answered, Continue and Import are disabled and a hint says
how many are outstanding.

`needsDateAnswer(row, attention, now)` in `core/utils/import-review.utils.ts`
is the whole rule, and it is pure so that the card offering the answers and
the wizard gating on them cannot disagree about what counts as answered. A row
is asked only while it is `selected` — a row that will not be imported is not a
question — and only once, which is what `dateReviewed` records.

A grade below the bar needs no third wording of its own: the resolver already
assumes every such date onto today, so it arrives as an assumed row and is
asked as one.

### Attention is carried per row, never as a batch flag

`receiptRowIds` on the wizard is a set of row ids, filled by the camera
hand-off and by an image batch the user labelled as receipts.

It has to be a set rather than a bit, and the reason is in `processFiles`: the
dropzone takes a mixed pick, and a photo's rows and a CSV's rows are
concatenated into one array. A batch-level flag would turn every row of a
historical bank export into a question the moment one receipt rode along in
the same drop — a hundred blocking questions about dates nobody doubts, which
is exactly the marker fatigue
[0051](0051-an-uncategorized-row-is-graded-where-it-is-coerced.md) argued
against. Statements, bank PDFs, CSV and JSON rows are never asked.

### The in-form scan flags and never gates

The form keeps 0074's reasoning unchanged: it fills a field the user is
looking at and is about to submit, so a scanned date on another day raises the
verify flag beside that field and blocks nothing. `scanDate` holds the value
the scan produced and is cleared when the user edits the date or the form
resets.

Where the reader also doubted the date, the reader's doubt is the tooltip's
first sentence and the not-today sentence follows it. The doubt is the more
specific fact and the one that explains the value on screen; leading with the
weaker statement would bury it.

### The gate has two bindings, not one

Continue is disabled while any asked row is unanswered. **Import carries its
own guard** rather than leaning on the review step being incomplete, because
the camera hand-off drops the user into a non-linear stepper where the confirm
step is reachable without passing through Continue. The confirm step also
carries a *Dates to check* card for the same count, which is the surface a
reviewer who arrived that way actually sees.

The count is one pluralised key, `import.datesToCheck`, and the hint carries
`role="status"` so the number changes are spoken as they fall.

### The alternatives that were rejected

- **A soft count that blocks nothing.** That is the chip with a number on it,
  and 0074 already recorded what happens to it.
- **Highlighting the row without offering a Keep.** A question with no cheap
  correct answer is a nag. Most receipts genuinely are from another day, and
  Keep must be one tap or the gate becomes something to route around.
- **Gating every lane.** A CSV of two years of transactions is dated in the
  past by construction. Blocking it would make the gate meaningless within one
  import.
- **A stored "verified" flag on the transaction.** Marks are not fields
  ([0064](0064-the-country-comes-off-the-paper-before-the-phone.md)): a rules
  clause, an index of nothing and a backfill story for a fact that stops
  mattering the instant the row is written.
- **A third "Set to today" button** beside Keep and Change. The picker opens
  on the row's month with today one tap away, and a third control on a 288px
  card costs more than the tap it saves.
- **Asking on the confirm step only**, where the count already appears. By
  then the reviewer has left the cards that carry the answers.

## Consequences

- **One more tap per receipt from another day**, which is most receipts. That
  is the cost, it is paid by the person best placed to pay it, and *Keep all
  dates* collapses a trip's worth into one.
- **A review left open across midnight is not re-asked.** `needsDateAnswer`
  takes `now` at evaluation, but the wizard re-evaluates on row changes rather
  than on a clock, so a row answered at 23:59 stays answered and a row dated
  "today" at 23:59 is not re-asked at 00:01 until something else about it
  moves.
- **The camera hand-off's rows are all asked at once.** A ten-photo capture
  arrives with ten questions standing; the bulk Keep is what makes that
  reasonable rather than what makes it tolerable.
- **The in-form and wizard doors now differ visibly** on the same scanned
  date: one flags it, the other stops. That is deliberate and it is 0074's own
  distinction — whether a human is looking at the field.

## Things that only became apparent while building

- **The gate's entire user-visible surface had no test.** The wizard's unit
  spec blanks its template, and the existing smoke cases never touched those
  controls, so the two `[disabled]` bindings, the hint and the confirm card
  were asserted nowhere. Every one of them could have been deleted with the
  suite green. A smoke case exercising the real template was written for
  exactly that reason.
- **A dropped batch is not one kind of thing.** The mixed-pick case was found
  by reading `processFiles` rather than by using the app, and it is the single
  fact that decided the shape of the whole feature: per-row attention is not a
  refinement of a batch flag, it is the only version that does not misfire on
  the first mixed drop.
- **A non-linear stepper makes "the previous step is incomplete" an
  unreliable guard.** The review step's `[completed]` binding is honest and
  the camera hand-off simply does not go through it. The second guard on
  Import is not belt-and-braces; it is the only guard on that path.
- **The question chip and the flag say the same thing and are read by
  different people.** The chip's Keep half and the button's flag carry the
  same tooltip, so a pointer user and a screen-reader user get one sentence
  between them rather than two that drift.

## Known gaps

- **The date question is not re-evaluated across midnight** until a row
  changes. A review open for hours can carry a row dated "today" that no
  longer is.
- **An assumed row and a confidently-misread row are asked in the same
  words** once the resolver has moved the assumed one onto today. The
  distinction survives in the tooltip and not in the chip.
- **Nothing asks about a receipt dated in the future** beyond 0080's
  implausibility window, which resolves rather than asks. A receipt dated
  tomorrow is inside the window and is not today, so it is asked — but as an
  ordinary not-today row, with no wording for what is actually odd about it.
- **The bulk Keep answers rows the reviewer has not looked at.** That is its
  purpose and it is also its risk: one tap accepts every standing date,
  including the one that was wrong.
- **The form's flag is still only a flag.** A user who ignores it submits the
  scanned date, exactly as before this record.
