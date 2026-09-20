# 142. A queued receipt lands whole or says what it dropped

**Status:** Accepted, implemented · **Date:** 2026-09-20 · **Issues:** #431

Reference documentation lives in [../receipt-import.md](../receipt-import.md).

## Context

A receipt photographed offline is the one import that cannot be repeated —
the paper is in a bin by the time the connection comes back. Five things sat
between a queued image and a transaction that looks like every other one, and
four of them were already written down as somebody's known gap.

**The photo could not travel, because the slot key and the caller's id were
the same string and nothing said so.** The drain writes each row of a receipt
at `${queue row id}-${index}`, the deterministic id
[0015](0015-reclaimed-receipts-replay-idempotently.md) gave it so a reclaimed
receipt replays onto the documents the first pass wrote. `addTransaction`'s
receipts branch pre-generated an id of its own to key the uploaded storage
objects with, and 0015 made the combination throw rather than let a caller's
idempotency key be dropped on the floor.
[0060](0060-a-confirmed-import-keeps-its-photos-and-names-its-source.md)
records that refusal again, as the reason the confirm step must never adopt
an idempotency id while attaching photos, and its Known gaps file the offline
queue as "a separate door" whose photos are their own question. So the one
import door whose entire reason for existing is a photograph was the one door
that wrote none.

**One unreadable figure failed a whole image.**
[0117](0117-every-doors-figure-is-whole-in-its-currency.md) made every door's
figure whole in its currency and named exactly what that does here: a queued
reading below its currency's minor unit rounds to 0 in
`toCreateTransactionDTO`, and `TransactionService.addTransaction` refuses it
with `INVALID_AMOUNT_ERROR`. The drain finished the batch and then threw the
first error, which marks the image `failed` — the right answer for a write
the network lost, and the wrong one for a figure the ledger will refuse
identically forever. The image went back through the queue's three retries,
paying a fresh reading of the photo each time, while the rows beside the
refused one stayed out of the ledger until the retries ran out. 0117 filed it
as "a loud failure on a path with no reviewer, almost certainly right, and
untested".

**A replaced session waited for a connectivity flip.**
[0052](0052-a-profile-read-may-only-write-to-the-session-that-started-it.md)
stops a profile read from writing into a session that replaced the one it
started for, and its first Known gap is the hole that leaves behind. The
mutex the retry effect holds, `profileRetryInFlight`, is a plain field
released in a `finally`, so releasing it re-runs nothing; the effect's real
inputs — online, degraded, the Firebase user — had not moved. The new session
sat on a fallback profile until connectivity next flipped.

**A closed database swallowed the writes that report.** When another tab opens
a newer schema version, the `blocking` handler closes this tab's handle and
nulls it, and this tab cannot reopen at the old version. `updateImageStatus`
opened with `if (!this.db) return` — 0015's last Known gap — so a drain that
had just written a receipt's rows recorded nothing, returned `void`, and was
indistinguishable from success to its caller. Nothing on screen said the queue
had stopped answering, and the AI settings page went on offering **Sync now**.

**A merge lost the source receipt's identity.** `mergeImportRows` keeps the
target's id and its `receiptId`
([0106](0106-the-review-step-splits-a-row-and-merges-two.md)) and unions the
two sides' photos, so the source receipt's group id does not survive the
spread. A third row still sitting on the source receipt therefore read to
`planReceiptAttachments` as an unrelated receipt, and uploaded a second copy
of a photo the merged row already carried — a second storage object and a
second slot against the receipt quota for one picture. 0106 recorded it as a
Known gap.

**And nothing but the camera could put an image in the queue.** The five above
are what stands between a queued image and an ordinary transaction; the
wizard's image doors produced no queued image at all. Neither multi-image door
had an offline branch: one went from "no cloud provider configured" straight
to a provider error, the other straight into a request that could not be sent.
The one door that did queue — the single-image door, which the wizard never
uses — is reachable only through the file-type dispatcher.
`receipt-attempt.service.ts` carried the symptom in a comment: no door raises
the queued sentinel today, the translation kept at the chokepoint for the day
one does. So a receipt photographed in a shop with no signal failed as though
a key were missing, the paper was in a bin by the time the message was read,
and everything this record decides about the drain was reachable from the
camera dialog alone — not from the door where a receipt across several pages
is the ordinary case.

