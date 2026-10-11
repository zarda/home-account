# 174. A posting's digest carries a salt only its rule holds, and the drain reads once

**Status:** Accepted, implemented · **Date:** 2026-10-11 · **Issues:** #486

Reference documentation lives in [../recurring.md](../recurring.md),
[../household.md](../household.md),
[../backup-restore.md](../backup-restore.md) and
[../receipt-import.md](../receipt-import.md).

Amends
[0173](0173-a-new-rows-id-is-an-opaque-digest-and-names-neither-its-rule-nor-its-scan.md).
Its digest, its array preimage, its two known answers and the seeded id of a
queued scan's rows stand. What changes is what a recurring posting's digest
is taken over: a salt kept on the rule, which only its owner reads, joins the
rule's id and the occurrence time, so a rule's id and a copy's date no longer
rebuild a posting's id. Before it posts the occurrence a stalled walk is
stuck on, the claim now looks for it under every id it may already hold. The
queue drain reads each entry once.

It closes a gap of 0014 and a gap of 0173.

- **0014's first Known gap** said a stored rule whose interval cannot
  advance is made inert, not repaired, and that every catch-up rewrites its
  one row and its rule document. The rewriting ends: a run that finds the
  stuck occurrence already posted writes neither. The decision that such a
  rule is not repaired stands.
- **0173's *A rule whose walk cannot advance gains a second row*** no
  longer holds. The claim finds the occurrence under any id it has had,
  `rec-{ruleId}-{ms}`, the unsalted digest or the salted one, and posts no
  second row.

It narrows 0173's *A rule's id, once seen, links its later postings* to the
postings written without a salt: those already written under 0173's digest,
and those a copy of the earlier app still running writes. `adr-index:check`
reads no narrowing
([0172](0172-a-closure-is-named-on-both-rows-and-the-adr-index-is-checked-against-the-records.md)),
so that relation is kept on both rows by hand.

## Context

0173 named a recurring posting `opaqueRowId('rec', rule.id, occurrenceMs)`.
That left three problems, two of them in its own Known gaps (#486).

- **The posting digest had no key.** Its inputs were the rule's id and the
  occurrence time. A posting's `date` is its occurrence, and the rules hold a
  copy's `date` equal to its row's, so a household copy carries every input
  but the rule's id. A household sees a rule's id in any copy of a row named
  `rec-{ruleId}-{ms}`: a posting written before 0173, one a tab of the
  earlier app posts, or a row a restore writes back. A member could then
  hash that id with any later copy's date and compare the result with the
  copy's `sourceId`. A match proves which shared rows one rule posted, the
  recurring link
  [0157](0157-a-transaction-is-private-until-its-owner-shares-it-and-a-household-sees-a-faithful-copy.md)
  keeps out of the copy's fields. 0173 turned down a secret per account and
  left a salt per rule to the owner, who chose it.
- **A rule that cannot advance posted its occurrence again under each new
  id.** The claim's walk pushes a date, then breaks when the next step does
  not move past it, and the pointer is written back unchanged, so every run
  posts that date again.
  [0014](0014-recurrence-guards-and-anchors.md) relied on the fixed `rec-`
  id to keep that to one row, and recorded the rewrite of the row and the
  rule on every run as its first Known gap. 0173's digest posted the
  occurrence again beside the old row. A salt would change the id a second
  time and add another.
- **The drain read each entry three times.** It peeked at the record for the
  owner check, read it again through `getQueuedImageAsFile` for the photo,
  and a third time through `getQueuedImage` for the row seed. Each `db.get`
  is a fresh copy of the whole record, photo included. The two later reads
  were filtered by owner, so an account change between reads failed the
  entry as *Image not found in queue* and spent one of its three retries,
  where the owner check would have left it pending.

Three facts kept the fix small:

- **Only the owner reads a rule.** `firestore.rules` lets nobody but the
  owner read `users/{uid}/recurring/{id}`, so a salt there is out of every
  member's reach.
- **Every device already reads the rule where the salt is needed.** The
  claim re-reads the rule inside its transaction, so the salt never has to
  travel between devices. That travel is what turned down a secret per
  account.
- **The backup file already carries it.** `exportToJSON` writes each rule
  as read. Only the restore's rebuild, which names its fields, would drop
  it.

## Decision

**A recurring posting's id is `opaqueRowId('rec', salt, ruleId,
occurrenceMs)`, where the salt is 128 random bits kept on the rule. Every
new rule is created with one. A rule without one gets one in the next claim
that posts for it, stored in the same update that moves its pointer. Before
it posts the occurrence a stalled walk is stuck on, the claim reads that
occurrence under every id it may already hold, and posts nothing if one
exists. The queue drain reads each entry once. Nothing is migrated.**

Each commit is cited by its subject.

### One seed generator

`refactor: one generator draws every 128-bit seed` moves the queue's private
`newRowSeed` into `opaque-id.utils.ts` as `newSeed()`: 128 bits from
`crypto.getRandomValues` as 32 lower-case hex characters. Beside it,
`isSeed(value)` accepts exactly that shape. The queue's `rowSeed` and a
rule's salt are both drawn by `newSeed`, and `isSeed` checks a rule's salt
against the shape `newSeed` draws, with no second copy
([0171](0171-second-copies-fold-into-one-copy-of-each-helper.md)).

### The rules hold the format, not the presence

`fix(rules): a recurring rule's salt is 32 lower-case hex characters` adds
`saltValid`: an absent key, or a string matching `^[0-9a-f]{32}$`.

