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
a plausible-looking subset. Four shipped defects came from exactly this, and
this page is the registry of the reads that must never do it.

The reasoning and the rejected alternatives are in
[ADR 0034](ADR/0034-a-correctness-read-enumerates-the-collection.md). The
first instance of the class was #160, fixed before the rule had a name.

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

Ordering note: transactions are read first among the backup's sections, and
the other five (`categories`, `budgets`, `recurring`, `goals`, insight
snapshots) use plain one-shot `exportAll()` reads that *would* serve the cache
offline. They are safe today only because the transactions read runs first and
its rejection aborts the whole export. Do not reorder these reads without
converting the siblings to `getCollectionFromServer`.

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
cannot change between them. `exportAll()` is the same enumeration and now
delegates to `listAll()`, so the backup and the generator cannot drift apart.

The **live** Insights tab is the other question, and it takes the other answer:
it reads the signal, recomputes when the signal changes, and persists nothing.
A rule saved with the tab open has to move the total immediately.

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

## The deliberate live readers

These are not exceptions to the rule — they are the other question. The
dashboard's period window, the reports, the insight chips' baseline and the
budget/goal page subscriptions all *want* the cached emission first: they
paint stale-then-correct, stay subscribed, and never persist what they read.
If one of them ever starts writing its value down, it moves into the registry
above.

## Summary

| Read | Feeds | Mechanism | Offline |
|---|---|---|---|
| `deleteAllTransactions` | the account wipe | `getCollection` | queues deletes against the cache |
| `exportAll` (transactions) | backup + CSV files, the deletion gate | `getCollectionFromServer` | **rejects; export reports failure** |
| sibling `exportAll()`s | the backup's other five sections | `getCollection` | cache fallback — safe only because transactions read first |
| `recalculateBudgetsForCategory` | the recalculation work list | `getCollection` | cache, incl. latency-compensated writes |
| `getExpensesInRangeOnce` | the persisted `spent` sum | `getCollection` | cache, incl. latency-compensated writes |
| `listAll` (recurring) | a frozen month's recurring figures | `getCollection` | cache, incl. latency-compensated writes |
| catch-up work list (recurring) | posted occurrences + budget recalcs | `getCollectionFromServer` | **rejects; deferred to the next online open** |

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

In specs, prove the source, not just the result: seed the collection with the
signal left empty (the mock now records `subscribeToCollection` and
`getCollectionFromServer` on their own spies), and remember the emulator has
no persistent cache — a smoke test proves enumeration, not the cached-first
emission itself.
