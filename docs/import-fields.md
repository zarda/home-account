# What an import writes, and how it travels

Every import door builds its transaction through **one mapper**, and every row
shape on the way there carries **optional slots whose absence means "nobody
looked"**. A field a source can answer travels to the stored transaction
without any door naming it; a field a source cannot answer stays absent all
the way down — no empty arrays, no defaulted flags, no `{ name: '' }`.

The decisions behind this shape are in
[ADR 0059](ADR/0059-one-mapper-builds-every-imported-transaction.md) (the
mapper and the widened rows),
[ADR 0060](ADR/0060-a-confirmed-import-keeps-its-photos-and-names-its-source.md)
(photos and the recorded source),
[ADR 0062](ADR/0062-the-review-step-can-correct-every-field-the-import-writes.md)
(what the review step may correct) and
[ADR 0063](ADR/0063-an-import-suggests-only-what-the-account-already-knows.md)
(where a suggestion comes from). This document is the part you need when
adding a field, a door, or a suggestion.

## The row shapes

Three shapes carry a row from a reader to the write, with two renames along
the way:

| Shape | Declared in | Role |
|---|---|---|
| `ExtractedTransaction` | `llm-provider.interface.ts` (re-exported by `gemini.service.ts`) | what a reader produced — model extraction or the CSV parser's rows mapped in |
| `ProcessedTransaction` | `ai-types.ts` | the strategy lane's equivalent, produced by cloud or native engines |
| `CategorizedImportTransaction` | `import-history.model.ts` | what the review step shows and the confirm step receives |

All three carry the optional field set `tags`, `location`, `period`,
`isRecurring` and `recurringId` (plus `note` on `ExtractedTransaction` and
`merchant` on the extraction and review shapes). `ProcessedTransaction` also
carries `imageIndex`/`mergedFromImages`, the photo mapping the camera path
needs. `ExtractedTransaction`, `ProcessedTransaction` and the review shape
also carry `receiptCountry`, a mark rather than a field: `printedLocationSlot(name, country)`
files it under a printed address and nowhere else.

`CategorizedImportTransaction` carries five more that are **review-step marks,
not fields**: `currencyFellBack` (nobody read a currency, so the base currency
is standing in), `suggestedTags` (what was offered, so the confirm step can
tell a removal from a row that never had any), `recurringMatch` (the rule
this row looks like), `receiptCountry` (the country the reader concluded the
receipt was issued in — it reaches the transaction only inside
`location.country`, and only when an address was printed) and
`currencySuggestion` (the slot exists and is declared, but nothing populates
it yet — #156 is what builds the currency ladder and fills it, offering what
that ladder finds while `currencyFellBack` stands). None of them reaches the
mapper — it names its fields — and none of them is ever written to a
transaction.

The renames, applied only at the confirm step's call into the mapper:
`suggestedCategoryId` → `categoryId`, `notes` → `note`. Nothing else is named
there, which is the point — a new optional with the same name on both sides
travels with zero edits.

## The one mapper

`toCreateTransactionDTO(row, baseCurrency)` in
`src/app/core/utils/import-dto.utils.ts`:

| Field | Guard |
|---|---|
| `type` | the row's own, else derived from the amount's sign |
| `amount` | absolute value |
| `currency` | the row's, else the account's base currency (empty string falls back) |
| `categoryId` | the row's, else the catch-all (empty string falls back) |
| `description` | the row's, else `Imported transaction` |
| `date` | passed through — callers parse and default first |
| `note`, `tags`, `location`, `period` | spread only when truthy / non-empty |
| `isRecurring` | spread when **present** — `false` is an answer and travels |
| `recurringId` | spread when truthy — an id has no `false` to preserve, and a declined link arrives as a key holding `undefined` |

A bare row produces exactly the six required keys. That key set is spec-pinned;
an undefined-valued key would ride into Firestore, which rejects it.

Callers: `ExportService.parseImportedData` (the data hub),
`AIImportService.confirmImport` (the wizard, every kind) and
`OfflineQueueProcessorService.createTransactions` (the offline queue drain,
which writes without a review step). The wizard composes `receiptFiles` onto
the mapper's output afterwards — the mapper stays pure. The queue drain used
to hand-build a seven-field DTO and dropped everything else the reader filled;
it is the fourth door now, not an exception to the rule.

## What travels through which door

