# The AI model catalog

Which cloud models the app offers, which one it starts on, and what happens to
a stored choice when a model goes away.

The reasoning behind the one-time migration is in
[ADR/0041](ADR/0041-a-retired-model-id-migrates-once.md).

## The four lists

Everything lives in `src/app/core/config/ai-models.ts`. Each list is an
`AIModelOption[]` of `{ id, name }`, where `id` is the string sent to the
provider and `name` is what the settings dropdown shows. An entry may also carry
`acceptsSampling` — see below.

| List | Feeds | Read by |
|---|---|---|
| `TEXT_MODELS` | Gemini's **text model** dropdown | `GeminiService` — categorization, insights, advice, text receipt parsing |
| `VISION_MODELS` | Gemini's **vision model** dropdown | `GeminiService` — images, including rasterized PDF pages |
| `OPENAI_MODELS` | OpenAI's single dropdown | `OpenAIService` — multimodal, one model does both |
| `CLAUDE_MODELS` | Anthropic's single dropdown | `ClaudeService` — multimodal, one model does both |

Gemini is the only provider with two handles, so it is the only one that can be
available for text while unable to read an image. That is why it has two lists
and the others have one.

Each list has a matching `DEFAULT_*` constant. The recommended entry carries
`(Recommended)` in its name, and exactly one per list does.

Every list feeds `getGenerativeModel()` and ends at `generateContent`. An
embedding model answers `embedContent` instead, so it cannot be added here — it
would fail at the first call rather than behave differently.

## Whether a model accepts sampling

Every prompt in the registry declares a `temperature`, and `acceptsSampling` on
the catalog entry records whether the model will take it. `acceptsSampling(id)`
is what the Claude transport consults before putting the value on the wire.

Today: every Gemini and Gemma model, yes. Every OpenAI model, no — the Responses
API rejects an explicit temperature for the GPT-5 family, which is the whole
catalog. Claude, split — Anthropic removed the parameter for models released
after Opus 4.6 and rejects any value but 1.0 on them with a 400, so
`claude-haiku-4-5` accepts it and `claude-sonnet-5` and `claude-opus-4-8` do
not. [ADR 0043](ADR/0043-a-declared-setting-reaches-every-transport-that-accepts-it.md)
records why this is per model rather than per provider, and what it costs.

**An id with no flag answers `false`**, which is the safe direction: a model the
catalog has not been told about omits the parameter and falls back to the
provider default, rather than failing every request against it. That makes the
flag one more hand-maintained fact with the same problem as the ids themselves —
nothing here can check it, and the vendors move the line. Verify it in the same
pass, from the same page.

The flag covers `temperature`, `top_p` and `top_k` as a family, because vendors
have been withdrawing them together. The app only ever sends `temperature`
(`topP` is Gemini-only and set in `generationConfig`), so one flag is enough
until a vendor splits them.

## Where the ids come from

- Gemini: <https://ai.google.dev/gemini-api/docs/models>
- Gemma: <https://ai.google.dev/gemma/docs/core>
- OpenAI: <https://developers.openai.com/api/docs/models>
- Anthropic: the model ids in their API documentation

Nothing in the repository can check them. An id is a string until a request
carries it, and only the provider's servers know whether it still answers — a
retired id fails at the moment a user tries to read a receipt, not at build
time. The header comment in `ai-models.ts` carries the date the lists were last
checked; treat a stale date as unverified, not as fine.

The vendors' pages carry a "Previous models" or deprecated section. That is the
one worth reading first, because a shut-down id is the failure that no test and
no screen will report.

## How a default reaches a request

1. `DEFAULT_PREFERENCES` in `AIStrategyService` seeds all four fields from the
   `DEFAULT_*` constants.
2. `loadPreferences` reads `homeaccount_ai_preferences` from `localStorage` and
   spreads it **over** those defaults, so a stored id wins. That is deliberate:
   it is what makes a model choice persist.
3. `updatePreferences` writes the whole blob back and calls
   `reinitializeGemini` / `setOpenAIModel` / `setClaudeModel`.
