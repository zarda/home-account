# 49. The model never sees an i18n key

**Status:** Accepted, implemented · **Date:** 2026-08-16 · **Issues:** #270

Reference documentation lives in [../receipt-import.md](../receipt-import.md).

## Context

The on-device receipt pipeline handed Apple's foundation model the catalog's
stored `name` values as its category vocabulary. For every default entry that
value is the i18n key — the model chose between `categoryNames.groceries` and
`categoryNames.fuelAndGas` — and its answer was then resolved by a lowercased
equality against those same keys. Only a user-created category, whose name is
the text the user typed, could ever match. A supermarket receipt scanned on an
iPhone with Apple Intelligence landed on "Other" every time; the same receipt
through a cloud provider categorized fine.

The cloud providers documented and solved both halves of this. Their base
class translates names before they reach a prompt (`translateCategoryName`,
whose doc comment names this exact failure), renders the catalog through
`buildCategoryPromptCatalog` — active entries only, translated `id: Name`
lines — and resolves answers through `matchCategoryName`: ids first, then
display names in every shipped locale, then keywords, with a `matched` flag
so an answer nobody understood stays distinguishable from a deliberate
"Other" ([0046](0046-an-unrecognized-category-name-is-not-a-category.md)).
The native path never joined; it also offered deleted categories, flattened
parent and child into indistinguishable entries, and spent a small on-device
context window on 135 raw keys.

The suite saw none of it because the spec fixtured a catalog the app never
builds: display names for `name`, `food_coffee_&_drinks` for an id whose real
shape is `food_coffeeAndDrinks`. Green tests, asserting a world that does not
exist.

## Decision

**The native path uses the same two chokepoints as the cloud providers.**
`parseWithAppleIntelligence` renders its vocabulary with
`buildCategoryPromptCatalog(categories, name => translationService.t(name))`
and resolves the answer with `matchCategoryName`, setting
`suggestedCategoryId` only when `matched`. The spec fixtures the catalog
exactly as `CategoryService` builds it — key-named, camelCase-tailed ids,
an `isActive: false` entry that must not be offered.

The catalog travels as one `id: Name` line per array entry, and the Swift
plugin joins them with `\n` instead of `", "` — display names can contain
commas — and tells the model to answer with the id, the one token in the list
that carries no language. The `@Guide` on the response field says the same.
Nothing depends on the model's obedience: a display name in any shipped
locale still resolves through the matcher.

### The alternatives that were rejected

**Translating in place without the shared catalog.** `categories.map(c =>
t(c.name))` fixes the keys but keeps deleted categories in the list, keeps a
parent and its child ambiguous, and leaves resolution keyed on one locale's
rendering of the names.

**Constraining generation to the id set in Swift.** Enumerating 135 ids in
the `@Guide` duplicates the catalog in a second language and a second file;
the resolver already accepts ids and every shipped locale's names, so the
constraint buys nothing the matcher does not guarantee.

## Consequences

- A receipt scanned on device resolves to the same catalog id the cloud path
  resolves to, whatever language the model answers in.
- A category the user deleted can no longer be resurrected by the model
  choosing it from the list.
- An answer that matches nothing leaves the row's category unset — the 0046
  seam — and the verify screen's concrete preselection still comes from the
  consumers' existing coercion, unchanged.
- The TS payload and the Swift join are a coupled pair: newline-separated
  lines and the id-answer instruction ship together or not at all.

## Things that only became apparent while building

- `check-prompts.mjs` scans `native-receipt.service.ts` only for hard-coded
  currency and language vocabularies. The category catalog is data rather
  than a prompt template, so the checker rightly says nothing — but anyone
  expecting it to police this seam should know it does not.

## Known gaps

- **An unresolved native category still wears Vision's confidence.** The
  row's `confidence` is the OCR character confidence (typically ~0.9) and the
  import consumers grade the category chip from it, so a category that
  matched nothing renders as a high-confidence "Other" rather than the 0.3
  review grade the cloud extraction paths earn (0045/0046). Untouched here
  because `isUsableResult` keys native→cloud fallback routing on the same
  number; #307 tracks it. Closed by
  [ADR 0051](0051-an-uncategorized-row-is-graded-where-it-is-coerced.md), #307.
- **Income categories are offered for receipts.** `buildCategoryPromptCatalog`
  filters activity, not type — the same list the cloud categorizer sends. A
  type filter would be a shared-helper decision, not a native-path one.
- **The whole catalog rides in every scan's instructions.** The active,
  structured rendering is smaller than the raw dump it replaces, but it still
  grows with the user's catalog on a small context window.