## Decision

**A queued receipt is written with its photo, at the id it will replay onto;
what cannot land is counted rather than retried forever; and a write that was
dropped says so.**

### Every image door asks one gate first

`holdOrRefuse(files, { nativeReads, queues })` is the first thing all three
image doors do, ahead of the configured-key guard and ahead of the analytics
tag: a configured key says nothing about a connection reaching it, and a
capture that was kept must never be counted as an assist that was never
issued. Online, nothing is stored — the queue is for work with no way out,
not for a device that simply has no reader configured.

The two flags are the door's own answers, because the device's answer is the
wrong one for two of the three doors.

**The on-device reader is credited only where it is reached.** `canUseNative`
is a platform check — this is an iPhone — and not a reader anybody called, so
only the single-image door, which runs through the strategy service, passes
`nativeReads: true`. Crediting the cloud-only multi-image doors with it would
have made the whole offline branch dead on iOS, which is exactly where a
receipt is photographed with no connectivity: the gate would have returned,
and the door would have walked on into a cloud request with nowhere to go.

**The receipt doors queue.** Every file in the batch is attempted — stopping
at the first rejection would leave the rest of a capture neither stored nor
mentioned — and the queued sentinel tells the wizard the capture is kept
rather than lost. The step's card then names how many images were kept, in the
counting message the camera dialog already uses; a mixed batch still imports
the CSV or JSON rows picked alongside the photos; and the queued files leave
the selection, so neither Back nor a second Process can store them twice. The
queue keys nothing on a photo's content, and two rows for one capture are two
transactions once the drain runs.

**The statement door refuses instead.** It answers `queues: false` and raises
the cloud-unavailable code. The drain runs every stored image through the
receipt path, whose whole purpose is merging the line items of one purchase; a
statement page put through it comes back as one lumped row of unrelated
charges, written to the ledger unreviewed, which is the shape the statement
door exists to avoid. The form's multi-receipt re-read answers `false` too,
for the other reason on the same question: its caller already holds the rows
that photo produced, and a stored copy would write them a second time when
the connection returns.

**A refused queue write is its own outcome, not a generic failure**, and a
capture kept in part is a third. The door raises `AI_QUEUE_WRITE_FAILED` when
it stored none of the batch and `AI_QUEUE_WRITE_PARTIAL` when it stored some
of it, rather than the queued sentinel. The two need opposite advice, which
is why they are separate codes: nothing was kept for the first, so the files
are still selected and a second attempt costs nothing; for the second the
queue keys nothing on a photo's content, so a second attempt would store the
kept pages again and the drain would write their rows twice — which is also
why the wizard takes those photos out of the picker, and why neither class is
retryable.

### The slot key is the id the caller chose

`addTransaction` no longer refuses receipt files beside `options.id`. The
receipts branch takes `options?.id` when there is one and generates a key only
when there is not: the storage object's path is built from that id either way,
so a caller-chosen id is as good a slot key as a generated one. The upload
still precedes the document write, so a drain interrupted between them leaves
bytes in the slot the replay will write into, and the replay re-uploads the
identical bytes there rather than opening a second object.

The refusal narrows rather than disappearing: **a merge write cannot be
combined with receipt files**. That is the restore's write, and only the
restore's — it carries the `receiptUrls` a backup file held, never files, and
pairs them with `merge: true` so a live row keeps what the file could not. An
upload under a merge would re-point `receiptUrl` and `receiptUrls` at slot 0
over whatever keys the stored document already had. The old refusal caught
that case by accident, on its way to catching the one that mattered.

### A refusal the reader owns is counted, not retried

