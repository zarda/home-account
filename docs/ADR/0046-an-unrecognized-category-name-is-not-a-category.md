# 46. An unrecognized category name is not a category

**Status:** Accepted, implemented · **Date:** 2026-08-15 · **Issues:** #300

Closes a known gap of [0045](0045-a-confidence-grade-names-its-source.md),
whose record of the gap is corrected there. Reference documentation lives in
[../receipt-import.md](../receipt-import.md).

## Context

`matchCategoryName` answers two questions about whatever a model called a
category: which catalog id it resolves to, and whether anything actually
matched. Its `matched: false` exists, per its own doc comment, so callers
"can tell a model that deliberately answered 'Other' from one whose answer we
failed to understand" — and `mapCategoryNameToId`'s comment tells callers to
reach for it "where an unresolved name has to be handled differently from a
genuine 'Other'". docs/receipt-import.md promised the same thing in prose: a
name that matched nothing is distinguishable from a deliberate Other.

Nothing kept the promise. Every extraction call site — the shared statement
and multi-image normalizers in the provider base, and Gemini's
receipt-summary and receipt-items overrides — went through
`mapCategoryNameToId`, which keeps the id and drops the flag. Across `src/`,
`matchCategoryName` had no caller outside the util and its spec. An
off-vocabulary answer ("Zeugs", a language the shipped names do not cover, a
compound the keyword map misses) came out as the string `other_expense`: a
real catalog id, truthy everywhere it is later tested.

Two consumers keyed on that truthiness. The import mapper read a truthy
`category` as "extraction named a category" and graded it 0.8 — after ADR
0045 made that grade mean something, the unrecognized answer became exactly
what keeps a row in the high band while a merely absent one drops to the
review floor. And the multi-image path's precedence (`original.category ||
t.suggestedCategoryId`) let the truthy catch-all override the answer the
categorization ladder or the user's own category memory had produced —
discarding a better suggestion in favour of Other, at a confidence the
catch-all never earned.

ADR 0045 recorded this site in its known gaps, but with the wrong mechanism —
"a free-text name assigned to `suggestedCategoryId` without catalog
resolution". Reading the sites for #300 showed the resolution exists at every
one of them; the matched flag is what was being lost. The bullet is corrected
there.

## Decision

**An extraction row carries a category only when the model's answer resolved
to the catalog.** A protected `matchedCategoryId` on the provider base
delegates to `matchCategoryName` and returns the id only when `matched`;
the four extraction row sites use it, so an unrecognized answer arrives
downstream as `undefined`. Both consumers already handle `undefined` the
right way: the mapper defaults it to the catch-all at the 0.3 review grade,
and the multi-image precedence leaves the ladder's answer standing. A
deliberate "Other" still matches by name and keeps its id and its grade.

`parseReceipt`'s `suggestedCategory` stays on `mapCategoryNameToId`,
deliberately: the verify screen wants a concrete preselection to render, and
the user reviewing every field is the review step on that path.

### The alternatives that were rejected

**Resolving at the mapper instead of the extraction seam.** The mapper would
re-resolve what four normalizers already resolved, needs the provider's
translation context it does not have, and would still leave the multi-image
precedence reading a truthy catch-all — the clobber is upstream of the
mapper.

**Passing the matched flag through the row shape.** Widening
`ExtractedTransaction` with a second field for one consumer, when `undefined`
in the existing field already says precisely "extraction did not name a
category we understood".

**Keeping the coercion and re-matching in the mapper to pick the grade.**
Does the resolution twice, and fixes only the grade — the multi-image
override of the ladder's answer survives it.

## Consequences

- A statement, single-image or multi-image row whose category answer matches
  nothing now imports on the fallback category at the review grade and counts
  toward the needs-review warning, instead of arriving as a confident Other.
- On the multi-image path, an unrecognized name no longer discards a
  remembered correction or a grounded model answer; a resolved id still does,
  which is the documented precedence, now pinned by a spec from the
  consumer's side.
- The OpenAI pin that expected the coerced catch-all expects `undefined`
  now, with the contract's three generations — passed through as written,
  coerced to the catch-all, kept only when matched — recorded in its comment.

## Known gaps

- A *matched but wrong* name still wears the extraction-named grade: a model
  that answers a plausible wrong category is indistinguishable from a right
  one at this seam, by construction.
- The keyword last resort inside `matchCategoryName` is English-only; an
  off-locale free-text answer relies on the shipped display names.
- The verify-screen path keeps a definite preselection by design; if that
  screen ever grows a confidence indicator, it will need the flag too.
