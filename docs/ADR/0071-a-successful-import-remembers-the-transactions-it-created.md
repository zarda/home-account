# 71. A successful import remembers the transactions it created

**Status:** Accepted, implemented · **Date:** 2026-08-28

Reference documentation lives in [../receipt-import.md](../receipt-import.md).

Extends [0065](0065-an-attempt-is-recorded-where-it-runs.md), whose door policy
— which doors write a success record and which write none — stands unchanged,
and the provenance
[0060](0060-a-confirmed-import-keeps-its-photos-and-names-its-source.md) put on
the same record. The reason it is needed now is
[0070](0070-a-date-the-scan-cannot-vouch-for-lands-on-today.md).

## Context

0065 turned Import History into a log of attempts. A failed one now says which
door ran, which engine, which provider, how long it took and what class of
error it was. A **successful** one says how many rows landed, how much income
and expense they came to, how many duplicates were skipped and how many photos
were refused — and nothing whatsoever about *which* rows.

That was survivable while an import's rows were where the user expected to find
them. 0070 changes the assumption directly: a date the scan could not vouch for
now lands on today by decision, and a row nobody corrected at the review step is
filed on a day it was not bought. The record says twelve transactions were
created; reaching any of the twelve meant knowing what the merchant was called,
guessing which day it had been filed under, and searching.

The ids were never missing. `confirmImport` awaits `addTransaction`, which
returns the id of the document it wrote, and it discarded every one of them.

## Decision

**A completed import names the transactions it created, and Import History
opens them.**

### The record carries the ids, and only the ids

`ImportHistory.transactionIds?: string[]` — in selected-row order, successes
only, `length === successCount`. It is written only when at least one row
landed, so it is never an empty array, and absent means what absence means
everywhere else in this shape: nobody has anything to say. It is absent on a
record that has not completed, on an import where every row failed, on records
completed before the field existed, and on the `form` and `queue` doors, which
write no success record at all.

Ids and nothing else. The transactions *are* the row data, they are one read
away, and a description or an amount copied onto the history record would be a
second source of truth that goes stale the first time the user edits the row.

Both write sites capture the id: the primary `addTransaction`, and the
photo-less retry that runs when a quota refusal or an upload failure costs the
row its images ([0067](0067-a-photo-is-made-to-fit-and-never-costs-its-transaction.md)'s
rule that a photo never costs its transaction). Capturing only the first would
have put an empty string in the array at exactly the rows most worth reaching —
the ones the user needs to open in order to attach the photo again — while
`length === successCount` went on holding and hiding it.

`completeImport`'s stats parameter widens by one optional, and
`importOptionalsValid` in `firestore.rules` gains `transactionIds is list`.

### One id opens directly, several open from a menu

A record with exactly one id gets a **View transaction** button. A record with
two or more gets a menu, whose entries are **positional** — *Transaction 1*,
*Transaction 2* — because the record stores ids and nothing else, and there is
no description or amount on it to label an entry with. Labelling them properly
would mean either a read per id on a page that subscribes to two hundred
records, or the copy of the row data the section above refuses. A legacy record
gets no control, which is the honest rendering of an absent field.

### Navigation goes through the transactions page's query params

`/transactions?tx=<id>`. There is no `/transactions/:id` route and this record
does not add one: the app's transaction detail *is* the edit dialog, which
opens over the list, and a route for it would need a resolver, a not-found
state and a back behaviour of its own for a view that already exists. `tx`
joins `showAll`, `date` and `action`, the params that page already reads.

The page consumes `tx` **once**: a snapshot read at init, held, and spent after
the *first* window seed in `onFiltersChanged`, cleared before that reset settles
so a filter change fired while it is still pending cannot pick it up again.
`action=add` uses the re-firing `queryParams` subscription; doing the same for
`tx` would reopen the edit dialog behind the user on every later filter change.

What happens when it is spent, in order: `getTransactionById`, which emits
`null` for a document that no longer exists and earns an explicit toast —
an explicit tap on a named target deserves an answer, unlike the silent-skip
precedent that passive lists use; then `isInLoadedRange`, and `jumpTo` when the
target falls outside the loaded window; then `requestScrollTo` for the
highlight; then the edit dialog.

