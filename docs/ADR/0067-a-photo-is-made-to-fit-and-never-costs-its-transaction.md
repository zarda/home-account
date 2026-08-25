# 67. A receipt photo is made to fit, and never costs its transaction

**Status:** Accepted, implemented · **Date:** 2026-08-25 · **Issues:** #334

Sits under the receipt storage scheme
[0006](0006-multi-image-receipt-storage.md) addressed by slot, and reverses one
half of the trade [0007](0007-transactional-receipt-edits.md) settled for
*edits* — where a failed upload must leave the row untouched — for the *import*
case, where the row does not exist yet. What each door surfaces is in
[../receipt-import.md](../receipt-import.md) under *Failure surfacing*.

## Context

An import read a 27-item receipt correctly, showed it on the review step at
NT$10,503, and then saved nothing: *"Imported 0 of 1 transactions — 1 could not
be saved"*, with `RECEIPT_ATTACH_FAILED` against the row.

The ceiling was enforced twice and met nowhere:

- `MAX_RECEIPT_BYTES` is 2 MB, and `storage.rules` caps `request.resource.size`
  at the same figure. Both were correct and neither was reachable.
- **Nothing in the app ever made an image smaller.** Not the import wizard, not
  share intake, not the form's attach. The camera dialog looked like an
  exception but was only lucky: it captures at `quality: 0.85`, so its photos
  came out small by accident of the capture, not by anyone's decision.
- The import dropzone accepts files up to **10 MB** — five times the ceiling it
  feeds. So a 2–5 MB phone photo passed the picker, was read by the model, and
  died at the upload.

Two decisions then turned a photo problem into a data-loss problem:

- `uploadReceiptBatch` replaced every rejection with the sentinel
  `RECEIPT_ATTACH_FAILED`. The message `uploadReceipt` had raised — *"Receipt
  image exceeds the 2097152 byte limit"*, exact and actionable — reached
  neither the log, the import record nor the user.
- `confirmImport` treated an attach failure as a failed row, deliberately:
  *"retrying photo-less there would silently drop photos on a flaky network"*.
  That reasoning holds for a transient failure. It does not hold for a photo
  that can never be attached at any retry, and the cost of being wrong is the
  transaction.

## Decision

**A photo is made to fit before it is sent.** `prepareReceiptImage` returns a
file that already fits untouched — most receipts are small, and re-encoding
them would spend quality for nothing — and otherwise redraws it at
`MAX_RECEIPT_EDGE` (2000px) on its longest edge, stepping JPEG quality
`0.85 → 0.7 → 0.55 → 0.4` and stopping at the first that fits. A photo that
only just overshoots is not compressed to the floor.

**It runs at the upload, not at each door.** Every door ends up in
`StorageService.uploadReceipt`: the form's attach, the wizard's confirm, the
camera dialog, the queue drain. A door added tomorrow cannot forget a step it
does not know about, which is the same reasoning
[0059](0059-one-mapper-builds-every-imported-transaction.md) applies to the
import mapper. The size guard stays underneath as the last line of defence.

**The reader still gets the original bytes.** Small print is exactly what a
downscale destroys, and reading the receipt correctly is the whole point of the
feature. Compression applies to the copy that is *stored*, where the bar is
legibility to a human at full zoom.

**A photo never costs its transaction.** An import whose photo cannot be
attached saves the row without it and reports how many photos that happened to,
counted apart from the quota skip that already worked this way. The transaction
is the record; the photo is evidence attached to it, and it can be attached
again from the row afterwards.

**The sentinel keeps its cause.** `RECEIPT_ATTACH_FAILED` stays the contract
every caller matches on, and the underlying rejection now rides on the error's
`cause` and is logged once.

## Consequences

- A 4 MB photo now stores as a few hundred kilobytes, so the storage bill and
  the download time for a receipt thumbnail fall with it.
- An image the browser cannot decode — an HEIC where nothing can read one — is
  refused by name (`RECEIPT_IMAGE_UNREADABLE`) rather than as an unexplained
  failure, and the row still saves.
- `receiptsSkipped` and `receiptsFailed` are two figures, not one. Merging them
  would report a plan limit and an upload failure as the same thing, and they
  ask different things of the user.
- Both counters are now type-checked in `firestore.rules`, which had validated
  neither. The check needs the usual post-merge deploy; until then the rules
  accept them unchecked, since the imports rules use an open key set.

## Things that only became apparent while building

- **The camera door's safety was accidental.** Reading `quality: 0.85` in
  `camera-capture.component.ts` explains why this bug looked like an
  import-only problem for as long as it did: the door most people use most
  often happened not to trip it.
- **The two existing unit tests for the size guard passed fakes.**
  `{ size, type, name } as File` cannot be decoded, so they had to be rewritten
  around what is still refused — an oversized file nothing can read — and the
  success path moved to the emulator smoke suite, where a real 4 MB image is
  compressed and lands under the real rule.

## Known gaps

- **The dropzone still accepts 10 MB.** After compression that is harmless, but
  the two numbers are set independently and nothing ties them together.
- **The model still receives the original.** That is deliberate for accuracy,
  and it means a large photo is still a large upload to the provider and still
  costs the time it costs.
- **Nothing re-attaches automatically.** A row saved photo-less says so, and
  the user re-attaches from the transaction by hand.
