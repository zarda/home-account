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
  `(contributedAmount + linkedAmount) / targetAmount` for both kinds;
  every display reads the sum through `goalProgressAmount()`, never a raw
  counter.
- `contributedAmount` — a counter of manual contributions, moved only by
  the Contribute dialog.
- `linkedAmount` — a counter of linked transactions (see below;
  [ADR 0027](ADR/0027-a-linked-transaction-carries-its-converted-amount.md)).
  Absent on documents written before links existed and read as 0.
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
withdrawing (a known gap in the ADR). Withdrawing floors on the manual
counter alone; money that arrived through links leaves by unlinking, which
is why the card breaks the total down once links exist.

## Linked transactions

A transaction can be linked to an active goal from the transaction form
(add or edit), so money that already exists as a ledger row counts toward
progress without being typed in twice. Mechanics
(`transaction.service.ts`, ADR 0027):

- The link is two fields on the transaction: `goalId`, and `goalAmount` —
  the amount converted into the **goal's** currency when the link is
  written, re-snapshotted when the amount or currency changes, never at
  read time (the `amountInBaseCurrency` precedent). Unlinking or deleting
  backs out exactly the stored figure, so rate movement between link and
  unlink cannot strand a remainder.
- Every counter change commits in the same Firestore transaction as the
  row write — link, unlink, switch, amount edit, delete — so two devices
  cannot double-count and the link can never disagree with the counter.
  Linked writes therefore need the network, like Contribute.
- Only a **new** link demands an existing, active goal
  (`GOAL_LINK_INVALID` otherwise). A link a row already carries keeps
  counting after the goal is deactivated; deleting a goal sweeps its links
  off the rows first. Back-outs clamp at zero rather than blocking edits.
- Deleting every transaction zeroes every `linkedAmount`; deleting the
  account needs nothing extra (the cascade removes both collections).

The linked share feeds everything progress feeds: the card (with a
"manual · from transactions" breakdown once links exist), and the AI
summary's goal section and cache key.

## Finding a goal's transactions

Once a goal has linked rows its card offers **View transactions**, which opens
the Transactions page filtered to that goal. The filter carries only the goal,
so it reaches links from any month rather than the page's usual current-month
window.

`goalId` is a first-class transaction filter (`TransactionFilters`,
`buildTransactionWhere`): server-side like `categoryId` and `currency`, which
is what keeps the paged window dense and the header's count exact. It needs
the `goalId`+`date` composite index pair in `firestore.indexes.json` — the
emulator does not enforce composite indexes, so nothing in the test suite
catches a missing one.

The same filter is reachable two other ways: the **Goal** dropdown in the
transactions filter panel (which names whatever filter arrived from a card,
and keeps a since-deactivated goal listed so it can still be cleared), and a
goal-scoped smart-search answer's "view transactions" — see
[smart-search.md](smart-search.md).

## Where goals surface

- **Budgets → Goals tab**: progress cards. The bar clamps at 100% while
  the printed percentage keeps counting — overshooting a savings target is
  success, not overflow.
- **The AI summary** on the dashboard receives active goals as a prompt
  section (names, saved/target in the base currency, percent saved — no
  raw transactions), so insights can speak to pacing. "Saved" is the full
  progress, manual plus linked. A contribution or a link changes the
  summary's cache key, so a fresh summary follows either.
- **The transaction form** carries the goal picker (add and edit) — see
  "Linked transactions" above.

## Rules, backup, deletion

- `firestore.rules` validates kind, positive target, non-negative
  contributions and linked counters, and bounds `items` to a list of at
  most 50 (element shapes are validated client-side — per-element map
  validation is not expressible in rules). On transactions it validates
  the link pair and refuses a `goalAmount` without its `goalId`. The
  catch-all carve-out lists `goals`, without which every check above
  would be bypassable.
- Backups carry goals from schema **1.3** and links from **1.4**; older
  backups restore with none. A restore writes each goal at its backup id
  with the contributed balance verbatim — unlike a budget's `spent`,
  there is nothing to recompute it from. `linkedAmount` is the opposite:
  restored rows carry their links verbatim without touching counters (the
  goal may not exist yet mid-restore), and a final pass recomputes each
  involved goal's counter from what the ledger then actually holds — so
  restoring twice, or over a live account with links of its own, cannot
  double-count.
- Account deletion sweeps `users/{uid}/goals` like every other
  subcollection (see [account-deletion.md](account-deletion.md)).
