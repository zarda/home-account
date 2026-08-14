# Prompts

Every prompt the app sends to a language model lives in `src/app/core/prompts/`, is rendered through `renderPrompt(id, input)`, and is listed in the table below. `npm run prompts:check` fails the build when the table, the registry and the provider call sites disagree.

## Why a registry

The app talks to three providers — Gemini, OpenAI and Claude — through `CloudLLMProviderService`. Each provider service used to carry its own copy of every prompt. Nothing compared the copies, and they had already drifted:

| Drift | Effect |
|---|---|
| Only Gemini's receipt prompt asked for `receiptCount` | With OpenAI or Claude configured, the multi-receipt review flow in `transaction-form.component.ts` could never trigger — the field it reads was never requested. |
| Only Gemini's narrative prompt carried the language instruction | OpenAI and Claude described spending patterns in English regardless of the app's locale. |
| The spending summary opened with two different sentences | Gemini was asked for "structured AI Insights" with every heading on its own `## ` line; the other two were asked for "a brief, helpful spending summary" with headings merely "in the same language". The renderer needs the headings. |
| Claude's advice prompt was missing its closing instruction | Claude could prefix advice with preamble the other two were told to suppress. |
| Gemini's CSV prompt was a compressed rewrite | It named the nine target fields without saying what any of them meant. |
| Generation settings were written per call site per provider | Gemini categorized at `temperature: 0.05`; OpenAI and Claude sent no temperature at all. |

Temperature, token budget and the expected response kind are now properties of the prompt, because that is what they are — properties of the task, not of the provider.

Where they *land* is a separate question, and only a transport can answer it. The token budget and the response kind reach all three providers. Temperature reaches the models that accept one: Gemini always; Claude only on models released before Opus 4.6, because Anthropic rejects any other value with a 400 on the rest; OpenAI never, because the Responses API rejects it for the GPT-5 family and every id in the catalog is GPT-5. The declared value stays required — `acceptsSampling` in `core/config/ai-models.ts` records each model's answer, and `check-prompts.mjs` holds every provider to reading the field or naming an exemption. [ADR 0043](ADR/0043-a-declared-setting-reaches-every-transport-that-accepts-it.md) records why that is a limit of the transports rather than a gap in the registry.

## Writing a prompt

Prompts take **pre-rendered strings and nothing else** — never a `Category[]`, a `Transaction[]`, or an injected service. Callers run the formatting helpers they already own (`buildCategoryPromptCatalog`, `CurrencyService.formatAmount`, `RagContextService`) and pass the result in. That keeps `src/app/core/prompts/` free of Angular DI, lets the registry spec run without TestBed, and means no raw user record reaches the prompt layer.

A prompt declares its inputs by typing its render function; `PromptInput<K>` is derived from that signature, so a missing field is a compile error at the call site rather than a blank in the rendered text.

```ts
const rendered = renderPrompt('categorizeTransactions', {
  categoryCatalog: buildCategoryPromptCatalog(categories, translate),
  rows: transactions.map((t, i) => ({ index: i, description: t.description, amount: t.amount })),
});
```

Most prompts are rendered once, in `CloudLLMProviderBase` (`core/services/cloud-llm-provider.base.ts`), which every provider service extends. What each provider still owns is its transport: `sendText` and `sendVision`, and the `renderedText` strategy behind them. Gemini prepends the JSON-only preamble when `expects === 'json'`, doubles the token budget for Gemma's verbose drafting, and carries the declared temperature in `generationConfig`; OpenAI flattens `system` into the input and sends no sampling parameter at all; Claude hoists `system` to its top-level parameter and sends the temperature only on models that still accept one. Nobody writes "return ONLY valid JSON" for Gemini's benefit again — they set `expects: 'json'`. ADR 0025 records why the variation lives there and nowhere else.

A call site in the base reaches all three providers by construction, so `npm run prompts:check` counts it as all three. It also fails on the two ways that can go wrong: a prompt rendered in the base *and* in a provider file, where one of the two must be drift, and a single-provider exemption claimed by a prompt the base renders.

### Do not enumerate what the model already knows

A prompt must not carry a hand-written list of currencies, languages or scripts. `npm run prompts:check` fails on one.

The receipt prompts used to name their own currencies — three shortlists, in three prompts, no two the same and none matching the app's catalog. A model reading a receipt in a currency nobody had typed out was being steered towards one that had been, and the failure was invisible: an amount in the wrong currency looks exactly like an amount in the right one. The worked examples had the same problem in a quieter form, all being in one language.

Ask for the shape of the answer, validate the answer on the way back:

```ts
// in the prompt
'ISO 4217 code for the money on this receipt … use "" when you genuinely cannot tell'

// in the provider adapter
currency: readCurrencyCode(parsed.currency),   // '' unless the ISO table knows it
```

`readCurrencyCode` (`core/utils/receipt-extraction.utils.ts`) checks against `Intl.supportedValuesOf('currency')`, so neither the prompt nor the validator keeps a list. Empty is deliberate: the caller substitutes the account's own base currency, which is a better answer than any constant the prompt layer could name.

The same rule applies to examples. Demonstrate the *shape* with placeholders (`"<item name as printed>"`) rather than a real receipt in one language, and say explicitly that the receipt's own script must be reproduced.

