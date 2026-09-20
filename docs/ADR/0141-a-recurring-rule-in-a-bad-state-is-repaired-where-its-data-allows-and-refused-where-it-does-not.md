# 141. A recurring rule in a bad state is repaired where its data allows and refused where it does not

**Status:** Accepted, implemented · **Date:** 2026-09-20 · **Issues:** #432

Reference documentation lives in [../recurring.md](../recurring.md).

## Context

**Nine `.toDate()` calls read a stored rule's dates, and every one of them
trusted the declared type.** One in the due filter of
`processRecurringTransactions`, three inside `claimDueOccurrences`, three in
the `getNextOccurrences` walk, and two in `updateRecurring`. The model types
`startDate` and `nextOccurrence` as `Timestamp`, but a stored document need
not honour the type it is read as: a restore replays a backup file the user
could have edited, an older build writes what it knew, and the SDK is
available to anything holding the credentials — the same three doors
[0014](0014-recurrence-guards-and-anchors.md) named for the interval.
`.toDate()` on anything else throws a `TypeError`, and *where* it threw
decided how much it took with it. From the due filter it threw out of the
whole run, so one unreadable document ended the catch-up for every rule the
account owns. From inside the claim it reached the bare `catch` in
`processRecurringTransactions` — written for the offline case, on the
assumption that the network is the only way a claim can reject — so the rule
waited silently for a run that would throw in exactly the same place. From
the walk it errored a stream the dashboard's Upcoming card and the reports
forecast both read. Three readers, three failures, none of them saying
anything.

**0014 closed with six Known gaps, and three of them were left open because
the repair would have had to guess.** Repairing an unusable interval means
choosing a number on the user's behalf. Threading the rule's start date
through resume "would also mean resume no longer means *from now*". Making
the dialog's day-of-month field genuinely optional was "a dialog change with
its own decisions to make". Those were the right calls, and they rest on the
same refusal 0014 made when it rejected backfilling an anchor at read time
and at write time: a substitute start date silently re-dates the rule and
every occurrence it has yet to post. The other three gaps are absences rather
than guesses — a resume that "reports success and moves nothing" because
"that path has no way to say anything else", a pointer already corrupted that
"nothing in this change looks for", and a rule stored without `startDate`
that "would stall permanently and silently" through a read 0014 records as
inherited rather than introduced. What none of the six could weigh is that at
the time none of this had a surface: 0014 notes that `upcomingRecurring` and
`getNextOccurrences` had no caller outside the service and its own spec, so a
rule that had quietly stopped paying was visible only as something absent
from the ledger.

**0091 gave the schedule a surface, and decided the card would have no lower
bound.** [0091](0091-the-upcoming-card-reads-the-live-schedule-not-the-ledger.md)
is explicit that the walk starts at the pointer and a pointer can be in the
past — "that is exactly what a rule looks like between coming due and the
catch-up posting it" — and that hiding those rows would conceal money about
to move on precisely the occasion when the user most needs to see it. For a
rule a few days overdue that is right, and it stays right here. The same
property applied to a rule that stopped paying years ago is a different
thing: the walk yields one row per occurrence from that old pointer to the
horizon, a daily rule fills a fourteen-day card by itself, the net folds
every one of them, and everything genuinely upcoming sits underneath.
0091's last Known gap says so, and `recurring.md` lists the same condition;
both treat it as something the card makes visible rather than causes. The
rules that cause it are the ones this record repairs, which is what makes the
floor decidable now and not then.

## Decision

**A rule the reader cannot use is narrowed at one seam, repaired only from
data the rule itself already carries, and refused by name everywhere a repair
would have to invent something.**

### One seam narrows a stored rule

`readSchedule(rule)` is private, takes a `RecurringTransaction` and answers
either `null` or `{ start, pointer }`, where the pointer may itself be
`null`. It coerces through `toDate` in `core/utils/transaction-date.utils.ts`
— the helper that answers `null` for anything without a usable `toDate()` and
for an Invalid Date — so the narrowing every reader depends on is stated
once. The due filter, the claim on its fresh server read, the schedule walk,
`updateRecurring` and `resumeRecurring` all go through it.