- **On create** `saltValid` must hold, and it holds for a rule with no salt.
  So a rule may still be created without one, as a tab of the earlier app
  creates it.
- **On update** it is checked only when the write touches the key, the way
  `categoryId` is. A rule already holding a malformed salt, which only a
  write made before these rules or one that skips them (the Admin SDK, the
  console) can have stored, stays editable. A removed key passes, because
  `saltValid` holds for an absent one.
- **The model** gains `salt?: string` on `RecurringTransaction`.

### Every new rule holds a salt, and a restore keeps its file's

`fix(privacy): every new recurring rule holds a salt, and a restore keeps its
file's` changes `createRecurring` and the restore.

- **`createRecurring`** writes `salt: isSeed(options?.salt) ? options.salt :
  newSeed()` on both its paths, a chosen id and an auto-id. A handed salt is
  kept only when it is well formed.
- **The salt is an option, not a field of `CreateRecurringDTO`.** So
  `updateRecurring` cannot carry one, and an edit never changes it.
- **The restore** hands the file's salt on beside the rule's id and paused
  flag, spread in only when the file holds one. A rule from an older file is
  still handed exactly `{ id, isActive }` and draws a fresh salt. A malformed
  salt in the file is replaced, not skipped.
- **`BACKUP_SCHEMA_VERSION` stays 1.5.** Nothing is recomputed from the
  salt.

### A posting's id is keyed by its rule's salt

`fix(privacy): a recurring posting's id is keyed by a salt only its rule
holds` adds `recurringPostingId(rule: { id: string; salt: string },
occurrenceMs)`, which returns `opaqueRowId('rec', rule.salt, rule.id,
occurrenceMs)`. Every posting the claim writes is named through it.

- **The salt key is required**, as `queueRowTxId`'s `rowSeed` is. A caller
  holding only a rule's id does not compile, rather than falling back to the
  unsalted digest. A `@ts-expect-error` case pins that.
- **The claim settles the salt from its own read of the rule:**
  `isSeed(rule.salt) ? rule.salt : newSeed()`. A malformed stored salt counts
  as absent. The work list's copy of the rule is never consulted, so a salt
  another device stored since is the one used.
- **The salt is written only in the update that moves the pointer.** The
  claim adds it to the rule's update only when something posted and the salt
  differs from the one the rule held. A claim that posts nothing writes no
  salt. Nothing was named with that draw, so the next claim that posts draws
  again.
- **Two devices end on one salt.** If both claim a saltless rule at once,
  the later transaction retries, re-reads the committed salt, and finds
  nothing due or computes the same ids from it.
