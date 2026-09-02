# 96. The weekly recap is composed on open, and nudged ahead

**Status:** Accepted, implemented · **Date:** 2026-09-02 · **Issues:** #52

Reference documentation lives in [../weekly-recap.md](../weekly-recap.md).

## Context

#52 asked for a scheduled spending digest — a recap of the week delivered
without opening the app — and named the ingredients it thought were already
there: the spending summary, the budget alerts, and the upcoming rules. It
also named its own caveat: Periodic Background Sync is Chromium-only, so the
first cut should be an on-next-open digest.

Two things had moved since it was written, and both narrow the question.

**There is still no server.** The functions workspace holds a feedback mailer
and a storage recount; nothing schedules anything, and
[ADR 0092](0092-a-reminder-fires-once-and-the-record-of-it-lives-on-the-device.md)
already decided what that means for anything that has to reach a user who is
not looking: local notifications, raised by a device that is going to compute
the figures anyway, with the record of what was raised living on that device.

**The dashboard is a busy publisher.** Every figure on it comes from listeners
the page owns, several of which write back — `getBudgets()` drives the
`freshenSpent` recalculations, and `getByDateRange` publishes the shared
transactions signal the whole page reads. A recap that joined those listeners
would be a second driver of state it only wants to read from, which is the
mistake ADR 0092 already declined to make once.

So the interesting questions are not "what does the card say". They are:
**what does it cost to open the dashboard**, **which week is it talking
about**, and **where does the fact that you have already seen it live**.

## Decision

**Opt-in, absent meaning off: `enableWeeklyRecap` on `UserPreferences`.**
Resolved by `weeklyRecapEnabled()` beside the other preference resolvers, and
testing for exactly `true` rather than truthiness for the reason ADR 0092
gives: `firestore.rules` validates `preferences` only as a map, so a foreign
client can put any JSON on the key. Nothing is read until the switch is on —
the recap costs two queries per dashboard open, and an unconditional load
would bill every account for a card they never asked for.

**The recapped week is the last one that finished, never the one in
progress.** `recapWindow` steps a day back from this week's Monday, landing on
the previous Sunday, and hands that to `weekWindow`, which opens on its own
Monday. One helper decides the boundary for the card, the fold, the nudge and
the specs ([ADR 0026](0026-every-period-window-comes-from-one-helper.md)).

**A week is identified by `dayKey` of its Monday, not by
`budgetPeriodKey(…, 'weekly')`.** That label is an unpadded ISO week number —
`2026-W5` — so a set of them does not sort, and this key is compared against a
stored one to decide whether the card has already been dismissed. A padded day
key is a sortable identity for the same fact.

**The figures come from two one-shot, non-publishing reads.**
`getTransactionsInRangeOnce` for the recapped week and the week before, never
the dashboard's `getByDateRange`: that one sets the shared transactions signal
as a side effect, so recapping last week would rewrite the page the card sits
on ([ADR 0009](0009-shared-state-publishing-and-lifecycle.md),
[ADR 0034](0034-a-correctness-read-enumerates-the-collection.md)). Both lists
fold through the shared aggregation helpers and `amountInBase`, so the recap
inherits their determinism contract and their base-currency rule rather than
keeping a second copy of either.

**The composition is memoised per account per week, behind a single-flight
promise.** A finished week's figures do not change, so a second dashboard
visit, or two surfaces asking at once, costs nothing. Only a completed
composition is memoised — a failed read is retried on the next visit rather
than remembered for the week.

**A week with nothing to say shows nothing.** `hasSomethingToSay` is
transactions in the recapped week, or spending in the week before: an empty
week is still news when the one before it was not, because that nothing is the
story. Two silent weeks in a row are not. That gate is applied last rather
than first — the empty week is still composed, so the memo records that it was
answered and the next visit reads nothing.

**Anything that lands after the account has moved is dropped.** A composition
and a narrative both check the session before publishing: the read can outlive
the session that started it, and publishing then would put one account's week
on screen under the next account's
([ADR 0052](0052-a-profile-read-may-only-write-to-the-session-that-started-it.md)).

**The dismissed week and the narrative cache are per device, in
`localStorage`.** `home-account.recap.dismissed.{uid}` and
`home-account.recap.narrative.{uid}`. This is the same trade ADR 0092 made for
the reminders sent log, taken deliberately a second time: a dismissal on the
phone is not a dismissal on the laptop, and the alternative — a field on the
user document — makes every dashboard open a Firestore write on a path with no
other writer, and lets whichever device looked first decide that nobody else
gets to see the week. Every access is wrapped: private-mode Safari throws on
the accessor itself, and an unreadable store must cost a repeat of the card,
never the card.

**The card is a labelled region, announced once.** `role="region"` with a
title, not a live region: the recap is a standing summary, and a live region
would re-read the whole card on every recomputation. One sentence goes to the
announcer on first appearance, guarded by a flag for exactly the reason the
budget alert banner needs one.

