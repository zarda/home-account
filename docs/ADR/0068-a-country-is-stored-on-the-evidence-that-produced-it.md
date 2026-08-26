# 68. A country is stored on the evidence that produced it

**Status:** Accepted, implemented · **Date:** 2026-08-26 · **Issues:** #155

Amends [0064](0064-the-country-comes-off-the-paper-before-the-phone.md), whose
ladder and validation stand unchanged; only its decision to withhold a
country with no printed address is reversed. Keeps the mapper chokepoint
[0059](0059-one-mapper-builds-every-imported-transaction.md) set, and the
review-step correction rule
[0062](0062-the-review-step-can-correct-every-field-the-import-writes.md).
Reference documentation is in [../receipt-import.md](../receipt-import.md)
under *Country and currency* and *Location and tags*.

## Context

0064 gave the app a country. It asked five receipt prompts for one, validated
it through `Intl.Locale` and `Intl.DisplayNames`, bundled a bounding-box table
so a coordinate could be placed on device, and built a four-rung ladder that
offers a currency without ever applying one. All of that stands.

What it did not do is store the country unless a printed address came with it.
Its rejected-alternatives section says why, in three clauses:

> **Writing `location.country` without a name.** The rules accept a nameless
> location map; the type, the form's `locationField` and the review chip all
> assume a name, and a country alone renders as nothing anywhere.

Its *Known gaps* then names the cost: "A country with no printed address is
never stored... 'What did the trip cost' is still not answerable from the
country field." A receipt that reveals where it was issued through a tax
number, a phone format or its own script produced a suggestion and nothing in
the document.

Each of those three clauses is a premise about the code, not a principle. This
record removes all three, which is why it amends 0064 rather than contradicting
it: the objection's premise is gone, so the objection no longer holds.

## Decision

**A country is written by the evidence that produced it, and every location
that is stored can be read.**

### A location map must say something, and a country is enough

`TransactionLocation.name` becomes optional. The invariant that replaces it —
at least one of `name` or `country` — lives in one builder, `locationSlot()` in
`import-dto.utils.ts`, which every door now goes through. `printedLocationSlot`
delegates to it, so the receipt readers keep the name they call it by.

That builder refuses two shapes a truthy spread waves through: `{}` and
`{ name: '' }`. The second is a hole `toCreateTransactionDTO`'s own comment had
named for as long as it existed. It also refuses a bare coordinate pair, which
nothing renders.

`receiptCountry` rides `ImportRowFields` as the one review-step mark permitted
to become a document field. That is a deliberate exception to 0064's "the
mapper names its fields, so the mark cannot reach a document" — every other
mark describes how confident the app is, and a country is a fact about the
receipt.

### The rules are the only thing that can refuse a location saying nothing

0064 cited "the rules accept a nameless location map" as a hazard. Now that a
nameless map is legal, `{}` and `{ lat, lng }` are the shapes to refuse, and
`txOptionalsValid` refuses them, along with a blank name. `lat` and `lng` gain
type checks in the same clause: they were never individually validated, and a
nameless location is exactly the shape where a bad coordinate would be the only
other content. That widening goes beyond #155 and is named here so it is not a
silent change.

### A country is written by the evidence that produced it

The form keeps `scanCountry` — the receipt's own claim — separate from
`printedLocationCountry`, which stays gated on the Location field still holding
the paper's address. The gate is right for a name the user typed: that is their
own answer to "where", and the paper's country does not attach to it. It is
wrong for a country that never came from an address at all.

Accepting a currency chip still writes no country. For the `receipt` rung the
question is moot — the country reaches the document because the receipt said
so. For the `position` and `locale` rungs the answer is no: writing `TW` onto a
Korean receipt because the phone is in Taiwan is the exact failure 0064 was
written to stop. The position rung's "dated today" gate licenses a
*suggestion*, not a fact in the ledger.

Correspondingly, `removeLocation` in the review card now clears `receiptCountry`
as well. The mapper rebuilds a location from that mark, so clearing the slot
alone let a country the user had just dismissed walk back in.

### A stored country renders, and aggregates

`locationLabel()` answers for both shapes: the name when there is one, else the
country's own name in the active language. A pipe carries it to the three
places a location renders. It is impure and memoized like `LocaleNumberPipe`,
because the locale is not a pipe input and a pure pipe would keep naming the
country in the boot language after a switch.

The country rollup in Reports is the reader the field never had. It ranks the
countries an expense records and reports the rest as a coverage line rather
than ranking an "unknown" bucket that would sit first forever. Each row's share
is against the placed spend, not the period total, or every share would shrink
as unplaced history grows.

The transactions filter gains a country, server-side.

### The alternatives that were rejected

- **Synthesizing a display name into `location.name`.** It bakes one language's
  answer into the document — a row written on a Japanese phone would read 韓国
  on an English one — and it lies about provenance: `location.name` means "the
  place the receipt printed" everywhere else, and a synthesized one would be
  indistinguishable from a name the user typed.
