# The weekly recap

An opt-in card on the dashboard, once a week: what last week cost, where it
went, how that compares with the week before, and what is still standing this
week. On the installed app a notification on Monday morning says it is ready.

The short version: **the recap is composed when you open the dashboard, and
everything about having already seen it is per device.** Two devices signed
into one account each get their own look at the same week, and each nudges
independently.

Why the reads are one-shot, why the dismissal lives on the device rather than
on the account, and what was rejected on the way, is in
[ADR 0096](ADR/0096-the-weekly-recap-is-composed-on-open-and-nudged-ahead.md).
This document is the part you need when turning it on, working out why a card
or a notification did or did not appear, or changing the service.

## Turning it on

**Settings → Profile → Weekly recap**, between the bill reminders and the
usage statistics. Free tier, no entitlement gate.

`enableWeeklyRecap` on the user's `preferences` map is the stored value.
Absent means off, and only a literal `true` counts as on — `firestore.rules`
validates `preferences` only as a map, so a foreign client can put any JSON on
that key.

**Nothing is read until the switch is on.** The recap costs two range queries
per dashboard open, so the preference is what decides whether an account pays
for a card it never asked for.

**The operating system is not a gate here**, unlike the reminders switch. The
card is the recap and needs nothing from the OS; the Monday notification only
points at it. So on a device the switch asks for notification permission
inside the click — the only moment either platform will raise the prompt — but
stores the preference either way, and a refusal is worth one sentence rather
than a refused opt-in. On the web nothing is asked at all: the nudge is always
scheduled ahead of time and a browser never raises one, so a prompt there
would spend the single ask a browser offers on a notification that cannot
arrive.

Both switches sweep immediately after storing, so the nudge is booked — or
retired — with the click rather than five minutes later.

## The week, and its key

**The recap always speaks about the last week that finished**, Monday to
Sunday, never the one in progress. `recapWindow` steps a day back from this
week's Monday, landing on the previous Sunday, and hands that to `weekWindow`,
which opens on its own Monday. One helper decides that boundary for the card,
the fold, the nudge and the specs
([ADR 0026](ADR/0026-every-period-window-comes-from-one-helper.md),
[dates.md](dates.md)).

**A week is identified by the day key of its Monday** — `2026-08-24` — not by
`budgetPeriodKey(…, 'weekly')`. That label is an unpadded ISO week number
(`2026-W5`), so a set of them does not sort, and this key is compared against
a stored one to decide whether the card has already been dismissed.

## The figures, and where they come from

