# Reads that must see the whole collection

The app talks to Firestore two ways, and they answer different questions.
`subscribeToCollection` opens a live listener: with the persistent local cache
enabled, it answers *"what did this session last see?"* immediately and
corrects itself when the server replies. `getCollection` (a `getDocs`
underneath) asks once and, while online, waits for the server.

For anything painted on screen, the listener's cached-first answer is the
point — the dashboard renders instantly on a plane and heals itself on wifi.
The trap is taking **one** value from a listener: `firstValueFrom` grabs the
cached emission and unsubscribes before the correction arrives. The cache
holds whatever narrow windows the session happened to browse, so the value is
a plausible-looking subset. Eight issues' worth of shipped defects came from
exactly this, and this page is the registry of the reads that must never do
it.

Precisely: the SDK raises a cached first snapshot to a new listener whenever
the local store holds any matching document, unless the listener was built
with `waitForSyncWhenOnline` — and that option is set only on the internal
listeners `getDoc()` and `getDocs()` build for themselves. An ordinary
`onSnapshot` always gets the cached answer first if there is one.

The reasoning and the rejected alternatives are in
[ADR 0034](ADR/0034-a-correctness-read-enumerates-the-collection.md) and, for
the naming rule and the lint gate below,
[ADR 0139](ADR/0139-a-transaction-read-acted-on-once-names-its-source-and-a-listeners-first-value-is-banned.md).
The first instance of the class was #160, fixed before the rule had a name.

## Deleting the account's transactions (#160)

`TransactionService.deleteAllTransactions` enumerates the collection and
deletes what it finds. Reading the in-memory signal here once deleted the
window on screen — usually the current month — and reported the wipe complete.
Its doc comment is the original statement of the rule: the signal only holds
what a subscription happened to deliver.

## The backup and CSV exports (#244)

`TransactionService.exportAll()` feeds both "Export full backup" and "Export
transactions CSV", and it is the strictest read in the app: it goes through
`FirestoreService.getCollectionFromServer`, which rejects when the server
cannot be reached instead of falling back to the cache.

It is server-only because the full backup's boolean **gates account
deletion**. A backup written from the cache is a truncated file reported as
success, and the deletion flow would then accept it as proof the data is safe
before erasing the real thing. Offline, the export now fails loudly — the
error notification shows, `exportFullBackup` resolves false, and the deletion
flow stops.

The other five sections (`categories`, `budgets`, `recurring`, `goals`,
insight snapshots) are server-only too, since #427. They used to be plain
one-shot `exportAll()` reads that would have served the cache offline, safe
only because the transactions read runs first and its rejection aborts the
whole export — a correctness argument that rested entirely on statement
order, in a method nobody would think twice about reordering. Each section
now rejects on its own account, and the ordering is back to being a detail.

## The budget recalculation's work list (#247)

`BudgetService.recalculateBudgetsForCategory` runs as a side effect of every
transaction mutation and answers "which budgets does this category have?" by
enumerating the collection with the same `categoryId + isActive` clause the
live `getBudgetsByCategory` uses. It used to filter the `budgets()` signal,
which only the dashboard and the budgets page populate — so a write from the
share-target import, or from a session reloaded on `/transactions`, found no
budgets and silently skipped the update. There is no retry inside a period:
once skipped, `spent` stayed wrong until the next rollover.

Plain `getCollection`, not the server-only variant: nothing here gates an
irreversible action, latency compensation makes just-written local rows
visible, and a figure that lags is re-derived by the next recalculation.

## The expense rows that recalculation sums (#247)

`TransactionService.getExpensesInRangeOnce` is the one-shot sibling of the
live `getExpensesInRange`, and `recalculateBudgetSpent` uses it because the
sum it produces is **persisted** as the budget's `spent`. A live listener's
first emission can be missing rows another device wrote; writing that short
sum down makes the miss durable. The two variants share one private
options-builder so their queries cannot drift apart.

## The snapshot generator's rule set (#255)

A monthly insight snapshot's recurring figures depend on which rules exist:
detected groups an active rule already covers are dropped before the totals are
taken (see [ADR 0042](ADR/0042-a-derived-figure-agrees-with-the-set-that-produced-it.md)).
The result is written to Firestore and frozen, so it is acted on once, not
rendered and corrected.

`RecurringService.listAll()` enumerates the collection, and
`InsightSnapshotService` calls it before writing. Reading
`recurringTransactions` instead would have been wrong twice over. It is a
listener signal, so it holds whatever a subscription happened to have delivered
— and `generateClosedMonths` is fired-and-forgotten at dashboard open, before
any page subscription has filled it (the engine itself never touches the
signal; ADR 0044). An empty signal is
indistinguishable from an account with no rules, and the month would freeze with
a double-counted total nothing would ever report as stale.

