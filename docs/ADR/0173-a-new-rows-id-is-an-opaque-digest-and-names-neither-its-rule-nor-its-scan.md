# 173. A new row's id is an opaque digest, and names neither its rule nor its scan

**Status:** Accepted, implemented · **Date:** 2026-10-10 · **Issues:** #466

Reference documentation lives in [../household.md](../household.md),
[../recurring.md](../recurring.md) and
[../receipt-import.md](../receipt-import.md).

Amends
[0157](0157-a-transaction-is-private-until-its-owner-shares-it-and-a-household-sees-a-faithful-copy.md).
The copy, its id `{memberUid}_{sourceId}` and everything the rules hold it to
stand. What changes is the id the app chooses for a recurring posting and for
a row read off a scan queued offline: it no longer says where the row came
from. That narrows 0157's Known gap *A copy's id says where some rows came
from* to what *Known gaps* below lists: the rows that keep an old id, and
the later postings of a rule whose id one of them has shown.

Supersedes what
[0006](0006-multi-image-receipt-storage.md),
[0014](0014-recurrence-guards-and-anchors.md),
[0015](0015-reclaimed-receipts-replay-idempotently.md) and
[0142](0142-a-queued-receipt-lands-whole-or-says-what-it-dropped.md) say a
transaction id looks like. Their decisions stand:

- **0006's slot keys** are unchanged: `{transactionId}` for slot 0,
  `{transactionId}_{n}` beyond. Its reason that a suffix cannot alias another
  row's slot 0, that no transaction id contains an underscore, was already
  untrue of 0015's queued-scan rows. It now rests on a narrower fact: no id
  the app chooses, or Firestore draws, ends in an underscore and digits.
- **0014's posting** at `rec-<ruleId>-<occurrence time>` is now a digest of
  the same two values. It is still deterministic.
- **0015's and 0142's row** at `${queue row id}-${index}` is now, for an
  image queued from this change on, a digest of a seed stored with the image
  and the row's position. A replay still aims at the documents the first pass
  wrote. An image the earlier app queued keeps the old shape.

[0141](0141-a-recurring-rule-in-a-bad-state-is-repaired-where-its-data-allows-and-refused-where-it-does-not.md)
spells the posting's old id once, in passing. Its argument does not rest on
the shape, and its row is left alone.

## Context

A row shared into a household is copied to
`households/{hid}/ledger/{uid}_{txId}`, and the copy's `sourceId` is the
row's own id (0157). `copyFaithful` reads the row by that id, so a copy
cannot carry a different one without a lookup on every copy write. Most row
ids are Firestore auto-ids and say nothing. Two kinds said where the row came
from:

- **A recurring posting** was `rec-{ruleId}-{occurrenceMs}` (0014). Its
  copies told a member which shared rows one rule posted, and when each fell
  due. That is the recurring link 0157 withholds from the copy's fields. The
  day was already on the copy's `date`; the grouping by rule was what the id
  added.
- **A row read off a scan queued offline** was `{queue id}-{index}`, and the
  queue id is `img_{queuedMs}_{random}` (0015, 0142). It told a member
  that the row came from a scanned image, when the scan was queued, and which
  rows came from the same image.

No screen shows either id. The copy's data holds it, for developer tools, the
device's cache or the REST API to read. 0157 recorded this as a Known gap and
named #466.

Three facts kept the fix small:

- **Nothing parses either shape.** No production code tests a `rec-` or
  `img_` prefix or splits a row id.
- **The rules take any row id without a slash.** They take a copy's author
  from the part of its id before the first underscore, and `ledgerCopyId`
  refuses only an empty row id or one holding a slash. A hex digest passes
  `ledgerCopyId`, `projectRow` and `copyFaithful` as they stand.
- **Both call sites were already async**, and `crypto.subtle` was already in
  use, for the app lock's PIN hash (`pin-hash.utils.ts`).

What made it more than a rename is that both ids are idempotency keys. 0014's
claim and 0015's replay rely on a retry computing the same id as the first
attempt, so a random id would duplicate rows. The id had to stay a function
of inputs that survive a retry, and reveal none of them.

[0171](0171-second-copies-fold-into-one-copy-of-each-helper.md) had just
moved the queued-row id into one helper, `queueRowTxId`, which closed
0015's id-coupling gap. This record changes that helper's body and
signature, and owes 0015 nothing more on that gap.

## Decision

**A recurring posting and a row read off a queued scan are named by
`opaqueRowId`: the first 32 lower-case hex characters of a SHA-256 over the
row's kind and its inputs. The inputs are the ones that already made each id
deterministic, so a retry still writes the same document. A queued scan's
input is a random seed stored with the image, not the image's queue id.
Nothing is migrated.**