### The alternatives that were rejected

- **An `importId` backlink on every imported transaction.** Write amplification
  on every row, a rules clause, an index for the reverse read, and a field that
  is meaningless on every transaction the user typed by hand. The record already
  knows what it created; the rows do not need to know what created them.
- **A `/transactions/:id` detail route.** See above — a second way to view a
  transaction, for a link that has one destination.
- **Extending success records to the `form` and `queue` doors** so their rows
  could be linked too. That reopens 0065's decision that a successful in-form
  scan's record is the transaction it produced, and would put a second document
  in `imports` behind every scan. Named as a limitation instead.
- **Storing a description or an amount beside each id** so the menu could name
  its entries. A copy of row data that is wrong as soon as the row is edited,
  bought with a bigger record.
- **Writing `[]` on an import where every row failed.** Then `[]` and absent
  both mean "no rows", and every reader has to handle two shapes of nothing.
- **Rendering the menu entries by reading each transaction.** Two hundred
  records on the page, each potentially with a batch behind it; the reads are
  unbounded and almost all of them are for menus nobody opens.

## Consequences

- **The `imports` rules must be deployed** before `transactionIds is list`
  applies in production. `importCreateValid` uses `hasAll`, not `hasOnly`, so an
  undeployed rules file accepts the field unvalidated rather than refusing the
  write — the same quiet failure mode 0065 recorded, and the same reason it is
  called out in the pull request rather than left to the deploy checklist.
- **A history record is no longer a fixed size.** It grows by one id per
  imported row, so a large CSV batch stores a proportionally larger document,
  and the page that subscribes to the newest two hundred records reads them all.
  Firestore's document ceiling is nowhere near a concern at the batch sizes the
  wizard handles, but the record is now data rather than a summary.
- **`getTransactionById` gains its first production caller.** It had none: the
  app reads transactions in windows and lists, never one by id, because until
  now nothing held an id on its own. A document that no longer exists — which
  the method answers with `null` — is therefore a state only this path can
  reach, and the toast for it is new behaviour rather than a reused message.
- **Import History gains a second reason to exist.** 0065 made it a diagnostic
  log; this makes it a way back into the ledger, and the two audiences want
  different things from the same card.

## Things that only became apparent while building

- **The photo-less retry is a second write, not a fallback inside the first.**
  It calls `addTransaction` again and gets its own id back, while
  `successCount` is incremented once for either path — so the id has to be
  captured on both branches. The length invariant is no protection here: it
  holds either way, and an uncaptured retry would sit in the array as an empty
  string precisely on the rows that lost their photos.
- **A one-shot query param and a subscribed one are different features.** The
  page already read `showAll` and `date` from the snapshot and `action` from the
  subscription; `tx` looked like `action` and had to behave like `showAll`,
  because the thing it triggers is a dialog rather than a filter.

## Known gaps

- **The menu entries are positional.** *Transaction 3* is the third row that
  landed, which is the third *selected* row — not the third row in the wizard's
  table if any were deselected, and not the third row of the file if any
  failed. It is exact and it is not descriptive.
- **`jumpTo` honours the active filters.** A target outside the transactions
  page's current date filter is not reachable under the server query, so the
  jump falls back to a plain top-of-list load: the dialog opens on the right
  transaction, and the list behind it does not scroll to it. Clearing the
  filter first is the workaround, and nothing tells the user that.
- **Records written before this field exists have no shortcut**, permanently.
  Nothing backfills them, and nothing could: the ids were never recorded.
- **The `form` and `queue` doors still write no success record**, so nothing
  they create is reachable this way. 0065's limitation, unchanged.
- **A record's ids are not pruned when a transaction is deleted.** The link
  stays, the tap is answered with a toast, and the record keeps counting an id
  that no longer resolves. Cleaning it up would mean a reverse read on every
  transaction deletion, which is the backlink this record rejected.