**Budget alerts and bills due are inputs from the page, and never enter the
narrative context.** The dashboard already holds those listeners; a second
subscription would be a second answer to the same question, and in the budget
case a second driver of recalculation writes. Neither line names a budget or a
rule — the count is the part that belongs in a recap, and a name repeated here
is text the user typed for a different surface.

**The narrative reuses `patternNarrative`, over a figures-only context.** No
sixth prompt: the insights narrative already asks a model to describe
pre-computed figures without recalculating, which is exactly this job. The
context is an allowlist built the same way — the window, the base currency,
the totals, the counts, the change against the week before, and the leading
categories by locally-resolved name. No description, note, merchant, budget or
rule name, no transaction id, no individual date. It is gated on **both** a
configured provider and `effectiveRagLevel(prefs) !== 'off'`, because detector
output is grounding data and the RAG level is the control the user already has
over how much of their financial data reaches a provider
([ADR 0001](0001-tiered-rag-levels.md), [insights.md](../insights.md)). When
that gate closes the on-screen paragraph is blanked; the cached narrative is
left standing rather than cleared.

**It is generated once per week per device**, cached under the week, a hash of
the context, the locale and the provider that would actually answer — the
resolved provider rather than the preference, since the façade falls back when
the preferred one has no key. Keeping the live lines out of the context is
what makes that cache hold: a budget crossing its threshold on Thursday would
otherwise be a new context, a new key and a new paid request for a week whose
figures have not moved.

**The nudge is produced by `ReminderService`'s sweep, not by a scheduler of
its own.** It is one more prepared reminder in the set a sweep produces, which
is what makes the sweep's own stale-prune spare it: that pass cancels
everything pending the sweep did not produce, so a nudge booked by a separate
path would be retired by the next bill sweep. Its key is `recap|{dayKey}` of
the Monday it fires on — the nudge day, not the recapped week, so it is one
notification per Monday and the same key on every sweep until it fires.

**The nudge is always ahead of time and never immediate.** It announces a
card; one raised as the app opens would name a week the user is looking at.
`deliverWeb` skips anything carrying `at`, so the web build produces the nudge
and never raises it — a browser gets the card, and is never asked for
notification permission on the recap's behalf.

**A week already dismissed on this device is not announced.** Producing
nothing also retires an already-booked nudge, since the stale-prune spares
only what the pass produced.

**A recap-only sweep opens no recurring listener.** An account that asked for
the recap and not for reminders would otherwise refresh the shared
`recurringTransactions` signal from a background path, and read a month of
occurrences, for a pass that cannot produce a single bill.

**`sweep()` now means "make what the operating system holds match the
preferences".** The gate widened to either preference; a pass with both off
retires everything rather than producing an empty set through the sweep, and
closes any listener an earlier pass left open before it cancels — a listener
still waiting for its first snapshot would otherwise book bills the cancel had
just retired. Both preference switches sweep after storing, so the nudge is
booked, or retired, with the click rather than five minutes later.

**The prune drops the sent-log keys of what it actually cancelled.** Without
that a cancel is one-way: scheduling marks a key delivered the moment the OS
accepts it, so a recap switched off and on inside a week — or a rule edited
away and restored — would never be booked again and its day would pass in
silence. Only the cancelled ids, never the whole log: a reminder that actually
fired is no longer pending, and its entry is what stops the next sweep raising
it a second time.

**Deletion gains two storage-only steps.** `reminders` and `weeklyRecap` join
the cascade beside the app lock and the offline queue, each through a pure
exported helper rather than its service — injecting either would drag the
sweep effects, the plugin and the budget and recurring graphs into an erasure
that only removes a key. The `reminders` step closes a gap the reminders
feature shipped with: its sent log survived account deletion.

Rejected: **a second `getBudgets()` subscriber.** ADR 0092 declined it for the
reminder service and the reason has not changed — it would make the recap a
second driver of the `freshenSpent` recalculation writes. The alerts arrive as
an input from the page that already owns the listener.

Rejected: **`RecurringService.upcomingRecurring`.** #52 named it as an
ingredient. It is a computed with no production consumer, and building a new
feature on it would have made a dead path load-bearing rather than removing it
([ADR 0048](0048-a-dead-capability-is-removed-not-guarded.md)). The bills line
reads the occurrences the page already holds.

Rejected: **a scheduler of its own, with `extra`-tagged notifications.**
Tagging the recap's notifications so the bill sweep's prune could recognise
and spare them means two schedulers, two prunes and a tag contract between
them. Producing the nudge inside the sweep needs none of that: the prune
already spares what the pass produced.

Rejected: **an immediate nudge when the card appears.** The user is looking at
the card. A notification saying so is noise, and on iOS it spends a
foreground banner.

Rejected: **live budget and bill lines in the narrative context.** They change
during the week the narrative is meant to describe, so every change would be a
cache miss and a paid request. They are also the two lines the card states
plainly, in the reader's own language, without a model.