| | CSV (data hub) | CSV (wizard) | Receipt photos | Statement photos | Bank PDF | JSON backup | Queued receipt (offline drain) |
|---|---|---|---|---|---|---|---|
| type, amount, currency, date, description | yes | yes | yes | yes | yes | yes | yes |
| note | yes | yes | items list → note | — | — | yes | items list → note |
| tags, location, period, recurring | from the file | from the file | `location` when the receipt prints one | `location` when the document prints one | `location` when the document prints one | from the file | `location` when the receipt prints one |
| suggestions (tags, rule link) | — | yes | yes | yes | yes | — | — (no review step) |
| currency marked as fallen back | — | yes | yes | yes | yes | yes | — (the base currency is written, unmarked) |
| category | catch-all (ADR 0011) | ladder (#258) | ladder / extraction | ladder | ladder | the backup's own | extraction, else catch-all |
| photo attached | — | — | **yes** | no (known gap, ADR 0060) | no | no | no (follow-up) |
| recorded as | n/a | `csv` / `generic_csv` | `image` / `receipt_image` | `image` / `screenshot` | `pdf` / `bank_pdf` | `json` / `backup_json` | a failed attempt only: `image` / `receipt_image`, door `queue` |

The data hub's CSV path has no review step, so it takes no suggestions and
carries no marks. The JSON backup is the one wizard door that takes none
either: its rows already carry what the backup recorded.

A mixed wizard batch is recorded as its dominant kind by row count (ties keep
the first processed), sized by every file in the batch. Import History renders
`fileType` as a labelled, iconed chip.

A receipt attempt's record also carries `door`, `engine`, `fellBackFrom`,
`provider`, `errorType` and `durationMs` — written at extraction time for a
failed attempt by `ReceiptAttemptService`, and at confirm time for a
successful one from `ImportResult.diagnostics`. See
[receipt-import.md](receipt-import.md#failure-surfacing).

## Photos

At confirm time, `planReceiptAttachments` (in
`receipt-attachment.utils.ts`) resolves each selected row's photos from its
own `imageMetadata`:

- `mergedFromImages` when consolidation merged the receipt (it hardcodes
  `imageIndex` 0 there), else `imageIndex` — deduped, sorted into photo order,
  bounded to the batch, cut at `MAX_RECEIPTS_PER_TRANSACTION`.
- Rows sharing a receipt (same `receiptId`, or identical source images when
  ungrouped) attach on the **first selected row only**. Two receipts printed
  on one photo both keep it.
- The wizard passes the **image subset** of its files — `imageIndex` indexes
  what the extraction ran over, not `selectedFiles`. The camera flow passes
  the `sourceFiles` its capture result handed over via router state.

A quota refusal (`RECEIPT_IMAGE_LIMIT_ERROR`) saves the row without its photo
and counts it in `receiptsSkipped` on the history record — never in
`errorCount`, whose rows the wizard re-offers for a second confirm. An upload
failure (`RECEIPT_ATTACH_FAILED`) still fails the row.

## Suggestions, and what removing one means

Three things on a row are offered rather than taken from a file, and all three
land in the review card's extras area with a remove control. The rules behind
them are in
[ADR 0063](ADR/0063-an-import-suggests-only-what-the-account-already-knows.md);
this is what they do.

| Suggestion | Where it comes from | What has to be true | What is checked |
|---|---|---|---|
| `location` | the branch or address the document itself prints, asked for by the shared prompt fragment and by the on-device schema | a reader that asks — all five receipt prompts and the on-device model | `readPrintedLocation`: a string, non-empty, whitespace collapsed, ≤120 characters, and not the merchant name |
| `tags` | the account's own vocabulary — the tags on the last six months of transactions plus the tags memory holds | memory answers with the RAG level off; the model rung needs the level on, a non-empty vocabulary and a cloud provider | every tag must be in the vocabulary (in the adapter and again in `TagSuggestionService`), and a tag the merchant has had removed before is dropped |
| `recurringMatch` | the account's active recurring rules, read once per batch through `listAll()` | at least one active rule | active, same type, the detector's name ladder, and the detector's amount tolerance when the currencies agree or the row's currency fell back |

**Removing one means it is not written.** There is no rejected state anywhere:
the mapper spreads `location` only when truthy, `tags` only when non-empty and
`recurringId` only when truthy, so an emptied slot is already exactly "nobody
answered". A rule link is offered *unchecked* — accepting it sets `recurringId`
and `isRecurring: true`, declining restores whatever the source said about
`isRecurring`.

**Only tags are remembered.** At confirm, `TagMemoryService.rememberAll`
records per merchant what was kept and what was taken off a suggestion; the
next import of that merchant answers from memory before it asks anything, and
never re-offers a tag that was refused. A tag both kept and removed for one
merchant in one batch records neither. A removed location and a declined link
are forgotten as soon as the wizard closes.

## When you add a field

1. Give the row shapes the optional slot, same name in all three, absent by
   default — no producer invents a value.
2. Fill it in the producer that learned it, with a conditional spread.
3. If the CSV export writes it, give `parseCSV` a probe on the optional
   contract (out of the row-length guard, double-guarded, validated) and add
   it to the round-trip spec that exports every optional field and re-imports
   the bytes.
4. Do **not** touch the confirm step or `parseImportedData` — if you had to,
   the mapper stopped being the chokepoint.
5. Update the matrix above and `csv-format.md`'s tables.
6. If the value is a suggestion rather than something a source read, render it
   in the card's extras area with a remove control, and decide whether a
   removal is remembered — tags are, and nothing else is.
