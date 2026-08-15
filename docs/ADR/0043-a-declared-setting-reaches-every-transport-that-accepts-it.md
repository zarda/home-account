# 43. A declared generation setting reaches every transport that accepts it

**Status:** Accepted, implemented · **Date:** 2026-08-14 · **Issues:** #263

Amends [0025](0025-provider-variation-lives-in-the-transport-seam.md). Reference
documentation lives in [../prompts.md](../prompts.md) and
[../ai-models.md](../ai-models.md).

## Context

[ADR 0005](0005-prompt-registry-and-provider-parity.md) moved temperature, token
budget and expected response kind onto the prompt, because they describe the
task rather than the provider. The drift it was closing is recorded in its own
words: Gemini categorized at `temperature: 0.05` while the other two sent no
temperature at all.

The field moved. The transports did not. `RenderedPrompt.temperature` is
required and all thirteen prompts set one, but only `GeminiService` put it on
the wire. `ClaudeService` and `OpenAIService` built their request envelopes from
the token budget, the system string and the messages, and dropped it.

The doc comment above the field described the bug in the past tense while it was
still true.

The effect was reachable and not decorative. Claude is in the provider picker
and in the automatic fallback order, so a user can land on it without choosing
it, and the extraction prompts that ask for 0.05 do so precisely because they
want a deterministic JSON answer. Nothing in the suite could see it:
`check-prompts.mjs` had no notion of generation settings,
`prompt-registry.spec.ts` only range-checked the declared value, and
`provider-prompt-parity.spec.ts` read prompt *text* out of each captured request
and looked at nothing else. Across all of `src/`, no spec asserted any envelope
field on any provider.

The issue proposed the obvious one-line fix: add `temperature:
rendered.temperature` to both `messages.create` calls.

That fix does not ship. The installed `@anthropic-ai/sdk` (0.104.1) marks the
field `@deprecated` in `resources/messages/messages.d.ts`:

> Models released after Claude Opus 4.6 do not support setting temperature. A
> value of 1.0 of will be accepted for backwards compatibility, all other values
> will be rejected with a 400 error.

`top_p` and `top_k` carry the same notice. Two of the three ids in
`CLAUDE_MODELS` are past that line — `claude-opus-4-8`, and `claude-sonnet-5`,
which is `DEFAULT_CLAUDE_MODEL`. So the proposed change would have converted a
silent, harmless omission into a hard failure on every Claude request under
untouched settings. `@deprecated` produces an editor strikethrough and nothing
else: no lint rule covers it and `tsc` does not fail on it, so it would have
shipped green.

OpenAI is a different shape of the same problem. The Responses API rejects an
explicit temperature for the GPT-5 family, and every id in `OPENAI_MODELS` is
GPT-5 — so there is no model in that catalog to send one to. The omission was
correct. It was also completely undocumented: no comment in the file mentioned
temperature at all, which is why #263 was filed against it as a defect.

## Decision

**A transport sends the declared sampling settings to every model that accepts
them, and where none does, the exemption is named where a reader will look.**

`AIModelOption` gained an optional `acceptsSampling` flag, and
`acceptsSampling(modelId)` reads it. `ClaudeService.samplingParams` consults it
and spreads `temperature` into both `messages.create` calls when the selected
model takes one. Today that is `claude-haiku-4-5` and nothing else.

Three things about the shape.

**The flag lives in the catalog.** `config/ai-models.ts` is already the single
source of truth for which models the app offers,
[ADR 0041](0041-a-retired-model-id-migrates-once.md) having made that explicit,
and it already carries the maintenance duty of being checked against the
vendors' published lists. Whether a model accepts sampling is the same kind of
fact as whether it still exists, and it is re-checked in the same pass.

**Unknown ids answer false.** A model the catalog has not been told about is
either brand new or one a user's stored preference kept alive past a refresh —
storage outranks the catalog by design, per 0041 — and in both cases omitting
the parameter degrades to the provider's default rather than failing the request
outright. That is also exactly what every adapter but Gemini did before the flag
existed, so the unsafe direction is the one that requires a deliberate edit.