Each commit is cited by its subject.

### The digest

`feat(privacy): an opaque, deterministic row id helper` adds
`src/app/core/utils/opaque-id.utils.ts`, with
`opaqueRowId(kind: 'rec' | 'scan', ...parts: (string | number)[])`.

- **The preimage** is `JSON.stringify([kind, ...parts])`, encoded as UTF-8
  and hashed with `crypto.subtle.digest('SHA-256')`.
- **The id** is the digest as lower-case hex, cut to its first 32
  characters: 128 bits. `toHex`, beside it, turns the digest's bytes into
  hex, and the queue's seed is encoded by the same function, so row ids and
  seeds share one encoder.
- **The kind separates the domains.** It is the first element of the array,
  so a posting and a scan row never share a preimage, whatever their parts.
- **The same kind and parts give the same id** on every device, which is the
  property both callers need.

**Why an array and not a joined string.** A separator inside a part slides a
boundary: joined with `:`, `('a:b', 'c')` and `('a', 'b:c')` hash alike, and
so do the string `'5'` and the number `5`. A rule's id is usually an auto-id,
but a restore writes whatever id its file holds. The array keeps every
boundary and every type. The encoding was settled before any id was
persisted, so no row carries another.

**Two known answers hold it.** `opaqueRowId('rec', 'rule1', 1)` is
`c5f49f1c8d24ddb3423ef31980c05ce1`, and
`opaqueRowId('scan', '0123456789abcdef0123456789abcdef', 0)` is
`071013a6631227ed7c099b245af187c8`. Both were computed independently with
Node's `crypto`, and the spec case *pins the exact ids for known inputs*
says not to update them to make it pass. A changed preimage, prefix or cut
would give every persisted row a new id, and a retry would then duplicate the
row it had already written.

**Why 32 characters.** The issue asked for at least 20. 128 bits puts an
accidental collision among one account's rows far out of reach, and the id
is a document id and a Storage object name, where 32 characters cost
nothing.

**Why hex and not base64.** Standard base64 can emit `/`, which
`ledgerCopyId` refuses and which would split a Storage path segment.
base64url emits `_`, the separator of a receipt's slot suffix (0006), so a
row id could end the way a slot key does. Hex emits neither.

### A recurring posting

`fix(privacy): a recurring posting's id no longer names its rule` changes
`claimDueOccurrences`. It collects the due occurrence dates as before, then
computes `opaqueRowId('rec', rule.id, date.getTime())` for each, then makes
the `tx.set`s and the rule's update.

- **Every read still comes first.** The transaction's one read is the rule.
  The digests are computed after it, and every write follows them, so the
  order Firestore requires holds.
- **A retry writes the same ids.** A callback Firestore runs again re-reads
  the rule and derives each id from the rule and the occurrence alone, so an
  occurrence it posts again lands on the document it would have written the
  first time.
- **Nothing else moves.** The read-back of the posted rows takes the ids it
  is handed, and the row still stores `recurringId`. Only the id stopped
  spelling it.

The unit spec asserts the exact digest a claim writes. The smoke case *a
second claim of one occurrence leaves one row, at an opaque id* puts the
pointer back on a date already posted, as a racing device or a retried claim
would find it, and finds one row at the digest of the rule and that date.

### A queued scan

`fix(privacy): a queued scan's rows get ids that reveal neither the image nor
the time` changes the queue and the drain.

- **A seed per image.** `queueImage` writes `rowSeed`, 128 bits from
  `crypto.getRandomValues` as 32 hex characters, beside the queue id. The
  queue id is unchanged: `img_{queuedMs}_{random}` is still the IndexedDB
  key. `QueuedImage.rowSeed` is optional, because an entry the earlier app
  queued has none. No index reads it, so the database's version does not
  move.
- **A row's id.** `queueRowTxId(item, index)` is now async. For an entry with
  a seed it returns `opaqueRowId('scan', rowSeed, index)`. For one without,
  it returns the earlier app's `${id}-${index}`, so a drain that app left
  half done resumes at the documents it already wrote. The field's absence
  decides, not the id's shape: nothing tests for an `img_` prefix.
- **The seed cannot be left out by accident.** The parameter is
  `{ id: string; rowSeed: string | undefined }`. The key is required and its
  value may be undefined, so a caller holding only the queue id does not
  compile, rather than falling into the legacy branch. The helper's spec pins
  that with a `@ts-expect-error` on a bare `{ id }`.
