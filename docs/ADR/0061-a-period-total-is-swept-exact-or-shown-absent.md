# 61. A period total is swept exact, or shown absent

**Status:** Accepted, implemented · **Date:** 2026-08-21 · **Issues:** #323

Folds through the money-snapshot chokepoint whose obligations
[0033](0033-a-stored-figure-is-re-taken-only-when-its-input-moved.md) and
[../money-snapshots.md](../money-snapshots.md) record. Reference documentation
lives in [../period-totals.md](../period-totals.md).

## Context

The Transactions title answered "how many rows match?" and nothing answered
"how much is that?". Every candidate source for a money figure on that page
was wrong in its own way:

- **The visible list is a trimmed sliding window.** `TransactionWindowService`
  caps the loaded rows at `MAX_WINDOW = 100` and trims from the far end while
  paging, so a sum over the rendered rows *decreases* as the user scrolls
  toward more spending. A count can honestly say `12+`; a shrinking number
  presented as the period's spending is a wrong figure.
- **A server-side `sum()` aggregate cannot agree with the rows under it.**
  `CurrencyService.amountInBase` rejects the stored snapshot in three cases —
  absent, stamped against a different base, or a corrupt cross-currency pair —
  and live-converts instead. No Firestore aggregate expresses that repair.
  Worse, an aggregate's index need is invisible to `indexes:check` (it derives
  the required set from `buildTransactionWhere`'s equality fields) and the
  emulator never enforces indexes — the exact shape that shipped ten broken
  filter combinations in #249.
- **A cold-start fold silently converts 1:1.** `getExchangeRate` answers
  `?? 1` for any pair before the rates table loads, so a fold that does not
  await `ensureRatesLoaded()` reports foreign rows at face value — the #251
  failure, one layer up.

There was also no honest approximate state to borrow: the count's `12+` idiom
has no money equivalent, because the only partial figure available moves the
wrong way under scroll.

## Decision

**A page-provided `PeriodTotalsService` sweeps the whole filtered set with its
own cursors, and the header renders a figure only when that sweep is exact.**
The service counts first (`countDocuments` over `buildTransactionWhere`
output), then pages through `FirestoreService.getPage` at a fixed
`orderBy('date', 'desc')` — the same where clauses and the same composite
indexes as the list, whichever way the list is sorted, so `indexes:check`
covers it with nothing new. States are `idle`, `computing`, `ready`,
`unavailable`, and `over-cap`; the template renders exact figures, a
placeholder, a labeled absent state, or an explicit affordance — never an
approximate sum, and never `NT$0` for a range that was not actually swept
empty.

**The count is the service's own, not the window's.** The window's
`totalCount()` still holds the previous filter set's number between a reset
and its aggregation resolving, and its `null` means the count *failed*, not
zero. One duplicate aggregate read per server-side filter change is the price
of not coupling to that lifecycle.

**Auto-sweep is capped at a server count of 1000; beyond it an explicit
"Calculate totals" button consents to the cost.** Consent survives mutation
refreshes — the user already accepted that filter set's cost — and dies with
new filters. Mutations otherwise blank the figures back to the placeholder
rather than showing a stale sum.

**One fold, shared with the dashboard.** Client-only filters (amounts, tags,
search) are applied once over the entire swept set — the fuzzy search
fallback fires on an empty *array*, so a per-page application would sum rows
no view shows — and the result folds through `sumByType` with
`amountInBase`. The dashboard's three inline reduces moved onto the same
`sumByType` fold (the shape reports already used), so "equals the Dashboard
to the cent" holds by construction rather than by parallel maintenance.

**Refold and re-read are different events.** The fold is a `computed` over the
cached swept rows, so exchange rates landing, a base-currency change, or a
language switch (translated category names feed search) re-fold at zero
Firestore reads; only filter changes and mutations re-read. A reset that
changes only client-side filters is recognized by a where-key over the built
server constraints and reuses the cached rows — typing in the search box
costs nothing.

**Rates gate the sweep; a generation counter guards it.** No row is read
until `ensureRatesLoaded()` settles, and every async step discards itself
when a newer reset/refresh/calculate has bumped the generation — the
`refreshTotalCount(gen)` shape from the window service.

**The header shows the figure that means something.** At 600px and wider,
labeled figures render in the page-header actions area beside the add FAB (both
behind the same viewport gate, so they cannot disagree with what sits next to
them); below it a subtitle line renders under the title, captioned with the
filter range through the new `LocaleFormatService.formatRange` seam.
Under a type filter a single figure renders — Spent for expenses, Income for
income — because Net under an expense filter is identically minus Spent, and
Spent under an income filter prints a zero over a list of salary rows.
Labels are `common.totalExpenses` / `common.totalIncome` /
`common.netBalance`, never `common.balance`, whose 残高/餘額 reads as an
account balance. A net that would round to zero in the base currency's
display precision is snapped unsigned before formatting (`snapDisplayZero`),
so JPY −0.4 cannot render as −¥0.

