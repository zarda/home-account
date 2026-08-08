# 28. A search scope only names what a transaction carries

**Status:** Accepted, implemented · **Date:** 2026-08-08 · **Issues:** #237 (follow-up)

Reference documentation lives in [../smart-search.md](../smart-search.md) and
[../goals.md](../goals.md).

## Context

ADR 0027 let a transaction be linked to a goal, and the goal card began
reporting how much of its progress came from the ledger. The number had
nothing behind it: no surface listed the rows it was made of. The obvious fix
is a filter, and the obvious place to also honour it is smart search — "how
much have I put toward the Japan trip" is the question the counter invites.

Widening the search to goals raised the harder question of what else it should
understand, and budgets were the immediate answer: "what did I spend against
the groceries budget" is the same shape of question. But the two are not the
same kind of thing, and treating them alike would have put a field on
`TransactionFilters` that nothing could execute.

## Decision

**A goal is a scope field; a budget is a resolver.** A transaction carries
`goalId`, so a goal the model names stays on the filters, travels into the
stored answer scope, and narrows the transactions page. A budget is a category
plus a recurring window — there is no budget field on a transaction — so a
`budgetId` the model returns is accepted, resolved into `categoryId` and (only
when the question supplied no dates of its own) the budget's current period
window via `budgetPeriodWindow`, and then discarded. Every field left on
`TransactionFilters` is therefore something a row actually has, and the same
filter object stays executable by the list query, the paged window and the
aggregate path alike. Rejected: a `budgetId` filter field — nothing downstream
could run it, so all three of those paths would have needed their own copy of
the resolution step, which is how the same rule ends up implemented three
ways and drifting.

**Neither budget contribution overwrites the model.** A category it named
itself wins over the budget's, and dates it gave win over the budget's window.
"Against my groceries budget last year" has to mean last year; snapping back
to the live period would answer a question nobody asked.

**The goal filter is server-side, with its own index pair.** `goalId` joins
`categoryId` and `currency` in `buildTransactionWhere` rather than the
client-side pass that handles amount bounds, tags and search. The paged window
applies client-only filters per fetched page, so a client-side goal filter
would render sparse pages and force the page header from an exact count to
`N+`. The cost is the `goalId`+`date` composite index pair, and the cost of
*that* is honesty: the emulator does not enforce composite indexes, so no test
in this repo can catch a missing one. Rejected: filtering client-side to avoid
the index — it trades an untestable deploy step for a permanently worse list.

**The entry point is the goal card, and it hands off dateless.** The card's
button applies `{ goalId }` alone through `PendingFiltersService` — the channel
insight drill-downs and smart search already use — and navigates. Passing only
the goal is load-bearing: the filters panel replaces its whole filter set from
a preset, which is what clears the page's default this-month window, so a link
posted in March is visible in August. Rejected: a `?goalId=` route param, which
would be deep-linkable but is a different pattern from every other drill-down
in the app, for a link nobody shares.

## Things that only became apparent while building

- `answerScopeValid` in `firestore.rules` is a closed allowlist, so the first
  goal-scoped answer would have been rejected on write. Nothing but the
  emulator suite could have caught it: the unit specs stub Firestore, and the
  failure is a permission error at runtime.
- `goalId` belongs on `SerializableSearchScope`, not the shared
  `SerializableFilters` it extends. Widening the shared type would have widened
  the insight-snapshot rules with it, for a field insight drill-downs never
  produce.
- The filter panel needs the goal a filter *already names* in its option list
  even when that goal has since been deactivated, or an arriving filter renders
  as a blank select the user cannot clear. Same rule the transaction form's
  picker needed for the same reason.
- Smart search opens from anywhere, and the goals and budgets signals are only
  warm where a page subscribed (ADR 0009), so both catalogs need a one-shot
  read behind them or every goal question quietly degrades to a keyword guess.

## Known gaps

- The answer card's scope line still shows only the resolved date range. It
  does not name the category either, so naming just the goal would be a new
  inconsistency; the scope is visible once you open the matching transactions.
- Budget resolution uses the budget's *current* window. A question about a
  named budget in a specific past period has to say the dates itself.
- A transaction row shows no goal chip, so a linked row is only identifiable
  by opening it.
