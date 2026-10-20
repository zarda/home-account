# The AI model catalog

Which cloud models the app offers, which one it starts on, and what happens to
a stored choice when a model goes away.

The reasoning behind the one-time migration is in
[ADR/0041](ADR/0041-a-retired-model-id-migrates-once.md). What the vendors'
pages said when the OpenAI and Claude lists were last read, and why their
defaults have not moved, is in
[ADR/0177](ADR/0177-the-catalog-dates-its-vendors-and-adds-only-what-is-no-worse-than-the-default.md).

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

The two Gemini lists feed `getGenerativeModel()` and end at
`generateContent`. An embedding model answers `embedContent` instead, so it
cannot be added to them — it would fail at the first call rather than behave
differently. The OpenAI and Claude lists end at their own SDK calls,
`responses.create` and `messages.create`.

## Whether a model accepts sampling

Every prompt in the registry declares a `temperature`, and `acceptsSampling` on
the catalog entry records whether the model will take it. `acceptsSampling(id)`
is what the Claude transport consults before putting the value on the wire.

Today:

- **Gemini and Gemma:** every model, yes.
- **OpenAI:** none is flagged. The app sends OpenAI no temperature, whatever
  the flag says: the OpenAI transport never reads it, so sending one takes
  the transport changing as well as a flag (`openai.service.ts`). The vendor
  documents one only on GPT-5.4 at reasoning effort `none`, that model's
  default, with an error at any other effort, and says nothing for the other
  ids the catalog offers. No OpenAI id is flagged until a keyed probe run with
  `--sampling force` shows it takes one.
- **Claude:** split. The SDK types `temperature` `@deprecated`: models released
  after Claude Opus 4.6 do not support setting it, 1.0 is accepted for
  backwards compatibility, and any other value is rejected with a 400.
  `claude-haiku-4-5` is flagged. An id is flagged only once the vendor's page
  or a keyed probe run with `--sampling force` shows it takes one, so one added
  since, like `claude-sonnet-5-5`, stays unflagged.

That run is made by hand, with your own key, and never in CI. `--sampling
force` sends an OpenAI or Claude id the prompt's declared temperature whatever
its flag says: an answer that parses shows the id takes it, and an HTTP 400
shows it does not. See [model-probe/README.md](model-probe/README.md).

[ADR 0043](ADR/0043-a-declared-setting-reaches-every-transport-that-accepts-it.md)
records why this is per model rather than per provider, and what it costs.
[ADR 0177](ADR/0177-the-catalog-dates-its-vendors-and-adds-only-what-is-no-worse-than-the-default.md)
records why the OpenAI reason changed.

**An id with no flag answers `false`**, which is the safe direction: a model the
catalog has not been told about omits the parameter and falls back to the
provider default, rather than failing every request against it. That makes the
flag one more hand-maintained fact with the same problem as the ids themselves —
nothing in CI can check it, and the vendors move the line. Verify it in the same
pass, from the same page, or with the probe run above.

The flag covers `temperature`, `top_p` and `top_k` as a family, because vendors
have been withdrawing them together. The app only ever sends `temperature`
(`topP` is Gemini-only and set in `generationConfig`), so one flag is enough
until a vendor splits them.

## Where the ids come from

Each provider's ids are checked against that vendor's own pages, and each
provider has its own date in the header comment of `ai-models.ts`, because a
refresh of one catalog says nothing about the others:

- **Gemini and Gemma:** <https://ai.google.dev/gemini-api/docs/models> and
  <https://ai.google.dev/gemma/docs/core>, last checked 2026-08-14.
- **OpenAI:** <https://developers.openai.com/api/docs/models> and
  <https://developers.openai.com/api/docs/deprecations>, last checked
  2026-10-14.
- **Anthropic:** <https://platform.claude.com/docs/en/models/overview> and
  <https://platform.claude.com/docs/en/about-claude/model-deprecations>, last
  checked 2026-10-14.

Nothing in CI can check them. An id is a string until a request carries it,
and only the provider's servers know whether it still answers — a retired id
fails at the moment a user tries to read a receipt, not at build time. The
model probe ([model-probe/README.md](model-probe/README.md)) can send a request
by hand, with your own key. Treat a stale date in the header as unverified, not
as fine.

