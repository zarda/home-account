# 69. One ladder decides what is the same merchant, and it stays a string ladder

**Status:** Accepted, implemented · **Date:** 2026-08-26 · **Issues:** #296

Consolidates the matcher the recurring detector and the coverage check each
kept a copy of, and settles the embedding question
[0063](0063-an-import-suggests-only-what-the-account-already-knows.md) left
open as a known gap. The privacy boundary it runs into is
[../insights.md](../insights.md) under *Privacy: what leaves the device*; the
detector behaviour is [../recurring.md](../recurring.md) under *From detection
to a rule*. The measurement lives in
[../merchant-match-probe/](../merchant-match-probe/README.md).

## Context

A subscription whose bank descriptor changes shape — `AMZN Mktp DE*2X4` one
month, `Amazon.de` the next — splits into two recurring groups and neither
reaches the occurrence count that marks it detected. #296 proposed evaluating a
semantic representation of merchant text behind a new service seam, and made
its own first acceptance criterion a measurement: *a design records whether
embeddings actually beat the 0.7 threshold on real descriptors, with the
measurement, or the issue closes as declined.*

Two things had to be settled, and they are independent. The matching logic was
duplicated — `merchantsMatch` in the detector, `merchantNamesMatch` in the
conversion module, whose own comment warned the two had to move together. And
the embedding question was open.

## Decision

**One ladder decides what is the same merchant, and it stays a string ladder.**

### The two matchers become one, and they differed less than advertised

`merchantKeysMatch` in `merchant-match.utils.ts` is the only ladder: exact
equality, containment, Dice similarity over character bigrams.

The two implementations it replaces were nearly identical, and saying so
matters more than claiming a large fix. Their containment rungs are provably
the same predicate: `a.includes(b)` implies `|a| >= |b|`, so "both keys at
least three characters" and "the shorter key at least three characters" are one
condition, and "the longer contains the shorter" is the same as either
`includes`. Checked exhaustively over a word list, the two disagreed on exactly
one input pair — two empty keys, which the detector's copy called a match.

That guard is the whole behaviour change of the merge, and it goes the
conversion copy's way. The detector never hit the case only because
`computeRecurringGroups` filters empty keys before clustering; leaning on one
caller's filter to keep a matcher honest is what breaks when a second caller
arrives, which is exactly what merging them creates. A spec inlines both
retired bodies and asserts the merged one answers as they did.

The module is a leaf. It imports nothing from either recurring module, so the
existing conversion → pattern edge is untouched and no cycle is closed. **This
does not make coverage importable.** `CoveragePredicate` stays injected, for
the reasons `recurring-pattern.utils.ts` gives at its own definition, and that
is written here because "we unified the matcher" reads like permission to tidy
the injection away.

`normalizeMerchant` stays where it is: it is a normaliser, not a matcher, and
moving it would churn the spec that pins its exact outputs by string equality.
`bigramSimilarity` moved with the matcher it backs and is re-exported from its
old home, so the specs pinning it needed no edit — editing a pin in the same
commit as the refactor is how a pin stops pinning.

### The embedding half is declined, and here are the numbers

The bar was registered before the run, in the implementation plan and in the
probe's README:

> Embeddings win only if the best-sweep F1 beats the string F1 by **≥ 0.05**
> and no family regresses by more than one pair.

61 labelled descriptor pairs, `gemini-embedding-001`, cosine swept 0.60–0.95:

| decider | TP | FP | FN | TN | precision | recall | F1 |
|---|---|---|---|---|---|---|---|
| string ladder @ 0.7 | 17 | 5 | 18 | 21 | 77.3% | 48.6% | **59.6%** |
| embedding @ 0.75 (best of sweep) | 30 | 10 | 5 | 16 | 75.0% | 85.7% | **80.0%** |

F1 delta **+0.204** — the first clause passes comfortably. The second does not:

