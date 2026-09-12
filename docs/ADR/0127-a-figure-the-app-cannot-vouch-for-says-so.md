# 127. A figure the app cannot vouch for says so

**Status:** Accepted, implemented · **Date:** 2026-09-12 · **Issues:** #420

Reference documentation lives in [../exchange-rates.md](../exchange-rates.md)
and [../import-fields.md](../import-fields.md).

Applies [0037](0037-an-error-body-is-a-failed-fetch.md) and closes the gap
it left open — "No UI reads `lastUpdated`, so the user still cannot see rate
staleness — the signal just no longer lies when something does." The second
half extends [0119](0119-a-batchs-totals-are-per-currency.md) to the shape a
record can arrive in without either kind of total.

## Context

Two figures the app puts on screen without being able to stand behind them.

**Every converted amount.** 0037 built the ladder that loads the rate table
— a fresh device cache, else the live fetch, else the cache even when
expired, else nineteen compiled-in constants — and made `lastUpdated`
truthful for the first time: null means "never saw market data", a past date
means market data of that age. Then nothing read it. A device that has not
reached the provider for a week converts through a week-old table, and a
device that has never reached it at all converts through approximations;
both look exactly like a device that fetched thirty seconds ago.

The constants rung is the sharp end. `getDefaultRatesObject` returns nineteen
rates for the currency picker's curated list. They were written in `2a27991
feat: Core services` (2025-12-30), the third commit of the repository; no
commit since has changed the value of any of them; and they carry no date at
all, because `setDefaultRates` deliberately leaves `lastUpdated` null — that
is 0037's own decision, and the consequence is that the rung with the weakest
claim is the one rung that cannot say how old it is.
The error is percent-scale — JPY
at 149.5 against a market rate near 157 — and a base-amount snapshot written
against it is permanent, because the read path re-converts only a
cross-currency row whose stored rate is exactly 1.

**A record's totals on the Import History card.** `totalLines` falls back to
`item.totalIncome` / `item.totalExpenses` when a record carries no
`totalsByCurrency`, and both are required on the `ImportHistory` type. The
rules do not agree: `importCreateValid` in `firestore.rules` requires six
keys with `hasAll` rather than `hasOnly`, and `importOptionalsValid` never
names the totals, so a document with neither reaches the component through
an unchecked cast. `formatCurrency` then hands `undefined` to
`Intl.NumberFormat`, which formats it as `NaN` and returns it with the
currency's symbol attached — `NT$NaN` on a finished record. Every in-app
writer seeds both; the shapes that arrive without them are records older
than the fields and documents written outside the app.

## Decision

**The ladder names the rung it settled on, Settings says which rung that
is, and a total a record does not carry renders as a zero.**

### The rung is a value, not an inference

```ts
export type RateSource = 'live' | 'cached' | 'expired' | 'fallback';
```

Four rather than three. `expired` and `fallback` have both failed to reach
the provider, but only the second has never seen a real market rate, and
only the first can say how old the figures on screen are; collapsing them
would hide a persistent failure on the device that does have a cache, which
is the case worth reporting.

`rateSource` is a signal on `CurrencyService` beside `lastUpdated`, written
on exactly the four paths that install a table: `refreshRates` on success,
`initializeRates`'s fresh-cache short-circuit, the catch's cache rung, and
`setDefaultRates`. `setRatesFromCache(cached, source)` takes the rung as a
parameter instead of deriving it, because a second `isExpired()` call inside
would answer against a later clock than the decision it is reporting — the
two call sites are the two rungs, and they must stay distinguishable.

Null is "the ladder has not settled", not a fifth rung. The marker renders
nothing while it holds: a rung that guesses is worse than one that waits a
tick.

`lastUpdated`'s semantics are untouched. This record reads it; it does not
redefine it.

### Four rungs, three lines

`RateStatusComponent` (`features/settings/rate-status/`) renders directly
under the base-currency select in Settings → Preferences — beside the
currency whose conversions the table serves, rather than in a diagnostics
corner. `live` and `cached` render the same sentence, *Exchange rates
updated {{date}}*; `expired` and `fallback` get lines of their own, styled
as warnings.

**That collapse is a departure, and an ordinary boot is what forced it.**
The first version gave `cached` its own line, *Using saved exchange rates
from {{date}}*, and on a real boot against a real account the line read
exactly that — over a cache one minute old, 166 rates, written by the
previous boot. The ladder's first rung *is* the
fresh cache, so nearly every boot lands on `cached`; and a fresh cache is at
most `CACHE_DURATION_MS` — twelve hours — old, which is the same claim
about the table's age that the live line makes. The word "saved" reported a
provider detail as though it were a problem, on the path almost every user
takes. `settings.ratesCached` came out of all three catalogs. The signal
keeps four values and the specs distinguish all four; what collapsed is the
rendering, not the fact.

The date goes through `DateFormatService.formatDate`, so it follows the
user's own Date Format preference — set two fields above this one, where a
fixed pattern here would visibly disagree with it.

### A total the record does not carry is a zero

`totalLines` guards the legacy read at the call site, `?? 0`, and
`formatCurrency` is untouched. The formatter has 41 production call sites
across 21 files; defaulting inside it would turn every future missing figure
anywhere in the app into a silent zero — a quieter version of the same
defect, spread across every screen that shows money.

### What was rejected

- **A marker on every converted figure.** The ≈ lines already say a figure
  is derived, and the ladder's whole point is that the figures are usable on
  every rung; a badge on each one would be noise proportional to the number
  of rows on screen, for a fact that changes once per app start.
- **A refresh button beside the line.** `refreshRates` is a rejecting public
  API with no recovery seam, and 0037's ladder never retries the network
  after installing a fallback — the next attempt is the next app start. A
  control whose only outcome is a rejection nobody can act on is worse than
  no control. That gap stays open, named below.
- **Stamping a date on the constants so every rung has one.** Exactly what
  0037 removed: `setDefaultRates` used to stamp the wall clock and reported
  approximations as freshly fetched. The `fallback` line says it in words
  instead, and reads no date at all.
- **Requiring the totals in `firestore.rules`.** Rules validate the
  resulting document rather than the delta, so requiring the fields would
  refuse every *update* to a record written before they existed — a
  read-only defect turned into a write failure, on precisely the records
  this is about.

## Consequences

- **Four new `settings.*` keys in all three catalogs** — `ratesLabel` for
  the label, then `ratesLive`, `ratesExpired` and `ratesBuiltIn` for the
  three lines. The first two lines carry `{{date}}`; `ratesBuiltIn` carries
  none, because that rung has none.
- **`profile-settings.component.spec.ts` needed a `CurrencyService` stub.**
  The component had never injected the service, and constructing the real
  one runs the ladder and reaches `fetch` — which is why every unit spec
  that touches it stubs it.
- **The emulator tier pins the rung beside what it already proved.**
  `currency-fallback.smoke.spec.ts` asserts `'expired'` on the same injected
  instance whose 1/157-against-1/149.5 discrimination is what proves the
  expired cache beat the constants; the rung and the rates come from one
  run, so neither can be right by accident.
- **The no-totals case is proved against the real rules.** A seeded record
  carrying neither `totalsByCurrency` nor the legacy pair passes
  `importCreateValid` under the emulator, renders `$0.00` through the real
  `CurrencyService`, and produces no `NaN` — which is the whole claim: the
  shape is reachable, and it now renders.

## Things that only became apparent while building

- **The `cached` rung is the normal case, not an edge.** It reads like a
  degraded state in the ladder's prose and is the first rung the ladder
  tries; a boot one minute after the last one lands there with 166 real
  rates. Wording written for the ladder's *structure* said the wrong thing
  about the ladder's *behaviour*, and only a real boot showed which.
- **The nineteen constants have never been revised.** Three commits touch
  the block — `2a27991` wrote the values, `043dc73` extracted them into
  `getDefaultRatesObject`, `dc2de5b` edited the comment below them — and the
  nineteen values are byte-identical across all three. It is easy to read a
  fallback as "slightly out of date" when it is in fact a fixed snapshot of
  a particular week, already more than eight months old on the day this
  record was written, and the rung that serves it is the one that cannot
  carry a date.
- **The stamp is a date and not a time**, because `DateFormatService` offers
  `formatDate` and `formatRelativeDate` and nothing between them. The
  relative formatter would say *Today* for a live fetch, which says less
  than the date does.

## Known gaps

- **The ladder still never retries.** 0037's gap is untouched: a session
  that begins offline stays on cached rates until relaunch, and this record
  deliberately adds no control that would imply otherwise.
- **The line carries a date and no time.** A table fetched an hour ago and
  one fetched at breakfast read identically, which is exactly the
  distinction the `cached` rung would most like to draw.
- **The label repeats inside every line.** *Exchange rates* sits above
  *Exchange rates updated …* in all three locales. Trimming it is a change
  in three catalogs or none.
- **Nothing outside Settings says which rung is loaded**, so a figure
  snapshotted during a `fallback` session is still indistinguishable
  afterwards from one snapshotted during a live one. The marker reports the
  present, not the provenance of what is already stored.
- **The constants themselves are not revised here.** This record says how
  old they are and gives the app a way to admit it is using them; the
  numbers are the same numbers.
- **The type still says both totals are required.** `formatCurrency`'s
  parameter is a `number` and the compiler believes it gets one; what
  arrives is whatever the document held. The guard is at one call site, so
  the next reader of a legacy record starts exactly where this one did —
  and no gate distinguishes a field the rules require from a field only the
  type does.