What the last OpenAI and Anthropic read found
([ADR 0177](ADR/0177-the-catalog-dates-its-vendors-and-adds-only-what-is-no-worse-than-the-default.md)):

- **`gpt-5.4-nano` is deprecated.** It shuts down on 2027-04-01, and the
  vendor's replacement is `gpt-6-luna`, which the catalog does not offer. Nano
  stays selectable until then.
- **`claude-haiku-4-5` is Active, with its retirement not sooner than
  2026-10-15.** It is the one Claude id flagged `acceptsSampling`. Claude Haiku
  5.5 (`claude-haiku-5-5`) is its likely replacement, and is not offered until
  the probe has measured it.
- **No other OpenAI or Claude id the catalog offers is deprecated.**

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
   a key armed without ids, as a **Test** press arms one, does not silently
   revert a model choice. A saved key is brought up with the stored ids
   ([below](#how-a-saved-key-reaches-the-providers)).

The consequence worth remembering: **moving a `DEFAULT_*` constant changes
nothing for anyone who has ever changed auto sync or a model choice.** Opening
Settings → AI writes nothing. Changing any one of the five settings the blob
holds — auto sync, the two Gemini models, the OpenAI model or the Claude model —
writes the whole blob: all four model ids and the schema stamp. The provider
order, the RAG level and the API keys are saved elsewhere and never write it. A
moved default therefore reaches only an install that has never changed one of
those five, and every other install's stored blob outranks it.
`ai-strategy.service.spec.ts` pins the write.

## How a saved key reaches the providers

A key typed on Settings → AI is saved when its field blurs, through
`AIStrategyService.applyProviderKey`, the page's one way out for a key. It
writes the key to the account's secrets document through
`ProviderKeyService.setKey`, and once that write is acknowledged and the
bring-up already in flight is up, it runs a full bring-up: the key read, the
stored model ids handed to `initializeProviders`, and Gemini cleared rather
than armed from the build's key when no Gemini key is stored. A cleared field
is saved the same way, as a missing key. So a saved key reaches the providers
by the path the account's own bring-up takes, with the model choice already
stored, and saves come up one after another. A queued scan's drain waits for
the save as part of its wait for the providers
([receipt-import.md](receipt-import.md#offline-capture-and-the-queue),
[ADR 0180](ADR/0180-a-saved-key-joins-the-wait-and-a-reader-sees-their-own-language.md)).
A refused write raises `aiPage.keySaveFailed`, *Could not save the API key.
Try again.*, and leaves what was typed in the field, so the next blur tries
again. A refused clear leaves the key stored and its provider armed, so a
field still empty when the refusal lands shows the stored key again, with
its clear button to try again; a refused typed save never rewrites the
field. A save made before a sign-out brings nothing up once its write lands,
even when the same account has signed back in: the new session's own
bring-up reads the keys. And a drain waiting on that save goes on at the
sign-out, or when another account signs in, without waiting for the write.

The **Test** buttons are the one other way a typed key reaches a provider.
They arm it through `CloudLLMProviderService.updateProviderApiKey`, with no
model ids and no write, and report whether the provider came up, never
whether the vendor accepts the key
([ADR 0179](ADR/0179-a-provider-arm-applies-only-if-nothing-superseded-it.md)).

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
   deprecated section, and its deprecations page. Note whether the id is shut
   down or merely superseded — both are worth acting on, only one is urgent.
2. **Edit the catalog.** Add the replacement, and refresh that provider's date
   in the header comment. Move `(Recommended)` and the `DEFAULT_*` constant
   only if the default itself is going: a moved default reaches only an install
   that has never changed auto sync or a model choice (above). Keep the old
   entry selectable. Set `acceptsSampling` on the new entry only if the vendor's
   page or a keyed probe run with `--sampling force` shows the model takes a
   temperature — omitting it is the safe answer, and a wrong `true` fails every
   request against that model. On an OpenAI entry the flag alone sends nothing,
   since that transport never reads it (above).
3. **A replacement entry reaches almost no one.** `MODEL_ID_REPLACEMENTS` runs
   only on a blob without the current stamp. Every save writes the stamp, and
   the first load of an older blob adds it, so an entry added now reaches only
   a blob written before the stamp existed, on a device that has not loaded the
   app since. When an id is shut down, add the entry anyway, keyed by the id
   stored blobs may still hold, and comment *why* — shut down upstream, or
   dropped from the catalog — because the two cases read identically in code.
   Do not count on it to move anyone.
4. **Leave `AI_PREFERENCES_SCHEMA_VERSION` alone** unless the blob's *shape*
   changed. It versions the structure, not the ids. Bumping it to make a new
   entry reach stamped blobs would re-run the pass over every blob, move every
   mapped id and overrule deliberate choices, such as a pick of 3.1 Flash-Lite.
5. **Do not remove an entry a stored blob may hold.** Until the rule below
   exists, that is every entry. A stored id the catalog does not list leaves the
   settings dropdown showing nothing at all, and a map entry will not reach the
   stamped blob that holds it. Kept in the list, the entry at least shows the
   user which model they are on, so they can move off it.

**The deferred rule.** What would let a retirement reach stored choices is a
rule that runs on every load. An id the catalog no longer lists would be
replaced through `MODEL_ID_REPLACEMENTS`, or by its provider's default when the
map has no entry, and an id the catalog lists would be left alone, so a
deliberate pick of a listed id survives. It is not built. Its deadline is
2027-04-01, when `gpt-5.4-nano` shuts down: nano stays listed until then, and
taking it out of the list needs the rule
([ADR 0177](ADR/0177-the-catalog-dates-its-vendors-and-adds-only-what-is-no-worse-than-the-default.md)).

Two assertions in `ai-models.spec.ts` will catch the usual mistakes: no
`DEFAULT_*` id may be a key in the replacement map, and every replacement value
must be an id the catalog offers. A third asserts no default is a Gemma model —
`GeminiService` branches its response filtering on `includes('gemma')`, and
`gemini.service.spec.ts` names the other side of that branch after the text
default.

## Where it is tested

| File | Covers |
|---|---|
| `config/ai-models.spec.ts` | catalog invariants — defaults present in their own list, no duplicates, one recommendation each, the two map invariants, no Gemma default, and which models `acceptsSampling` answers for: Claude Sonnet 5.5 offered with no flag, only `claude-haiku-4-5` flagged among the Claude ids, and every unflagged OpenAI and Claude id answering false, looped over the catalog |
| `services/provider-prompt-parity.spec.ts` | that the flag reaches the wire: the declared temperature present on Gemini and on a sampling-capable Claude model, absent on OpenAI and on every Claude id not flagged, looped over the catalog |
| `config/ai-model-migrations.spec.ts` | the pure function — legacy blobs, the stamp-only write, the deliberate-pick case, non-Gemini fields untouched |
| `services/ai-strategy.service.spec.ts` | the storage round trip, including the merge-order trap, and that the first change of any one setting writes every model id and the stamp |
| `services/claude.service.spec.ts` | *reads past a reasoning block*, through `translateText` and `translateReceiptImage`: the text after an empty or a redacted thinking block is read, a thinking block cut off at `max_tokens` is incomplete, and a whole answer stopped for a refusal is read |
| `services/openai.service.spec.ts` | *incomplete answers*, through the same two methods: an answer cut off at `max_output_tokens` is incomplete even when it parses, an empty one is incomplete rather than unparseable, and one stopped by the content filter is read. One case runs the real SDK, with an injected `fetch`, over a reasoning-only answer |
| `services/cloud-llm-provider.smoke.spec.ts` | the real provider graph arming Gemini on the catalog's own defaults, and a sweep of every OpenAI and Claude id through the façade, one provider at a time: each envelope's model, `temperature` exactly where `acceptsSampling` says, and no `reasoning`, `thinking` or `output_config` key. Under the emulators (`npm run smoke`) |
| `services/openai.service.spec.ts`, `claude.service.spec.ts`, `gemini.service.spec.ts`, `cloud-llm-provider.base.spec.ts` | *an arm superseded while its SDK loads*, per provider, over fake SDK modules: a clear during the SDK import leaves the provider down, the later of two keys wins when the earlier import lands last, and a superseded import that fails touches nothing and logs nothing; for Gemini, a clear while the constructor's environment arm loads leaves it down. The base's *arm generations*: a later arm makes an earlier one stale ([ADR 0179](ADR/0179-a-provider-arm-applies-only-if-nothing-superseded-it.md)) |
| `services/cloud-llm-provider.service.spec.ts` | *a bring-up superseded by a reset or a newer bring-up*, over spied providers: no further arm once a reset overtakes the key read, Gemini's arm or OpenAI's; only the next account's key when the previous read lands after it; only the newer of two bring-ups over one read arming; no Gemini model switch arming once a reset overtakes its read; and a model switch or a typed key leaving a bring-up running. *over the real providers*, with fake SDK modules behind one gate: a reset while Gemini or OpenAI imports leaves every provider down and builds no client, and the next account comes up on its own key alone; with a build that ships its own Gemini key, a cleared key, a model switch with no stored key and a keyless bring-up each leave Gemini down |
| `services/cloud-llm-provider.smoke.spec.ts`, *across an account switch* | two anonymous accounts on the emulators: A's bring-up held in OpenAI's real import, or in Gemini's with an OpenAI key still to arm; A signs out and B, with no key, signs in. B's readiness wait answers, and once the import lands nothing comes up, and in the Gemini case OpenAI's SDK is never asked for. Under the emulators |
| `services/ai-strategy.service.spec.ts`, `offline-queue-processor.service.spec.ts`, `cloud-llm-provider.service.spec.ts`, `cloud-llm-provider.smoke.spec.ts` | *a key saved in settings*: the save becomes the bring-up a wait joins before its first await, comes up after the bring-up in flight, never holds up another account's bring-up, rejects a refused write only once that bring-up is up and answers with that bring-up's outcome, and brings nothing up for an account that left or a session that ended, nor for a reconnect queued behind such a save, with a wait on the sign-back-in bring-up answered only once it is up, and a wait on a save whose write is still out answered at a sign-out or another account's sign-in; *a bring-up whose key read failed*: one fresh read per wait, shared by every wait on it, none offline, keyed on the bring-up's own outcome rather than the flag the settings page clears; the façade's outcome for a failed read; the processor's *a key saved while Sync Now drains*, the real strategy holding the photo until the saved key is up, and until the providers are up when the account signs back in during a save it left behind, and handing it back pending when the account signs out during a save whose write is still out; and, under the emulators, a key saved through the strategy waited for, and a refused first secrets read read once more ([ADR 0180](ADR/0180-a-saved-key-joins-the-wait-and-a-reader-sees-their-own-language.md)) |
| `docs/model-probe/probe.mjs --self-test` | the probe itself, in 222 checks, offline and with no key: its arguments, `--model` among them and `--repeat` up to its bound of 10, its redactor and printed headers, each small prompt's budget, marker and parse check, its envelopes with and without `--sampling force`, the run loops through the wiring `--dry-run` uses, and one request per provider onto a recorder, plus a forced one through each SDK. With a canary on every variable either SDK package reads but four system ones, a request still goes to the vendor's host, carries nothing from the environment, and neither SDK prints or looks up anything but the two variables no option overrides. A 500 or a 429 is one request, a sender with no transport is refused, the Gemini sender encodes its model into the URL's path and sends its key in the `x-goog-api-key` header, so no request URL carries a query or a key, a drift is reported on whichever run of a repeated case it falls, `--update` writes no baseline after a failed call, Chromium's launch gets no key variable, and nothing printed carries a key or a canary ([ADR 0177](ADR/0177-the-catalog-dates-its-vendors-and-adds-only-what-is-no-worse-than-the-default.md), [ADR 0180](ADR/0180-a-saved-key-joins-the-wait-and-a-reader-sees-their-own-language.md)). Run by hand, never in CI |

None of them reaches a model. Building a handle is local; ids are only resolved
server-side at the first request, which is exactly why a retired id can sit in
the catalog with every gate green. Only the model probe, run by hand with your
own key, reaches one.
