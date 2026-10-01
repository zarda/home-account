# 159. A copy follows its row in a commit of its own, and a sweep repairs what the follow-ups miss

**Status:** Accepted, implemented · **Date:** 2026-09-28 · **Issues:** #71, #465

Reference documentation lives in [../household.md](../household.md).

Writes and keeps the copies of
[0157](0157-a-transaction-is-private-until-its-owner-shares-it-and-a-household-sees-a-faithful-copy.md),
in the memberships of
[0158](0158-an-account-holds-up-to-ten-memberships-each-named-by-an-index-it-owns.md).
Keeps [0027](0027-a-linked-transaction-carries-its-converted-amount.md)'s
offline promise: a row's add, edit and delete without a goal link are
offline-capable, shared or not. Applies
[0009](0009-shared-state-publishing-and-lifecycle.md): what the sharing code
holds for an account, its categories listener included, is dropped when the
account signs out or another signs in. Reads the server as
[0156](0156-a-dissolve-that-finds-its-household-already-gone-finishes-instead-of-failing.md)
does. The server triggers that back this up are
[0161](0161-a-deleted-membership-or-household-is-swept-by-server-triggers-as-a-backstop.md)'s.

## Context

A household sees a row only as a copy its author writes and the rules hold
to the row (0157). Something has to write that copy whenever the row
changes, on every path that writes rows, and take it out when the row is
unshared or deleted.

- **The rules may refuse a copy:** one for a membership that has ended,
  or one an edit made on another device no longer matches. A personal
  write must never be refused because its copy was: a write queued offline
  that is refused on landing is rolled back, and 0027 promises that a
  private row's add, edit and delete land.
- **A commit may make twenty lookups,** a copy's rule makes three (four at
  most), and a row may be shared into ten households.
- **A follow-up can be lost.** The app can stop between a commit and the
  write that follows it, a device can edit offline from a stale cache, and a
  client built before this change edits rows without following them.
