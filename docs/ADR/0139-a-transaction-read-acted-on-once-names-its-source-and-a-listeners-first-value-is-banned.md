# 139. A transaction read acted on once names its source, and a listener's first value is banned

**Status:** Accepted, implemented · **Date:** 2026-09-18 · **Issues:** #427

Reference documentation lives in [../one-shot-reads.md](../one-shot-reads.md).

## Context

[ADR 0034](0034-a-correctness-read-enumerates-the-collection.md) named the
class: a value that is *acted on once* — persisted, counted, compared, or
used as a gate — must enumerate the collection, because a listener's first
emission is whatever this device happened to cache. Four shipped defects had
already come from `firstValueFrom(someListener())`, and
[docs/one-shot-reads.md](../one-shot-reads.md) is the registry of the reads
that were converted. What neither did was stop the next one being written,
and #427 found eight more.

**Why the first emission is a subset, precisely.** With the persistent local
cache on, the SDK decides whether to raise a cached snapshot to a brand-new
listener in `QueryListener.shouldRaiseInitialEvent`. If the snapshot is not
`fromCache` it is raised. Otherwise, the one thing that suppresses it is
`options.waitForSyncWhenOnline` — and that option is set, inside the SDK,
only on the internal listeners `getDoc()` and `getDocs()` build for
themselves. An ordinary `onSnapshot` leaves it false, so the last clause
decides: the cached snapshot is raised as long as it holds *any* matching
document, or the query has cached results at all. A device that browsed one
category last week therefore gets a confident, plausible, wrong answer
immediately — three rows out of six — and the correction arrives on a later
emission that `firstValueFrom` has already unsubscribed from.

The eight sites divided cleanly by what they do with the number.

- `InsightSnapshotService.buildAndWrite` took two reads over the live
  `getTransactionsInRange` — the month it is freezing and the longer window
  the frozen facts look back over. Both are **written to Firestore and never
  recomputed**. A month frozen from a cached subset is a wrong figure the
  account keeps.
- `DuplicateDetectionService` read the candidate window the same way. A twin
  outside the cached window reads as "no duplicate", and the import writes a
  second copy of a row the account already holds.
- `GroundingHistoryService` builds the rows a model is grounded on; the stale
  badge on the Insights tab (`currentInputs`, feeding `staleness()`) compares
  a recomputed figure against the stored one; the receipt manager enumerates
  the transactions that carry a receipt; and the transactions page resolves
  the single row a `?transactionIds=` deep link lands on.
- Five of the backup's six sections — categories, budgets, recurring, goals
  and insight snapshots — read through plain `exportAll()`s that would
  happily serve the cache. [ADR 0034](0034-a-correctness-read-enumerates-the-collection.md)
  and the registry both flagged this at the time and left it standing on an
  ordering argument: transactions are read first, and their server-only read
  rejects before the others run.

[ADR 0137](0137-a-closed-month-is-generated-only-against-a-loaded-profile-and-the-servers-own-list.md)
had already moved the generator's *missing-month* list to
`getCollectionFromServer` for exactly this reason. It did not move the rows
the months are built from, which is the other half of the same read.

## Decision

**Every transaction read that is acted on once goes through a named sibling —
`…Once` for a cache-capable one-shot, `…FromServer` for a strict one — and
`firstValueFrom` over a listener is a lint error.**

### The siblings, and which read got which

`TransactionService` gained four one-shot methods beside their listeners:
`getTransactionsOnce`, `getTransactionsWithReceiptsOnce` and
`getTransactionOnce` read through `getCollection`/`getDocument`;
`getTransactionsInRangeFromServer` reads through `getCollectionFromServer`,
which rejects rather than falling back when the server cannot be reached.
Each pair shares one private options builder — `transactionsOptions`,
`receiptsOptions`, the existing `transactionsInRangeOptions` — so the live and
one-shot queries cannot drift apart, and a shared `newestFirst` does the sort
the receipts query has to do client-side. Every one of them guards the
no-user case and returns `[]`/`null` without touching Firestore, the way the
file's older one-shot methods already did.