| Line | Source |
|---|---|
| Spent | Expenses in the recapped week, in base currency |
| The change chip | Against the previous week's expenses; flat when it rounds to zero, absent when there is no previous spend |
| Where it went | Up to three leading categories, with their share of the week's spend |
| Budgets | The dashboard's live budget alerts — a count, never a name |
| Bills | The dashboard's live occurrences falling in the next seven days, and their net |
| The write-up | Optional; see [The narrative](#the-narrative) |

**The week's own figures come from two one-shot reads.**
`getTransactionsInRangeOnce` for the recapped week and the week before, never
the dashboard's `getByDateRange`: that one publishes the shared transactions
signal as a side effect, so recapping last week would rewrite the page the
card sits on ([one-shot-reads.md](one-shot-reads.md),
[ADR 0034](ADR/0034-a-correctness-read-enumerates-the-collection.md)). Both
lists fold through the shared aggregation helpers and `amountInBase`, so the
recap inherits their determinism contract and their base-currency rule rather
than keeping a copy of either
([money-snapshots.md](money-snapshots.md)).

**The budgets and bills lines are inputs from the page**, not listeners of the
recap's own. The dashboard already holds both; a second budget subscription
would make the recap a second driver of the `freshenSpent` recalculation
writes, which is the same reason the reminder service does not own one
([reminders.md](reminders.md)). Neither line names a budget or a rule: the
count is the part that belongs in a recap, and a name repeated here is text
the user typed for a different surface.

**The bills line converts live.** A scheduled occurrence has not been written
yet, so there is no base-currency snapshot to prefer
([ADR 0091](ADR/0091-the-upcoming-card-reads-the-live-schedule-not-the-ledger.md)).
Its window is the seven days ahead, not the fortnight the Upcoming card shows
— a week's story reads beside a week — and occurrences already past are left
to that card rather than counted here as money still to move.

**The composition is memoised per account per week**, behind a single-flight
promise. A finished week's figures do not change, so a second dashboard visit,
or two surfaces asking at once, costs nothing. Only a completed composition is
memoised: a failed read is retried on the next visit rather than remembered
for the week.

## The card's lifetime

It appears on the **first dashboard open of a new week** and stays until it is
closed. Closing it (×) records the recapped week's key on this device; the
card does not come back for that week, and next week's still does.

**A week with nothing to say shows nothing.** The gate is transactions in the
recapped week, *or* spending in the week before: an empty week is still news
when the one before it was not, because that nothing is the story. Two silent
weeks in a row are not. The empty week is still composed, so the memo records
that it was answered and the next visit reads nothing.

The card sits above the period grid rather than in it. Its window is fixed at
last week; every card below follows the period selector, and one that did not
would read as a filtered figure ignoring the filter.

**See last week's transactions** opens the transactions list with exactly that
window applied, through the same pending-filters hand-off the spending chart
uses — visible, clearable filters rather than an invisible query parameter.

For assistive technology the card is a labelled **region**, not a live region:
it is a standing summary, and a live region would re-read the whole card on
every recomputation. One sentence — the spend and the change — goes to the
announcer on first appearance and no more.

## The Monday nudge

A local notification: *Your weekly recap is ready*.

| Property | Value |
|---|---|
| Key | `recap \| {day key of the Monday it fires on}` |
| Moment | 09:00 local on Monday, always scheduled ahead |
| Platform | The installed app only |
| Skipped when | That week's card was already dismissed on this device |

**It is produced by the reminder sweep**, as one more prepared reminder in the
set the pass produces. That is what makes the sweep's own stale-prune spare
it: the prune cancels everything pending that the pass did not produce, so a
nudge booked by any separate path would be retired by the next bill sweep. It
also means the recap has no scheduler of its own —
[reminders.md](reminders.md) is the whole delivery story.

**It is never immediate.** It announces a card, and one raised as the app
opens would name a week the user is already looking at. The web delivery path
skips anything carrying a scheduled moment, so the web build produces the
nudge and never raises it: a browser gets the card.

**The key is the nudge day, not the recapped week**, so it is one notification
per Monday and the same key on every sweep until it fires. 09:00 is built from
that Monday's own local parts, so a week spanning a DST change still lands at
nine rather than an hour out.

**A recap-only sweep opens no recurring listener.** An account that asked for
the recap and not for reminders would otherwise refresh shared state from a
background path, and read a month of occurrences, for a pass that cannot
produce a single bill.

## The narrative

One optional paragraph, from the account's own AI provider. **The card is
whole without it** — no provider, a failed request, or grounding switched off
all leave every figure above intact.

**The gate is both** a configured provider **and**
`effectiveRagLevel(prefs) !== 'off'`. Figures about a person's spending are
grounding data, and the RAG level is the control the user already has over how
much of it reaches a provider ([rag-insights.md](rag-insights.md),
[insights.md](insights.md)). When that gate closes, the on-screen paragraph is
blanked; the cached narrative is left standing rather than cleared.

**It reuses the `patternNarrative` prompt** rather than adding a sixth: that
prompt already asks a model to describe pre-computed figures without
recalculating, which is this job exactly.

**The context is an allowlist**, one fact per line:

- the recapped week's dates, and the base currency;
- total spending, total income, the transaction count;
- the previous week's spending and the change against it;
- the leading categories by **locally resolved name**, with their totals and
  shares.

Never sent: a description, note, merchant, budget or rule name, a transaction
id, or an individual date. The live budgets and bills lines are deliberately
out too — they change during the week the narrative describes, so including
them would make every change a new context and a new paid request.

**Generated once per week per device.** The cache entry — in `localStorage` —
is keyed on the week, a hash of the context, the UI locale and the provider
that would actually answer (the resolved one, not the preference, since the
façade falls back when the preferred provider has no key). A transaction added
late moves the figures, which is a different key rather than a stale hit.
Failures are never cached: a cached silence would last until Monday.

A week with nothing to say never asks for one.

## Device-local state, and deleting it

Two keys per account, both in `localStorage`:

| Key | Holds |
|---|---|
| `home-account.recap.dismissed.{uid}` | The last recapped week closed on this device |
| `home-account.recap.narrative.{uid}` | One entry: the cache key above, and the text |

**Per device by design**, the same trade as the reminders sent log
([ADR 0092](ADR/0092-a-reminder-fires-once-and-the-record-of-it-lives-on-the-device.md)):
a field on the user document would make every dashboard open a Firestore write
on a path with no other writer, and would let whichever device looked first
decide that nobody else gets to see the week.

Every access is wrapped. Private-mode Safari throws on the accessor itself and
a full quota throws on the write; the cost of that is a repeated card or a
regenerated narrative, never a failed load.

Account deletion sweeps both, as the storage-only `weeklyRecap` step, beside
the new `reminders` step that clears the sent log
([account-deletion.md](account-deletion.md)). Neither is a stored record kind,
so both are named in `NOT_A_RECORD_KIND` rather than appearing on the data hub
([data.md](data.md)).

Note that **switching the preference off does not clear them**. They are per
browser profile rather than per account document, and they are harmless: a
dismissal left behind opens the next week already dismissed, and a cached
narrative is bounded by its key.

## Known gaps

- **The web gets no nudge.** A browser can only raise a notification while the
  page is open, and this one is always scheduled ahead. The card is the whole
  web feature.
- **A week never opened is never nudged.** The nudge is booked by a sweep, and
  a sweep needs the app to have been opened. Two weeks away from the app means
  no Monday notification about either.
- **Two devices nudge twice**, and each keeps its own dismissal.
- **A Monday-morning dismissal before nine cancels that day's nudge.** The new
  week's card is dismissible the moment it appears, and a dismissed week is
  not announced; closing the card runs a sweep, which retires the one already
  booked.
- **Switching bill reminders off retires a live recap nudge until the next
  sweep.** The opt-out cancels everything pending, and the sweep immediately
  after re-books what the remaining preference still asks for; a failure
  between the two leaves the nudge unbooked until the next sweep runs.
- **An empty pair of weeks shows nothing**, so a quiet fortnight looks
  identical to the feature being off.
- **The nudge doesn't know if there is anything to say.** It comes from the
  reminder sweep, built from the preference and the dismissed week alone; the
  sweep has no figures to evaluate, so a quiet fortnight on the installed app
  still books the Monday notification, and tapping it lands on a dashboard
  with no card.
- **A narrative already in flight when its gate closes still lands.** Turning
  a provider off, or grounding to `off`, blanks the on-screen paragraph and
  stops the next request — it does not touch what is already cached, and it
  cannot recall one already sent.
- **Closing the gate leaves the cache alone.** The paragraph blanks on screen
  and the next request stops, but the device keeps the stored entry until a
  later week's narrative overwrites it or the account is deleted; reopening
  the gate within the
  week shows the same paragraph again with no new request.
- **The bills line reads the clock once per computation.** A tab left open
  across midnight keeps yesterday's seven-day window until something
  recomputes it.
- **Zero bills due renders `0` in the income colour.** The line signs its net
  and treats non-negative as income, which for an empty week is a green zero.