- **The emulator enforces neither composite indexes nor the lookup
  ceiling** ([../emulator-blind-spots.md](../emulator-blind-spots.md)), and
  the initial bundle sat just under its 2.45 MB warning line, which moves
  only deliberately, naming what bought the space
  ([../performance.md](../performance.md#the-budget)).

Three roads were weighed on correctness, failure modes and cost: **A**,
the copy in the same commit as its row; **B**, the copy in a commit of its
own right behind the row's, with a journal and a sweep that repair whatever
the follow-ups miss; **C**, a server-side trigger that mirrors each row
write into its households. B did best on all three. Its deciding property:
a personal write never shares a commit with a write a rule could refuse,
and `copyFaithful` still keeps every copy true to its row.

## Decision

**A shared row's copy is written in a commit of its own, issued right
behind the row's write; the only writes that share a commit with a personal
write are deletes of the author's own copies, which no rule refuses. Every
copy write is journaled before it is issued, and a count check and a weekly
full diff repair whatever the follow-ups miss.**

The first half is invariant I2: the rules judge an author's delete of its
own copy with no lookup and never refuse it, so a personal commit lands
whole and 0027's promise holds. The second is I4: an entry is settled only
once its write is acknowledged.

### Why a commit of its own is safe

`copyFaithful` (0157) reads the author's row with `getAfter`, as the commit
leaves it, so a copy write is judged against whatever the writes before it
made of the row: a follow-up that lands behind a later edit, an unshare or
a delete from another device is refused rather than landing wrong, and its
journal entry brings it back. The rules look up nothing for a personal
write, a delete of one's own copy or a key's `arrayUnion` and
`arrayRemove`; three documents for a copy create or update (the household,
the author's member document there, the row); three for a goal link too,
the goal read in place of the row, and two for removing one; for a write
that changes only the stamp, two on a copy with no link and three on a
linked one; four at most, when that link's goal is gone or of another
generation and the write falls through to `copyFaithful`, which reads the
row as well; and one for the owner's delete of another member's copy.

### Issue, follow, await

`LedgerShareService.follow(txId, before, after)` is synchronous and never
throws. On every plain path (`addTransaction`, with or without receipts or
an id, and `updateTransaction`), the write is issued, `follow` is called,
and only then is the write awaited, in one step: both enter the persistent
mutation queue in that order, and nothing the app can stop in lies between
them. A new shared row is given its id before the write, so its copy can be
named. A private row never loads the sharing code.

- **Which copies a change touches.** One copy write for each live household
  the row names after the change, less those it named before when the
  projection is unchanged: an edit of the note writes nothing. A household
  the row stopped naming is journaled for the repair; `follow` never
  deletes.
- **What it cannot write yet is journaled.** A household that is ending, a
  row holding a value no copy may hold, a household the held index does not
  list (read again, then followed again), a category the held list lacks
  (read again once per category, then followed again). Until the account's
  index and categories are loaded, every household the row names is
  journaled at once and the writes follow the load.
- **Paths that commit in a transaction** (`createWithGoalLink`,
  `addSplitTransaction`, `splitTransaction`, `updateWithGoalSync`,
  `appendReceiptsTransactionally`) call `intend` for each change before the
  commit, which journals and issues nothing, and `followMany` once it lands,
  which groups the copy writes by household.
- **Each copy write** is a set with `merge`, so a projection never clears
  the author's goal link, stamped with the server's time. It is journaled
  and counted in flight before the commit is issued. An acknowledgement
  settles the entry only when it answers the last write in flight for it
  and nothing was owed for it since that write was issued. A refused
  follow-up keeps its entry and schedules a repair two seconds later
  (`LEDGER_REPAIR_DELAY_MS`).
- **The cost is 1 + N commits** for an edit of a row shared into N
  households whose copy changes, N at most ten.
- **A share, online,** reads the rows first, ten at a time, and keys only
  those a copy can hold (`projectable`: an income or an expense, an amount
  above zero, a date, and a currency, description and category): a key
  with no copy behind it would keep the check's counts apart. The others
  are answered as skipped, and a share whose every row still there is one
  no copy can hold is refused (`unshareable`) with nothing written. The
  form and the row menu say what a row needs to be shared; a bulk share
  from the Transactions list says how many rows it could not share. The
  share adds the key with `arrayUnion`, then, once the keys have landed,
  writes each copy from the row as it then reads, so each row is read
  twice. A refused copy is the journal's to repair; a copy phase that stops
  owes a full pass.
- **The form's own share changes go on either side of an edit.** A
  household taken off in the same save is unshared before the edit is
  written (offline, queued ahead of it): the edit's follow-up writes the new
  text into every household the row still names, and one being withdrawn
  would receive it, and keep it if anything after the edit failed. One that
  cannot be taken off stops the save, with the edit still in the form. A
  household added is shared once the edit has landed (offline, queued right
  behind it), so a failed save shares nothing, and before a split, so every
  part is shared as the purchase now is.

### Deletes no rule refuses

Grafted from road A: a copy delete may ride in a personal commit.

- **An unshare** is one commit of pairs, each the copy's delete and the
  row's `arrayRemove`, at most 225 pairs a commit. It works offline and
  after the membership ended.
- **A row's delete** takes its copy out of every household the account's
  index lists, ended memberships included, whatever the row's `sharedWith`
  says, in the row's own commit (inside the transaction for a goal-linked
  row). A stale cache that does not show a share made elsewhere leaves
  nothing behind; a missing copy's delete passes.
- **`deleteAllTransactions`** deletes the rows, then purges the account's
  copies in every household the index lists. Once the rows are gone no copy
  can be written again. A purge that fails, an index it cannot read or
  sharing code that does not load rejects with the count of rows already
  deleted (`CopiesNotPurgedError`), so an erasure step still fails and keeps
  the auth user. The Data page says the rows are deleted but some
  households still show them; run again, the wipe finds no rows, purges,
  and says the households no longer show them.

### The paths that reach no copy

Receipt removals, a base-currency re-snapshot and a personal goal's delete
change no revealed field. The recurring claim, the imports, the queued
receipts and a restore write private rows (0157); a restore onto live rows,
like a category edit, owes each live household a full pass (below).
`transaction.service.spec.ts` pins what every public write path hands on
(*every write path*), and the order of issue, follow and await on each
plain one.

### Chunks

| Constant | Per commit | Why |
|---|---|---|
| `LEDGER_COMMIT_CHUNK` | 5 copy writes | three lookups each, four at most: twenty |
| `LEDGER_PURGE_CHUNK` | 10 owner deletes of others' copies | one lookup each |
| `LEDGER_OWN_WRITE_CHUNK` | 450 own copy deletes or key writes | no lookup; under the 500 writes a commit holds |
| `LEDGER_UNSHARE_PAIRS_PER_COMMIT` | 225 pairs | two writes a pair |
| `MAX_BULK_SHARE` | 500 rows per bulk share or unshare | refused before anything is written |

The lookup counts are the rules file's own, one per distinct document read.

### The journal

Device state in `localStorage`, every access caught: `ledger.journal.{uid}`
holds `rows` (household and row ids), `full` (each household owed a full
pass, with the number of its latest mark) and `seq` (the journal-wide
counter those numbers are taken from, which only grows), and
`ledger.sweep.{uid}.{hid}` holds when this device last completed a check and
a full pass. It is capped at 500 rows (`LEDGER_JOURNAL_CAP`); a row past it
marks its household for a full pass instead. An unreadable journal behaves
as an empty one.

A household is owed a full pass by a share of several rows made offline, a
share whose keys did not all land or whose copy phase stopped, a full pass
that failed, a journal overflow, a category edit, and a backup restore.
Every mark takes the next number, a household already marked included.

A full pass reads the counter before it reads anything else, and clears
only a mark numbered at or below what it read. A mark made while it runs,
in this tab or another (they share the storage), stands for a change the
pass may have read too early, a category or a row, so it outlives the pass.
The journal is kept once any mark has been made, even with nothing else in
it: a counter started again would let a pass that began before it clear a
later mark. A counter, not the clock, which another tab's clock or one set
back would put out of order. A category edit and a restore mark again once
each write lands, so a pass that read before the write reached the server
cannot clear what it did not see.

### Repair, check and full pass

- **The repair** runs online only, once `waitForPendingWrites` says every
  earlier write of this device is answered. Each journaled household's
  membership is judged from the server alone (the account's member document
  and the household of its generation). An ended one is cleaned up (0158);
  for a live one each row and its copy are read from the server, ten at a
  time, orphans and other-generation copies are deleted, and missing or
  different copies written.
- **The check** asks the server for two counts: the account's rows naming
  the household, and the account's copies in it. Equal, the household is
  settled; unequal or unanswered, a full pass follows. It counts only: a
  count under one filter is served by the automatic single-field indexes,
  while a sum over a query filtered on another field needs a composite in
  production (for the rows, one over every account's transactions) that
  the emulator never asks for, so every test would pass and production
  would refuse. A copy behind in its amount alone waits for the journal or
  the full pass, as one behind in any other field does.
- **The full pass** lists both sides from the server and diffs them row by
  row: a missing, different or other-generation copy is written, an orphan
  (its row gone, no longer naming the household, or of another generation)
  deleted, deletes first. A row that names the household but holds a value
  no copy may (a type other than income or expense, an amount not above
  zero, or no date, description, currency or category) has the household's
  key taken off instead, in the author's own commits on its rows
  (`arrayRemove`, 450 a commit), so the next check counts both sides alike. The membership was
  judged live from the index, whose entry outlives a removal or a dissolve
  until a tidy closes it, and the rules refuse every copy of an ended one:
  so the first commit of copies that fails has the server judge the
  membership, once a pass (the commit's error code does not reach the
  pass, so any failure asks). An ended one is cleaned up (0158) and the
  pass resolves; one the server cannot judge, or that became a membership
  again during the clean-up, leaves the household marked and the pass
  rejects; a live one goes on with the rest. Any miss, a key not taken off
  included, marks the household for another pass and rejects. It runs
  when the journal marks the household, after a restore, when a check
  disagrees, and when this device's last full pass over the household is a
  week old (`FULL_SWEEP_EVERY_MS`) or unknown. That weekly pass is the
  floor: the journal lives on one device.

### When the sweep runs

`reconcileAll` runs the repair, then a check or a full pass for each live
membership, one sweep at a time, online and signed in only. It runs:

- **at start-up**, once per account per app session, and **on reconnect**:
  an effect in `app.config.ts` waits for the browser to be idle
  (`requestIdleCallback`, ten-second timeout; three seconds where there is
  none, as in Safari and the iOS web view), then imports the service, which
  with its projection code stays out of the initial bundle;
- **once per visit to `/household`**;
- **at the end of a backup restore**, which awaits it.

`reconcileAll` is the app's only way in. `reconcile(householdId, mode)`,
one household's check or full pass, is there for the specs and the smoke
to drive, and nothing in the app calls it. It holds the sweep's lock all
the same: it waits for a running sweep, and a sweep asked for while it runs
follows it, so a full pass never runs beside a sweep.

### Offline

- **Queue offline:** a shared row's add, edit and delete (without a goal
  link), a single row's share (its key, then its copy from the cached row),
  every unshare, a bulk share's key writes (its copies are owed to a full
  pass), and a category's copy rewrites.
- **Online only:** the repair, the check and the full pass; every
  membership action (0158); every plan write, goal links included, each
  committed in a transaction and never queued, except the sweep of a
  deleted goal's remaining contributions (0160).
- **A queued copy refused on landing** is rolled back alone, and the
  journal repairs it.

### Correcting a projection

`LEDGER_PROJECTION_VERSION` (now 1) is written on every copy as `pv`.
Raising it makes every copy an older version wrote differ from its row's
projection, so the next full pass rewrites it. A copy a newer version
wrote is compared only on the fields every version sets alike (the author,
the row, the generation and the six revealed fields), so two builds of one
account never rewrite each other's copies back and forth. A projection is
therefore corrected by raising the version, never by lowering it: after a
rollback, copies a newer build wrote keep that build's category snapshot
and bucket until a newer build rewrites them. Only a change in a row's
revealed fields makes the older build write that row's copy again, whole.

### Category edits

- **An edit that sets a name, icon, colour or parent** is issued, then every
  live household is marked for a full pass, then the copies of the
  account's shared rows in that category are read and each one that differs
  is rewritten at once, queued offline. The mark costs one full pass per
  live household at the next sweep, and is what reaches copies the rewrite
  cannot: a parent change moves the bucket of every category below it, and
  only the edited category's rows are rewritten at once. Once the category
  write lands, every live household is marked again: a full pass that read
  the categories before the write reached the server, in this tab or
  another, began before that mark and leaves it for the next.
- **A soft delete is not handed on.** `isActive` is never on a copy, and a
  copy is projected from its category whatever the flag.
- **A hard delete is not handed on either.** Its rows' copies keep their
  snapshot until each row is next projected, which shows it under the
  built-in it then counts under.

### The guards against a new write path

`npm run ledger:check` (`scripts/check-ledger-contract.mjs`, in CI after
the composite-index check) holds eight facts stated twice: the copy's
fields against the rules, each query shape against its composite, every
file that writes transactions against a list with its reason (four today;
one that stops writing fails too), the share-key cap, the snapshot's
bounds, the plans' fields and bounds (a plan's currency pattern in the
rules against the one `HouseholdPlansService` tests it with, which carries
no flag), and `copyFaithful`'s terms against the copy fields its row
decides. A `commitBatch` or `commitOnline` counts as a write of rows when
any of its ops' paths names a transactions collection. A new writer is
listed in the change that adds it, where its review asks whether it
carries the shares.