**One announcement per reset, in words.** The existing result-count live
region now announces count and totals as one combined message once the sweep
for that reset settles, guarded so neither ordering (reset first or sweep
first) announces twice and later refolds stay silent. Announced amounts carry
no '−' or WORD JOINER glyph — a negative value is spoken through the
`transactions.negativeAmount` catalog entry.

### The alternatives that were rejected

- **Summing `visibleWindow`.** The figure shrinks while scrolling toward more
  spending; the one state it is exact in (window complete) is not worth a
  second code path that can disagree with the sweep.
- **A Firestore `sum('amountInBaseCurrency')` aggregate.** Cannot express the
  snapshot repair, drifts from the dashboard, and needs an index no gate can
  see.
- **An approximate "≈" figure for client-only filters.** The only candidate
  source is the window, and that number moves the wrong way under scroll.
- **A sticky totals footer on the list.** The desktop table is auto-layout
  with advisory column widths; a separately-gridded footer misaligns with the
  amount column at most viewport widths, and alignment was its whole argument.
- **A second live region for the totals.** Two politely competing
  announcements per filter change; the count message was already there to be
  extended.
- **Reading the window service's private filters.** The component already
  owns the filter flow; driving both services from `onFiltersChanged` keeps
  the coupling visible in one place.

## Consequences

- A server-side filter change costs one aggregate read plus up to five
  200-row pages (the 1000-row cap); client-only filter changes and every
  refold are free. The duplicate count is called out here so nobody
  "optimizes" it into coupling with the window's stale signal later.
- The dashboard's totals now round at the fold boundary through
  `sumByType`'s `roundMoney` — a sub-cent change in principle, pinned by a
  spec asserting `0.1 + 0.2` folds to exactly `0.3`.
- `StatCardComponent`'s WORD JOINER logic moved to
  `money-display.utils.pinLeadingMinus` and is shared by the new header
  figures; its existing spec pins the transplant.
- A sort flip re-announces the settled totals with the re-presented count —
  accepted, since the result set was genuinely re-presented.
- `transaction-overflow.smoke.spec.ts` now renders the new header
  incidentally; its assertions are scoped to the table and strip and stayed
  green.

## Things that only became apparent while building

- **The window-independence proof needs more than 120 rows.** The window
  trims only past `TRIM_THRESHOLD` (125), so a 120-row seed scrolls to the
  end without ever trimming and the "figures survive the trim" assertion
  asserts nothing. The smoke seeds 160 rows and pins `reachedStart()` going
  false — the trim's observable — rather than an exact window length.
- **A truly legacy row cannot be seeded under the rules.** The transactions
  create rule requires `amountInBaseCurrency` and `exchangeRate`, so the
  emulator proof of the live-conversion repair uses the corrupt
  cross-currency shape (a foreign row whose stored rate is 1), which
  `amountInBase` rejects and live-converts identically.
- **"Discard the sweep on a base-currency change" is vacuous.** With the fold
  as a `computed` over raw rows, a base or rates change never invalidates the
  swept rows — there is nothing to discard, and the refold is free. The
  generation guard exists for filter changes and mutations only.
- **`MockFirestoreService.countDocuments` records into `getCollectionSpy`**
  and ignores its options; the unit pins assert count traffic through that
  spy and query shapes through `getPageSpy`'s captured args, never through
  returned rows.

## Known gaps

- **The gate shipped reading the user agent** (`DeviceService.isMobile()`) while
  the bottom-nav "+" that covers the narrow layout read the viewport, so a phone
  in landscape — a mobile agent at a tablet width — lost the bottom bar and was
  given nothing in its place, leaving no way to add a transaction at all.
  Corrected 2026-08-22 to `injectIsMobileViewport()`; `add-affordance.spec.ts`
  drives both gates from one fake observer and is what now holds the two ends
  together.

- **`unavailable` has no inline retry.** Any filter change or mutation
  retries; a dedicated retry button was left out until someone actually hits
  the state outside of airplane mode.
- **The dashboard's `categoryTotals` still folds inline.** Moving it onto
  `groupExpensesByCategoryWithCounts` changes tie-breaking order — a visible
  behavior change left for its own record.
- **`NlSearchService.computeAggregate` still folds without awaiting rates** —
  the same cold-start gap this feature closes for the header, pre-existing on
  the search path and untouched here.
- **The over-cap figure can go stale between consent points.** The
  `serverCount` shown on the affordance is from the reset-time count; a
  mutation between over-cap and Calculate is re-counted, but the button label
  itself does not live-update.
