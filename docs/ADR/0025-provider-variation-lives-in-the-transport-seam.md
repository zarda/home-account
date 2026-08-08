# 25. Provider variation lives in the transport seam

**Status:** Accepted, implemented · **Date:** 2026-08-08 · **Issues:** #200

Reference documentation lives in [../prompts.md](../prompts.md).

## Context

[0005](0005-prompt-registry-and-provider-parity.md) pulled the prompts out of
the three provider services and stated the contract they all satisfy. It left
the services themselves alone: `gemini.service.ts` at 1454 lines,
`claude.service.ts` at 858, `openai.service.ts` at 815, each implementing the
same twenty-one operations.

A diff of the two smaller files showed how little was actually different.
Outside the transport they were mechanically identical — the 230-line prologue
of `generateSpendingSummary` that groups, converts and renders every section
was byte for byte the same, and so was `extractJson`. What differed across all
their shared methods came to four things: the sentence thrown when there is no
client, the shape of the SDK call, how the answer is pulled out of the
response, and the console prefix.

Copies drift, and these already had. 0005 lists six ways the prompts had
diverged before anything compared them; #183 then found the same thing in the
error handling, where one provider answered a failed extraction with an empty
array while the others threw — so a bad API key rendered as "no transactions
found" and the strategy layer had no throw to fall back on. #183 fixed the
convention by writing the same catch block three times, which is the shape of
the problem rather than a fix for it.

## Decision

**Every operation is written once, in `CloudLLMProviderBase`, and each provider
supplies only its transport.** `sendText` and `sendVision` are the entire seam:
the SDK call, the `renderedText` strategy that provider needs, and digging the
answer back out. Above them nothing knows which provider is answering. The base
also owns the bookkeeping — `run()` sets `lastError`, logs once and rethrows;
`runOrDefault()` logs and answers with the caller's own fallback — so #183's
convention is one block instead of three. Rejected: composition, with three
delegate objects behind one service. It moves the same seam behind an extra
layer of wiring and gains nothing, because the thing being isolated is a method
pair either way.

**The three services stay three classes.** Rejected: merging them into one
service keyed by provider name. That reads as the obvious simplification and it
would destroy the confinement the whole check rests on: the eslint rule in
`eslint.config.js` allows `@google/generative-ai`, `openai` and
`@anthropic-ai/sdk` to be imported by exactly three files, which is what makes
`prompts:check` able to claim it has seen every call site. One file importing
all three SDKs cannot be constrained that way. The base is the proof of the
same property from the other side: it imports no SDK, and cannot, so nothing in
it can reach a model except through a seam a provider implements.

**The prompt id is passed to the seam.** Transport can legitimately depend on
the task, and pretending otherwise would have meant either changing behaviour
or inventing a second seam. Gemini retries the three insights prompts and no
others; it routes the receipt prompts to the text handle first and the
statement prompt to the vision handle. Rejected: a boolean flag per call site,
which is the same coupling with the reason left out.

**A prompt rendered in the base counts as reaching all three providers.**
`scripts/check-prompts.mjs` scans the base alongside the three services and
expands a shared call site to all three, because that is what the class
guarantees. Two new failures come with it: a prompt rendered in the base *and*
in a provider file, where one of the two must be drift and the checker cannot
tell which, and a `SINGLE_PROVIDER` exemption claimed by a prompt the base
renders — an exemption says only one provider can do this, and a file every
provider inherits is the one place that cannot be true of. Both have self-test
fixtures, which run before the real check. Rejected: listing the base as a
fourth provider, which would make the parity rule read "reaches four providers"
and quietly stop asserting anything about the three that exist.

## What stays divergent, on purpose

Three things did **not** move, and each is a property of a model rather than of
a task — the same distinction 0005 drew when it kept the JSON-only preamble in
Gemini's adapter instead of writing it into the prompts.

- **`renderedText`.** Gemini folds `system` into the user turn and prepends the
  JSON preamble; OpenAI folds `system` in without one; Claude passes `system`
  as a top-level parameter and leaves the user turn alone. 0005 decided this
  deliberately, and it holds.
