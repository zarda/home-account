# 135. A purchase split across categories is stored as sibling rows sharing a group

**Status:** Accepted, implemented · **Date:** 2026-09-17 · **Issues:** #70

Reference documentation lives in [../splits.md](../splits.md).

## Context

A transaction has always carried one scalar `categoryId`. Every reader that
matters keys on it directly: the category breakdown, the period totals, the
shared aggregation reducers, trends and insights, the CSV and PDF exports,
and a budget's `spent` figure, which is a live `where('categoryId', '==', …)`
query against the collection. None of that code fans a document out into more
than one logical row, and none of it was going to be rewritten for this
feature — a single grocery run that is really three categories' worth of
spending had nowhere to say so.

The house had already solved a narrower version of this. The import review
step's `splitImportRow` takes an amount off a row and writes it as a new row
carrying `splitFrom`, so a receipt that is really two purchases becomes two
rows without either being read as the other's duplicate (`sameSplit`), and
each gets its own place to attach a receipt image. That is a split of rows,
never of a document's own fields, and every reader above already treats each
result as an ordinary transaction — which is exactly the property this
feature needed for a plain purchase, not just an imported one.

Atomic multi-document writes in this app already have a shape:
`FirestoreService.runTransaction` with pre-generated ids and a loop of
`tx.set`, the pattern the recurring engine uses to post a rule's occurrences.
A transaction rejects outright while offline — the wrapper's own comment says
so — which mattered once a split had more than one document riding on the
same commit.

