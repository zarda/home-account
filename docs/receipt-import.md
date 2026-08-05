# Receipt import

Photograph a receipt, get a transaction. This document covers what the feature
does and what actually bounds it. The decision behind it — and the alternatives
that were rejected — is [ADR 0008](ADR/0008-universal-receipt-language-support.md).

The short version: **the app does not decide what language or currency a receipt
may be in.** The engine does. Nothing in `src/` lists the scripts you may
photograph or the currencies you may be charged in, and `npm run prompts:check`
fails if someone adds one back.

## Two ways in, one routing layer

| Entry point | Where | What you get |
|---|---|---|
| **Scan Receipt** | inside the add/edit transaction dialog | the form filled in from one photo, no separate review step |
| **Camera capture** | the bottom-nav `+`, the transactions FAB, or "Long receipt" in the form | several photos at once, then the import wizard's review and confirm |

Both go through `AIStrategyService`. That is worth stating because it was not
always true: the in-form button used to call `GeminiService` directly, so the
provider you had configured was not necessarily the one that ran, and with no
Gemini key the receipt UI did not appear at all — even on iOS, where the
on-device pipeline needs no key.

The in-form path has no review step, so a value the model was unsure of goes
straight into a field you are about to submit. Where the model reports low
confidence in the total or the date, that field is flagged in place, using the
same threshold and wording as the import wizard's preview table.

## Which engine runs

`AIStrategyService` picks between two pipelines:

- **On-device** (iOS only): Vision OCR reads the text, then Apple's foundation
  model structures it. No API key, no network.
- **Cloud**: Gemini, OpenAI or Claude — whichever you configured, resolved per
  feature by `CloudLLMProviderService`.

On iPhone and iPad the on-device pipeline is preferred where Apple Intelligence
is available. On a Mac without it, the newer cloud models beat the fallback
parser. On the web there is no on-device option at all. Either side falls back to
the other when it cannot produce a usable result.

Two signals gate the UI, and the distinction matters:

- `hasAnyEngine()` — some engine is configured. Gates whether the receipt UI
  appears, deliberately ignoring connectivity, because attaching and previewing
  images is worth having on a train.
- `canProcessNow()` — an engine can run *right now*. Gates issuing a scan. With
  no connection the image is still attached; you are told the scan needs one
  rather than being made to wait for a timeout.

## Language

Nothing in the app enumerates languages.

On the **cloud** path, the model reads what it reads. The prompts ask for the
receipt's own script to be reproduced verbatim, and the worked examples use
placeholders rather than a receipt in any one language — few-shot examples are a
prior, and a prior for one country is a bias against every other.

On the **on-device** path, Vision is told to detect the script itself and is
asked at runtime which languages this device supports, rather than being handed a
list compiled when the app was written. Coverage there is genuinely narrower than
the cloud's — Vision supports no Thai at any revision, for instance — so routing
takes engine capability into account rather than assuming the on-device engine
can read anything it is given.

The last-resort regex parser, used only when the model is unavailable and fails,
is deliberately **not** language-aware. It reads script-neutral signals and
reports low confidence where it has none, so a receipt it cannot really read is
visibly uncertain rather than confidently wrong. Adding per-language patterns to
it is the wrong direction; see the ADR.

## Currency

The prompts ask for an ISO 4217 code and explicitly permit "I cannot tell". The
answer is checked against `Intl.supportedValuesOf('currency')` — so `KRW` and
`PLN` are accepted, and `Won`, `₩` and `ABC` are not.

When the model could not read a currency, the fallback is **your account's base
currency**, not a constant. This matters more than it sounds: a receipt whose
currency is unreadable used to be stored as CNY, JPY or USD depending purely on
which extraction path had run, and a wrong currency looks exactly like a right
one on screen.

There are two different questions about a currency, answered by two helpers:

| Question | Helper | Behaviour |
|---|---|---|
| Can the app represent this? | `isCurrencyCode` | Permissive — anything ISO-shaped. The rates endpoint carries 160+ currencies. |
| Did the model read a real code? | `readCurrencyCode` | Strict — must be in the ISO table, because a plausible invention is the failure mode here. |

