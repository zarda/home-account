# 101. A corrected row is checked for duplicates again

**Status:** Accepted, implemented · **Date:** 2026-09-04 · **Issues:** #368

Reference documentation lives in [../import-fields.md](../import-fields.md)
and [../receipt-import.md](../receipt-import.md).

Extends [0063](0063-an-import-suggests-only-what-the-account-already-knows.md),
whose offer rules are unchanged. It exists because
[0099](0099-the-review-step-edits-what-it-shows.md) made the detector's inputs
editable, and it inherits the re-dating of
[0074](0074-a-date-the-scan-cannot-vouch-for-lands-on-today.md).

## Context

Duplicate detection ran exactly once, inside the import doors: after
`resolveImportDate` had settled every row's date, and before the review step
ever rendered. The verdict a reviewer saw on the card had therefore been
decided on inputs the reviewer could not reach, and stayed decided however
much the row changed underneath it.

That was tolerable while the card could change nothing the detector reads. It
stopped being tolerable the moment the date, the amount and the description
became editable, and 0074 had already made the worst version of it reachable
without any editing at all.

Two receipts from different days whose printed dates were unreadable are both
resolved onto today. They are now two rows with the same date, and the
within-batch pass compares dates: the second is flagged as a twin of the first
and deselected. Neither receipt is a duplicate of anything. The reviewer
corrects the second one's date — which is the entire point of the new
editor — and the row stays deselected, flagged as a copy of a transaction it
no longer resembles, because the only verdict the wizard had was taken before
the correction existed.

The mirror case is as bad and quieter: a row re-dated onto today that really
does match something in today's ledger is not flagged, because the check ran
against the misread date.

## Decision

**An edit to a row's date, amount, type or description sends that row through
the duplicate check again, and a verdict can be overruled per row.**

The badge grows a `.duplicate-clear` control — *Not a duplicate — import it* —
which clears the flag, restores the selection and marks the row overruled.

Currency, notes, category, tags, location, the rule link and selection are not
detection inputs and trigger nothing. A `recurring_occurrence` verdict keys on
the offer, not on the row, and is unchanged from 0063.

### The contracts, each named by the failure it prevents

**Per-row stamps.** `recheckStamp` maps a row id to the sequence number of the
call that owns it, and an answer is applied only for the rows whose stamp that
call still holds. A single global token would discard row A's verdict the
moment row B was edited, though nothing about A had been superseded — one
in-flight read cancelling an unrelated one.

**The `overruled` set filters the within-batch pass.** This is the least
obvious of them. `findWithinBatchDuplicates` regenerates its verdicts from the
rows alone and keys `alreadyFlagged` on `isDuplicate === true`, so neutralising
an overruled row's standing entry to `none` does not protect it: the pass sees
an unflagged row, finds its twin again, and re-flags it on the next edit to any
*other* row in the batch. The overrule has to be held outside the entries the
pass regenerates, or it survives only until somebody edits a different row.

**Within-batch verdicts are dropped and regenerated, never merged.** They
derive from the rows as they now stand. A standing twin entry for a row the
fresh pass no longer flags would win by id and put the flag back.

**Only a changed verdict rewrites a row.** An unchanged verdict leaves the row
object alone, and with it the reviewer's own selection — otherwise a re-check
that concluded nothing would silently reselect a row the reviewer had
deselected by hand.

**A first population is not a change.** Only ids present both before and after
an emission are compared, so the initial arrival of the rows does not look
like an edit to all of them.

**Dates compare with `Object.is` on the instant.** A JSON-door row can carry
an Invalid Date, and `NaN !== NaN` would mark such a row changed on every
emission — a re-check per keystroke on a row nobody touched.

### A failed re-check keeps the standing verdict and says so

A refusal, a network fault or an answer that is not an array leaves the last
honest verdict in place. The plan said that happens silently. It should not:
the reviewer who corrects a date *precisely* to clear a flag they believe is
wrong, on a train with no signal, would watch the flag stand with no
explanation and no reason to think anything had been attempted.
`import.recheckFailed` says the earlier verdict stands and points at the
overrule as the way past it.

