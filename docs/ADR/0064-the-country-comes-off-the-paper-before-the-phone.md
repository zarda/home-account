# 64. The country comes off the paper before it comes off the phone

**Status:** Accepted, implemented · **Date:** 2026-08-23 · **Issues:** #156

Takes on the `country` field
[0063](0063-an-import-suggests-only-what-the-account-already-knows.md)
deferred, and keeps the rule
[0062](0062-the-review-step-can-correct-every-field-the-import-writes.md)
set for the review card: a currency is offered per row and never applied in
bulk. Reference documentation lives in
[../receipt-import.md](../receipt-import.md) under *Country and currency*,
with the row shapes in [../import-fields.md](../import-fields.md).

## Context

A receipt whose currency the model could not read falls back to the account's
base currency, and the only better guess the app made came from the phone's
*current position*: one bundled table of bounding boxes, consulted by the
in-form scan and nowhere else. That answers "where is the phone now", which is
not the question. The question is where the money was spent, and the feature's
own audience scans a week of Korean receipts at home — every one of them
confidently placed in Taiwan.

The better evidence was already in the room and discarded:

- **The model had already inferred the country.** `CURRENCY_FIELD` told every
  receipt prompt to read the currency from "the printed symbol, an explicit
  code, or the receipt's own language and country". The model looked at an
  address, a tax number, a phone format and a script, concluded a country, and
  was never asked to say which.
- **The receipt's date said whether the position was evidence at all.** A fix
  taken today says nothing about where last Tuesday's receipt was paid, and
  the form fetched it regardless.
- **The user had just answered the same question.** Twenty receipts from one
  trip fall back twenty times; correcting the first taught the second nothing.
- **The device's locale carries a region** that `translation.service.ts`
  reads and throws away, keeping only the language subtag.

Two guarantees from the position work could not move: no coordinate leaves
the device, and a currency the model actually read is never overridden.

## Decision

**The country comes off the paper first, and every weaker signal speaks only
when a stronger one did not.**

### The receipt is asked for its country

One `COUNTRY_FIELD` fragment sits beside `CURRENCY_FIELD` in all five receipt
prompts and on the on-device `ReceiptExtraction` struct as a `@Guide`. It asks
for the ISO 3166-1 alpha-2 code of the country the receipt was *issued in*,
concluded from the printed address, the tax or registration number, the phone
number format, the currency symbol and the receipt's own language — and for
`""` when it cannot tell, never a default. The two item prompts carry it once
per receipt group, on the group's last item, the convention `location` and
`receiptTotal` already use. The fragment lists no codes: a prompt that named
the countries it expected would steer every other one towards them
([0008](0008-universal-receipt-language-support.md)), and `prompts:check`
would not notice, because a run of two-letter codes matches neither of the
patterns it hunts for. `prompt-registry.spec.ts` pins a regex against such a
run in every receipt prompt; that spec and review are the only guards, and
that is written here so nobody assumes the checker covers it.

### A country is validated, never defaulted

`readCountryCode` in `receipt-extraction.utils.ts` accepts exactly two
letters, upper-cases them, canonicalizes the result through `Intl.Locale`'s
own region resolution — which folds `UK` to `GB` and the rest of CLDR's
deprecated-territory aliases to whatever replaced each one — and round-trips
what survives through `Intl.DisplayNames([...], { type: 'region', fallback:
'none' })`; anything the runtime's region table does not name is `''`, and so
is `ZZ`, refused before the lookup even runs because CLDR names it "Unknown
Region" rather than refusing it outright. No list ships, the same discipline
as `readCurrencyCode`. `COUNTRY_CURRENCY` — the one country-to-currency map
the app keeps — is now exported and pinned entry by entry against both
`Intl.supportedValuesOf('currency')` and `readCountryCode`; before this, ten
of its seventy-nine rows were checked and a typo in any of the other
sixty-nine would have become a wrong suggestion rather than a null.

### The country is a mark, and only a printed address carries it

`receiptCountry?` rides every row shape — `ParsedReceipt`,
`ExtractedTransaction`, `ProcessedTransaction`,
`CategorizedImportTransaction` — as review-step state, like `currencyFellBack`.
The mapper names its fields, so the mark cannot reach a document. The only
stored home for a country is `location.country`, and it is filled by
`printedLocationSlot(name, country)` exactly when a printed address gives the
location a name. `TransactionLocation.name` stays required; a receipt that
prints a tax number and no address yields a suggestion and no stored country.