Some things a sibling row plainly could not share with the purchase it came
from: receipt storage objects are keyed by transaction id, so a part has
nowhere to attach one until it exists as a document; a goal link moves a
counter once per row, and every count in the app — the list header, the data
hub, the period-totals cap — counts rows, not purchases. And the rules'
optional-field whitelist (`txOptionalsValid`) had no `hasOnly` guard, so an
unknown field on a transaction was already accepted, unvalidated, before this
decision added one. Separately, a backup restore does not write a stored row
back verbatim — `BackupRestoreService` rebuilds `CreateTransactionDTO` field
by field and writes it through the ordinary add path, so any field the DTO
does not carry is silently dropped on the way back in, which is exactly what
forced a backup version bump the last time a transaction gained a field worth
keeping (a goal's converted amount, `1.4`).

## Decision

**A split purchase is N sibling documents sharing one field,
`splitGroupId: string` — the id of the group's first row.** The first row
carries the field too, so a document's own field says "this is part of a
split" without a query ever asking. Nothing else new is stored.

### Two shapes were weighed, and the reader count decided it

The alternative was an embedded breakdown on one document — an array of
category/amount pairs living inside the purchase's own row. That would have
meant teaching every one of the readers above (the aggregation reducers, the
budget query, both exports, search and insights) to look inside a document
for more than one category's worth of spending, or to keep computing against
the scalar and silently miss the parts. Sibling rows cost none of them
anything: a part is a transaction like any other, with its own scalar
`categoryId`, so `groupByCategory`, `getPeriodCategoryTotals`, a budget's
`spent` query and both CSV/PDF exports read it correctly with no change at
all. The field that says "these rows travel together" is decoration a reader
is free to ignore.

### The form's split is a take-off, not a sum

The amount field stays the purchase's total throughout. Each added part names
a category and an amount taken off that total; whatever is left stays on the
purchase's own category — the same shape `splitImportRow` already used. At
least one part is required; there is no other cap. `splitRemainder`
(`split-purchase.utils.ts`) is the one place this rule lives: a part must
name a category (an empty one refuses the whole split, so neither service
seam nor the form's own submit gate has to check it a second time), and every
part's amount, like the remainder itself, is rounded to the currency's minor
unit before it is compared or written — the exact figure the remainder rule
subtracts, so the group's rows always sum to the purchase they came from
rather than drifting a fraction off it through unrounded intermediate values.

### One composer, two seams

`composeRow` is the row literal every write path now shares — a plain add, a
backup restore, and both split seams — parameterized on the caller's already
-resolved conversion figures rather than repeating the same optional-field
spreads in four places.

`addSplitTransaction(data, parts)` writes the remainder row and every part in
one `runTransaction`, with no reads: every id is pre-generated, so nothing
needs to know where the sibling rows already are. `splitTransaction(id,
parts)` shrinks a *stored* row to its remainder and writes its parts in one
`runTransaction` that opens with its own `tx.get` — never a pre-read taken
outside the transaction — so a rival write landing between the caller's
optimistic view and this commit is what actually decides the remainder, not
whatever the form last rendered. A row already in a group keeps its existing
`splitGroupId` and the new parts join it, rather than starting a second
group layered on top of the first.

Parts copy the purchase's identity — type, currency, exchange rate, base
currency, description, date, tags, location, period — and never its note,
its receipts, its goal link or its recurring link, matching
`splitImportRow`'s own exclusions exactly. A part's `amountInBaseCurrency` is
the purchase's own exchange rate applied to the part's amount, never
re-resolved against a live rate — the same never-re-rate rule
[docs/money-snapshots.md](../money-snapshots.md) already states for every
other stored figure.

### What a sibling cannot share, made explicit in the write

**Receipts stay on the first row.** Storage objects are keyed by transaction
id, and a part has no id of its own to key against until the transaction
that creates it has already committed — by which point the receipts are
already uploaded and named. **A goal link refuses the whole split**: both
seams throw `SPLIT_REFUSED` if the purchase (or the row being split) carries
`goalId`, because a contribution is a whole-purchase notion and N counter
moves on one goal is exactly the contention `stageGoalTransition` exists to
prevent. The form enforces the same exclusion in both directions — a linked
row is never offered the split control, and starting a split hides the goal
field below it. **A recurring rule cannot be split** at all; that door simply
does not exist, and is recorded rather than built around.

### The offline refusal is the form's, not the service's alone

A split is one `runTransaction`, and a Firestore transaction rejects
outright while offline. Rather than let that surface as the same generic
failure every other write error becomes, the form checks `pwa.isOnline()`
before attempting a split and refuses with its own message — the purchase is
still on the form to save whole, or to retry once connectivity returns.

### The rules gained one permissive line

`splitGroupId is string` joins `txOptionalsValid` alongside the other
optional fields it already allows. It is deliberately no stricter: nothing
ever queries the field, so there is nothing to validate beyond its type, and
the line is purely permissive — a client running ahead of a deploy is never
refused for sending it.

### No backup version bump, and why the restore still had to change

The full JSON export already writes each transaction whole, so nothing about
export changed. The restore is the other direction: `BackupRestoreService`
rebuilds `CreateTransactionDTO` field by field before writing it back through
the ordinary add path, and a field the DTO does not carry is dropped, backup
or no backup — the reason `recurringId` needed the same treatment and the
reason a goal link needed a version bump last time. `splitGroupId` needed the
first half of that (`CreateTransactionDTO` gained the field, and the restore
copies it across the same way it already copies `recurringId`) but not the
second: nothing recomputes from a restored `splitGroupId` the way a goal's
counter has to be rebuilt, so there was nothing for a version bump to
protect.

### Reading a part costs no query

The list badges any row carrying `splitGroupId` — no lookup, since the field
already rode down with the row. The edit form tells the user "one part of a
split purchase" without counting its siblings. Deleting a part deletes only
that document, and the confirmation names the purchase it came from rather
than implying the whole group is at risk.

## What was rejected

- **An embedded parts array on one document**, for the reader-count reason
  above: every existing consumer of a transaction's `categoryId` would have
  needed to learn a second shape, where sibling rows needed none of them to
  change.
- **Sum-equality instead of take-off.** Asking for N amounts that must add up
  to the total, rather than N amounts taken off it with a computed remainder,
  was rejected as the interaction: it asks the user to do arithmetic the form
  can do instead, and it abandons the shape `splitImportRow` had already
  established for exactly this kind of edit.
- **A backup version bump**, considered by analogy with goal links, and
  rejected once it was clear nothing about `splitGroupId` needs recomputing
  on the way back in — the field only ever needs to ride along.

## Consequences

- `split-purchase.utils.ts` (`splitRemainder`, `SPLIT_MIN_PARTS`) and its
  spec are new — 13 cases, pure functions, no `TestBed`.
- `TransactionService` gained `composeRow`, `addSplitTransaction`,
  `splitTransaction` and the `SPLIT_REFUSED` error; `transaction.service.spec.ts`
  now carries 157 cases.
- The form gained `SplitPartsComponent` (the parts editor, its own spec), the
  `canSubmit` gate, the currency/amount/goal signal mirrors a split needs
  under `OnPush`, and the type-flip filter that drops a part whose category
  the new type no longer offers.
- The list and the row component each gained a badge keyed on
  `transaction.splitGroupId` — `role="img"` with a literal `aria-hidden="false"`,
  because `MatIcon` hides itself from assistive technology unless that
  attribute is written on the template, not merely bound — and the delete
  confirmation branches to a part-specific message.
- `firestore.rules` gained the one permissive `splitGroupId is string` line
  in `txOptionalsValid`; no other rule, index or `storage.rules` change.
- `transaction-split.smoke.spec.ts` is new, proving both seams and the
  rules line against the deployed emulator rules rather than a mock.
- `docs/money-snapshots.md`'s never-re-rate rule, `docs/one-shot-reads.md`
  and `splitImportRow` are all cited rather than re-derived — this decision
  reuses precedent instead of inventing new rules where the app already had
  one.

## Departures from the issues

None recorded. #70 asked for a purchase split across categories without
rewriting how every other feature reads a transaction, and the sibling-row
shape is exactly that: nothing outside the write path and the two new UI
surfaces had to change.

## Things that only became apparent while building

- **`splitImportRow` was closer to a template than a precedent.** Its
  exclusion list — note, receipts, goal link, recurring link — transferred
  onto `addSplitTransaction` and `splitTransaction` unchanged, down to the
  reasons for each exclusion, which is a stronger signal that the shape was
  right than arriving at the same list independently would have been.
- **An edit that splits is two writes, not one.** `updateTransaction` lands
  the field edit first; `splitTransaction` then reads the amount that edit
  just wrote to compute the remainder. A split that is then refused —
  `SPLIT_REFUSED` — leaves the earlier field edit persisted, which is why
  the form reports that failure as a message the user can act on rather than
  closing the dialog: the parts are still there to correct, but the amount
  change already landed.

## Known gaps

- **Counts still count rows.** A split purchase of three is three rows in
  every "N transactions" figure, the data hub, and the period-totals cap —
  stated here rather than hidden, since nothing about this decision changes
  what any of those counters mean.
- **A recurring rule cannot be split.** Out of scope; a rule posts one
  category per occurrence and this decision does not touch that path.
- **The wizard's own split still lands as unrelated rows.** `splitImportRow`
  predates `splitGroupId` and was not touched here — a receipt split during
  import produces two rows with no group id between them, so the badge and
  the part-aware delete confirmation never apply to an import-born split.
- **Analytics cannot say "split."** The form still reports the one
  `trackTransactionAdd` event it always sent for an add, with no field
  naming that the write behind it was several documents.
- **No group view, and no group delete.** There is no surface that reads a
  split's siblings together, and deleting a part never offers to delete the
  rest of its group.
- **A part's date edit leaves its siblings untouched.** Editing one part's
  date moves only that document; nothing propagates the change across the
  group, because nothing tracks that a date edit on a part is different from
  an ordinary one.
- **The CSV export writes parts as plain rows.** `splitGroupId` is not a CSV
  column — see [docs/csv-format.md](../csv-format.md) — so a spreadsheet
  reader has no way to tell three exported rows were one purchase.
- **Deleting the group's first row leaves the survivors pointing at nothing.**
  The other parts keep `splitGroupId` set to that row's id and keep showing
  the badge; the id no longer names any document. Harmless, because nothing
  queries the group, but the badge does not know.
