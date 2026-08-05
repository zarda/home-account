# 14. A reclaimed receipt replays onto the ids it already used

**Status:** Accepted, implemented · **Date:** 2026-08-05 · **Issues:** #205

Reference documentation lives in [../receipt-import.md](../receipt-import.md).
This record keeps the decision and the reasoning.

## Context

A receipt photographed offline is stored in a device-global IndexedDB queue, one
row per image, each stamped with the account that captured it. Connectivity is
the whole condition on the multi-photo capture path, which queues before it asks
which engine could run; the import wizard's file path queues only when it is
offline *and* no engine can run at all. Those are the two producers — the
in-form scan keeps its image on the form instead. When the connection comes back,
`syncQueue` walks the rows it owns, marks each one `processing`, and dispatches
a DOM event. That is the whole handoff: the processor's listener `void`s the
work, so the queue cannot await it and the row's real outcome is written later,
by the processor, from the other side of an AI call and a set of ledger writes.

Two lines hold the whole problem, and they still do:

```ts
const landed = await this.createTransactions(id, result.transactions);
await this.queue.updateImageStatus(id, 'completed');
```

Between them the work has landed and the queue still says `processing`. Before
#169 a row stranded there was invisible to every getter, counter and retry — the
receipt was silently lost while its bytes stayed in IndexedDB. #169 added a
reclaim sweep that hands anything wearing `processing` back as `pending` at the
cost of one retry, on the grounds that a rare duplicate beats a guaranteed loss.

That trade was the right one, and this is the bill for it. **The row the sweep
most often hands back is one whose transactions already landed**, because the gap
between the writes and the status flip is precisely where a background sync gets
killed: an iOS WebView reclaimed in the background, a tab closed, an app swiped
away. The replay then re-read the image and posted every row a second time, at
fresh auto-ids, because `addTransaction` with no caller-supplied id calls
`addDocument`. The user was left with each row of the receipt twice and no way to
tell which copy came from which pass.

Nothing downstream caught it. The duplicate detection that the import wizard runs
belongs to the attended path; the drain does not go near it.

The partial-batch policy was shaped by the same defect. When one row of a receipt
failed to write, the processor completed the image anyway and reported the rows
that had landed — which reports success for a receipt that is missing rows and
then drops them. It was defensible only because the alternative was worse: a
retry re-ran the image from the top and duplicated everything that had already
landed. The policy was a symptom, not a decision.

## Decision

### Every row is written at an id derived from the queue row and its position

Each row of a receipt is posted at `${queue row id}-${index}` instead of at a
fresh auto-id. Both halves survive the crash. The queue row id is the IndexedDB
key the image itself is stored under, so it is still there when the sweep hands
the row back; the index is where the row sat in what the model read. A receipt
that is reclaimed and drained again therefore aims at exactly the documents the
first pass wrote.

The mechanism already existed. `addTransaction` accepts `options.id` and writes
it through `setDocument` — the same idempotency the recurring engine gets from
`rec-<rule>-<time>`. Nothing new had to be built on the write path.

### An id that already holds a document is skipped, not rewritten

Deterministic ids alone would make the replay an overwrite. That is idempotent in
the ledger's *shape* and not in its *content*: `setDocument` defaults to
`merge = false`, so re-posting is a full replace that resets `createdAt` and
discards any edit the user made to the row between the two passes. A receipt
drained on Monday, corrected on Tuesday, and replayed on Wednesday would come
back as the model first read it, silently.

So each id is checked before it is used, with a one-shot read —
`TransactionService.hasTransaction`, added here for the class of caller that
writes at a deterministic id and needs to know whether an earlier attempt
already landed. `getTransactionById` cannot serve that: it opens a subscription,
and this caller has nothing to keep one alive for. An id that already holds a
document is left alone and counted as landed.

Counting it matters. The number in the toast is what the receipt produced, not a
tally of this pass's writes, so a user who never saw the first drain's toast is
still told what arrived. Two specs pin the two shapes: *skips a row that already
landed instead of posting it twice* and *completes without a second write when
every row already landed*.

