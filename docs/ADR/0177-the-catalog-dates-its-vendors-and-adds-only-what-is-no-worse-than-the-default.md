# 177. The catalog dates its vendors, and adds only what is no worse than the default

**Status:** Accepted, implemented · **Date:** 2026-10-12 · **Issues:** #468

Reference documentation lives in [../ai-models.md](../ai-models.md),
[../prompts.md](../prompts.md) and
[../model-probe/README.md](../model-probe/README.md).

This record takes the half of #468 that needs no key: Claude Sonnet 5.5 in
the catalog, a dated source line for each provider, the sampling reason
reworded, the response shapes pinned, and a probe that can reach OpenAI and
Claude. The keyed half, the probe's run and what it would decide, is not
here, and #468 stays open for it.

Amends [0041](0041-a-retired-model-id-migrates-once.md). Its migration, its
stamp and its call order stand. Two of its statements do not: that opening
**Settings → AI** writes every model id, and that the next retirement is
one map entry and one catalog edit.

Amends
[0043](0043-a-declared-setting-reaches-every-transport-that-accepts-it.md).
Its decision stands: the declared temperature goes to every model flagged
`acceptsSampling`, and nowhere else. Its reason for leaving OpenAI out does
not, and neither does its count of the Claude ids past the line.

## Context

#468 read both vendors' pages on 2026-09-30 and found the OpenAI and Claude
lists a generation behind. Nothing the app offered was shut down or
scheduled to be. Its larger worry was two models already offered that may
spend the app's small output budgets on reasoning nobody sees: `gpt-5.5`,
which defaults to `medium` reasoning effort, and `claude-sonnet-5`, the
Claude default, which thinks adaptively when `thinking` is omitted. Neither
transport sends a reasoning, thinking or effort setting, and the smallest
budgets in the registry are 50, 400, 500, 600 and 800 tokens. No OpenAI or
Claude key exists in any venue this work ran in, so that worry is named
here, not measured.

**The vendors' pages, read on 2026-10-11, 2026-10-12 and 2026-10-14.**
Four pages were read: Anthropic's models overview and its deprecations
table, and OpenAI's models and deprecations pages. The second read was
byte-identical to the first. The third differed on OpenAI's deprecations
page alone: that day OpenAI deprecated four GPT-4 series models (`gpt-4o`,
`gpt-4o-mini`, `gpt-4.1` and `gpt-4.1-mini`), shutting down on 2027-01-14
with `gpt-6-luna` as the replacement, and the app offers none of them. The
page also began naming an optional `shutdown_date` on each entry of the
models list endpoint. Two facts are newer than #468:

- **Anthropic's current models are Claude Fable 5.1, Opus 5.5, Sonnet 5.5
  and Haiku 5.5.** Haiku 5.5 (`claude-haiku-5-5`) thinks adaptively, at a
  default effort of `medium`, and retires not sooner than 2027-10-07.
  Haiku 4.5, the one Claude id the catalog flags `acceptsSampling`, is
  still Active, with its retirement not sooner than 2026-10-15. Anthropic
  gives at least 60 days' notice before a retirement, so that date is a
  floor, not a shutdown.
- **OpenAI deprecated `gpt-5.4-nano` on 2026-10-01.** It shuts down on
  2027-04-01, and the recommended replacement is `gpt-6-luna`.

None of the other ids the app offers is deprecated: `gpt-5.4-mini`,
`gpt-5.4` and `gpt-5.5`, and `claude-sonnet-5`, `claude-haiku-4-5` and
`claude-opus-4-8`. `claude-sonnet-5-5` is Active, retiring not sooner than
2027-09-28, with the same thinking-on default and the same price as
Sonnet 5: $2 per million input tokens and $10 per million output tokens.

**Nothing dated the OpenAI and Claude ids.** The catalog's header cited two
Google pages and 2026-08-14. The OpenAI comment had a URL and no date, and
the Claude comment had neither, so nobody could tell when either list was
last read.