- **Gemini's rate-limit retry and its second model handle.** It is the only
  provider with separate text and vision models, so it is the only one where
  "which model reads this image" is a question. The receipt paths try the text
  handle and fall back to the vision handle on a rate limit; the statement path
  uses the vision handle only, because that is the model the user chose to read
  images with. Routing it anywhere else would silently change which model reads
  their bank statement.
- **Gemini's `extractJson` and its prose post-processing.** Its models narrate
  ahead of the JSON, so it counts brackets where the others take a greedy
  match; Gemma drafts several attempts before its final answer, and in CJK
  locales the English sentences left in a reply are draft commentary. What has
  to be stripped depends on the task, which is why `postProcessProse` takes the
  prompt id.

Gemini also keeps its own `extractTransactionsFromImage`: it answers a single
photo with the receipt-summary prompt rather than the statement prompt, and
that call site staying in `gemini.service.ts` is what keeps the
`receiptSummary` exemption pointing at a concrete file.

## Deliberate unifications

Four differences were removed rather than preserved. Each was one provider
having drifted, not a decision anyone made.

- **The statement reader resolves a row's category name against the catalog on
  every provider.** Only Gemini did. The import flow reads that field as a
  category id, so a row OpenAI labelled "Groceries" arrived as a category that
  does not exist. The OpenAI spec asserted the raw value and now asserts the
  resolved one.
- **Claude trims its summary and advice** before returning them. It was the
  only provider that did not.
- **Gemini falls back to the same sentence as the other two** when a model
  answers a summary or an advice request with nothing, instead of returning an
  empty string.
- **A failed summary or advice records `lastError`,** like every other
  rethrowing operation. Two of the three did not, which is why "the providers
  fail identically" could not be asserted before.

## Consequences

The four files come to 1935 lines against 3127 in three, and the 1192 lines
that went were duplicates rather than logic:

| File | Before | After |
|---|---|---|
| `gemini.service.ts` | 1454 | 824 |
| `claude.service.ts` | 858 | 209 |
| `openai.service.ts` | 815 | 191 |
| `cloud-llm-provider.base.ts` | — | 711 |

OpenAI and Claude are now short enough to read in one screen each, and what is
left in them is exactly the transport. Gemini is still the largest by a wide
margin, and correctly so: the retry, the second model handle, the two JSON
readers and the reasoning filters are all genuinely its own.

`provider-error-parity.spec.ts` is #200's acceptance criterion as an assertion:
an invalid key, a rate limit and a model answering in prose, each checked on
all three providers. It is the counterpart to `provider-prompt-parity.spec.ts`
— one proves they send the same thing, the other that they come back the same
way when nothing works.

## Things that only became apparent while building

The base reads its three collaborators through `inject()` in field
initializers, which is legal only inside an injection context. Every unit spec
supplies those as jasmine doubles, so all of them would keep passing if the
real chain behind them could not be constructed at all — and it is not a short
chain. `cloud-llm-provider.smoke.spec.ts` builds the three providers through a
real injector against the emulators for that reason, and covers the two members
the façade calls that are not on the adapter interface: Gemini's `clear()` and
the two model switches. Nothing would fail to compile if either were dropped.

`extractTransactionsFromImage` could not simply move. Gemini answers it with a
different prompt and a different response shape, so the base holds the OpenAI
and Claude behaviour — one image read as a one-row statement — and Gemini
overrides it. That is also what keeps its `SINGLE_PROVIDER` exemption honest.

## Known gaps

- `requestOptions` is still written in all three services. OpenAI's and
  Claude's are identical; Gemini's returns the SDK's own `SingleRequestOptions`
  type, which the base cannot name without importing an SDK — which is the one
  thing it must not do.
- `postProcessProse` switches on the prompt id inside the Gemini adapter. It is
  honest about what the code does, but a fifth prose prompt will need a case
  added there, and nothing fails if one is forgotten.
- The base is 711 lines and will keep growing with the operation count. If it
  becomes uncomfortable, the split to reach for is by feature — receipts,
  categorization, insights, search — and not back towards per-provider files.
