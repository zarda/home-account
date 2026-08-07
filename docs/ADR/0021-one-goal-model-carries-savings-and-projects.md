# 21. One goal model carries savings and projects

**Status:** Accepted, implemented · **Date:** 2026-08-07 · **Issues:** #49

Reference documentation lives in [../goals.md](../goals.md).

## Context

Budgets cap spending; nothing tracked saving *toward* something. The ask
grew while being specified: not only classic savings goals but projects —
a travel fund, a purchase list — which suggest itemization. The budget
pattern (model + signal service + progress card + form dialog + rules +
backup + cascade) was the obvious template, but three questions had no
precedent: what distinguishes a project from a saving goal, where the
"money put in" number comes from, and how an itemized list relates to the
target amount.

## Decision

**One model, two kinds.** `kind: 'saving' | 'project'` is a flavor on a
single `Goal` document, not two collections or two services. Every
mechanic — target, contributions, progress, rules, backup, deletion — is
identical; a project may additionally carry an `items` checklist.
Rejected: a separate wishlist/project feature (twice the surface for the
same arithmetic) and an items subcollection (a bounded list of small maps
on the document keeps rules, backup and the cascade one-document simple;
the rules bound it at 50).

**The target is authoritative; the list is a checklist.** Progress is
`contributedAmount / targetAmount` for both kinds. The form can copy the
items total into the target on demand, but nothing links them: editing an
item never silently moves the target the user set. Rejected: deriving the
target from the items when present — two sources of truth that disagree
the moment either is edited.

**Contributions are one transactional counter.** `contribute(id, amount)`
commits through a Firestore transaction (the ADR 0007 precedent; the repo
uses no `increment`, and a transaction also lets a below-zero withdrawal
abort with a typed error instead of clamping silently). Transactions in
the ledger are never a source — putting money toward a goal is a
bookkeeping statement, not an observable transfer. Rejected for now: a
per-contribution ledger; a single counter corrected by withdrawal covers
the v1 need and is recorded as the known gap.

**Goals join the summary prompt as their own section.** Adding the
required `goalSection` field to the prompt inputs deliberately broke all
four `generateSpendingSummary` call sites at compile time — the registry's
designed safety net for threading a new input through every provider. No
exceeded/near-limit markers in the section: passing 100% of a savings
target is the point, so the renderer reports percent saved and lets the
model speak to pacing.

## Things that only became apparent while building

- Restore must carry `contributedAmount` verbatim through `createGoal`
  options — a budget's `spent` recomputes from the ledger, a goal's
  contributions recompute from nothing.
- The AI summary's session cache key needed a goals fingerprint
  (`id:contributed/target`), or a contribution would serve a stale
  summary for up to an hour.

## Known gaps

- No contribution history; the counter is corrected by withdrawing.
- Rules validate the items list's shape and size, not each element —
  per-element map validation is not generically expressible; the client
  validates elements.
- Goal currency conversion in the prompt uses live rates, not a
  write-time snapshot.
