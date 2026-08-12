# 37. An error body is a failed fetch, and an expired cache beats the constants

**Status:** Accepted, implemented · **Date:** 2026-08-12 · **Issues:** #251, #257

Reference documentation lives in [../exchange-rates.md](../exchange-rates.md).

## Context

Everything the app converts rides one rate table in `CurrencyService`, and
two defects shared the code that loads it.

The configured provider, open.er-api.com, reports failure in band: a
rate-limited or rejected request comes back HTTP 200 carrying
`{"result":"error","error-type":"…"}`. `refreshRates()` threw on a non-ok
status and on unparseable JSON, but the body check — `if (data.result ===
'success' && data.rates)` — had no else. A parseable non-success body fell
out of the `if` and the promise resolved. `initializeRates()` took that as
success: the catch that installs a fallback never ran, `ratesInitialized`
flipped true, and the table kept its constructor value, a single `USD: 1`
entry. `getExchangeRate` maps unknown codes to 1 on both sides, so every pair
converted 1:1 — and `ensureRatesLoaded()`, the guard every money-writing path
awaits precisely so it never snapshots against an unloaded table, waved all
of them through (#251). The worst writer is the goal link:
`createWithGoalLink` converts inside the Firestore transaction and moves the
goal's `linkedAmount` by the converted figure, so a ¥10,000 row linked to a
USD goal overstated the counter roughly 150x, and the only production path
that recomputes that counter is a backup restore.

Separately, the device cache was read inside the `try`, scoped where the
catch could not see it. When the cache was expired the code went to the
network, and when that fetch failed it fell to `setDefaultRates()` — nineteen
compiled-in constants — while an expired-but-real table of ~160 market rates
sat in localStorage, already parsed once and dropped (#257). The constants
are wrong by percent-scale amounts (JPY 149.5 against a market 157), the
snapshot written against them is permanent, and the read path cannot tell it
from a good one: `amountInBase` only re-converts a cross-currency row whose
stored rate is exactly 1. `setDefaultRates()` also stamped `lastUpdated` with
`new Date()`, so the one signal that could distinguish constants from market
data reported the constants as freshly fetched.

Both defects were invisible to the spec suite. Every spec stubbed fetch with
a rejection, so a response that resolves but carries nothing usable had no
coverage at all; and the seeded rate tables were byte-identical to the
compiled-in constants, so the fallback overwriting a seed a microtask later
changed nothing a matcher could see.

## Decision

**A response is a failure unless its body proves otherwise.** `refreshRates`
now rejects unless the body says `result: "success"` and carries an object
table with at least two entries, and it validates before writing anything —
signals or device cache — so a caller's fallback always runs against clean
state. The ≥2 clause is deliberate: a `rates: {USD: 1}` body is
indistinguishable from the placeholder this whole guard exists to keep out of
snapshots, and without the clause a degenerate success would not only install
that table but cache it.

**Initialization falls down a ladder, and every rung is real data or admits
it is not.** `initializeRates` reads the cache once, up front, where the
catch can reuse it: a fresh cache is used as-is; otherwise the live fetch; on
any failure the cache even when expired — yesterday's market beats
compiled-in approximations — and the constants only when the device has never
cached a real table. `getCachedRates` refuses a table with fewer than two
entries, so a degenerate cache falls through the same way. `setDefaultRates`
no longer stamps `lastUpdated`: null now means "never saw market data", and
the cache rung stamps the cache's own write time rather than the wall clock.

**Rejected: refusing to initialize on a bad table.** #251 floated a stronger
version — leave `ratesInitialized` unset, or make `ensureRatesLoaded` throw,
while the table holds only USD, so the guarded writers fail loudly instead of
persisting 1:1 figures. Not taken: the app is offline-first and the writers
must still work on a machine that has never fetched rates, which is exactly
the constants rung; and after the ladder, every initialization path installs
a multi-entry table, so the state the loud failure would defend against can
no longer arrive. The structural guard in `getCachedRates` closes the one
remaining crack — a hand-tampered single-entry cache — without changing any
caller's failure mode.

## Consequences

- `refreshRates` is now a rejecting public API. It has no caller today
  besides initialization; a future "refresh now" control must catch. A failed
  post-initialization refresh leaves the installed table untouched — there is
  no path back to 1:1.
- An error body can never overwrite a good device cache: the validation
  throws before `cacheRates` runs.
- `lastUpdated` is truthful for the first time: null means constants (or
  nothing yet), a past date means market data of that age. Nothing binds it
  yet; anything that does inherits meaningful values.
- The smoke tier runs the real `CurrencyService` inside a real write for the
  first time (`currency-fallback.smoke.spec.ts`). Every other smoke suite
  stubs it, and that stub line is exactly the seam both defects lived in.

## Departures from the issues

- #257's recurring acceptance criterion — a catch-up run posting occurrences
  converted through the cached table — is not asserted in
  `recurring.service.spec.ts`, which builds `CurrencyService` as a bare spy
  object and cannot see fallback behavior (and runs three times per CI via
  `test:dates`). The property is held transitively: the table the ladder
  installs is what `getExchangeRate` serves, proven at the currency tier, and
  the same guarded conversion is proven end to end for `addTransaction` at
  the unit and emulator tiers.
- The ≥2-entry clause on a *success* body is one condition beyond #251's
  text, closing the same hole from the success side.

## Known gaps

- Rate values in a live success body are not validated — a numeric-looking
  garbage table would install. The cache read filters non-numbers; the fetch
  path trusts the provider.
- The ladder never retries the network after installing a fallback; the next
  attempt is the next service construction, an app start. A session that
  begins offline stays on cached rates until relaunch.
- No UI reads `lastUpdated`, so the user still cannot see rate staleness —
  the signal just no longer lies when something does.
- The emulator tier covers the plain add; the goal-link write under the
  fallback is proven at the unit tier only.
