# 35. What the emulator cannot see is checked from the files

**Status:** Accepted, implemented; the *checker proves the file, not the deployment* gap is closed by [0077](0077-merges-deploy-what-they-changed.md) · **Date:** 2026-08-12 · **Issues:** #249, #250, #275

Reference documentation lives in [../emulator-blind-spots.md](../emulator-blind-spots.md).

## Context

Three defects, one root cause: nothing exercised a real client path against
the deployed rules and indexes.

The emulator does not enforce composite indexes, so the smoke suite could not
see that `firestore.indexes.json` carried only 10 of the 30 entries the
transaction filter panel needs. `buildTransactionWhere` composes four equality
fields freely and both consumers order by `date` in either direction; only the
five subsets someone had thought to list were indexed. Any other pair of
dropdowns — Type plus Currency, Category plus Goal — threw
`failed-precondition` in production, burned three retries of backoff, and
landed on the generic "couldn't load" banner (#249). The goal-filter smoke
suite even said so in a comment: the index file is reviewed, not tested.

The rules smoke suite hand-builds its documents, and every hand-built filter
scope carried both dates. So `answerScopeValid`'s unconditional
`hasAll(['startDate', 'endDate'])` looked correct locally while rejecting the
one write `recordFilter` actually issues: the model is told never to invent
dates, so a question that names no window produces a scope with neither bound.
Every dateless filter search failed to store, the `void`ed write became an
unhandled rejection, and the global handler raised a generic error toast over
correct results (#250). ADR 0030 had named this exact hazard — "a mistake here
rejects every filter write silently in production" — and the suite closed it
from neither side.

And `answerUpdateValid` never re-applied the kind/figures pairing the create
rule enforces, so an update could grow `value`, `transactionCount`,
`baseCurrency` or the typed optionals onto a `kind: 'filter'` document — a
record shape no reader expects and the create door exists to forbid (#275).
No shipped client issues that write; the guarantee is for the client that is
not this one.

## Decision

**The required index set is computed from the query builder, not remembered.**
The contract: every non-empty subset of `buildTransactionWhere`'s equality
fields, with `date` last, in both directions — 30 entries for today's four
fields. `firestore.indexes.json` is regenerated to carry all of them, and
`scripts/check-firestore-indexes.mjs` (`npm run indexes:check`, a CI step)
recomputes the requirement on every run by extracting the equality pushes from
the source, per ADR 0032: a sweep is only as wide as its greps, so this one
greps the code that decides. A hand-maintained list was rejected because it
drifts exactly like the file it polices — that is how #68 and the goal filter
each added only their own pairs. A Karma spec was rejected because the
emulator cannot represent the failure at all. Entries are matched set-wise
(Firestore accepts any order among an index's equality fields), and a shape
guard fails the check if the extraction ever finds fewer than two fields.

**A scope's bounds requirement follows the kind.** `answerScopeValid` takes a
`requireBounds` parameter; `answerCreateValid` passes `d.kind == 'aggregate'`.
An aggregate's figures are meaningless without the window they were computed
over, so its bounds stay required. A filter record stores exactly what the
question named — one date or none — and replays as exactly that. A bound that
is present must still be a day key for either kind. The alternative, resolving
dateless filter scopes to the current month before recording, was rejected
because it stores a scope the question never asked: reopening "show all my
Starbucks purchases" would silently narrow it to the month it was first asked
in.

**The update rule re-checks the pairing, with a pre-kind exemption.**
`answerUpdateValid` now ends with the create rule's ternary over the merged
document, guarded by `!('kind' in d)`. The guard is load-bearing: records
written before schema version 2 have no `kind`, the rule above freezes `kind`
so they can never gain one, and in the rules language reading a missing key is
an evaluation error that denies the write — an unguarded clause would have
broken ADR 0030's promise that pre-version-2 records stay touchable, pinnable
and refreshable. A `hasOnly` on update remains deliberately absent, as before:
the closed field set is the create door's, and closing updates interacts with
every future field the service starts writing.

**A missing index fails fast.** `fetchPage` stops retrying on
`failed-precondition`. It is a deploy defect: every retry returns the same
answer, and the backoff only delays the banner. Transient errors keep their
three attempts.

**A collection door gets at least one smoke case through the service that owns
it.** The rules suite's hand-built payloads prove what the rules accept; only
the owning service proves what the client sends. `recordFilter` — the write
#250 broke — now runs against the live rules in
`search-answer-history.service.smoke.spec.ts`, dateless scope and dedupe touch
included, and the multi-equality filter combinations run through the real
`TransactionWindowService` with a doc-block note naming what the emulator
still cannot prove about them.

## Consequences

- The transactions collection carries 30 composite indexes instead of 10.
  Each one costs write amplification on every transaction document; the
  project cap is 200, and a fifth equality field would double the set to 62,
  so the checker's success line prints the field list as a running reminder.
- `firestore.indexes.json` is now generated output. Hand-edits that reorder
  equality fields still pass (the checker matches set-wise), but the file's
  entry order no longer encodes anything.
- Deploys are part of the fix, not an afterthought: neither the new indexes
  nor either rules change does anything until
  `firebase deploy --only firestore:indexes` / `--only firestore:rules` run
  and the console shows every index Enabled. The release steps live in the
  reference doc.
- A dateless filter search now stores and replays; its record renders in the
  history panel like any other. A rejected history write logs
  (`[NlSearch] Recording the filter interpretation failed:`) instead of
  toasting over results that already rendered.

## Things that only became apparent while building

- The pre-kind exemption was found on paper, not by a failing test: the create
  door has required `kind` since schema version 2, so no emulator client can
  mint the kindless record that would have been bricked. The regression the
  guard prevents is untestable from the client side, which is exactly why it
  is spelled out in the rule's comment.
- The `.catch` spec doubles as documentation of the old failure: before the
  fix, the spec's console spy caught the zone's unhandled-rejection report —
  the toast path — rather than a deliberate log. The assertion distinguishes
  the two by arity.
- The bitmask regeneration orders entries differently than the hand-ordered
  file it replaced. Harmless — the checker matches set-wise and the deploy
  diffs by content — but the first `git diff` of a regenerated file is all
  noise, which is an argument for never splicing it by hand again.

## Known gaps

- The checker proves the file, not the deployment. Nothing in CI can see
  whether the live project's indexes or rules match the repo; the deploy
  steps and the console check are a release-time discipline.
- The aggregate path's fire-and-forget writes (`recordAnswer`,
  `recordRecent`) still surface a rejected write as the generic toast. Their
  scopes are always resolved, so the known rejection class does not apply,
  but the asymmetry with the filter path is real.
- `answerUpdateValid` still has no `hasOnly`, so an update can introduce
  fields outside the create allowlist (typed fields excepted). Deliberate,
  recorded above — closing it is its own decision.
- The `countDocuments` header-count query sends the same equality set with no
  order-by; the new indexes cover it, but `MockFirestoreService.countDocuments`
  still records into `_getCollectionSpy` (carried from ADR 0034).
