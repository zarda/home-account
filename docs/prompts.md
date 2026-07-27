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

## Writing a prompt

Prompts take **pre-rendered strings and nothing else** — never a `Category[]`, a `Transaction[]`, or an injected service. Callers run the formatting helpers they already own (`buildCategoryPromptCatalog`, `CurrencyService.formatAmount`, `RagContextService`) and pass the result in. That keeps `src/app/core/prompts/` free of Angular DI, lets the registry spec run without TestBed, and means no raw user record reaches the prompt layer.

A prompt declares its inputs by typing its render function; `PromptInput<K>` is derived from that signature, so a missing field is a compile error at the call site rather than a blank in the rendered text.

```ts
const rendered = renderPrompt('categorizeTransactions', {
  categoryCatalog: buildCategoryPromptCatalog(categories, translate),
  rows: transactions.map((t, i) => ({ index: i, description: t.description, amount: t.amount })),
});
```

Each provider service then has exactly one adapter — the only place provider variation is allowed to live. Gemini prepends the JSON-only preamble when `expects === 'json'` and doubles the token budget for Gemma's verbose drafting; OpenAI flattens `system` into the input; Claude hoists `system` to its top-level parameter. Nobody writes "return ONLY valid JSON" for Gemini's benefit again — they set `expects: 'json'`.

### Registered in TypeScript, not JSON

`analytics-events.json` is JSON on purpose, and this went the other way on purpose. That check has to read the taxonomy's *values* — parameter names, allowed values — and diff them against a markdown table, which needs `JSON.parse` from Node. This check needs prompt *ids* and call sites, which a regex finds in `.ts` just as well. Meanwhile a prompt in JSON is a `\n`-escaped single line whose diff is unreadable, and prompt wording is exactly the thing a reviewer most needs to see change.

## The registry

<!-- prompt-registry:start -->

| Prompt | Feature | Providers | Since | Purpose |
|---|---|---|---|---|
| `receiptParse` | receiptScanning | claude, gemini, openai | 1.17.93 | One receipt photo → one transaction, with `receiptCount` so several receipts in one photo are noticed |
| `receiptSummary` | receiptScanning | gemini | 1.17.93 | One receipt photo → one summary row carrying the full receipt body as notes |
| `receiptItems` | receiptScanning | gemini | 1.17.93 | One receipt photo → one row per purchased item, with position metadata for overlap detection |
| `statementTransactions` | receiptScanning | claude, openai | 1.17.93 | A statement or multi-row document image → one row per line item |
| `pdfStatement` | receiptScanning | gemini | 1.17.93 | A PDF bank statement → one row per transaction |
| `multiImageReceipts` | receiptScanning | claude, gemini, openai | 1.17.93 | Several photos at once, grouped by `receiptId` and deduplicated across overlapping edges |
| `categorizeTransactions` | categorization | claude, gemini, openai | 1.17.93 | Assign a catalog category and a confidence to each extracted row |
| `categorySuggestion` | categorization | claude, gemini, openai | 1.17.93 | Single-description category lookup outside the import flow |
| `csvMapping` | categorization | claude, gemini, openai | 1.17.93 | Map a bank export's columns onto the transaction fields |
| `spendingSummary` | insights | claude, gemini, openai | 1.17.93 | The dashboard's period insights, in fixed `## ` sections |
| `patternNarrative` | insights | claude, gemini, openai | 1.17.93 | Describe already-detected spending patterns in prose, without recalculating |
| `financialAdvice` | insights | claude, gemini, openai | 1.17.93 | Two or three sentences of advice over the period totals |
| `searchQuery` | search | claude, gemini, openai | 1.17.93 | A natural-language question → a structured filter or aggregate command |

<!-- prompt-registry:end -->

### Single-provider prompts

Four prompts reach only some providers. Each is a capability gap rather than a design choice, and `SINGLE_PROVIDER` in `scripts/check-prompts.mjs` names the issue that closes it — the check fails if a prompt reaches a provider the exemption does not list, so closing a gap means deleting an entry rather than widening one. An empty table is the goal.

| Prompt | Sent by | Gap |
|---|---|---|
| `pdfStatement` | gemini | PDF import stays Gemini-only until pages are rasterized client-side ([#55](https://github.com/zarda/home-account/issues/55)) |
| `statementTransactions` | openai, claude | Gemini routes single images through `receiptSummary` instead ([#54](https://github.com/zarda/home-account/issues/54)) |
| `receiptSummary` | gemini | The other two go straight to statement extraction |
| `receiptItems` | gemini | Position-aware single-image itemization has no OpenAI/Claude counterpart yet |

## What the check cannot see

Stated plainly, because a check that looks stronger than it is does more harm than none:

- **Whether the wording is any good**, or whether a placeholder got the right value. The compiler proves the declared inputs were passed; only a human knows the English says what it should.
- **Whether an adapter drops `system` or ignores `expects`.** That is behavioural — `provider-prompt-parity.spec.ts` asserts the text each SDK actually receives, including that the JSON preamble reaches Gemini and only Gemini.
- **A prompt assembled from concatenated short fragments** to slip under the long-literal heuristic. The inline-literal rule is a tripwire, not a proof.
- **Prompt text reaching a model from outside the three provider files.** The `no-restricted-imports` rule in `eslint.config.js` covers that by keeping each SDK importable only from the service that owns it.

## Commands

```bash
npm run prompts:check
```

Runs the self-test first — fixtures that prove the checker still detects an unregistered literal, a missing provider and a stale `Since` — then the real check.
