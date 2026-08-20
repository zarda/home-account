# 59. One mapper builds every imported transaction

**Status:** Accepted, implemented · **Date:** 2026-08-20 · **Issues:** #313, #319

Amends [0011](0011-the-csv-file-is-a-contract.md), whose "Known gaps" predicted
exactly this defect: nothing enforced that a column added to the writer also
got a probe on the importer, and nothing enforced that a field carried by one
import door was carried by the other. Reference documentation lives in
[../import-fields.md](../import-fields.md).

## Context

A transaction created by photographing a receipt was thinner than one typed by
hand. The wizard's confirm step built its DTO by naming fields:

```ts
const dto: CreateTransactionDTO = {
  type: txn.type,
  amount: txn.amount,
  currency: txn.currency || baseCurrency,
  categoryId: txn.suggestedCategoryId || 'other_expense',
  description: txn.description || 'Imported transaction',
  date: transactionDate,
  note: txn.notes
};
```

while the data hub's CSV path already carried `note`, `tags`, `location`,
`isRecurring` and `period` through `parseImportedData`. So the app had two
hand-written guard lists for the same write, and a field added to one door
reached exactly that door. Nothing upstream could supply the missing fields
either: none of the row shapes the pipeline carries — `ExtractedTransaction`,
`ProcessedTransaction`, `CategorizedImportTransaction` — had slots for them.

The same five lines hid two more defects:

**Every wizard CSV row imported as income.** `parseCSV` pushes
`amount: Math.abs(amount)` with the type resolved separately, and the wizard's
mapper re-derived the type from the sign of that always-positive amount:

```ts
type: t.amount >= 0 ? 'income' : 'expense',
```

The spec stubs fed signed amounts the real parser never emits, so the suite
stayed green while every real expense row re-typed itself.

**The export wrote three columns the importer never read.** `Note`, `Tags` and
`Location` had no probe in `parseCSV` — and `docs/csv-format.md` claimed all
three round-tripped, so the doc was not merely silent about the loss, it
asserted the opposite.

`CategorizedImportTransaction.merchant` was the precedent for the pattern: a
declared slot no producer ever assigned. Every extractor reports the merchant;
`categorizeTransactions` folded it into `originalText`, which nothing reads.

All of this survived because the confirm-step fixtures were deliberately
narrow — no optional field, no assertion on `dto.note`, `dto.type` or
`dto.amount` — so the DTO could shed or invent fields without failing anything.

## Decision

**One mapper builds every imported transaction.**
`toCreateTransactionDTO(row, baseCurrency)` in `import-dto.utils.ts` owns the
guards — sign-derived type fallback, absolute amount, currency and category
fallbacks, the description default, and the conditional spreads that keep an
absent optional absent. `parseImportedData` delegates to it; the wizard's
confirm step calls it with only its renames (`suggestedCategoryId` →
`categoryId`, `notes` → `note`) and no field list, so a future optional
travels through both doors with zero edits at either.

**The row shapes carry slots for what a source can answer, and absence means
nobody looked.** `ExtractedTransaction`, `ProcessedTransaction` and
`CategorizedImportTransaction` gain optional `tags`, `location`, `period` and
`isRecurring` (plus `note` on the extraction row). No producer defaults any of
them; every copy is a conditional spread, so no empty array, no `{ name: '' }`
and no undefined-valued key ever reaches Firestore.

**The importer reads back what the exporter writes.** `parseCSV` gains `note`,
`tags` and `location` probes on the exact contract Currency and Period
established in 0011: outside the row-length guard, double-guarded per row,
validated rather than trusted. Tags split on the export's own `'; '` join; a
location cell becomes `{ name }` only — the file never carried coordinates, so
none may be invented.

**The parser's type wins over the sign.** The wizard mapper uses
`t.type ?? (t.amount >= 0 ? 'income' : 'expense')`; the sign fallback remains
for bank CSVs that have no Type column and signed amounts.

**`merchant` is populated, not removed.** Producers already report it and
consolidation already carries it; the slot is the key the tag- and
location-suggestion work (#314, #315) will match on. Removing it would have
orphaned that.

### The alternatives that were rejected

- **Widening the hand-written DTO in place.** It fixes the six fields of the
  day and leaves the mechanism: two guard lists that drift. The next field
  added would face the same seam.
- **Renaming the row fields to the DTO's names** so the row could be spread
  straight into the DTO. Touches every producer and template for a rename with
  no behavior, and `notes`/`suggestedCategoryId` are load-bearing names across
  the review UI.
- **Removing `merchant`.** Satisfies the letter of "populated or removed" and
  deletes the join key the next two issues need.
- **Splitting tags on bare `;`.** Reads a `'; '`-joined cell just as well, but
  turns a legitimate semicolon inside a single tag into two tags more often,
  and the export's own join is the only contract worth matching.

## Consequences

- `ai-import.service.ts` no longer names a DTO field anywhere; both import
  doors write through `import-dto.utils.ts`, and the data-hub path's two guard
  differences were unified deliberately: an empty-string `categoryId` now
  falls back (`||` where it had `??`), and the description fallback applies —
  both unreachable through `parseCSV`, which defaults `'Unknown'` first.
- A CSV exported with notes, tags and locations restores all three on
  re-import, through either door. The round-trip spec exports a transaction
  carrying every optional field and asserts the DTO deep-equals it.
- The wizard's CSV path keeps `period` and `isRecurring`, closing the gap
  `docs/csv-format.md` had recorded as known; its matrix row for
  note/tags/location is now true instead of aspirational.
- The mapper's bare-row key set is pinned exactly — six keys — so an
  undefined-valued optional cannot ride toward Firestore again.
- A CSV `Note` cell no longer routes through `formatItemNotes`, which splits
  plain commas into newlines; it lands verbatim.
- `categorizeTransactions` and its multi-image and strategy siblings copy
  `merchant`, `tags`, `location`, `period` and `isRecurring` conditionally, so
  the JSON backup door restores them too.

## Things that only became apparent while building

- The export→import round-trip harness already existed
  (`export.service.spec.ts`, `reimport()`); what was missing was only the
  cases. #319's "no spec round-trips an export" did not survive contact with
  the code.
- `Note` was a third dropped column the issue never named. The round-trip
  acceptance criterion ("every optional field") is unsatisfiable without a
  `note` probe, and the reference doc already promised it — so the code caught
  up with the doc rather than the doc being corrected down.
- The type inversion was invisible precisely because the CSV stubs in the
  wizard-path spec fed signed amounts; reshaping the fixtures to parser-real
  rows (absolute amount plus explicit type) is what exposed it.
- `ExtractedTransaction` is declared in `llm-provider.interface.ts` but
  imported everywhere through the `gemini.service.ts` re-export barrel;
  widening the declaration propagates, but a reader grepping for consumers
  must follow the barrel.

## Known gaps

- **A tag containing the literal `'; '` cannot round-trip.** The join
  separator is indistinguishable from a boundary on the way back. That is a
  separator choice, not a quoting bug — the escaper already protects commas,
  quotes and newlines — and it is recorded in `docs/csv-format.md`.
- **Category stays export-only, deliberately.** 0011 and
  [0046](0046-an-unrecognized-category-name-is-not-a-category.md) own that
  decision; the wizard's suggestion comes from the categorization ladder, not
  the file.
- **`originalText` still has no consumer.** The merchant now travels as its
  own field, but the concatenated string remains written and unread; removing
  it belongs to whatever finally renders or drops it.