- **A capped drain** of a saltless rule stores the salt with its first 400
  postings, and the next claim reads it back.
- **`opaqueRowId` does not change.** Its array preimage keeps a three-part
  and a four-part input apart, so a salted id is never an unsalted one.

**A third known answer.** `opaqueRowId('rec',
'00112233445566778899aabbccddeeff', 'rule1', 1)` is
`e3e86f902d84ead0754cf709449f6596`, computed independently with Node's
`crypto`. It is pinned in *pins the exact ids for known inputs* and through
`recurringPostingId`, which also pins the argument order. 0173's unsalted
answer, `c5f49f1c8d24ddb3423ef31980c05ce1`, stays pinned beside it, because
the stalled lookup still computes that digest. A further case, *gives two
salts two ids, and neither is the unsalted id*, holds the key's effect.

### A stalled rule looks before it posts

This landed before the salt, as the issue asked, because the salt changes
the occurrence's id a second time.

`test: the claim's transaction fakes refuse a read after a write` comes
first. The unit fakes of `runTransaction` served a read in any order, while
the SDK rejects a read after a write, and the catch-up's catch treats a
rejected claim as offline. A lookup placed after a write would have passed
every unit case and skipped the rule silently in production.

- **One flag per transaction.** Each `runTransaction` call now gets its own
  flag, set by `set` and `update`. Its `get` rejects with the SDK's message
  once the flag is set.
- **Rows have a store of their own.** Documents other than the rule are
  served from a second map.
- **Every read is recorded.** Each path read is pushed to a list, so a case
  can assert exactly what a claim read.

The 137 cases already there passed against the strict fakes unchanged.

`fix: a stalled rule's occurrence is not posted again under a new id`
changes `claimDueOccurrences`.

- **It keys on the break.** The walk records that it ended on its safety
  break, the step that does not move past the date it holds. That tells it
  apart from the walk reaching the date it posts until, and from the cap.
  Whatever made the frequency stall, the lookup runs.
- **It reads the stuck date under every id it may hold.** When stalled, the
  claim takes the last date the walk pushed and builds its candidate ids:
  `rec-{ruleId}-{ms}`, the unsalted digest and, once the salt landed, the
  salted id when the stored salt is well formed. A salt drawn in this claim
  has keyed nothing yet, so its id is not asked.
- **Every read comes first.** The candidates are deduplicated and read
  together with `tx.get`, after the rule and before any write.
- **A hit drops the date.** If any candidate exists, the date is not posted.
- **`capped` is counted before the drop.** So a stall that lands on the
  400th date still reads as a full batch.
- **The rest of the update is unchanged.** The pointer and `lastProcessed`
  are written only when something posts, and an ended rule is still
  deactivated.
- **An update that would carry only `updatedAt` is not sent.** So a stalled
  rule whose occurrence is already posted is read and left alone. No row is
  rewritten, its `updatedAt` does not move, and since the salt is written
  only with a posting, it never gains a salt.

A rule that advances reads only itself, as before. A stalled rule costs up to
three reads beyond its own on every catch-up, and no writes once its
occurrence is posted.

### The drain reads once

`fix: the queue drain reads each entry once` changes `processQueuedImage`.

- **One read.** It reads the entry once, with `peekQueuedImage`, and takes
  the owner, the photo and the row seed off that record, so the three cannot
  disagree.
- **A missing record** fails as *Image not found in queue*.
- **Another account's record** is written back as pending and spends no
  retry. The owner is checked before the photo is built or handed on.
- **The photo** comes from a new synchronous `queuedImageFile(record)`.
- **The ids.** The event's id stays the key of the status writes and the
  row ids.
- **What went.** `getQueuedImage` and `getQueuedImageAsFile` are deleted,
  along with the branch for a record gone between two reads and its spec
  case.
- **The warning.** The outcome writes are back to the four 0142 counts.
  `warnIfDropped` now warns *Outcome not recorded; the queue is closed or
  the entry is gone*.
  [0142](0142-a-queued-receipt-lands-whole-or-says-what-it-dropped.md)
  quotes the earlier text, *the queue is closed*, under *A status write
  answers*.