### Registered in TypeScript, not JSON

`analytics-events.json` is JSON on purpose, and this went the other way on purpose. That check has to read the taxonomy's *values* — parameter names, allowed values — and diff them against a markdown table, which needs `JSON.parse` from Node. This check needs prompt *ids* and call sites, which a regex finds in `.ts` just as well. Meanwhile a prompt in JSON is a `\n`-escaped single line whose diff is unreadable, and prompt wording is exactly the thing a reviewer most needs to see change.

## The registry

<!-- prompt-registry:start -->

| Prompt | Feature | Providers | Since | Purpose |
|---|---|---|---|---|
| `receiptParse` | receiptScanning | claude, gemini, openai | 1.17.93 | One receipt photo → one transaction, with `receiptCount` so several receipts in one photo are noticed |
| `receiptSummary` | receiptScanning | gemini | 1.17.93 | One receipt photo → one summary row carrying the full receipt body as notes |
| `receiptItems` | receiptScanning | gemini | 1.17.93 | One receipt photo → one row per purchased item, plus the receipt's printed total, with position metadata for overlap detection |
| `statementTransactions` | receiptScanning | claude, gemini, openai | 1.17.93 | A statement or multi-row document image → one row per line item |
| `pdfStatement` | receiptScanning | gemini | 1.17.93 | A PDF bank statement → one row per transaction |
| `multiImageReceipts` | receiptScanning | claude, gemini, openai | 1.17.93 | Several photos at once, grouped by `receiptId` and deduplicated across overlapping edges, one printed total per group |
| `categorizeTransactions` | categorization | claude, gemini, openai | 1.17.93 | Assign a catalog category and a confidence to each extracted row |
| `categorySuggestion` | categorization | claude, gemini, openai | 1.17.93 | Single-description category lookup outside the import flow |
| `csvMapping` | categorization | claude, gemini, openai | 1.17.93 | Map a bank export's columns onto the transaction fields |
| `spendingSummary` | insights | claude, gemini, openai | 1.17.93 | The dashboard's period insights, in fixed `## ` sections |
| `patternNarrative` | insights | claude, gemini, openai | 1.17.93 | Describe already-detected spending patterns in prose, without recalculating |
| `financialAdvice` | insights | claude, gemini, openai | 1.17.93 | Two or three sentences of advice over the period totals |
| `searchQuery` | search | claude, gemini, openai | 1.17.93 | A natural-language question → a structured filter or aggregate command |

<!-- prompt-registry:end -->

### Single-provider prompts

Three prompts reach only some providers. Each is a capability gap rather than a design choice, and `SINGLE_PROVIDER` in `scripts/check-prompts.mjs` names the issue that closes it — the check fails if a prompt reaches a provider the exemption does not list, so closing a gap means deleting an entry rather than widening one. An empty table is the goal.

An exemption names concrete provider files, so an exempted prompt has to be rendered from one. Rendering it from the shared base fails the check: the base is the one file all three providers inherit, which is the opposite of single-provider. That is why Gemini's own `extractTransactionsFromImage` — the only operation where it answers a different prompt from the other two — stays in `gemini.service.ts`.

| Prompt | Sent by | Gap |
|---|---|---|
| `pdfStatement` | gemini | Gemini is the only provider that accepts a PDF natively. Everyone else reads rasterized pages through `statementTransactions`, so PDF import itself is no longer provider-gated |
| `receiptSummary` | gemini | The other two go straight to statement extraction |
| `receiptItems` | gemini | Position-aware single-image itemization has no OpenAI/Claude counterpart yet |

## What the check cannot see

Stated plainly, because a check that looks stronger than it is does more harm than none:

- **Whether the wording is any good**, or whether a placeholder got the right value. The compiler proves the declared inputs were passed; only a human knows the English says what it should.
- **Whether an adapter drops `system` or ignores `expects`.** That is behavioural — `provider-prompt-parity.spec.ts` asserts the text each SDK actually receives, including that the JSON preamble reaches Gemini and only Gemini.
- **Whether the sampling settings an adapter mentions actually reach the wire.** The check proves a provider file either reads `rendered.temperature` or carries a named `SAMPLING_EXEMPT` entry — enough to catch a new adapter that drops it silently, which is how #263 shipped. Only the parity spec proves the value arrives, and on which models.
- **A prompt assembled from concatenated short fragments** to slip under the long-literal heuristic. The inline-literal rule is a tripwire, not a proof.
- **Prompt text reaching a model from outside the provider files.** The `no-restricted-imports` rule in `eslint.config.js` covers that by keeping each SDK importable only from the service that owns it. The shared base is covered by the same rule from the other side: it imports no SDK and cannot, so nothing in it reaches a model except through a seam a provider implements. `npm run lint-guards:check` asserts that rule is actually in force per file population — a flat-config collision once switched the analytics half of it off without changing a visible line (ADR 0038).
- **Whether a shared call site and a provider call site render the same prompt for the same reason.** The check fails when both exist, because one of them must be drift — but it cannot tell you which one.

## Commands

```bash
npm run prompts:check
```

Runs the self-test first — fixtures that prove the checker still detects an unregistered literal, a missing provider, a stale `Since`, a prompt rendered both in the base and in a provider, and a single-provider exemption claimed from the base — then the real check.
