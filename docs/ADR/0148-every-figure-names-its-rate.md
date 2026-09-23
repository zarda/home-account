# 148. Every figure names its rate

**Status:** Accepted, implemented · **Date:** 2026-09-24 · **Issues:** #429

Reference documentation lives in [../money-snapshots.md](../money-snapshots.md)
and [../exchange-rates.md](../exchange-rates.md).

Extends [0093](0093-the-summary-export-names-both-sides-of-the-ledger.md)'s
conversion rule from one export to every figure over transactions already
written. #429's third part, the merged count, is recorded in
[0147](0147-a-row-is-graded-by-what-its-door-can-vouch-for.md).

## Context

Every transaction carries the base-currency figure it was written with, and
`CurrencyService.amountInBase` reads it —
[money-snapshots.md](../money-snapshots.md) states the rule, and 0093 applied
it to the category summary export on the grounds that a figure over the past
should not move when the market does. Six figures over past transactions did
not follow it, and the export dialog showed the cost: its report PDF
converted every row at today's rate while the summary PDF beside it read the
snapshots, so the two files could print different totals for one period —
0093's first gap. The reports page's category, country and recurring
breakdowns converted live too, each citing another as its reason — the
country card's was [0068](0068-a-country-is-stored-on-the-evidence-that-produced-it.md)'s
gap — and so did both halves of the AI summary: the period total the card
hands its advice request, and the totals the spending-summary prompt itself
quotes.

Three figures cannot follow the rule, because they are over money that has
not moved yet: the Upcoming card's *Scheduled net*, the weekly recap's bills
due, and the forecast's projection. A scheduled occurrence is not a written
row, so there is no snapshot to read. They converted at today's rate and said
so nowhere — [0091](0091-the-upcoming-card-reads-the-live-schedule-not-the-ledger.md)
named it for the first of them.

Three more gaps sat in the machinery underneath.

**The summary cache key saw about five transactions.** It joined every id
into one string and kept the first hundred characters, so a period whose first
few ids matched an earlier one was served that period's cached summary —
[0042](0042-a-derived-figure-agrees-with-the-set-that-produced-it.md)'s last
gap.

**A rate value was never checked.** The fetch path confirmed the envelope —
`result: "success"`, an object, two or more keys — and then installed every
value as a rate. The cache reader filtered out non-numbers but accepted zero
and negatives. [0037](0037-an-error-body-is-a-failed-fetch.md) recorded the
first half.

**A boot that missed the live table kept its fallback for the session.**
`refreshRates()` ran once, from the constructor, so a session that began
offline converted through an expired cache or the compiled-in constants until
the app was next started — 0037's second gap, restated by
[0127](0127-a-figure-the-app-cannot-vouch-for-says-so.md). And the line that
reports the rung carried a date and no time, so a table fetched an hour ago
and one fetched at breakfast read the same — 0127's second gap.

## Decision

**A figure over transactions already written reads the rate they were written
at. A figure over money not yet moved converts at today's rate and says so.
And the table those conversions read holds only real rates, keeps a built-in
rate where a real one was dropped, and tries again when the connection
returns.**

### The past reads its snapshot

Six sites move from `convert(t.amount, t.currency, base)` to
`amountInBase(t, base)`:

- the export dialog's report totals, so the report PDF and the summary PDF
  total one period the same way;
- the reports page's category, country and recurring breakdowns;
- the AI summary card's period total, the figure its advice request is built
  on;
- the spending-summary prompt's income, expenses, category breakdown and
  largest expenses, which `CloudLLMProviderBase.generateSpendingSummary`
  builds for all three providers — so the summary's narrative and the
  advice beside it quote the same totals for one period. The same prompt's
  budget limits and goal amounts keep `convert`: they are a budget's and a
  goal's own figures, not written transactions, and carry no snapshot to
  read — the goal half is
  [0021](0021-one-goal-model-carries-savings-and-projects.md)'s gap,
  unchanged. A budget's spent figure in that prompt is summed from the
  category totals, so it reads the snapshots with them.

`amountInBase` prefers the stored figure and converts live only where the
stored one cannot be trusted — no snapshot, one stamped against another base
currency, or a 1:1 rate between two different currencies. So a legacy row
still counts, at today's rate, and a row written since counts at its own. The
comment in `export.service.ts` that called the dialog's live total "a standing
divergence" is rewritten; the divergence is gone.

### The future converts live, and says so

