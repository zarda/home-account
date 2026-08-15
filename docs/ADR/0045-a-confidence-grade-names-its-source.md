# 45. A confidence grade names its source, and the CSV import asks the real categorizer

**Status:** Accepted, implemented · **Date:** 2026-08-15 · **Issues:** #258

See [0011](0011-the-csv-file-is-a-contract.md) for the CSV contract and
[0005](0005-prompt-registry-and-provider-parity.md) for the prompt registry.
Reference documentation lives in [../csv-format.md](../csv-format.md) and
[../prompts.md](../prompts.md).

## Context

Three dishonesties compounded on the import wizard's CSV path.

The field mapper stamped `categoryConfidence: 0.8` on every row it converted,
whether or not extraction had named a category. CSV rows never carry one — the
Category column deliberately does not round-trip
([ADR 0011](0011-the-csv-file-is-a-contract.md)) — so `importFromCSV`
defaulted every row to the catch-all and presented a full page of
high-confidence chips. The chip bands make 0.8 exactly the high band, and the
needs-review warning counts rows under 0.5, so the warning was unreachable on
this path: an import in which nothing was categorized reported an average
confidence of 0.8 and no warning at all.

The wizard's status read "Categorizing with AI..." while this happened. No
model was called and no memory was consulted; the string described a step that
did not exist.

And the one real batch call, used by the multi-image path, sent every row in a
single request against a prompt that declares `maxOutputTokens: 800`. One
answer entry costs roughly 25-30 tokens, so a long batch truncated the answer
array, failed the JSON parse, and defaulted the entire batch to the 0.1 floor
— a paid request whose only product was a page of review flags.

The graded contract already existed one file away. `applyCategorizations`
documents it — no entry 0.3, invalid id 0.3, valid id without usable
confidence 0.8 — and the mapper's flat 0.8 contradicted it.

## Decision

**The mapper grades by evidence:** `t.category ? 0.8 : 0.3`, the same two
values the `applyCategorizations` contract assigns to "extraction named a
category" and "nothing usable answered". This is the chokepoint for the
image, PDF and CSV paths at once — a statement row the model did not
categorize now shows the review flag instead of a high chip it never earned.

**The CSV path climbs the real ladder.** The multi-image path's
categorization — remembered corrections first at `CATEGORY_MEMORY_CONFIDENCE`
(0.95), one grounded batch call for the rest when a provider is configured, a
0.1 review-flagged floor for what no one could answer — is extracted into
`categorizeWithLadder`, and `importFromCSV` overlays its answers onto the
field-mapped rows. CSV rows never carry an extraction category, so the
overlay cannot fight the mapper's suggestion. With no provider configured the
rows keep the floor and the import finally produces the `low_confidence`
warning. The status string becomes "Categorizing transactions...", which is
true whichever rung answers.

**The batch call is chunked at `CATEGORIZE_CHUNK_SIZE = 25`.** Each chunk is
its own request with indices re-based from zero — `applyCategorizations`
matches answers by position within what was sent — and its own fallback, so a
failed or truncated chunk degrades 25 rows, not the import. Chunks run
sequentially, and the catalog and grounding are re-sent per chunk; that is
the price of keeping every answer inside the declared budget.

### The alternatives that were rejected

**Honest grades only.** The issue's minimal remedy — stamp 0.3 and stop
claiming an AI step — leaves categorization on the floor when a provider is
configured and the machinery to use it already exists. Making the claim true
was chosen over deleting the claim.

**Raising `maxOutputTokens` instead of chunking.** A bigger budget moves the
cliff without removing it, and the declared budget is part of the prompt's
recorded envelope across all three providers.

**Parallel chunk requests.** Sequential requests keep the per-provider rate
behaviour of one import gentle and the request order deterministic; an import
is a background step, not a latency-critical path.

**Changing the multi-image precedence.** That path prefers the extraction's
own category over the ladder's answer while reporting the ladder's
confidence. It is a real wrinkle, but it predates this work and touching it
here would change image-import behaviour under a CSV issue; it is recorded
below instead.

## Consequences

- Provider-less and offline CSV imports land every row at 0.1, drop the batch
  average under 0.5, and produce the warning — the honest version of what was
  previously a page of green chips.
- Statement, PDF and image rows without an extraction category drop from 0.8
  to 0.3 and now show the review flag; `low_confidence` warnings will appear
  on paths that never produced them before. That is the fix observable, not a
  regression.
- A CSV import with a provider configured costs one model request per 25 rows,
  grounded like the image paths, with remembered merchants excluded from the
  request entirely.
- An empty batch sends no request at all; previously it sent one zero-row
  request.

## Known gaps

- `ImportResult.warnings` still has no UI consumer — the `low_confidence`
  warning exists on the result object and in specs, and nothing renders it.
- The multi-image precedence mismatch stands: an extraction-carried category
  overrides the ladder's id while the ladder's confidence is reported.
- On the mapper path an extraction-carried `category` is a free-text name
  assigned to `suggestedCategoryId` without catalog resolution, so an
  unresolvable name can still wear 0.8. Adjacent to this issue, not part of
  it; it wants its own issue.
- Settings → Import CSV (the data-management door) still files every row
  under the catch-all per ADR 0011 — the ladder runs only on the wizard path.
- The wizard's status strings remain raw English signal values throughout the
  service, invisible to the i18n checker.
- The chunk size is a sizing heuristic against worst-case answer entries, not
  a measured tokenizer count.