| family | string | embedding |
|---|---|---|
| cross-script | 2/8 | **8/8** |
| abbreviation | 3/9 | **8/9** |
| already-matched | 4/4 | 4/4 |
| already-refused | 4/4 | 4/4 |
| cjk-variant | 4/6 | 4/6 |
| legal-suffix | 5/6 | 5/6 |
| processor-prefix | 5/8 | 5/8 |
| string-near | 4/8 | 4/8 |
| **same-vendor** | **7/8** | **4/8** |

**Verdict: declined.** Embeddings are transformative on exactly the families
character bigrams cannot reach — `7-ELEVEN` against `セブン-イレブン`, `KFC`
against `Kentucky Fried Chicken`, and the `AMZN Mktp DE*2X4G9` / `Amazon.de`
pair the issue opens with. And they are worse where this feature needs
precision most: they merge `AT&T Wireless` with `AT&T Internet`, `SFR Mobile`
with `SFR Box`, `すき家 渋谷` with `吉野家 渋谷`.

That regression is not a tuning problem. It is what a semantic representation
is *for*: those pairs are semantically close, and a model is right to say so.
Recurring detection needs the opposite judgement — two bills from one vendor
are two subscriptions, and merging them produces one confidently wrong monthly
figure in a surface whose whole job is to be trusted about committed spending.
No threshold in the sweep separates them; 0.75 is already the best F1, and
raising it to protect `same-vendor` collapses recall (0.9 scores 0.372).

The two-clause bar is what caught this. F1 alone would have shipped it.

**Re-measured 2026-08-30 against `gemini-embedding-2`** (GA April 2026) — same
corpus, same sweep, same bar, `baseline.json` still recording the original run:

| decider | TP | FP | FN | TN | precision | recall | F1 |
|---|---|---|---|---|---|---|---|
| embedding @ 0.70 (best of sweep) | 33 | 14 | 2 | 12 | 70.2% | 94.3% | **80.5%** |

F1 delta **+0.209** — and `same-vendor` falls further, **3/8** against the
string ladder's 7/8. The newer model keeps every Latin-script merge from the
first run, learns to separate `全聯福利中心` from `全家便利商店`, and adds five
more: `Apple.com/Bill` with `Apple Store`, `Amazon Prime` with `Amazon.de`,
`Verizon Wireless` with `Verizon Fios`, `Costco Gas` with `Costco Wholesale`,
and `Delta Air Lines` with `Delta Dental`. The rest of the movement:
`cjk-variant` 4/6 → 5/6, `processor-prefix` 5/8 → 6/8, `already-refused`
4/4 → 3/4, `string-near` 4/8 → 3/8.

Verdict unchanged: **declined** — and the second run sharpens the reason
rather than merely repeating it. The regression is not a defect the next model
fixes; semantic closeness *is* the failure mode, so a stronger model fails
harder. The one lever neither run has tried: `gemini-embedding-2` dropped the
fixed `taskType` parameter for free-form task instructions carried in the
content itself, so "two products of one vendor are different things" is now an
expressible objective. A third run is a probe edit, not an argument.

### The privacy constraint, which is binding regardless of the numbers

[../insights.md](../insights.md) guarantees, with
`insight-narrative.component.spec.ts`'s `'never sends anything a person typed'`
behind it:

> Never sent: transaction ids, **descriptions**, notes, receipt URLs, locations,
> or individual transaction dates.

`computeRecurringGroups` runs on the Insights tab — the exact surface that
sentence describes — over normalized merchant descriptions. Normalization strips
punctuation and case, not meaning: `normalizeMerchant('Dr Smith Psychiatry')`
is `'dr smith psychiatry'`. There is no k-anonymity in it.

So an embedding seam here would have reversed a spec-enforced promise, and that
rewrite would have had to land in the same commit. This is recorded even though
the measurement declined the seam on its own, so a future attempt starts from
the real constraint rather than rediscovering it. **Whose data is in the
developer's account is irrelevant to this** — the guarantee is one the app makes
to whoever runs it. That the test account holds fabricated data is why running
the *probe* is unproblematic, and it changes nothing about the shipped promise.