## What was rejected

- **Road A: the copy in its row's commit.** A refused copy would take the
  personal write down with it: a row edited offline for a household the
  author has since left would be rolled back on landing. Each copy looks up
  its own household and member document, so a row shared into ten
  households needs more than the twenty lookups a commit may make. What A
  gave is kept: the deletes no rule refuses.
- **Road C: a server trigger mirroring each row write.** A function would
  run on every row write of every account, shared or not. It writes past the
  rules, so `copyFaithful` could not judge it. Its events arrive at least
  once and in no guaranteed order, so an older event could overwrite a newer
  copy unless fenced. It would be the one path to a copy the smoke suite
  cannot run ([0155](0155-journeys-that-need-two-accounts-run-against-the-emulators.md)),
  and it deploys apart from the rules and hosting. What C gave is kept: the
  triggers as a backstop only (0161), and every multi-field query declared
  as a composite.
- **A delta sweep from a watermark** of each row's `updatedAt`. That stamp
  is the device clock's, so a row written by a device running behind would
  be missed for good.
- **A sum in the check,** above: it could be proved nowhere but in
  production.
- **A control to ask for a sweep.** It runs by itself at start-up, on
  reconnect, on each visit to `/household` and after a restore.

## Consequences

- Every copy is true to its row, behind it, missing or left over, and the
  sweeps bring each back: the next check finds one missing or left over
  (unless one of each cancels out in the counts), and the weekly full pass
  finds the rest, the next time one of the author's devices sweeps. Nothing
  on the server compares copies with rows; 0161's triggers act only on
  deletes.