`endDate` takes `toDate` directly in all four places that read it — the claim
on its fresh server read and the schedule walk, which had it before, and the
repair and the resume, which are new — under a rule worth stating on its own:
**an end date the reader cannot use is no end date**, not an error.
Deactivating a rule on a value nobody can interpret is a worse answer than
letting it keep posting, and the claim's existing end-date branch already had
to survive an absent field.

### An anchor is never invented; a pointer may be

A rule with no readable start is skipped and named:
`[Recurring] Skipping a rule with no readable start date:` with the rule id,
and nothing is written. That is 0014's decision kept, not softened — the
start date *is* the schedule, and a guess at it would change what the rule
means. The warning lives in the seam, so whichever reader meets the rule
first is the one that names it.

A readable start with an unusable pointer is a different case in kind. The
pointer is *derived* from the anchor — `calculateNextOccurrence` computes it
on create, on an edit that moves the schedule, and on resume — so
recomputing it is not the invention 0014 refused. `repairPointer` runs in the
due filter, before the rule can be judged due and outside the claim
transaction, and writes exactly one field: `nextOccurrence`.
`FirestoreService.updateDocument` stamps `updatedAt` itself, and nothing in a
repair should claim the rule has run, so `lastProcessed` is untouched. The
call is awaited; a failure warns
(`[Recurring] A pointer repair did not land:`) and leaves the rule for the
next run with its bad pointer intact.

The repaired rule is never due in the run that repaired it. The new pointer
is the **first occurrence after now**, because that is what
`calculateNextOccurrence` computes, and that is the whole distinction between
the two fields: a stored pointer is honest backfill input because it *is* the
last date the rule did not post, while a pointer nobody can read carries no
such fact. Posting a backlog off a recomputed one would be inventing
transactions.

### Two guards, one on the input and one on the result

`validateFrequency` runs first — an interval that is not a finite number of
at least 1 can never advance, and the walk it feeds would answer the start
date back. Then the *result* is checked: if `next` does not move past
`start`, nothing is written and the rule is named:

`[Recurring] Leaving a pointer unrepaired, the computed next date does not move past the start:`

The second guard exists because the first inspects only the interval. A
stored `frequency.type` outside the four known kinds falls through
`calculateNextOccurrenceFromDate`'s switch unchanged, so
`calculateNextOccurrence` hands the start itself back. Stored as a pointer,
that makes the rule permanently due: every run posts the occurrence, the walk
breaks before advancing, the same pointer is written back, and the
deterministic id `rec-<ruleId>-<occurrence time>` is re-posted with a fresh
`createdAt` forever. That is 0014's first Known gap, and a repair that wrote
it would have manufactured the condition rather than found it.

### A rule that has ended is deactivated, not repaired

When the recomputed date lies beyond a readable `endDate`, the repair writes
`{ isActive: false }` instead of a pointer. The rule can never post again;
leaving it Active with a date it cannot reach is the lie the Upcoming card
would faithfully show. This is the same state the claim's own
`endDatePassed` branch reaches when a backlog drains past the end date, so it
is a normal outcome of a healthy schedule meeting its end and nothing is
warned for it. A *failed* deactivation is warned
(`[Recurring] A rule's deactivation past its end date did not land:`),
because that one is a write that did not land.

### Resume answers on the rule's own cadence, or refuses by name

`resumeRecurring` used to skip `validateFrequency` on purpose — 0014 rejected
validating there because "resume is a toggle with nowhere to show an error" —
and anchored the recomputed pointer on `new Date()`. Both halves change, and
the first is only safe because the toggle in
`RecurringTransactionsComponent` now catches.

It validates the frequency, reads the schedule, and computes the first
occurrence after now **on the cadence the start date set**, by passing
`schedule.start` to the same `calculateNextOccurrence` a create runs. Three
named sentinels come back out:

