# Recurring transactions

A recurring rule is a template plus a schedule: a name, an amount, a category, and
a frequency that says when it should turn into a real transaction. The app posts
those transactions itself, catching up everything that came due while it was
closed. Rules live under **Budgets → Recurring**.

The short version: **a rule pays on the day it was created for.** A month too
short for that day pays on its last day instead and the month after goes back to
the original day. Nothing double-posts, however many devices you use and however
long the app was shut.

Why the schedule is computed that way, and what was rejected on the way, is in
[ADR 0014](ADR/0014-recurrence-guards-and-anchors.md). This document is the part
you need when creating a rule, reading what it posted, or changing the engine.

## The rule

| | |
|---|---|
| `name` | what the list shows — "Rent", "Salary" |
| `type`, `amount`, `currency`, `categoryId`, `description` | copied onto every transaction the rule posts |
| `frequency` | the schedule (below) |
| `startDate` | the first occurrence, and the day the schedule is measured from |
| `endDate` | optional; omitted means indefinite |
| `remindDaysBefore` | optional lead for a reminder; absent means none, `0` means on the day ([below](#reminders)) |
| `nextOccurrence` | the pointer: the next date not yet posted |
| `lastProcessed` | when the engine last posted for this rule |
| `isActive` | false while paused |

`startDate` is not just the first date. For a monthly or yearly rule that does not
name a day, it is where every later occurrence takes its day from — see
[The clamp and the anchor](#the-clamp-and-the-anchor).

## Frequencies

| Field | Meaning | Set by the dialog |
|---|---|---|
| `type` | `daily`, `weekly`, `monthly`, `yearly` | always |
| `interval` | every N days / weeks / months / years | always; the form blocks zero and below, and 1 is the real floor ([below](#what-makes-a-rule-valid)) |
| `dayOfWeek` | 0–6, Sunday is 0 | for weekly rules |
| `dayOfMonth` | 1–31 | offered for monthly **and** yearly rules, and may be left unset |
| `monthOfYear` | 1–12 | never — a yearly rule takes its month from `startDate` |

`dayOfMonth` is offered, not required. The day select's first entry is **Same
day as the start date**, and picking it stores no `dayOfMonth` at all — the
schedule then takes its day from `startDate` every time it steps, which is the
case the anchor below exists for. A save rewrites the whole `frequency` map, so
an omitted day really is gone from the stored document, and a rule that names no
day still names none after an edit to its name, its amount, or anything else on
the form.

**A new monthly or yearly rule starts on that option rather than on the 1st.**
The old default invented a day nobody had asked for: a rule created for the 28th
saved as paying on the 1st unless the day was set by hand, out of step with the
start date sitting directly above it in the same form. The monthly preview under
the field reads the start date's day whenever no day is named, so what the rule
will do is on screen before it is saved.

## The clamp and the anchor

Monthly and yearly steps are computed from calendar parts — year, month, day —
never by shifting a date and repairing it afterwards. (Daily and weekly steps are
plain day arithmetic; there is no month to overflow.) Two rules cover every case:

- **A day the target month does not have gives way to the last day it does.** The
  31st becomes the 30th in April and the 28th in February.
- **The target day comes from the rule, not from the previous occurrence.** It is
  `dayOfMonth` when the frequency names one, and the day of `startDate` when it
  does not. A clamped step is therefore a detour, never a new schedule.

A monthly rule starting 31 January 2027, with no day named:

| | | | |
|---|---|---|---|
| 31 Jan | 28 Feb | 31 Mar | 30 Apr |
| 31 May | 30 Jun | 31 Jul | 31 Aug |
| 30 Sep | 31 Oct | 30 Nov | 31 Dec |

February's clamp does not carry: March is back on the 31st, and so is every
31-day month after it. In a leap year the same rule pays on 29 February.

A yearly rule starting 29 February 2028, with no month or day named:

| 2028 | 2029 | 2030 | 2031 | 2032 |
|---|---|---|---|---|
| 29 Feb | 28 Feb | 28 Feb | 28 Feb | **29 Feb** |

The three 28ths in the middle prove nothing on their own — the return to the 29th
in 2032 is what shows each year is measured from the rule's own start date rather
than from the year before it.

Neither rule has anything to do above: a weekly rule with a `dayOfWeek` advances
by whole weeks and then forward to that weekday, and a daily rule just adds days.

All of this reads **local** calendar parts, so a rule's day of month is the day
in the device's own time zone.

## The catch-up engine

The engine runs when the dashboard loads — the landing screen — and posts every
occurrence that came due since the app was last open. Its work list is
enumerated from the server, never taken from a listener's cached first emission
([ADR 0044](ADR/0044-the-catch-up-work-list-comes-from-the-server.md),
[one-shot-reads](one-shot-reads.md)) — a warm cache's short answer used to make
an offline open post nothing and call it success. Running it again is free:
concurrent triggers share one run, and a repeat finds nothing due because the
pointer has already moved past today.

Each due rule is claimed on the server inside a Firestore transaction. The rule
document is re-read fresh inside that transaction, every due occurrence is
written, and the pointer is advanced — all in one atomic commit. A second device
running its own catch-up at the same time reads the advanced pointer and no-ops.

**Occurrence ids are deterministic:** `rec-<ruleId>-<occurrence time in ms>`. The
same occurrence always lands on the same document, so nothing duplicates a
posting even if two runs overlap.

**A claim posts at most 400 occurrences.** A Firestore transaction is capped at
500 writes and one occurrence is one write, plus the rule update — 400 leaves
headroom. A longer backlog drains across successive claims inside the same run:
each claim leaves the pointer on the first occurrence it did not post, so the
next one resumes exactly there. Without the cap, a daily rule dormant for more
than about 500 days built a transaction that could never commit, and failed the
same way forever.

**Offline, the run defers rather than pretending.** The work-list read is
answered by the server or not at all, so with no network the whole run rejects —
the dashboard treats that as non-fatal — and the next online open posts
everything still due. Nothing is lost, because the pointer never advanced. A
claim that individually loses the network mid-run is still skipped silently and
picked up by the next run.

Each posted occurrence is an ordinary transaction — it appears in the ledger, in
reports, and against budgets — flagged as recurring and carrying the id of the
rule that posted it. Its amount is converted at the exchange rate current **when
it posts**, not the rate on the date it is dated. Budgets for the affected expense
categories are recalculated once the claims commit.

### End dates

An occurrence that came due before the end date is still posted after that date
has passed; the rule deactivates only once its backlog is fully drained, so a
capped batch never strands the rest. A rule whose next occurrence falls after its
end date pauses without posting anything.

### A rule the engine cannot read

A stored document need not honour the type it is read as. Every read of a rule's
schedule goes through one seam that narrows it first: `startDate` and
`nextOccurrence` are coerced through the same helper the ledger's own dates use
(`toDate`, in `core/utils/transaction-date.utils.ts`), and either can come back
empty. `endDate` is read the same way, and **an end date the engine cannot read
is no end date** — the rule keeps posting rather than deactivating on a value
nobody can interpret. Three shapes matter here, and only the first two ever
reach that seam.

**No readable start date — the rule is skipped, by name.** Nothing is written
and the catch-up warns once per run with the rule's id in the browser console.
The start date *is* the schedule: substituting one would silently re-date the
rule and every occurrence it has yet to post, which is the guess
[ADR 0014](ADR/0014-recurrence-guards-and-anchors.md) refused and this keeps
refusing. Edit the rule and give it a start date, or delete it. Nothing else
recovers it, and resuming it will not.

**A readable start with an unusable pointer — the pointer is repaired.** A
pointer is derived from the start date rather than given, so recomputing it is
not that guess. The catch-up rewrites it before the due filter and writes that
one field alone; the rule is never due in the run that repaired it, because the
new pointer is the first occurrence after now rather than a backfill, so the
stretch the rule sat unreadable is not owed. Two checks stand before the write —
the interval floor, and then the computed date itself, which has to move past the
start — and either one leaves the pointer as it was and names the rule in a
warning. A recomputed date beyond a readable end date is not written either: the
rule is deactivated instead, because it can never post again and an active rule
with a date it cannot reach is exactly the lie the Upcoming card would show.

**No pointer at all — the rule is invisible.** Every enumeration of the
collection is ordered by `nextOccurrence`, and Firestore omits a document that
lacks the field it is ordered by, so a rule missing that field sits in the
collection and in no result: not in the catch-up's work list, not on the Upcoming
card, not in the Recurring list itself. No repair can reach what no read returns.
Only a write that puts a timestamp back in the field brings the rule back, and
the edit form is the one place in the app that writes it — saving a change to the
frequency or the start date recomputes the pointer — but the list that form opens
from is ordered by the same field, so the rule cannot be selected there. What is
left is a backup taken while the rule was still whole: a restore recomputes the
pointer from the start date like any other created rule.

None of the three can be produced by this build. `firestore.rules` requires both
dates to be timestamps on create and on any update that touches them, removal
included; these are states an older document, or a write made with credentials
the rules do not apply to, left behind.

## From detection to a rule

The Insights tab detects charge patterns nobody declared — same merchant,
same-ish amount, regular gap (`recurring-pattern.utils.ts`, rendered as the
"looks recurring" list). Each detected group carries a **Track as recurring**
action that opens the create dialog prefilled from the group; saving creates
an ordinary rule through the normal path. It is deliberately not a one-tap
create: the amount is the group's median in the base currency and the label
is the most recent raw description — the detector's guesses, corrected in the
dialog (see
[ADR 0020](ADR/0020-detected-groups-convert-through-the-prefilled-form.md)).

The mapping from a detected cadence to a rule frequency
(`recurring-conversion.utils.ts`):

| Detected cadence | Rule frequency |
|------------------|----------------|
| weekly | `weekly`, interval 1, anchored weekday |
| biweekly | `weekly`, interval 2, anchored weekday |
| monthly | `monthly`, interval 1, anchored day of month |
| quarterly | `monthly`, interval 3, anchored day of month |
| yearly | `yearly`, interval 1, anchored day and month |

The anchor is the group's **last observed charge**: the engine advances a past
anchor to the next real date (see the clamp-and-anchor section above), so the
converted rule posts next on schedule instead of backfilling.

Conversion never relabels history — the past transactions keep no
`recurringId` — so the detector would rediscover every converted group
forever. Instead, the **detector suppresses** detected groups an active rule
already covers: same cadence in the engine's terms, and a merchant-matched
name (normalized equality, containment, then bigram similarity at the
detector's own threshold).

Suppression happens inside `computeRecurringGroups`, before the groups are
ranked, before the display cap, and before every count and total. That is what
makes the portfolio card and the rows beneath it describe the same set — the
list itself filters nothing. Filtering only at the list is what let one
subscription be counted twice, once as its rule's declared occurrences and once
as the history the conversion left behind ([ADR 0042](ADR/0042-a-derived-figure-agrees-with-the-set-that-produced-it.md)).

Two consequences worth knowing:

- **The "N more" note counts only what the cap dropped.** Both sides of that
  subtraction are over the suppressed set, so a covered group never inflates it.
- **There is a short dip after converting.** The detected group disappears at
  once, but the new rule needs two posted occurrences before it forms a declared
  group, so the portfolio total is one group light in between. The list has
  always behaved this way; the figures now match it.

Archived snapshots are frozen history and are neither suppressed nor
convertible. New snapshots are written with the rules in force when the month
was frozen, read from the collection rather than a listener
([docs/one-shot-reads.md](one-shot-reads.md)); months written before this keep
whatever they recorded, and regenerating one is what re-takes it.

## Linking an import to a rule

An imported row can be offered the active rule it looks like, as an unchecked
checkbox on the wizard's review card. Every wizard door offers it except the
JSON backup, whose rows already carry whatever the backup recorded. The
reasoning is in
[ADR 0063](ADR/0063-an-import-suggests-only-what-the-account-already-knows.md).

`matchRecurringRule` (`recurring-conversion.utils.ts`) offers the first active
rule that satisfies all of:

| | |
|---|---|
| type | the same as the row's |
| name | matched by the **detector's own ladder** — normalized equality, containment at three characters or more, then bigram similarity at the detector's threshold |
| amount | within the detector's tolerance of the rule's amount — 15% of the larger figure, floored at 1 — when the row's currency and the rule's agree, or when the row's currency fell back, in which case the printed figure is compared as-is |

It is the same ladder coverage suppression uses — now literally the same
function rather than two copies of it. `merchantKeysMatch` in
`merchant-match.utils.ts` is the single place the rule lives, and both the
detector and the coverage check call it, so the import and the Insights tab
cannot disagree about what counts as the same merchant. It refuses a pair of
empty keys, which one of the two retired copies had called a match.

**It is a string ladder, and stays one.** Whether a semantic representation of
merchant text would do better was measured rather than assumed, and declined:
embeddings scored far better overall but merged two products from one vendor —
`AT&T Wireless` with `AT&T Internet` — which for recurring detection turns two
subscriptions into one wrong figure. The numbers, the corpus and the reasoning
are in
[ADR 0069](ADR/0069-one-ladder-decides-what-is-the-same-merchant.md) and
[docs/merchant-match-probe](merchant-match-probe/README.md). The consequence
that remains: a descriptor that changes script or abbreviates — `7-ELEVEN`
against `セブン-イレブン` — still splits into two groups.

**The amount stands in for the cadence.** A detected group is a set of charges
with gaps between them, and the gaps are what make it recurring; one import row
has no gaps to observe, so the only evidence left that this charge is *that*
charge is how much it is for. A figure in another currency is not comparable
without a rate, so the check is skipped rather than converted, and the name and
the type carry the match alone.

**Unless nobody read a currency at all.** A row marked `currencyFellBack`
wears the account's base currency because the source never said what money it
was, so "the currencies differ" says nothing about the figure. Skipping the
check there would leave the name and the type carrying a match on exactly the
rows the reader was least sure about — and an offered rule with a posted
occurrence in the window deselects the row. The printed figure is compared
as-is instead, whatever currency the rule is in.

Accepting the link writes `recurringId` and `isRecurring: true` on the
transaction; declining restores whatever the source said about `isRecurring`,
including having said nothing. Nothing about the rule itself changes — the link
does not move its pointer and does not create an occurrence. An import never
creates a rule.

**A charge the scheduler already posted is flagged as a duplicate.** Duplicate
detection loads the transactions around the batch's dates anyway; a stored row
there carrying the offered rule's `recurringId` marks the import row as a
duplicate of type `recurring_occurrence`, and it arrives deselected like any
other duplicate. The rule id is the only thing that can catch this reliably: a
posted occurrence carries the rule's amount and the rule's `description` — not
its name — so a receipt for the same charge need not match it on either field
the ordinary detector compares. The flag keys on the *offered* rule, because
detection runs before the card exists; declining the link afterwards does not
re-run it.

## Pausing and resuming

Pause sets the rule inactive. Catch-up only claims active rules, so nothing
accrues while it is paused — the days that pass are not owed.

Resume sets the pointer to the **first occurrence after now on the cadence the
rule's own start date set** — the same walk a rule created by hand takes, and the
same one a restore runs. Two consequences are worth knowing before using it:

- **The paused stretch is not backfilled.** Occurrences that fell due while the
  rule was inactive are not owed and never post; only the next one is scheduled.
- **The day you resume on is not the schedule.** A monthly rule on the 15th
  paused in April and resumed on 10 August posts next on 15 August; resumed on
  20 August instead, its next is 15 September. A rule that names no `dayOfMonth`
  comes back on the day its `startDate` names, whatever day it was resumed on.

`lastProcessed` is deliberately not consulted. It answers the same date the start
date does whenever it lies on the cadence, and the wrong one whenever it does
not — which is the case a resume exists to get out of.

Resume can also refuse. Each refusal puts a message on the list and writes
nothing at all: the rule stays paused, with its pointer, its active flag and its
`updatedAt` exactly as they were.

| Why it refuses | What the list says | What to do about it |
|---|---|---|
| the interval cannot advance | *Cannot resume: this rule's interval cannot advance. Edit the rule and set an interval of at least 1.* | edit the rule and give it an interval of 1 or more |
| the end date has already passed | *Cannot resume: this rule's end date has passed. Edit the end date first.* | move the end date or remove it; a rule that is genuinely finished can be deleted instead |
| the start date cannot be read | *Failed to resume recurring transaction* | edit the rule and set a start date, or delete it ([above](#a-rule-the-engine-cannot-read)) |

The first two name the field to change, because for them it is one field. The
third shares the page's generic failure copy: there is no short instruction for a
document whose stored start date is not a date.

Resume applies the same interval floor the create and edit forms do, which it
used to skip on the grounds that a toggle had nowhere to show an error. It has
one now, so a rule saved with an unusable interval is reported rather than
silently resumed onto a pointer that was immediately due
([ADR 0014](ADR/0014-recurrence-guards-and-anchors.md) has the floor's
reasoning).

## Reminders

A rule can ask to be warned about before it pays. `remindDaysBefore` is the
lead, in whole days:

| Stored value | Meaning |
|---|---|
| absent | no reminder |
| `0` | on the day the occurrence falls due |
| `n` | `n` days before it |

The form offers **Off** plus a fixed ladder — same day, 1, 2, 3, 7, 14 and 30
days — and stores `null` for Off, which an edit writes as an explicit removal.
The ladder is a product choice: `firestore.rules` accepts any non-negative
whole number and deliberately sets **no ceiling**, because a bound written
there would refuse the restore of a rule any earlier build allowed. The service
that reads the field rounds and clamps it instead.

**Zero is a real lead, so every mapping site tests `!= null` rather than
truthiness.** The end date beside it can use the truthy form — no legitimate
end date is falsy — but a lead of zero is exactly what a bill due today needs,
and the truthy form would store it as no reminder at all. That applies to
create, update, the occurrence list and the backup restore alike; in the
restore's field list a dropped field is dropped in silence.

The lead is carried onto each `RecurringOccurrence` so a consumer deciding when
to warn needs no join back to the recurring collection. What is done with it —
the sweeps, the per-device dedup, the platform split — is
[reminders.md](reminders.md), and the reasoning is
[ADR 0092](ADR/0092-a-reminder-fires-once-and-the-record-of-it-lives-on-the-device.md).

A reminder is a notification, not a posting. It changes nothing about when the
rule pays; the catch-up engine above is the only thing that writes
transactions.

## The Upcoming card

The dashboard shows what the active rules will move over the **next fortnight**,
grouped by local day, with the window's net underneath. The window is anchored
to today and is deliberately independent of the period selector — the card
answers "what is about to move", not "what happened in the window I am looking
at".

Three behaviours are deliberate and worth knowing:

- **Occurrences dated before today are shown, not hidden — as far back as the
  window reaches forward.** They are due but not yet posted. Hiding them would
  conceal money about to move on precisely the occasion the user most needs to
  see it — a catch-up that has not run or has failed. The brief flicker when
  catch-up posts one, moving it out of the card and into Recent Transactions,
  is the cheaper of the two failures. The walk has a floor as well as a
  horizon, and the floor mirrors it: a fortnight of whole local days behind
  today. Without one, a rule that stopped paying years ago came back as one
  row per day from then to the horizon and buried everything genuinely
  upcoming underneath it.
- **What the floor left out is counted, and the card says so.** With a
  non-zero count the card shows one line under the list — *3 older occurrences
  are overdue and not shown*, or *1 older occurrence is overdue and not shown*
  — and the same line stands beside the empty state, so a card with nothing in
  its window still says that something older is outstanding. The count is
  exact and uncapped: stopping the walk early would leave it short of the
  floor and cost the rule its in-window occurrences too. The net under the
  list folds what the card lists, so an occurrence behind the floor is in the
  count and not in that figure.
- **Row amounts stay in each rule's own currency; only the net converts.** A
  scheduled occurrence has not been written, so it carries no base-currency
  snapshot to prefer, and a converted figure beside an amount the user typed
  reads as a wrong number. The net has to add unlike currencies up, so it
  converts at today's rate — the one figure on the dashboard that is not a
  write-time snapshot.

[ADR 0091](ADR/0091-the-upcoming-card-reads-the-live-schedule-not-the-ledger.md)
has the rest, including why the subscription lives outside `loadData()`.

## What makes a rule valid

An interval below 1 does not describe a schedule: it asks for a date no further on
than the one before it, and every walk over the rule's occurrences is a loop that
advances by asking for exactly that. Fractional intervals below 1 truncate to no
movement at all, which is why the floor is 1 rather than "greater than zero".

The floor is stated three times, in three different vocabularies, and a fourth
layer stands behind them for the documents they never had a say over:

| Layer | What it does | What you see |
|---|---|---|
| The dialog | keeps **Save** disabled at an interval of zero or less, and floors its number input at 1 | the button stays greyed |
| `RecurringService` | throws `INVALID_RECURRING_FREQUENCY` from create, update and resume, before anything is written | the surrounding action reports a failure |
| `firestore.rules` | denies any write whose `frequency.interval` is not a number ≥ 1 | permission denied |
| The reader | narrows a stored document on the way in: every schedule date is coerced, and a rule whose `startDate` is not a date it can read is answered as having no schedule at all | the rule is skipped rather than acted on, and named in the browser console |

The client layers exist so a refusal can be explained; the rules layer exists
because a restore, an older build on a second device, and anything holding the
account credentials all reach the document directly. The reader exists because
none of the three reaches a document that is already stored — the rest of that
case is [A rule the engine cannot read](#a-rule-the-engine-cannot-read).

### Restoring a backup that contains a bad rule

A restore replays the file verbatim, so a hand-edited or very old backup can carry
a rule the current build refuses. That rule is **skipped**, not fatal: the restore
finishes the rest of the file and Data Management reports `N records restored, M
skipped`, naming the sections, with the per-row reasons in the browser console.
Everything else in the backup — including the other recurring rules — restores
normally.

### A restored rule keeps its pause

The backup records whether each rule was paused, and the restore honours it. It
has to: catch-up runs on dashboard load with no user action, so a rule restored
as active would resume posting money at its next due date with nothing saying
the pause had been undone.

What does not survive is the pointer. `nextOccurrence` is recomputed from the
rule's start date forward past today, exactly as it is for a rule created by
hand, so nothing accrues for the stretch the backup sat on disk and resuming a
restored pause later behaves like a fresh resume. [docs/backup-restore.md](backup-restore.md)
covers the rest of what a restore carries verbatim.

## Known gaps

- **A rule the reader cannot use stays that way until you touch it.** A start
  date that is not a date, and an absent pointer, are both left where they
  are: nothing repairs either, and the second cannot even be listed. Editing
  or deleting the rule is the only way out, and the absent-pointer case needs
  a backup to get that far ([above](#a-rule-the-engine-cannot-read)).
- **A rule already stored with an interval below 1 is made harmless, not
  repaired.** Catch-up still posts the single occurrence its pointer names,
  then breaks before advancing and writes the very same pointer back. The
  occurrence id is deterministic, so the ledger keeps exactly one row — but
  every run rewrites that row with a fresh `createdAt` and stamps the rule
  with a fresh `updatedAt` and `lastProcessed` beside it, and that goes on
  until the interval is edited or the rule deleted. Nothing picks a
  corrected interval on the user's behalf. What changed here is only the
  resume half, which now refuses such a rule by name instead of reporting
  success.
- **The interval refusal answers for more than the interval.** Resume raises
  `INVALID_RECURRING_FREQUENCY` for a stored `frequency.type` outside the four
  known kinds as well, and for a day of month below 1 when that leaves the
  computed date back on the one it started from. The message names the
  interval, which for those two is the wrong field to go and change.
- **A rule that cannot advance is never deactivated for its end date.** When
  the pointer repair meets a rule whose interval cannot advance it stops there
  and warns, and the branch that would have deactivated an ended rule sits
  after that check — so the same console warning is written on every catch-up
  run and nothing else changes. Fix the interval, or delete the rule.
- **A failed pause is silent.** The toggle now reports every way a resume can
  fail, but its pause half still has no catch, so a pause that does not land
  leaves the rule active with nothing on screen to say so.
- **The older count is per window, not per rule.** The line under the Upcoming
  card says how many occurrences fell behind the floor across every active
  rule; it does not say which rule stalled, and the Recurring list is the only
  place to go looking. The walk that produces the count also runs on
  every emission of the schedule listener, so a rule years overdue is counted
  from its pointer again each time.
- **The two walks are independent.** The reminder sweep and the forecast take
  one walk over the schedule and the dashboard card takes another; nothing
  subscribes to both at once today, so the duplication costs a second walk only
  if a third reader arrives.
- **A drained backlog converts at today's rate.** Occurrences posted late are
  converted with the exchange rates current when the catch-up runs, not the rates
  of the dates they carry.
