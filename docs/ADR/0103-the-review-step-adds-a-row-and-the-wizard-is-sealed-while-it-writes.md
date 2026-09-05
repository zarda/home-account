# 103. The review step adds a row, and the wizard is sealed while it writes

**Status:** Accepted, implemented · **Date:** 2026-09-06 · **Issues:** #372, #373

Reference documentation lives in [../import-fields.md](../import-fields.md)
and [../receipt-import.md](../receipt-import.md).

Extends [0100](0100-a-receipt-dated-before-today-is-a-question-the-reviewer-answers.md),
whose gate on Continue and Import this one joins on the same terms, and
[0099](0099-the-review-step-edits-what-it-shows.md), whose editors a hand-added
row is nothing but. A row added here is built for the single mapper of
[0059](0059-one-mapper-builds-every-imported-transaction.md) like every other,
and carries none of the marks
[0064](0064-the-country-comes-off-the-paper-before-the-phone.md) keeps out of a
document. The salvage rule it serves is
[0066](0066-an-answers-budget-follows-its-question.md)'s.

## Context

Two unrelated holes, in the same step, both of the same kind: the wizard
already told the user something it had not built.

**The notice asked for rows the step could not take.** 0066 salvages a
cut-off answer as far as it goes, and the review step carries a notice saying
items after the break are missing. Its own wording ended "add anything that is
not here" — and there was nothing on the step that added anything. A reader
that finished four of a receipt's nine line items said so on the card, and the
only way to enter the other five was to import the four, leave the wizard, and
use the transaction form five times. A notice that names a remedy the screen
does not have is worse than no notice: it costs the reviewer a hunt before they
conclude it was rhetorical.

**The seal the write assumed did not exist.** The wizard snapshots the selected
rows before it awaits the service, because the service numbers each per-row
error against that same subset, and a partial failure puts the failed rows
back by those numbers. The comment above the snapshot said this was safe
because "the review UI is unreachable while isImporting disables the stepper".
It did not. `isImporting` disabled the
Import button and the Confirm step's own Back button, and nothing else: the
stepper *header* stayed live, so a click on **Review** during a twenty-row
write went back to a card that edits rows the service was already writing. The
error numbers then indexed a list that had moved under them.

The two met at the recovery jump. A partial failure returns the reviewer to the
review step by setting the stepper's index — which is exactly the backward move
any seal has to refuse.

## Decision

**A blank row is a control on the review step; a row is not importable until it
has an amount and a description; and every step is uneditable for as long as
the write is in flight.**

### A hand-added row is the manual door

**Add a row** sits under the whole list. It adds a row rather than editing one,
so it is not an extras trigger inside a card — and the rows sit in a scroller
capped at 70dvh, so a control inside that scroller is one a reviewer with
twenty rows has to scroll to reach, which is the one case the notice above
points at it for.

The row is appended at the end, never spliced in beside the row it borrowed
from: the list is in the order the source gave it, and a row nobody read has no
place in that order.

It is born from its neighbour — the last row's day and currency — because that
is what it is missing *from*. The receipts of one trip are dated together and
priced in one currency, and the account's base is the wrong guess for both the
moment the batch is foreign; the base is the fallback for a row that follows
nothing. The date is a **copy** of the neighbour's `Date`, because sharing the
object would let the picker on one row move the other.

Everything a reader would have produced is **absent rather than blank**: no
`imageMetadata`, since there is no photo of it and the attachment planner must
not look for one; no `fieldConfidence`, because absent is the documented
"nobody graded this" shape `needsVerification` already reads, and a mark here
would flag a row nobody could have misread. Its category is the catch-all at
confidence 0 — the same thing any row nothing suggested a category for
carries — so the chip offers it as the guess it is.

The description editor is opened before the row is emitted, so the row arrives
already an input with the caret in it: the tap that added the row is the tap
that starts typing.

### Continue and Import wait for an amount and a description on every selected row

A selected row with no amount or no description holds both buttons, exactly as
an unanswered date question does, and a hint under the list says how many rows
are owed. The confirm step's summary carries the same count as a card.

The gate counts **every** selected row, not only hand-added ones, because an
unusable row arrives from every door: a blank CSV cell, a receipt group whose
total was lost with the break, a refund that cancels its charge. Holding the
import is the honest place for that, because the write will not take such a row
anyway — the rules refuse a non-positive amount, so what the reviewer would get
instead is a mid-import failure numbered against a list they have to go back
and search. An empty description is worse than a refusal: the mapper
substitutes `Imported transaction`, so what lands is not a nameless row but a
mis-named one, past review.

The three readings — the hint's count, the placeholder on the card, and the
trigger's accessible name — come from **one predicate per field**, exported
beside the gate. "Not more than zero" rather than "is zero", so the 0 a blank
row is born with, the 0 an unreadable cell becomes, the NaN a non-numeric
answer parses to and a negative figure are one case. A description is trimmed
before it is judged, because a quoted `"   "` cell reaches the card untrimmed.

Both unfilled fields show a **muted placeholder** on the card. Without one an
amount of nothing renders as an ordinary `-$0.00` wearing no verify flag — such
rows carry no grade for a flag to read — and a whitespace description renders
as a trigger with no width to press on, so the hint gives a count and the card
gives nothing to find it by.

### `[editable]` seals the stepper, and the recovery return is deferred past it

Every step is `[editable]="!isImporting()"`. That is what makes the snapshot
comment true: the CDK stepper gates *every* caller — a header click, a keyboard
move, `previous()` and a programmatic index — through the one setter, which
refuses a backward move onto a step that is not editable.