The *Scheduled net*, the recap's bills-due line and the forecast's projected
net keep `convert` and render **At today's rate** (`common.atTodaysRate`)
beside the figure. Today's rate is the least wrong guess at a rate nobody has
paid yet; the caption is what makes it honest. The forecast was already split
the right way — actuals through `amountInBase`, occurrences through `convert`
— and needed only the caption.

### The cache key sees the whole set

The AI summary's cache key uses `transactionFingerprint`, the FNV-1a digest
over every `id:revision` pair in id order plus the count, which the stored
insight snapshots already key on. It sees every transaction, not the first
five, and it also changes when a transaction is edited, which a key built from
ids alone cannot.

### A rate table keeps only real rates

`sanitizeRates(raw)`, in `currency.model.ts` beside `ExchangeRates`, keeps an
entry only when its value is a finite number above zero. A string, `NaN`,
zero, a negative and `Infinity` are dropped rather than coerced; an array is
refused outright, since `typeof [] === 'object'` would otherwise index rates by
position; and a table with fewer than two survivors is refused, as the cache
reader already refused one, because a single entry expresses no cross-rate.

Both paths that meet an unverified table call it. The fetch path runs it on
`data.rates` once the envelope says `success`, and a refusal throws the same
unusable-body error an in-band failure does, so the ladder walks on. The cache
reader runs it on what it parsed. The fetch path caches the sanitised table,
so a bad entry never reaches the device either.

### A dropped rate keeps its built-in value

Sanitising opens a hole of its own. A curated currency whose entry was dropped
is simply absent from the installed table, and `getExchangeRate` reads an
absent code as `?? 1` — so a malformed JPY entry would have turned from a
garbage conversion into a plausible-looking one at par. That is #251's class,
the defect in which every currency converted 1:1, and it is worse than the
garbage it replaces because nothing about it looks wrong.

So `withBuiltInFallback` installs the nineteen compiled-in rates underneath
every accepted table, live or cached, and lays the table's own entries over
them. A curated code the table lacks keeps its approximation; a code the table
carries always wins. The device cache still holds only the sanitised live
values, never the filled-in table, so a later read cannot mistake an
approximation for a rate the provider sent.

It went in with the sanitiser rather than after it, because the sanitiser is
what creates the absence.

### A missed live table tries again

When the ladder settles on `expired` or `fallback` — the two rungs that failed
to reach the provider — `CurrencyService` arms a `window` `online` listener.
On the event it first reads `PwaService.isOnline()`, as the offline queue's
own listener does, then re-runs `refreshRates()`. A success installs the live
table and flips the rung to `live`, and the Settings line repaints from the
same signal.

- **At most three attempts a session** (`RATE_RETRY_LIMIT`), spent one per
  `online` event rather than per interval. No timer runs, so nothing keeps the
  radio awake, and a connection that never returns costs nothing.
- **One attempt at a time.** A flaky reconnect can fire `online` twice before
  the first fetch settles. `retryInFlight`, the offline queue's
  `syncInProgress` idiom, makes a second event during an attempt start no
  request and spend nothing.
- **The listener goes** on success, at the limit, and when the service is
  destroyed.
- **A destroyed service never arms one.** The listener is armed only once the
  boot fetch has settled, in `initializeRates`'s `finally`, and that fetch can
  outlive the injector: `DestroyRef.onDestroy` can run first, and a listener
  armed after it would have nothing left to remove it. So the destroy callback
  sets a `destroyed` flag, and arming returns while it is set. The root
  injector lives as long as the page, so in the app the order never turns; a
  test module torn down mid-fetch is where it does, and a listener left on
  `window` there answers every later spec's `online` events.

A boot that landed on `live` or `cached` arms nothing: its table is current.
No control is added — 0127 rejected a refresh button on its own merits, and a
retry the app runs by itself does not reopen that.

### The line says when

