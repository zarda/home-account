# 120. A partial import keeps every row it did not write

**Status:** Accepted, implemented · **Date:** 2026-09-11 · **Issues:** #415

Reference documentation lives in [../receipt-import.md](../receipt-import.md).

Extends [0115](0115-a-failed-row-is-named-by-its-id.md) and closes the gap it
filed: "A partial import drops the rows the reviewer had deselected."

## Context

When a confirm saves some rows and a Firestore rule or a zero-amount summary
line refuses others, the wizard returns to the review step and rebuilds the
list. 0115 made that rebuild trustworthy in one respect — the record names
its failed rows by **id**, so the rows offered back are the rows that
actually failed rather than a position in a subset nobody is looking at.

It rebuilt from those ids and nothing else:

```ts
const failedRows = this.extractedTransactions()
  .filter(t => failedIds.has(t.id))
  .map(t => ({ ...t, selected: true, isDuplicate: false }));
this.extractedTransactions.set(failedRows);
```

A row the reviewer had unticked is in neither set. It was never submitted,
so the record does not name it; it was not saved, so removing it saves
nothing from a double import. It simply left, together with the rows that
had been written, while the toast read *Imported 2 of 3 transactions — 1
could not be saved* — a sentence in which the vanished row does not appear
at all. The only way back to it was the file.

What made it worth a record rather than a one-line fix is that the drop was
written down as deliberate in three places, each of which this record
reverses:

- the partial branch's own comment — "the rows the reviewer deselected,
  which were never submitted, go with them: the list is rebuilt from the
  failed ids alone and holds nothing else";
- 0115's known gap, which named it, called it pre-existing and put it out of
  scope;
- [../receipt-import.md](../receipt-import.md)'s *Failure surfacing*
  paragraph — "A partial save keeps exactly the failed rows on the review
  step".

And a fourth place pinned it: the emulator case's own context line read
"exactly the refused row is back, ticked for a second try", over a fixture
built with a deselected row in it.

## Decision

**Only the rows the write actually saved leave the review step.**

```ts
const kept = this.extractedTransactions()
  .filter(t => failedIds.has(t.id) || !t.selected)
  .map(t => (failedIds.has(t.id) ? { ...t, selected: true, isDuplicate: false } : t));
```

Three outcomes, three fates:

- **Saved.** The row goes. A second confirm must not write it again, and the
  record holds its id.
- **Failed.** The row comes back **ticked**, with its duplicate mark
  cleared, because it is being offered for a second try — it was already
  submitted once, so a duplicate flag that held it back is spent.
- **Deselected.** The row stays exactly as it was: unticked, its duplicate
  mark intact, its own duplicate check intact. The reviewer decided it was
  not going in, and nothing here has happened to change that.

`keepReceiptRows`, `duplicateChecks` and `selectedTransactionIds` are all
derived from the same kept set, so a deselected row's receipt-row membership
and its duplicate verdict survive with it, and a failed row's verdict is
dropped with its mark. The list keeps its original row order, because the
filter does.

### The alternatives that were rejected

- **The old rule — keep only the failed rows.** It treats "not written" as
  one thing when it is two, and the half it discards is the half the
  reviewer made a decision about.
- **Bringing the deselected rows back ticked.** It would make them visible
  again, which is the point, and it would silently overturn the only
  decision the reviewer had actually recorded about them. A row the reviewer
  unticked and a row the write refused are not in the same state and should
  not come back in the same state.
- **Leaving them out and saying so in the toast.** A message about rows the
  reviewer can no longer see is a worse answer than the rows.

## Consequences

- **`duplicateChecks` is no longer emptied.** It is filtered to the kept
  ids, minus the failed ones. That is the behaviour that surfaced this
  record's one surprise (below).
- **The toast still counts the submitted subset.** *Imported {{success}} of
  {{total}}* is `successCount + errorCount`, which is what was sent — so the
  step can now hold more rows than the sentence mentions. That is correct
  and it is not obvious: the sentence is about the write, and the step is
  about the batch.
- **A second confirm sends the ticked rows only**, which after a partial is
  the failed set — exactly what the old rule achieved by deleting everything
  else.

## Things that only became apparent while building

- **The duplicate check on a deselected row is real data, not residue.**
  `processFiles` stamps a `DuplicateCheck` on **every** row, not only on
  matches, so the deselected row carries its own verdict — *no match* — and
  keeping it is the same "as it was" guarantee the rest of the row gets. The
  emulator case had been asserting `duplicateChecks()` is `[]` after a
  partial, which was true only because the old branch threw the whole list
  away; it now asserts the one surviving record. The assertion was found by
  the emulator run rather than by reading, because the unit fixtures seed
  their checks by hand and the real detection pass is what stamps the
  non-matching rows.
- **Clearing the mark and clearing the check are two different lines.** A
  failed row comes back with `isDuplicate: false` and with its check
  removed; forget the second and the card re-derives the badge from the
  check, and the row is offered back wearing the mark that may be why it was
  refused.

## Known gaps

- **Nothing on the step says which rows failed.** A failed row is ticked and
  a deselected one is not, and that is the whole of the distinction on
  screen; the reason a row was refused lives in the record's `errors` and is
  rendered nowhere. 0115 named the rows by id so the wizard could find them,
  not so a reviewer could read them.
- **A row that fails twice is re-offered twice, identically.** There is no
  attempt count on a row and no ceiling, so a row a rule will always refuse
  can be confirmed again indefinitely.
- **0115's own first gap stands, narrowed.** A record written before the
  failed rows were named by id still re-offers none of them; what the step
  now holds in that case is the deselected rows alone, which is better than
  the empty step 0115 described and is still not the failed ones. Only
  reachable by replaying an old record through a running wizard, which
  nothing does.