**The sampling reason was wrong as written.** 0043 said OpenAI's Responses
API turns away an explicit temperature on every GPT-5 model, and that every
id the catalog offered was one, so there was nothing to send one to.
OpenAI's own guide for GPT-5.4 documents `temperature` at reasoning effort
`none`, that model's default, and an error at any other effort. It says
nothing for `gpt-5.4-mini`, `gpt-5.4-nano` and `gpt-5.5`. The omission was
still right, because a temperature a model refuses fails every request
against it. The reason was not, and it had been copied into the
catalog, the OpenAI transport, the prompt inputs, the prompt checker, two
spec titles and two reference docs. The Claude line was worded two ways:
models released *after* Opus 4.6 reject the parameter, or models released
*before* it accept one.

**Nothing pinned the response shapes.** The Claude transport reads the
first block whose type is `text`, so a thinking block ahead of the answer
is skipped, and it maps a `max_tokens` stop to `truncated`. The OpenAI
transport reads the SDK's `output_text`, and maps an
`incomplete_details.reason` of `max_output_tokens` to `truncated`. Both
were right by construction. No spec fed either one a reasoning block or an
incomplete reason, and the one OpenAI case that fed an empty `output_text`
never asserted `truncated`.

**A moved default reached fewer installs than the docs said.**
`docs/ai-models.md` and 0041 said a stored blob exists for anyone who has
ever opened Settings → AI. Opening the page writes nothing. Changing any
one of the five settings the blob holds, auto sync or a model choice,
writes the whole blob: auto sync, all four model ids and the schema stamp.
The provider order, the RAG level and the API keys are saved elsewhere and
never write it. A `MODEL_ID_REPLACEMENTS` entry runs only on a
blob without the current stamp, and every save writes the stamp, as does
the first load of an older blob. An entry added on the day a vendor
retired an id would reach almost no one, yet the retirement steps still
named the map as the way a stored id moves.

**The probe reached only Gemini.** `docs/model-probe/probe.mjs` read the
Gemini key at the top level, whatever flags it was given, and ignored any
flag it did not know. Planning found that running it with `--help`, or with
a `--self-test` it did not have yet, would have sent a live Gemini probe on
the developer's own key.

## Decision

**The catalog offers a new model only when it is no worse than the default
it sits beside. It dates each provider's ids by the day their pages were
read, and words each vendor's sampling rule as that vendor documents it.
The defaults, the Recommended entries and the replacement map do not move
until a keyed probe run has measured them. The probe gains OpenAI and
Claude, and a run that sends nothing never reads a key.**

Each commit is cited by its subject.

### Sonnet 5.5, and the dates

`feat: Claude Sonnet 5.5 joins the model catalog, and each provider's ids
carry a date`:

- **`CLAUDE_MODELS` gains `{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet
  5.5' }`**, directly after the Recommended Sonnet 5. It carries no
  `acceptsSampling`, so it is sent no temperature, and it is not
  Recommended. It is no worse than the default: the same thinking-on
  default and the same price. Whether either Sonnet starves a small budget
  is the keyed run's question, and it is the same question for both.