- **A client-side country filter, like tags.** `TransactionFilters`' own
  comment on `goalId` explains why a sparse filter cannot be client-side: the
  windowed pager applies client-only filters per fetched page, so a sparse match
  renders near-empty pages and costs the header its exact count. Country is the
  sparsest filter the app has.
- **A trip grouping rather than a country rollup.** A trip needs a definition —
  a gap threshold, a home country, a rule for a one-day border crossing — and
  the home country is not a stored fact; the account has a base currency, not a
  country. That is a second inference layer on a field with no data in it yet.
  The rollup is its prerequisite.
- **A tab of its own for the rollup.** A `REPORT_TABS` entry, a `?tab=` value
  and a deep-link contract, for a card that is empty on every existing account.
- **A `Country` column in the CSV export.** `../csv-format.md` states the
  contract: the place name only; coordinates and the country stay in the JSON
  backup. Changing a documented round-trip for a field almost no row carries is
  not worth it, and the JSON backup already carries it verbatim.
- **Persisting the currency-provenance flag.** #155's text asks for a flag
  distinguishing a fallback currency from a read one. It exists, as review-step
  state, and no acceptance criterion needs it stored. A stored flag would be a
  new document field with no reader — the exact mistake this record is fixing
  for `location.country`.
- **Flag emojis in the rollup.** The code-to-regional-indicator transform
  renders as bare letters on Windows and would be a fifth place the app decides
  what a country is.

## Consequences

- **No backfill. Nothing runs against existing data.** There is nothing to
  derive a country from for an existing row: a stored `location.name` is free
  text in the receipt's own script, and inferring a country from it is the same
  guess `readPrintedLocation` refuses at the other end. Rows carrying
  coordinates *could* be run through `countryForCoordinates`, and are not:
  `country-bounds.ts`'s own header says the table is fit for "a *suggested*
  currency the user accepts or ignores, never a stored value", and a backfill
  would make it a stored value for thousands of rows at once while moving
  `updatedAt` on every one. The rollup's coverage figure therefore starts at
  zero and grows forward only, and its empty state says so.
- **The transaction indexes go from 30 to 62.** `check-firestore-indexes.mjs`
  requires every non-empty subset of the equality fields in both date
  directions, so a fifth field doubles the set. That is well inside Firestore's
  200-index limit, but it roughly doubles index storage and write amplification
  on every transaction write. This cost was not visible when the work was
  planned and is recorded rather than absorbed silently.
- **`lat`/`lng` are now type-checked by the rules.** A client writing a string
  latitude was previously accepted.
- Every import door gained the country with no call-site change, which is the
  property 0059 exists for.

## Things that only became apparent while building

- **`printedLocationSlot` had three callers, not one**, and each already rode
  `receiptCountry` beside it as a separate mark. That made the mapper's
  `location?.country ?? receiptCountry` fallback exact rather than a guess, and
  meant the review row could gain a uniform location shape for free.
- **The JSON backup path would have dropped the new shape silently.**
  `importFromJSON` gated its location on `.name` being truthy, so a backup taken
  after this change would have re-imported without the country it stored. Two
  neighbouring doors built a location by hand as well. All three now go through
  the builder, which also means an untrusted backup loses a malformed location
  rather than losing the transaction under it.
- **`tsc --noEmit -p tsconfig.json` does not see the component sources.** The
  optional-`name` change type-checked clean there and failed in the Angular
  compiler. Component work has to be verified with `ng test` or `ng build`.
- **`Intl.DisplayNames` names `ZZ`** — "Unknown Region" — so it is useless as a
  probe for "a region the runtime cannot name"; `readCountryCode` refuses `ZZ`
  up front for exactly that reason. `XX` is unassigned and genuinely unnamed.
- **The macroregion tradeoff now has the reader it was waiting for.**
  `readCountryCode`'s comment predicted that a country rollup would be the read
  to first face `EU` and `QO`. It is, and CLDR names both, so such a row reads
  as a coarser answer rather than a blank one.

## Known gaps

- **The country filter's dropdown lists the bundled table's countries**, about
  eighty, not every region CLDR names. ADR 0008's discipline is that no country
  list ships, and that one already exists for the currency ladder. A receipt can
  name a region outside it; a selected value outside the list is kept so an
  arriving filter stays clearable, but such a country cannot be picked from
  scratch.
- **The composite indexes are declared, not deployed.** The emulator does not
  enforce them, so the country filter passes the smoke suite while being broken
  in production until `firebase deploy --only firestore:indexes` runs. See
  [../emulator-blind-spots.md](../emulator-blind-spots.md).
- **The rollup converts with `CurrencyService.convert`**, matching the tab it
  sits in rather than the `amountInBase` snapshot other tabs use. A period whose
  rates have since moved is therefore reported at today's rates.
- **A country still cannot be edited by hand.** It arrives from a scan or a
  coordinate; the Location field edits the name only. Removing the location is
  the only way to remove a country.
- **Nothing exports it.** The CSV contract is unchanged by choice, so a country
  reaches a spreadsheet only through the JSON backup.
