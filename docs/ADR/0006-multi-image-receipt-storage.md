# 6. Receipt images are addressed by slot, and removal tombstones instead of renaming

**Status:** Accepted, implemented · **Date:** 2026-07-29 · **Issues:** #59

## Context

A transaction stored exactly one receipt image, at a Storage key equal to the
transaction id, referenced by a single `receiptUrl` string. Holding several
images forces three linked choices: how the extra objects are keyed, how the
document references them, and what removal does to the survivors. All three
are persisted shapes — every stored object and every written document commits
to them — which is what makes the choice expensive to reverse.

Two constraints were fixed before the design started:

- `storage.rules` matches `users/{userId}/receipts/{fileName}` — one path
  segment. A nested `{transactionId}/{n}` scheme falls through to the
  deny-all rule.
- The image quota counts by querying `receiptUrl > ''`. A Firestore range
  filter only matches values of the operand's type, so if that field ever
  held an array, every multi-image row would silently drop out of the count
  and the limit would never trigger. (The comment that predated this work
  claimed the opposite failure — arrays ordering after strings would
  over-match — but the emulator shows the filter simply skips array-valued
  rows. The conclusion is unchanged either way: the counted field must stay
  a single-typed string. The receipts smoke suite pins the verified
  behaviour.)

## Decision

**Slot-addressed objects, slot 0 unsuffixed.** Image *n* lives at
`{transactionId}` for slot 0 and `{transactionId}_{n}` beyond. Every object
uploaded before this work keeps resolving at its original key — no migration,
no dual-path fallback read. The suffix cannot alias another transaction's
slot 0 because no transaction id contains an underscore: Firestore auto-ids
draw from `[A-Za-z0-9]`, and the recurring engine's deterministic ids are
hyphen-separated. Rejected: uniform `_0.._n` naming, which is prettier but
breaks every existing object's address and the id-derived download used by
receipt-to-note, for zero functional gain.

**A positional array, dual-written pointer.** The document carries
`receiptUrls`, where the entry at index *n* is the URL of the object at slot
*n*, and `receiptUrl` is dual-written from the first live entry so the quota
query and every single-image read site keep working. `receiptCount` stays as
the denormalized count; readers go through `receiptImageCount()`, which
prefers the array because every reader that has the count already has the
whole document, so array-first closes the drift window for free.

**Removal tombstones; nothing is ever renamed.** Removing the image at slot
*n* deletes its object and writes `''` at index *n*; trailing tombstones are
truncated; when the last image goes, all three fields are deleted. The
invariant this buys is *array index = storage slot, always*: the append slot
is `receiptUrls.length`, bulk cleanup is a gap-tolerant sweep over
`0..length-1`, and a failed batch rolls back exactly the slots it used.
Rejected alternatives:

- *Re-indexing on removal* — the Storage client SDK has no server-side copy,
  so a "move" is download + re-upload + delete: megabytes of mobile traffic
  per removal, non-atomic, and removing slot 0 would rewrite the legacy
  unsuffixed key everything else relies on.
- *Letting the array close up* — divorces index from suffix, so a storage
  key can no longer be derived from a position; every consumer would need a
  URL parser or a persisted next-slot counter.

The cost, stated plainly: `receiptUrls.length` is not the image count and
`receiptUrls[0]` is not necessarily the first image. `receiptImageUrls()`,
`receiptImageCount()` and `firstReceiptSlot()` are the only sanctioned
readers.

**Batches are all-or-nothing.** If any upload in a batch fails, the slots
that landed are deleted best-effort and nothing reaches the document. Because
the document never referenced the attempted slots, a retry overwrites the
same unreferenced slots — even a rollback whose deletes fail leaves no
permanent orphan. A committed partial was rejected because the dominant
failures (size guard, rules rejection) fail identically on retry, and a
success-looking row with a silently truncated image set buries the error.

**Server-side hardening rides along.** `firestore.rules` caps `receiptUrls`
at five entries (the client cap becomes an invariant a raw SDK write cannot
walk past), and constrains `receiptUrl` to an `http(s)` URL under 2048
characters — `http` stays allowed because the storage emulator issues
`http://127.0.0.1:9199` URLs and the same rules file runs against it.

## Consequences

- Attaching in edit mode now *appends*; replacing is remove-then-attach.
  This deliberately changes the single-image behaviour that shipped days
  earlier (a re-scan used to overwrite the stored image in place) and costs
  a quota slot, which the UI copy owns up to ("Add another image").
- Conversion to note is slot-aware, so any image of a multi-image
  transaction can be converted, not just the first.
- The quota reads the array where present but still filters on `receiptUrl`;
  clearing the last image must write `deleteField()`, never an empty array
  or empty string, or the row lingers with unreadable receipt fields.

## Known gaps

- Concurrent edits of `receiptUrls` from two devices are last-write-wins.
  `arrayUnion` cannot express positional tombstones, so making this safe
  needs a Firestore transaction around the read-modify-write. The
  single-image path had the identical exposure; the array makes it more
  visible, not worse. *Closed by [0007](0007-transactional-receipt-edits.md).*
- The image quota itself remains client-side enforcement only; the rules
  validate shape, not count-across-documents. Enforcing it server-side means
  App Check plus a function that owns the count.
