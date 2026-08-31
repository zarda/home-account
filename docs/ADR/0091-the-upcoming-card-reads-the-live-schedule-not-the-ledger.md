# 91. The upcoming card reads the live schedule, not the ledger

**Status:** Accepted, implemented · **Date:** 2026-09-01 · **Issues:** #51

## Context

Every figure on the dashboard before this card was folded out of transactions
that exist. The recurring rules describe money that does not exist yet, and the
only surface that showed any of it was the next-date column in Budgets →
Recurring — one rule, one date, no total. A schedule was visible only after it
had posted, which is the wrong half of the month to learn about it in.

Two properties of a scheduled occurrence make it unlike everything else the
page draws, and both of them shape the card.

**It carries no money snapshot.** Every written transaction stores
`amountInBaseCurrency` at write time, and
[0033](0033-a-stored-figure-is-re-taken-only-when-its-input-moved.md) is the
rule that nothing re-converts a figure whose input has not moved. An occurrence
that has not been written has no such field to prefer. Whatever the card shows
in the base currency it has to compute now, at today's rate, and be honest that
that is what it is.

**It is not persisted anywhere.** `getNextOccurrences(days)` walks each active
rule's `nextOccurrence` pointer forward through the window and yields the dates
it lands on. There is no collection to query, no snapshot to read, and — this
is the part that decides the card's most visible behaviour — no lower bound.
The walk starts at the pointer, and a pointer can be in the past: that is
exactly what a rule looks like between coming due and the catch-up posting it.

## Decision

**The card is fed by a live `getNextOccurrences` subscription the dashboard
owns.** Fourteen days, anchored to today.

**The window is anchored to today, not to the selected period.** The card
answers "what is about to move", not "what happened in the window I am looking
at" — a user reading last March has no use for last March's bills. That is why
the subscription sits in `ngOnInit` beside budgets and categories rather than
inside `loadData()`: `loadData()` re-runs on every period toggle, and
`getNextOccurrences` is an `onSnapshot` that never completes, so running it
from there would stack a second listener on each toggle.

**Row amounts stay in each rule's own currency; only the net converts.** A rule
the user typed in JPY renders in JPY. Showing a converted figure beside an
amount the user chose reads as a wrong number, and the conversion would be a
guess at a rate that has not happened yet. The net has no such option — it has
to add unlike currencies up — so it converts live through
`CurrencyService.convert`, the same idiom the reports forecast uses over the
same stream, and it is the one figure on the dashboard that is not a snapshot.

**Occurrences dated before today are shown, not filtered.** They are due but
not yet posted. Hiding them would conceal money about to move on precisely the
occasion when the user most needs to see it — a catch-up that has not run or
has failed. The cost is a flicker: once catch-up posts the row it leaves the
card and appears in Recent Transactions. That flicker is the cheaper of the two
failures, and it is deliberate rather than an oversight.

**The card component is dumb, like every other dashboard widget.** It takes
occurrences, categories, the base currency and the pre-folded net as inputs and
groups by local day; the page owns the listener, the conversion and the
currency. Its grouping deliberately adds no sort of its own — occurrences
arrive sorted, so first-seen order into a `Map` *is* date order, and a second
ordering rule here would be one more thing to keep in step with the service's.

Rejected: **deriving the card from posted transactions.** That is the ledger,
and the ledger is precisely what does not contain the answer.

Rejected: **tying the window to the period selector.** It makes the card read
as a forecast of the selected period, which for any past period is empty and
for the current one is a different question than the one asked.

Rejected: **converting the row amounts.** See above; a converted row is a
number nobody typed, at a rate that does not apply to a date that has not
arrived.

Rejected: **hiding the overdue rows to avoid the flicker.** Silence about money
that is about to leave the account is not an improvement on a row that briefly
moves.

## Consequences

- **The dashboard is now a publisher of `recurringTransactions`.**
  `getNextOccurrences` reaches Firestore through `getRecurring()`, which sets
  that shared signal as a side effect
  ([0009](0009-shared-state-publishing-and-lifecycle.md)). Nothing on the page
  depended on that before; it does now, and any future change to
  `getNextOccurrences` that routes around `getRecurring()` silently stops
  refreshing it.
- The subscription is `takeUntilDestroyed`, so it dies with the page like the
  budget and category listeners beside it.
- `UPCOMING_WINDOW_DAYS` is a dashboard constant, unrelated to
  `MAX_REMINDER_LEAD_DAYS` in [0092](0092-a-reminder-fires-once-and-the-record-of-it-lives-on-the-device.md).
  The card's fortnight and the reminder's thirty-day ceiling answer different
  questions and are free to diverge.

## Things that only became apparent while building

- **A daily rule fills the card.** Fourteen days of a daily rule is fourteen
  rows from one rule, and there is no cap. That is correct — the money really
  is scheduled — but it means the card's length is a property of the user's
  rules, not of the design, and the day grouping is what keeps it readable.
- **The net is folded by the page, not by the card.** Passing the number in
  rather than letting the card compute it is what allows the card to be
  rendered from a literal in a spec, with no currency service in the fixture.

## Known gaps

- **The net is a today-rate figure and says so nowhere in the UI.** It is
  labelled "Scheduled net", not "Scheduled net at today's rates". For an
  account whose rules are all in the base currency the distinction never
  arises; for a mixed-currency account the figure will move as rates do, with
  no occurrence having changed.
- **Nothing bounds how far back the overdue rows reach.** A rule that stopped
  paying long ago holds a pointer from then, and its occurrence appears in the
  card at that old date. That is the same condition `recurring.md` already
  documents as a known gap; the card makes it visible rather than causing it.