### The alternatives that were rejected

- **Shipping the seam anyway on the F1 delta.** The delta is real and large.
  It is also an average over families that behave oppositely, and the family it
  damages is the one recurring detection is built on.
- **Tuning the threshold to protect `same-vendor`.** The sweep is in
  `baseline.json`: no cut-off preserves both. The overlap is semantic, not
  numeric.
- **A hybrid — string ladder first, embeddings only to break near-misses.**
  Genuinely promising and deliberately not attempted here: it needs its own
  corpus and its own bar, and it still faces the privacy reversal above, which
  is the more expensive half. Recorded as the shape a future attempt should
  take rather than as a rejected design.
- **Moving `normalizeMerchant` into the matcher module.** A normaliser is not a
  matcher, and the move churns a spec that pins exact strings.
- **Unifying `normalizeMerchantKey` too.** The third normaliser keys
  `CategoryMemoryService` and `TagMemoryService`, where the merchant key is the
  Firestore document id. Fuzzy lookup there is a data-model change, not a
  predicate swap. Still the gap 0063 recorded.
- **Adding an npm script for the probe.** That is how a manual tool reaches CI
  and spends quota on every pull request.

## Consequences

- Detection and coverage can no longer disagree about what the same merchant
  is, and the empty-key case is honest at the matcher rather than at one caller.
- **`INSIGHT_DETECTOR_VERSION` is not bumped.** The merge is
  behaviour-preserving except for a case no caller reaches, so stored snapshots
  stay valid. 214 existing recurring specs pass unchanged, which is the evidence.
- The clustering path stays pure, synchronous, offline and instant. Nothing in
  recurring detection became AI-gated, which was #296's own third requirement.
- Descriptor drift across scripts and abbreviations remains unsolved. That is
  the cost of declining, and it is a real one: `7-ELEVEN` and `セブン-イレブン`
  still split into two groups.
- `docs/merchant-match-probe/` is committed with its corpus and baseline, so the
  decision can be re-examined against a new model by re-running rather than
  re-arguing.

## Things that only became apparent while building

- **The "two divergent matchers" framing was wrong.** They differed in one
  input pair out of every combination tried. Writing the ADR as "we unified two
  divergent implementations" would have overstated the fix and hidden how small
  the real change was.
- **A batch of 100 contents counts as 100 requests** against the free embedding
  tier, so a 61-pair corpus (105 distinct keys) exhausts the quota in one run
  and a second run in the same window is rate-limited.
- **One fixture label was a claim, not a fact.** `Whole Foods Market` against
  `WHOLEFOODS MKT` was filed under "already matched" and scores 0.667 — just
  under the cut. The probe caught it. A corpus that asserts what the ladder does
  is only as good as its verification of that assertion.
- **The negatives did all the work.** A corpus of positives would have shown a
  +0.2 F1 and shipped a regression. The `same-vendor` and `string-near`
  families exist because they are the failure modes that cost the most, and
  they are the reason this record says no.

## Known gaps

- **The corpus is hand-built, 61 pairs.** Choosing the pairs is choosing part of
  the answer. Every row carries a `family` and a `why` so a reviewer can
  disagree with one row rather than the number, and `--csv` runs the same
  metrics over a real export without recording an unreproducible baseline.
- **Both models measured are general-purpose embedders.** A model whose
  objective separated brand identity from semantic relatedness could plausibly
  clear the bar, and `gemini-embedding-2`'s task instructions are the first
  interface that can even state that objective — untried above. The retirement
  procedure in [../ai-models.md](../ai-models.md) still does not cover this
  file, because no embedding id ships.
- **Embedding scores are not perfectly stable** across model versions, so a
  small future delta should be treated as noise until re-run.
- **The `already-matched` and `already-refused` families are a regression guard,
  not evidence.** They exist so a change to the string ladder shows up in the
  numbers.
