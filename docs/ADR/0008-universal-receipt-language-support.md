# 8. The app never narrows what the model can read

**Status:** Accepted, implemented · **Date:** 2026-07-31 · **Issues:** #142, #143, #144, #145, #146, #147, #148, #149

Reference documentation lives in [../receipt-import.md](../receipt-import.md). This
record keeps the decision and the reasoning.

## Context

Receipt import was built one country at a time, and it showed. Five separate
hand-maintained lists decided what could be read, each of them individually
reasonable and collectively a ceiling nobody had chosen:

| Where | What it capped |
|---|---|
| `OCR_LANGUAGES` in `config/ai-models.ts`, duplicated in `VisionOCRPlugin.swift` | Vision only attempted English, Japanese and Traditional Chinese. Any other script came back as noise. |
| Three different currency shortlists inside `receipt.prompts.ts` | No two agreed, none matched the app's own catalog, and none named the currency in front of the user. |
| `\|\| 'CNY'`, `\|\| 'JPY'`, `\|\| 'USD'` across the provider services | A currency the model could not read was invented — differently depending on which extraction path had run. |
| The English keyword table in `mapCategoryNameToId` | A model answering in the receipt's language matched nothing and fell through to the fallback category. |
| The 19-entry `SUPPORTED_CURRENCIES` | A currency read perfectly was still not representable. |

None of these announced itself. A misread language produces an empty result the
user reads as "the AI is bad at this"; a misread currency produces a number that
looks exactly like a correct one. The most expensive of them, `extractTransactionsFromImage`,
disagreed with itself inside a single method — line 754 fell back to CNY and line
766 to JPY — so the same photo imported differently depending on the path.

Underneath all five sat a structural problem. The most obvious way to scan a
receipt, the button inside the transaction form, called `GeminiService.parseReceipt`
directly and never reached `AIStrategyService`. `AIImportService` was hardcoded to
Gemini in four more places. So "the language the configured model can read" was
not even the right question for that path: the configured model was not what ran,
and with no Gemini key the receipt UI did not render at all — including the parts
that merely attach an image, and including on iOS where the on-device pipeline
worked fine.

## Decision

**Capability is queried from the engine, never enumerated in the app.**

Concretely: Vision is asked what it supports and told to detect the script itself;
the prompts ask for an ISO 4217 code rather than offering a menu; the answer is
validated against `Intl.supportedValuesOf('currency')`; category resolution keys on
catalog ids rather than display names; and every scan routes through
`AIStrategyService`, so the model the user configured is the model that runs.

Four alternatives were genuinely available and were rejected. They are recorded
because each is the shorter diff, and the shorter diff is how the current state
was arrived at in the first place.

**Extending the lists, language by language.** This is what produced five lists.
Each addition is correct in isolation and leaves the next country exactly as
broken. Rejected on the grounds that the work never converges.

**Passing every supported language to Vision.** Tempting, since
`supportedRecognitionLanguagesAndReturnError:` will hand over the whole set. But
Apple's own header is explicit that automatic detection is not guaranteed and that
naming the expected languages is still advisable where you have domain knowledge,
and recognition accuracy degrades as the requested list grows. So
`automaticallyDetectsLanguage` carries the correctness and `recognitionLanguages`
survives only as an *ordering hint*, appended to everything else the device
reports, so it can never exclude a language Vision would otherwise have read.
This is a real tension rather than a clean win: a hint that is wrong makes
recognition slightly worse, and the only reason it is acceptable is that it
cannot make recognition *impossible*, which the old list could.

**Leaving `usesLanguageCorrection` on.** Correction runs against whichever
language model recognition settled on, which is helpful for prose and actively
harmful here: a receipt in a script that model does not cover comes back as
confident nonsense *in a script it does*, which is worse than coming back empty
because nothing downstream can tell. What actually matters on a receipt —
amounts, dates, merchant names — is precisely what no lexicon improves. It is now
off. The cost is real and accepted: genuinely ambiguous characters in running
text no longer get the benefit of the doubt.

