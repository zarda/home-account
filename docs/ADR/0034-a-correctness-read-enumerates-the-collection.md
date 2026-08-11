# 34. A correctness-bearing read enumerates the collection, never a listener's first emission

**Status:** Accepted, implemented · **Date:** 2026-08-11 · **Issues:** #244, #247

Reference documentation lives in [../one-shot-reads.md](../one-shot-reads.md).

## Context

The app enables Firestore's persistent local cache unconditionally. That gives
a live listener a useful property and a treacherous one: when the cache already
holds a result for a query, `onSnapshot` raises that cached snapshot first and
the server's answer second. For a component keeping a list on screen this is
exactly right — paint something now, correct it in a moment. For code that
takes **one** value and acts on it, `firstValueFrom` over that listener returns
whatever the cache happened to hold and unsubscribes before the correction
arrives.

The cache holds what the session browsed. Every transaction query the UI runs
is filtered, date-ranged or paged, so after a normal session the cache is a
proper subset — roughly the current month.

#160 established the failure once: `deleteAllTransactions` enumerated the
in-memory signal, deleted a slice of the account and called it complete. The
fix gave it a real collection read and a comment saying why. Two more instances
of the same shape survived that sweep, and they were the two worst ones left:

- **The full backup and the CSV export** read transactions through
  `firstValueFrom(getAllTransactions())` — the only section of the backup not
  going through a one-shot `exportAll()`. A warm cache produced a silently
  truncated file, reported as success. The full backup's boolean gates the
  account-deletion cascade, so a truncated blob could be accepted as proof the
  data was safe and then the real data erased (#244). The comment directly
  above the call asserted the invariant the line below it broke.
- **`recalculateBudgetsForCategory`** picked its work list out of the
  `budgets()` signal, which only a dashboard or budgets-page subscription
  populates. A session that wrote an expense without mounting either — the
  share-target import, a reload on `/transactions` — recalculated against `[]`
  and silently did nothing. `spent` then stayed wrong for the rest of the
  period, because the self-healing path only fires on a stale period stamp
  (#247). `RecurringService` even pre-warmed the signal by hand so this method
  could find its budgets — the workaround documented the defect.

The suite could not see any of it. Unit specs stubbed the live source with
`of([])` — a single-emission observable, so cached-then-server never occurs —
or seeded the signal immediately before calling the method under test, which
is the pre-warm workaround restated as a fixture. And the shared mock recorded
`subscribeToCollection` calls into the same spy as `getCollection`, so a spec
could not even assert which of the two a method used.

## Decision

**A read whose result is persisted, or gates an irreversible action, enumerates
the collection.** `recalculateBudgetsForCategory` reads its work list with
`getCollection` and the same two-equality clause `getBudgetsByCategory` already
uses live; the covering composite index already existed. The expense rows the
recalculation sums are read through a new one-shot,
`getExpensesInRangeOnce`, sharing its query-options builder with the live
variant so the two can never drift — the sum it produces is written to the
budget document, which makes it correctness-bearing even though the live query
looks identical. The recurring catch-up's manual `getBudgets()` pre-warm is
deleted.

**The read that gates deletion is answered by the server or not at all.**
`TransactionService.exportAll()` goes through a new
`FirestoreService.getCollectionFromServer` (`getDocsFromServer` underneath).
A plain `getDocs` falls back to the cache when the device is offline, which
would reintroduce the truncated-backup-reports-success state in the one place
it is unacceptable. Offline, the export now rejects, the existing catch shows
the failure notification, and the deletion gate holds. The budget recalculation
deliberately stays on plain `getCollection`: latency compensation covers the
common case there, an offline recalc that threw would fail the write that
triggered it, and a lagged figure is recovered by the next recalculation.

**A batch caller owns its recalculation.** Fixing #247 made the import wizard's
per-row recalc real — dozens of rows, each re-reading and rewriting the same
budgets. `addTransaction` gains `skipBudgetRecalc`, and the wizard collects the
distinct expense categories of the rows that actually saved, then recalculates
each once after the loop — the shape the recurring engine already used.

Rejected alternatives:

- *Inspecting `fromCache` on the listener and waiting for a server snapshot.*
  Rebuilds `getDocsFromServer` by hand around an API designed to stay open,
  and leaves every future caller one `firstValueFrom` away from the same bug.
- *Pre-warming the signal before each recalculation* — the removed workaround.
  It fixes one call site at a time, every new entry point starts broken, and
  the fix lives in the caller instead of the method that owns the invariant.
- *Server-only reads for every backup section.* Only the transactions read
  gates anything; it runs first, so its rejection aborts the whole export
  before a stale section could be written. Recorded as a known gap below
  because that ordering is load-bearing.

## Consequences

- Every transaction mutation that touches an expense now costs one budgets
  query it previously took from memory. The query is a two-equality read of a
  collection that is nearly always a handful of documents; the import wizard,
  the one path that multiplies it, dedupes it away.
- `getAllTransactions` is deleted. The export paths were its only callers, and
  its name was the trap — it never returned "all transactions", it returned
  the first emission.
- An offline "Export full backup" and "Export transactions CSV" now fail with
  the existing error notification instead of silently writing whatever the
  cache held. This is a behaviour change: the old path could produce a file
  offline. It produced the wrong file.
- The budgets signal is now written only by its subscription — no method
  populates it as a side effect, so what the dashboard renders and what the
  recalculation reads are decoupled on purpose.

## Things that only became apparent while building

- The shared `MockFirestoreService` recorded `subscribeToCollection` into
  `_getCollectionSpy`. Splitting the spies was a precondition for the specs
  the acceptance criteria asked for — "asserts `getCollection` is called and
  `subscribeToCollection` is not" was previously unwritable — and six existing
  assertions turned out to be verifying the wrong method's spy.
- Two existing specs encoded the bug as a fixture: the budget spec seeded the
  signal immediately before `recalculateBudgetsForCategory`, and the
  transaction spec seeded it before asserting the post-expense recalc. Both
  now seed the collection, which is the fix restated as a test.
- `firstValueFrom` over the emulator behaves like the fix already landed — the
  emulator serves no persistent cache, so the first emission is the server's.
  The smoke suites therefore prove collection enumeration (empty signal,
  never-subscribed session), not the literal cached-first-emission trigger,
  and say so in their doc blocks.
- The recurring spec asserted the pre-warm happened
  (`expect(getBudgets).toHaveBeenCalled()`), so removing the workaround flips
  an assertion rather than just deleting a line — the suite was pinning the
  defect's scaffolding in place.

## Known gaps

- The five sibling `exportAll()` reads (categories, budgets, recurring, goals,
  insight snapshots) still use plain `getCollection`, so offline they would
  serve the cache. Today that is unreachable in the backup because the
  transactions read runs first and rejects; the ordering is load-bearing and
  the comment above it says so. Converting the siblings to
  `getCollectionFromServer` is the straightforward follow-up if that ordering
  ever needs to go.
- Two batch loops of the same shape as the import wizard still fan out one
  recalculation per row: the backup restore (`backup-restore.service.ts`) and
  the CSV import (`data-management.component.ts`). Both predate this ADR;
  neither is wrong, just wasteful, and both can adopt `skipBudgetRecalc` plus
  a deduped pass verbatim.
- `MockFirestoreService.countDocuments` still records into `_getCollectionSpy`.
  Harmless today — no spec asserts on it — but the next person splitting spies
  should take it along.
