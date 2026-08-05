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
[ADR 0013](ADR/0013-recurrence-guards-and-anchors.md). This document is the part
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
| `interval` | every N days / weeks / months / years | always, minimum 1 |
| `dayOfWeek` | 0–6, Sunday is 0 | for weekly rules |
| `dayOfMonth` | 1–31 | for monthly **and** yearly rules |
| `monthOfYear` | 1–12 | never — a yearly rule takes its month from `startDate` |

Two things follow from the right-hand column. A monthly or yearly rule created in
the app always names its day, because the day-of-month select has no empty
option. And a rule that does *not* name one can only have come from a restored
backup, an older build, or a direct write through the SDK — which is exactly the
case the anchor below exists for.

## The clamp and the anchor

Every step of a schedule is computed from calendar parts, never by shifting a
date and repairing it afterwards. Two rules cover every case:

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

Weekly rules with a `dayOfWeek` advance by whole weeks and then forward to that
weekday. Daily rules are plain day arithmetic.

All of this reads **local** calendar parts, so a rule's day of month is the day
in the device's own time zone.

## The catch-up engine

The engine runs when the dashboard loads — the landing screen — and posts every
occurrence that came due since the app was last open. Running it again is free:
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

**Offline, claims are skipped rather than failed.** A Firestore transaction needs
the network, so the claim rejects while offline and the rule is simply left for
the next online run. Nothing is reported, because there is nothing wrong.

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
[ADR 0013](ADR/0013-recurrence-guards-and-anchors.md).

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
finishes the rest of the file and Settings reports `N records restored, M
skipped`, with the per-row reasons in the browser console. Everything else in the
backup — including the other recurring rules — restores normally.

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
