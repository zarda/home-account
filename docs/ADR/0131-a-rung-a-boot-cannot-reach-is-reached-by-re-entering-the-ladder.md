# 131. A rung a boot cannot reach is reached by re-entering the ladder

**Status:** Accepted, implemented · **Date:** 2026-09-13 · **Issues:** #422

Reference documentation lives in [../e2e.md](../e2e.md) and
[../exchange-rates.md](../exchange-rates.md).

## Context

[ADR 0127](0127-a-figure-the-app-cannot-vouch-for-says-so.md) gave the rate
ladder four named rungs and put the two that failed to reach the provider on
screen as warnings. Journey 19 was written in the same branch and could only
read one of them. Its own words on `origin/main`: "`expired` and `fallback`
are **not reachable here**. Both require a fetch that fails, which a
read-only run against production cannot arrange — an expired cache alone
simply goes to the network and succeeds."

That left the two lines the account is most likely to need — the ones that
say the figures on screen are old, or approximate — proved only in specs.
`currency.service.spec.ts` walks all four rungs and
`rate-status.component.spec.ts` pins `rate-line-stale` on the two failures,
and neither can say what a browser actually paints: the sentence as the
catalogs resolve it, the class as the stylesheet applies it, and the warning
colour as each theme defines it. That is the whole reason the journey
protocol exists beside the specs.

The two mechanisms #422 offered do not work here.

- **Request blocking on `open.er-api.com`.** The pane the protocol runs in
  exposes no request blocking and no offline mode, so a failing fetch cannot
  be arranged from outside the app.
- **The seeded harness under `docs/ui-audit/tools/`.** It can stub `fetch`
  before `CurrencyService` is constructed, and that is the right moment — but
  it renders a demo account against the emulators, after
  `.vscode/environment.ts` is swapped and an uncommitted `app.config.ts` edit
  points the app at them. There is no real session and no deployed rules
  behind it, which is precisely what the protocol has that the harness does
  not.

The app offers no seam either. The endpoint is a module constant, `fetch` is
the global, no environment field names it, and no service worker sees it.
0127 already rejected adding a control beside the line — `refreshRates` is a
rejecting API with no recovery seam, and a button whose only outcome is a
rejection nobody can act on is worse than no button.

## Decision

**The ladder is re-entered on the running page, with the rates host failing
underneath it, and the journey ends with a real reload.**

`CurrencyService` is root-provided, `RateStatusComponent` holds it as
`private currencyService`, and `initializeRates()` is the exact method a boot
runs. So the rung a boot cannot be made to choose can be chosen a second
time, on the same instance the line is already bound to, and the line
repaints through the same signal a boot writes.

### The fetch is failed selectively, from a page global

```js
window.__j19 = { cache, fetch: window.fetch, theme: document.documentElement.className };
window.fetch = (input, init) =>
  urlOf(input).startsWith('https://open.er-api.com/')
    ? Promise.reject(new Error('journey 19'))
    : window.__j19.fetch.call(window, input, init);
```

Selective for the same reason `currency-fallback.smoke.spec.ts` fakes it that
way: the Firestore transport and the auth token exchange ride `window.fetch`
too, and a blanket rejection takes the session down with the rates.

The global carries the cache string, the real `fetch` and the root element's
theme classes together because this half reloads nothing until it is over —
one object to restore, and the reload at the end drops the wrapper with the
page whatever happened.

`expired` is then the kept table aged thirteen hours past the twelve-hour
window; `fallback` is the key removed. Each is followed by
`await rates.initializeRates()` and one read of the rung, the line's text,
its class list and its computed colour.

### The access is diagnostic-grade, and the record says so

`private` is TypeScript's word, which the running page does not enforce. A
private field read from a console is the same class of access journey 14
already uses for the reminder seam. What it proves is the rung the ladder
chooses and the line the component renders for it — not the boot sequence.
That is why the journey does not end there: the real `fetch` and the kept
string go back, the ladder is re-entered once more to confirm the starting
rung, and then the page is **reloaded**, so the last thing on screen was
painted by an ordinary boot rather than by a signal that was told so.

### The theme is swapped on the root element, never in Settings

`root.classList.add('dark-theme')` / `remove('light-theme')` is exactly what
`ThemeService.applyTheme` does to the root element and nothing besides. The
Settings theme control writes `preferences.theme` on the user document, and
this journey has no account write in it. Both classes are restored from the
kept string.

### The `fallback` rung gets a smoke case beside `expired`

