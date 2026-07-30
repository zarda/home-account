# 7. Receipt slot edits commit through Firestore transactions, storage deletes stay first

**Status:** Accepted, implemented · **Date:** 2026-07-30 · **Issues:** #138

## Context

ADR 0006 recorded its own gap: concurrent edits of `receiptUrls` from two
devices were last-write-wins. Every mutation read the document, computed a new
positional array, and wrote it back blind — so the later write clobbered the
earlier one, resurrecting tombstones or dropping fresh appends, and the losing
side's storage objects could end up referenced by nothing or referenced but
deleted. `arrayUnion`/`arrayRemove` cannot express positional tombstones, so
the fix has to serialize the read-modify-write itself.

Two things constrain the design. Storage operations cannot participate in a
Firestore transaction, so every protocol has a window where the document and
the objects disagree; the choice is only *which* window. And the append slot
is derived from the array length, but the upload must happen before the
transaction — a transaction cannot wait on Storage — so the slot choice is
inherently optimistic.

## Decision

**Every receipt read-modify-write commits through `runTransaction`.**
`removeReceiptAt`, `removeAllReceipts` and the append branch of
`updateTransaction` re-read the document inside the transaction and compute
the new array from that fresh snapshot, never from the earlier optimistic
read. Two interleaved removals of different slots now both land; neither can
resurrect the other's image. The transactional payloads stamp `updatedAt`
themselves, because `tx.update` bypasses the wrapper that injects it. The
local quota deltas (`noteImagesAdded`/`noteImagesRemoved`) moved after the
commit and reflect what the transaction actually changed — a removal whose
slot a rival already emptied decrements nothing.

**Storage deletes stay *before* the commit — the issue's sketch of
commit-first reconciliation was rejected.** The truncation invariant from ADR
0006 ("a truncated slot is safe to append into because its object is
confirmed gone") only holds in that order. Committing the tombstone first
would let the remover's late storage delete land *after* a racing append
reused the truncated slot, silently and permanently destroying the appender's
committed image — the exact failure the guard exists to prevent. Delete-first
keeps the residual on the other side: if the storage delete lands and the
commit then fails, the array still references a gone object, which is
*visible* (a broken image) and self-heals, since retrying the removal treats
object-not-found as success.

**Appends place optimistically uploaded objects inside the transaction, with
a bounded retry.** The files upload at slots chosen from the last read
(`length` of the slot array); the transaction then re-reads and places the
URLs only if no live entry occupies those indices, padding with tombstones
when a racing removal truncated the array underneath the upload, and
re-checking the five-image cap against fresh state. If a rival append won the
indices, the whole cycle retries at fresh slots, three attempts total. A
contested slot is never swept — its key is the winner's committed image. On
exhaustion, or when the document vanished mid-append, the uploads that no
committed entry references are swept best-effort and the attach fails whole,
same contract as a failed batch. Rejected: reserving slots with a pre-commit
marker write — it would put non-URL strings into an array the UI renders and
`firestore.rules` constrains, for a race that retry already covers.

**`removeAllReceipts` removes what existed when it was invoked.** The sweep
covers only the slot span seen at read time — an appender always targets
slots at or past that length, so the sweep cannot hit a racing append's fresh
object — and entries a rival appended beyond the span survive the clear.
Rejected: clearing everything on fresh state, which would either orphan the
racer's objects or require sweeping slots the pre-read never saw.

## Departures from the issue

The issue proposed committing the array first and "reconciling storage
objects against the committed array". Building it showed that ordering
violates the issue's own acceptance criterion (an append racing a removal
must never produce an entry whose object is missing), so the delete-first
ordering was kept and the transaction wrapped around the document write only.

## Known gaps

- Two devices that append simultaneously can pick the same optimistic slot
  and upload to the same storage key; the loser's bytes overwrite the
  winner's, and the overwrite regenerates the download token, so the winner's
  committed URL can go stale. The transaction keeps the array, count and
  pointer consistent, and the loser retries to fresh slots — the residual is
  byte-level, confined to simultaneous appends to one transaction. Closing it
  needs slot reservation, rejected above as overkill.
- Failed sweeps can leave unreferenced objects at slots past the array
  length. They are invisible, cost only storage, and any later append to the
  slot overwrites them; a real reconciler belongs to the server-side quota
  work (#137), which nothing here precludes.
- Receipt edits now require the network to commit (`runTransaction` rejects
  offline). In practice they already did — every path deletes or uploads a
  storage object first, and Storage has no offline queue.