- **The drain reads the seed from the owned record.** After it reads the
  image (`getQueuedImageAsFile`), it reads the record with `getQueuedImage`
  and passes `{ id, rowSeed }` down. A record that went in between fails the
  entry as *Image not found in queue*, exactly like a missing image. It never
  falls back to the legacy id (see *Things that only became apparent while
  building*).
- **The ids are computed once.** `createTransactions` works out every row's
  id before it writes anything, and the photo plan, the existence check and
  the write all use those ids.
- **The photo follows the row.** A receipt object is keyed on its row's id
  (0006, 0142), so a seeded entry's photo lands at
  `users/{uid}/receipts/{digest}`. The processor's smoke asserts that key.

The comment over `StorageService` that said no transaction id contains an
underscore now says what holds: no id ends in an underscore and digits.
Auto-ids are `[A-Za-z0-9]`, a digest is hex, and both older shapes end in a
hyphen and digits.

### The copies

No rules, projection or model changed. Two pins guard the shape. The model
spec's *takes an opaque row id whole* holds `ledgerCopyId` to a 32-hex row
id. The rules smoke's *lets a member copy a row whose id is an opaque
digest, and probe and clear a missing one* writes such a row and its
faithful copy, and reads and deletes a copy that was never written. Both
passed before the change; they hold it.

### No migration

Rows already written keep their ids. Re-keying a row is a delete and a
create of the document. Its receipt objects are keyed on the id (0006), and
its copies carry it (0157). All of that would have to follow, on every
device's schedule, for a leak no screen shows. The rows that keep a
revealing id are listed under *Known gaps*, and 0157's gap is narrowed to
them and to the later postings of a rule one of them names.

## What was rejected

- **A share key the rules read instead of the row id.** The issue weighed and
  rejected it. It adds a lookup to every copy write, and it would end the
  unshare and the delete that need no read.
- **A random id for each posting or row.** It reveals nothing and is not
  idempotent: a retried claim, or a replayed drain, would write a second row.
- **A digest of the queue id.** See *Departures from the issue*.
- **A keyed digest, with a secret per account.** A secret would have to
  reach every device of the account and could never change. It was also
  turned down on a premise that does not hold: that another account, which
  can never read a rule, never learns a rule's id. A copy of a posting named
  the old way, of one a tab of the earlier app posts, or of a restored row
  shows a household the rule's id, and the unkeyed digest then confirms
  that rule's later postings (see *Known gaps*). A secret salt per rule,
  kept on the rule where no member reads it, would close that without
  reaching across devices. It is a decision for the owner and is not taken
  here. The seed never leaves the device, so a queued scan's rows need
  neither.
- **Choosing the legacy branch by the id's prefix.** That would tie the
  drain to the queue id's format again, the coupling 0171 had just removed.
  The seed's absence is the marker.
- **Rewriting the rows already written.** See *No migration*.

## Consequences

- **A row the app names from now on has a 32-hex id.** Its copy is
  `{uid}_{digest}`, and a queued scan's photo is stored at `{digest}` and
  `{digest}_{n}`.
- **One rule can hold postings of both shapes**, the old ones before this
  change and the digests after it. One queued image's rows are all of one
  shape, the one its seed or its lack of one decides. Nothing reads either
  shape.
- **No rules, indexes, functions or IndexedDB version change.**
- **The browser run saw it end to end** in the emulator venue, as journey
  89. Overdue rules seeded for the run were claimed on load at 32-hex ids.
  One of them was recomputed independently:
  `0c7934c0cfef279744d803d345889ea4` is the digest of the rule `r-rent` and
  the occurrence at `2026-10-01T00:00:00Z`. A posting shared into a household
  got a copy at `{uid}_{digest}`, which the rules accepted and the household
  page rendered. An offline-queued scan's entry carried a 32-hex `rowSeed`
  beside its `img_` queue id.
- **The narrowing of 0157's gap is held by hand.** `adr-index:check` reads no
  narrowing (0172), so the two rows were checked by reading.

## Departures from the issue

- **The queued-scan input is a seed, not the queue id.** The issue proposed a
  digest of a random queue id and the row index. The queue id is not random:
  its first half is the moment the photo was queued, and its second is seven
  base-36 characters from `Math.random`, about 36 bits from a generator that
  is not cryptographic. A digest of it would be only as hard to reverse as
  guessing those. It also could not tell an image the earlier app queued, and
  may have half drained at `${id}-${index}`, from a new one, so an upgrade
  would drain such an entry again at new ids. The seed is 128 bits from
  `getRandomValues`, and its absence marks the earlier app's entries.
- **The preimage holds the kind.** The issue proposed a digest of
  `{ruleId}:{occurrenceMs}`. The kind keeps postings and scan rows apart, and
  the array keeps boundaries and types, as above.

