# 2. Spending-pattern insights and monthly snapshots

**Status:** Accepted, implemented · **Date:** 2026-07-26 · **Issues:** #116, #117

Reference documentation lives in [../insights.md](../insights.md). This record
keeps the decisions and the reasoning, including where the implementation
deliberately departs from what the issues asked for.

## Context

Four rule-based detectors (recurring/subscription creep, category trends, habit
rhythms, small-amount drip), an Insights tab under Reports, monthly snapshots at
`users/{uid}/insightSnapshots/{yyyy-MM}` with a timeline, comparison and
regenerate action, and an optional written narrative.

Concentration (top-N category share, top merchants) was considered and left out.
Four detectors already exceed #116's minimum of three, and a tighter first cut is
easier to tune against real data. The trend detector computes `windowShare`
already, so adding it later is cheap.

## Decision

### Placement: a fourth tab, not a route

The mobile bottom nav is full at five slots, so a top-level route would only be
reachable from the dashboard on a phone. The cost is that the tab sits under the
page's period selector while computing over a trailing window that is usually
wider — mitigated by stating the window in the tab header, which is the single
most likely source of confusion about this feature.

Four tabs also overflow a 375px viewport at the existing 120px tab floor, so the
floor is dropped on mobile where the short labels already fit.

### The tab owns its own query

The other three report tabs render from the shared `transactions` signal.
Insights uses `getTransactionsInRange` instead, which does not touch that signal.
`getByDateRange`, `getTransactions` and `getMonthlyTotals` all overwrite it, so
calling any of them here would silently change what the other tabs display. The
service spec asserts none of them is ever called.

The tab body is wrapped in `<ng-template matTabContent>` — nothing else in the
repo uses it, so all tabs are eager, and without it a six-month Firestore listener
would open on every visit to Reports.

### Determinism as a code property, not an aspiration

#117's headline criterion is that a regenerated snapshot is identical. Both the
live tab and the generator call the same pure `computeInsightFacts`, no detector
reads a clock, day arithmetic is UTC-normalised, sorts carry explicit tiebreakers,
and values are rounded at the boundary. The emulator spec asserts a rewrite from
reshuffled input changes only `revision`.

`localeCompare` was replaced with code-unit comparison after the fact: its
collation depends on the runtime's ICU data and ignores punctuation in some
locales, so `food_x` and `foodx` could order differently on two devices.

## Departures from the issues

### Generation requires connectivity (#117 says it can read the cache)

A partially warm Firestore cache yields an under-counted month, and there is
nothing to compare against because `countDocuments` is server-only. A frozen wrong
month looks authoritative and cannot be distinguished later from a correct one.
Deferring to the next online open costs nothing; reading past snapshots stays
fully offline.

### A detector-version bump does not raise the stale marker

The issue treats "data changed since this snapshot" as one condition. It is two:
the user's data moving, and our code changing. Only the first is something they
did. The thresholds in these detectors are first guesses that will be tuned, and
flagging every stored month on the first tuning pass would train the user to
ignore the marker. A version gap gets a quiet footnote with the same action.

### Snapshots are deletable

`securityEvents` is `allow delete: if false` because it is an audit trail. These
are not: account deletion has to remove them, and a rule cannot distinguish that
from deleting one snapshot. The guarantee is therefore immutability *in practice*
— closed field set, full-document rewrite, strictly increasing `revision` — rather
than immutability by rule. The rules comment says so, so the weaker guarantee does
not read as an oversight.

### No narrative in the document

#117 does not ask for one, but it is the obvious next thought. Model prose is not
deterministic, so persisting it would make the regeneration criterion
unassertable. Narratives live in a content-keyed session cache; durable prose, if
ever wanted, belongs in a sibling collection that carries no determinism promise.

## Things that only became apparent while building

**`insightSnapshots` was already in the rules smoke spec** as its example of an
*unvalidated* collection, asserting an arbitrary write was allowed. Adding a
validated block inverted that assertion and would have broken CI. The case now
uses a name that will never become a feature.

**Rules are additive**, so a validated block without a matching entry in the
catch-all exclusion array is decorative — any `{junk: true}` write still succeeds.

**Firestore accepts `NaN`.** This work assumed otherwise. `undefined` and nested
arrays are rejected — and the SDK throws *synchronously* from `setDoc`, so a test
helper taking an already-invoked call lets the throw escape. `NaN` is stored as a
valid double, which means nothing at the storage layer protects a snapshot from a
`0/0` ratio and `finiteOrNull` has to be applied upstream. All four behaviours are
now asserted rather than assumed.

**`minTailSamples: 6` makes a one-month window unable to report a month-end
spike**, because a month has only five tail days. That is correct — one month-end
is an event, not a pattern — and there is now an explicit test saying so.

**The AOT build type-checks templates that the karma builder does not.** The unit
suite passed while `npm run build:prod` failed on a `string | null` from the
currency pipe. `build:prod` is a distinct gate.

## Known gaps

- **Thresholds are unvalidated against real data.** Every number in the detector
  table is a first guess. The unit tests prove the arithmetic; only real history
  shows whether the cards are *interesting*. Bump
  `INSIGHT_DETECTOR_VERSION` when a tuning pass lands.
- **#48 (subscription detection) is partially delivered.** Detection and display
  are done; the one-tap "track as recurring" conversion is not.
- **Snapshot deletion is not wired to anything**, because no account-deletion
  feature exists. `InsightSnapshotService.deleteAll()` is ready for #73.
- **Real-device verification outstanding**: the four-tab header at phone width,
  and confirming `matTabContent` actually defers the listener.
