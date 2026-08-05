# 13. Recurrence validates at the edges, breaks in the loops, and anchors on the start date

**Status:** Accepted, implemented · **Date:** 2026-08-05 · **Issues:** #206, #209

Reference documentation lives in [../recurring.md](../recurring.md). This record
keeps the decision and the reasoning.

## Context

A recurring rule is a frequency and a pointer, and everything the feature does
with it is a walk: hold a date, ask the frequency for the one after it, move on.
There are three such walks, and they are not interchangeable.

- `calculateNextOccurrence` recomputes the pointer from a start date towards
  today. Create, update and resume all run it, synchronously, before anything is
  written.
- The claim in `claimDueOccurrences` posts every occurrence due since the last
  run. It runs inside a Firestore transaction, against a fresh server read.
- `getNextOccurrences` collects the next N days for a preview.

Only the claim had a guard against a frequency that fails to advance. The check
was in the one walk the user never reaches directly, and missing from the one
that runs while they wait for a dialog to close.

**An interval below one is not a preference, it is a rule that cannot be
walked.** Zero hands back the date it was given. A negative interval walks
backwards and never reaches today. NaN and Infinity produce an Invalid Date.
Saving a daily rule with an interval of 0 and a start date in the past froze the
tab on `calculateNextOccurrence` — no error, no write, nothing in the console.

The form has required an interval above zero since it was written, so such a
value can only arrive from somewhere the form is not. Restoring a backup is that
somewhere: `BackupRestoreService.restore` replays each stored rule verbatim into
`createRecurring`, deliberately, and reports the rows it could not write rather
than abandoning the file. An infinite loop is not a row it could not write — it
never returns, so the skip-and-report machinery never runs, and the restore
stops partway through with the earlier sections already committed.

**The guard the claim did have was the wrong shape, and what it let through was
worse than the hang.** The test was `next.getTime() <= occurrenceDate.getTime()`,
which is false when either side is NaN, so an Invalid Date walked straight past
it and became the date the walk was holding. The loop condition compared that
Invalid Date to the posting window, also false, so the walk exited and the claim
went on to write what it held as the rule's `nextOccurrence`.

The expectation while planning this was that `dateToTimestamp` would throw there
and take the transaction down with it. It does not. `Timestamp.fromDate(new
Date(NaN))` returns a Timestamp with NaN seconds — the constructor's range checks
are comparisons, and every comparison against NaN is false — so nothing rejected
and the claim committed: one occurrence posted, and in the same atomic write the
rule's pointer replaced with a value that is not a date. Every later
`nextOccurrence.toDate() <= now` against it is false, so the rule was never due
again, never appeared in `upcomingRecurring`, and nothing anywhere said why. A
corrupt pointer committed alongside a real posting is worse than a rejected
transaction, because it looks exactly like a run that worked.