Read once per generation run rather than per month: a backfill writes up to
twelve documents, each already issuing two range queries, and the rule set
cannot change between them. `exportAll()` is the same enumeration with the
stricter source the backup section above describes, and the two share one
private query-options builder, so the backup and the generator cannot drift
apart.

The **live** Insights tab is the other question, and it takes the other answer:
it reads the signal, recomputes when the signal changes, and persists nothing.
A rule saved with the tab open has to move the total immediately.

## The snapshot generator's missing-month check (#426)

Before it writes anything, `generateClosedMonths` has to know which closed
months already have a document — and it used to answer that from
`firstValueFrom(this.watch())`, the trap in its plainest form. Under the
persistent local cache, a listener's first emission on a device that has not
opened Reports recently is whatever this session last cached, and that can
lag behind a month the same account already wrote elsewhere. A lagging
emission reads as "missing," `buildAndWrite` reissues that month at revision
1, and the rules refuse it outright: an `insightSnapshots` update must carry
a strictly higher `revision` than what is stored (`firestore.rules`, the
`insightSnapshots` match block). A fresh install hit this on its very first
generation — the cache held nothing yet, every closed month looked missing,
and the months the account already held on the server turned the write into
a `permission-denied`.

The fix reads `getCollectionFromServer`, the strict variant. A month either
has a document or it does not, and the answer decides which months get a
write — acted on once, not rendered and corrected — so a cache-served guess
is not an acceptable substitute for the truth. It costs one query for the
whole run, the same shape as the rule read beside it. Offline, the read
rejects into the method's own catch; that is no new loss, since the
connectivity gate already keeps this from running offline in the first
place, and a connection that drops mid-run just defers the whole backfill
to the next online open. The listener itself still exists for what it is
good at — the Insights tab opens its own subscription to render the stored
list and correct it live, and never persists what it reads from it.

## The recurring catch-up's work list (#298)

`RecurringService.catchUpRecurringTransactions` posts every occurrence that
came due since the app was last open, and what it posts from is the work
list. It used to await one emission of the live listener and filter the
signal — the exact `firstValueFrom` trap above, surviving the #244/#247 sweep
because it posts rather than reads. The claim layer defends against a stale
entry (each claim re-reads the rule on the server inside the transaction) but
not against a missing one: a cold or offline start's first emission is short
or empty, so the run posted nothing and resolved as success.

`getCollectionFromServer`, the strict variant, because posting is acted on
once and the claims need the network anyway — a cache-served work list on an
offline device only feeds a loop of rejecting claims. Offline the read
rejects, the whole run rejects into the dashboard's fire-and-forget catch,
and the next online open posts everything still due; the rule pointers never
advanced, so the deferral is loss-free. The list is passed into
`processRecurringTransactions` as an argument, and the engine no longer
touches the `recurringTransactions` signal at all — the page subscriptions
own it. The decision and its rejected alternatives are in
[ADR 0044](ADR/0044-the-catch-up-work-list-comes-from-the-server.md).

## The smart-search aggregate's rows (#84 sweep)

`NlSearchService.computeAggregate` does the arithmetic behind every smart-
search answer, and the figure it produces is **persisted**: `recordAnswer`
stores it on a live search, `refreshAnswer` rewrites it on every Refresh of a
stored one. It read `firstValueFrom(getTransactionsInRange(...))` — the trap
in its plainest form, surviving the #244/#247 sweep because the function looks
like a calculation rather than a read.

The Refresh button was where it showed. The Search history page is reachable
by deep link and the dialog opens from anywhere, so the session frequently has
no rows cached for the record's window; the listener's first emission was
empty, and Refresh recomputed a zeroed answer and wrote it over a good one.
The figures did not move, and nothing said why.

`getTransactionsInRangeOnce`, sharing one options builder with the live
variant. Plain `getCollection`, not the server-only read: nothing here gates
an irreversible action — a stored answer is a snapshot the user can refresh
again — so offline may legitimately answer from the cache. The decision and
its rejected alternatives are in
[ADR 0057](ADR/0057-a-replayed-answer-enumerates-and-reports.md).

Note what could not have caught this. The end-to-end smoke test for the
history page exercises exactly this refresh and passed throughout: the
emulator has no persistent cache, so a listener's first emission there is
already complete. The proof that the source changed lives in the unit spec,
seeded the way the defect presents — rows in the collection, nothing in the
listener's first emission.

## The rows a snapshot is frozen from (#427)

[ADR 0137](ADR/0137-a-closed-month-is-generated-only-against-a-loaded-profile-and-the-servers-own-list.md)
moved the generator's *list of missing months* to the server. It left the
rows those months are built from on the live listener:
`InsightSnapshotService.buildAndWrite` took `firstValueFrom` over
`getTransactionsInRange` twice — once for the month it is freezing, once for
the longer window the frozen facts look back over — and both figures are
written to Firestore and never recomputed.