Rejected: **Periodic Background Sync**, as #52 half-expected. It is
Chromium-only, needs an installed PWA, and needs a worker with a background
lifecycle. The only worker this app registers is the minimal share target,
which handles one POST and passes every other fetch through — deliberately, so
that receiving a share did not become adopting an offline strategy
([ADR 0019](0019-share-intake-lands-through-a-stash.md)). Giving it a periodic
task would reopen exactly that decision, to deliver on the one platform where
the user is most likely to have the app open anyway.

Rejected: **loading the recap for every account.** Two range queries per
dashboard open, for a card most accounts have not asked for, and a
`baseCurrencyOf(null)` snapshot taken in the window before the user document
lands.

## Consequences

- **The dashboard is now the recap's only trigger.** `load()` runs from the
  card's `ngOnInit` on every dashboard open, and is safe there because past
  its gates it composes once per account per week — including for a week it
  will then decide to hide.
- The card sits above the period grid rather than in it. Its window is fixed
  at last week; every card below follows the period selector, and one that did
  not would read as a filtered figure that ignores the filter.
- `RECAP_NUDGE_HOUR` is 09:00 local, the hour the bill reminders already use,
  built from the Monday's own local parts so a week spanning a DST change
  still lands at nine.
- The recap's zone-dependent specs join `test:dates`, and its emulator specs
  join `test:smoke:dates`, under both non-UTC zones
  ([ADR 0050](0050-a-spec-that-claims-a-zone-runs-under-it.md)).
- `ai_assist_used` gains `feature: 'recap'`, counted past the cache hit, so it
  measures requests issued rather than weeks rendered.

## Departures from the issues

- **#52 asked for delivery without opening the app; this delivers a nudge, not
  the digest.** The recap itself is composed on open. The Monday notification
  says it is ready and nothing more — it carries no figures, because a
  notification carrying last week's spending puts an account's finances on a
  lock screen.
- **The spending summary is not the narrative.** #52 named
  `generateSpendingSummary`; the recap reuses `patternNarrative` instead,
  because the summary prompt answers in fixed `## ` sections for a renderer
  that expects them, and the recap needs one paragraph.

## Things that only became apparent while building

- **A dependency-free `computed` caches the first week forever.** `now()` is
  not a signal, so the recapped week would be frozen at whichever one the
  service was first asked about, and a session left open across Sunday
  midnight would go on hiding a card it dismissed for the week before. The
  service bumps a clock signal on every load, which is what the week computed
  reads.
- **The narrative effect has to wait for category names.** A context built
  while the category list is still empty spells every category as its id, and
  that answer would be cached under a key the resolved names never produce
  again — a wrong narrative, kept for the week.
- **`hasSomethingToSay` had to join the narrative gate too.** The composition
  runs for a silent week so the memo covers it; without the same gate on the
  narrative, that week spent a provider request writing up a card nobody would
  see.
- **The clear-on-gate-close had to be narrower than the generate.** Gating the
  clear on the same condition as the generate meant an empty category list, or
  a briefly absent figure, wiped a cache hit. Only the provider or the RAG
  level actually going away clears it.
- **`closeBillSweep()` belongs on both branches of `sweep()`.** An in-flight
  listener resolving after the cancel books bills for an account that just
  opted out of them.
- **One clock reading has to serve both windows.** Two readings let a load
  straddling Sunday midnight compare two weeks that are not adjacent.

## Known gaps

- **A narrative already in flight when its gate closes still lands.** Turning
  a provider off, or grounding to `off`, blanks the on-screen paragraph and
  stops the next request — it does not touch what is already cached, and it
  cannot recall one already sent.
- **Closing the gate leaves the cached entry alone.** The on-screen paragraph
  blanks and the next request stops, but the device keeps the stored entry
  until a later week's narrative overwrites it or the account is deleted;
  reopening the gate
  within the week serves the same paragraph again with no new request.
- **`billsDue` reads the clock once per computation.** A tab left open across
  midnight keeps yesterday's seven-day window until something recomputes it.
- **Two devices nudge twice**, and each keeps its own dismissal. The same
  deliberate trade as the reminders sent log.
- **A week never opened is never nudged.** The nudge is booked by a sweep, and
  a sweep needs the app to have been opened. An account that does not open the
  app for a fortnight gets no Monday notification about either week.
- **The nudge has no figures to check.** It is booked from the preference and
  the dismissed week alone, so a quiet fortnight on the installed app still
  books the Monday notification, and tapping it opens a dashboard with no
  card to show for it.
- **A Monday-morning dismissal before nine cancels that day's nudge.** The
  card for the new week is dismissible from the moment it appears, and a
  dismissed week is not announced — so opening the app at 08:30 and closing
  the card runs a sweep that retires a notification due at 09:00. The card was read; the
  notification would have pointed at a card that is gone.
- **Switching reminders off retires a live recap nudge until the next sweep.**
  The opt-out cancels everything pending before the sweep that re-books what
  the remaining preference still asks for; the two are back-to-back, but a
  failure between them leaves the nudge unbooked until the next sweep.
- **Zero bills due renders `0` in the income colour.** The line signs its net
  and treats non-negative as income, which for an empty week is a green zero.
