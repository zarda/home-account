# 31. A restore merges into the row it finds, and the backup's flags outrank the create defaults

**Status:** Accepted, implemented · **Date:** 2026-08-09 · **Issues:** #245, #254, #265, #269

Reference documentation lives in [../backup-restore.md](../backup-restore.md).

## Context

Restore does not have a write path of its own. It rebuilds each record through
the same create method the UI calls — `addTransaction`, `addCategory`,
`createBudget`, `createRecurring`, `createGoal`, `InsightSnapshotService.restore`
— passing the backup's own id so a second restore lands on the same documents
instead of doubling every balance. ADR 0021 established the companion rule: a
second `options` argument carries the values a create would otherwise invent,
because nothing can recompute them from the ledger.

That arrangement is right, and it had been read too narrowly. A create method
does not only compute values; it also *stamps defaults* and, through
`setDocument`, *replaces the whole document*. Both are correct for a create and
wrong for a restore, and four issues turned out to be the same sentence:

- A replacing write erased every field the restore DTO has no slot for.
  Receipt images were the expensive case. A backup holds no Storage objects, so
  it can never re-supply a `receiptUrl` — but the objects are reachable *only*
  through the transaction that names them, so erasing the field orphaned the
  bytes permanently. No per-row delete, no delete-all, not even account
  deletion could reach them again, and the quota under-reported real usage
  forever after (#245).
- `isActive: true` is hard-coded in four create payloads, so a restore
  un-paused every paused rule and brought back every deleted category. Catch-up
  runs on dashboard load with no user action, so a rule paused in March started
  posting money again in June (#254).
- Insight snapshots collided with their own rules. A non-merge write over an
  existing document is an update, and the update rule demands a strictly higher
  `revision`; passing the file's revision through meant restoring one file
  twice failed every month, in the flow whose entire contract is that the
  second run changes nothing (#265).
- The component hand-listed five of six counters, so goals fell out of the
  total the toast reports — while the preview panel one line above the dialog
  showed the goal count all along (#269).

## Decision

**A restore merges; a create still replaces.** `merge` joins the restore-only
`options` bag on `addTransaction` and reaches `setDocument`'s existing third
parameter. Merging leaves keys the write does not mention alone, which is what
keeps the receipts a live row already carries, and it costs no extra read.
*Rejected:* flipping `FirestoreService.setDocument`'s default, or merging
unconditionally in the shared caller-id branch — the offline queue replays a
row at a known id and wants the plain overwrite, and a default nobody opted
into is how this class of bug spreads. *Rejected:* reading each document first
and re-emitting its receipt fields. That preserves clear-a-dropped-field
semantics, but it doubles the read count on a large backup to buy a semantic
almost nobody wants from a restore.

**Merge is opt-in, and refused where it cannot be honoured.** Passing `merge`
without an id throws, because that write goes through `addDocument`, which has
no merge to pass. Passing it with a goal link throws, because that write goes
through `createWithGoalLink`, whose `set` inside a Firestore transaction
replaces the document outright. Both would otherwise be dropped in silence,
and silence is precisely how the receipt erasure survived a spec suite that
asserted the DTO and never the write. *Rejected:* resolving either by
precedence, which is the mistake the two pre-existing refusals in that method
were written to correct.

**A restore writes the `createdAt` the file carries.** Merge alone does not
help here: the payload sets `createdAt` unconditionally, so every pre-existing
row was restamped and restoring one file twice produced different documents
each time. The birth date is exactly the kind of value ADR 0021's channel
exists for. *Rejected:* omitting `createdAt` under merge, which would leave a
row created by a restore without a field the model declares required.

**`isActive` joins the same channel rather than a second write.** Each of the
four create methods takes `options.isActive` and defaults it to `true`, so the
chokepoint stays where it already is. Budgets and goals get it too, even
though nothing in the shipped app can deactivate either yet — the defect is
identical and latent, and leaving it is a trap for whoever wires up archiving.
*Rejected:* a follow-up `updateDocument` after each create, which breaks the
one-write-per-document property the restore relies on.

**Snapshots read before writing, and yield to a newer stored month.** When the
stored revision is at or above the file's, `restore` writes nothing and reports
`alreadyCurrent`. That clears the rule, and it is also the right answer on its
own terms: a month the user has regenerated since taking the backup holds newer
detector output than the file does. When it does write, it keeps whatever
`createdAt` was already there, the same rule `regenerate` follows. *Rejected:*
`Math.max(backup, stored + 1)`, which always writes and would overwrite a
regenerated month with older output. *Rejected:* relaxing the update rule — the
rule is right; the write was wrong. The read is a one-shot `getDocument`, not
the live signal, which mid-restore may never have been mounted and would read
as "no stored month" for every month.

**An already-current month counts as restored, not skipped.** The skipped list
is for rows the restore could not write; a month already holding what the file
asks for is accounted for. *Rejected:* a new numeric field on `RestoreSummary`
recording them separately — it would silently join the sum below and inflate
the count the toast reports.

**The reported total is every numeric field of the summary.** Hand-listing the
sections is what dropped goals, and it would have dropped the seventh section
too. `skipped` stays out because it is an array, not because it is named. The
partial-restore toast now also names the distinct sections it skipped, since a
bare count told the user something had gone wrong and nothing about where.

## Consequences

- A restore can no longer *clear* a field the backup dropped. A note, tag,
  location or period removed after the file was taken survives restoring that
  file. This is the price of keeping the receipts, it is stated in the service
  docstring and the reference doc, and it is the one behaviour change a user
  can notice.
- The same applies to `recurringId`: a live row whose link was cleared after
  the backup was taken keeps it. Bounded, because the same file restores those
  rules at their own ids, so a restored link cannot dangle.
- Restoring a file twice now produces byte-identical documents, which makes
  "restore is idempotent" a testable claim rather than an aspiration.
- One extra read per insight snapshot on restore, bounded by the twelve-month
  backfill cap.
- `InsightSnapshotService.restore` returns an outcome instead of `void`, so
  every caller and every double has to say which.

## Things that only became apparent while building

- The hazard note in #245 — "the recurring engine relies on that branch
  replacing a re-posted occurrence outright" — is false, and worth recording so
  the next reader does not re-derive it. The engine never calls
  `addTransaction`; `claimDueOccurrences` writes each occurrence with its own
  `tx.set` inside `runTransaction`. The only other caller passing a chosen id
  is the offline queue processor, which pre-checks with `hasTransaction` and so
  only ever creates. Nothing but restore can reach the merge.
- No rules change was needed for any of this, which is not obvious up front.
  `createdAt` is optional in `txOptionalsValid` and never compared against
  `resource.data`, all four collections already validate `isActive is bool`,
  and a merge write is evaluated against the *merged* document — so the receipt
  fields that survive are re-validated as fields this app wrote, and pass.
- The placeholder half of a locale edit has no automated backstop. The key-set
  parity spec passes when a `{{goals}}` slot is added to English alone,
  `check-i18n.mjs` only asks whether a key resolves at all, and `interpolate`
  renders an unknown placeholder as literal braces rather than throwing. A
  parity check added alongside this work immediately found three pre-existing
  drifts, two of which turned out to be correct translator choices — an English
  ordinal suffix has no business in 毎月15日 — so it carries a small documented
  allow-list rather than a looser rule.
- Restoring a paused rule keeps the pause but still recomputes `nextOccurrence`
  from today, so resuming it later behaves like a fresh resume rather than
  restoring the stored pointer. That matches what `resumeRecurring` already
  does, and it is why the smoke test has to backdate the pointer to prove the
  engine honours the restored pause.

## Known gaps

- `addCategory` still recomputes `order` as `maxOrder + 1` from the in-memory
  signal, so a restore reshuffles category ordering. Same code path, different
  defect: `order` is not a flag the file's value should simply win, because a
  restore into an account that already has categories has two orderings to
  reconcile. Left for its own change.
- Merge cannot express "this field was deliberately removed". A backup format
  that recorded absence explicitly could, but every section would have to carry
  it, and no user has asked to undo an edit by restoring.
- The smoke suite drives the orchestrator with hand-built `ExportData` rather
  than a file produced by the exporter, so a divergence between what
  `exportFullBackup` writes and what `restore` reads would still pass. The
  version-gate in `parse` is the only thing standing between them.