**Representable is not the same as offered.** The currency *picker* lists a
curated nineteen, because a 160-entry dropdown helps nobody. Extraction is not
limited to those: a receipt in a currency outside the list is stored and
converted under its own code, showing that code where there is no translated
name. Sub-unit digits come from `Intl` rather than a maintained list, so JPY and
KRW render as whole numbers without anyone remembering to add them.

## Categories

Extraction resolves to a catalog id rather than a display name wherever it can,
so the result does not depend on which language the model happened to answer in.
Where a display name still has to be matched, every shipped locale's names are
considered rather than only the active one, and a name that matched nothing is
distinguishable from a deliberate "Other" instead of silently becoming it.

## Failure surfacing

A provider failure is thrown, never flattened into an empty result: all three
cloud providers rethrow after recording the error, so an expired key or a
billing cap renders as the wizard's typed error card (with its retry or
go-to-settings action) instead of "no transactions found", and the strategy
layer can fall back between engines on the throw. A row whose date the model
wrote in an unreadable shape is flagged for verification on the review table
rather than silently filed under today, and it cannot fail the batch. A
partial save keeps exactly the failed rows on the review step — editable and
re-confirmable, with the saved ones removed so a second confirm cannot
double-import — and the completion toast carries both counts. When every row
saved but the summary read-back fails, the wizard says so and moves on; the
full record, including per-row errors, is on the Import History page.

## Offline capture and the queue

An image captured offline is neither processed nor lost: it is stored in an
IndexedDB queue on the device, with the account that captured it recorded on the
row. Camera capture queues on connectivity alone — an offline iPhone whose
on-device pipeline could have read the photo perfectly well still queues it,
because being offline is decided before the question of which engine could run
is asked. The in-form **Scan Receipt** queues only when both are true: offline,
and no engine able to run. The queue is one store per device rather than per
account, so that stamp is what keeps it honest — an item is only ever drained
into the ledger of the account that took the photo, and a drain that fires while
someone else is signed in leaves it alone rather than filing it in their ledger.

The queue drains when the browser reports the connection back, when the service
worker's background sync fires, and when you press **Sync Now** on the AI
settings page. Draining is unattended by definition — a reconnect with no dialog
open and possibly nobody looking — so there is no review step: what the model
read goes straight into the ledger and a toast says how many rows arrived. They
are ordinary transactions afterwards, editable like any other.

A launch does not drain the queue by itself; what it does is sweep. Anything
left marked *processing* — a tab closed mid-receipt, an app swiped away, a
background sync killed by the OS — is handed back as pending, at the cost of one
of its retries. Without the sweep such a row is invisible to every counter and
every retry, and the receipt is silently lost while its bytes sit in IndexedDB.

**A drain that runs twice over the same image does not import it twice.** Each
row is posted at an id derived from the queued image and the row's position in
what the model read, and a row whose id already holds a transaction is skipped
rather than rewritten. So a reclaimed receipt aims at exactly the documents its
first pass wrote: a replay does not duplicate them and does not discard an edit
you made to them in between. The count in the toast is what the receipt
produced, so a receipt that had already fully landed reports its rows again and
writes nothing. The reasoning, and what is still not guaranteed, is
[ADR 0014](ADR/0014-reclaimed-receipts-replay-idempotently.md).

An image whose rows only partly landed is failed rather than completed, and goes
back into the queue's retry budget: three attempts, after which it is no longer
dispatched. A retry writes only the rows that are missing. An item that has
exhausted its retries stays in the queue and keeps counting towards the number
shown on the AI settings page, which is what **Clear Queue** is for.

## What still bounds coverage

- **The configured model.** This is the intended limit and the only one.
- **Vision's supported languages**, on the on-device path only. Queried at
  runtime, not assumed.
- **Connectivity**, for the cloud path. Images captured offline are queued
  instead — see *Offline capture and the queue* above.
- **The receipt image quota**, which is a tier limit rather than a technical one.

If a receipt fails for any other reason, that is a bug rather than a limitation.
Be aware that diagnosing one is currently harder than it should be: the app
records that an import succeeded or failed and nothing about which engine ran,
which provider, how long it took, or what class of error occurred.