`currency-fallback.smoke.spec.ts` already proved the expired cache beats the
constants by the rate a real `addTransaction` persisted — 1/157 against the
constants' 1/149.5. The mirror case is the one that was missing: a device
that has never cached a table persists 1/149.5 and **not** 1/157, reports
`rateSource` `'fallback'`, and carries a null `lastUpdated`. Two specs, one
discriminating pair of numbers, so neither rung can be right by accident.

### No app code

The whole of #422 is a protocol section, a smoke case and this record.

### What was rejected

- **A test-only seam for the endpoint** — an environment field, a debug
  global, a query parameter. Any of them would make the journey trivial and
  would put a switch in the production bundle whose only purpose is to break
  the app. The console re-entry costs nothing shipped.
- **Adding a refresh control to reach the failure paths.** 0127 rejected it
  on its own merits and this does not reopen it: a control that exists so a
  journey can press it is not a control the app wanted.
- **Running the journey against the seeded harness.** It would work, and it
  would prove the line renders in a demo account against emulators — which
  is what the specs already prove, minus the real catalogs and the real
  theme.
- **Asserting `lastUpdated()` is null on the `fallback` re-entry.** See
  below: it would be asserting something that is not true of a re-entered
  ladder, and the screen does not read it.

## Consequences

- **Journey 19 grows three subsections** — the read half, the write half and
  the two rungs a boot cannot reach — and is the only journey in `e2e.md`
  with `####` headings. It earned them: it is now three procedures with
  different authorisations rather than one.
- **The permitted-writes table's rate row covers the re-entry**, and says
  explicitly that it adds no request of its own — the wrapper rejects the
  rates host and passes everything else to the real `fetch`, and both the
  wrapper and the theme classes live on the page only.
- **`currency-fallback.smoke.spec.ts` is three cases**, all under the
  emulators.
- **Run 1 read both lines in both themes.** `expired`: *Could not update
  exchange rates — using saved rates from 2026-09-13*, class
  `rate-line-stale`, `rgb(180, 83, 9)` in light and `rgb(251, 191, 36)` in
  dark. `fallback`: *Could not fetch exchange rates — using built-in
  approximate rates*, no date on screen, same class and same two colours.
  The account runs the dark theme, so light was the swapped one, and both
  classes went back as they were. Zero `error`-level console entries across
  the journey; the cache byte-equal to the backup at the end.

## Departures from the issues

- **The write half was widened rather than just extended.** #422 is about
  the two unreachable rungs; the journey now also seeds a *fresh* cache with
  the current clock before removing the key, because the read half's claim —
  that a boot within twelve hours lands on `cached` and says so without a
  warning — was worth arranging deliberately rather than waiting for a boot
  to produce it.
- **The journey does not read the network log to prove a boot asked for
  nothing.** The pane's log may record same-origin requests only, so the
  absence of a rates request there proves nothing. The rung is the evidence.

## Things that only became apparent while building

- **`setDefaultRates()` leaves `lastUpdated` alone, so a re-entered ladder
  keeps the cache's date in the signal.** That is 0037's decision and 0127
  restates it — the constants stamp nothing rather than stamping the wall
  clock — but the consequence for a *re-entry* is particular: a run that has
  already been through `expired` still holds the expired cache's date when it
  lands on `fallback`. Nothing on screen is wrong, because the template's
  `fallback` branch reads no date and says *approximate* in words. So the
  journey's criterion is the sentence and the rung, never a null stamp. The
  null belongs to a service built with no cache at all, and that is exactly
  where the smoke case pins it.
- **The line could not be read without a render flush.** In a pane the host
  is not showing, the model moves and the view does not; reading the text
  straight after `initializeRates()` returns the previous sentence. The
  journey says to flush with
  `ng.applyChanges(ng.getComponent(document.querySelector('app-rate-status')))`
  first.

## Known gaps

- **The re-entry is diagnostic-grade.** It proves the ladder's choice and the
  component's rendering, not the boot path that would normally make that
  choice. The final reload is what covers the boot, and it covers only the
  rung the device actually lands on.
- **`expired` after a genuinely failed boot has still only been seen in
  specs.** No arrangement available to a read-only run against production
  makes a real boot's fetch fail.
- **Seven pre-existing smoke specs log `[GeminiService]` lines** under a
  developer key present in the local environment file — app, period-totals,
  weekly-recap, period-window, backup-restore, nl-search and budget-recalc.
  They are noise in the whole run's output and none of them belongs to this
  work; the two translation smoke specs and the app-lock one strip the key
  for exactly this reason.
