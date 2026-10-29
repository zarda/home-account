# Model probe

Sends the app's **real** prompts — the receipt ones with a real image — to a
**real** model, reads the answer the way the app does, runs the app's **real**
validators over it, and for the receipt fixtures compares the result to a
recorded baseline. It reaches Gemini, OpenAI and Claude.

Every other test of the extraction path feeds it a canned response. That is the
right trade for CI — deterministic, free, fast — but it means nothing in the
suite proves the shipped prompt actually gets a usable answer out of a live
model, and nothing would notice if a model update changed that. This is the only
check that would.

## Running it

```bash
node docs/model-probe/probe.mjs              # Gemini on the receipt fixtures, against baseline.json
node docs/model-probe/probe.mjs --model <id> # probe a different model
node docs/model-probe/probe.mjs --raw        # dump each full model response
node docs/model-probe/probe.mjs --update     # Gemini receipts only: rewrite baseline.json from this run
node docs/model-probe/probe.mjs --dry-run    # print every request envelope; read no key, send nothing
node docs/model-probe/probe.mjs --self-test  # check the probe itself, offline, with no key
node docs/model-probe/probe.mjs --help       # every flag
node docs/model-probe/render.mjs             # draw every fixture's PNG, and nothing else
```

A Gemini run needs `geminiApiKey` in `.vscode/environment.ts` (the same local
file the app uses). OpenAI and Claude take their keys from the environment —
see *OpenAI and Claude* below. A receipt run also needs Playwright's Chromium,
which it borrows from [`../ui-audit/tools`](../ui-audit/tools) — this folder
has no dependencies of its own. Set `CHROMIUM_PATH` if your cache differs.

The arguments are read before anything else happens. An unknown flag, a flag
given twice or a combination the probe refuses exits 2 with the usage, before
any key is read, any fixture is rendered or any request is sent.

**It is deliberately manual and must not go into CI.** It spends real API quota,
and a model's answers are not perfectly deterministic — see *Confidence is not
stable* below. Run it when a receipt prompt changes, when the default model
changes, or when extraction looks wrong in the wild.

It touches nothing of yours: no app, no Firestore, no writes. The only side
effect is a handful of model requests.

## What it will not let you fool yourself about

The probe imports `renderPrompt` and the `read*` validators out of `src/` and
bundles them with esbuild. It does not keep its own copy of the prompt, because
a copy drifts and then the probe passes while production breaks.

It also refuses to run if the rendered receipt prompt is under 500 characters,
has no `"country"` field, or carries `[object Object]`. Each of the small
prompts (below) has its own marker, taken from its fixture input, that the
render must carry. That guard is there because `renderPrompt` returns a
structured `RenderedPrompt` — `{ system, user, expects, maxOutputTokens,
temperature, topP }` — and **not** a string. Interpolating it into a template
literal yields `[object Object]`, sends a 110-character prompt, and produces a
result where every field is absent and every case fails. That looks exactly like
a broken model. It is a broken probe.

## OpenAI and Claude

```bash
node docs/model-probe/probe.mjs --provider openai --prompts small --model gpt-5.5
node docs/model-probe/probe.mjs --provider claude --prompts small --model claude-sonnet-5 --repeat 3
node docs/model-probe/probe.mjs --provider openai --prompts small --effort none --model gpt-5.4-mini
node docs/model-probe/probe.mjs --provider claude --model claude-haiku-4-5   # the receipt fixtures
node docs/model-probe/probe.mjs --provider openai --prompts small --sampling force --model gpt-5.4
```