- **"One read" means one read through the queue's API by the processor.**
  `updateImageStatus` still makes its own `db.get` for each status write.

The spec case *calls peekQueuedImage once and makes no other read of the
entry* holds it, with *builds the photo from the record it read*.

### No migration

Rows already written keep their ids, as under 0173. A posting written under
0173's unsalted digest stays where it is. A second row a stalled rule gained
under 0173 is an ordinary row, and nothing deletes it.

## What was rejected

- **A secret per account.** It would have to reach every device of the
  account and could never change. A salt per rule rides on the document the
  claim already reads, so every device holds it the moment it claims.
- **A salt the rules require, or keep from changing.** A required one would
  refuse every rule a tab of the earlier app creates. An immutable one would
  refuse a restore, which overwrites a rule whole with no merge. An earlier
  app's restore over a salted rule leaves no salt at all, so the update rule
  lets the key go too. The rules hold the format and nothing else.
- **Writing a drawn salt on every claim.** The plan's first draft did. A
  stalled rule whose occurrence is already posted would then be written on
  every run, to store a salt that names nothing, and its `updatedAt` would
  move each time: the rewrite this record ends.
- **A lookup by query.** A query on `recurringId` and `date` would find the
  occurrence under any id. But a client transaction reads documents only by
  reference and cannot run one.
- **Pausing the rule after one posting.** It still duplicates the row on the
  first run after an id change, and it reverses 0014's choice to leave such a
  rule as it is.
- **Replacing the unsalted known answer.** See *Departures from the issue*.

## Consequences

- **A rule created from now on holds a salt from its first write.** A rule
  written before this change gains one with its next posting, and has none
  until then. A stalled rule whose occurrence is already posted never gains
  one.
- **One rule can hold postings of three shapes.** They are `rec-` ids from
  before 0173, unsalted digests from between the two changes, and salted
  digests since. Only the stalled lookup reads any of them.
- **The rules change, and deploy with the merge**
  ([0077](0077-merges-deploy-what-they-changed.md)). The rules in production
  before it accept a salt of any shape, and the new ones accept a rule with
  none. So the web and rules deploys can land in either order.
- **Nothing else moves.** No index, function, analytics event or IndexedDB
  version changes, and the backup's schema version stays 1.5.
- **The initial bundle.** `recurring.service.ts` grew by 502 bytes and
  `opaque-id.utils.ts` by 139. The drain gave back 315 bytes in the queue's
  chunk, and the entry chunk, which holds the processor, shrank by 199 net.
  With the work of #487 and #488, that moved the initial budget's warning to
  2.408 MB. [../performance.md](../performance.md) records the measured
  figure.
- **The browser run saw it end to end** in the emulator venue on
  2026-10-11, as journey 90.
  - **Salted postings.** The seeded rule `r-rent` had three postings, and
    each id was recomputed independently from the rule's salt. The unsalted
    digest of each occurrence matched no row.
  - **A shared posting.** A *Gym membership* posting shared into a household
    gave a copy whose `sourceId` is the salted digest.
  - **A stalled rule already posted.** It was seeded over REST, monthly with
    `dayOfMonth: -60`, beside a `rec-` row for its stuck date. Over two
    loads it gained no row, no write and no salt.
  - **A fresh stalled rule.** It posted once, at its salted id, and was not
    written again on the next load.
  - **The drain.** The IndexedDB log for one entry read get, put
    *processing*, get, get, put *failed*. That is one read by the processor
    between the two status writes, where there were three.

## Departures from the issue

- **The unsalted known answer stays.** The issue said the `'rec'` known
  answer changes. The stalled lookup still computes the unsalted digest, for
  postings written under 0173, so that pin stays and the salted answer joins
  it.
- **The stall is keyed on the walk's break, not on the interval.** The issue
  said only rules stored before the interval floor are affected. That is
  not so. `frequencyValid` in the rules checks the type and the interval,
  and `validateFrequency` in the service only the interval, so a monthly rule
  with `dayOfMonth: -60` is accepted today and stalls on its first step. The lookup runs whenever
  the walk ends on its break, whatever made it stall.