**The drift (#209) is a different defect reaching the same walks.** #167 had
already replaced shift-the-month-then-clamp with `dateAtClampedDay`, so the clamp
finally read the length of the month it landed in rather than the month the
overflow spilled into. What that fix left behind — and said so in its own commit
message — is that the *target day* was still read off the occurrence the walk was
standing on. With no explicit `dayOfMonth`, February's clamp became the schedule:
31 Jan, 28 Feb, and then the 28th for the rest of the rule's life, with every
further short month free to move it again. The yearly branch had the same shape,
so 29 February came back on the 28th and stayed there through the next leap year.

Which rules that reaches is worth being precise about. The dialog's day-of-month
select cannot be cleared, so a monthly or yearly rule created in the app always
names its day and recovers on its own. The rules that drift are the ones written
without one: a restored backup, an older build on a second device, a raw SDK
write. The same three doors as the interval.

**Neither defect had anywhere to show itself.** `upcomingRecurring` and
`getNextOccurrences` are the two surfaces that would let a user see a schedule
before it posted, and neither has a caller outside the service and its own spec.
There is no upcoming-bills screen. So a rule that had quietly moved to the 28th,
or quietly stopped being due at all, was visible only as something that failed to
appear in the ledger — a month later, if anyone was counting.

## Decision

### Refuse at the entry points; stop, do not throw, inside the walks

`validateFrequency` runs at the top of `createRecurring` and `updateRecurring`,
before the first date walk and before any read or write. That position is what
turns a bad rule in a backup file into a skipped row the restore already knows
how to report, instead of a hang partway through the file.

The three walks then break rather than throw, and in the claim that is
load-bearing. Its walk runs inside the transaction callback, and the caller wraps
that call in a `catch` that treats any rejection as "we are offline, try again
next time" — silently, and correctly, because a claim really does reject whenever
the network is down. A throw from inside the walk is indistinguishable from that,
so the rule would simply never post again with nothing to explain it. Breaking
leaves the pointer on the last date the walk could justify, so the run commits
something real and the rule stays claimable.

The guards test `!(next > current)` rather than `next <= current`. The two read
identically for real dates; the difference is that the negated form treats
"cannot be compared" as a stop. That is the only safe answer when the comparison
itself is meaningless, and it is the whole distance between a rule that pauses on
a real date and one that stores a hole.

### One floor, stated three times: a finite number, at least 1

The dialog keeps Save disabled until the interval is above zero and floors its
number input at 1; the service throws `INVALID_RECURRING_FREQUENCY` below a
finite 1; `frequencyValid` in `firestore.rules` denies the write. Client
validation is discipline, not enforcement — a restore replays a file the user
could have edited, an older build knows nothing about the check, and the SDK is
available to anything holding the credentials. The document is
what the walks actually read, so the floor belongs where the document is written,
and the two layers above it exist to make the refusal explainable rather than a
bare permission error.

`Number.isFinite` is part of the service floor rather than an afterthought: NaN
and ±Infinity are precisely the values that lose every comparison downstream, so
they have to fail the check that runs before the first comparison.

### The target day belongs to the rule, and the anchor is a required parameter

`calculateNextOccurrenceFromDate` takes the rule's start date as an `anchor`, and
the monthly and yearly branches read their target day — and, for yearly, their
month — from it whenever the frequency does not name one. Each step then clamps
independently against the month it lands in, which makes a short month a detour
rather than a new home: 31 Jan, 28 Feb, 31 Mar.

The parameter is required rather than defaulted. There are three call sites, each
of which already holds a date to measure from, and a default would leave the
defect one forgetful caller away from returning. The compiler pointing at all
three is worth more than the convenience.

Two of the three hand over the rule's own start date: the claim and the preview
both read it off the document. The third, `calculateNextOccurrence`, passes on
whatever start it was given — the rule's, when create and update recompute the
pointer, and **today**, when `resumeRecurring` calls it. So a resumed rule with no
`dayOfMonth` takes its next day from the day it was resumed rather than from its
start date. That is deliberate: resume means "start again from now". It also
lasts exactly one occurrence, because the claim that posts that occurrence
re-reads `rule.startDate` and measures from there again.

Nothing had to be migrated. Rules already in Firestore carry the start date they
were created with, and the claim re-reads the raw document inside its own
transaction, so its walk anchors on the same date as the walks running against
the cached copy.

## Rejected alternatives

**Validating in `resumeRecurring` as well.** Symmetric, and wrong. Resume is a
toggle with nowhere to show an error, and the rule it would refuse is exactly the
one already stored broken — refusing turns a stuck rule into a button that does
nothing at all. Resume stays permissive, and the guard inside the walk is what
makes that safe. The exemption is commented at the call site so it does not read
as an oversight.

**Backfilling the anchor at read time.** There is no converter seam on this
collection: `subscribeToCollection` and `getCollection` both hand back raw
document data, and the claim reads a third way, inside its transaction. That is
three patches for one invariant, and the one that matters most is server-side
data the client never touches.

**Backfilling at write time** — a migration stamping a `dayOfMonth` onto every
rule that lacks one. It misses the population that actually has the defect: rules
held by an older build on a device that has not opened this version, and rules
that arrive later from a restore of an old backup. It also changes a user's
schedule on their behalf and writes it down, where deriving the day from the
start date reaches the same answer and stores nothing.

**An optional anchor** (`anchor: Date = fromDate`). Every existing call site
compiles unchanged, which is exactly the problem — the defect *was* a caller
reading the day off the wrong date, and a default makes that the silent behaviour
for the next one.

**`f.interval is int` in the rules.** Tighter, and it would strand real rules.
Intervals written by older builds are stored as 1.0-shaped doubles, and `is int`
rejects a double outright — so every write that carries such a rule's frequency
map would come back denied with nothing on screen to explain it: a restore
replaying an old backup, and any edit that changes the schedule. Renames and
amount changes are not affected, because `recurringUpdateValid` only evaluates
`frequencyValid` when the write actually touches `frequency`, but that narrows
the blast radius rather than removing it. `>= 1` is the property that matters and
holds for a double just as well; it also rejects NaN, which is the hole a raw
write could otherwise have gone through.

## Things that only became apparent while building

**`Timestamp.fromDate(new Date(NaN))` does not throw.** The plan assumed it did,
which made the pre-existing claim guard look merely incomplete: a bad rule would
blow up the transaction, roll back, and retry forever. What actually happened was
a commit — a posted occurrence and a rule pointer of NaN seconds, atomically,
looking like success. The corrected story is what the Context above records, and
it is why the *shape* of the guard ended up mattering more than its placement.
The behaviour is now pinned by a spec asserting that a claim over a rule whose
frequency yields an Invalid Date commits a pointer equal to the date it was
holding.

**A failing test for this defect does not fail, it hangs.** The pre-fix
behaviour is an infinite synchronous loop, so the red run is a browser that stops
answering rather than an assertion with a diff. The frequency-validation specs
are written around that: each uses a start date deliberately in the future, so
`createRecurring` returns it unchanged instead of walking towards today, and the
pre-fix run fails on the missing rejection rather than hanging.

**The occurrence specs had to start seeding the start date.** The claim tests
seeded rules whose pointer had been moved without moving the start date. Once the
walk reads the anchor, that describes a rule anchored on the fixture's default
day rather than the one the spec is about, and its posting window then depends on
the calendar date the suite happens to run on. The fixture now defaults a rule's
start date to its first occurrence, the sequence helper seeds both from the date
the case is about, and the one spec that means a rule resumed mid-schedule passes
a differing start date explicitly.

**These specs are local-calendar arithmetic end to end** — month lengths, clamped
days, leap years, a start-date anchor, all built from local `Date` components and
asserted through local day keys — and they were the one suite of that kind not in
the zone-shifted run. They are in it now.

## Known gaps

**A stored rule with an unusable interval is made inert, not repaired.** It still
claims: the claim posts the occurrence its pointer names, the walk breaks before
advancing, and the same pointer is written back. The transaction id is
`rec-<ruleId>-<occurrence time>` and therefore deterministic, so the ledger keeps
exactly one row — but every catch-up run rewrites that row with a fresh
`createdAt` and rewrites the rule document alongside it. Bounded, visible, and
impossible to create anew through any of the three floors, but it is per-run
write churn until someone edits or deletes the rule. Repairing it means choosing
a corrected interval on the user's behalf, which nothing here does.

**Resuming such a rule reports success and moves nothing.** `resumeRecurring`
recomputes the pointer from today; the walk inside breaks on its first
non-advancing step, so the stored `nextOccurrence` is the moment of the resume
itself — immediately due, and then subject to the churn above. The button says
the rule was resumed, which it structurally must: that path has no way to say
anything else.

**Resuming re-anchors a rule that has no day of its own.** `resumeRecurring`
recomputes from today and passes today as the anchor, so a monthly or yearly rule
with no `dayOfMonth` posts its first occurrence after a resume on the resume day
rather than on its usual day; the stored `startDate` is untouched, so the claim
puts it back the occurrence after. Threading the rule's start date through resume
as well would fix the one date, and would also mean resume no longer means
"from now" — a decision worth making on its own rather than as a side effect of
this one.

**A pointer already corrupted by a pre-fix run is not repaired either.** A rule
whose `nextOccurrence` holds NaN seconds reads back as an Invalid Date, and every
comparison against it is false, so catch-up never finds it due and the preview
never lists it. Nothing in this change looks for that shape. The recovery exists
and is manual — pause, then resume, which rewrites the pointer from today — but
it depends on the user noticing that a rule stopped paying.

**The anchor survives only until someone edits the rule in the dialog.** The
day-of-month select has no empty option, and the form pre-fills it with the 1st
for a rule that never named a day, so saving that form pins the schedule to the
1st. It is on screen, and it is easy to miss. Making the field genuinely optional
is a dialog change with its own decisions to make about what an unset day should
look like, and was deliberately not started here.
