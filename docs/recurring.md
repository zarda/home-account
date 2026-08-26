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
| `dayOfMonth` | 1–31 | for monthly **and** yearly rules |
| `monthOfYear` | 1–12 | never — a yearly rule takes its month from `startDate` |

Two things follow from the right-hand column. A monthly or yearly rule created in
the app always names its day, because the day-of-month select has no empty
option. And a rule that does *not* name one can only have come from a restored
backup, an older build, or a direct write through the SDK — which is exactly the
case the anchor below exists for.

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

Resume recalculates the pointer **from today**, which has two consequences worth
knowing before using it:

- **The paused stretch is not backfilled**, and neither is the current interval.
  A monthly rule on the 15th resumed on 10 August next posts on 15 September, not
  on 15 August.
- **A rule with no day of its own re-anchors on the day you resume.** For a
  monthly or yearly rule that does not name a `dayOfMonth`, the first date after
  a resume takes its day from the resume day. The stored `startDate` is not
  changed, so the occurrence after that one is measured from the rule's original
  day again.

Resume deliberately accepts a stored frequency the create and edit forms would
refuse. It is a toggle with nowhere to show an error, and a rule already saved
with an unusable interval has to stay recoverable — see
[ADR 0014](ADR/0014-recurrence-guards-and-anchors.md).

## What makes a rule valid

An interval below 1 does not describe a schedule: it asks for a date no further on
than the one before it, and every walk over the rule's occurrences is a loop that
advances by asking for exactly that. Fractional intervals below 1 truncate to no
movement at all, which is why the floor is 1 rather than "greater than zero".

The floor is stated three times, in three different vocabularies:

| Layer | What it does | What you see |
|---|---|---|
| The dialog | keeps **Save** disabled at an interval of zero or less, and floors its number input at 1 | the button stays greyed |
| `RecurringService` | throws `INVALID_RECURRING_FREQUENCY` from create and update, before any read or write | the surrounding action reports a failure |
| `firestore.rules` | denies any write whose `frequency.interval` is not a number ≥ 1 | permission denied |

The client layers exist so a refusal can be explained; the rules layer exists
because a restore, an older build on a second device, and anything holding the
account credentials all reach the document directly.

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

- **A rule already stored with an unusable interval is made harmless, not
  repaired.** Catch-up still posts the single occurrence its pointer names, then
  stops without advancing and writes the same pointer back. The occurrence id is
  deterministic, so the ledger keeps exactly one row for it, but every run
  rewrites that row and the rule document. Edit the rule to a real interval, or
  delete it.
- **Resuming such a rule reports success and does not move it.** The pointer
  lands on the moment of the resume, which is immediately due.
- **A rule that stopped paying before this version may hold an unreadable
  pointer** and will never be found due. Pause it and resume it: that rewrites the
  pointer from today.
- **There is no upcoming-bills screen.** The card in Budgets → Recurring shows the
  next date for an active rule; beyond that, a schedule is only visible once it
  has posted.
- **Editing a rule that names no day of month pins it to a day.** The dialog's
  day-of-month field cannot be cleared and pre-fills with the 1st, so saving that
  form changes the schedule to the 1st unless you set the day you meant.
- **A drained backlog converts at today's rate.** Occurrences posted late are
  converted with the exchange rates current when the catch-up runs, not the rates
  of the dates they carry.
