# 53. A resolver answers with a category that still exists

**Status:** Accepted, implemented · **Date:** 2026-08-17 · **Issues:** #310

Extends [0046](0046-an-unrecognized-category-name-is-not-a-category.md), whose
`matched` flag this makes honest, and closes a known gap in
[0051](0051-an-uncategorized-row-is-graded-where-it-is-coerced.md). Reference
documentation lives in [../receipt-import.md](../receipt-import.md).

## Context

`matchCategoryName` resolves a model's category answer in three passes — the
catalog id, then display names in every shipped locale, then English keywords
for free-text answers like "gas station". Only the first checked whether the
category was still active.

The catalog those passes searched is the merged one, and a deleted built-in is
not absent from it: `CategoryService.mergeCategories` keeps the user's stored
override in the list with `isActive: false`. So an answer naming a category
the user had removed resolved onto it, with `matched: true`, and the receipt
was filed there at full extraction confidence.

Nothing about that looked wrong. The review chip's name lookup reads the
*unfiltered* catalog, so the deleted category rendered under its real display
name, indistinguishable from an ordinary suggestion.

The keyword pass had a wider version of the same hole. It returned its mapped
id outright, with no catalog lookup at all, so it could answer with a category
this account never had — and that one *was* visible, as the chip's "Unknown".

`buildCategoryPromptCatalog` filters on activity, so a deleted entry is never
offered in the prompt. That is why filtering the id pass alone looked
sufficient and why this survived [0049](0049-the-model-never-sees-an-i18n-key.md):
the only way to reach a deleted category is for the model to answer from its
own knowledge rather than echoing the offered list — which is exactly what the
locale and keyword passes exist to catch. 0049's consequence, "a category the
user deleted can no longer be resurrected by the model choosing it from the
list", is true as written and reads more broadly than it was.

The suite could not see it. The spec asserted that an inactive catalog *id* is
ignored, which passes on the id pass; no case answered with an inactive
category's *name*. Worse, two cases asserted the defect: they resolved
keywords against an empty catalog and expected an id back, and one of them was
titled "maps keywords to catalog IDs that actually exist by default" while
being structurally unable to check that.

## Decision

**Every pass answers with an entry that is in the account's catalog and
active, or does not answer at all.** The name passes search the active
entries, and the keyword map's ids are resolved against the catalog like any
other answer rather than trusted because they are compiled in.

That makes the guarantee statable, and it is the point of the change: a caller
receiving `matched: true` may file a row under the id without checking it
again, and one receiving `matched: false` knows nothing understood the answer
rather than that the answer was "Other". `mapCategoryNameToId` delegates here,
so it inherits the same behaviour.

An answer that now matches nothing falls through to `matched: false`, which
[0051](0051-an-uncategorized-row-is-graded-where-it-is-coerced.md) grades for
review at the import seam. The deleted-category answer therefore does not
become a silent misfiling *or* a confident "Other" — it becomes a row the user
is asked to look at.

### The alternatives that were rejected

**Dropping inactive entries in `mergeCategories`.** The merged catalog is read
by the category management screen, which has to show a deleted built-in in
order to offer restoring it. The list is right; the resolver's use of it was
wrong.

**Filtering at the call sites.** Three callers reach this, and the next one
would have to know. The resolver is the chokepoint that already exists — the
same argument [0049](0049-the-model-never-sees-an-i18n-key.md) made for
routing the native path through it.

**Dropping the keyword map.** Tempting, since it is a compiled-in guess in
English and the locale passes cover the answers that matter. But it is the
last rung for genuinely free-text answers, and resolving its ids against the
catalog costs nothing and fixes the failure it actually had.

**Leaving the keyword ids unchecked and only filtering the name passes.** That
would close the reported bug and leave the resolver still able to answer with
a category that does not exist, which is the same class and was already
recorded as a known gap under 0051.

## Consequences

- A receipt whose category answer names something the account deleted is
  flagged for review instead of being filed under the deleted category.
- A keyword answer whose mapped id is not in this catalog is flagged for
  review instead of rendering as "Unknown".
- Resolution of active categories is unchanged, by id, by display name in any
  shipped locale, and by keyword.
- One more class of answer now reaches the review band. On an account with a
  heavily pruned catalog that is a real increase in flagged rows, and it is
  the honest count.

## Things that only became apparent while building

- The chip's name lookup reading the unfiltered catalog is what made this
  invisible rather than merely wrong. A deleted category rendered normally; a
  nonexistent one rendered "Unknown". The louder of the two bugs was the
  narrower one.
- The keyword-map spec that had to be rewritten was asserting its own premise:
  with an empty catalog it could only restate the map back to itself. It now
  builds the default ids the way `CategoryService` builds them, so a renamed
  or dropped default is visible to it — which is the check the title always
  claimed.

## Known gaps

- The keyword map is still English-only and compiled in. The locale passes
  cover answers in the shipped languages; a free-text answer in another
  language still reaches only the fallback.
- A category the user deleted and then restored resolves again, correctly, but
  any receipts filed under it while it was deleted were already written and
  are not revisited.