**Keys come from the environment.** A live OpenAI run reads `OPENAI_API_KEY`,
and a live Claude run reads `ANTHROPIC_API_KEY`. Nothing else is read for
them: no file, and not `.vscode/environment.ts`. The probe never writes a key
and never prints one. Every line it prints, URLs, headers, envelopes, bodies
and errors alike, goes through one redactor. It masks the keys the run holds,
any auth header whatever its value, a `?key=` parameter and anything shaped
like a key. The Gemini key travels in the `x-goog-api-key` header, as the
app's SDK sends it, so no URL the probe sends or prints carries one; the
`?key=` mask stays as a second line. A printed request shows `accept`,
`content-type`, `content-length`, `anthropic-version`, `user-agent` and the
`x-stainless-*` headers as they are, hands an auth header to the redactor, and
prints any other header as `<hidden>`. The bundler and Chromium run without the
key variables in their environment, in every mode, and so does `render.mjs` run
on its own. Both files take the variable names from `key-variables.mjs`.

**What the SDKs read from the environment.** Each client is given every option
it would otherwise take from the environment: its base URL, OpenAI's
`organization` and `project`, and Anthropic's `authToken`, `webhookKey` and
`logLevel` (`off`, which `ANTHROPIC_LOG` would otherwise set). So no variable
can send a run somewhere else or make an SDK log past the redactor. Two
variables have no option:

- `ANTHROPIC_CUSTOM_HEADERS`: the Claude client adds each of its lines to
  every request as a header.
- `DEBUG`: while it is `true`, the OpenAI client prints every request and
  answer to the console, past the redactor.

A live run refuses to start while its SDK's one is set, and names the
variable, never its value: unset it and run again. `--dry-run` and
`--self-test` hide both from the SDKs.

**What it sends.**

- `--prompts small` sends the five prompts with the smallest output budgets,
  rendered by the app's own registry from fixed fixture inputs:
  `categorySuggestion` 50, `searchQuery` 400, `csvMapping` 500, `suggestTags`
  600 and `categorizeTransactions` 800.
- `--prompts receipt`, the default, sends **all seven** receipt fixtures, on any
  provider, as the Gemini run does. There is no flag for a single case, so a
  receipt run costs seven vision calls per model.
- `--repeat N` (1 to 10, with 10 pinned as the bound) sends each prompt N times,
  because answers vary.
- `--model <id>` takes any id, offered by the app or not, written the way the
  vendors write one: letters, digits, dots, dashes and underscores, starting
  with a letter or digit. Anything else, the empty string included, exits 2.
  The default is the app's default for the provider.
- `--effort none` is OpenAI only: it adds `reasoning: { effort: "none" }`. It is
  the probe's own lever. The app never sends it.
- `--sampling force` sends OpenAI and Claude the prompt's declared
  `temperature` whatever `acceptsSampling` says. It is the probe's other lever,
  and the app never does it. `--sampling auto`, the default, sends the
  temperature where the app would. Gemini always gets one. `force` is refused
  with `--update`.
- `--update` rewrites the Gemini receipt baseline, and is refused on OpenAI and
  Claude. When any call fails, it writes nothing and exits 1, naming the cases
  whose call failed, so the baseline never records a failure.

The envelopes mirror the app's transports, through the installed `openai` and
`@anthropic-ai/sdk` packages: the app reads OpenAI's `output_text`, which the
SDK builds from the output items, so a raw request would read a different
answer. By default, `temperature` is sent exactly when the app would send it,
which is when `acceptsSampling` flags the id: no OpenAI id today, and among the
Claude ids, `claude-haiku-4-5`. A default run therefore catches a flagged model
that refuses a temperature. `--sampling force` is how an unflagged id earns its
flag. It sends the declared temperature to any OpenAI or Claude id, and a keyed
run then shows acceptance as an answer that parses, or refusal as an HTTP 400
whose body is printed through the redactor. No such run has been made yet.

