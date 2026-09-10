# 115. A failed row is named by its id

**Status:** Accepted, implemented · **Date:** 2026-09-11 · **Issues:** #384

Reference documentation lives in [../receipt-import.md](../receipt-import.md).

Extends
[0103](0103-the-review-step-adds-a-row-and-the-wizard-is-sealed-while-it-writes.md),
whose seal exists because the recovery path indexed a list by position — the
numbering this record replaces. It restates the boundary
[0060](0060-a-confirmed-import-keeps-its-photos-and-names-its-source.md) drew:
a row saved without its photos is counted as its own figure and never lands in
`errors`, because the wizard re-offers the error list.

## Context

A partial import — some rows written, some refused — puts the refused rows
back on the review step so they can be corrected and confirmed again. The
service produced the error list, the wizard consumed it, and the two agreed
only by counting.

`confirmImport` on the service iterates the *selected* rows and pushes `row: i
+ 1` on a failure, one-based against that subset. The wizard rebuilt the same
subset before the await — `submitted` — and read `errors[n].row - 1` back into
it. That is a correspondence held together by two filters staying identical
across an await, and 0103 is the record of what it cost: the comment claiming
the review step could not move under the snapshot was false, and closing that
hole took `[editable]` on every step of the stepper plus a deferred index
assignment on the way back.

Even sealed, the numbering is fragile in a way nothing on screen explains. The
number is a position in the *submitted* subset, not in what the reviewer is
looking at: deselect one row above another and the failing row is second in
what was written and third on the card. The wizard had to hold a private copy
of the list for the sole purpose of translating between those two counts, and
the record it wrote — which is also what Import History shows — carried the
same ambiguous number.

Every row already had a stable name. `CategorizedImportTransaction.id` is
required, minted by `nextImportRowId` per door, and it is what the card, the
duplicate verdicts, the receipt-row set, the editing state and the attachment
planner are all keyed on.

## Decision

**`ImportError` carries the row's `transactionId`; the wizard re-offers by
that and nothing else.**

```ts
export interface ImportError {
  row?: number;
  transactionId?: string;
  …
}
```

The failure branch pushes both. `row` stays for two reasons and neither is the
wizard's: records written before this field existed still carry only a number,
and Import History renders `error.message` alone, so the number costs nothing
there and removing it would rewrite history's shape for no reader.

The wizard's side collapses to a lookup:

```ts
const failedIds = new Set((result.errors ?? []).map(e => e.transactionId).filter(…));
const failedRows = this.extractedTransactions().filter(t => failedIds.has(t.id))…
```

`submitted` is deleted — the confirm step was its only reader — and with it
the second copy of the batch. What comes back is filtered out of the live
list, so it is the row as it now stands, ticked and cleared of its duplicate
verdict for a second attempt.

### The alternatives that were rejected

- **Returning the failed rows themselves on the result.** It puts the row
  shape in the record's contract and hands back objects that may be staler
  than the ones the card holds. An id names a row without carrying it.
- **Dropping `row`.** Records already in Firestore carry it and nothing
  migrates them; a reader that met a record with neither field would have
  nothing at all. It is one number in a document that is written once.

## Consequences

- **The wizard re-derives nothing across the await.** The snapshot 0103's seal
  was protecting is gone from the confirm step; the seal itself stays, because
  what it protects — a reviewer editing rows that are being written — was
  never only about the numbering.
- **`firestore.rules` is unchanged.** `importOptionalsValid` accepts any list
  under `errors` (`firestore.rules:528`), so a new field on the entries needs
  no deploy and this wave ships no rules change.
- **0060's boundary was checked and is intact.** A row whose *photos* failed —
  a quota refusal or an upload failure — is retried bare inside the per-row
  `try`, succeeds, and increments `receiptsSkipped` or `receiptsFailed`; it
  never reaches the outer `catch` that pushes an error, so the id list cannot
  re-offer a row that is already saved.
- **The history list is untouched.** It prints the first three messages and a
  "+N more" line; neither the number nor the id is rendered.

## Things that only became apparent while building

- **The two fixtures had to lie to be worth anything.** Both wizard cases
  carry `row: 99` — a position no list has — so a re-offer that still read the
  number restores nothing and fails, while the id-based one finds its row. A
  fixture with a *correct* row number would have passed under either
  implementation.
- **The emulator case is where the two orders actually diverge.** It drops a
  four-row backup, deselects the second card and leaves the third unpriced, so
  the refused row is third on the card and second in what was written. The
  refusal is `INVALID_TRANSACTION_AMOUNT`, thrown by
  `TransactionService.addTransaction` before any id, upload or write exists —
  the rules never see it — and the record comes back naming `row: 2` with the
  `transactionId` of the card's third row. The wizard re-offers exactly that
  row.
- **The `!!id` guard on the id set is defensive only.** Every producer sets
  it, because the id is required on the row it is copied from. It is there for
  a record written before the field existed being fed back through the same
  branch.

## Known gaps

- **A record written before this field cannot be re-offered.** The wizard
  filters on ids and finds none, so a partial import whose record predates the
  field would re-offer nothing — an empty review step rather than the rows.
  Only reachable by replaying an old record through a running wizard, which
  nothing does.
- **`row` is now written by one producer and read by none.** It is kept for
  the two reasons above; the next reader of `ImportError` has to know that the
  number is a position in the submitted subset, which is a thing no surface
  displays.
