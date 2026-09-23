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
   for twelve hours; an entry that is not a finite number above zero is
   dropped on the way in, and a table with fewer than two survivors is
   refused as indistinguishable from the placeholder.
4. **The compiled-in constants** — nineteen approximate rates for the
   picker's curated currencies. They were written in `2a27991 feat: Core
   services` (2025-12-30), the third commit of the repository, and no
   commit since has changed the value of any of them, so read them as a
   snapshot of that week rather than as "roughly current".

The ladder, in order: a fresh cache is used as-is; otherwise the live fetch;
if that fails, the cache **even when expired** — yesterday's market data
beats approximations; the constants only when this device has never cached a
real table. `ratesInitialized` is set once the ladder settles, whichever rung
it settled on, and `ensureRatesLoaded()` releases the writers that await it.

A response is a failure unless its body proves otherwise. The provider
signals failure in band — HTTP 200 with `{"result":"error", …}` — so
`refreshRates` rejects on anything that is not `result: "success"` with a
usable table, and it validates **before** writing signals or cache, so a good
cache can never be overwritten by a bad response.

**A table keeps only real rates.** `sanitizeRates` in `currency.model.ts` is
what "usable" means, for the fetch and the cache reader alike: an entry
survives only when its value is a finite number above zero — a string, `NaN`,
zero, a negative and `Infinity` are dropped rather than coerced — an array is
refused outright, and fewer than two survivors refuse the whole table. The
fetch caches the sanitised table, never the raw body.

**A curated code the table lacks keeps its built-in rate.** Dropping an entry
leaves the code absent, and `getExchangeRate` reads an absent code as 1 — the
par conversion of #251 below, in a form that looks plausible. So every
accepted table, live or cached, is installed over the nineteen compiled-in
rates (`withBuiltInFallback`): the table's own entries win, and a curated code
it is missing keeps its approximation. The cache still holds only what the
provider sent. A code neither the table nor the constants know still converts
at 1 ([ADR 0148](ADR/0148-every-figure-names-its-rate.md)).

What each rung stamps into `lastUpdated`: the fetch stamps now; the cache
stamps its own write time; the constants stamp nothing — null means "never
saw market data".

**Which rung settled is a value, not an inference.**
`CurrencyService.rateSource` holds `live`, `cached`, `expired` or
`fallback`, written on exactly the four paths that install a table, and
`null` until the ladder settles.
`setRatesFromCache(cached, source)` is told the rung rather than deriving
one: a second expiry check inside would answer against a later clock than the
decision it is reporting. The two failing rungs stay apart because they say
different things — `expired` and `fallback` have both failed to reach the
provider, but only `fallback` has never seen a real market rate, and only
`expired` can say how old the figures are.

Settings → Preferences reads it, in `RateStatusComponent`, on a line directly
under the base-currency select — beside the currency whose conversions the
table serves. Four rungs, three lines: `live` and `cached` share *Exchange
rates updated {{date}} at {{time}}*, because a fresh cache is at most twelve
hours old and makes the same claim about the table's age that a live fetch
does. The cache is the ladder's *first* rung, so nearly every boot lands on
`cached`; a line naming the provider there would report the ordinary case as a
degraded one. `expired` and `fallback` carry warnings of their own — those are
the two rungs that did not reach the provider, and that failure is the thing
worth saying. `expired` names the saved table's date and time too, and
`fallback` names neither, because it has none. The time is
`LocaleFormatService.formatTime` — hour and minute on the locale's own clock.
The marker is passive: there is no refresh control to offer, and the one
recovery there is runs by itself.

**A missed live table tries again when the connection returns.** When the
ladder settles on `expired` or `fallback`, `CurrencyService` listens for the
window's `online` event. On it, once `PwaService.isOnline()` agrees, it runs
`refreshRates()` again, and a success installs the live table and flips the
rung — and the line — to `live`. At most three attempts a session
(`RATE_RETRY_LIMIT`), one per `online` event rather than on a timer; a second
event while an attempt is still in flight starts nothing and spends nothing;
and the listener goes on success, at the limit, and when the service is
destroyed. A boot on `live` or `cached` listens for nothing. Rows written
while the table was the fallback keep the rate they were written at
([ADR 0148](ADR/0148-every-figure-names-its-rate.md)).

The reasoning and the rejected loud-failure alternative are in
[ADR 0037](ADR/0037-an-error-body-is-a-failed-fetch.md); what the marker
chose to say and what it refused to say is in
[ADR 0127](ADR/0127-a-figure-the-app-cannot-vouch-for-says-so.md). What the
writers behind `ensureRatesLoaded` assume about the table they convert
through is in [money-snapshots.md](money-snapshots.md).

## Seeing a rung you did not land on

Three of the four rungs a device can land on are easy to arrange and one is
not. A fresh cache is nearly every boot; removing the device key forces
`live`; but `expired` and `fallback` both need the **fetch** to fail, and an
expired cache on its own just goes to the network and succeeds.

There is no seam for that. The endpoint is a module constant, `fetch` is the
global, no environment field names it and no service worker sees it — and
[ADR 0131](ADR/0131-a-rung-a-boot-cannot-reach-is-reached-by-re-entering-the-ladder.md)
records why none of those was added.

**In a browser: re-enter the ladder.** `CurrencyService` is root-provided and
`initializeRates()` is the exact method a boot runs, so the rung can be chosen
a second time on the page that is already showing the line —
`ng.getComponent(document.querySelector('app-rate-status')).currencyService`,
with `window.fetch` wrapped to reject `open.er-api.com` and pass everything
else through. The full procedure, its restore, and the authorisation it needs
are journey 19 in [e2e.md](e2e.md#19-settings-which-rate-rung-is-loaded);
what it is for is the line as a browser paints it — the sentence from the
catalogs, `rate-line-stale` from the stylesheet, and
`--color-warning-text` in whichever theme is on.

Two traps, both worth knowing before reading anything off a re-entry:

- **Wrap `fetch` selectively.** Firestore's transport and the auth token
  exchange ride the same global; a blanket rejection takes the session down
  with the rates.
- **Do not read `lastUpdated()` after a re-entry.** `setDefaultRates()` names
  the rung and deliberately leaves that signal alone, so a run that has
  already been through `expired` still holds the cache's date when it lands on
  `fallback`. Nothing on screen is wrong — the `fallback` line reads no date —
  so the criterion is the sentence and the rung.

**Under the emulators:** `currency-fallback.smoke.spec.ts` builds the service
against each rung and lets a real `addTransaction` write through it, so the
persisted `exchangeRate` says which table answered — `1/157` from a cached
table thirteen hours old, `1/149.5` from the constants. The `fallback` case
is the one that can assert the null stamp, because its service was built with
no cache at all.

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