### One ladder, and the first rung that speaks wins

`suggestCurrency(evidence)` in `currency-suggestion.utils.ts` is pure: it
takes `{ receiptCountry, positionCountry, datedToday, sessionCurrency,
localeRegion, currentCurrency }` and returns `{ code, country, reason }` or
`null`. The rungs, top first:

1. **`receipt`** — the country read off the paper, through
   `currencyForCountry`.
2. **`position`** — the phone's country, only when `datedToday`. The form does
   not even fetch a position for an older receipt, so a scan of a backlog
   never prompts for location. A coordinate the receipt itself carries
   (an attached location) is the receipt's own place and counts whatever the
   date.
3. **`session`** — the last currency the user chose for a fallen-back row in
   this session; this rung carries no country.
4. **`locale`** — the region of `new Intl.Locale(navigator.language).maximize()`.

A rung whose country `currencyForCountry` does not cover is silent, and the
next one speaks. The first rung that does answer ends the ladder right
there — even when its code equals the row's current currency, which offers
nothing rather than letting a weaker rung underneath get a turn at breaking
the tie. The wizard's ladder has no position rung at all: a batch reviewed on
a desk has no position worth asking for.

### The session remembers a choice, and only the session

`CurrencyChoiceSessionService` is a root service holding one code in memory.
It is written when a chip is accepted or a fallen-back row's currency is
edited — in the form or on the review card, singly or in bulk — read by the
session rung, and cleared on sign-out. It is not persisted: a trip is not a
per-merchant fact, so the memory collections' shape does not fit, and a
collection of its own is a cascade step, a catalogue row, a rules block and a
settings card ([0029](0029-every-stored-kind-has-one-door.md)) for a value
that is stale by the next trip.

### The suggestion says why

The form's chip reads "Looks like {country} — use {currency}?" with the
country named by `Intl.DisplayNames` in the active locale, and a second line
naming the rung that answered. The review card carries the same chip per
row in its extras area; accepting goes through the existing `updateCurrency`,
which clears `currencyFellBack` and records the session choice, and
dismissing drops the mark. The bulk action is untouched: it applies what the
user chose, never what a rung guessed.

### Every door arrives carrying the same marks

The camera dialog used to build its own review rows and lost
`currencyFellBack` and `location` doing it; it now hands the strategy result
to `AIImportService.convertStrategyResultToCategories`, so the country and
the suggestion reach its review card like the wizard's. The offline queue
processor, which hand-built a seven-field DTO, now builds through
`toCreateTransactionDTO`
([0059](0059-one-mapper-builds-every-imported-transaction.md)); location,
tags, period and the recurring flag travel on that door for the first time.

### The alternatives that were rejected

- **Fusing the signals and suggesting nothing on conflict.** The issue asked
  for agreement between timezone, locale and history, and silence otherwise.
  The signals are not peers: a country read off the receipt is evidence about
  the receipt, and the rest are evidence about the phone or the person. A
  vote would let two weak signals outshout the one strong one, and "conflict
  means silence" would suppress the receipt's own answer whenever the user
  had travelled. An ordered ladder states the precedence once.
- **A timezone rung.** There is no zone-to-country table in the app or in
  `Intl`, and the zone is not independent of the position rung — a phone in
  Seoul reports `Asia/Seoul` because of the same fix. Bundling four hundred
  zones for a signal the position already carries was not worth the table.
- **Borders instead of boxes.** A polygon set fixes the border cases of the
  position rung, which is now the second rung and only speaks for a receipt
  dated today. The receipt rung has no border problem.
- **A persisted correction memory.** See *The session remembers a choice*.
- **Asking for the country inside the currency answer.** Tempting — the model
  reasons from the country already — but one field holding two facts cannot
  be validated as either, and a country with no readable currency is a real
  case (a receipt printing a symbol the model cannot place).
- **Writing `location.country` without a name.** The rules accept a
  nameless location map; the type, the form's `locationField` and the review
  chip all assume a name, and a country alone renders as nothing anywhere.
  The suggestion carries it instead.
- **Applying the suggestion in bulk.** 0062's reasoning stands: that is the
  guess, twenty times, unasked.

## Consequences

- **Five prompts grew one field and the on-device schema grew one `@Guide`.**
  The registry spec asserts the fragment in each; `prompts:check` cannot see
  a country list, so the rule against one lives in this record, in the spec's
  regex and in review.
- **A scan of an old receipt no longer asks for location.** The geolocation
  fetch is gated on `datedToday` before the ladder runs, so a backlog scanned
  at home prompts for nothing and suggests from the paper.