The per-row catch sorts failures by whether another pass could change the
answer. A transient failure — the network, a contended write — still fails the
whole image, which sends it back through the queue's bounded retries; 0015's
existence check means that retry writes only the remainder. A refusal the
ledger will repeat forever is counted and stepped over: today that is
`INVALID_AMOUNT_ERROR`, the guard that meets a figure which rounded to nothing
in its currency. Failing the image for it only keeps the rows beside it out of
the ledger too, receipt after receipt, until the retries are gone.

Two guards keep that from becoming a quiet loss. An image where *nothing*
landed throws the first refusal after all, so a receipt that produced no
transaction is never reported as done. And one notice per drain says what
happened: `settings.transactionsImported` when nothing was skipped, and
`settings.transactionsImportedPartial` — *"{{count}} transactions imported,
{{skipped}} skipped"* — when something was. One snackbar either way, because
this fires unattended: a second toast for the losses would arrive with nothing
to click and no way to tell which receipt it belonged to.

### The photo carries forward

The drain plans the attachment over the rows it is about to write, through
`planReceiptAttachments` — the same planner the wizard's confirm step calls,
so two rows read off one receipt do not each upload the same picture. The
planner reads a row's `imageMetadata`, which on this door is built by
`imageMetadataOf` in `import-dto.utils.ts`: the block the wizard's strategy
builder used to spread inline, lifted out so both doors stamp the same shape
off the same reading and cannot drift the way the DTO builders did
([0059](0059-one-mapper-builds-every-imported-transaction.md)). It answers
`undefined` when the reading placed the row on no photo at all, because a
block stamped `image_0` for those would claim a source nobody read — a rule
the wizard keeps, where a batch of several files leaves nobody able to say
which of them an unplaced row came off. This door names the source instead.
It holds exactly one file and every row was read off that file, so a row the
reading placed nowhere is given the `image_0` block rather than left without
one, and a row the reading did place keeps what it said. Without that the
plan was always empty here: the readers behind this door place nothing, so
no drained receipt kept its photo at all. The planner's parameter is now a
`Pick` of the review row's three relevant fields, so a door with no review
card can call it.

A plan belongs to a row by its metadata, which is known before anything is
written; a refusal is decided by the amount, which only the write finds out.
So a refused carrier's plan is handed on to the next row of the same group
that was given none — held in `orphanedPlans`, keyed by the group the row
belongs to (`receipt:<id>` where the reading grouped them, one shared key
otherwise, since the drain runs over exactly one file). A row already in the
ledger consumes the plan without writing: the pass that put it there consumed
it too. A plan nothing consumed by the end of the loop is counted as a skipped
photo.

A photo the ledger refuses costs the photo and not the transaction. Both
image-only sentinels — `RECEIPT_IMAGE_LIMIT_ERROR` for the quota,
`RECEIPT_ATTACH_FAILED` for a failed upload — leave the write rolled back with
nothing behind them, so the row is rewritten bare at the same id and the loss
is counted. That is
[0067](0067-a-photo-is-made-to-fit-and-never-costs-its-transaction.md)'s
ruling applied to this door: the transaction is the record, the photo is
evidence attached to it. The wizard keeps the two sentinels as separate
figures; the drain folds them into one, because it has one number to report.

### A merge records what it absorbed

`mergeImportRows` writes the receipt groups it folded in —
`mergedReceiptIds` on the surviving row's `imageMetadata`: the source's own
`receiptId`, plus every group either side had already absorbed, minus the
target's own. `planReceiptAttachments` marks every one of those groups attached
before it walks a single row, so whatever is left of the source receipt is
already carrying its photo, whatever order the rows arrive in.

The merge has to be what records it, because nothing downstream can work it
out. A reviewer's merge across two receipts and the reader's own consolidation
of one long receipt spanning two photos end in the same shape: one row, the
`wasMerged` mark, the union of the photos. The first is two receipts becoming
one; the second is one receipt that was always one, and a second receipt
printed on one of its photos must still attach it (0060's rule, which 0106
already excepted for split parts). Only the merge knows which of the two it
just performed.

