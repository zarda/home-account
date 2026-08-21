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
other engine should be tried, and the duplicate detector compares it to decide
which of two overlapping rows survives. It is also what colours the wizard's
category chip — but only where the row resolved a category at all; where
nothing resolved one, the chip is graded on what was actually attempted
instead ([ADR 0051](ADR/0051-an-uncategorized-row-is-graded-where-it-is-coerced.md)).
None of those questions is "was the amount read correctly".

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
distinguishable from a deliberate "Other" instead of silently becoming it: an
unrecognized answer leaves the row's category unset, so the import grades it
for review instead of trusting it
([ADR 0046](ADR/0046-an-unrecognized-category-name-is-not-a-category.md)).

**Recognized means recognized here, now.** Every pass of the resolver — the
id, the display names, the English keyword fallback — answers with an entry
that is in this account's catalog and still active, or does not answer. That
is not the same as the prompt only offering active entries, and the difference
is where a bug lived: the model can name a category from its own knowledge
rather than from the list it was given, and a category the user deleted stays
in the merged catalog as an inactive entry so the management screen can offer
to restore it. An answer naming one used to resolve onto it and file the
receipt there, rendering under its real name as though nothing were wrong
([ADR 0053](ADR/0053-a-resolver-answers-with-a-category-that-still-exists.md)).

Where that grading happens is the point. The catch-all the row is filed under
and the number the chip is coloured by are one decision, taken at the import
seam by one shared helper, because they used to be taken on adjacent lines
from different inputs — and the second of them borrowed a number that
described something else. There are three answers, not two: a category that
resolved keeps the extraction's own confidence, an answer nothing could place
is graded for review, and a row **no categorizer ever looked at** is graded
lower still, at the floor the categorization ladder already uses for rows
nobody could answer. The last case is not rare — the fallback parser reads
figures and never looks at what was bought, so every scan it handles lands
there ([ADR 0051](ADR/0051-an-uncategorized-row-is-graded-where-it-is-coerced.md)).

The on-device path is no exception. The vocabulary Apple's foundation model
receives is the same catalog rendering the cloud providers use — active
entries only, translated `id: Name` lines, never the stored i18n keys — and
its answer resolves through the same matcher, ids first, in every shipped
locale ([ADR 0049](ADR/0049-the-model-never-sees-an-i18n-key.md)) — and an
answer that matcher could not place earns the same review grade a cloud
extraction earns for it, rather than the score Vision gave the characters.

## Location and tags

A scan fills two fields beyond the amount, the date and the category, and they
get there in opposite ways: the location is **read off the paper**, and the
tags come from **what the account already uses**. Neither is ever invented. The decision and what it rejected are in
[ADR 0063](ADR/0063-an-import-suggests-only-what-the-account-already-knows.md).

**The location is the branch name and/or street address the receipt itself
prints**, asked for exactly as printed and in the receipt's own script — never
translated, never transliterated, and never inferred from the merchant name,
because a merchant name is not a place and a model asked to guess one will. One
shared fragment carries that wording into all five receipt prompts, and the
on-device model's schema has the same field with the same instruction. The two
item prompts ask for it once per receipt group, on the group's last item, the
convention `receiptDetails` and `receiptTotal` already use.

The answer is checked on the way back, the same split the currency uses:

| Question | Helper | Behaviour |
|---|---|---|
| Did the model read a real code? | `readCurrencyCode` | must be in the ISO table |
| Did the model read a printed place? | `readPrintedLocation` | a string, whitespace collapsed, non-empty, at most 120 characters, and not equal to the merchant name |

The length cut is against a model echoing the whole receipt body into the
field; the merchant-name check is against the one thing the prompt forbids. A
value that fails either is dropped entirely rather than stored as an empty
place, so an absent location keeps meaning "nobody looked".

**In the form, a scan fills an empty Location field and never overwrites a
typed one.** The in-form scan also fetches the device's position when the
receipt's currency was unreadable, to guess a currency from the country. That
position is now *offered* as a chip you can attach — but only when the receipt
is dated today and no coordinate is already on the form, because a fix taken at
home says nothing about where last week's receipt was paid.

**Tags are suggested only from the tags this account already uses**: the tags
on the last six months of transactions, plus what tag memory holds. The ladder
is the category ladder applied to tags — memory first (the user's own past
decisions, read locally, so it works with the AI detail level Off), then the
model for the rows memory could not answer, and only when the detail level is
on, the vocabulary is not empty and a cloud provider is configured. At most
three tags per row. Every answer is checked against the vocabulary twice, in
the provider adapter and again in the service, so a tag the model invented,
translated or respelled is dropped rather than created
([ADR 0046](ADR/0046-an-unrecognized-category-name-is-not-a-category.md)).

Both land somewhere they can be taken off before anything is written: the
wizard's review card shows them as removable chips, and the in-form scan puts
the tags in the chip input and the address in the Location field. Removing a
suggested tag is remembered per merchant and it is not offered again for that
merchant until it is kept again; Settings → AI has the count and a **Forget
all**.

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
- **The on-device reader itself suggests no tags.** It reports a printed
  location like the cloud readers do and proposes no tags of its own. That
  bounds coverage only when no cloud provider is configured: the tag ladder
  runs after whichever engine read the receipt, so memory answers either way
  and the model rung asks whatever cloud key is set up — a receipt read
  on-device still gets suggested tags when there is one.

If a receipt fails for any other reason, that is a bug rather than a limitation.
Be aware that diagnosing one is currently harder than it should be: the app
records that an import succeeded or failed and nothing about which engine ran,
which provider, how long it took, or what class of error occurred.