- **The camera path's review card now shows what the wizard's does** —
  fallen-back mark, printed address, country suggestion — because it stopped
  building rows of its own.
- **The offline queue writes fuller rows**, and the photo is still not among
  them (*Known gaps*).
- **No rules change.** `location.country` was already validated as a two-letter
  string over an open key set; nothing new is stored.

## Departures from the issues

- **A ladder, not a fusion.** #156's second point asked for the free signals
  to be combined and for conflict to produce no suggestion. The ladder above
  ranks them instead, for the reason given under the rejected alternatives:
  the receipt's answer is about the receipt and should not be outvoted by
  signals about the phone.
- **Borders and a persisted memory are not here.** Points 4 and 5 of the
  issue are recorded as rejected, with the cost of each, rather than deferred.
- **A correction is kept for the session, not learned.** The issue's "a user
  correction is not thrown away" is met for the batch and the sitting, not
  across launches.

## Things that only became apparent while building

- **The runtime's region table lies by default.** `Intl.DisplayNames.of()`
  returns its *input unchanged* for a well-formed code it has no name for,
  under the default `fallback: 'code'` — so `'AA'` reads back as a country
  called AA. The reader has to ask for `fallback: 'none'` explicitly, and
  `ZZ` still needs a refusal of its own on top, because CLDR does name it:
  "Unknown Region".
- **`UK` is not a country code, and it is the answer a British receipt
  invites.** CLDR names it, so it passed validation and then silently lost
  the GBP suggestion `GB` would have produced — a wrong answer that looked
  like no answer at all. Canonicalizing through `Intl.Locale`'s own region
  resolution fixed it, and folds the whole deprecated-territory alias table
  as a side effect (`SU`→`RU`, `AN`→`CW`, `ZR`→`CD`). A brute-force pass over
  all 676 two-letter combinations turned up eleven further codes the
  canonicalization resurrects from rejected to accepted-as-something-else,
  two of which (`NT`→`SA`, `PZ`→`PA`) land on live `COUNTRY_CURRENCY`
  entries — all defunct territories no OCR will ever produce, but a wider
  table than the six aliases the first pass named.
- **There is no runtime way to tell a country from a macroregion.**
  `Intl.supportedValuesOf('region')` does not exist — it throws — and
  `Intl.Locale` exposes no containment or grouping, so `EU`, `UN`, `QO` and
  the pseudo-locales stay acceptable to the reader; only a maintained list
  would exclude them, which is the thing this file is built not to keep.
  They cost nothing downstream: none is a `COUNTRY_CURRENCY` key, so the
  ladder simply finds nothing for them, the same fallback an unplaceable
  code already gets.
- **A geometry probe can quietly stop measuring what it claims to.** The
  review card's overflow spec stubs translation as "return the key", on the
  grounds that a key is longer than the English it stands for. True until
  the offer chip started interpolating a country name into a sentence — at
  which point the real string ran about 1.5× the key, the probe kept
  measuring the shorter one, and the chip overflowed the 288px card with the
  guard reading green.
- **The same "first answer or final answer" question was got wrong twice,
  independently.** The form and the review card each cleared the "this row
  fell back" state in the same write that recorded the user's choice, so a
  correction after a correction recorded nothing and the session kept the
  user's first guess. Both needed the visible marker and the eligibility to
  record a choice split apart — `scanCurrencyFellBack` in the form,
  `fellBackEligible` on the review card.

## Known gaps

- **A country with no printed address is never stored.** `location.country`
  needs `location.name`, so a receipt that reveals its country through a tax
  number alone produces a suggestion and nothing in the document. "What did
  the trip cost" is still not answerable from the country field.
- **There is no timezone rung**, for the reasons above. A phone with location
  refused, an unreadable receipt, a fresh session and an `en` locale with no
  region gets no suggestion.
- **The session memory does not survive a relaunch.** Scanning a trip across
  two sittings answers the first row of the second sitting from the paper or
  not at all.
- **The offline queue still drops the photo.** The row now carries every field
  the mapper knows, but the queued image is not attached to the transactions
  it produced — filed as its own issue.
- **The on-device `country` field is compile-checked only.** Like `location`
  in 0063: the `@Guide` builds, no device with Apple Intelligence has run it,
  and the iOS test target does not reference `ReceiptExtraction` at all. An
  older binary omits the key and `readCountryCode` reads that as "nobody
  looked".