### A status write answers

`updateImageStatus` returns a boolean: `true` only once the record has been
written back, and `false` — with a warning naming the image and the status —
when the database is closed or the record is no longer there, which a queue
cleared while a drain is in flight does legitimately. Each of the drain's four
outcome writes (the three failures and the completion) goes through
`warnIfDropped`, which warns *"Outcome not recorded; the queue is closed"*
with the image id.

The queue also publishes the state instead of only logging it. The `blocking`
handler is now a named `closeForUpgrade()`, and it sets a `closedForUpgrade`
signal that nothing in this tab clears, because nothing in this tab can
reopen the handle. The AI settings page reads it beside the pending count:
*"The queue was closed so another tab could update it. Reload this page to see
it again."*, with **Sync now** disabled, so the one surface that shows queue
figures stops implying they are live.

### An abandoned read re-arms; a failed one does not

A `retryArm` counter, read at the top of the profile retry effect, is bumped
in the read's `finally` and only when that read's answer was abandoned because
the session had been replaced — the bail 0052 installed. The new session then
gets its own read at once instead of waiting for the next connectivity flip. A
failed read deliberately does not bump it: a persistent failure would loop the
effect against something that is not going away, and the flip is the right
trigger for that case.

## What was rejected

- **A bare write, then the photo.** The drain could keep writing rows exactly
  as it did and attach the picture afterwards, leaving `addTransaction`'s
  refusal alone. The upload is keyed on the transaction id and must precede
  the document write, so the photo would arrive as a second write onto a row
  that already exists — and a replay skips a row it finds in the ledger, so a
  drain interrupted between the two would never attach it at all. The refusal
  that made a second write look necessary was itself the thing to remove.
- **A per-row status in the queue's own store.** The queue holds one status
  per image, and a per-row record means a new shape in `pending-images` and
  therefore a schema upgrade — the very event whose handling the rest of this
  record is about — to store a fact the ledger already holds: a row that
  landed has a document at a known id, and a row that did not has none.
- **Remembering which rows were refused.** It buys nothing. The refused row
  has no document, so a later pass attempts it, is refused again and counts it
  again, which is the same answer rather than a new loss. It would also put a
  second record of what landed beside the ledger — the extra queue field 0015
  declined for the written ids, for the same reason.
- **Making `profileRetryInFlight` a signal.** It reads as the smaller change
  and is the wrong one: the effect would re-run on every release of the mutex,
  including the release after a read that failed, which is exactly the loop
  the arm avoids. It is a mutex, not state. A counter bumped on one outcome
  says which outcome it means.
- **Reopening the closed database.** The handle was closed so another tab
  could upgrade the schema; reopening at the old version is what `blocking`
  exists to prevent, and reopening at the new one would run this tab's code
  against a shape it was not built for. A reload is the honest instruction,
  and the note gives it.
- **Queueing a statement page.** Keeping everything and sorting it out on the
  way back is the answer that writes the worst row. A queued image carries no
  kind, and the drain has one pipeline — the receipt one, which merges the
  line items of a purchase into a single transaction and writes it with no
  reviewer. A page of unrelated charges through that comes back as one lumped
  figure in the ledger that nobody was shown, and the statement door exists
  precisely to keep those rows apart. It could only be right once a queued
  image carried its kind, which is a new shape in `pending-images` and
  therefore the schema upgrade the rest of this record is about. A refusal
  read while the page is still in front of the user is the better trade.
- **Suppressing the duplicate upload by the photos a row already claims.** A
  leftover row on the source receipt names the same photo as the merged row,
  so overlap looks like a discriminator. It is not: two different receipts
  printed on one photo both keep it, and overlap cannot tell that case from
  this one.