- **The drain had a second window.** The issue named the record-gone branch
  as spending a retry when only the account changed. The photo read before
  it had the same window: it was filtered by owner too, so an account change
  between the owner check and that read failed the entry the same way. One
  read ends both.
- **A saltless rule gains its salt with its first posting, not its first
  claim.** The issue's acceptance asked that a rule seeded without a salt
  hold one after its first claim. A claim that posts nothing writes no salt,
  so a stalled rule whose occurrence is already posted stays saltless. That
  keeps the issue's own wording, the salt written in the update that moves
  the pointer, and keeps such a rule unwritten.

## Departures from the plan

- **The stalled smoke case reads the salt its first claim stored.** The plan
  had the smoke cases of the stalled lookup stand unchanged once the salt
  landed. The case for a fresh stalled rule had computed the unsalted digest
  before the first catch-up. Under the salt, that claim draws one, so the
  case now reads the salt the claim stored and expects the salted id. Every
  other assertion stands, and its second catch-up now proves the salted
  lookup against the emulator.
- **The strict fakes build each transaction in one place.** The plan had
  each fake's `callFake` keep its own flag. One builder makes the transaction
  for each call instead, with the same one flag per call, so the fake is not
  written twice.

## Things that only became apparent while building

- **A stalled rule's posting was overwritten on every run.** 0014 recorded
  the rewrite as a fresh `createdAt`. But the claim's `tx.set` writes the
  whole document, so any edit made to that row was undone by the next
  catch-up. A found row is now skipped, and the edit stays.
- **The owner cannot be checked before the bytes are copied.** The plan,
  and the first comments, said the processor checks the owner "before any
  bytes are copied". `db.get` returns a structured clone of the whole record,
  photo included, so the one read already copies them. The check comes
  before the photo is built or handed on, and the comments say so.
- **One spec case described a state that can no longer happen.** The case
  for a photo read and a record gone existed only because the reads were
  separate. It went with the branch. Its claim that nothing is written is
  kept on the missing-record case.

## Known gaps

- **Postings already written without a salt stay linkable.** Nothing
  migrates them. A posting written under 0173's unsalted digest, between that
  change's deploy and this one's, can still be tested by a member who knows
  its rule's id, as 0173 describes. A posting written before 0173 still
  spells its rule's id outright.
- **An earlier app still running keeps posting unsalted digests.** A tab
  opened before the deploy, or an installed app not yet updated, claims with
  0173's code. It writes unsalted ids and no salt, so its postings are
  linkable the same way until every tab runs this app.
- **A stalled rule restored from a file without a salt gains one row.** The
  restore draws a fresh salt for a rule its file holds none for, and
  recomputes the pointer from the start date. A stalled rule's pointer
  cannot move past its stuck date, so it lands back on it. If the rule had
  posted that occurrence under a salt the file predates, the lookup asks the
  new salt's id, finds nothing, and posts the occurrence once more. Later
  runs find that row. The issue's reasoning that a restore re-posts nothing
  rests on the pointer being recomputed past now, which a stalled rule's
  cannot be.
- **An out-of-range `dayOfMonth` or `monthOfYear` can still be stored.**
  `frequencyValid` checks the type and the interval, and `validateFrequency`
  only the interval. So a restore, the service and the rules all accept
  `dayOfMonth: -60`, and such a rule stalls on its first step. The lookup
  keeps it to one row, because it keys on the break, but the rule is stored
  broken. Bounding both fields in the service and the rules is a follow-up
  for the owner; no issue is filed yet.
- **An account change during the model call still lands the rows in the
  new account.** The one read removes only the windows between reads. The
  owner is checked once, before the drain waits for the account's keys and
  calls `processReceipt`, and `addTransaction` looks up the account when it
  writes. So a sign-out and sign-in on the same page during a slow call
  writes the receipt to the account now signed in. The issue leaves this
  window open.
