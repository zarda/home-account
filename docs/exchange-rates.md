# Where the exchange-rate table comes from

Every conversion in the app — the base-currency snapshot on a new
transaction, the goal counter a linked row moves, budget recomputes, the
figures handed to the AI summary — reads one in-memory table in
`CurrencyService`. Four tables exist, and initialization picks one:

1. **The constructor placeholder** — `{USD: 1}`. Never valid for conversion;
   it exists so the signal always holds a Map.
2. **The live fetch** — ~160 codes from
   `https://open.er-api.com/v6/latest/USD`, written to the device cache on
   arrival.
3. **The device cache** — the last successful fetch, in localStorage under
   `home-account.exchangeRates`, carrying the fetch's own timestamp. Fresh
   for twelve hours; a table with fewer than two entries is refused as
   indistinguishable from the placeholder.
4. **The compiled-in constants** — nineteen approximate rates for the
   picker's curated currencies.

The ladder, in order: a fresh cache is used as-is; otherwise the live fetch;
if that fails, the cache **even when expired** — yesterday's market data
beats approximations; the constants only when this device has never cached a
real table. `ratesInitialized` is set once the ladder settles, whichever rung
it settled on, and `ensureRatesLoaded()` releases the writers that await it.

A response is a failure unless its body proves otherwise. The provider
signals failure in band — HTTP 200 with `{"result":"error", …}` — so
`refreshRates` rejects on anything that is not `result: "success"` with a
multi-entry object table, and it validates **before** writing signals or
cache, so a good cache can never be overwritten by a bad response.

What each rung stamps into `lastUpdated`: the fetch stamps now; the cache
stamps its own write time; the constants stamp nothing — null means "never
saw market data". Nothing binds the signal today, but it is the one place
staleness is observable, so it is kept honest.

The reasoning and the rejected loud-failure alternative are in
[ADR 0037](ADR/0037-an-error-body-is-a-failed-fetch.md). What the writers
behind `ensureRatesLoaded` assume about the table they convert through is in
[money-snapshots.md](money-snapshots.md).

## #251 — a 200 with an error body left every currency at 1:1

**Symptom.** With the provider rate-limiting (HTTP 200,
`{"result":"error"}`), the app behaved as though rates loaded fine. Every
conversion ran 1:1: a ¥10,000 lunch stored as $10,000, and a JPY row linked
to a USD goal moved the goal's counter by the raw yen figure — roughly 150x
high, repaired only by a backup restore. Strictly worse than the endpoint
being unreachable, which at least installed the approximate fallback.

**Mechanism.** `refreshRates` threw on a non-ok status and on a parse
failure, but the body check had no else branch: a parseable non-success body
resolved the promise. `initializeRates` set `ratesInitialized` on that path,
so the fallback never ran and the table kept the USD-only placeholder —
`getExchangeRate` maps unknown codes to 1 on both sides. `ensureRatesLoaded`,
which the write paths await precisely to avoid snapshotting against an
unloaded table, returned immediately.

**Fix.** The body validation above: reject unless `result: "success"` with a
multi-entry table, before any write. An error body now lands in the same
catch as a network failure and walks the ladder.

**Held by** `currency.service.spec.ts` ("CurrencyService rate
initialization": the error-body, missing-rates and empty-table specs),
`transaction.service.spec.ts` ("TransactionService when the rates API answers
with an error body": the persisted snapshot and the goal counter), and
`currency-fallback.smoke.spec.ts` (the error-body shape against the
emulator).

## #257 — the expired cache lost to the constants

**Symptom.** A device holding real rates thirteen hours old, starting
offline, converted through the compiled-in constants instead — JPY at 149.5
against a cached 157. Every row entered that session carries a base-amount
snapshot a few percent off, permanently: the stored rate is not 1 and the
stamp matches, so the read path trusts it forever. Codes outside the nineteen
fell to 1:1 in the document — self-healing on display, wrong in backups and
CSV exports.

**Mechanism.** The cache was read inside the `try`, out of the catch's
scope. Expiry meant "go to the network", and a network failure meant
`setDefaultRates()` — the expired table was parsed once and dropped. The
recurring catch-up is the worst entry point: one offline app start posts a
whole backlog of occurrences against constants. `setDefaultRates` also
stamped `lastUpdated` with the wall clock, reporting constants as fresh.

**Fix.** The cache is read once, up front, and the catch prefers it —
expired or not — over the constants; the constants are reached only when
nothing was ever cached. `setDefaultRates` no longer stamps `lastUpdated`.

**Held by** `currency.service.spec.ts` (expired-cache-over-constants under
both failure shapes, the honest stamp, the single-entry refusal, USD pinning)
and `currency-fallback.smoke.spec.ts` (a real `addTransaction` on the
emulator persisting the cached rate while the endpoint is down).