- **Keying it on the `wasMerged` mark.** `consolidateReceiptItems` sets the
  same mark when the reader folds one long receipt across two photos, so the
  mark says a merge happened and not that two receipts became one. Keying on
  it suppresses a neighbouring receipt's photo on any ordinary two-photo
  receipt — see below, where it did.

## Consequences

- **The door matrix in [../import-fields.md](../import-fields.md) reads yes
  for the offline drain.** The *photo attached* row's last column said "no
  (follow-up)"; the drain now attaches on the same terms the receipt-photo
  column already describes.
- A drained receipt costs one storage object per row the planner picked, and
  one slot against the receipt quota for each, exactly as a wizard import
  does. The drain runs over a single file, so a receipt group can claim at
  most one photo.
- A drain that skipped nothing reads exactly as it did before. The settings
  page's closed-queue note is the one new key in all three catalogs here; the
  partial notice reuses the key the CSV import already raises, which the three
  catalogs have carried all along and which declines in English only
  ([0036](0036-a-user-facing-string-lives-in-the-catalog.md)).
- `ImagePositionMetadata` gains optional `mergedReceiptIds`. Like `splitFrom`
  it is a review-row mark that stops at the mapper — `toCreateTransactionDTO`
  names every field it forwards — so nothing new reaches a document and no
  rules change or deploy was needed.
- `updateImageStatus` has a return value that four call sites read. The
  queue's own sync loop is not among them, which is recorded below.
- `addTransaction`'s refused combination changed rather than disappeared, so
  a caller that passed an id and files and expected a throw now gets a write.
  The drain is the only caller that passes both; the restore is the only
  caller that merges, and it carries no files.
- The drain's unit spec gains eleven cases: the photo attached once per
  receipt group; the bare-row fallback and its count; a plan handed on when
  its carrier is refused; handed on to a row that cannot take it either; a
  plan no row of its receipt could take; a row the reading placed on no image
  at all claiming the photo this door holds; a bare retry that fails too; the image that completes and
  reports what an unreadable amount kept out; another row's transient error
  still failing the image; the re-refusal on a later pass; and the warning
  when the closed queue could not record the outcome. The partial-batch case
  0015 named is renamed for the transient failure it is really about.
- The emulator suite gains three cases against real Storage: a drained receipt
  landing with its photo, a replay re-uploading into the same slot, and a
  refused row whose photo lands on the next row of its receipt.

## Departures from the issue

- **The mapper does not throw on a sub-unit figure, and nothing asked it to.**
  #431 describes the invalid amount as a mapper failure.
  `toCreateTransactionDTO` rounds it to zero, quite deliberately (0117), and
  the refusal comes from the ledger's own amount guard at the write, after
  every other field has been built. That is where the classification had
  to go, which is also why it generalises: the drain sorts by what the failure
  is, not by which row produced it.
- **"Mark only the invalid row" became "count it".** The queue stores one
  status per image and giving it a per-row record means a schema upgrade, as
  above. The row is counted, the image completes, and the notice says how many
  did not land.
- **The photo travels through the lifted refusal, not through a second write.**
  The issue sketched attaching after the bare row had landed. Lifting the
  refusal is fewer moving parts and survives an interrupted drain, which the
  second write does not.

## Things that only became apparent while building

- **The first cut of the double-upload fix would have broken ordinary
  two-photo receipts.** It keyed on `wasMerged`, and the reader's own
  consolidation of one long receipt spanning two photos stamps exactly that
  mark — so a second receipt printed on one of those photos would have been
  suppressed and lost its picture. That is why the merge now records the
  receipt groups it absorbed: the mark was never the fact anyone needed.
- **The planner speaks the wizard's row shape, not the reader's.** It reads
  `id`, `splitFrom` and `imageMetadata` off a review row, and the drain has
  none — it has the reading and a queue row id. Widening the parameter to a
  `Pick` was half of it; the other half was the shared `imageMetadataOf`, so
  the drain builds the same block the card would have built rather than a
  near-miss of its own.
