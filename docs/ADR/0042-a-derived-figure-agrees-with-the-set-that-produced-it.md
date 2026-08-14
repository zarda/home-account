# 42. A derived figure agrees with the set that produced it, and a cached one keys on all of it

**Status:** Accepted, implemented · **Date:** 2026-08-14 · **Issues:** #255, #259

Reference documentation lives in [../recurring.md](../recurring.md) and
[../insights.md](../insights.md).

## Context

Two defects filed a week apart turned out to be the same mistake made in two
places: a number was taken from one set of inputs and then presented next to a
different one.

**The recurring portfolio card counted a converted subscription twice.**
[ADR 0020](0020-detected-groups-convert-through-the-prefilled-form.md) decided
that converting a detected group into a rule must not back-write `recurringId`
onto the charges behind it — relabelling history to make a display problem go
away is worse than the display problem. The consequence it recorded was that
the detector would rediscover the group forever, so "covered groups are
suppressed, not relabeled".

Suppression was implemented where the rows are drawn, in
`RecurringListComponent.visibleDetected`. The card above those rows reads
`facts.recurring`, which is produced upstream by `computeRecurringGroups` and
knows nothing about rules. So a $15/month subscription, once its new rule had
posted two occurrences, read "$30 per month — 2 recurring payments, 1 you set
up, 1 found in your history" above a single visible row, and stayed that way
for about three months until the pre-conversion charges aged out of the
six-month window.

Two docstrings asserted the invariant this broke — the detector's own, and the
list component's, both claiming that separating declared from detected is what
stops the portfolio double-counting. Both were half right. Separating the
populations stops a single *transaction* being counted twice. Nothing stopped
one *subscription* surfacing as two groups.

The same unfiltered numbers reached three more places: the standalone "price
rose" and "just started" cards, the month-over-month snapshot comparison, and
the sentence handed to the narrative model.

**The dashboard AI summary cached one period's text under another's key.**
`generateInsights` receives the period it was issued for and uses it to build
the prompt, but every write it performs afterwards re-reads the component's
live signals. Between issuing the request and writing the result sit three
awaits and two provider round trips. Switch the period selector inside that gap
and the finished text — describing the period the user just left — is rendered
under the new heading and written into sessionStorage under the *new* period's
key, where it is served for the next hour.

Worse than a race that self-corrects: if the newly selected period already has
a valid cache entry, no fresh request is issued, so the late writer's wrong
text is the last write and stands for the full TTL.

The period selector was only the most visible trigger. The key also folds in
the locale, the RAG tier, the provider preference and a goal fingerprint, and
any of those changing mid-flight mis-keys the result the same way.

There was also a second, quieter fault underneath. The card stays mounted
across period changes, and the two inputs it reacts to do not move together:
`currentPeriod` flips synchronously on the click, while the shared
`transactions` signal only flips when the Firestore snapshot lands. So one
click could leave three generations in flight, and the middle one was
guaranteed rather than unlucky — it asked the model to describe last month
while handing it this month's rows, and then cached the answer.

## Decision

**A figure and the list beneath it are taken from one filtered set, and a cache
in front of that computation keys on every input to it.**

Concretely, in three parts.

### Coverage is applied inside the detector

`computeRecurringGroups` gained an optional fifth parameter, a
`CoveragePredicate`, applied to detected groups before ranking, before the
display cap, and before every count and total. Everything downstream — the
card, the notable-item cards, the snapshot comparison, the narrative — becomes
correct without knowing coverage exists, because they all read the one summary.
`RecurringListComponent` now filters nothing.

The predicate is *injected* rather than imported. `isGroupCovered` lives in
`recurring-conversion.utils.ts`, which already imports the detector's
thresholds to match merchants the way the detector does; importing it back
would close the cycle. Two alternatives were rejected:

- **A predicate in `RecurringOptions`.** That type is a bag of numeric tunables,
  spread from a plain exported const that two other modules read, and reachable
  as plain data through `InsightDetectorOptions`. Putting a closure in it makes
  a data type carry a function.
- **Splitting into `detectRecurringGroups` plus an exported summarizer, with
  the filter applied between them by the caller.** Architecturally cleaner —
  policy leaves the detector entirely — but it costs two public entry points
  where one caller needs the split, duplicates the options merge, and leaves
  `computeRecurringGroups` still able to summarize an unfiltered set. That last
  point is the hazard this record exists to close.

Coverage never applies to declared groups. `isGroupCovered` matches on cadence
and merchant name, which a rule matches against its own occurrences, so a rule
would suppress the very group it created. Previously only the caller's
pre-filter prevented that; now the detector states it.

### The rule set is an input, so it is in the cache key

`InsightsService` caches its computation by content with no TTL, which is what
makes "a key can only match when the inputs match" true rather than hopeful. An
input outside the key is not a stale answer — it is a permanent one.

The key folds in `recurringCoverageFingerprint`, over exactly the four fields
coverage reads: `isActive`, the frequency type and interval, and the normalized
name. Deliberately not the whole rule. `nextOccurrence` advances every time the
engine posts a catch-up occurrence, so hashing the rule wholesale would evict
the cached facts roughly daily for a change that cannot move a figure. The
fingerprint sits immediately beside `isGroupCovered` because the two have to
change together: a field one reads and the other ignores is a coverage decision
the cache cannot see.