The partial-failure return therefore cannot be made in the same task as the
unlock. `isImporting` is a template binding: it reaches the `MatStep` at the
next render and not before, so setting the index alongside it is refused
silently, leaving the failed rows on a Confirm step whose summary describes
only them. The return is registered as an after-render callback with the
component's own injector, which parks it on the view — views are refreshed
before after-render hooks run, so the unlock has provably landed by the time
the index is set. The guard beside it is for a destroyed injector, which throws
NG0911.

### The alternatives that were rejected

- **Rewording the notice** to stop promising what the step cannot do. It is
  the cheap half of the fix and it leaves the reviewer with the same five
  receipt lines and the same transaction form.
- **An "add below" control on each card.** It would put the new row in the
  source's order, which is the one thing the order does not mean; and it is one
  more 40px control on a strip that is already the card's widest line at 288px.
- **A blank row born deselected.** It reads as safe and it is the opposite:
  the reviewer asked for the row, and a deselected row is invisible to the gate
  that would otherwise tell them it is unfinished.
- **Disabling the stepper header with CSS.** `pointer-events: none` stops a
  pointer and nothing else. The header is a set of buttons a keyboard walks
  into, and the camera hand-off's stepper is not even linear.
- **Blocking Import on the service side instead.** The service already refuses
  the row; the whole complaint is that its refusal arrives numbered, mid-write,
  after the reviewer has left the step that could fix it.

## Consequences

- **The review step now has two gates on Continue and Import**, and a row can
  fail both. The hints are separate lines because they name different work.
- **A row from any door can hold the import.** A years-old CSV with a blank
  amount column used to import as a set of zero rows the write rejected one by
  one; it now stops at review with a count. That is a behaviour change for
  files that never imported cleanly anyway.
- **The stepper cannot be walked backwards during a write**, by pointer or by
  key. The Back button on Confirm was already disabled; the header now agrees
  with it.
- **The steps already completed swap their pencil for a check while the write
  runs**, because that is what a non-editable completed step renders as. The
  upload step does not, since it is never completed without files.
- **The recovery return costs a render frame.** Nothing observable hangs on it:
  the summary is already on screen and the rows are already back in the array.

## Things that only became apparent while building

- **An unfilled *amount* was invisible, and it was not a new problem.** The
  work was scoped to the row the reviewer adds. Tracing which doors can produce
  a non-positive amount found it in the CSV parse, the JSON door (including the
  NaN a non-numeric field parses to), receipt consolidation and the receipt
  text parser — and every one of those rows had been rendering as an ordinary
  card reading `-$0.00`, with no grade and therefore no verify flag, for as
  long as the card has existed. The gate made them countable; without a placeholder the
  count would have been a number with nothing to point at.
- **A whitespace-only description is reachable, and truthiness disagrees with
  the gate about it.** The CSV parser trims unquoted fields only, so a quoted
  `"   "` cell survives as three spaces: the gate trimmed and counted the row,
  while the card's truthiness test rendered a zero-width trigger named
  "Edit description (   )". One exported predicate per field is the fix, and
  the reason the template calls a function rather than testing a value.
- **The CDK's refusal is total, and it is in the setter.** It was tempting to
  assume a programmatic index assignment bypasses the editability check the way
  a direct property write often does. It does not — every path is funnelled
  through the same setter — so the un-deferred version would have been dropped
  in silence. This is the sort of thing a unit test with a stubbed stepper
  cannot tell you; it came from the library source and is pinned against the
  real stepper in the emulator suite.
- **The seal makes the camera hand-off's path safe for the first time.** That
  stepper is not linear, so its steps are always navigable and `[editable]` is
  the *only* thing refusing a backward jump there.
- **The import's progress bar has never moved.** The confirm step binds a
  determinate bar and a status line to two of the wizard's own signals; one is
  only ever reset to zero and the other is never written at all, while the
  figures that do move belong to the service. A twenty-row import shows an
  empty status line and a bar at zero for its whole duration. Out of scope
  here — the seal is about what the user can *do* during the write, not about
  what they are told — and filed as a follow-up.
- **Nothing a user can press reaches the JSON backup door.** The wizard accepts
  `.csv,.pdf,.png,.jpg,.jpeg,.webp`, the dropzone enforces that list on both
  drop and select, and the share target takes images, PDF and CSV. The door is
  maintained as if it were live and is reachable only from a spec or a console.
  Also filed as a follow-up, and it is why the browser journey for it hands the
  file to the component directly.

## Known gaps

- **A hand-added row's first duplicate check comes from its first edit, not
  from its arrival.** 0101 compares a row against the one it replaces, and a
  row that has just appeared has no earlier self to differ from, so the
  emission that adds it is skipped. Typing into it fires the check, and this
  gate is what guarantees it is typed into — so the row is always checked
  before it can be imported, by the interaction of two rules rather than by
  anything that states it.
- **The gate counts rows, and does not lead to one.** The hint says how many
  are owed and nothing scrolls to them or filters the list; on a batch of
  twenty that is a hunt, mitigated only by the placeholders.
- **A row added by hand cannot be removed again.** Deselecting it keeps it off
  the import and off the gate, which is the whole of the answer.
- **The added row's category is the catch-all, and nothing suggests one for
  it.** The description the reviewer types is exactly the input the category
  memory answers from, and it is never asked.
- **The seal has no visible half.** A stepper header that refuses a click says
  nothing about why; the Import button's spinner is the only sign the write is
  what is refusing.
