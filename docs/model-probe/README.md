# Model probe

Sends the app's **real** receipt prompt and a real image to a **real** model, runs
the app's **real** validators over the answer, and compares the result to a
recorded baseline.

Every other test of the extraction path feeds it a canned response. That is the
right trade for CI — deterministic, free, fast — but it means nothing in the
suite proves the shipped prompt actually gets a usable answer out of a live
model, and nothing would notice if a model update changed that. This is the only
check that would.

## Running it

```bash
node docs/model-probe/probe.mjs              # compare against baseline.json
node docs/model-probe/probe.mjs --model <id> # probe a different model
node docs/model-probe/probe.mjs --raw        # dump each full model response
node docs/model-probe/probe.mjs --update     # rewrite baseline.json from this run
```

Needs `geminiApiKey` in `.vscode/environment.ts` (the same local file the app
uses) and Playwright's Chromium, which it borrows from
[`../ui-audit/tools`](../ui-audit/tools) — this folder has no dependencies of
its own. Set `CHROMIUM_PATH` if your cache differs.

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

It also refuses to run if the rendered prompt is under 500 characters or has no
`"country"` field. That guard is there because `renderPrompt` returns a
structured `RenderedPrompt` — `{ system, user, expects, maxOutputTokens,
temperature, topP }` — and **not** a string. Interpolating it into a template
literal yields `[object Object]`, sends a 110-character prompt, and produces a
result where every field is absent and every case fails. That looks exactly like
a broken model. It is a broken probe.

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
encode what a correct answer looks like. The drift block underneath compares
against `baseline.json` instead: expectations catch *wrong*, drift catches
*different*, and a model update usually shows up as the second before it shows
up as the first.

Update the baseline deliberately, not to make a run go green — a changed
baseline is a record that the model's behaviour moved.
