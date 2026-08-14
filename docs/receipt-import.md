# Receipt import

Photograph a receipt, get a transaction. This document covers what the feature
does and what actually bounds it. The decision behind it — and the alternatives
that were rejected — is [ADR 0008](ADR/0008-universal-receipt-language-support.md);
where the resulting transaction's amount comes from is
[ADR 0013](ADR/0013-the-printed-total-is-the-amount-not-the-item-sum.md).

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

## Where the amount comes from

Whichever way in you took, one number lands on the transaction, and the rule
behind it is the same on every path: **the amount is the total the receipt
printed.** What differs is how much work a path has to do to get there, because
each of them is handed something different.

**The in-form scan** asks for it outright. `receiptParse` returns `amount` as
the total paid at the bottom of the receipt, along with `amountConfidence` and
`dateConfidence`. One photo, one figure, nothing to reconcile.

**The item pipeline** — `multiImageReceipts` and `receiptItems`, behind Camera
capture — is the awkward one. Its rows are the purchased items and deliberately
nothing else: no tax line, no service charge, no receipt-level discount, because
a row that is not an item breaks the deduplication that grouping several photos
of one long receipt depends on. Adding those rows up therefore misses everything
the receipt charges below the item list. So the prompts ask for `receiptTotal`
as its own field, once per `receiptId` group on the group's last item — the
convention `receiptDetails` already uses — and `consolidateReceiptItems` prefers
it:

| What the model reported | Amount on the row | Flagged |
|---|---|---|
| A total | the total | no |
| A total more than 50% of the larger figure away from the item sum | the total | yes |
| No total | the item sum | yes |

*Flagged* means `fieldConfidence.amount` is set to 0.5, under the 0.7 threshold,
so the review table marks the amount for a second look before the row is
imported. A wildly deviating total is kept rather than replaced: one of the two
figures was misread and the printed one is the likelier to be right, but the
reviewer should see the disagreement either way.

The row's own `confidence` is untouched on purpose. That number averages into
the score the strategy layer compares against 0.4 when deciding whether the
other engine should be tried, and it becomes the `categoryConfidence` the
wizard's category suggestion is coloured by. Neither of those questions is "was
the amount read correctly".

**The regex parser**, the last resort when no model can be reached, has no field
to ask for. It takes the largest figure in the strongest evidence tier it found,
which is the total on all but the odd receipt — with one correction. Where the
receipt was paid in cash, the largest figure is the note handed over rather than
the bill, so a winning figure that is a whole number divisible by five, with two
other figures in the same tier that add up to it, is read as cash tendered and
the larger of that pair becomes the amount. That read lands at 0.75× the tier's
confidence, which is under the threshold in every tier, so it is flagged too.
The rule stands down where the total it would pick is itself round: 450 + 50 =
500 is a total plus change from a note, and a subtotal plus tax, and nothing in
the arithmetic says which. Reading arithmetic rather than words is what keeps
this workable on a receipt in any language.

Two limits are worth knowing about the parser. Anything it read outside the
strongest tier is flagged whatever it picked, because a figure not printed
beside a currency mark is a guess. And it grades only the amount — the date it
reports carries no per-field confidence, so an unreadable date is not marked on
this path. Where Apple's foundation model is available it structures the OCR
text instead of the parser, and reports no per-field confidence at all.

The decision and its rejected alternatives are recorded in
[ADR 0013](ADR/0013-the-printed-total-is-the-amount-not-the-item-sum.md).

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
is asked. The import wizard's file import is the other producer, and it queues
only when both are true: offline, and no engine able to run. Files shared from
other apps (see [share-import.md](share-import.md)) arrive through that same
wizard intake, so a shared receipt follows the file-import rule rather than
adding a third producer. The in-form **Scan
Receipt** queues nothing — as above, it keeps the image on the form and tells
you the scan needs a connection. The queue is one store per device rather than
per account, so that stamp is what keeps it honest — an item is only ever drained
into the ledger of the account that took the photo, and a drain that fires while
someone else is signed in leaves it alone rather than filing it in their ledger.
The share stash carries the same stamp for the same reason: a shared file is
surfaced only to the account that was signed in when it arrived, with a bounded
claim window for shares made signed out (see
[share-import.md](share-import.md)).

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
[ADR 0015](ADR/0015-reclaimed-receipts-replay-idempotently.md).

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