Both compute paths were given rules, and they get them differently:

- The **snapshot writer** enumerates the collection through a new
  `RecurringService.listAll()`, per
  [ADR 0034](0034-a-correctness-read-enumerates-the-collection.md). Its output
  is persisted and frozen, and `generateClosedMonths` is fired-and-forgotten at
  dashboard open with no ordering against whatever fills the signal. Read once
  per generation run rather than per month.
- The **live tab** reads the signal, and `InsightsService` gained an effect that
  recomputes when it changes. Saving a rule has to move the total while the tab
  is open — that is the whole point — and the content-keyed cache makes an edit
  that cannot move coverage a no-op read rather than a recomputation.

### An async write proves it is still current

`AiSummaryComponent` captures its cache key once, before the first await, and
threads it into every read and write. It also captures a generation counter and
drops everything a superseded run produces: the rendered text, the cache write,
the error flag, and the spinner.

The counter is bumped as the *first* statement of `loadInsights`, before the
cache is read. That ordering is load-bearing. A cache hit that supersedes an
in-flight miss must bump the counter, or the older run passes its own guard on
return and overwrites the correct text with the wrong period's.

`InsightNarrativeComponent` already captured its key correctly and was the
model for that half — but only that half. It has no generation counter, so its
own late writes are still unguarded. That is a real gap, left alone here rather
than fixed in passing.

Finally, the dashboard now publishes the period the loaded rows belong to,
rather than the one the selector is on, in the same synchronous emission that
writes the rows. Key capture alone would have fixed the *correctness* bug while
still paying for a doomed pair of provider calls on every period change.

## Consequences

The card and the rows agree by construction, and `hiddenCount` means what it
says for the first time — both sides of its subtraction are now over the same
set, so it counts only what the display cap dropped. Previously a suppressed
group vanished from the list without incrementing it.

`RecurringListComponent.visibleDetected` and its `activeRules` input are gone
rather than kept as a pass-through. With the facts filtered, that computed is a
guard that can never fire, and
[ADR 0038](0038-a-dead-guard-reads-exactly-like-a-live-one.md) is precisely
about what those cost a reader.

The generation counter is the first use of the pattern in a component. It is
established in `core/services` — `transaction-window.service.ts` states it most
plainly, and `analytics.service.ts` guards its consent race the same way — and
this is the same problem, so it uses the same shape rather than inventing one.

Saving a rule now invalidates the cached insight facts, and with them any
narrative keyed off the fact fingerprint. That is correct and it is not free: a
conversion triggers a recompute.

## Things that only became apparent while building

**There is a transient dip after a conversion.** Between converting a group and
the new rule posting its second occurrence, the detected group is suppressed
but no declared group exists yet — `minDeclaredOccurrences` is 2 — so the
portfolio total under-counts by one group for up to two cadence intervals. This
is not new behaviour; the list has always hidden the group over exactly that
window. It is now visible in the total as well, which is the point. Suppressing
only when a declared twin already exists was considered and rejected: it is
indistinguishable from a paused rule, and it would put the headline back into
disagreement with the list.

**The `untracked` wrapper on the summary effect nearly broke two features.**
The effect's dependency on the RAG tier, the provider preference and the goal
fingerprint existed *only* because `getCachedInsights` read the cache key
synchronously inside the effect's call stack. Wrapping the body in `untracked`
in the obvious way would have silently stopped the summary regenerating on a
tier or provider change. The key is now read explicitly in the tracked body, so
the dependency is stated rather than inferred — which is what it should have
been.

**The existing detector spec that asserts `31.98` for a declared-plus-detected
pair is still right.** It passes no rules, and whether two groups are one
subscription is a question only the rule set can answer. It was left green and
its comment corrected, rather than being treated as a test that pinned the bug.

## Known gaps

**Snapshots written before this change keep their unfiltered figures, and
staleness will not flag them.** The persisted fingerprint is pinned by
`firestore.rules` to four keys — transaction hash, count, time zone, base
currency — and adding the rule set to it would mean a rules change, a schema
version bump, backup and restore work, and every stored month reporting stale
on any rule edit. A snapshot records what was true when it was written.
Regeneration is the remedy, and it is already offered.

The same reasoning cuts the other way and is worth stating plainly: because the
rule set is *not* in that fingerprint, regenerating an old month after a
conversion can legitimately produce different numbers from the ones stored,
without anything having reported the snapshot stale. That is a real edge in
[ADR 0033](0033-a-stored-figure-is-re-taken-only-when-its-input-moved.md)'s
terms, accepted rather than closed.

**`RecurringService.catchUpRecurringTransactions` still takes a
correctness-bearing read from a listener's first emission** — the ADR 0034
anti-pattern, on a path that posts real transactions. Nothing here depends on it
any more. It wants its own issue.

**The AI summary cache key still truncates its transaction-id list to 100
characters**, so two genuinely different windows can collide on one key. The
narrative component's comment has called this out for a while. Nothing added
here leans on that key for correctness — the generation counter does not — but
it is not fixed either.