- **The defaults stay.** `DEFAULT_OPENAI_MODEL` is still `gpt-5.4-mini`
  and `DEFAULT_CLAUDE_MODEL` is still `claude-sonnet-5`, each still the
  one Recommended entry in its list (#468's decision 1).
  `MODEL_ID_REPLACEMENTS` gains nothing, and
  `AI_PREFERENCES_SCHEMA_VERSION` stays at 1 (its decision 2): nothing
  offered is shut down.
- **The header dates each provider.** Gemini and Gemma keep their two
  Google pages and 2026-08-14. OpenAI cites its models and deprecations
  pages, and Anthropic its models overview and deprecations pages, each
  last checked 2026-10-14. The OpenAI comment's own undated URL line went:
  the header carries that citation with its date, and an undated copy
  beside a dated one is how the ids went undated in the first place.
- **`gpt-5.4-nano`'s deprecation is recorded, and nothing more.** The
  OpenAI comment names its shutdown, 2027-04-01, and its replacement,
  `gpt-6-luna`, and says it stays selectable. That was the owner's choice.
  What it means for a stored nano is under *Known gaps*.
- **Haiku 5.5 is not offered.** The owner's choice was to probe it first.
  The probe's model list carries it, and this record names it as Haiku
  4.5's likely replacement.

In `ai-models.spec.ts`, *offers the current Sonnet without a sampling flag*
failed first, on the missing entry. *flags only claude-haiku-4-5 as
accepting sampling in CLAUDE_MODELS* is a pin. In the provider smoke, a
*model catalog sweep* arms one provider at a time. It resets the other and
gives it an unarmed fake client, so a request routed there would be
recorded. For every OpenAI and Claude id, the sweep selects the id through
the façade and translates one note. The envelope must name that id, carry
`temperature` exactly when `acceptsSampling` says so, and carry no
`reasoning`, `thinking` or `output_config` key.

### The sampling reason, and one Claude line

`docs: the sampling exemption says what OpenAI documents, and the Claude
line is worded once` rewords every site in code. This record's commit
rewords the two reference docs.

- **OpenAI.** The app sends OpenAI no `temperature`, whatever the flag
  says: the OpenAI transport never reads `acceptsSampling`, so sending one
  takes the transport changing as well as a flag. The vendor documents one
  only on GPT-5.4 at reasoning effort `none`, and no OpenAI id is flagged
  until a probe shows it takes one. The `SAMPLING_EXEMPT` entry in
  `check-prompts.mjs` keeps OpenAI listed, with that reason.
- **Claude.** The line is stated once, as the SDK's `@deprecated` note
  states it: models released after Claude Opus 4.6 do not support setting
  `temperature`, 1.0 is accepted for backwards compatibility, and any
  other value is rejected with a 400. A Claude id is flagged only once the
  vendor's page or a probe shows it takes one. Every site that names the
  boundary names it that way. Of the two that worded it from the other
  side, the prompt inputs now defer to the flag, and `prompts.md` uses the
  SDK's form.
- **No comment counts the ids on either side of the line.** 0043's "two of
  the three" stopped being true the moment Sonnet 5.5 arrived. The
  checker's doc comment says a provider is listed in `SAMPLING_EXEMPT`
  only when no model in its catalog is flagged.
- **The two specs that listed ids by hand loop over the catalog.** The
  parity spec's *is omitted for every Claude model not proven to accept it*
  takes `CLAUDE_MODELS.filter(model => !acceptsSampling(model.id))`. For
  each id it asserts first that the envelope names that id, then that the
  envelope carries no temperature. `ai-models.spec.ts` filters on the
  entry's own flag rather than on `acceptsSampling()`, because filtering
  and asserting through the same call could not fail. Both cover Sonnet 5.5
  without naming it.

`npm run prompts:check` passes, with OpenAI still the one provider in
`SAMPLING_EXEMPT`.

### The response shapes are pinned

`test: the transports read past a reasoning block and flag an answer cut
short` adds cases to both transport specs. They go through `translateText`
and `translateReceiptImage`, because those two are the only callers that
act on `truncated`: the shared base turns it into `AI_ANSWER_INCOMPLETE`.
Every other caller reads whatever text arrived. Each rejection is asserted
by the error's identity, not by `parseAIError`'s class, which reads a
`SyntaxError` as *incomplete* too.

- **Claude**, *reads past a reasoning block*:
  - `[thinking(''), text]` and `[redacted_thinking, text]` read the text;
  - `[thinking]` alone, stopped at `max_tokens`, rejects with
    `AI_ANSWER_INCOMPLETE`;
  - a whole answer stopped for a `refusal` reads, as the control.
- **OpenAI**, *incomplete answers*:
  - a parseable `output_text` marked incomplete for `max_output_tokens`
    rejects with `AI_ANSWER_INCOMPLETE`;
  - the same answer marked for `content_filter` reads;
  - an empty `output_text` marked for `max_output_tokens` rejects with
    `AI_ANSWER_INCOMPLETE`, not a `SyntaxError`.
- **One case runs the real OpenAI SDK.** A subclass of the installed
  client is built with an injected `fetch` and `maxRetries: 0`. The `fetch`
  answers a response whose only output item is a reasoning item, marked
  incomplete for `max_output_tokens`. `translateText` rejects with
  `AI_ANSWER_INCOMPLETE`, and the `fetch` was called once, at a URL ending
  `/responses`. The transport's own `sendText` then returns `{ text: '',
  truncated: true }`. The empty text is the SDK's: it builds `output_text`
  from the output items, and a reasoning item has none. `window.fetch` is
  never stubbed, because the SDK captured it when it loaded.

Each case passed on arrival, because both transports were already right.
Each was shown to fail under a temporary mutation that was never
committed: Claude reading `content[0]` instead of the first text block,
OpenAI flagging any incomplete reason, either transport never setting
`truncated`, and Claude treating every stop but `end_turn` as cut short.

### One setting change writes every id

`test: one AI setting change writes every model id` pins what the
corrected docs now say. On a fresh install nothing is stored. Then
`updatePreferences({ autoSync: false })` stores the whole blob: `autoSync`,
all four model ids at their defaults, and `schemaVersion` at the current
version. It passes on arrival, because `updatePreferences` saves the merged
object. Two mutations each failed only this case: saving the patch alone,
and dropping three fields from `DEFAULT_PREFERENCES`.

### The probe reaches OpenAI and Claude

`feat: the model probe reaches OpenAI and Claude` rebuilds
`docs/model-probe/probe.mjs` around its arguments.

- **Arguments are parsed first.** An unknown flag, a flag given twice, a
  missing value or a combination it refuses exits 2 with the usage. That
  happens before any key is read, any bundle is built, any fixture is
  rendered, any SDK is imported or any connection is opened. With no flag,
  the run is what it was: Gemini, the receipt fixtures, against
  `baseline.json`.
- **The flags.**
  - `--provider gemini|openai|claude`;
  - `--prompts receipt|small`;
  - `--repeat N`, from 1 to 10;
  - `--effort none`, OpenAI only. It is the probe's own lever, and the app
    never sends it;
  - `--dry-run`;
  - `--sampling auto|force`. `auto`, the default, sends `temperature`
    where the app would. `force` sends OpenAI and Claude the prompt's
    declared temperature whatever `acceptsSampling` says, so a keyed run
    can show an unflagged id taking one or refusing it. It is the probe's
    other lever, and is refused with `--update`;
  - `--self-test`, which takes no other flag;
  - the existing `--model` and `--raw`, and `--update`, which now rewrites
    the Gemini receipt baseline only and is refused on any other provider.
- **`small`** sends the five prompts with the smallest budgets, from fixed
  fixture inputs: `categorySuggestion` 50, `searchQuery` 400, `csvMapping`
  500, `suggestTags` 600 and `categorizeTransactions` 800. `receipt` sends
  all five receipt fixtures, on any provider.
- **The envelopes mirror the transports**, through the installed SDKs,
  `openai` 4.104.0 and `@anthropic-ai/sdk` 0.104.1. The bundled app API
  gives the probe `acceptsSampling` and the catalogs, so an envelope
  carries `temperature` exactly when the app's would, unless `--sampling
  force` is given.
- **Each call records** the model that answered, why it stopped, the output
  item or content block types, the reasoning or thinking tokens, and
  whether the answer parsed the way the app reads it.
- **Keys.** A live run reads `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, and
  Gemini keeps `geminiApiKey` in `.vscode/environment.ts`. A key is never
  written and never printed. Every line goes out through one redactor. It
  masks the keys the run holds, any auth header whatever its value, a
  `?key=` parameter and anything shaped like a key. A printed request
  shows the headers the probe knows as they are, hands an auth header to
  the redactor, and prints any other as `<hidden>`. The bundler and
  Chromium run without the key variables in their environment, in every
  mode, and so does `render.mjs` run on its own. Each client is given its
  base URL, so an environment variable cannot point a run elsewhere. Each
  is also given every other option an SDK would otherwise take from the
  environment (see *An SDK reads more of the environment than its key*).
