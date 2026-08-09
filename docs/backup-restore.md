# The JSON backup and what a restore does to your account

The full backup is a single JSON file written from Data Management (`/data`),
and it is the only export that round-trips everything. The CSV export is a
report; this is a copy. Restoring one is the recovery path after a bad
delete-all, the migration path between accounts, and the reason the app can be
uninstalled without ceremony.

The reasoning behind how a restore writes, and what was rejected, is in
[ADR/0031](ADR/0031-a-restore-merges-into-the-row-it-finds.md).

## A restore has three rules, and the third is new

**Write at the backup's own id.** Every record goes back to the document it
came from. Restoring the same file twice therefore lands on the same documents
rather than appending a second copy of every row — which is what used to double
every balance, budget and chart while reporting success.

**Stamp the current account, never the backup's.** `userId` is taken from
whoever is signed in, not from the file. The security rules demand it, and it
is also what lets a backup be restored into a different account at all.

**Merge into the document already there.** A backup cannot carry everything a
row holds, so the write leaves keys it does not mention alone. This matters
most for receipt images: the file holds no Storage objects, and the objects are
reachable only through the transaction that names them, so a write that dropped
the receipt fields orphaned the bytes permanently — see
[docs/account-deletion.md](account-deletion.md) for why nothing can reach them
afterwards.

The cost of merging is stated rather than hidden: **a restore cannot clear a
field the backup dropped.** If you removed a note, a tag, a location or a
budget period after taking the backup, restoring that file leaves your removal
in place rather than bringing the old value back. Restoring is how you recover
data, not how you undo an edit.

## What comes back verbatim, what is recomputed, and what is never sourced

| Section | Verbatim from the file | Recomputed after the restore | Never sourced from a file |
|---|---|---|---|
| Transactions | id, amount, currency, the historical rate and base-currency figure, category, description, date, note, tags, location, period, `createdAt`, the recurring link, the goal link and its figure | — | receipt images |
| Categories | id, name, icon, colour, type, parent, deleted-or-not | display order | the built-in categories, which are generated rather than stored |
| Budgets | id, category, name, amount, currency, period, dates, alert threshold, active-or-not | `spent`, from the restored ledger | — |
| Recurring rules | id, name, type, amount, currency, category, description, frequency, dates, **paused-or-not** | `nextOccurrence`, from today | `lastProcessed` |
| Goals | id, kind, name, target, currency, target date, checklist items, note, contributed balance, active-or-not | `linkedAmount`, from the restored ledger | — |
| Monthly insights | the whole snapshot, at its month-key id | — | — |

The split is deliberate. Anything the app can derive from the restored data is
derived, so a restore cannot install a counter that disagrees with the ledger;
anything it cannot derive travels verbatim, because the alternative is
inventing it. A goal's contributed balance has no transaction source, so it
rides in the file; a budget's `spent` has one, so it does not. That is why
budgets are written after transactions and goals are settled after both.

## A paused rule comes back paused, and a deleted category stays deleted

Pausing a recurring rule and deleting a custom category are both stored as a
flag, and both used to be switched back on by a restore. A rule paused in March
came back active, and the dashboard's catch-up — which runs on load with no
user action — started posting money for it again at its next due date.

One thing does not survive: a restored rule has its `nextOccurrence` recomputed
from today, so nothing accrues for the time the backup sat on disk, and
resuming a restored pause later behaves like a fresh resume rather than picking
up the stored pointer. See [docs/recurring.md](recurring.md) for the catch-up
contract itself.

## Monthly insights yield to whatever is newer

Snapshots are the one section a restore may decline to write. Each carries a
`revision`, and the security rules require a rewrite to advance it — so
restoring a file whose snapshot is at the same revision as the stored one is
not a write the rules will take.

The restore reads the stored month first and then does one of three things: it
writes the snapshot if the month has none, it leaves the stored one alone if
that one is at or above the backup's revision, and it writes over the stored
one only if the backup is genuinely newer, keeping the `createdAt` already
there. A month left alone counts as restored, because the account already holds
what the file asked for.

The practical effect is that restoring the same file twice reports nothing
skipped, and restoring an old backup over months you have since regenerated
keeps your regenerated versions. Snapshots are derived data in any case — any
month can be rebuilt from the restored ledger with Regenerate.
[docs/insights.md](insights.md) covers what a snapshot holds.

## What the two toasts mean

The confirmation dialog names the count of every section in the file, matching
the preview panel above it. Afterwards one of two things is reported:

- **"N records restored"** — every row in the file is accounted for. `N` is the
  sum of every section, goals included, and counts months left alone because
  the stored snapshot was already current.
- **"N records restored, M skipped (sections)"** — `M` rows could not be
  written, and the sections they belong to are named. The full list, with the
  reason for each row, goes to the browser console. A restore never abandons
  the rest of the file over one bad row.

A row is skipped when the write itself failed — a rule saved with a frequency
the app now refuses, a transaction whose amount the rules reject, a network
error mid-restore. Re-running the same file is safe and is usually the fix.

## Versions

The file carries the schema version that wrote it, and the restore refuses
anything newer than the running build understands rather than half-reading it —
a file from a newer version may hold sections this build would silently drop.
Older versions are read: a backup without a section simply restores fewer of
them, and a flag that did not exist when the file was written reads as its
default.

| Version | Added |
|---|---|
| 1.0 | transactions, categories |
| 1.1 | monthly insight snapshots |
| 1.2 | budgets, recurring rules |
| 1.3 | goals |
| 1.4 | goal links on transactions |

## Privacy

The file is written to wherever you save it and never leaves the device on its
own. It holds your full ledger in clear text — descriptions, notes, amounts and
category names — so it deserves the same handling as a bank statement. It does
not contain receipt images, credentials, or any authentication token, and
restoring it into another account rewrites every `userId` to that account's.
