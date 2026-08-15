# Architecture decision records

Dated records of decisions that were hard to make and would be expensive to
reverse — why a thing is the way it is, not how to use it.

| # | Decision | Status | Date |
|---|----------|--------|------|
| [0001](0001-tiered-rag-levels.md) | Tiered RAG levels for AI insights | Accepted | 2026-07-22 |
| [0002](0002-insights-and-monthly-snapshots.md) | Spending-pattern insights and monthly snapshots | Accepted | 2026-07-26 |
| [0003](0003-analytics-consent-and-taxonomy.md) | Opt-in analytics: consent gate and event taxonomy | Accepted; consent model superseded by 0004 | 2026-07-27 |
| [0004](0004-tier-gated-analytics.md) | Usage statistics are part of the free tier | Accepted | 2026-07-27 |
| [0005](0005-prompt-registry-and-provider-parity.md) | One prompt registry, and a contract the providers must satisfy | Accepted | 2026-07-27 |
| [0006](0006-multi-image-receipt-storage.md) | Receipt images are addressed by slot; removal tombstones, never renames | Accepted | 2026-07-29 |
| [0007](0007-transactional-receipt-edits.md) | Receipt slot edits commit through Firestore transactions; storage deletes stay first | Accepted | 2026-07-30 |
| [0008](0008-universal-receipt-language-support.md) | The app never narrows what the model can read | Accepted | 2026-07-31 |
| [0009](0009-shared-state-publishing-and-lifecycle.md) | One publisher for shared account state; owners reset it, holders release it | Accepted | 2026-08-02 |
| [0010](0010-nothing-truncates.md) | Nothing truncates: text reflows, values scale | Accepted; amended by 0012 | 2026-08-03 |
| [0011](0011-the-csv-file-is-a-contract.md) | The CSV file is a contract, and every cell in it is untrusted | Accepted | 2026-08-03 |
| [0012](0012-a-strip-scrolls-rather-than-growing-the-row.md) | A strip of chips scrolls rather than growing the row | Accepted; row anatomy revised by 0017 | 2026-08-03 |
| [0013](0013-the-printed-total-is-the-amount-not-the-item-sum.md) | The printed total is the amount, not the sum of the items | Accepted | 2026-08-05 |
| [0014](0014-recurrence-guards-and-anchors.md) | Recurrence validates at the edges, breaks in the loops, and anchors on the start date | Accepted | 2026-08-05 |
| [0015](0015-reclaimed-receipts-replay-idempotently.md) | A reclaimed receipt replays onto the ids it already used | Accepted | 2026-08-05 |
| [0016](0016-aggregate-answers-persist-as-snapshots-that-refresh-locally.md) | Aggregate answers persist as snapshots that refresh locally | Accepted | 2026-08-06 |
| [0017](0017-the-row-stacks-and-actions-ride-behind-a-swipe.md) | The row stacks its lines, and actions ride behind a swipe | Accepted | 2026-08-07 |
| [0018](0018-account-deletion-is-a-client-side-cascade.md) | Account deletion is a client-side cascade | Accepted | 2026-08-07 |
| [0019](0019-share-intake-lands-through-a-stash.md) | Share intake lands through a stash | Accepted | 2026-08-07 |
| [0020](0020-detected-groups-convert-through-the-prefilled-form.md) | Detected groups convert through the prefilled form | Accepted | 2026-08-07 |
| [0021](0021-one-goal-model-carries-savings-and-projects.md) | One goal model carries savings and projects | Accepted | 2026-08-07 |
| [0022](0022-the-forecast-baselines-at-zero-today.md) | The forecast baselines at zero today | Accepted | 2026-08-07 |
| [0023](0023-the-initial-bundle-carries-only-the-entry-route.md) | The initial bundle carries only the entry route | Accepted | 2026-08-08 |
| [0024](0024-every-component-checks-with-onpush.md) | Every component checks with OnPush | Accepted | 2026-08-08 |
| [0025](0025-provider-variation-lives-in-the-transport-seam.md) | Provider variation lives in the transport seam | Accepted; amended by 0043 | 2026-08-08 |
| [0026](0026-every-period-window-comes-from-one-helper.md) | Every period window comes from one helper | Accepted | 2026-08-08 |
| [0027](0027-a-linked-transaction-carries-its-converted-amount.md) | A linked transaction carries its converted amount, and the goal keeps the sum | Accepted | 2026-08-08 |
| [0028](0028-a-search-scope-only-names-what-a-transaction-carries.md) | A search scope only names what a transaction carries | Accepted | 2026-08-08 |
| [0029](0029-every-stored-kind-has-one-door.md) | Every stored kind has one door, checked against the deletion cascade | Accepted | 2026-08-08 |
| [0030](0030-a-stored-search-holds-either-figures-or-a-scope.md) | A stored search holds either figures or a scope; a pinned one does not expire | Accepted; amends 0016; amended by 0035 | 2026-08-08 |
| [0031](0031-a-restore-merges-into-the-row-it-finds.md) | A restore merges into the row it finds; the backup's flags outrank the create defaults | Accepted; amends 0021 | 2026-08-09 |
| [0032](0032-a-sweep-is-only-as-wide-as-its-greps.md) | A sweep is only as wide as its greps | Accepted; extends 0026 | 2026-08-10 |
| [0033](0033-a-stored-figure-is-re-taken-only-when-its-input-moved.md) | A stored figure is re-taken only when its input moved, and its unit never moves under it | Accepted; amends 0027 | 2026-08-11 |
| [0034](0034-a-correctness-read-enumerates-the-collection.md) | A correctness-bearing read enumerates the collection, never a listener's first emission | Accepted | 2026-08-11 |
| [0035](0035-what-the-emulator-cannot-see-is-checked-from-the-files.md) | What the emulator cannot see is checked from the files | Accepted | 2026-08-12 |
| [0036](0036-a-user-facing-string-lives-in-the-catalog.md) | A user-facing string lives in the catalog, and only English declines | Accepted | 2026-08-12 |
| [0037](0037-an-error-body-is-a-failed-fetch.md) | An error body is a failed fetch, and an expired cache beats the constants | Accepted | 2026-08-12 |
| [0038](0038-a-dead-guard-reads-exactly-like-a-live-one.md) | A dead guard reads exactly like a live one | Accepted | 2026-08-13 |
| [0039](0039-a-share-arrives-typed-and-the-stash-answers-to-its-owner.md) | A share arrives typed, and the stash answers only to its owner | Accepted; amends 0019 | 2026-08-14 |
| [0040](0040-the-native-seams-answer-to-xctest.md) | The native seams answer to XCTest, and the plugins stay shells | Accepted | 2026-08-14 |
| [0041](0041-a-retired-model-id-migrates-once.md) | A retired model id migrates once, and the catalog keeps the choice | Accepted | 2026-08-14 |
| [0042](0042-a-derived-figure-agrees-with-the-set-that-produced-it.md) | A derived figure agrees with the set that produced it, and a cached one keys on all of it | Accepted | 2026-08-14 |
| [0043](0043-a-declared-setting-reaches-every-transport-that-accepts-it.md) | A declared generation setting reaches every transport that accepts it | Accepted; amends 0025 | 2026-08-14 |
| [0044](0044-the-catch-up-work-list-comes-from-the-server.md) | The catch-up work list is answered by the server or not at all | Accepted; extends 0034 | 2026-08-15 |
| [0045](0045-a-confidence-grade-names-its-source.md) | A confidence grade names its source, and the CSV import asks the real categorizer | Accepted | 2026-08-15 |
| [0046](0046-an-unrecognized-category-name-is-not-a-category.md) | An unrecognized category name is not a category | Accepted | 2026-08-15 |