- **A replay nudges the receipt-count cache a second time.** A drain
  interrupted after the upload but before the document write leaves no
  document, so the replay attempts the row, uploads the same bytes into the
  same slot, and calls `noteImagesAdded` again for an object that exists once.
  The count is a cache over the bucket
  ([0094](0094-the-receipt-quota-is-recounted-from-the-bucket-it-limits.md)),
  so it is recounted from what is actually stored; the nudge is drift until it
  is.
- **The drain's emulator suite had no storage emulator at all.** It stubbed
  `StorageService` outright, which is fine for a door that never uploaded and
  useless for one that does. The suite now connects the storage emulator and
  uses the real `StorageService`, so the photo, the replay and the refused row
  are proven against real objects; `ReceiptQuotaService` stays stubbed, because
  the real one injects a remote-config transport this run does not have.

## Known gaps

- **A multi-page receipt queued offline drains as one transaction per page.**
  Each page is stored as its own queue row and the drain reads them one at a
  time, so a receipt photographed across three pages arrives as three
  transactions to be merged by hand afterwards. The camera dialog has always
  behaved this way; what is new is that the wizard reaches the same queue, and
  the wizard is where a multi-page batch is the ordinary case rather than the
  exception.
- **A drained row does not pass back through the review step.** The same files
  imported with a connection get the review card — the field corrections, the
  date question, the duplicate verdict — and the same files kept offline are
  written unattended and corrected in the ledger afterwards, like any other
  transaction. The capture is kept whole; the reviewing of it is not deferred,
  it is skipped.
- **The retry budget is bounded, and one surface shows it.** An image that
  fails three times is retired and no longer dispatched, while still counting
  towards the queue figures on the AI settings page — the only screen that
  says so. Nothing on the wizard, where the capture was taken, mentions it
  again.
- **The skipped figure is a count, not a list, and it is not replay-stable.**
  0060's `receiptsSkipped` gap in a harder form: a later pass skips a row it
  finds in the ledger without knowing an earlier pass dropped that row's
  photo, so it reports one fewer. The count answers "did everything land",
  not "what is missing".
- **The two figures in the notice can exceed the rows the reading produced.**
  A row refused for its amount is counted as refused, and the photo it was
  carrying is counted again as a skipped photo when no other row of its group
  can take it. Both are true statements about one row.
- **The merge's own record is the only discriminator.** Nothing outside
  `mergedReceiptIds` says that two receipt groups became one, so a row that
  reaches the planner having lost that block is back to uploading the photo
  twice. And the edge the rule accepts stands: two receipts printed on the
  same photo and then merged attach it once, on the merged row, where 0060
  alone would have given each of them a copy.
- **Queueing an image while the database is closed still throws.** `queueImage`
  opens with `if (!this.db) throw`, and the capture paths meet that as an
  ordinary failure rather than as the state the settings page now names.
- **Three of the clear family still return silently on a closed queue.**
  `clearAll` throws, because account deletion records that step from its
  resolution alone and the settings page announces it; `removeImage`,
  `clearCompleted` and `clearFailed` do not, since nothing reads their
  outcome yet. The service's own docblock names which is which.
- **The queue's own sync loop discards the boolean.** It writes `processing`
  and `failed` for the rows it dispatches and reads neither answer, so its
  counters can still report a write the closed database dropped. The drain's
  outcomes are the ones that say.
- **Closing for a newer version is not exercised end to end.** The unit case
  calls `closeForUpgrade` directly and pins what it leaves behind — the
  handle dropped and the flag raised — beside a second case for the clear
  that now refuses. Reaching the real
  callback means holding a second connection open at a higher schema version,
  and that file's own schema note records what connections held open across a
  case did to it: `deleteDB` blocked on them and the whole file went flaky.
  So the trigger is asserted nowhere and the consequences everywhere.
- **A profile read that fails still waits for the next connectivity flip.**
  Only an abandoned read re-arms, by design. The abandoned case is proven by
  a unit fixture rather than in the emulator, which cannot hold a read open
  across a session swap without a timer.
