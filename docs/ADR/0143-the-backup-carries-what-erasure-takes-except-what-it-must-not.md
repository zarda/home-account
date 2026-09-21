# 143. The backup carries what erasure takes, except what it must not

**Status:** Accepted, implemented · **Date:** 2026-09-21 · **Issues:** #433

Reference documentation lives in [../backup-restore.md](../backup-restore.md).

## Context

Before an account is deleted the app offers a backup, and calls it a full
one. [0018](0018-account-deletion-is-a-client-side-cascade.md) made erasure a
client-side cascade over every stored kind, and
[0029](0029-every-stored-kind-has-one-door.md) went further: every stored kind
has one door, *checked against the deletion cascade* by a spec that fails the
build when a kind is neither catalogued nor excused.

Nothing ever checked the backup the same way.

The cascade removes fourteen stored kinds. The file carried six —
transactions, categories, budgets, recurring rules, goals and insight
snapshots. Saved searches, stored answers, category memory, tag memory and
import history were erased and never offered, and
`docs/account-deletion.md` said so in its Known gaps in one sentence:
"Erasure is complete; the export is not." That sentence was itself
incomplete — it named five of the missing kinds and omitted tag memory and
feedback.

So the offer shown at the point of no return overstated what it could give
back, and the only record of the gap was a bullet in a document the person
deleting their account has no reason to read.

Two smaller fidelity gaps sat alongside it. A restored category came back in
creation order because `addCategory` always assigns `maxOrder + 1`
([0031](0031-a-restore-merges-into-the-row-it-finds.md) recorded the
reshuffle). And two bulk paths — the restore and the CSV import — recomputed
every affected budget once per row, where the AI import had been passing
`skipBudgetRecalc` and recalculating once per category since
[0034](0034-a-correctness-read-enumerates-the-collection.md).

## Decision

**Backup 1.5 carries five more sections: `savedSearches`, `searchAnswers`,
`categoryMemory`, `tagMemory` and `imports`.** Eleven of the fourteen stored
kinds now travel.

**Three kinds are named, reasoned exclusions, and the spec reads the list.**

- `secrets` — the encrypted provider API keys. `backup-restore.md` promises
  the file holds no credentials, and a backup lands in a Downloads folder.
- `securityEvents` — the sign-in audit trail. `firestore.rules` gives it
  `allow update: if false`, so a restore that writes at the backup's own id
  is a create the first time and a refused update the second, which breaks
  the service's stated contract that restoring the same file twice is a
  no-op. And `SecurityLogService.record` stamps `occurredAt` to now and
  `platform` to the restoring device, so a restored log would claim every
  historical sign-in happened during the restore. Restored into a different
  account it would forge sign-in history for an account that never had it.
- `feedback` — already excluded in writing, and for two reasons now: the same
  `allow update: if false`, and creating a feedback document fires
  `onFeedbackCreated`, which mails the operator. A restore of fifty entries
  sends fifty emails.

**A spec checks backup coverage against the cascade, the way
`stored-data.service.spec.ts` checks deletion coverage.** `BACKUP_SECTIONS`
is typed `readonly (DeletionStep & keyof ExportData)[]`, so a section must be
both a field the file holds and a kind the cascade erases — the compiler
catches half the drift before the spec runs — and every remaining step is
either a section or carries a one-sentence `NOT_IN_BACKUP` reason. The
arithmetic is pinned as its own case: fourteen stored kinds, eleven sections,
three exclusions. **This is the structural half of the decision.** Adding the
five sections closes today's gap; this is what stops the next collection
being added to the cascade and forgotten by the file.

**A restore door writes the record as it was written, which is four
transformations, not a raw write.** None of the five collections had an
id-preserving create, and three had public APIs actively wrong for a restore
— `TagMemoryService.remember` increments `count` and merges `suppressed`,
`CategoryMemoryService.remember` increments too, `ImportHistoryService`
restamps `importedAt` and takes an auto id, `SearchHistoryService.recordRecent`
prunes to ten and refuses short queries. Each collection gets a `restore()`
that:

1. **Strips `id`.** Every read maps `{ id: doc.id, ...doc.data() }`, so the
   file carries an `id` field that is not a stored field —
   `search-answer.model.ts` says so in a comment. `answerCreateValid`,
   `categoryMemoryValid` and `tagMemoryValid` all use `hasOnly()` and none
   lists `id`, so a literally verbatim write is denied by rule.
2. **Sets `userId` to the current account — or omits it.** Saved searches,
   stored answers and import history require it and must carry the restoring
   account's id, not the file's, or a restore into a second account is
   denied. Category and tag memory `hasOnly()` *forbid* the field.
3. **Revives timestamps.** JSON gives `{seconds, nanoseconds}`; every rule
   checks `is timestamp`. A stored answer's `scope.startDate` and `endDate`
   are the exception and stay `yyyy-MM-dd` strings, which is what
   `answerScopeValid` requires.
4. **Writes at the record's own id**, which for the two memory collections is
   the merchant key — `categoryMemoryValid` requires `d.merchantKey` to equal
   the document id, so the key *is* the id and no other design passes.

**A restored category keeps its `order`**, through a new `options.order` on
`addCategory` — read with `typeof === 'number'`, not `??`, because position
zero is a position.

**Both bulk paths pass `skipBudgetRecalc` and recalculate once per affected
category**, after the budgets section rather than after the transaction loop:
`createBudget` already recomputes the budgets it writes, so the loop exists
for budgets the account already held that the file does not carry.