- **A run that sends nothing reads no key.** `--dry-run` and `--self-test`
  never call the key readers. They run with the key variables hidden from
  `process.env`, and every lookup recorded. Every sender, Gemini's
  included, gets a placeholder key and the injected recorder as its
  `fetch`, and a sender handed no `fetch` at all is refused before its
  client is built. The OpenAI and Claude clients also get `maxRetries: 0`.
  The recorder answers a canned JSON response, and throws on any host its
  case did not expect. Both offline modes also hide the two variables an
  SDK reads with no option to override them, without counting the lookup
  as a key read.
- **The self-test runs 202 checks, offline and with no key.**
  - It covers the argument refusals, each redactor rule, each small
    prompt's budget, marker and parse check, and the render guard.
  - It covers the envelopes per provider and model, and the readers on the
    starved answer shapes. With `--sampling force`, an unflagged OpenAI id
    and an unflagged Claude id carry the declared temperature, and without
    it neither does.
  - It drives `runSmall` and `runReceipts` through `runOffline`, the
    wiring `--dry-run` uses, on OpenAI and Claude, with and without
    `--sampling force` and `--effort none`, both prompt sets each way. The
    envelopes the loops send carry a temperature and a reasoning key
    exactly when asked. The run header says sampling is forced only when
    it was, and Gemini's never does, since Gemini always gets a
    temperature. The temperature lines agree with the wire, and no line
    the loops print carries a key-shaped string.
  - It sends one small prompt per provider through each SDK onto the
    recorder: exactly one request each, with the placeholder on the wire
    and no reasoning or thinking key. A forced prompt goes through the
    OpenAI and Claude SDKs too, and the temperature reaches the wire.
  - It sets a canary on the real environment for every variable either
    SDK package reads, but the four system ones the Anthropic credential
    chain finds its config folder with (`HOME`, `XDG_CONFIG_HOME`,
    `APPDATA`, `USERPROFILE`). That is both base URLs, the three key
    variables, OpenAI's organization and project, Anthropic's webhook key,
    both SDKs' logging (`ANTHROPIC_LOG`, `DEBUG`, and `OPENAI_LOG`, which
    4.104.0 does not read), `ANTHROPIC_CUSTOM_HEADERS`, the credential
    chain's own, and those of the clients the probe never builds (Azure's
    and the environments worker's). With all of them set, a Claude and an
    OpenAI request still go to the vendor's public host and carry no header
    from the environment. Neither SDK prints anything of its own, and
    neither looks up any of them but the two no option overrides, so a
    dropped `organization`, `project` or `webhookKey` fails a check even
    where its value would never reach the wire. A live run's refusal names
    the variable and never its value.
  - A printed request shows the headers the probe knows, masks the auth
    header, and prints any other as `<hidden>`.
  - `--model` refuses an empty id and one carrying `#`, `?` or `/`, and
    takes every id the catalogs and defaults name. The Gemini sender
    encodes the id into its URL path.
  - A 500 and a 429 are one request on each SDK, so the clients'
    `maxRetries: 0` is held. `--update` builds no baseline from a run with
    a failed call, and names the cases whose call failed.
  - A sender handed no transport is refused on each provider before its
    client is built. The cases only construct, so nothing is sent whatever
    `makeSender` returns.
  - The child environment drops the key variables by name. The real
    `render()`, stopped at Chromium's launch by a stand-in launcher, hands
    the launch that environment, both from the probe and from `render.mjs`
    run on its own, so a live receipt run passes Chromium no key either.
  - It ranks every registry prompt by the budget it renders, so the small
    set is held to the registry's five smallest.
  - Over everything the process printed, it finds no key-shaped string and
    no canary. For its whole length the platform `fetch` refuses and is
    counted, and no request reached it.