- `INVALID_FREQUENCY_ERROR` (`'INVALID_RECURRING_FREQUENCY'`) — the interval
  cannot advance, or the result guard fired.
- `UNREADABLE_SCHEDULE_ERROR` (`'RECURRING_SCHEDULE_UNREADABLE'`) — there is
  no start to anchor on, and no substitute this record allows.
- `RULE_ENDED_ERROR` (`'RECURRING_RULE_ENDED'`) — the recomputed pointer is
  past a readable end date.

The result guard is narrowed here to a start that is already due:
`schedule.start.getTime() <= Date.now()` gates it, because
`calculateNextOccurrence` returns a future start unmoved by design, and such
a rule must still resume onto itself rather than be refused for it.

The toggle maps each sentinel to its own copy:
`settings.recurringResumeInvalidFrequency`
("Cannot resume: this rule's interval cannot advance. Edit the rule and set
an interval of at least 1."), `settings.recurringResumeEnded`
("Cannot resume: this rule's end date has passed. Edit the end date first."),
and `settings.recurringResumeFailed` for everything else, an unreadable
schedule included — the generic failure copy every other action on that page
already uses. All three are new keys in all three catalogs.

`updateRecurring` reads the stored start through the seam too, and refuses
with `UNREADABLE_SCHEDULE_ERROR` **only when that stored start is actually
consumed**. An edit that supplies a new start date is the one repair route
left for a rule the catch-up cannot touch, and it has to work.

### The dialog stops inventing a day

`dayOfMonth` is `number | null` and starts `null`. Both populate paths take
`frequency.dayOfMonth ?? null` instead of `?? 1`; the frequency-type flip no
longer fills today's day for monthly and yearly (weekly keeps its invented
`dayOfWeek`, because a start date names one day of the month but not one day
of the week); the preview falls back to `this.startDate.getDate()`; and the
select carries `settings.onDaySameAsStart` — "Same day as the start date" —
as its first option, above the thirty-one numbered ones. Because `save()`
rebuilds the whole `frequency` map and `updateDoc` replaces a top-level map
wholesale, an omitted day really is gone from the stored document rather than
merely unsent.

This also moves the default for a **new** rule off the 1st and onto the start
date's day. That is a product change, made deliberately: the 1st was never a
day the user chose, and a rule created on the 15th that pays on the 1st is a
schedule nobody asked for.

### The window has a floor and a count

`walkSchedule` closes on `endOfDay(addDays(today, days))` as it always did,
and now opens on `startOfDay(addDays(today, -days))`: as many whole local
days behind today as the window reaches ahead. A few days overdue is the
failed-catch-up case 0091 exists to surface and still comes back as rows;
everything behind the floor is counted instead.

The count is exact and uncapped. Stopping the first loop early would leave
the pointer short of the floor, and the collecting loop after it would then
either start below the floor or not run at all — the rule's genuinely
upcoming occurrences would be the price of the cap. Each step costs one
`calculateNextOccurrenceFromDate`, the arithmetic a rule's creation already
pays.