## Departures from the plan

- **The preimage is an array, not a joined string.** The plan's
  `'<kind>:<parts joined by :>'` let a separator inside a part slide a
  boundary, and gave a number and its string the same id. It was replaced in
  a follow-up to the helper's commit, before any caller existed, and the
  known-answer pins came with it.
- **0157's gap is narrowed, not closed.** The plan wrote it as closed for new
  rows. But the gap's sentence, that a copy's id says where some rows came
  from, is still true: of every row written before this change, of rows
  drained from the earlier app's entries, of rows written by the earlier app
  still running, and of restored rows, and a rule one of them names stays
  linkable through its later digests. The index writes a gap made smaller
  and not gone as narrowed, as 0094's of 0006 is.
- **A record gone between the drain's two reads fails the entry.** The plan
  had the drain read the record once and did not say what a missing one
  meant. See below.

## Things that only became apparent while building

- **The drain reads the image and the record separately.** The first version
  read the seed with an optional chain, so a record that went between the
  two reads, deleted or another account's, left a seeded entry with no seed.
  Its rows would then have been written at `${id}-${index}`, which shows when
  the photo was queued and would duplicate any row an earlier pass wrote at a
  digest. A missing record now fails the entry before the model is asked, as
  a missing image does. The spec case *marks the image failed and writes
  nothing when its record is gone after the file was read* holds it.
- **0006's underscore argument had been untrue since 0015.** `img_` rows
  hold two underscores. No key ever aliased, because every such id ends in
  `-{index}` and a slot key ends in `_{n}`, but the comment said otherwise.
- **An occurrence that is posted again changes shape.** A rule whose walk
  cannot advance posts the same occurrence on every run (0014's first Known
  gap, still listed in [../recurring.md](../recurring.md)). Its deterministic
  id kept that to one row. Across this change the id changes, so see *Known
  gaps*.

## Known gaps

- **Some rows keep revealing ids.** Nothing migrates them, and a copy of
  one of them still says where its row came from:
  - a recurring posting written before this change, at
    `rec-{ruleId}-{occurrenceMs}`;
  - a row read off an image the earlier app queued, at
    `img_{queuedMs}_{random}-{index}`, whenever it is drained, since an entry
    without a seed keeps that shape;
  - a row written by a copy of the earlier app still running, in a tab
    opened before the deploy or an installed app not yet updated, whose
    claims and drains name rows the old way;
  - a row a `/data` restore writes back, which keeps the id its file holds.
- **Content still groups.** The copies of one rule's postings share their
  description, amount and category, and each copy's date is the day it fell
  due. A member who reads the copies can still guess which ones one rule
  posted. The id alone no longer confirms it; to a member who has learned
  the rule's id, it does (the next gap).
- **A rule's id, once seen, links its later postings.** The digest is
  unkeyed and its code ships in the app, and its inputs are the rule's id
  and the occurrence time, which the copy's `date` holds to the millisecond:
  the rules hold a copy's date equal to its row's. Once a household has seen
  a rule's id, in a copy of a posting written before this change, of one a
  tab of the earlier app posted, or of a restored row, a member can
  recompute the digest over any later copy's date and match it against the
  copy's `sourceId`. Every later digest posting of that rule stays linkable
  that way, and the rules a household is likeliest to have seen are the
  ones shared month after month. A secret salt per rule, kept where no
  member reads it, would close it; that is a decision for the owner, not
  taken in this record (see *What was rejected*).
- **An image queued by this app and drained in part by each app lands
  twice.** A tab of the earlier app that is still open ignores the seed and
  writes `${id}-${index}`. When one app's pass over such an entry does not
  finish and the other drains it again, the rows the first pass wrote are
  written a second time under the other shape, and both stay. It is the class
  of 0015's race between two tabs draining one queue, and it ends once every
  tab runs this app.
- **A rule whose walk cannot advance gains a second row.** It posted its
  pointer's occurrence at `rec-{ruleId}-{ms}` on every run. The first run
  after this change posts it at the digest, and the old row stays beside it.
  Later runs rewrite only the digest's row.
- **A digest needs a secure origin.** `crypto.subtle` exists only in a secure
  context, HTTPS or `localhost`. Opened over plain HTTP, for instance the dev
  server reached by its network address, every claim rejects, and the
  catch-up's existing catch skips each rule as it skips an offline one, so
  nothing posts. A drain fails the entry through its existing catch, which
  spends one of its three retries. `getRandomValues` works anywhere, so
  queueing still succeeds. Production serves HTTPS.
