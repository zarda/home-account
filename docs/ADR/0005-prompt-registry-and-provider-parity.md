# 5. One prompt registry, and a contract the providers must satisfy

**Status:** Accepted, implemented · **Date:** 2026-07-27 · **Issues:** #53, #54, #55, #56, #57, #58, #59

Reference documentation lives in [../prompts.md](../prompts.md). This record keeps
the decisions and the reasoning, including the two places where a choice changed
what the models are actually asked.

## Context

The app talks to three model providers — Gemini, OpenAI and Claude — behind
`CloudLLMProviderService`. Each provider service carried its own copy of every
prompt: eleven tasks, three copies each, kept in step by nothing but discipline.
The façade dispatched to them through a `switch (provider)` per method with no
interface, so the three were duck-typed and a provider missing a method was a
runtime fallthrough rather than a compile error.

The copies had already drifted, and the drift was not cosmetic:

- Only Gemini's receipt prompt asked for `receiptCount`. The transaction form
  reads that field to offer the multi-receipt review, so with OpenAI or Claude
  configured that flow could never trigger — the field was never requested.
- Only Gemini's pattern-narrative prompt carried the language instruction. The
  other two described spending patterns in English whatever locale the app was
  in.
- The spending summary opened with two different sentences, and only Gemini was
  told that every heading must start its own `## ` line — which is what the
  markdown renderer needs.
- Claude's advice prompt was missing the closing instruction that suppresses
  preamble.
- Generation settings were written per call site per provider: Gemini
  categorized at `temperature: 0.05`, the other two sent no temperature at all.

None of this failed. Nothing compared the copies, so nothing could.

Five of the seven issues in this batch needed the *same* prompt change made in
three places, which is what forced the question.

## Decision

**Prompts live in one registry, typed by their inputs.** `src/app/core/prompts/`
holds one definition per task. `PromptInput<K>` is derived from each render
function's own signature, so a missing input is a compile error at the call site
rather than a blank in the rendered text.

**Prompts take pre-rendered strings and nothing else** — never a `Category[]`, a
`Transaction[]`, or an injected service. Callers run the formatting helpers they
already own and pass the results in. This keeps the directory free of Angular
DI, lets its spec run without TestBed, and means no raw user record can reach
the prompt layer. It also preserves `RagContextService`'s pure-transformer
property, established in [0001](0001-tiered-rag-levels.md), rather than
inverting it.

**Temperature, token budget and expected response kind moved onto the prompt,**
because they describe the task rather than the provider.

**Each provider keeps exactly one adapter** for its own quirks: Gemini prepends
the JSON-only preamble and doubles Gemma's budget for prose, OpenAI flattens
`system` into the input, Claude hoists it to the top-level parameter. Nobody
writes "return ONLY valid JSON" for Gemini's benefit again; they set
`expects: 'json'`.

**`CloudLLMProviderAdapter` states the contract** and all three implement it, so
the eleven switches collapse to one lookup and a missing method fails the build.
Providers also declare what they can do — Gemini is the only one that can be
available for text yet unable to see an image, and the only one that takes a PDF
directly.

### TypeScript, not JSON

[0003](0003-analytics-consent-and-taxonomy.md) put the analytics taxonomy in
JSON on purpose, and this went the other way on purpose. That check has to read
the taxonomy's *values* and diff them against a markdown table, which needs
`JSON.parse` from Node. This check needs prompt *ids* and call sites, which a
regex finds in `.ts` just as well. And a prompt in JSON is a `\n`-escaped single
line whose diff is unreadable — which would defeat the point, since prompt
wording is exactly what a reviewer most needs to see change.

### Resolving the drift

Where the three copies disagreed, the fuller variant won. Every difference was
one provider having gained an instruction the others never got, so taking the
superset is the reading that treats each divergence as an improvement someone
made and forgot to propagate. The two consequential ones — OpenAI and Claude now
request `receiptCount`, and now honour the app's locale in narratives — are
behaviour changes, and both are fixes.

The one place this judgement is weakest is the spending summary's opening
sentence: "structured AI Insights" and "a brief, helpful spending summary" are
different instructions, not one improved version of the other. Gemini's won
because the renderer depends on the heading rule that came with it.

## Consequences

`npm run prompts:check` fails the build when a prompt does not reach every
provider, is undocumented, is unasserted, or when a service grows a new inline
prompt literal. It self-tests against fixtures first, so a checker that stops
detecting anything fails rather than passing quietly. An eslint rule confines
the three SDKs to the services that own them, which is what makes the check's
coverage meaningful — it can only see the files it is pointed at.

The exemption table in the checker is the honest part. Three prompts still reach
only one provider, each entry naming why. Closing a gap means deleting an entry,
not widening one; an empty table is the goal.

Two issues in the batch were made tractable by this and would otherwise have
been three-way edits: statement extraction (#54) and provider-agnostic PDF
import (#55). PDF import in particular stops being a provider question at all —
pages are rasterized client-side, so the format no longer decides which AI you
have to be paying for.

### What it does not do

The check cannot tell whether a prompt's English is any good, whether a
placeholder got the right value, or whether an adapter silently drops `system`.
The first two are human judgement; the third is behavioural and is asserted in
`provider-prompt-parity.spec.ts`, which compares the text each SDK actually
receives.

Nor does the registry make prompt changes safe — it makes them visible and
uniform. A bad prompt now reaches three providers instead of one.