**One helper, spread into both envelopes.** Not a literal in each. The vision
and text envelopes are edited independently, and a parameter present in only one
of them is how this class of bug starts. It mirrors what `generationConfig`
already does for Gemini.

`topP` stays out of scope. `prompt-inputs.ts` marks it Gemini-only and the other
adapters ignore it; quietly widening the change would have been a second
decision wearing the first one's clothes.

### The alternative that was rejected

**Recording Claude as a named exemption alongside OpenAI, and changing no
behaviour.** The argument for it is real and worth stating, because this record
exists partly to say it was heard: sending the same prompt at 0.05 on Haiku 4.5
and at the provider default on Sonnet 5 means one task samples differently
depending on which entry the user picked in a dropdown. That is
provider-dependent generation settings — the precise drift ADR 0005 abolished,
reappearing one level down as model-dependent settings.

The exemption route was rejected in favour of honouring the declared value where
the model permits it. The accepted cost is that divergence, recorded here so a
later reader knows it was chosen rather than overlooked. Anyone revisiting this
should weigh whether pinning a single Claude model, or dropping the ones that
reject sampling from the catalog, is the better answer.

### What is asserted, and where

`provider-prompt-parity.spec.ts` gained envelope helpers beside its existing
prompt-text helpers, and a describe that drives all three providers through one
task: temperature reaches Gemini, reaches Claude on a model that accepts
sampling, is absent on both post-4.6 Claude ids, and is absent on OpenAI with
the reason in the test name. Both Claude transports are covered, so an edit to
one cannot silently regress the other. The token budget is pinned in the same
place — unlike temperature it is accepted everywhere, so a provider dropping it
is always a bug.

`check-prompts.mjs` gained a `SAMPLING_EXEMPT` table following the convention
0005 set for `SINGLE_PROVIDER`: an entry names the reason, so closing a gap
means deleting a line. A provider file must either read `rendered.temperature`
or appear in that table. It is checked in both directions — a silent omission is
how this shipped, and a stale exemption is how the next one would.

The checker was chosen over relying on the spec alone because a spec covers
today's three adapters; the guard also catches a *fourth* adapter that quietly
drops the setting. Its limits are stated in its own header rather than implied:
it proves a file reads the field or declares an exemption. Only the parity spec
proves the value reaches the wire, and on which models.

## Consequences

Claude on Haiku 4.5 now extracts receipts and categorizes at the temperatures
those tasks ask for. On Sonnet 5 and Opus 4.8 nothing changes on the wire — but
the reason is now written down in three places a reader might land: the
transport, the catalog, and the prompt-registry doc comment that previously
asserted a parity it could not deliver.

The catalog carries one more hand-maintained fact, with the failure mode that
implies. A model whose flag is wrong in the permissive direction fails every
request against it; wrong in the restrictive direction, it silently samples at
the provider default. The default-to-false rule keeps the second, cheaper
failure the one that happens by omission.

ADR 0025's body is not edited. Its "What stays divergent, on purpose" list still
reads "Three things", and its line-count table still reports the file sizes it
was written with. Both were true then, and `docs/ADR/README.md` is explicit that
a record is not maintained as the code changes. Only its status line points here.
ADR 0005 is not touched at all.

## Known gaps

**Nothing in the repo can verify the flag against a live API.**
`provider-prompt-parity.spec.ts` deliberately strips the API key so a local
environment cannot make real calls, and `cloud-llm-provider.smoke.spec.ts` exists
to prove the injector chain constructs, not to reach a vendor. The split at Opus
4.6 rests on the SDK's own type declaration plus a manual check against a real
key before merge. If a vendor moves that line, the first signal will be a user's
400.

**`acceptsSampling` is one flag for three parameters.** Vendors have been
withdrawing `temperature`, `top_p` and `top_k` together, so a model that rejects
one rejects the family, and modelling them separately would be inventing a
distinction nobody has drawn yet. If one vendor splits them, this becomes three
flags — or a small capability object — and that is a cheaper change than
guessing at it now.