Only the two persisted reads in `buildAndWrite` take the server-only variant.
A frozen month is the one figure here that is never re-derived, and
generation already runs behind an online check and a server-only missing-month
list, so a rejection costs nothing that was not already deferred. The other
five take the cache-capable one-shot: duplicate detection's window, the
grounding history, the stale badge's recomputation, the receipt manager's
list and the deep link's single row are each either re-derived on the next
pass or re-asked by the user, and latency compensation makes this device's own
just-written rows visible, which a server read would not improve on. None of
them gates anything irreversible.

The five sibling `exportAll()`s are now server-only in their own right, and
the ordering argument the registry rested on is retired: a backup section that
serves the cache writes a short file that the deletion gate then accepts as
proof. `GoalService` also gained a cache-capable `listAll()`, and the search
dialog's chip names use that rather than the backup's read — see *Things that
only became apparent*.

### The gate

`eslint.config.js` carries two `no-restricted-syntax` selectors over
`src/app/**/*.ts` (specs exempt): one for `firstValueFrom(x.getTransactions(…))`
directly, one for the `.pipe(…)` form. Both key on the *method name*, on any
receiver, against an alternation of the twelve `Observable`-returning methods
`TransactionService` has today plus `subscribeToCollection`,
`subscribeToDocument` and `watch`.

A hand-maintained list of names is a list that goes stale, so
`scripts/check-lint-guards.mjs` — the script that already proves the import
bans resolve for the files they govern — re-derives the census from the
service's own source, scanning for signatures ending in `): Observable<` with
paren depth tracked so a wrapped signature still counts, and fails if any of
them is missing from the alternation. It also resolves both selectors against
two real files at severity error, resolves none against a spec, and carries a
`--self-test` that lints three fixtures through ESLint itself: the direct
form, the piped form, and a `…Once` call that must pass. `npm run
lint-guards:check` runs the self-test and then the check; `npm run lint` runs
the rule.

What the gate deliberately cannot see is written in its own docblock: a
listener held in a variable and passed as an identifier (`const rows$ = …;
await firstValueFrom(rows$)`), a double-chained `.pipe(a).pipe(b)`, and
another service's listener methods, which are not in the census.

### The proof, and the two clients it needed

`insight-snapshot-source.smoke.spec.ts` and
`duplicate-detection.smoke.spec.ts` run the real services against the
emulators with a listener held open over a *narrow* window, and compare what
gets stored against a server-side sum of the whole one.

The first version of both seeded their fixtures through the same client they
then read with, and both **passed on the unfixed code**. A client's own
acknowledged writes land in its own local cache, so a suite that writes its
fixtures through the client under test has a complete cache before it starts,
and no listener it opens can ever be caught short. Every existing smoke file
in this repo seeds that way, which is why none of them could ever have shown
a cache-subset defect.

The fix is two Firestore clients signed in as one account by email and
password (anonymous sign-in would mint a second uid and fail `isOwner`): a
`writer` seeds and stays out of the way, and a `reader` created afterwards
arrives cold, holding only what its own warm listener fetched. Against the
old services that harness fails exactly as predicted — the stored month
counted 3 of 6 rows and totalled 66 instead of 231, and the twin outside the
warmed window came back unflagged.

## What was rejected

- **A registry-driven script instead of a lint rule.** A script that reads
  `docs/one-shot-reads.md` and checks each named read still uses the method it
  claims would police the reads already found and say nothing about the next
  one. The lint rule bans the *shape*, which is the thing that recurs.
- **Banning `firstValueFrom` outright.** Four call sites use it correctly on
  something that is not a listener at all — a dialog's `afterClosed()` twice,
  an `HttpClient` request, and a deliberate wait on an import record with a
  `filter` and a `timeout`. A blanket ban would make those four write
  suppressions, and a suppression is a worse signal than a name.
- **`getCollectionFromServer` everywhere.** It rejects offline. Applied to
  duplicate detection it would turn an offline import into a failure rather
  than a slightly weaker check; applied to the deep link it would break a
  route that works fine from the cache. The strict variant is for figures that
  are frozen or gates that are irreversible, and saying so is the point of
  having two names.
- **Leaving `getTransactionById` alone.** The deep-link read is a document
  lookup, not a query, and the same argument about cached subsets does not
  apply to a single document. It was converted anyway, so the rule reads the
  same at every call site and the census has no exception to explain.
- **One client with `disableNetwork()` for the smoke proof.** It would produce
  a cold *read*, but not a cache holding a genuine subset — the state the
  defect needs. Two clients reproduce the real situation: another device wrote
  rows this one has never seen.