Both now read `getTransactionsInRangeFromServer`, the strict variant. A month
frozen from a cached subset is a wrong total the account keeps: it renders as
authoritative, it is what a later month compares itself against, and the only
way out of it is a regeneration somebody has to ask for. Generation already
runs behind an online check and the server-only month list, so a rejection
here defers a backfill that was never going to run offline anyway.

`currentInputs`, which feeds the Insights tab's stale badge, is the same read
with the other answer: `getTransactionsInRangeOnce`, cache-capable. It
recomputes a figure to compare against the stored one and persists nothing —
the same reasoning `NlSearchService.computeAggregate` uses.

## The window a duplicate is looked for in (#427)

`DuplicateDetectionService` asks whether an incoming import row already exists
in the account, and it asked a live listener for the candidate rows. A twin
outside whatever window this session had cached came back as *no duplicate*,
and the import wrote a second copy of a row the account already held — a
verdict acted on once, in the plainest form the class takes.

`getTransactionsOnce` with the same filters, cache-capable rather than
server-only: an import should not fail because the network is down, this
device's own just-written rows are in the cache through latency compensation,
and the review step's duplicate banner is shown to a person who can overrule
it either way. Offline the check is weaker than online, which is the honest
trade; offline it is not *absent*.

## Three reads that are re-derived, and take the plain one-shot (#427)

- `GroundingHistoryService` assembles the rows a model is grounded on
  (`getTransactionsOnce` with a start date). A short set makes a weaker
  answer, not a stored wrong one.
- The receipt manager enumerates the transactions carrying a receipt
  (`getTransactionsWithReceiptsOnce`) to show what is attached. It used to
  filter the signal, so a session that had not browsed the right window saw
  fewer receipts than exist.
- The transactions page resolves the single row a `?transactionIds=` deep
  link lands on (`getTransactionOnce`). This one is a document read, not a
  query, so the cached-subset argument never applied to it — it was converted
  so that the rule, and the lint selector below, read the same at every call
  site.

## The backup's other five sections (#427)

