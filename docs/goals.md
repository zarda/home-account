# Goals

The Goals tab on the Budgets page tracks money put aside on purpose:
**saving goals** (an emergency fund, a deposit) and **projects** (a trip, a
purchase list). Budgets cap spending; goals accumulate toward it — the two
are siblings, not the same mechanism
(see [ADR 0021](ADR/0021-one-goal-model-carries-savings-and-projects.md)).

## The model

One `Goal` document per goal at `users/{uid}/goals`, mirroring the budget
pattern (`goal.model.ts`, `goal.service.ts`):

- `kind` — `saving` or `project`. A flavor, not a mechanic: both kinds
  carry the same fields and the same progress math.
- `targetAmount` — **always authoritative**. Progress is
  `contributedAmount / targetAmount` for both kinds.
- `contributedAmount` — a single counter of manual contributions.
  Transactions are never a source; putting money "into" a goal is a
  bookkeeping statement, not a transfer the ledger can observe.
- `items` — an optional checklist for projects (`{name, amount, done}`,
  at most 50). The form can copy the list total into the target on
  demand, but the list is never a second source of truth: editing an item
  later does not silently move the target.
- `targetDate`, `note` — optional; `isActive` mirrors budgets.

## Contributions

**Contribute** on a goal card records an amount in (or, flipped, back
out). The write is a Firestore transaction: two devices contributing at
once both land, a withdrawal sees the balance it is shrinking, and one
that would drive the counter below zero aborts with
`GOAL_CONTRIBUTION_BELOW_ZERO`. Checking off a project item commits the
same way. There is no per-contribution ledger — one counter, corrected by
withdrawing (a known gap in the ADR).

## Where goals surface

- **Budgets → Goals tab**: progress cards. The bar clamps at 100% while
  the printed percentage keeps counting — overshooting a savings target is
  success, not overflow.
- **The AI summary** on the dashboard receives active goals as a prompt
  section (names, saved/target in the base currency, percent saved — no
  raw transactions), so insights can speak to pacing. A contribution
  changes the summary's cache key, so a fresh summary follows a fresh
  contribution.

## Rules, backup, deletion

- `firestore.rules` validates kind, positive target, non-negative
  contributions, and bounds `items` to a list of at most 50 (element
  shapes are validated client-side — per-element map validation is not
  expressible in rules). The catch-all carve-out lists `goals`, without
  which every check above would be bypassable.
- Backups carry goals from schema **1.3**; older backups restore with
  none. A restore writes each goal at its backup id with the contributed
  balance verbatim — unlike a budget's `spent`, there is nothing to
  recompute it from.
- Account deletion sweeps `users/{uid}/goals` like every other
  subcollection (see [account-deletion.md](account-deletion.md)).
