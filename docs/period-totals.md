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

At 600px and wider the figures sit in the page-header actions area, label over
value, before the add FAB. Every state but hidden renders inside one
`.period-totals-slot`, the single flex item beside the FAB, which gives way
before the button does. The figures and the FAB are behind the same viewport
gate, `injectIsMobileViewport()` over `APP_BREAKPOINTS.mobile`. That is the
query the bottom nav binds to as well, so the figures and the add affordance
are each in exactly one place at every width. The user-agent gate this
replaced put the FAB and the bottom-nav "+" on different questions and left a
phone in landscape with neither. Below 600px there is no header actions row,
so the figures ride a subtitle line under the title, prefixed with the range
they describe via `LocaleFormatService.formatRange` (rendered only when the
filter carries both date bounds).

## What each state renders

| State | Meaning | Rendering (either placement) |
|---|---|---|
| `idle` | no reset yet (e.g. signed out) | nothing |
| `computing` | count or sweep in flight | a neutral placeholder block — never `NT$0` |
| `ready` | sweep complete; figures exact | the figures |
| `unavailable` | count or sweep failed after retries | "Totals unavailable" as visible text in the reading order, and a **Retry** button beside it |
| `over-cap` | server count exceeds 1000 | a real "Calculate totals" `<button>` |

`NT$0` therefore always means the filtered set is genuinely empty — the
zero-count answer is exact and costs no page reads.

## Retry

`unavailable` is not the last word. **Retry** (`common.retry`) recounts in
place, under the filters already set
([ADR 0165](ADR/0165-the-period-pickers-are-bounded-unavailable-totals-offer-retry-and-three-smaller-papercuts-close.md)).
On desktop it is a `mat-button` beside the note. On the phone it is a
button in the subtitle line, drawn as a link like *Calculate totals*.

`PeriodTotalsService.retry()` runs the same recount a mutation's `refresh()`
runs:

- it resolves false and reads nothing unless the status is `unavailable`;
- it keeps an over-cap consent already given, so Calculate, then a failed
  refresh, then Retry sweeps rather than asking again;
- it resolves true once its recount settles, whether ready, over-cap or
  unavailable again, and false when a newer reset, refresh or calculate has
  superseded it.

`TransactionsComponent.onRetryTotals()` acts only on true, and only while
the page is still there. It announces the settled line (see the contract
below), so a recount that fails again says *Totals unavailable* again. Then,
after the next render, it moves focus to the totals line,
`.period-totals-slot` on desktop or `.period-totals-line` on the phone, both
`tabindex="-1"`. The pressed Retry leaves with the state it sat in, so
without this focus would drop to the document. Focus moves only when it has
dropped there, so a viewer who went elsewhere while the recount was out
stays where they went.

Calculate does not move focus. Its button also leaves with its state, and
focus falls to the document when it does.

**The phone's two links are words in the line.** Their box is the text's,
about 21px tall, and each reaches the 40px tap floor through an `::after`
overhang without growing the line, the transaction list's idiom
([ui-overflow.md](ui-overflow.md)).

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
explicit Calculate announces the totals when its sweep lands, and a Retry
announces the line its recount settled on. All of them are current state,
which the next filter or sort change makes stale, so all are announced in
`'replace'` mode: a run of changes does not queue a backlog of
figures a later change has already replaced
([ADR 0149](ADR/0149-the-review-step-says-what-it-changed.md)). Announced
amounts are words, not glyphs: no '−', no WORD JOINER — a negative value is
spoken through `transactions.negativeAmount`.

## Where the pins live

| Claim | Spec |
|---|---|
| cap, guards, rates gate, single client-filter pass, refold-vs-reread | `period-totals.service.spec.ts` |
| Retry declines unless unavailable, recounts under the same filters, keeps the consent, loses to a newer reset | `period-totals.service.spec.ts` (`describe('retry')`) |
| figure fork, signed zero, window independence, announcement contract | `transactions.component.spec.ts` |
| Retry in both placements: rendered, announced once, focus to the totals line or left where the viewer put it, silent when superseded; a recount that fails again says so; a page gone before it lands neither announces nor throws | `transactions.component.spec.ts` (the `Retry on unavailable totals` describes, desktop and phone, and the two cases after them) |
| the phone's Retry and Calculate links reach 40px without growing the line | `transactions.component.spec.ts` ("gives the phone's … a 40 px tap target without growing the line") |
| real cursors, real rules, corrupt-snapshot repair, scroll-and-trim independence, dashboard-equal fold, a recount after a failed count | `period-totals.service.smoke.spec.ts` (emulators) |
| dashboard rounds at the shared fold boundary | `dashboard.component.spec.ts` |
| range caption follows the chosen language | `locale-format.service.spec.ts` (runs under both CI timezones) |

Related: [money-snapshots.md](money-snapshots.md) for what `amountInBase`
repairs and why; [dates.md](dates.md) for the period-window conventions the
filter bar feeds this; [emulator-blind-spots.md](emulator-blind-spots.md) for
why the index contract is checked from the files.
