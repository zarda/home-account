# 66. An answer's budget follows its question, and a cut-off answer is read as far as it goes

**Status:** Accepted, implemented · **Date:** 2026-08-24 · **Issues:** #331

Applies to the receipt prompts registered by
[0005](0005-prompt-registry-and-provider-parity.md), whose `maxOutputTokens`
is a property of the task rather than of the provider. The failure class it
adds is recorded through the attempt record
[0065](0065-an-attempt-is-recorded-where-it-runs.md) put in place. What each
door surfaces is in [../receipt-import.md](../receipt-import.md) under
*Failure surfacing*.

## Context

Importing a receipt from several photos failed with the JSON parser's own
sentence — `JSON Parse error: Expected ']'` on iOS, `Expected ',' or ']'
after array element` on Chrome — and imported nothing.

Three separate decisions had to line up for that to happen.

- **The budget did not follow the question.** `renderMultiImageReceipts`
  declared a flat `maxOutputTokens: 4000` while being handed `imageCount`,
  which it spent on prose only. The answer, meanwhile, grows with every
  photo: one JSON object per line item across all of them, plus one full
  `receiptDetails` reproduction per receipt group. Measured against the row
  the prompt's own example declares, a row costs ~69 tokens in ASCII and ~92
  in Japanese, and the reproduction costs roughly a line per item again. A
  40-item Japanese receipt is ~4260 tokens of answer on its own — over the
  ceiling before a second photo is considered. The path is reached precisely
  when a receipt is too long for one photo, so the budget was tightest
  exactly where the answer was longest.
- **Truncation was detected and then dropped.** Every transport already
  computes `ProviderResponse.truncated` — `stop_reason === 'max_tokens'` on
  Claude, `incomplete_details.reason` on OpenAI, `finishReason` on Gemini —
  and the only consumer was Gemini's prose trimming. No JSON path read it.
- **The failure had no class.** `parseAIError` classified rate limits, auth,
  network, quota, server and timeout by substring, and a `SyntaxError` matched
  none of them, so it fell through to the unknown branch, whose message is
  the raw text: `AI processing failed: <whatever the parser said>`.

The same shape had already been decided once, on the categorization path:
`CATEGORIZE_CHUNK_SIZE = 25` exists because "past the cap the array truncates,
the parse throws". That remedy — chunk the request until the answer fits — is
not available here. Splitting the photos across requests is what the
multi-image prompt exists to avoid: the model is asked to reconcile the
overlapping edges of photos of one receipt, and a model that sees one photo
per request cannot deduplicate against a photo it was never shown.

## Decision

**Three layers, in the order the failure travels.**

1. **The budget scales with the photo count.** `multiImageAnswerBudget(n)` is
   `min(8000, 2500 + 1500n)`: one photo keeps exactly the 4000 it had, and
   each further photo buys room for roughly the rows it adds.
2. **A cut-off answer is read as far as it goes.** `parseModelJsonArray`
   closes the array after the last element that arrived whole and keeps those
   rows, reporting that it had to. It repairs nothing else — no quote
   balancing, no completing a half-written row — because a row cut in the
   middle is a row nobody can vouch for. The prose equivalent,
   `dropIncompleteTrailingLine`, has made the same trade since the insights
   work.
3. **What is left is named, not quoted.** `incomplete` joins the failure
   classes: an answer that was cut short or was never the list the prompt
   asked for. It is the one failure class the app can act on itself — it
   means the answer outgrew the budget its prompt declared.

**The ceiling is an assumption, and is written down as one.** Nothing in the
app knows any model's real output limit; `config/ai-models.ts` records
sampling support and nothing else. A `max_tokens` above a model's own cap is
a 400 on the OpenAI and Claude transports, which would trade a truncated
answer for no answer at all. 8000 is chosen to sit under the lowest cap the
configured vision models are assumed to have, and is measured against a live
model rather than trusted: `gemini-3.5-flash-lite` accepted a four-photo
request at that budget on 2026-08-24 (HTTP 200, `finishReason: STOP`).

**Salvage is confined to the receipt paths.** Categorization and tag
suggestion keep parsing directly: they already chunk to fit their declared
budget and degrade one chunk at a time through `runOrDefault`, so a short
answer there costs a fallback category rather than rows the user can see
missing.

**The report is a signal, not a wider return type.** `answerIncomplete` sits
beside `lastError` on the provider base and is cleared by `run` at the start
of every operation. The fact describes the answer, not any row in it — and
the rows it is about are exactly the ones that never arrived, so there is
nothing in the returned array to carry it. Widening the return type would
also have rewritten every one of the ~30 existing stubs of
`extractTransactionsFromMultipleImages` to say nothing new.

## Consequences

- A long receipt now imports the rows the reader finished instead of nothing,
  and the review step says items may be missing rather than presenting a
  short receipt as a complete one.
- The group that lost its tail also lost the printed total, which the prompts
  ask for on a group's last item. `consolidateReceiptItems` therefore falls
  back to the item sum at `REVIEW_AMOUNT_CONFIDENCE` and the review table's
  verify chip already fires on the amount — the notice explains a flag that
  was going to be raised anyway.
- `incomplete` is enumerated in four places that must agree: the
  `AIErrorInfo` union, `ReceiptFailureClass`, the `receipt_import.failure`
  values in `analytics-events.json`, and `firestore.rules`. The rules copy is
  the dangerous one: a value the app writes and the rules do not list is
  refused, and a refused attempt record simply never appears.
- The classification branch sits *above* the substring ladder. A `SyntaxError`
  names the character offset it gave up at, so `in JSON at position 502`
  matches the `502` in the server branch — a truncated answer would otherwise
  have been reported to the user as a service outage.

## Things that only became apparent while building

- **The two engines word the same failure differently.** JavaScriptCore says
  `Expected ']'` and V8 says `Expected ',' or ']' after array element`, which
  is why the bug report and the codebase's own memory of it do not match
  textually. Both are pinned in `ai-error.utils.spec.ts` so the class cannot
  regress on one platform while passing on the other.
- **A greedy bracket match is worse than no match on a truncated answer.**
  `extractJson` matches to the *last* bracket in the text, and in a cut-off
  receipt answer that bracket is often inside a `receiptDetails` string — so
  what reached `JSON.parse` was not merely short, it was cut at an arbitrary
  point inside a value.
- **The wizard's own unit spec cannot see the review step.** It overrides the
  component template with a bare `<div>`, so the notice is pinned in
  `import-wizard.smoke.spec.ts`, which renders the real template with a real
  stepper.

## Known gaps

- **The in-form scan says nothing.** The strategy path keeps the salvaged
  rows and grades the amount for verification, but has no review table on
  which to explain why. A receipt scanned from the form can therefore come
  back short with only the verify chip to show for it.
- **Nothing retries.** A budget raise plus salvage makes truncation rarer and
  survivable, but the app never re-asks with more room. Re-sending the photos
  is the expensive half of the request, and the import already runs against a
  90-second ceiling.
- **The ceiling is verified for one model, and cannot be verified in CI.**
  The 2026-08-24 probe covers `gemini-3.5-flash-lite`, the model whose cap is
  assumed lowest; OpenAI and Claude are inferred from their published limits,
  not measured, because no key for either exists locally. Only a live request
  can settle it and CI has no provider keys, so this stays a manual check —
  like `docs/model-probe`, and for the same reason.