The message is suppressed when every stamp the call held has since been
superseded — that later edit's own call answers for the row, and two notices
for one row would be worse than none.

### Import waits while a re-check is in flight

`rechecksInFlight` is incremented from before the history read to after the
rows are rewritten, and Import is disabled while it is non-zero. An edit
followed immediately by Import otherwise snapshotted the rows before the
verdict landed, which is the one moment the whole record is trying to prevent.

### `processFiles` clears the detection state per batch

It used to append each batch's checks to the last's. With verdicts now folded
rather than replaced wholesale, a stale entry from a previous drop is a live
flag on a row id that no longer exists — or, worse, on one that does.

### The alternatives that were rejected

- **Re-checking the whole batch on every edit.** A history read per keystroke,
  and a window query per row, to answer a question about one row.
- **Clearing every verdict when any row is edited.** It removes the false
  flag and every true one with it, and the true ones are the reason detection
  exists.
- **Re-checking on a currency, notes, category or tag edit.** None of them is
  an input to the detector, so the answer is known in advance.
- **Re-running on a declined rule link.** The `recurring_occurrence` verdict
  keys on the offer, and 0063 already settled what a decline means.
- **Blocking the edit until the re-check lands.** The correction is the user's
  intent; the check is bookkeeping about it, and bookkeeping does not get to
  hold the field.

## Consequences

- **Editing a row can cost a Firestore read**, on the same window the initial
  detection uses. Bounded by edits, which are bounded by a human.
- **A verdict can flip while the reviewer is looking elsewhere on the card**,
  because the answer is asynchronous. The row's badge and selection change
  under them.
- **An overruled row stays overruled until it is edited.** Editing a row
  clears its overrule, on the grounds that the row the reviewer excused is no
  longer the row in front of them.
- **The detector now sees dates a human chose**, which is the improvement: the
  comparison it makes is finally against the values that will be written.

## Things that only became apparent while building

- **An assertion that claimed to pin the drop-and-regenerate rule could not
  fail.** With `duplicateChecks` empty and the service's answer empty, the
  expectation held whether or not `within_batch` entries were filtered out of
  the standing set — deleting the filter left the suite green while a
  dissolved twin stayed flagged forever. A test over a rule with no inputs
  proves the rule is spelled correctly and nothing else.
- **Neutralising an entry is not the same as protecting a row.** The obvious
  implementation of an overrule — rewrite that row's check to `none` — is
  correct exactly until the next edit anywhere in the batch, because the pass
  that would re-flag it does not read the entries at all. This took reading
  `findWithinBatchDuplicates`' own flag bookkeeping to see; nothing about the
  call site suggests it.
- **A single global token loses verdicts nobody superseded.** Edit row A, edit
  row B before A's answer lands, and A's answer is discarded. It looks correct
  under any test that edits one row.
- **An Invalid Date is a live shape on the JSON door**, and comparing dates
  with `!==` on the instant turns it into a permanent re-check loop. The bug
  is invisible on every row whose date parses.
- **The failure path had no user-visible half at all**, and writing it changed
  the design: once a failure has to be reported, it also has to decide *which*
  failures are still the user's business, which is where the superseded-stamp
  suppression came from.

## Known gaps

- **A released overrule's ability to re-flag is untested.** The emulator case
  proves that a corrected row re-checks, is overruled, and is not re-flagged
  by another row's edit. That editing the overruled row itself clears the
  overrule and lets a true verdict return is asserted only at the unit level.
- **An asynchronous verdict flip is not announced**, though the wizard already
  injects `AnnouncerService`. A screen-reader user editing an amount is not
  told that a row two cards down just lost its flag.
- **A re-check reads history, not the offline queue.** A row matching
  something queued and not yet drained is not a duplicate as far as this
  check is concerned.
- **The failure notice is a snackbar and therefore transient.** A reviewer who
  misses it sees a standing flag with no explanation, which is the state this
  record set out to stop being silent.
- **Nothing re-checks on the confirm step.** The rows are settled at the
  review step and carried forward; a stale verdict there would have to have
  survived an edit that produced none.
