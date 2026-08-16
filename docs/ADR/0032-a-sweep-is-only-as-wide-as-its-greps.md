# 32. A sweep is only as wide as its greps

**Status:** Accepted, implemented · **Date:** 2026-08-10 · **Issues:** #248, #266, #267

Reference documentation lives in [../dates.md](../dates.md).

## Context

ADR 0026 established that every date boundary in the app is computed by
`transaction-date.utils.ts` and nothing else builds one. Two sweeps enforced it:
#168 converted the parse sites, #201 the window sites. Both were driven by greps
for particular shapes, and `docs/dates.md` published two of those greps as the
standing audit.

Three defects survived both. They are not exotic:

- The receipt parse in the shared cloud provider base still read a date-only
  string with the `Date` constructor, which is UTC midnight by language
  specification. West of UTC a receipt dated the 1st filed into the previous
  month — wrong budget period, wrong monthly comparison, wrong insight bucket,
  no warning (#248).
- The dashboard summary's grounding block rendered each expense's day with
  `toISOString`, so the model was told UTC days while the user was shown local
  ones. The prompt asks the model to cite those dates, so the wrong day came
  back as prose and was cached for an hour (#266).
- The forecast occurrence query closed its window `N × 24h` from the current
  instant while the chart drew `N` whole calendar days, so a payment scheduled
  later in the day than "now" vanished from the chart and from the projected
  net until the page was reloaded later in the day (#267).

Each is one line, and every helper needed already existed. The interesting
question is not how to fix them. It is why an audit that was run twice, and
whose rule was written down, did not see any of them.

The answer is in the greps themselves. They matched `23, 59, 59` / `setHours(23)`
and `getMonth() + 1, 0`. Not one of these three defects has either shape:

| Defect | Shape | Matched by the published greps |
|---|---|---|
| #248 | `new Date(parsed.date)` | no |
| #266 | `toISOString().split('T')[0]` | no |
| #267 | `now.getTime() + days * 24 * 60 * 60 * 1000` | no |

Worse, #248 was *touched* by the sweep that was supposed to fix it. `c642b83`
converted eight parse sites and edited all three provider files, but each
provider carried its own copy of `parseReceipt` and the identical line survived
in every one. The later hoist into `CloudLLMProviderBase` then consolidated
three identical misses into a single line, which reads like a chokepoint and had
never been audited as one.

## Decision

**Anything the app did not compute is untrusted input, and comes through
`parseDateInput` or `parseDayKey`.** Model JSON, on-device OCR extractions, CSV
cells, queued rows, restored backups, query params. Both return `null` rather
than an Invalid Date, which matters more than it looks: an Invalid Date is
truthy, so the receipt form's `primary.date || new Date()` fallback never fired
and the user got an empty datepicker with no error. A day that leaves the app
and comes back is written with `dayKey` and read with `parseDayKey`, which are
exact inverses.

Rejected: validating at each call site instead. That is what the three copies of
`parseReceipt` were, and they drifted the moment one of them was edited.

**A window's supplier closes where its consumer draws.** ADR 0026 decided that
every window closes on the last millisecond of its final day, and applied it to
the things that *consume* a period. `getNextOccurrences` is a supplier — it
answers "which occurrences are in the next N days" for a component that then
walks N calendar days — and the rule reaches it too. The fix is
`endOfDay(addDays(startOfDay(now), days))`, not a widened millisecond constant.

Rejected: widening the query past the final charted day to be safe.
`buildForecastSeries` keys occurrences by day and never reads a key past its
last walked tick, so anything beyond it is dropped silently. A supplier that is
too generous is as wrong as one that is too mean; it just fails invisibly.

**A grep that cannot see a shape is not a guard.** This is the part worth
keeping. `docs/dates.md` now lists four greps that must return nothing in
production, one per shape that has escaped at least once — the original two plus
`toISOString().split` and day-millisecond arithmetic. Every one of them is empty
as of this branch.

It also lists a fifth that *cannot* be zero, because cloning a `Date` and
parsing a string look identical to a regex — and gives it a named allowlist with
a reason per entry, rather than dropping it for being noisy. A grep with two
justified exceptions is a working guard; a grep that was never written is not.

Rejected: writing a `check-dates.mjs` and wiring it into CI. That is the right
end state and it is deliberately not in this branch — the greps had to be proven
empty by hand before automating them would mean anything, and #276 is open
against exactly the failure of shipping a check that asserts more than it
enforces. Named as a known gap in `dates.md` instead.

## Consequences

Four production sites changed, each a one-liner against a helper that already
existed. `test:dates` grew from nine specs to thirteen, because a spec asserting
a calendar day proves nothing at offset 0 — the fourth criterion for a new date
spec is now "is it in the include list".

The three export filenames that stamped a UTC day are converted too. They were
cosmetic on their own — a backup named for yesterday — but the grep cannot be
published as empty while they exist, and a guard with unexplained exceptions
decays into one nobody runs.

## Departures from the issues

Widening the audit turned up a fourth site of the same class that no issue
covers, and it is fixed here: `RecentTransactionsComponent` assembled a local
`YYYY-MM-DD` by hand — its own comment says "not UTC" — and navigated to the
transactions page, which read it back with `new Date()`, i.e. as UTC. Clicking a
recent transaction west of UTC pre-filtered the list to the day before the row
the user clicked. Both halves are `dayKey`/`parseDayKey` now.

This is the ADR 0026 pattern repeating: that sweep also reached nine files
rather than the four its issue named. A date fix that stops at the filed line
count has stopped early.

#266's proposed fix named only `RagContextService`. Its fifth acceptance
criterion asks for the new grep to be empty, which the three export filenames
made impossible, so they came along.

## Things that only became apparent while building

**The specs were not merely silent; three of them asserted the bug.**
`openai.service.spec.ts` compared the parsed date against
`new Date('2024-02-03')` — the same broken parse on both sides of the
assertion, so it held in every zone on earth while the receipt filed into the
wrong month. `gemini.service.spec.ts` and `native-receipt.service.spec.ts` did
the same. `rag-context.service.spec.ts` built every fixture at UTC midnight, a
shape a real row never has, since a transaction is stored at a local wall-clock
time. A test written in the units of the bug cannot see the bug.

**`occurrencesFrom` pinned "today" to midnight** — the single moment of the day
at which a raw-millisecond window and a whole-day window coincide. Ten specs ran
through that helper. All ten passed, and none of them could have failed.

**The smoke spec could not mock the clock.** `jasmine.clock()` replaces
`setTimeout`, which the Firestore SDK needs, so the emulator case stamps its
occurrence late in the day instead of moving "now". It reproduces the bug
regardless — the occurrence disappears entirely against the old line — and it
proves the thing a unit spec structurally cannot: that a `Timestamp` which has
been through Firestore and back through `.toDate()` lands inside the bound.

## Known gaps

- **The audit is still manual.** No `dates:check`, no lint rule. `dates.md`
  records this.
- **The smoke suite runs at one offset.** CI invokes `npm run smoke` with no
  `TZ`, although comments in two smoke specs describe it as running under a
  shifted zone. That is the shape #276 is about — a guard that documents itself
  as enforced and is not — and it wants its own issue rather than a drive-by fix
  here. Closed by [ADR 0050](0050-a-spec-that-claims-a-zone-runs-under-it.md),
  #280.
- **`parseDateInput` still leaves ambiguous non-ISO shapes to the platform.**
  `06/15/2024` reads the way the browser has always read it. Deliberate: this
  branch does not touch DD/MM disambiguation, which is a separate decision about
  what a receipt from an unknown locale means.
- **Two more private copies of `dayKey` remain.** `NlSearchService.toIsoDate` is
  byte-for-byte identical to it, and `DateFormatService` assembles its own in
  one branch. Both read local parts, so neither is a bug — but they are the
  material the next one is made from.
