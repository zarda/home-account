# 20. Detected groups convert through the prefilled form

**Status:** Accepted, implemented · **Date:** 2026-08-07 · **Issues:** #48

Reference documentation lives in [../recurring.md](../recurring.md) ("From
detection to a rule").

## Context

Issue #48 asked for subscription *detection* with one-tap conversion — but
detection had already shipped by the time the issue was picked up:
`computeRecurringGroups` clusters expense history by merchant similarity,
amount coherence, and gap regularity, and the Insights tab renders the
result. What was genuinely missing was the second half: a detected group
led nowhere. The issue also pointed at `DuplicateDetectionService`'s
similarity scorer and `RecurringService`'s cadence math as building blocks;
both are private API, and the detector's own utilities are the public,
Unicode-correct versions of the same ideas.

## Decision

**Conversion opens the existing recurring form, prefilled — not a one-tap
create.** The acceptance criterion said one tap creates the rule; the tap
here opens the dialog and Save creates it. The departure is deliberate: the
prefilled amount is the group's *median in base currency* (the real charge
may bill in a foreign currency), and the name is the most recent raw
merchant string — both are the detector's guesses, and the dialog is the
one place the user can correct them before a rule starts posting real
transactions every month. A silent create with an undo would have posted
guessed data first and asked questions later.

**A cadence maps onto the engine's existing types.** Biweekly and quarterly
have no `FrequencyType`; they express as `weekly` interval 2 and `monthly`
interval 3. The anchor is the last observed charge, because the engine
advances a past anchor to the next scheduled date (ADR 0014) — converting a
subscription never backfills the months the detector already saw.

**Covered groups are suppressed, not relabeled.** Rejected: stamping
`recurringId` onto the past transactions of a converted group — that would
rewrite history the user did not author, entangle conversion with the
idempotent-claim machinery, and still miss future lookalikes. Instead the
live detected list hides any group an *active* rule already covers (same
cadence in engine terms, merchant-matched name at the detector's own
similarity threshold). This also suppresses groups covered by rules the
user created by hand, which is the correct reading of "already tracked".
Archived snapshots receive no rules and stay whole — they are records of
what was detected at the time.

## Consequences

- The insights tab now holds a live rules listener (scoped to the lazily
  created tab, per ADR 0009) so a conversion makes its group vanish
  immediately.
- The recurring dialog's data interface is exported and gained an optional
  `prefill`; edit mode and the save contract are unchanged.

## Known gaps

- Suppression is name-similarity at the detector's threshold; a rule
  renamed beyond recognition un-suppresses its group, which then reappears
  as detected. Harmless, and converting again would be refused by nothing —
  the dialog is a create form like any other.
- The prefill currency is the base currency, not the charge's original.
