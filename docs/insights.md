# Spending-pattern insights

The Insights tab (fourth tab under **Reports**) distills a user's own transaction
history into plain-language patterns, and stores one snapshot per closed month so
those patterns stack up over time.

Everything runs on the user's own data. The detectors compare a user only against
their own history, never against other users, and the wording is descriptive
rather than judgmental — "your grocery spending rose 18%", not an opinion about
whether that was wise.

The reasoning behind the detectors and the snapshot model is in
[ADR/0002](ADR/0002-insights-and-monthly-snapshots.md).

## The two layers

**Rule-based detectors** are pure functions in `src/app/core/utils/`. They are
deterministic, unit-tested, and work with no AI provider configured. This layer is
the feature.

**An optional written narrative** sits on top, gated twice (see
[Privacy](#privacy-what-leaves-the-device)). It is never required, never stored,
and the cards read correctly without it.

## Detectors

The single source of truth for thresholds is each detector's `DEFAULT_*_OPTIONS`
constant. Keep this table in sync when they change.

| Detector | File | Key thresholds | Surfaces as |
|---|---|---|---|
| Recurring / subscription creep | [`recurring-pattern.utils.ts`](../src/app/core/utils/recurring-pattern.utils.ts) | 3 occurrences detected / 2 declared; Dice similarity ≥ `0.70`; amount within `15%` of the cluster median; ≥ `70%` of gaps near the median | `recurringPortfolio`, `recurringItem`, plus the recurring list |
| Category trends | [`category-trend.utils.ts`](../src/app/core/utils/category-trend.utils.ts) | ≥ 3 whole months; ≥ 3 active months; ≥ `2%` window share; \|relative slope\| ≥ `0.08` | `categoryTrend` |
| Habit rhythms | [`habit-rhythm.utils.ts`](../src/app/core/utils/habit-rhythm.utils.ts) | ≥ 20 transactions; lean beyond `20%`; month-end ratio ≥ `1.30` with ≥ 6 tail samples; payday ratio ≥ `1.25` with ≥ 5 samples | `habitWeekdayWeekend`, `habitMonthEnd`, `habitPayday` |
| Small-amount drip | [`small-drip.utils.ts`](../src/app/core/utils/small-drip.utils.ts) | threshold = p25 of the window; ≥ 20 transactions **and** ≥ `8%` of spending | `smallDrip` |

Anomaly detection and one-period category deltas already existed in
[`spending-insight.utils.ts`](../src/app/core/utils/spending-insight.utils.ts) and
are left untouched — `RagContextService` and `InsightChipsService` both build on
them.

### Decisions worth not re-litigating

**Recurring detection splits declared from detected.** Occurrences carrying a
`recurringId` were materialised from a rule the user configured, so the detector
only *measures* their cadence; everything else is clustered by merchant
similarity. Merging the two would present the user's own configuration back to
them as a discovery, and would double-count the portfolio total. `isRecurring` is
not the discriminator — it is a plain boolean a user can tick on a one-off, so it
only contributes `userFlaggedCount`.

**Merchant normalisation keeps every letter and digit in any script.** The
`[^a-z0-9]` strip in `duplicate-detection.service.ts` reduces a Japanese
description to an empty string, which would collapse every CJK merchant into one
cluster. Similarity is Sørensen–Dice over *character* bigrams, which works where
whitespace tokenisation cannot. There is a regression test for this.

**Habit rhythms compare per-day averages, never totals.** A month holds roughly 22
weekdays to 8 weekend days, and 26 non-tail days to 5 month-end days. Comparing
totals would tell essentially every user that they "spend more on weekdays" and
have no month-end spike — two confidently wrong sentences. The calendar day counts
are part of the returned shape rather than derived in a template, so they cannot
be quietly forgotten.

**The drip threshold cannot be absolute, and its count cannot be the signal.** No
fixed amount means "small" for both a JPY and a USD user, so "small" is the 25th
percentile of the user's own window. That bucket holds a quarter of the
transactions by construction, so gating on count would hand every user the same
card; the gate is the bucket's *share of value*.

**A trailing window excludes an incomplete final month.** A partial current month
drags every trend downward and would produce "your groceries are falling 40%" on
the third of the month.

## Determinism

A snapshot has to be reproducible from the same transactions months later, so:

- no detector reads the clock — every temporal bound arrives as a parameter;
- day arithmetic normalises to UTC midnight before subtracting, or a DST
  transition turns a monthly cadence into 29.96 days;
- every sort carries an explicit tiebreaker, because Firestore returns rows
  date-descending with frequent ties;
- money and ratios are rounded at the output boundary;
- ordering uses code-unit comparison, not `localeCompare`, whose collation depends
  on the runtime's ICU data.

Each detector has a shuffled-input test asserting byte-identical output.

## Snapshots

One document per closed month at `users/{uid}/insightSnapshots/{yyyy-MM}`, written
by [`InsightSnapshotService`](../src/app/core/services/insight-snapshot.service.ts)
from the same pure functions the live tab uses. Model in
[`insight-snapshot.model.ts`](../src/app/models/insight-snapshot.model.ts).

- **Generation** is triggered from the dashboard's `ngOnInit` and again from the
  Insights tab, sharing one in-flight promise. Not from an app initializer:
  `onAuthStateChanged` resolves asynchronously, so at bootstrap there is no uid to
  build a path from.
- **Empty months are skipped**, and a fresh install backfills at most 12 months.
- **A snapshot looks back from its own month**, not from today.
- **Cards are frozen as computed**, so a past month renders without re-running any
  detector. That is what keeps old history readable as the detectors evolve.
- **Regeneration** is an explicit, confirmed user action that advances `revision`,
  so a rewrite is recorded rather than history being silently amended.
- **A restore never advances `revision`.** It writes the backup's own, and only
  when the stored month is behind it — a month regenerated since the backup was
  taken keeps its newer version, and a month already at that revision is left
  alone rather than reported as a failure. See
  [backup-restore.md](backup-restore.md).

### Generation requires connectivity — a deliberate deviation from #117

The issue suggests generation can read the local Firestore cache. It cannot
safely: a partially warm cache yields an under-counted month, and there is nothing
to detect that against, because `countDocuments` is server-only. Freezing a wrong
month that then looks authoritative is worse than deferring it to the next online
open. *Reading* past snapshots stays fully offline, which is the more valuable half.

### Versions

| Constant | Bump when | Effect on a stored document |
|---|---|---|
| `INSIGHT_DETECTOR_VERSION` | any detector's output for identical input can differ | Informational. A gap shows as a quiet footnote with a regenerate action. |
| `INSIGHT_SNAPSHOT_SCHEMA_VERSION` | the document shape changes | A reader refuses a document whose schema is newer than it understands. |

**A detector-version gap is not staleness.** "Your data changed since this
snapshot" and "our code changed" are different statements. The thresholds above are
first guesses that will be tuned, and lighting up every stored month the first
time one moves would alarm the user about something they did not do.

### Staleness

Computed, never stored — storing it would mean writing to a frozen document. The
fingerprint covers the month's transactions **plus the time zone and base
currency**, because either of those changes every number in the document without
changing a single transaction. Resolved lazily, only for the month the user opens.

### Firestore constraints, as verified against the emulator

These were established by
[`insight-snapshot.service.smoke.spec.ts`](../src/app/core/services/insight-snapshot.service.smoke.spec.ts)
rather than assumed, and two of them contradict what looked obvious:

- `undefined` **is** rejected, and the SDK throws **synchronously** from
  `setDoc` rather than returning a rejected promise. Optional fields must be
  omitted via conditional spread, never assigned `undefined`.
- Nested arrays **are** rejected, likewise synchronously. A per-category month
  series is therefore `{categoryId, values}[]`, never `number[][]`.
- **`NaN` is accepted.** Firestore stores it as a valid double. Nothing at the
  storage layer protects a snapshot from a `0/0` ratio, so `finiteOrNull` in the
  aggregation helpers is the only guard and has to be applied upstream. A stored
  `NaN` would render as "NaN" and poison every comparison drawn from that month.
- A written `Date` comes back as a `Timestamp`, so ISO strings stay strings only
  because they are stored as strings.

`findSerializationIssues` in
[`firestore-value.utils.ts`](../src/app/core/utils/firestore-value.utils.ts) turns
all of that into an assertion a spec can make before anything touches the network.

## The card contract

One shape covers every detector; see `InsightCard` in the model.

- **Money lives in `metrics` as raw numbers, never in `params`.** A formatted
  amount would freeze both a locale and a base currency into a record that may be
  read years later.
- **Category names and cadence words are not stored either** — the card carries
  ids and enum values, and the renderer resolves them.
- **A frozen month renders in its own `fingerprint.baseCurrency`**, not today's.
- **`InsightCardComponent` falls back to a generic rendering for an unknown
  `kind`**, because a document written by a newer build can name one this version
  has never heard of.

### i18n keys referenced by a stored card are permanent

`TranslationService.t()` returns the key itself on a miss and there is **no
English fallback**, so a key a stored card points at may be deprecated but never
deleted.

Card keys are consumed through a dynamic `card.titleKey | translate`, which
`scripts/check-i18n.mjs` explicitly skips. `INSIGHT_CARD_KEYS` in
[`insight-card.utils.ts`](../src/app/core/utils/insight-card.utils.ts) lists every
key any detector can emit, and its spec asserts each resolves in en, ja and tc.
That assertion is the only thing standing between a typo and a raw key rendered to
a user. The staleness reason keys have the same treatment in the timeline spec.

### Drill-down honesty

A card advertises a filter only when that filter genuinely selects the
transactions the number came from.

| Mode | Used by | Why |
|---|---|---|
| `filters` | `categoryTrend`, `smallDrip` when every window expense shares the base currency | Exactly expressible; the user gets the full Transactions toolbox |
| `inline` | recurring groups, `habitMonthEnd`, `habitPayday`, unsafe `smallDrip` | A fuzzy cluster's members have different descriptions by construction, and there is no id-list filter |
| `none` | `recurringPortfolio`, any archived card | No single underlying list, or the ids were deliberately never stored |

`habitWeekdayWeekend` opens the whole window and states its count honestly,
because there is no day-of-week filter. One card whose "based on 47 transactions"
opens a list of 180 would discredit every other card on the screen.

The amount filter compares raw native amounts while a threshold is in base
currency, so narrowing by amount is only honest when the two agree — the
`filterSafe` flag.

## Privacy: what leaves the device

The rule-based layer sends nothing anywhere. The narrative is gated on **both** a
configured provider and `effectiveRagLevel(prefs) !== 'off'`: detector output is
grounding data, and the RAG level is the control the user already has over how
much of their financial data reaches a provider.

What is sent, as an explicit allowlist built in
[`insight-narrative.component.ts`](../src/app/features/reports/insights/insight-narrative/insight-narrative.component.ts):
window months, base currency, totals, recurring counts and monthly equivalent,
trend directions and shares, the drip summary, rhythm flags, and category names
resolved locally. At the deep tier, per-month series as well.

Never sent: transaction ids, descriptions, notes, receipt URLs, locations, or
individual transaction dates. `generatePatternNarrative` takes a pre-built string
precisely so no parameter *could* carry any of those. Its spec asserts the outgoing
context contains none of them.

Prose is never stored. Model output cannot be regenerated identically, and storing
it would make the snapshot feature's "identical when regenerated" criterion
impossible to assert.

## Adding a detector

1. Write a pure function in `src/app/core/utils/`, taking `toBase` and a window,
   reading no clock, with a `DEFAULT_*_OPTIONS` constant for its thresholds.
2. Add a co-located spec, including a shuffled-input case and each gate boundary.
3. Extend `InsightFacts` and `computeInsightFacts`, stripping any transaction-id
   list out of the persisted shape.
4. Add a `kind` and a card in `buildInsightCards`, choosing a drill-down mode by
   the rule above.
5. Add the title and body keys to `INSIGHT_CARD_KEYS` **and** to all three locale
   files.
6. Bump `INSIGHT_DETECTOR_VERSION`, and update the table above.

## What not to put in a snapshot

- **Anything a person typed** — descriptions, notes, merchant strings. Aggregates
  and detector output only.
- **Transaction ids.** Those rows may not exist when an old snapshot is opened.
- **Model prose.** See above.
- **Formatted money or translated text.** Both freeze a locale into a permanent
  record.
- **A staleness flag.** It is derived; storing it would mean writing to a document
  that is supposed to be frozen.