`LocaleFormatService.formatTime(value)` formats hour and minute on the
locale's own clock — `Intl.DateTimeFormat(locale, { hour: 'numeric', minute:
'2-digit' })`, one formatter kept per locale — and `settings.ratesLive` and
`settings.ratesExpired` gain `{{time}}` in all three catalogs:
*Exchange rates updated {{date}} at {{time}}*. `settings.ratesBuiltIn` is
unchanged; the constants carry no stamp.

## What was rejected

- **Captioning the past instead of fixing it.** A caption on a figure that
  moves with the market admits the problem without removing it, and the figure
  would still disagree with the summary PDF and with the dashboard.
- **Storing a rate for a future occurrence.** There is no written row to carry
  it, and any rate stored for money not yet moved would be a guess recorded as
  a fact.
- **Hashing the joined ids**, which #429 proposed. The fingerprint already
  existed, one call away, and it sees edits.
- **Letting a dropped rate fall to `?? 1` and filing it.** Shipping the
  sanitiser alone would have introduced the par conversion it exists to
  prevent.
- **A timer or a backoff.** A retry on a clock keeps the radio awake to ask a
  question whose answer has not changed; the `online` event is the moment
  something did.

## Consequences

- **Both PDFs, the reports page, the dashboard and the AI summary — its
  period total and the totals its prompt quotes — agree for one period**, and
  a period whose rates have moved since no longer moves with them.
- **The summary's old cache entries are orphans.** A key of the old shape is
  never read again, since the cache reads exact keys only, and it goes when the
  session does.
- **`CurrencyService` injects `PwaService` and `DestroyRef`.** `PwaService`
  injects nothing, so there is no cycle, and it is root-provided, so no spec
  that builds the real currency service needed a new provider.
- **One catalog key is new** (`common.atTodaysRate`) and two gained a
  placeholder, in all three catalogs.
- **An emulator case pins the dialog.** It writes two transactions through the
  real `TransactionService`, moves the live table, and reads the report totals
  back as the stamped snapshots rather than a reconversion at the moved rate.

## Departures from the issue

- **The first part reaches the screen, not only the exports.** #429 asked for
  one conversion path for every exported figure. The breakdowns on the reports
  page cited each other as the reason to convert live; fixing the exports alone
  would have moved the disagreement from between two files to between a file
  and the page it was exported from.
- **Three figures carry the caption, not one.** The issue named the *Scheduled
  net*. The recap's bills due and the forecast's projection are the same case.
- **The sanitiser has a second half**, the built-in fill-in, and the retry an
  in-flight guard. Neither was asked for; both are what the asked-for change
  needed to be safe.

## Things that only became apparent while building

- **The sanitiser created the defect it guards against.** Dropping an entry is
  only safe if the absence is not read as 1, and `getExchangeRate` reads it
  that way.
- **An array is an object.** `Object.entries([1, 2, 3])` yields `'0'`, `'1'`
  and `'2'` as currency codes, which survive a finite-positive filter.
- **Two breakdown specs had fixtures that could not tell the two conversions
  apart.** Their helpers set an amount without the snapshot that goes with it,
  which was harmless while every stub read `convert` and wrong the moment one
  read `amountInBase`. They now derive the snapshot from the amount, the way
  the shared test factory already does.
- **The AI summary totals its period twice.** The card sums the period for
  its advice request, and `generateSpendingSummary` sums the same
  transactions again for its prompt; moving the first alone would have left
  the narrative quoting today's-rate totals beside advice built on the
  snapshots.
- **`PwaService` fetches on `online` too.** Its own listener probes
  reachability, so a spec counting `fetch` calls counts both; the retry specs
  count calls to the rates endpoint only, or, where the count must be one
  instance's, that instance's own `refreshRates` calls.
- **The boot fetch can outlive the injector.** Only the full suite showed it:
  a listener armed after a spec's teardown answered the next file's `online`
  events, which a run of the currency spec alone could not produce.

## Known gaps

- **A code no table knows still converts at 1:1.** The fill-in covers the
  nineteen curated codes. A code outside both the accepted table and the
  constants still reaches `getExchangeRate`'s `?? 1`, unchanged.
- **The retry repairs the table, not what was written through it.** A row
  written during a `fallback` session keeps the constants' rate in its
  snapshot, and nothing says so afterwards — 0127's fourth gap, unchanged.
- **The `online` check reads a flag, not a probe.** `PwaService`'s listener
  sets `isOnline` to true on the same event and checks reachability
  afterwards, so on an ordinary reconnect the check reads true, and a captive
  portal costs an attempt. The check also relies on that listener running
  first. It does today — `CurrencyService` injects `PwaService`, which
  registers its listener when it is constructed, and arms its own only once
  the ladder has settled — but nothing pins the order.
- **The limit counts events, not time.** A connection that flaps can spend all
  three attempts in a minute, and the session then keeps its table until the
  next start.
- **`formatTime` has two hand-rolled siblings.** The import history and the
  security activity list still call `toLocaleTimeString` themselves, against
  two different locale sources — #438's second part.
- **The reason for reading the snapshot is restated at each of the six
  sites** rather than stated once.
- **No spec measures the three captions at phone width.** The rules that keep
  them from overflowing were read, not measured.