4. `GeminiService.initializeGemini` builds a handle per id and falls back to the
   *current* ids rather than the catalog defaults when called without them, so
   saving an API key does not silently revert a model choice.

The consequence worth remembering: **moving a `DEFAULT_*` constant changes
nothing for anyone who has ever opened Settings → AI.** Their stored blob
outranks it.

## The one-time migration

`src/app/core/config/ai-model-migrations.ts` is how a stored id gets moved
forward. It is a pure function over a plain object — no Angular, no
`localStorage`.

- `AI_PREFERENCES_SCHEMA_VERSION` — the shape of the stored blob. An absent
  version means the blob predates this file.
- `MODEL_ID_REPLACEMENTS` — superseded id → what now serves that role.
- `migrateModelPreferences(stored)` → `{ prefs, changed }`.

A blob already stamped at the current version comes back untouched. An
unstamped blob has its four model fields moved forward and gains the stamp,
and `changed` is true even when no id actually moved — without persisting the
stamp the pass would run on every load.

That is what makes it one-time, and one-time is the point: the stale default
gets corrected once, and a user who then picks a superseded model on purpose
keeps it. The map does not mean "not offered" — 3.1 Flash-Lite is both a
catalog entry and a map key.

**The call order in `loadPreferences` is load-bearing:**

```
parse → migrate → merge with DEFAULT_PREFERENCES → save if changed
```

`DEFAULT_PREFERENCES` carries the current stamp. Merging before migrating hands
a legacy blob a version it never had, the migration declines to run, and the
retired id survives with nothing anywhere reporting a problem.
`ai-strategy.service.spec.ts` has a case that fails under the inverted order.

## Retiring a model

1. **Verify upstream.** Read the vendor's model list, including its previous /
   deprecated section. Note whether the id is shut down or merely superseded —
   both are worth acting on, only one is urgent.
2. **Edit the catalog.** Add the replacement, move `(Recommended)` and the
   `DEFAULT_*` constant if it was a default, and refresh the verification date
   in the header comment. Decide whether the old entry stays selectable; it can,
   and by default it should. Set `acceptsSampling` on the new entry only if the
   vendor's page says the model takes a temperature — omitting it is the safe
   answer, and a wrong `true` fails every request against that model.
3. **Add a replacement entry** in `MODEL_ID_REPLACEMENTS`, keyed by the id
   stored blobs may still hold. Comment *why* — shut down upstream, or dropped
   from the catalog — because the two cases read identically in code.
4. **Leave `AI_PREFERENCES_SCHEMA_VERSION` alone** unless the blob's *shape*
   changed. It versions the structure, not the ids; bumping it for an id would
   re-run the pass over blobs that already migrated and overrule deliberate
   choices.
5. **Remove an entry from the catalog only with a replacement entry to match.**
   A stored id the catalog does not list leaves the settings dropdown showing
   nothing at all.

Two assertions in `ai-models.spec.ts` will catch the usual mistakes: no
`DEFAULT_*` id may be a key in the replacement map, and every replacement value
must be an id the catalog offers. A third asserts no default is a Gemma model —
`GeminiService` branches its response filtering on `includes('gemma')`, and
`gemini.service.spec.ts` names the other side of that branch after the text
default.

## Where it is tested

| File | Covers |
|---|---|
| `config/ai-models.spec.ts` | catalog invariants — defaults present in their own list, no duplicates, one recommendation each, the two map invariants, no Gemma default, and which models `acceptsSampling` answers for |
| `services/provider-prompt-parity.spec.ts` | that the flag reaches the wire: the declared temperature present on Gemini and on a sampling-capable Claude model, absent on the rest |
| `config/ai-model-migrations.spec.ts` | the pure function — legacy blobs, the stamp-only write, the deliberate-pick case, non-Gemini fields untouched |
| `services/ai-strategy.service.spec.ts` | the storage round trip, including the merge-order trap |
| `services/cloud-llm-provider.smoke.spec.ts` | the real provider graph arming Gemini on the catalog's own defaults, under the emulators (`npm run smoke`) |

None of them reaches a model. Building a handle is local; ids are only resolved
server-side at the first `generateContent` call, which is exactly why a retired
id can sit in the catalog with every gate green.