`getNextOccurrences(days)` keeps its shape and takes the floor; a new
`getUpcomingSchedule(days)` answers `{ occurrences, olderCount }` for the
dashboard, which keeps its occurrence list as a computed view over that
signal so the card's net and the home-screen widget read it unchanged. The
card draws one line when the count is non-zero, from the new plural key
`dashboard.upcomingOlderHidden` ("{{count}} older occurrence is overdue and
not shown" / "{{count}} older occurrences are overdue and not shown"); zero
hides it, because there is no "all caught up" worth announcing. The reminder
sweep already dropped every occurrence dated before today and the forecast's
first bucket is today, so neither delivers anything differently.

## What was rejected

- **Repairing inside the claim transaction.** It is where the rule is
  already re-read on fresh server data, which makes it tempting. But the
  claim's contract is that posting and the pointer advance commit together,
  and its caller treats every rejection as "we are offline" (0014). A repair
  folded in there either rides on a transaction that exists to post nothing,
  or turns a write failure into a silent skip.
- **A fire-and-forget repair.** Not awaiting it would keep the due filter
  synchronous and let the run finish sooner. It would also let the run end
  with the write still in flight, so a rejection lands nowhere and the rule's
  state when the run reports is not the state the run decided on.
- **Resuming from `lastProcessed`.** It looks like the more informed anchor
  and it is not: when the last posting lies on the rule's cadence it is the
  same answer as the start date, and when it does not — which is the state a
  rule needing a resume is usually in — it is the wrong one, and it would
  re-date every occurrence after it.
- **Backfilling the missed months from a repaired pointer.** The rule has an
  end date, a start date and a frequency, so the occurrences could be
  computed. They would still be transactions nobody's money moved for: the
  evidence that they were missed is a stored pointer, and the rule being
  repaired is precisely the one whose pointer is not evidence of anything.
- **A capped older-count** — stop counting at, say, fifty and render "50+".
  The cap has to stop the walk to be worth anything, and stopping the walk
  short of the floor costs the rule its in-window rows. A count that is
  exact and a walk that completes are the same loop.
- **A lower bound on the card alone.** Filtering in the dashboard would hide
  the old rows without counting them, and would leave the reminder sweep and
  the forecast walking the same unbounded backlog. The floor belongs in the
  walk, where the count that names what it dropped can come from the same
  pass.
- **A repair marker on the document** — a field recording that a pointer was
  rewritten, so a later reader could tell a repaired rule from a healthy one.
  `firestore.rules` validates the shape of a recurring write, so a new field
  is a rules change and a deploy for diagnostics; the console warning already
  names the rule, and the repaired pointer is on screen.
- **Trusting the interval check alone as the repair's precondition.**
  `validateFrequency` is the guard 0014 wrote and it answers exactly one
  question. A frequency can fail to advance without a bad interval, and the
  value that would have been stored — the start date, as "next" — is the
  worst one available.

## Consequences

- `RecurringService` has one date-narrowing seam and five readers behind it;
  a new reader that goes around it is the defect coming back, and there is
  nothing in the type system that says so.
- The catch-up now writes to rules it is not posting for. Previously a run
  that found nothing due wrote nothing at all.
- `UpcomingSchedule` is a new model type, and the dashboard subscribes to
  `getUpcomingSchedule` rather than `getNextOccurrences`. The publishing
  side effect 0091 records — reaching Firestore through `getRecurring()`,
  which sets the shared `recurringTransactions` signal — is unchanged,
  because both methods still go through it.
- Five new catalog keys across English, Japanese and Traditional Chinese:
  three resume refusals, the day-of-month placeholder, and the card's plural
  line.
- The smoke suite gained a rule seeded whole through the client and then
  broken through the emulator's owner door — `firestore.rules` refuses the
  broken shape, so no client write can produce the state being exercised.
- Five of 0014's six Known gaps close here. The sixth — a stored interval
  below 1, made inert rather than repaired — stands, and the decision behind
  it stands with it; what changed is that resume now refuses it by name
  instead of reporting success.

## Departures from the issue

- **A rule with no start date does not "stall every rule after it".** The
  claim's own failure is caught per rule and breaks only its inner loop, so
  the remaining due rules are still claimed. The condition that really
  aborted a whole run was a pointer the reader could not use, which threw
  from the due filter before any rule was claimed at all.
- **A rule whose `nextOccurrence` field is absent is never read at all, so
  no repair can reach it.** Every enumeration of the collection orders by
  that field, and Firestore omits a document that lacks the field it is
  ordered by — the rule is invisible to the catch-up, to the walk and to the
  dashboard alike. The repairable shape is a pointer stored as something
  that is not a timestamp. Nor can the user reach the other one: the edit
  dialog and the delete control both open from a list ordered by the very
  field the rule lacks, so neither can be aimed at it. The only route back
  is a restore from a backup taken while the rule still held a pointer —
  `createRecurring` recomputes one from the start date — or a write made
  outside the app.
- **A NaN timestamp is not a state the database holds.** 0014 records that
  `Timestamp.fromDate(new Date(NaN))` returns a Timestamp with NaN seconds
  rather than throwing, and that is true — but it goes on to say the claim
  therefore *committed* one, atomically, beside a real posting. It cannot.
  The SDK converts a `Timestamp` into its wire form where the write is
  declared, and the proto3 JSON branch of that conversion formats one through
  `new Date(1e3 * seconds).toISOString()`, which throws `RangeError: Invalid
  time value` on NaN. The write never leaves the tab. So the NaN
  shape is exercised by a unit fixture — a stub whose `toDate()` answers an
  Invalid Date — and the emulator proof uses a stored number instead.
- **The model lives under `src/app/models/`**, not `core/models` as the issue
  has it.
- **0091's "no lower bound" is revisited, not merely extended.** It was a
  decision with a stated reason, and half of that reason still holds; the
  floor is where the other half stopped holding.

## Things that only became apparent while building

- **The ordered-by field's invisibility.** It reshaped what "repair" could
  mean: the work divides into a pointer of the wrong type, which a reader
  meets and can rewrite, and a pointer that is simply absent, which no reader
  will ever be handed.
- **`FirestoreService.updateDocument` stamps `updatedAt` itself**, so the
  repair's payload is genuinely one field, and the untouched `updatedAt` of a
  skipped rule is what proves nothing was written to it.
- **`updateDoc` replaces a top-level map**, so dropping `dayOfMonth` from the
  frequency really removes it from the stored document. The dialog's change
  would have been cosmetic otherwise.
- **The privileged test seed could encode only integers and timestamps, not
  maps.** A bad-state fixture is therefore written valid through the client
  and then broken with a field-masked PATCH as the emulator's owner.
- **`endDate` was a fourth unguarded read**, found while restructuring the
  walk rather than from the issue's list.
- **The resume-past-an-end-date refusal came from driving the real app, not
  from a spec.** The account's only recurring rule turned out to be a paused
  rule whose end date had passed in March. Pressing Resume reported success
  and left an Active rule holding a date it could never reach — a fourth bad
  state, sitting in the one account available to look at, that nothing in the
  issue or the specs had named.

## Known gaps

- **A rule with an absent pointer, or with a start date the reader cannot
  use, is left where it is.** Nothing repairs either, by construction: one
  is never read, and the other has no anchor to recompute from. The
  unreadable start is put right by editing or deleting the rule. The absent
  pointer cannot even be selected — every list is ordered by the field it
  lacks — so its only route back is a restore from a backup taken while it
  still held a pointer, or a write made outside the app.
- **`INVALID_FREQUENCY_ERROR` now answers for more than an interval.** The
  result guard reaches for the same sentinel when the walk fails to move for
  another reason — a `frequency.type` outside the four known kinds, or a
  `dayOfMonth` below 1, which `dateAtClampedDay` clamps only from above. Its
  message tells the reader to set an interval of at least 1, which is the
  wrong instruction for both.
- **An ended rule whose frequency also cannot advance is warned about once
  per run, forever.** The result guard returns before the end-date branch can
  deactivate it, so the one state that would otherwise settle itself keeps
  announcing itself instead.
- **`olderCount` is per window, not per rule.** The card can say how many
  occurrences it left out but not which rule stalled, and the walk that
  produces the figure runs on every emission of the schedule listener.
- **`getNextOccurrences` and `getUpcomingSchedule` each walk independently.**
  Nothing subscribes to both today, so the duplicated walk costs nothing yet.
- **The toggle's pause branch still has no catch**, so a failed pause is as
  silent as a failed resume used to be. Pause writes one field and has no
  refusals of its own, which is why it was left — not because it cannot fail.
- **A drained backlog still converts at today's rate.** Occurrences posted
  late take the exchange rates current when the catch-up runs, not the rates
  of the dates they carry. Untouched here, and carried forward from
  `recurring.md` unchanged.