**What it prints, per call:** the model that answered; why it stopped
(`stop_reason`, or OpenAI's `status` with `incomplete_details.reason`); the
output item or content block types; the reasoning or thinking tokens; and
whether the answer parsed the way the app reads it. An HTTP error prints its
status and the start of its body.

**The models to run** ([#468](https://github.com/zarda/home-account/issues/468)'s
keyed checks, [ADR 0177](../ADR/0177-the-catalog-dates-its-vendors-and-adds-only-what-is-no-worse-than-the-default.md)):

- `gpt-5.5` against `gpt-5.4-mini`, and `claude-sonnet-5` against
  `claude-haiku-4-5`, on `--prompts small` with `--repeat 3` and on the receipt
  fixtures. The question is whether a small budget ends with no visible text.
- `claude-sonnet-5-5`, which the app offers, and `claude-haiku-5-5`, which it
  does not yet: it is Haiku 4.5's likely replacement.
- `--effort none` on each OpenAI id (the 5.4 family, `gpt-5.5`, and
  `gpt-6-luna`), to see whether the Responses API accepts it.
- `--sampling force` on any id before it is flagged `acceptsSampling`: first
  `gpt-5.4`, the one OpenAI id whose page documents a temperature, and
  `claude-sonnet-5-5`.
- A made-up id, such as `claude-no-such-model`, to record what a 404 body looks
  like.

**Without a key.** `--dry-run` prints every envelope a run would send, with the
key replaced and images elided, and sends nothing. `--self-test` checks the
probe itself, offline, in 222 checks:

- its argument refusals, `--model` among them, and that every id the app's
  catalogs name is taken;
- its redactor, and that a printed request shows the headers it knows and
  prints any other as `<hidden>`;
- each small prompt's budget, marker and parse check, and that the small
  prompts are still the registry's five smallest budgets;
- the envelopes per provider and model, with and without `--sampling force`;
- the run loops, driven through the same wiring `--dry-run` uses: both prompt
  sets on OpenAI and Claude, with and without `--sampling force` and
  `--effort none`. The envelopes the loops send carry a temperature or a
  reasoning key only when asked, and the run header and temperature lines say
  what was sent;
- one small prompt per provider through each SDK onto a recorder that answers
  canned JSON, plus a forced one through the OpenAI and Claude SDKs;
- with a canary set for every variable either SDK package reads, but the four
  system ones the Anthropic credential chain finds its config folder with
  (`HOME`, `XDG_CONFIG_HOME`, `APPDATA`, `USERPROFILE`), that a request still
  goes to the vendor's host and carries no header from the environment, that
  neither SDK prints anything of its own, and that neither looks up any of
  them but `ANTHROPIC_CUSTOM_HEADERS` and `DEBUG`. The canaries are both base
  URLs, the three key variables, OpenAI's organization and project,
  Anthropic's webhook key, `ANTHROPIC_LOG`, `DEBUG`, `OPENAI_LOG` (which
  `openai` 4.104.0 does not read), `ANTHROPIC_CUSTOM_HEADERS`, the credential
  chain's own, and those of the clients the probe never builds (Azure's and
  the environments worker's);
- that a 500 or a 429 is one request on each SDK, so no client retries;
- that a sender handed no transport is refused on each provider before its
  client is built;
- that the Gemini sender encodes the model into its URL path and sends its key
  in the `x-goog-api-key` header, never in the URL, so a request, a dry-run
  envelope and a printed request carry no query and no key in the URL;
- that the drift block compares every run of a repeated receipt case, first and
  last, each under its own `id#n` label;
- that `--update` builds no baseline from a run with a failed call;
- that the real `render()`, stopped at Chromium's launch, hands the launch an
  environment with no key variable, from the probe and from `render.mjs` run
  on its own;
- that nothing it printed carries a key-shaped string or a canary.

Neither mode reads a key. Both run with the key variables hidden from the
process, and give every sender a placeholder key and an injected recorder
`fetch`, and each SDK client no retries, so neither can reach a vendor. The
self-test also swaps the platform `fetch` for one that refuses, so a sender
wired to it by mistake fails there instead of sending anything. A sender
handed no `fetch` at all is refused before its client is built, since the
OpenAI SDK would otherwise fall back to node-fetch, past that trap.

**Never in CI.** A live run spends real quota on a key CI does not hold, and
its answers are not deterministic. The self-test needs no key and sends
nothing, but it stays out of CI too, so this folder stays manual as a whole.

## The fixtures

`receipts.html` is the source of truth and is committed; the PNGs are derived
and gitignored, the same split `ui-audit/tools` uses for its shots. Keeping the
fixtures as markup means a reviewer can see what a case tests without opening an
image, and a diff shows what changed.

| Case | What it is for |
|---|---|
| `jp` | Japanese conbini — address, phone, tax registration number, yen. Ordinary success. |
| `kr` | Korean cafe — address, phone, business number, won. A second script and currency. |
| `none` | **No country cues anywhere.** The prompt says answer `""` when it cannot tell. A model that guesses instead would confidently mislabel receipts, so this case is the guard on the whole country feature. |
| `long` | 34 items, and a printed total (¥12,723) that differs from the item sum (¥12,281). Pins [ADR 0013](../ADR/0013-the-printed-total-is-the-amount-not-the-item-sum.md) at the model. |
| `cropped` | The same long receipt, physically cut off mid-item. The header survives; no printed total does. |
| `refund`, `refund-tender` | A refund slip whose `TOTAL -$14.03` prints with a minus, plus the words a model reads (*REFUND*, *Returned to card ending 4242*); `refund-tender` adds an unmarked `VISA $14.03`, the same figure printed both ways. Both expect `type` `income` and the total as the magnitude 14.03: the receipt prompts ask which way the money moved and the app reads the answer strictly, never the sign ([ADR 0185](../ADR/0185-a-refund-is-asked-about-at-every-door-and-a-category-follows-its-rows-side-there-and-back.md)). They are also pictures for the on-device reader, pushed into the iOS simulator with `xcrun simctl addmedia`; their lines are the ones `receipt-text-parser.spec.ts` pins, so the regex lane's answer is known: a credit for `refund`, an ambiguous purchase for `refund-tender`. |

## Confidence is not stable — read this before trusting a green run

On the `cropped` fixture the model has to invent a total, because none is
printed. It does: it returns roughly the sum of the visible items.

What matters is whether that invented figure is *flagged*. The app asks the user
to check any amount whose confidence is under `VERIFY_FIELD_THRESHOLD` (0.7).
Across two runs of the identical fixture, the model reported:

- run 1 — amount confidence **0.5**, under the threshold, review chip fires
- run 2 — amount confidence **0.9**, over the threshold, **no chip, invented total imported as if read**

So the model's self-reported confidence cannot be relied on to catch this, and a
single green run is not evidence. `baseline.json` therefore records the
`cropped` case with `totalOk: false` — that is not a bug in the baseline, it is
the known defect written down.

The app's real guard is `deriveAmount` in
[`receipt-consolidation.ts`](../../src/app/core/utils/receipt-consolidation.ts):
when no printed total was reported it sums the items itself and stamps
`REVIEW_AMOUNT_CONFIDENCE` (0.5), so the chip fires regardless of what the model
claims. But that guard is on the **item-level** path only —
`RECEIPT_TOTAL_FIELD`, with its explicit *"do NOT compute it by summing items"*,
appears in `multiImageReceipts` and `receiptItems` and **not** in `receiptParse`.

`receiptParse` asks only for `amount` and has no cross-check against the item
sum. Its callers are the in-form **Scan Receipt**, `AIImportService`, and the
**offline queue drain** — and the drain writes unattended, with no review step,
so nobody ever sees a chip there at all.

## Reading a run

`ok`/`FAIL` per field is measured against the expectations in `probe.mjs`, which
encode what a correct answer looks like. The `type` line prints the app's strict
reading beside the word the model wrote, so an answer the reader refuses
(`Refund`, `credit`) shows as `"expense"` with the model's word in brackets. The drift block underneath compares
against `baseline.json` instead: expectations catch *wrong*, drift catches
*different*, and a model update usually shows up as the second before it shows
up as the first.

Update the baseline deliberately, not to make a run go green — a changed
baseline is a record that the model's behaviour moved.
