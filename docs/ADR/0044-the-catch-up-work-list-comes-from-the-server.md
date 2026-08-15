# 44. The catch-up work list is answered by the server or not at all

**Status:** Accepted, implemented · **Date:** 2026-08-15 · **Issues:** #298

Extends [0034](0034-a-correctness-read-enumerates-the-collection.md). Reference
documentation lives in [../one-shot-reads.md](../one-shot-reads.md) and
[../recurring.md](../recurring.md).

## Context

[ADR 0034](0034-a-correctness-read-enumerates-the-collection.md) named the
shape: a correctness-bearing read enumerates the collection, never a listener's
first emission. The recurring catch-up was the shape's last surviving instance
— [ADR 0042](0042-a-derived-figure-agrees-with-the-set-that-produced-it.md)
had already written it down as a known gap wanting its own issue.
`catchUpRecurringTransactions` awaited one emission of the live listener,
purely for its side effect of filling the `recurringTransactions` signal, and
`processRecurringTransactions` then filtered the `activeRecurring` computed
for due rules.

It survived the #244/#247 sweep because it posts rather than reads, and
because the claim layer makes it look safe. Every claim re-reads the rule
document fresh on the server inside a Firestore transaction, so a *stale*
entry in the work list cannot double-post or overwrite a user-edited
occurrence. What the transaction cannot defend against is an entry that never
made the list. With the persistent cache enabled, a cold or offline start's
first emission is exactly that — short or empty, whatever the session last
saw — so due rules were never candidates, nothing was claimed, and the run
resolved as a success that had done nothing. Behind the dashboard's
fire-and-forget catch, the empty success was indistinguishable from a real
one: a user opening the app on a flaky connection saw no rent in Recent
Transactions and no signal anywhere that the engine had decided there was
nothing to do.

The await also coupled rendering state to engine timing. For a session that
never opened the pages that subscribe, the catch-up's listener await was the
only thing populating the signal, so what live readers saw depended on when
the engine happened to run.

## Decision

**The work list is read through `getCollectionFromServer` and passed into
`processRecurringTransactions` as a required argument.** The engine's input is
a value the caller names, not shared mutable state; the engine neither reads
nor writes the signal, and the pages' own subscriptions maintain it. The three
recurring queries — the live listener, `listAll()` and this read — share one
private options builder so they cannot drift.

Server-or-nothing was the issue's open question, and three things decided it.
Posting is acted on once, not rendered and corrected — the first question in
one-shot-reads.md. The claims need the network anyway, so the server read
gates nothing that was not already gated: a cached work list on an offline
device only feeds a loop in which every claim rejects, which is the same
silent no-op wearing more code. And a cache-served empty set reporting
success is precisely the failure being fixed — `getDocs` falls back to the
cache when the server is unreachable, so the plain variant would fix the
online cold start while leaving the offline empty-success intact. Offline the
read now rejects, the run rejects with it into the dashboard's existing
non-fatal catch, and the next online open posts everything still due;
`nextOccurrence` never advanced, so the deferral is loss-free.

### The alternatives that were rejected

**Plain `getCollection`.** Covers the online cold start, where `getDocs`
waits for the server, but offline it serves the cache and the run resolves
empty and successful again. An unexplained `getCollection` here would read
exactly like the current bug (ADR 0038's lesson), which is why the choice is
also written at the call site.

**Reusing `listAll()`.** It is deliberately cache-tolerant for its two
callers: the snapshot generator gates on connectivity itself and wants the
latency-compensated cache, and the backup's recurring section is protected by
the transactions read that precedes it. Hardening `listAll()` to the server
would change both behaviours as a side effect of fixing a third caller.

**Keeping the signal fill alongside the enumeration.** Pre-warming shared
state for someone else's benefit is the workaround #247 already removed for
budgets; whoever needs the signal holds a subscription, and the engine is not
in that business.

## Consequences

- Every dashboard open costs one server read of the recurring collection —
  rules number in the tens for any real account, and the read replaces a
  listener round trip of the same shape.
- An offline dashboard open now rejects the catch-up instead of resolving
  with nothing. The rejection is invisible by design — the dashboard catch is
  fire-and-forget and the engine self-heals on the next online open.
- The engine's unit tests pass work lists as arguments; the seed-the-signal
  fixture pattern ADR 0034 called out is gone from the engine's suite, and
  three specs now prove the source (enumeration used, listener never opened,
  rejection propagated) rather than only the result.

## Known gaps

- The deferral is silent. A user who opens the app offline still sees no
  indication that recurring posting was postponed; the issue accepted this —
  deferral is not loss — and surfacing it would be new UI, not a fix.
- The enumeration→claim window can still race another device, resolved as
  before by the claim's fresh server read. A rule created elsewhere after the
  enumeration is missed until the next run.
- The emulator smoke test proves the enumeration contract — posts with the
  signal deliberately never populated — not the warm-cache trigger itself; the
  emulator has no persistent cache, and the spec's doc block says so.