### The reference docs

This record's commit, `docs: ADR 0177 and the references the model catalog
changed`, brings the reference docs to the code.

- **`ai-models.md`:**
  - the sentence about `generateContent` is about the Gemini lists only;
  - the sampling paragraph states each vendor's rule as above;
  - *Where the ids come from* has a dated line per provider, and what the
    last read found;
  - the default-reach sentence says a moved default reaches only an install
    that has never changed auto sync or a model choice;
  - the retirement steps say a map entry reaches only a blob without the
    current stamp, and record the deferred load-time rule;
  - the test table names the new cases.
- **`prompts.md`:** the sentence on where temperature lands.
- **`model-probe/README.md`:** an *OpenAI and Claude* section, and
  `--update` named as Gemini receipts only.

## What was rejected

- **Offering Haiku 5.5 now.** It thinks adaptively at a default effort of
  `medium`. That is the shape #468 suspects of starving small budgets on
  Sonnet 5 and `gpt-5.5`, and nothing here can measure it. Haiku 4.5, which
  it would replace, is the one Claude id flagged for sampling, and it runs
  with thinking off when none is asked for. The owner chose to probe it
  first.
- **A load-time replacement rule now.** On every load, it would replace an
  id the catalog no longer lists, through the map or else by the
  provider's default, and leave a listed id alone. It would move nothing
  today: nothing offered is shut down, and nano stays listed. It would also
  be the second thing to rewrite a stored id, beside 0041's one-time pass.
  The owner chose to record nano's deprecation only. The rule is deferred,
  with 2027-04-01 as the date it must exist by.
- **Shipping Tier 3 from the docs alone.** Tier 3 is:
  - sending `reasoning: { effort: 'none' }` to OpenAI;
  - adding `gpt-6-luna` or `claude-opus-5-5`;
  - a per-model thinking or effort setting for Claude;
  - moving a default.

  Each changes what goes over the wire, and a wrong value is a 400 on every
  request against that model. The vendors document ids that reject `none`
  and ids that cannot turn thinking off, and `openai` 4.104.0's
  `ReasoningEffort` type has no `'none'`. Only a keyed run can say which
  change is safe, and #468 orders Tier 3 after it.
- **Raw `fetch` for OpenAI and Claude in the probe.** The app reads
  `output_text`, which the OpenAI SDK derives from the output items. A
  probe reading the raw body would measure a different answer from the one
  the app reads, and the empty answer #468 is about is exactly where the
  two can differ. The real-SDK pin shows the SDK producing that empty
  text. Gemini keeps the raw request the probe always sent it.
- **The probe in CI.** A live run spends quota on a key CI does not hold,
  and its answers are not deterministic. The self-test needs no key and
  sends nothing, but it stays out of CI as well, so that the README's rule
  for the folder, manual and never in CI, holds whole.

## Consequences

- **What a user sees.** The Claude list offers Claude Sonnet 5.5, after
  Claude Sonnet 5 (Recommended). Nothing on the wire changes for any other
  id: neither transport's request shape moved, and no stored choice is
  rewritten.
- **The initial bundle.** `ai-models.ts` is eager. It took 58 bytes, for
  the Sonnet 5.5 entry; its dated header lines and comments are stripped
  and cost nothing. [../performance.md](../performance.md) records the
  branch's measured figure.
- **The re-check dates.**
  - **2026-10-15**, Haiku 4.5's floor. #468's decision 2 asks for a dated
    re-read of both vendors' pages on that day.
  - **2027-04-01**, `gpt-5.4-nano`'s shutdown, and the date the deferred
    load-time rule must exist by.
- **The probe.** A keyed run is one command per provider and model, and
  the README lists the models. A run with `--sampling force` is what can
  earn an id its `acceptsSampling` flag. Without a key, `--dry-run` prints
  every envelope a run would send, and `--self-test` checks the probe
  itself.
- **0066's last Known gap stays open.** The OpenAI and Claude budget
  ceilings are still inferred from the vendors' published limits. The probe
  can now measure them, and has not.
- **The browser run saw it** in the emulator venue on 2026-10-12, as
  journey 96.
  - The venue holds no key, so the Claude service's availability was set
    from the console.
  - On `/ai`, the Claude list read Claude Sonnet 5 (Recommended), Claude
    Sonnet 5.5, Claude Haiku 4.5 and Claude Opus 4.8, with one Recommended.
  - On a fresh origin, with nothing stored, one auto-sync toggle wrote
    `autoSync`, all four model ids and `schemaVersion` 1.
  - No request reached a vendor host.

## Departures from the issue

- **The receipt run sends five fixtures.** V1 asks for one receipt fixture.
  `--prompts receipt` sends all five on any provider, as the Gemini run
  does, and no per-case flag was added. A keyed run costs five vision calls
  per model.
- **The pins read through the public methods.** The issue wrote them as the
  transports' return values. The cases drive `translateText` and
  `translateReceiptImage`, the two callers that act on `truncated`, and
  assert the rejection. Only the real-SDK case reads a return value,
  `{ text: '', truncated: true }`.
- **Step 2 of the retirement steps changed too.** The issue named steps 3
  to 5. Step 2 now says a moved default reaches only an install that has
  never changed auto sync or a model choice, and that each provider has its
  own date to refresh.
- **Two facts are newer than the issue.** Haiku 5.5 and nano's deprecation
  are recorded here. Neither changes what is offered beyond Sonnet 5.5.

## Departures from the plan

- **`ai-models.spec.ts` filters on the entry's own flag.** The plan had both
  specs loop over `CLAUDE_MODELS.filter(m => !acceptsSampling(m.id))`. In
  `ai-models.spec.ts` that makes `expect(acceptsSampling(id)).toBeFalse()`
  true by construction, so that spec filters on `!model.acceptsSampling`
  and guards the set as non-empty. The parity spec uses the plan's
  selector, where the transport must agree with the catalog.
- **The OpenAI comment lost its undated URL line**, for the reason under
  *Sonnet 5.5, and the dates*.
- **The probe refuses more than the plan listed.**
  - `--update` is refused on any provider but Gemini, with `--prompts
    small`, with `--dry-run`, and with `--repeat` above 1.
  - `--self-test` takes no other flag.
  - A flag given twice is refused.
  - `--help` prints the usage.
  - `--sampling` takes only `auto` or `force`, and `force` is refused with
    `--update`.
  - `--model` takes only an id's characters: letters, digits, dots, dashes
    and underscores, starting with a letter or digit.
  - `--update` writes nothing when any call failed, and exits 1 naming the
    cases.
  - A live OpenAI or Claude run refuses to start while its SDK's
    unoverridable variable is set.

  The self-test also ranks every registry prompt by its rendered budget, so
  "the five smallest" is checked rather than claimed.
- **The default-reach pin also asserts the two Gemini ids.** The plan named
  the OpenAI and Claude ids and the stamp.
- **The probe gained `--sampling force`.** The plan's probe sent
  `temperature` exactly where the app does, so it could never show an
  unflagged id taking one, while the catalog, the OpenAI transport and the
  reference docs flag an id only once a probe shows it. The flag makes
  that run possible. The app's own envelopes are unchanged.

## Things that only became apparent while building

- **An SDK reads more of the environment than its key.** The Anthropic
  client looks up `ANTHROPIC_AUTH_TOKEN` and a webhook signing key, and
  both clients take a base URL from the environment. The tripwire shows
  it: a dry run built without `authToken: null` looks a key variable up.
  Every variable the two clients read that has a constructor option now
  gets the option: the base URL, OpenAI's `organization` and `project` as
  `null`, Anthropic's `authToken` and `webhookKey` as `null`, and its
  `logLevel` as `'off'`. `ANTHROPIC_LOG` would otherwise set it, and at
  `debug` the client logs every request to the console, past the
  redactor. With an API key given,
  the Anthropic client never reaches its credential chain or the variables
  that chain reads. Two variables have no option. The Anthropic client
  adds each line of `ANTHROPIC_CUSTOM_HEADERS` to every request's
  headers, and the OpenAI client prints every request and answer to the
  console while `DEBUG` is `true`. The offline modes hide both from the
  SDKs, and a live run refuses to start while its SDK's one is set, naming
  the variable and never its value. `openai` 4.104.0 does not read
  `OPENAI_LOG`.
- **Hiding a variable from `get` was not enough.** A Claude dry run on the
  receipt fixtures renders them in Chromium, and Playwright copied the
  environment to launch it. That copy enumerated the key names, so the
  tripwire hides them from `has`, `ownKeys` and property descriptors as
  well. A live run has no tripwire, so Chromium is now handed the child
  environment the bundler gets, built by name, in every mode. `render.mjs`
  run on its own hands its launch the same environment, from the one list
  both files read, `key-variables.mjs`.
- **A slip in the self-test can reach a vendor.** While these checks were
  written, a temporary edit meant for the dry-run branch also rewired the
  self-test's own loop to the platform `fetch`. One Claude request with the
  placeholder key reached `api.anthropic.com` and was refused with a 401.
  No real key was read or sent. The self-test now replaces the platform
  `fetch` for its whole length with one that refuses and is counted, so
  the same slip fails offline. That trap cannot catch a sender left with
  no transport at all, since `openai` 4.104.0 then falls back to
  node-fetch rather than the platform `fetch`. So every sender now refuses
  to be built without one, and the live run passes the platform `fetch`
  explicitly.
- **Output to a pipe is asynchronous on macOS.** A large dry run could be
  cut short by an early exit, so the probe exits only after its output is
  flushed.

## Known gaps

- **The keyed run has not happened, and #468 stays open.** V1 is the probe
  on `gpt-5.5` against `gpt-5.4-mini`, and on `claude-sonnet-5` against
  `claude-haiku-4-5`. V2 is whether each OpenAI id accepts
  `reasoning.effort: 'none'`. Both need the owner's keys. So the two
  suspected starvations are still unmeasured. The probe's own reading of
  the vendors' wire, its 404 bodies, its reasoning-token fields and
  `effort: 'none'`, has been exercised only against canned responses.
- **No keyed run has tested the sampling flag.** A default run sends
  `temperature` exactly where the app does, so it would catch a flagged id
  that refuses one, the direction that fails every request. `--sampling
  force` sends the declared temperature to an OpenAI or Claude id whatever
  the catalog says, so a keyed run can show an unflagged id taking one, an
  answer that parses, or refusing it, an HTTP 400. That run has not been
  made. Until it is, no OpenAI id is flagged and `claude-sonnet-5-5` stays
  unflagged.
- **Tier 3 is not done.** No request carries a reasoning, thinking or
  effort setting. `gpt-6-luna` and `claude-opus-5-5` are not offered, and
  both defaults stay where they were. Each waits on the keyed run.
- **`gpt-5.4-nano` shuts down on 2027-04-01.** It stays selectable until
  then, and no replacement is offered: the vendor's, `gpt-6-luna`, defaults
  to `medium` effort and waits on Tier 3. Nothing moves a stored nano, and
  after that date a request on it fails at the vendor. The load-time rule
  that would move it is deferred, with that date as its deadline.
- **Haiku 4.5's floor is 2026-10-15.** It is the one Claude id flagged
  `acceptsSampling`, so its retirement takes away the only Claude model
  that honours the declared temperature. Haiku 5.5, its likely
  replacement, is not offered until the probe has measured it. Anthropic's
  notice is the first warning, and nothing in the app would see it.
- **Image detail is unchanged** (#468's decision 3). The OpenAI vision
  envelope sends each image with `detail: 'auto'`, which means `high` on the
  5.4 family and `original` on `gpt-5.5`, so the same receipt already costs
  more input tokens on 5.5. Pinning `high` waits on probe evidence.
- **The model id is recorded nowhere.** Analytics and the attempt record
  store the provider only, so a regression after a default moves cannot be
  pinned on a model.
