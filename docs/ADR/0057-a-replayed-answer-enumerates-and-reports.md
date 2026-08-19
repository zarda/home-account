# 57. A replayed answer enumerates, and reports

**Status:** Accepted, implemented · **Date:** 2026-08-19

Applies the rule in
[0034](0034-a-correctness-read-enumerates-the-collection.md) to a read that
predates its registry, and narrows the snapshot behaviour described in
[0016](0016-aggregate-answers-persist-as-snapshots-that-refresh-locally.md).
Reference documentation lives in [../one-shot-reads.md](../one-shot-reads.md)
and [../smart-search.md](../smart-search.md).

## Context

The Refresh button under a stored smart-search answer did nothing the user
could see. Two independent defects produced the same silence.

`NlSearchService.computeAggregate` fetched the rows it does arithmetic on with

```ts
const fetched = await firstValueFrom(
  this.transactionService.getTransactionsInRange(scope.startDate!, scope.endDate!)
);
```

`getTransactionsInRange` is a `subscribeToCollection`, which is a bare
`onSnapshot` with no metadata filtering. With `persistentLocalCache` enabled
the first emission is the cache-served one, and `firstValueFrom` takes exactly
that and unsubscribes before the server's correction arrives.

What comes out is then **written down** — `recordAnswer` persists it on a live
search, `refreshAnswer` on every Refresh. That is precisely the case
[0034](0034-a-correctness-read-enumerates-the-collection.md) covers, and
`docs/one-shot-reads.md` states the rule in as many words: a value that is
acted on once — "persisted, summed into a stored figure" — must enumerate the
collection, and `firstValueFrom(subscribeToCollection(...))` is never the
answer. Four shipped defects (#160, #244, #247, #298) were this same shape.
This was an unregistered fifth.

The consequence is worst exactly where the feature is used. The Search history
page can be reached by deep link, and the dialog opens from any page. A record
whose window the session never browsed has no rows in the cache for that
range, so the "refresh" recomputed an empty answer and wrote it back over a
good one. The figures did not move, or dropped to zero.

Why it survived: the end-to-end smoke test covers this path and passes. The
emulator has no persistent cache, so the listener's first emission there is
already the complete one — the smoke test could never have seen the defect.
The unit specs mocked `replayAggregate` outright and asserted the wiring
around it.

The second defect is that the button said nothing either way:

```ts
try {
  const fresh = await this.nlSearch.replayAggregate(...);
  await this.history.refreshAnswer(record.id, fresh);
  this.analytics.trackSearchHistoryUsed({ action: 'refresh' });
} finally {
  this.isRefreshing.set(false);
}
```

A `finally` with no `catch`. A rejected replay or a denied write escaped as an
unhandled rejection while the spinner cleared. And a refresh that genuinely
succeeded with unchanged figures looked identical to one that had failed —
identical, in fact, to a button that was not wired up at all.

## Decision

**A figure that will be persisted enumerates the collection, whatever
computed it.** The rule already existed; what was missing was applying it to a
read reached through a service that does arithmetic rather than through one
that obviously writes. `getTransactionsInRangeOnce` is the one-shot sibling,
sharing a single options builder with the live variant so the two queries
cannot drift — the arrangement `getExpensesInRangeOnce` already uses.

Plain `getCollection`, not the server-only variant. Working the three
questions in `docs/one-shot-reads.md`: the value is acted on once, so it must
enumerate; but it gates nothing irreversible — a stored answer is a snapshot
the user can refresh again, and nothing is erased or sent on the strength of
it — so an offline replay may legitimately answer from the cache. This is the
`getExpensesInRangeOnce` tier, not the `exportAll` tier.

**An action whose visible result may be identical to doing nothing must say
that it happened.** Refresh is the pure case: a correct recomputation over
unchanged data produces the same numbers it started with. Silence is only
adequate feedback when the outcome is self-evident on screen, and here it is
not. Both outcomes are reported through the notification service the rest of
the app uses, and the failure is logged.

### The alternatives that were rejected

**`getCollectionFromServer`.** Strictly safer, and wrong for this read. It
would make Smart search fail outright offline, and the answer it produces is
recoverable by pressing the button again — the property that made the strict
read right for the backup (which gates account deletion) and the recurring
catch-up (which posts) is absent here.

**Restamping `computedAt` only, so the label visibly moves.** This treats the
symptom. The label would advance while the figures stayed wrong, which is a
worse state than an obviously dead button: it asserts freshness that was never
computed.

**Leaving the refresh silent and relying on the figures changing.** This is
what shipped, and it is the assumption that a recomputation always changes
something. It does not.

**Fixing this at the two call sites instead of in `computeAggregate`.** The
live search path records its answer too, through the same function, and would
have kept persisting a cache-derived figure. One chokepoint fixes both.

## Consequences

- `TransactionService` gains `getTransactionsInRangeOnce` and a private
  `transactionsInRangeOptions` shared with `getTransactionsInRange`.
- Both the live search's recorded answer and every Refresh now compute from
  the enumerated collection.
- Refresh reports success or failure in the dialog and on the history page,
  with two new catalog keys in all three locales.
- `nl-search.service.spec.ts` no longer stubs `getTransactionsInRange` at all;
  roughly a dozen stub sites moved to the one-shot method. A spec still
  stubbing the live method would be a signal the fix had been undone.
- `docs/one-shot-reads.md` gains its fifth registry entry and a summary row.

## Things that only became apparent while building

- The regression test states the defect more clearly than prose does. Seeded
  the way it presents — rows in the collection, nothing in the listener's
  first emission — the old code answers `0` where it should answer `100`.
- The two defects are independent but mutually concealing. Enumerating alone
  would have fixed the numbers while leaving the button mute; reporting alone
  would have cheerfully confirmed a zeroed answer as updated.
- The smoke suite's blindness here is structural, not an oversight in how it
  was written. It is worth restating in the registry each time: a smoke test
  proves enumeration and rule acceptance, never the cached-first emission.

## Known gaps

- No sweep was run for other `firstValueFrom(subscribeToCollection(...))`
  sites. This one was found by tracing a single button; the registry names
  five, and nothing enforces that a sixth cannot be added.
- The notification does not distinguish "recomputed, and the figures changed"
  from "recomputed, and they did not". Both are successes and both say so;
  telling them apart would be more informative and needs a comparison the
  service does not currently return.