**The dialogs say what the file covers and what it does not.** The backup
offer stops calling it "full" and names the three exclusions; the deletion
warning is corrected against the cascade; the restore confirmation carries
eleven counts. The specs key the messages against `BACKUP_SECTIONS` and
`NOT_IN_BACKUP`, so a fourth exclusion must be given a word before the suite
passes.

## What was rejected

**Restoring through the existing `remember` / `saveImportHistory` APIs**, as
0031's "recreate through the same create APIs" rule would suggest. For these
five that rule cannot be applied: there is no create API that can write a
chosen `count`, because `remember` increments it. 0031's rule is amended
here, not followed.

**Widening the rules so `securityEvents` and `feedback` could be restored
idempotently.** It would make an audit trail rewritable — the one property
that makes it an audit trail — and would re-send every feedback email.

**Exporting all seven and restoring only five.** It would put a sign-in
history into a file that sits in a Downloads folder, to no end: nothing would
ever read it back.

**Enforcing the per-collection caps after a restore.** `MAX_SEARCH_ANSWERS`,
`MAX_RECENT_SEARCHES` and `IMPORT_HISTORY_LIMIT` are create-path prunes, so a
restore into a non-empty account can exceed them. Pruning afterwards would
delete rows the user has just asked to have back. Saved searches and stored
answers prune themselves on their next ordinary write; the import limit bounds
a subscription rather than the collection, so there is nothing stored to
exceed.

**Pruning a stored answer's `scope.categoryId` against the categories the
restore wrote**, the way `imports.transactionIds` is pruned. A scope describes
a question, not a foreign key; an answer over a window that is now empty is
still a true record of what was asked.

## Consequences

- **1.5 is a hard fork for older builds.** `SUPPORTED_BACKUP_VERSIONS` is a
  closed membership list, not a `>=` comparison, so every build shipped before
  this one refuses a 1.5 file outright rather than silently dropping its new
  sections. A 1.4 file still restores here.
- The backup offered before erasure now covers eleven of fourteen kinds, and
  the three it does not are named on screen.
- A 1,000-row restore performs one budget recalculation per affected expense
  category instead of one per row.
- **`setDocument` stamps `updatedAt: Timestamp.now()` on every write**, so the
  class docblock's claim that a restore never stamps from today was false and
  is rewritten rather than left standing beside its fix. The second-restore
  contract survives it: `updatedAt` is in every rule's optional set, and no
  reader treats it as identity.
- A new shared util, `backup-revive.utils.ts`, owns the `{seconds}` →
  `Timestamp` revival for all five doors. It delegates to `parseDateInput`, so
  no `new Date(` is added outside the dates module, and it answers `null`
  rather than today for an unreadable slot — required stamps fall back at the
  call site, optionals are dropped rather than invented.

## Departures from the issue

**Five sections, not seven.** #433 asks for "Backup 1.5 with the seven
sections, each optional". Two of the seven cannot be restored idempotently and
one of those two would re-send mail; both became documented exclusions. The
acceptance criterion "a restore into an empty account rebuilds each" is met
for the five that can be rebuilt.

**The `transactionIds` prune is narrower than the issue implies.** An id is
dropped only when the file carried that transaction *and* the restore failed
to write it. An id the file never mentions is left alone — it was never
offered to this restore, and the account being restored into may already hold
it. `successCount` moves with the pruned list, because
`transactionIds.length === successCount` is the field's stated contract.

**Two of this work's commits carry their content under another lane's subject
line.** Three concurrent lanes shared `{en,ja,tc}.json` and
`data-management.component.spec.ts`, and `git commit --only <path>` commits
the working-tree state of that path whoever wrote it. Nothing is lost; the
history is imprecise, and it is recorded here rather than quietly rewritten.

## Things that only became apparent while building

**The rules would have refused the obvious implementation.** "Write the record
back verbatim" is the natural reading of the task and is denied on three of the
five collections, because every read injects an `id` the closed field sets do
not allow. It was found by reading `hasOnly()` clauses, not by a failing spec —
the unit specs drive mocked services and never reach a rule, which is exactly
what the emulator round-trip exists for.

**The emulator case had no natural RED**, because the doors were already
implemented by the time it was written. It was proved non-vacuous by mutation
instead: adding `userId` to the `categoryMemory` door turned both new cases
red, with the write landing in `summary.skipped`. A green spec that has never
been seen to fail is not yet evidence of anything.

**The memory doors had to touch the in-memory signal as well as Firestore.**
`ensureLoaded` is idempotent per user, so a door that only wrote would leave
the AI-settings screen showing the pre-restore map until the next sign-in.

**`maxOrder` reads a signal, so the old behaviour was worse than a reshuffle.**
A fast restore loop can hand several categories the same `order`, not merely
put them in creation order. The docblock now says so.

## Known gaps

- **Three kinds still cannot be given back.** Erasure remains more complete
  than the export, by design now rather than by omission, and
  `docs/account-deletion.md` says which three and why.
- **A restored stored answer can name a category or goal the restore skipped.**
  Display-only, and deliberate — see What was rejected.
- **`toDate()` in `backup-restore.service.ts` is a second implementation of
  the timestamp revival** and drops sub-second precision (`seconds * 1000`,
  no `nanoseconds`). It predates this wave and every caller feeds it
  whole-second stamps, so nothing observable turns on it, but it and
  `backup-revive.utils.ts` should converge.
- **The caps are recorded, not enforced**: a restore into a non-empty account
  can leave more than fifty stored answers or ten recent searches until the
  next ordinary write prunes them.
- **Nothing checks that a 1.5 file written here can be read by a 1.5 build
  elsewhere.** The round-trip is within one build; the version list is the only
  cross-build contract, and it is a list, not a comparison.