## Consequences

- `transaction.service.ts` gained the four methods and three private helpers;
  `insight-snapshot.service.ts`, `duplicate-detection.service.ts`,
  `grounding-history.service.ts`, `receipt-image-manager.component.ts` and
  `transactions.component.ts` each moved onto them and dropped `firstValueFrom`
  where nothing else in the file used it. `category.service.ts`,
  `budget.service.ts`, `recurring.service.ts` and `goal.service.ts` have
  server-only `exportAll()`s.
- The unit specs prove the *source*, not just the result: the mock Firestore
  service gained a `subscribeToDocumentSpy` of its own, so a spec can now
  assert a read went through `getDocument` and never opened a document
  listener. No spec had been reading the shared spy for a listener, so the
  split changed no existing expectation.
- Two emulator specs prove the defect class itself, through the two-client
  harness described above. Both files' docblocks state why one client cannot,
  because the next smoke spec wanting a partial cache will hit the same wall.
- `npm run lint` and `npm run lint-guards:check` both fail on a new
  `firstValueFrom` over a listener; the CI order is unchanged.
- [docs/one-shot-reads.md](../one-shot-reads.md) gains an entry per read, the
  gate, and the naming rule for the next one.

## Departures from the issues

- **The issue's line numbers had drifted.** Every site named in #427 was
  found by shape rather than by line, and one of them — the backup siblings —
  was not a `firstValueFrom` site at all: `exportAll()` was already a one-shot
  `getCollection`, and what it needed was the strict variant, not a different
  call shape.
- **The snapshot generator's month list was already fixed.** #427 lists it;
  [ADR 0137](0137-a-closed-month-is-generated-only-against-a-loaded-profile-and-the-servers-own-list.md)
  had already moved it to `getCollectionFromServer`. What this record adds is
  the rows those months are built from.
- **`getTransactionById` was converted although the issue did not ask.** See
  *What was rejected* — uniformity of the rule, not a defect.
- **The gate is two existing commands, not a new one.** #427 asks for a check;
  it is a lint rule (`npm run lint`) with its resolution and its census proved
  by `npm run lint-guards:check`, both already in CI, rather than a new
  `*:check` script and a new CI step.
- **The smoke's warmed subset stands in for a persistent cache.** The emulator
  has no persistent local cache, so what the two-client harness reproduces is
  a listener whose window is narrower than the account — the same asymmetry,
  arrived at by holding a narrow subscription open rather than by restarting a
  device. It is the strongest available proof, not the literal situation.

## Things that only became apparent while building

- **The search dialog and `nl-search` read the backup's siblings.** Making
  goal `exportAll()` server-only would have taken the offline fallback away
  from `warmUpGoalNames`, which runs unguarded when the dialog opens purely to
  have chip names ready. A rendered chip name is rendered-and-corrected, not a
  stored figure, so the rule points the other way: `GoalService.listAll()`
  (cache-capable, same options) exists for that caller, `exportAll()` stays
  strict for the backup, and `nl-search`'s own fallbacks stay strict because
  they already sit behind a connectivity gate. This was found by reading the
  call sites of a method that was being tightened, not by the issue.
- **There is no document-level server read.** `FirestoreService` has
  `getCollectionFromServer` and no `getDocumentFromServer`, so a single
  document acted on once can be one-shot but cannot be made strict. Nothing
  here needed one; the next thing that does will have to add it.
- **The warm query the smoke holds open needs a composite index**, which the
  emulator never enforces. The `categoryId` + `date` indexes this query needs
  already exist in `firestore.indexes.json`, so the concern is met — but it is
  worth knowing that a smoke spec adding a new two-field listener will look
  green and fail in production.

## Known gaps

- **The insight smoke's premise assertion is a tautology.** It resolves only
  once the warm listener has delivered as many rows as it expects, so it
  cannot fail the way the duplicate file's does; it should resolve on the
  first emission and assert ids.
- **That file's server control sum does not filter by `type`.** It equals the
  stored expense total only because every fixture row is an expense.
- **`goal.service.spec.ts` has no no-user case for `listAll`/`exportAll`,**
  mirroring a gap the recurring service's spec already had.
- **`transaction.service.ts` keeps growing.** Four more public methods and
  three helpers landed here; the file is past the size at which a reader can
  hold it, and nothing in this record addressed that.
