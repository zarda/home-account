# Period totals: the transactions header's money figures

The Transactions header shows what the active filter set **cost** and what it
**netted** — figures that are either exact or absent, never approximate. They
come from `PeriodTotalsService` sweeping the *whole* filtered set page by
page, not from the rows on screen: the visible list is a trimmed sliding
window, and a sum over it would shrink while scrolling toward more spending.
The reasoning and the rejected alternatives are in
[ADR 0061](ADR/0061-a-period-total-is-swept-exact-or-shown-absent.md).

## Which figures render

| Active type filter | Figures | Labels |
|---|---|---|
| none | Spent and Net | `common.totalExpenses`, `common.netBalance` |
| `expense` | Spent only | `common.totalExpenses` |
| `income` | Income only | `common.totalIncome` |

Net under an expense filter is identically minus Spent, and Spent under an
income filter is a zero over salary rows — the redundant figure is dropped
rather than explained. `common.balance` is deliberately not used: its 残高 /
餘額 reads as an account balance, which a negative period figure would turn
into an apparent overdraft.

A net that would round to zero at the base currency's display precision is
snapped unsigned first (`snapDisplayZero`), so JPY −0.4 renders as ¥0, not
−¥0. Rendered values pass through `pinLeadingMinus`, which welds a WORD
JOINER after a leading minus so a wrapped negative amount cannot strand its
sign on its own line.

Desktop places the figures in the page-header actions area, label over value,
before the add FAB — both behind the same `deviceService.isMobile()` gate.
Mobile has no header actions row, so the figures ride a subtitle line under
the title, prefixed with the range they describe via
`LocaleFormatService.formatRange` (rendered only when the filter carries both
date bounds).

## What each state renders

| State | Meaning | Desktop / mobile rendering |
|---|---|---|
| `idle` | no reset yet (e.g. signed out) | nothing |
| `computing` | count or sweep in flight | a neutral placeholder block — never `NT$0` |
| `ready` | sweep complete; figures exact | the figures |
| `unavailable` | count or sweep failed after retries | "Totals unavailable" as visible text in the reading order |
| `over-cap` | server count exceeds 1000 | a real "Calculate totals" `<button>` |

`NT$0` therefore always means the filtered set is genuinely empty — the
zero-count answer is exact and costs no page reads.

## How the sweep works

1. `reset(filters)` (from `onFiltersChanged`) runs the service's **own**
   `countDocuments` over `buildTransactionWhere(filters)`. The window's
   `totalCount()` is not consulted: it is stale between a reset and its
   aggregation resolving, and its `null` means the count *failed*, not zero.
2. Count 0 → `ready` with exact zeros, no reads. Count ≤ 1000 → sweep. Count
   over the cap → `over-cap` until the user clicks Calculate; that consent
   survives mutation refreshes and dies with new filters.
3. The sweep awaits `CurrencyService.ensureRatesLoaded()` before reading
   anything — `getExchangeRate` answers 1 for every pair before the table
   loads — then pages `FirestoreService.getPage` at 200 rows per page,
   `orderBy('date', 'desc')` regardless of the list's sort. Sums are
   order-independent, and the fixed direction keeps the sweep on the same
   composite indexes the list already requires: `indexes:check` covers it
   with no new entries.
4. Transient page failures retry three times with backoff;
   `failed-precondition` (a missing index — a deploy defect) never retries.
   Every async step checks a generation counter and discards itself when a
   newer reset, refresh, or calculate has superseded it.
5. The fold: `applyClientTransactionFilters` **once over the entire swept
   set** (the fuzzy search fallback fires on an empty array — applied per
   page it would sum rows no view shows), then `sumByType` through
   `CurrencyService.amountInBase` — the dashboard's own fold, so the two
   surfaces agree to the cent by construction.

## What refolds and what re-reads

The fold is a `computed` over the cached swept rows; the sweep is imperative.

| Change | Reaction | Firestore reads |
|---|---|---|
| exchange rates land or refresh | refold | none |
| base currency change | refold | none |
| language switch / late category load (search matches translated names) | refold | none |
| client-only filter change (amounts, tags, search) | refold — the where-key over the built server constraints is unchanged | none |
| server filter change (type, category, dates, currency, goal) | recount + resweep | 1 count + up to 5 pages |
| any transaction mutation | recount + resweep (stale figures blank to the placeholder first) | 1 count + up to 5 pages |
| list sort flip | nothing | none |

## The announcement contract

The page's existing result-count live region announces **one combined
message per reset** — count plus totals — once the sweep for that reset
settles, whichever of the two lands first. Later refolds do not re-announce.
Over-cap and unavailable announce their state in place of figures; the
explicit Calculate announces the totals when its sweep lands. Announced
amounts are words, not glyphs: no '−', no WORD JOINER — a negative value is
spoken through `transactions.negativeAmount`.

## Where the pins live

| Claim | Spec |
|---|---|
| cap, guards, rates gate, single client-filter pass, refold-vs-reread | `period-totals.service.spec.ts` |
| figure fork, signed zero, window independence, announcement contract | `transactions.component.spec.ts` |
| real cursors, real rules, corrupt-snapshot repair, scroll-and-trim independence, dashboard-equal fold | `period-totals.service.smoke.spec.ts` (emulators) |
| dashboard rounds at the shared fold boundary | `dashboard.component.spec.ts` |
| range caption follows the chosen language | `locale-format.service.spec.ts` (runs under both CI timezones) |

Related: [money-snapshots.md](money-snapshots.md) for what `amountInBase`
repairs and why; [dates.md](dates.md) for the period-window conventions the
filter bar feeds this; [emulator-blind-spots.md](emulator-blind-spots.md) for
why the index contract is checked from the files.