## What belongs here

A decision with a real alternative and a real cost. If there was only one
sensible option, there is nothing to record.

Reference material — what a feature does, how to configure it, what the
parameters mean — belongs in a document beside this folder (`../insights.md`,
`../analytics.md`) and is written for someone using the feature. An ADR is
written for someone who is about to change it and needs to know what the last
person already considered.

The two often come in pairs: the doc says what the system does, the ADR says
why it does that and what was rejected.

## Format

One file per decision, `NNNN-kebab-case-title.md`, numbered in the order they
were accepted. Numbers are never reused and files are never deleted — a
decision that no longer holds gets its status changed and a pointer to the
record that replaced it, because the fact that it was once decided the other
way is itself the useful part.

Open with a heading, then a status line:

```markdown
# 7. Short statement of the decision

**Status:** Accepted, implemented · **Date:** 2026-07-27 · **Issues:** #123
```

Status is one of **Proposed**, **Accepted**, `Superseded by NNNN` (linked), or
**Deprecated**. Add `, implemented` to an accepted decision once the code
matches it — the gap between deciding and shipping is worth being able to see.

Then **Context** (the forces, the problem, what made this hard) and
**Decision** (what was chosen, and what was rejected and why). After that,
whatever the decision actually produced: *Consequences*, *Departures from the
issues*, *Things that only became apparent while building*, *Known gaps*. Those
last three are usually the most valuable part and should not be flattened into
a generic consequences list to satisfy a template.

Write what was true at the time. An ADR is not maintained as the code changes;
if the decision is revisited, that is a new record.
