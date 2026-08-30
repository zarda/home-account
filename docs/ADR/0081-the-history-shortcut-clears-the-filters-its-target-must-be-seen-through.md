# 81. The history shortcut clears the filters its target must be seen through

**Status:** Accepted, implemented · **Date:** 2026-08-30 · **Issues:** #343

Closes a known gap of
[0075](0075-a-successful-import-remembers-the-transactions-it-created.md).

## Context

0075 gave a completed import a way back into the ledger: a **View
transaction** entry that opens `/transactions?tx=<id>`, and the transactions
page reads `tx` to jump the window to that row, highlight it and open its
edit dialog. The shortcut exists for exactly the case where it is most
useful — a transaction whose stored date turned out wrong, which an import
review step now surfaces routinely (0074, 0080) — and that is exactly the
case where the target is likeliest to sit outside whatever the page's
default filter happens to be.

That is where it broke. The page's default filter is the current month;
`onFiltersChanged` seeds the window from whatever filter set the filter bar
first emits, and `openLinkedTransaction`'s own `jumpTo` against that seeded,
filtered window comes back empty when the target's date is outside it. The
window falls back to whatever an empty-range query leaves it showing, the
highlight silently finds no row to scroll to, and the edit dialog still
opens regardless — it reads the transaction directly, not through the
filtered list — so nothing announces the failure. The user sees the form for
the row they asked for, and no sign anywhere that the list behind it did not
show them where it came from.

`isInLoadedRange`, which `openLinkedTransaction` consults before deciding to
jump at all, does not help here: it knows which dates the currently loaded
page spans and whether the account's data has been exhausted at either end,
not which dates the active *filters* would ever admit. It can truthfully say
a row is not loaded without ever being able to say the filters would keep it
from loading at all.

## Decision

**A `tx` arrival widens the page to every date before the first filter is
ever applied.** `ngOnInit` reads `tx` from the route snapshot ahead of
`showAll` and `date`, and when it is present, sets the page's existing
`showAll` signal immediately — synchronously, inside the parent component's
own `ngOnInit`, which Angular runs before the child filter bar's `ngOnInit`
schedules the `setTimeout` that produces its first filter emission. By the
time that emission reaches `onFiltersChanged`, `showAll` already reads
`true`, so the **first** window reset the page ever performs is already the
unfiltered one — not a second, corrective reset after an already-narrow one.

`tx` also skips the `date` query param branch entirely, and not merely to
avoid two contradictory intentions on one URL: `initialDate` reaching the
filter bar as a bound input fires the filter bar's `ngOnChanges`
synchronously, which sets its own `initialFilterApplied` flag before the
`ngOnInit` timeout above ever checks it. A `tx` arrival that also set
`initialDate` would have its own show-all branch pre-empted by that flag,
and the filter bar would default to the date filter instead of clearing
anything at all.

`openLinkedTransaction`, `onFiltersChanged` and `TransactionWindowService`
itself are untouched. Once the window's first reset is already unfiltered,
`openLinkedTransaction`'s existing `jumpTo` finds the target inside a window
that can actually contain it, and the highlight and the edit dialog both
behave exactly as 0075 already built them to. A save that moves the row's
date further still composes for the same reason: `onTransactionMutated`'s own
`jumpTo` runs against the filters `TransactionWindowService` already holds,
and those filters are still the cleared set.

### The alternatives that were rejected

- **Widening the window after the target failed to load**, through
  `applyExternalFilters` or a second call into `onFiltersChanged`. This is a
  real path the page already has — insight chips and smart search both push
  filters through it — but using it here would mean a first reset against
  the narrow filter, a failed `jumpTo`, a pending-jump state to remember
  across that failure, and a second reset once the wider filters landed.
  Setting `showAll` one signal-write earlier costs one `if` in `ngOnInit` and
  produces a single reset that was never wrong.
- **Teaching `isInLoadedRange` about the active filters.** It answers a
  narrower, correct question — is this date inside what is already loaded —
  and widening its contract to also vouch for what the filters would admit
  would make one method own more than the loading it decides.

## Consequences

- **A shortcut arrival always lands on the all-dates view**, even for a
  target the default month filter would have shown anyway. For a
  transaction dated this month the difference is invisible — the
  newest-first list looks the same with or without the month boundary. For a
  transaction dated months back, it is the difference between the row
  appearing and the row silently not.

## Things that only became apparent while building

- **The new smoke case needed the suite's existing close-all-dialogs
  teardown.** `transaction-overflow.smoke.spec.ts` runs under
  `destroyAfterEach: false`, so a spec that opens a dialog and does not close
  it leaves that dialog for the next spec to inherit; the case added here
  calls `TestBed.inject(MatDialog).closeAll()` before finishing, the same
  idiom the file's other dialog-opening cases already use.

## Known gaps

- **The row-highlight mechanism itself stays unspecced at the
  list-component level.** `TransactionWindowService.requestScrollTo` and the
  component's own silent el-not-found branch in `scrollToTarget` are
  exercised end-to-end by the smoke suite, but nothing here adds a focused
  spec for what happens when the target row is inside the window but not yet
  rendered.