### A partial batch fails, and fails after trying every row

With the skip in place, a retry writes only the remainder — so the reason for
completing a partial batch is gone and the policy flips to the honest one. A row
that could not be written records its error and the loop continues; after the
last row, the first error is thrown, which fails the image and returns it to the
queue's bounded retries. Failing early would abandon rows that would have
written fine.

### The queue service is not touched

This is a design point, not an accident. `reclaimInterruptedWork`, the retry
budget, the row id format, the ownership filters — none of them change. The fix
lives entirely in the processor and in `TransactionService`, which means the
sweep's behaviour and its charged retry stay exactly as #169 left them, and the
guarantee rests on the queue row id being stable rather than on the queue
learning anything new.

### Groundwork: an id and receipt files can no longer be combined

`addTransaction`'s receipts branch has to pre-generate an id so the uploaded
storage objects and the Firestore document share one key, and that branch simply
ran first — a caller who also passed `options.id` had it dropped on the floor
with no error and no log. That is the same shape of failure as the defect itself:
an idempotency key that is accepted and then ignored is worse than one that is
refused, because the caller believes it is protected. The combination now throws
before any upload starts. No caller wants both.

## Rejected alternatives

**Deterministic ids with no existence check** — the blind overwrite. One
document per row, which is the count the issue asks for, and the wrong content:
every replay resets `createdAt` and throws away edits, on rows the user may have
been working with for days. It is also invisible when it happens. The check costs
one read per row; discarding a user's correction costs their trust in the ledger.

**Recording the written ids back onto the queue row.** The replay could then skip
what landed without re-reading the image, saving one AI call. It costs a new
field on `QueuedImage`, a new queue method to write it, and a wider write path
through a service this change otherwise leaves alone — and it does not stand on
its own: a crash *during* the writes leaves rows written and the record of them
unwritten, so deterministic ids are still needed underneath. Deterministic ids
alone cover both cases, so the extra field would buy only the saved call.

**Persisting the model's output alongside the queued image.** This is the
strongest version: the replay posts exactly what the first pass read, so it costs
no AI call and the second-read nondeterminism in *Known gaps* below disappears
entirely. It is the direction to take if the replay's cost ever starts to matter.
It was not taken for this defect, because it puts a second copy of the receipt's
contents into IndexedDB — with its own lifetime, its own clearing rules, and its
own place in every conversation about what the queue stores — to fix a crash
window that costs one AI call when it is hit.

**Duplicate detection, as the attended import path does it.** The wizard compares
candidate rows against the ledger by similarity — date, amount, description — and
that is the right key there, because a human is looking at the answer and can
overrule it. An unattended drain has nobody to overrule anything, and similarity
cannot tell a replayed row from a second identical coffee bought at the same shop
on the same day. The drain's question is not "does this look like something I
already have" but "have I already written this row". That is identity, and a
deterministic id answers it exactly.

## Consequences

**The partial-batch flip is user-visible.** An image whose rows only partly
landed is now marked `failed` instead of `completed`: it consumes one of its
three retries and shows no success toast for that pass, and once the three are
gone it is no longer dispatched and simply sits in the queue as a failed item
waiting to be cleared. The spec that pinned the old behaviour was renamed
rather than deleted, and now reads *fails a partial batch so the queue can retry
the rows that did not land* — the previous name, *completes on a partial batch so
a retry cannot duplicate the rows that landed*, is a fair summary of why the old
policy existed and why it no longer applies.

**The toast repeats on a full replay.** A receipt whose rows all landed before
the crash writes nothing on the replay and still reports its full count, so the
user can see "3 transactions imported" twice for one receipt. The alternative —
reporting zero, or staying silent — reads as a receipt that produced nothing,
which is worse than a repeat.

**Budget recompute fires only for real writes.** `updateAffectedBudgets` runs
inside `addTransaction`, so a skipped row does not re-trigger it; a full replay
touches no budgets at all.