- A device's first sweep of each household runs a full pass, since it holds
  no stamp; a full pass reads every row naming the household and every copy
  the account wrote there.
- The initial bundle's warning in `angular.json` (both configurations) moved
  from 2.45 MB to 2.47 MB, by the 12.85 kB sharing put over it and no more
  ([../performance.md](../performance.md#the-budget)).

## Things that only became apparent while building

- **The app runs the Firebase SDK nested under `@angular/fire`,** not the
  root copy. `arrayUnion`, `arrayRemove` and every other sentinel come from
  `@angular/fire/firestore`: one from the root `firebase/firestore` belongs
  to the other copy, which this client does not recognise.
- **`getDocFromServer` is answered by an attached listener too,** as 0156
  found of `getDoc`: it refuses only an answer the listener marks as cached.
  Every server judgement here (`getDocumentFromServer`) reads inside a
  one-attempt transaction abandoned before it commits.
- **A smoke case cannot take a client offline.** A full client that
  disables its network with a write queued stalls every other full client's
  emulator traffic for tens of seconds. The unit specs show from the
  call-order log that each copy commit is issued behind the personal write
  it follows; that the two land in that order after an offline spell rests
  on the SDK's persistent mutation queue, which no suite proves. Journey 71
  ([../e2e.md](../e2e.md)) drives the path the app takes offline, not the
  queue draining.
- **A key with no copy behind it never lets the check settle.** A row no
  copy can hold, keyed into a household, is counted on the rows' side and
  never on the copies', so every sweep of that household would run a full
  pass that could not close the difference. That is why an online share
  reads its rows before keying them, and the full pass takes such a key
  off.
- **A full pass can outlast a change it read too early.** A category edit
  in another tab, or a row listed before a write reached the server, marks
  the household while the pass runs; a pass that cleared every mark on
  finishing would clear that one too. Hence the counter, read before the
  pass reads anything, and the marks made again once a category edit or a
  restore lands.
- **Sharing cannot stay wholly out of the initial bundle.** The seam's
  batch commit and server aggregate alone put it 712 bytes past its warning
  line, and the SDK's `arrayUnion` and `arrayRemove`, the transaction
  service's follow-up and the form's *Shared with* chips (QuickAdd loads
  the form eagerly) took it to 12.85 kB. `LedgerShareService`, which shares
  and sweeps, is reached only by dynamic import, never by a private row's
  write; `RowSharingService` by the form's dynamic import and the row
  lists' routes; the household figures by the household page's route.

## Known gaps

- **A copy can stay behind in a field until one of the author's devices
  running a current build next sweeps once its last full pass there is a
  week old.** The sweep runs only in the author's own signed-in, online
  client (at start-up, on reconnect, on a visit to `/household`, after a
  restore), so an author who never opens a current build again leaves the
  copy as it is, readable to the members. The check compares counts, and an
  edit follows only when the row as the editing device reads it is shared:
  a stale cache that does not yet show a share made elsewhere, or a client
  built before this change, leaves the copy for a full pass.
- **The journal is fragile.** It is lost with site data or in a private
  window, and two tabs writing it at once can drop an entry.
- **A share made offline can key a row no copy can hold,** since nothing is
  read before the keys queue. The row names the household with no copy
  behind it, so the counts stay apart until the next full pass takes the
  key off; the household stays marked while that key cannot be taken off.
- **A sweep can wait a long time.** The repair waits for this device's
  pending writes, and a server read has no deadline of its own on a network
  that silently drops traffic; a restore awaits the sweep at its end.
- **The chunk sizes are untested against the lookup ceiling,** which the
  emulator does not enforce. A commit of five copies that production counted
  differently would be refused, and the repair would meet the same refusal.
- **An unshare made offline** leaves the copy readable until the device
  reconnects; the confirmation says so.
- **Children of a re-parented category** keep their old bucket until the
  next sweep's full pass; a hard-deleted category's copies keep their
  snapshot until their rows are next projected.
- **`ledger:check` cannot see everything.** Not a path passed in as a
  parameter or built in another file, a collection name joined at run time,
  a path chosen by a conditional; not where a `copyFaithful` term stands,
  so one negated or inside an `||` reads as held; not whether every
  household query is built from a declared shape; not whether the rules and
  indexes are deployed.