Described under [#244](#the-backup-and-csv-exports-244) above: `categories`,
`budgets`, `recurring`, `goals` and insight snapshots each read through
`getCollectionFromServer` now, rather than resting on being sequenced after
the transactions read.

## The deliberate live readers

These are not exceptions to the rule — they are the other question. The
dashboard's period window, the reports, the insight chips' baseline and the
budget/goal page subscriptions all *want* the cached emission first: they
paint stale-then-correct, stay subscribed, and never persist what they read.
If one of them ever starts writing its value down, it moves into the registry
above.

**`GoalService.listAll()` exists because the rule points both ways.** The
smart-search dialog warms up its goal *chip names* when it opens, and it used
to get them from `exportAll()`. Making that read server-only for the backup's
sake would have taken the chip names away from an offline dialog, to no
purpose: a rendered name is rendered-and-corrected, exactly what the cache is
good for. So the goal service has two enumerations — `listAll()`
(`getCollection`) for the caller that paints, `exportAll()`
(`getCollectionFromServer`) for the caller that writes a file the deletion
gate trusts — sharing one options builder. `nl-search`'s own fallbacks stay
server-only, because they already sit behind a connectivity gate.

Tightening a shared read is where this comes up: check every caller before
moving a method to the strict variant, because one of them may be painting.

## Summary

| Read | Feeds | Mechanism | Offline |
|---|---|---|---|
| `deleteAllTransactions` | the account wipe | `getCollection` | queues deletes against the cache |
| `exportAll` (transactions) | backup + CSV files, the deletion gate | `getCollectionFromServer` | **rejects; export reports failure** |
| sibling `exportAll()`s | the backup's other five sections | `getCollectionFromServer` | **rejects; export reports failure** |
| `recalculateBudgetsForCategory` | the recalculation work list | `getCollection` | cache, incl. latency-compensated writes |
| `getExpensesInRangeOnce` | the persisted `spent` sum | `getCollection` | cache, incl. latency-compensated writes |
| `listAll` (recurring) | a frozen month's recurring figures | `getCollection` | cache, incl. latency-compensated writes |
| snapshot generator's missing-month check | which closed months get written | `getCollectionFromServer` | **rejects; deferred to the next online open** |
| catch-up work list (recurring) | posted occurrences + budget recalcs | `getCollectionFromServer` | **rejects; deferred to the next online open** |
| `getTransactionsInRangeOnce` | a stored smart-search answer's figures | `getCollection` | cache, incl. latency-compensated writes |
| `getTransactionsInRangeFromServer` ×2 | a frozen month's totals and its window's facts | `getCollectionFromServer` | **rejects; deferred to the next online open** |
| `getTransactionsInRangeOnce` (stale badge) | the Insights tab's recomputed-vs-stored comparison | `getCollection` | cache, incl. latency-compensated writes |
| `getTransactionsOnce` (duplicates) | the import's duplicate verdict | `getCollection` | cache, incl. latency-compensated writes |
| `getTransactionsOnce` (grounding) | the rows a model is grounded on | `getCollection` | cache, incl. latency-compensated writes |
| `getTransactionsWithReceiptsOnce` | the receipt manager's list | `getCollection` | cache, incl. latency-compensated writes |
| `getTransactionOnce` | the row a `?transactionIds=` link lands on | `getDocument` | cache |
| `listAll` (goals) | the search dialog's chip names | `getCollection` | cache — a rendered value, deliberately |

## The gate

The registry above is a list of reads somebody already found. Since #427 the
*shape* is banned outright, so the next one fails before it is committed.

`eslint.config.js` carries two `no-restricted-syntax` selectors over
`src/app/**/*.ts` (specs exempt): one matching `firstValueFrom(x.method(...))`
directly, one matching the `firstValueFrom(x.method(...).pipe(...))` form.
They key on the **method name**, on any receiver, against an alternation of
the twelve `Observable`-returning methods `TransactionService` has today plus
`subscribeToCollection`, `subscribeToDocument` and `watch`. `npm run lint`
runs them.

A hand-written list of names goes stale the moment a thirteenth listener is
added, so `scripts/check-lint-guards.mjs` re-derives the census from the
service's own source — signatures ending in `): Observable<`, with paren depth
tracked so a wrapped signature still counts — and fails if any name is missing
from the alternation. It also proves both selectors resolve at severity error
against real files and against none in a spec, and its `--self-test` lints
three fixtures through ESLint itself: the direct form, the piped form, and a
`...Once` call that must pass. `npm run lint-guards:check` runs both halves;
CI runs it with the other static gates.

**What it cannot see**, and what therefore still needs a reader:

- a listener held in a variable and passed as an identifier —
  `const rows$ = svc.getTransactions(); await firstValueFrom(rows$)` — the
  argument is no longer a call expression;
- a double-chained `.pipe(a).pipe(b)`, where the outer `.pipe`'s object is
  another `.pipe` call rather than the listener;
- another service's listeners. The census is `TransactionService`'s, plus the
  three generic `FirestoreService` methods.

Four `firstValueFrom` call sites remain in `src/app`, all deliberate and none
over a listener: two `MatDialog.afterClosed()`s in the receipt manager, an
`HttpClient` request in the translation service, and a `filter` + `timeout`
wait on an import record.

## When you add another one

Three questions, in this order.

**Is the value acted on once, or rendered and corrected?** Rendered-and-
corrected wants the live listener. Acted-on-once — persisted, summed into a
stored figure, counted, deleted against, or used as a gate — must enumerate
the collection. `firstValueFrom(subscribeToCollection(...))` is never the
answer; if you need one value, there is a one-shot method or there should be.

**Does it gate something irreversible?** Then the cache is not an acceptable
answer even from `getDocs` — use `getCollectionFromServer` and let offline
fail loudly. A wrong file, a wrong count or a wrong "yes" is worse than an
error.

**Does latency compensation actually cover you?** The local cache includes
this device's unsynced writes, so a read-after-own-write is safe. It does not
include another device's writes, or the rows a warm cache never fetched. If
the value must reflect the account rather than the session, only the
collection read does that — and only the server read does it offline.

**Name it after its source.** A method ending `...Once` reads through
`getCollection` (or `getDocument`); a method ending `...FromServer` reads
through `getCollectionFromServer` and rejects offline. The name is the only
thing a call site shows a reader, so it has to be the thing that differs, and
a pair of variants shares one private query-options builder so the two queries
cannot drift apart.

In specs, prove the source, not just the result: seed the collection with the
signal left empty (the mock records `subscribeToCollection`,
`subscribeToDocument` and `getCollectionFromServer` on their own spies, so a
read through `getDocument` can be told from a document listener).

**A smoke test needs two clients to show this at all.** The emulator has no
persistent cache, and — more to the point — *a client's own acknowledged
writes land in its own local cache*. A suite that seeds its fixtures through
the client it then reads with has a complete cache before it starts, so no
listener it opens can ever be caught short, and the spec passes on the broken
code. Every smoke file in this repo written before #427 seeds that way.

Use a `writer` client that seeds and stays out of the way, and a `reader`
client created afterwards, arriving cold, holding only what its own warm
listener fetched. Both sign in as the same account **by email and password** —
anonymous sign-in mints a second uid and fails `isOwner`.
`insight-snapshot-source.smoke.spec.ts` and `duplicate-detection.smoke.spec.ts`
are the two worked examples, and against the pre-#427 services they fail
exactly as the defect predicts: 3 rows counted of 6, a total of 66 instead of
231, and a twin outside the warmed window reported as no duplicate.