**No rules change was needed.** A replayed write lands on a document that already
exists, so Firestore evaluates `txUpdateValid` rather than `txCreateValid`. The
processor writes a complete transaction with `userId` unchanged, which satisfies
the update branch's per-field checks and `ownerKept`. With the skip in place it
rarely reaches a write at all.

## Departures from the issue

**The queued-transaction acceptance criterion is moot.** #205 asks that "the
queued-transaction path is covered by the same guarantee". That path no longer
exists: `queueTransaction` had no caller in the shipped app and was removed on
main in `0c52736`, taking the `pending-transactions` store with it at schema v3.
There is nothing left to cover, and the criterion is satisfied by its absence.

**Neither of the two shapes the issue sketched was taken.** It offered accepting
an unstable row count and keying only the first row, or recording the posted ids
on the queue row. Every row gets a deterministic id instead, and the existence
check is what makes an unstable count survivable — a short second read leaves
residue rather than duplicating the receipt, which is the failure mode worth
choosing.

## Known gaps

**The existence check can be answered from the offline cache.** `hasTransaction`
is a plain `getDoc`, and the app initializes Firestore with a persistent local
cache. A read that cannot reach the server is served from that cache, and a cache
that has never seen the document reports it absent. The replay then writes the
same id with `merge = false` — resetting `createdAt`, discarding edits — which is
the exact outcome the skip exists to prevent. It is bounded: the drain runs on a
reconnect or a background-sync wake-up, where a server read is the normal case,
and a stale answer costs a rewrite rather than a duplicate. But it is the one
hole in the guarantee as stated, and nothing in the drain forces the read to the
server.

**The drain now performs a read per row that it never performed before.** A
failed read fails the whole image exactly as a failed write does, and consumes
one of the three retries. Inside the per-row loop a write was previously the
only thing that could fail an image — the other failure modes, a missing file,
a throwing AI call, a reading with no rows in it, all sit above the loop — and
now the read in front of each write can fail it too, on the one path where
transient failures are exactly what to expect: a just-restored connection.

**A second read is not guaranteed to match the first.** The replay pays another
AI call, and nothing makes the model read the same photo the same way twice. A
second read that produces fewer rows than the first leaves the surplus rows of
the first pass in the ledger as residue: real transactions, at ids nothing will
visit again. Closing that means comparing against what was written rather than
against a position — which is the persisted-payload direction above. A stranded
receipt now costs at worst some leftovers instead of a guaranteed duplicate of
everything, and that was the trade this defect was worth.

**Check-then-write is not atomic.** Two drains of the same row can both read
"absent" and both write. The count is still right — they write the same id, so
the ledger holds one document rather than two, which is the whole point — but the
loser's write is still a full replace on top of the winner's. The race is not new
(`syncInProgress` is per-instance, so two tabs coming online together already
raced), and its consequence is now a rewritten `createdAt` instead of a doubled
receipt.

**The id format is a coupling that nothing enforces.** The processor builds its
ids from a queue row id whose format the queue service owns, and the two are
joined by a comment rather than by a shared constant. Changing how queue rows are
keyed, or reusing a key, silently changes which document a replay aims at.
Nothing would fail to compile.

**`updateImageStatus` can no-op while a row still reads `processing`.** It
opens with `if (!this.db) return`, and the multi-tab `blocking` handler —
which fires when another tab is waiting to open a newer schema version —
closes the connection and sets `this.db` to `null` before this tab's own
work is done. A processor mid-image when that happens still posts its
transactions and still calls `updateImageStatus(id, 'completed')`, but the
call now lands on a null handle and returns having done nothing: no throw,
nothing logged, the row simply keeps whatever status `syncQueue` last wrote.
The next open's reclaim sweep cannot tell that apart from a killed tab — it
hands the row back as `pending` and the drain replays it, which the
skip-on-exists check above now makes benign instead of a second write onto
rows that already landed.
