# 27. A linked transaction carries its converted amount, and the goal keeps the sum

**Status:** Accepted, implemented · **Date:** 2026-08-08 · **Issues:** #237

Reference documentation lives in [../goals.md](../goals.md).

## Context

ADR 0021 made goal progress a single manual counter and wrote the rule into
the model: transactions are never a source. The gap it left is the drift the
issue describes — when the money already exists as a ledger row (a transfer
into savings, a payment on a project item), the ledger and the goal each
have to be told separately, and the two disagree the moment one is told and
the other is not. The ask: link a transaction to an active goal so its
amount counts toward progress, atomically, surviving edits, deletes and
backup round-trips. Three questions had no precedent: where the linked total
lives, what happens when the transaction's currency is not the goal's, and
how a restore avoids counting a link twice.

## Decision

**A second counter beside the manual one, moved only in the transaction
that moves the link.** `linkedAmount` sits on the goal next to
`contributedAmount`; progress is their sum, read everywhere through
`goalProgressAmount()`. Every transition — link on add, link/unlink/switch
on edit, re-snapshot on amount change, back-out on delete — commits its
counter delta in the same Firestore `runTransaction` as the row write, so
two devices cannot double-count and the link can never exist without its
counter move. Rejected: deriving the linked total by query at render time —
every card paint becomes a collection scan, and the "progress" a prompt or
backup sees depends on when it looked. Rejected: folding links into
`contributedAmount` — withdrawal floors, the contribute dialog and restore
semantics all treat manual money differently, and a merged counter cannot
tell the two apart again.

**The conversion snapshots onto the row at link time.** A transaction may
link to a goal in another currency; the amount converts into the goal's
currency when the link is written and the figure is stored on the row as
`goalAmount` (the `amountInBaseCurrency` precedent). Unlink and delete back
out exactly the stored figure; an edit that touches amount or currency
re-snapshots, and one that does not leaves the figure alone — a conversion
at today's rates must not move a counter the user never touched. Rejected:
same-currency linking only — simplest, but it makes the common
foreign-currency payment on a travel project unlinkable. Rejected:
converting at unlink time with live rates — rate movement between link and
unlink strands a remainder in the counter permanently.

**Restore recomputes the counter from the ledger.** Backup schema 1.4
carries the link pair on rows (whole documents serialize, so no exporter
change). Restore writes links verbatim through `goalSnapshot`, touching no
counter — mid-restore the goal often does not exist yet, since goals
restore after transactions — and a final pass recomputes `linkedAmount` for
every involved goal from what the account then actually holds. This is the
budget-`spent` precedent, and it is what makes the double-count impossible
in every ordering: restoring twice overwrites the same rows, and restoring
over a live account whose own links the backup never saw sums them anyway.
Rejected: restoring the counter verbatim — correct only on a clean account,
silently wrong over a live one.

**Consistency work runs where the write runs; services do not inject each
other.** TransactionService addresses `users/{uid}/goals/{id}` for counter
staging, GoalService addresses the transactions collection for its delete
sweep and the restore recompute — each through FirestoreService path
strings. Rejected: cross-injection (a dependency cycle for the sake of a
template literal) and the lazy-import dance the budget helper uses, which
is warranted there by real logic reuse and here would import a service to
build a string.

**The CSV stays linkless.** A goal-id column round-trips nothing a
spreadsheet can use and the importer would never read it back (ADR 0011:
the CSV is a contract). Links live in the JSON backup, which carries whole
documents.

## Consequences

- Linked writes require the network, like `contribute()` — Firestore
  transactions reject offline. Unlinked adds, edits and deletes keep the
  plain offline-capable paths.
- Only a **new** link demands an existing, active goal
  (`GOAL_LINK_INVALID`). Existing links keep counting through deactivation;
  deleting a goal sweeps its links off the rows first; back-outs clamp at
  zero so counter drift can never block an edit or delete.
- A receipt append and a link change in one edit commit in the append's
  placement transaction; a link error there sweeps the uploaded objects
  like any failed attach.

## Things that only became apparent while building

- An edit that touches neither amount nor currency must not re-snapshot:
  the first draft converted on every linked update, which moved counters
  under a note edit whenever rates had moved.
- A raced `deleteGoal` sweep can leave an edit holding a link to nothing;
  finishing the sweep's work (clear the pair, write no counter) beats both
  failing the edit and resurrecting the link.
- The goals signal is warm only where a page subscribed (ADR 0009); the
  transaction form owns its own `getGoals()` subscription or the picker is
  empty on the transactions page.

## Known gaps

- A recurring rule cannot name a goal, so its materialized transactions
  arrive unlinked; linking them is a manual edit per occurrence.
- Still no per-contribution ledger (ADR 0021's gap stands); the linked
  counter has per-row provenance, the manual one does not.
- `transaction_add` analytics carry no link dimension — the event registry
  is deliberately untouched while the privacy-label work (#127) is open.
