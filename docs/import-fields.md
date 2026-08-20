# What an import writes, and how it travels

Every import door builds its transaction through **one mapper**, and every row
shape on the way there carries **optional slots whose absence means "nobody
looked"**. A field a source can answer travels to the stored transaction
without any door naming it; a field a source cannot answer stays absent all
the way down — no empty arrays, no defaulted flags, no `{ name: '' }`.

The decisions behind this shape are in
[ADR 0059](ADR/0059-one-mapper-builds-every-imported-transaction.md) (the
mapper and the widened rows) and
[ADR 0060](ADR/0060-a-confirmed-import-keeps-its-photos-and-names-its-source.md)
(photos and the recorded source). This document is the part you need when
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
`isRecurring` (plus `note` on `ExtractedTransaction` and `merchant` on the
extraction and review shapes). `ProcessedTransaction` also carries
`imageIndex`/`mergedFromImages`, the photo mapping the camera path needs.

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

A bare row produces exactly the six required keys. That key set is spec-pinned;
an undefined-valued key would ride into Firestore, which rejects it.

Callers: `ExportService.parseImportedData` (the data hub) and
`AIImportService.confirmImport` (the wizard, every kind). The wizard composes
`receiptFiles` onto the mapper's output afterwards — the mapper stays pure.

## What travels through which door

| | CSV (data hub) | CSV (wizard) | Receipt photos | Statement photos | Bank PDF | JSON backup |
|---|---|---|---|---|---|---|
| type, amount, currency, date, description | yes | yes | yes | yes | yes | yes |
| note | yes | yes | items list → note | — | — | yes |
| tags, location, period, recurring | yes | yes | when a source fills them¹ | — | — | yes |
| category | catch-all (ADR 0011) | ladder (#258) | ladder / extraction | ladder | ladder | the backup's own |
| photo attached | — | — | **yes** | no (known gap, ADR 0060) | no | no |
| recorded as | n/a | `csv` / `generic_csv` | `image` / `receipt_image` | `image` / `screenshot` | `pdf` / `bank_pdf` | `json` / `backup_json` |

¹ The slots exist end to end; the extraction prompts do not ask for an address
or suggest tags yet — that is #314/#315, which write into these slots.

A mixed wizard batch is recorded as its dominant kind by row count (ties keep
the first processed), sized by every file in the batch. Import History renders
`fileType` as a labelled, iconed chip.

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