**Adding Korean patterns to the fallback regex parser.** This was the original
shape of #145 and it was reversed during planning. A pattern table cannot reach
parity with a model, and every language added to it is a maintenance claim the
next language invalidates — the table would have grown `합계`, then `รวม`, then
`Итого`, forever. The parser stays script-neutral and reports honestly low
confidence where it has no lexical signal, so the routing layer can prefer an
engine that can actually read the receipt.

**Widening the currency catalog by hand.** Rejected in favour of separating
*representable* from *presentable*: any currency the rates endpoint knows can be
stored and converted, displaying its ISO code when there is no translated name,
while the picker stays curated and short. A curated picker is a design choice; a
curated storage layer is a ceiling.

Rendering the currency vocabulary as a prompt input rather than a literal is an
application of [ADR 0005](0005-prompt-registry-and-provider-parity.md)'s
provider-parity contract, not a departure from it — the same argument that said
generation settings are properties of the task says the vocabulary is too.

## Consequences

The lists are gone, and `npm run prompts:check` now fails on a new one. That check
is the part most likely to matter in a year: the failure it catches is not a
mismatch between two files but a decision, taken quietly, that the app knows better
than the engine what the user is allowed to photograph.

Routing every scan through `AIStrategyService` fixed three latent bugs for free.
`receiptCount` was parsed by all three providers and dropped in conversion, so the
multi-receipt chooser could never fire for anyone. `amountConfidence` and
`dateConfidence` were asked for by the prompt and discarded by all three providers,
so a blurred total looked exactly like a crisp one — on the one path that has no
review step before saving. And the multi-receipt hand-off went to a Gemini-only
method, so an OpenAI or Claude user would have been offered the chooser and then
thrown at.

The availability gate had to split in two. `canUseCloud()` folds in connectivity,
and the receipt block in the transaction form wraps attaching and previewing images,
not just scanning — so gating the UI on it would have made the whole thing vanish on
a train. `hasAnyEngine()` gates the UI, `canProcessNow()` gates issuing a scan, and
an image queued with no connection is now kept with an explanation rather than
failing after a long wait.

## Things that only became apparent while building

**The base-currency fallback already existed; it had just never run.**
`ai-import.service.ts` had `t.currency || baseCurrency` at three call sites. It
never fired because the provider services filled in `'USD'`, `'CNY'` or `'JPY'`
first, so `t.currency` was never empty. The fix was not to add a fallback — it was
to make the providers stop answering a question they could not answer. That is the
general shape of this whole change: the narrowing was upstream of the code that
looked responsible for it.

**`CurrencyService.setBaseCurrency` has no callers.** `CurrencyService.baseCurrency`
is therefore permanently `'USD'`, and every consumer that needs the real value reads
`authService.currentUser()?.preferences?.baseCurrency` directly — in ten places
across two services, each with its own `?? 'USD'`. The new fallback reads the user
too rather than trusting the service. The dead setter and the duplication are left
as found; they are a separate problem and pretending otherwise would have widened
this change considerably.

**`Intl` removes the need for a list twice over.** `Intl.supportedValuesOf('currency')`
returns 162 codes at runtime, which is enough to validate what a model answered
without keeping a table, and `scripts/check-prompts.mjs` uses the same call to decide
whether three uppercase words are a currency shortlist or just three words. A check
that policed hand-written lists while keeping one of its own would not have survived
contact with the first unusual currency.

**The guard caught the real thing on its first run.** It flagged
`OCR_LANGUAGES = ['en-US', 'ja-JP', 'zh-Hant']` before that line had been removed,
which is the only evidence worth having that a tripwire is wired up.

## Known gaps

- **There is no diagnostic channel.** `receipt_import` carries `ok | failed | queued_offline`
  and nothing else. Which engine ran, which provider, how long it took, what class of
  error occurred and what currency was read are all computed and discarded —
  `lastError`, `getStatusInfo()` and `lastProcessingTime` have no consumers at all, and
  `ImportHistory` is only written at the wizard's final save, so a failed *extraction*
  leaves no record anywhere. Everything in this record was found by reading code,
  because there is no other way to find it.
- **The on-device path has no automated coverage.** CI has no iOS job, so the Swift
  changes here are correct by inspection and by nothing else.
- **Vision cannot read every script.** Thai has no supported revision, so those
  receipts are cloud-only by nature rather than by decision. Capability-based routing
  (#148) is what keeps that from being silent.
