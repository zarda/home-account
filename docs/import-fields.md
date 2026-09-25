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
(what the review step may correct),
[ADR 0063](ADR/0063-an-import-suggests-only-what-the-account-already-knows.md)
(where a suggestion comes from) and
[ADR 0147](ADR/0147-a-row-is-graded-by-what-its-door-can-vouch-for.md) (what
each door's grades may claim). This document is the part you need when
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

`CategorizedImportTransaction` carries thirteen more that are **review-step
marks, not fields**: `currencyFellBack` (nobody read a currency, so the base
currency is standing in), `dateAssumed` (the row's `date` is *now* rather than
something read off the source, because `resolveImportDate` could not vouch
for what arrived — see
[ADR 0074](ADR/0074-a-date-the-scan-cannot-vouch-for-lands-on-today.md)),
`dateImplausible` (set alongside `dateAssumed` when the source value was read
clearly and was still beyond belief — more than a day ahead or ten years
back — rather than unreadable; the one discriminator the review tooltip
checks to pick its wording, see
[ADR 0080](ADR/0080-an-impossible-date-lands-on-today-however-well-it-was-read.md)),
`dateReviewed` (a human answered the date question — set by Keep, by a picked
day and by the bulk Keep, each of which clears `dateAssumed`,
`dateImplausible` and the date's grade in the same move, so an answered row
stops looking flagged and is not asked again; see
[ADR 0100](ADR/0100-a-receipt-dated-before-today-is-a-question-the-reviewer-answers.md)),
`splitFrom` (the row this one was split off from on the review card, set by
**Split** and carried through a merge — the attachment planner keys such a row
on its own id so it uploads its own copy of the photo, and the duplicate
detector never reads rows born of one split as each other's twins; see
[ADR 0106](ADR/0106-the-review-step-splits-a-row-and-merges-two.md)),
`suggestedTags` (what was offered, so the confirm step can
tell a removal from a row that never had any), `recurringMatch` (the rule
this row looks like), `receiptCountry` (the country the reader concluded the
receipt was issued in — it reaches the transaction only inside
`location.country`, and from this mark only when an address was printed;
an attached coordinate writes that field from its own bundled table
instead, see [ADR 0064](ADR/0064-the-country-comes-off-the-paper-before-the-phone.md)) and
`currencySuggestion` (the currency ladder's offer for a fallen-back row —
`AIImportService.currencySuggestionSlot()` fills it and the review card reads
it, while `currencyFellBack` keeps standing; see
[ADR 0064](ADR/0064-the-country-comes-off-the-paper-before-the-phone.md)),
`fileRate` (the conversion a backup row was stored with: its rate, the base
currency it converts into and the currency it converts from — never the
converted figure, because the card can still change the amount; see
[ADR 0147](ADR/0147-a-row-is-graded-by-what-its-door-can-vouch-for.md)),
`importFailure` (the catalog key for why this row's last confirm attempt was
refused, read off the failed write's error, its code first, and cleared by the
edits that set `editedOnCard` below, and on both halves of a split; the
presses that do not mark the row — a selection, a duplicate overruled, a
currency offer dismissed, a recurring link taken or let go — leave it standing;
see [ADR 0149](ADR/0149-the-review-step-says-what-it-changed.md)),
`importAttempts` (how many confirm attempts the row has failed — at two the
wizard hands it back deselected; a split starts both halves again at none, and
a merge its survivor, since none of them is the row that was refused) and
`editedOnCard` (the user changed something on this row on the card, which is
what makes **Remove** ask before it throws the row away; see
[ADR 0149](ADR/0149-the-review-step-says-what-it-changed.md)). None of them
reaches the mapper — it names its fields, and its spec pins that `fileRate`,
`importFailure`, `importAttempts` and `editedOnCard` never come out of it —
and none of them is ever written to a transaction as itself: `fileRate`
reaches the write only as the snapshot the confirm step computes from it,
over the amount actually being written.

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
| `amount` | `importAmount` — absolute, and whole in the row's currency. The four review-row builders call it too, so the figure is already whole by the time it reaches here; the second call is for the offline drain, which has no builder in front of it, and rounding an already-rounded figure returns it ([ADR 0117](ADR/0117-every-doors-figure-is-whole-in-its-currency.md)) |
| `currency` | the row's, else the account's base currency (empty string falls back) |
| `categoryId` | the row's, else the catch-all of the row's own declared type — `other_income` for an income row, `other_expense` for an expense row and for a row that declared no type at all, whatever its amount's sign (empty string falls back) |
| `description` | the row's, else `Imported transaction` |
| `date` | passed through — the review-row builders and the queue drain resolve via `resolveImportDate` before the row reaches here, and the wizard's JSON backup door now does too; the data hub's CSV path still parses and defaults its own |
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
| tags, location, period, recurring | from the file | from the file | `location` when the receipt prints one | `location` when the document prints one | `location` when the document prints one | from the file; a rule link only when this account still holds the rule | `location` when the receipt prints one |
| suggestions (tags, rule link) | — | yes | yes | yes | yes | — | — (no review step) |
| currency marked as fallen back | — | yes | yes | yes | yes | yes | — (the base currency is written, unmarked) |
| category | the file's Category cell, matched exactly; else the type's catch-all (ADR 0150) | the file's Category cell, matched exactly; the ladder for the rest (#258) | extraction, else the ladder | extraction, else the type's catch-all | extraction, else the type's catch-all | the backup's own when this account holds it, on the row's side; else the type's catch-all (ADR 0147) | extraction, else catch-all |
| base-currency rate written | today's | today's | today's | today's | today's | the file's, while the row's currency is still the one it converts from | today's |
| photo attached | — | — | **yes** | no (known gap, ADR 0060) | no | no | **yes** |
| recorded as | n/a | `csv` / `generic_csv` | `image` / `receipt_image` | `image` / `screenshot` | `pdf` / `bank_pdf` | `json` / `backup_json` | a failed attempt only: `image` / `receipt_image`, door `queue` |

The data hub's CSV path has no review step, so it takes no suggestions and
carries no marks. The JSON backup is the one wizard door that takes none
either: its rows already carry what the backup recorded — checked against this
account rather than trusted. A category is kept at 1.0 only when this account
holds it, active, on the row's own side. One it does not hold — deleted since
the backup, from another account, or on the other side — and one the backup
did **not** record are filed under the row's own catch-all and graded 0.3,
the grade 0045 gives a default nobody answered for — the shared mapper's, not
the categorization ladder's own unanswered floor of 0.1 — so the chip's dot
and the low-confidence tally see it
([ADR 0113](ADR/0113-the-wizards-picker-takes-a-backup-and-grades-the-category-it-defaulted.md),
[ADR 0147](ADR/0147-a-row-is-graded-by-what-its-door-can-vouch-for.md)).
While the account's categories have not loaded, the file's id is kept at 0.3:
an empty list can neither vouch for it nor show it wrong. A rule link is kept
only when it names a rule the account holds, paused ones included, and a
failed read of the rules keeps none. The row's rate travels as `fileRate` and
is applied to the row's own amount when it is written, so a split, a merge or
an edited amount is converted at the file's rate rather than written beside a
figure it no longer matches; a row whose currency was changed on the card, or
a file stamped in another base currency, converts at today's rate instead.

A mixed wizard batch is recorded as its dominant kind by row count (ties keep
the first processed), sized by every file still selected when the write runs.
Photos the wizard stored for the offline queue have left the picker by then,
so they count towards neither the record's name nor its size — they produced
no rows here, and the transactions they become are the drain's to record. See
*Offline capture and the queue* in
[receipt-import.md](receipt-import.md#offline-capture-and-the-queue). Import
History renders `fileType` as a labelled, iconed chip.

A receipt attempt's record also carries `door`, `engine`, `fellBackFrom`,
`provider`, `errorType` and `durationMs` — written at extraction time for a
failed attempt by `ReceiptAttemptService`, and at confirm time for a
successful one from `ImportResult.diagnostics`. A record for an import that
completed with at least one row also carries `transactionIds`, the ids it
created, in selected-row order
([ADR 0075](ADR/0075-a-successful-import-remembers-the-transactions-it-created.md)).
A record also carries `totalsByCurrency` — what a write actually landed,
per currency and whole in each, in the order the currencies were first
seen. A record completed before the field existed carries none of it: its
single `totalIncome`/`totalExpenses` pair is a raw sum across whatever the
batch carried, meaningful only for a one-currency import
([ADR 0119](ADR/0119-a-batchs-totals-are-per-currency.md)).

A record may carry **none of the three**. The type requires
`totalIncome` and `totalExpenses`, but `firestore.rules` does not:
`importCreateValid` names six keys with `hasAll` rather than `hasOnly`, and
`importOptionalsValid` requires none of the three — its last clause
validates `totalsByCurrency`'s shape as a list when the field is present,
and says nothing about the legacy pair at all — so a document older than
either field, or one written outside the app, passes the rules and reaches
the component through an unchecked cast. Every in-app writer seeds both, so
this is a shape the rules let through rather than one this app produces. The
history card guards the legacy read at the call site and renders a zero in
the account's own currency, never the word `NaN`
([ADR 0127](ADR/0127-a-figure-the-app-cannot-vouch-for-says-so.md)).
See [receipt-import.md](receipt-import.md#failure-surfacing).

## What a row's grades claim, door by door

A grade says what the door that produced the row can vouch for, and no more
([ADR 0147](ADR/0147-a-row-is-graded-by-what-its-door-can-vouch-for.md)).
The review card colours the category chip from `categoryConfidence`, and the
`low_confidence` tally counts rows under 0.5:

| Door | A category the source named | A category nobody named, or nobody could place |
|---|---|---|
| CSV (data hub) | the file's Category cell, matched exactly over the row's own type ([ADR 0150](ADR/0150-the-csv-reads-back-what-it-writes.md)) — ungraded, since there is no review step | the row's own catch-all; the preview says how many rows land there |
| CSV (wizard) | the same exact match, at 1.0, and the row skips the ladder | the ladder: category memory at 0.95, when the remembered category is on the row's own side — one on the other side is no answer, and the row climbs on; the provider's own grade for an answer it placed; 0.3 for a row it left out, an answer it could not place, or one on the other side of the ledger; 0.1 when no model answered at all |
| Receipt photos | 0.8 when the extraction named one on the row's own side, and the row skips the ladder | the ladder, as above — one named on the other side included |
| Statement photos, bank PDF | 0.8 when the extraction named one on the row's own side | the row's own catch-all at 0.3 — one named on the other side included |
| JSON backup | 1.0 when this account holds the id, active, on the row's own side | the row's own catch-all at 0.3 — or the file's id at 0.3, while the account's categories have not loaded |
| Camera, through the strategy service | the reader's own confidence when its answer resolved on the row's own side | the row's own catch-all at 0.3 when it did not — one named on the other side included; 0.1 when no categorizer looked ([ADR 0051](ADR/0051-an-uncategorized-row-is-graded-where-it-is-coerced.md)) |

Every door files a typed row's suggestion under its own side: the categorizer
refuses an answer on the other side at 0.3, category memory's answer for the
row's merchant is passed over when it sits on the other side, a statement, PDF
or camera extraction's category on the other side is filed as unresolved, the
offline queue's drain, which has no review step, writes the row's own catch-all
in place of one, a receipt photo's extraction-named category on the other side
sends the row to the ladder, the CSV and backup doors take a category only on
the row's own side, and every catch-all on these paths is `other_income` for
income and `other_expense` for an expense
([ADR 0147](ADR/0147-a-row-is-graded-by-what-its-door-can-vouch-for.md)).

The check can only read the side of a category the catalogue holds. So a
category an extraction or category memory named is kept when the catalogue does
not hold it, or has not loaded — neither can show it is on the wrong side. The
categorizer's answer and a backup's id are looked up first: one the catalogue
does not hold goes to the row's catch-all at 0.3 — except that the backup door
keeps its file's id, at 0.3, while the catalogue has not loaded.

And the check holds what the import suggests, not what the reviewer picks: the
card's category menu lists both sides, and flipping a row between income and
expense on the card leaves its category where it was.

The amount and date grades belong to the readers rather than the doors, and
[receipt-import.md](receipt-import.md#where-the-amount-comes-from) has them —
the on-device path's cross-check included. A CSV or JSON row carries neither:
nobody read it, so nothing is graded, and `resolveImportDate` skips its
plausibility window for an ungraded date.

## Photos

At confirm time, `planReceiptAttachments` (in
`receipt-attachment.utils.ts`) resolves each selected row's photos from its
own `imageMetadata`:

- `mergedFromImages` when consolidation merged the receipt (it hardcodes
  `imageIndex` 0 there), else `imageIndex` — deduped, sorted into photo order,
  bounded to the batch, cut at `MAX_RECEIPTS_PER_TRANSACTION`.
- Rows sharing a receipt (same `receiptId`, or identical source images when
  ungrouped) attach on the **first selected row only**. Two receipts printed
  on one photo both keep it — with one exception: two that the reviewer then
  merges together attach that photo once, on the merged row.
- A row the reviewer split off on the card (`splitFrom` set) is keyed on its
  own id, apart from its original's receipt group, so **every part uploads its
  own copy** of the photo — one storage object per transaction id, and one
  quota slot each. A merged row attaches the union of both sides' sources
  under the target's id
  ([ADR 0106](ADR/0106-the-review-step-splits-a-row-and-merges-two.md)) and
  records the receipt groups it absorbed in `mergedReceiptIds`; the planner
  marks those groups attached before it walks any row, whatever order the
  rows arrive in, so a sibling row left behind on the source receipt attaches
  nothing rather than a second copy of the same photo — a second storage
  object and a second quota slot
  ([ADR 0142](ADR/0142-a-queued-receipt-lands-whole-or-says-what-it-dropped.md)).
- The wizard passes the **image subset** of its files — `imageIndex` indexes
  what the extraction ran over, not `selectedFiles`. The camera flow passes
  the `sourceFiles` its capture result handed over via router state.

**The offline drain is the second door that attaches**, and it attaches
through the same planner: it plans over the rows the reader produced, keyed on
the ids it is about to write, and hands the file to the row the plan names.
The block the planner reads is built by one shared helper, `imageMetadataOf`
in `import-dto.utils.ts` — the wizard stamps it onto the review row as it
converts a reader's output, the drain builds it over the same output at drain
time. It is shared because it is the one place that decides **whether a row
has a source at all**: absent where the reader reported neither an image index
nor a receipt id, and otherwise a block naming the photo the row came off and,
where the cloud path reported one, the receipt it belongs to. A condition like
that drifting between two callers is how one door ends up handing a row
someone else's picture while the other hands it none, so there is only one
of it.

A quota refusal (`RECEIPT_IMAGE_LIMIT_ERROR`) saves the row without its photo
and counts it in `receiptsSkipped` on the history record — never in
`errorCount`, whose rows the wizard re-offers for a second confirm. An upload
failure (`RECEIPT_ATTACH_FAILED`) still fails the row.

## What the review step corrects

The review card is the editor for the row, not a preview of it. Every value a
source *read* has a control that changes it in place, and every value the
import *offered* has a control that removes it — that split is the rule, and
it is what step 6 below asks you to decide for a new field. The two suggested
fields now carry both halves: a tag and a location can be taken off *and*
added to or corrected, because the reviewer can know a tag the account's
vocabulary has not learned yet, and can read the receipt's own address better
than the reader did.

Three things follow from a correction, and they are not the same three for
every field: what grade or mark the answer clears, whether duplicate detection
runs again, and whether anything is remembered past the wizard.

| Field | Control | What a correction clears | Detection re-runs | Remembered |
|---|---|---|---|---|
| Date | the date button opens a modal picker seeded on the row's own day; the question chip's **Keep** accepts it as read | `dateAssumed`, `dateImplausible` and `fieldConfidence.date`; sets `dateReviewed` | yes | no |
| Amount | inline editor — Enter or blur commits, Escape cancels. The figure is rounded to the currency's minor unit before it is compared or written (¥179 for 179.33 on a JPY row), and one that rounds to nothing is refused: the editor is held open, marked invalid, and says the minimum the row's currency can hold. The doors already round what they read to the same unit, so this is the same rule applied to a figure the reviewer typed rather than a different one ([ADR 0117](ADR/0117-every-doors-figure-is-whole-in-its-currency.md)) | `fieldConfidence.amount` | yes | no |
| Type | the income/expense toggle | nothing | yes | no |
| Description | inline editor, same commit rules; an emptied field is a cancel | nothing | yes | it becomes the key the category is remembered under |
| Currency | the chip's menu, and the header's **Currency for selected** for the whole selection; each ends with **Other currency…**, a dialog that takes a three-letter code the curated list does not carry, refuses one that is not a currency or that no loaded rate can convert, and applies the answer the way a listed pick is applied | `currencyFellBack` and the standing `currencySuggestion`; the amount is re-rounded to the new currency's minor unit, and one that rounds to nothing leaves the row unfilled — there is no editor to hold open — and raises *1 amount rounds to nothing in …*, the notice the bulk switch raises with its own count | only when the re-rounding moved the amount, on the rule every amount edit follows | no |
| Category | the suggestion chip's menu | nothing — the confidence dot follows the pick and reads as the reviewer's own | no | yes, per merchant, at confirm |
| Notes | a **Notes** button on a row with no note opens a textarea through the card's one editing machine — a row edits one field at a time, notes included — and it files on the way out, on blur; a filed note's box is already on the card, so only a row with none shows the button | nothing | no | no |
| Tags | a remove control on each chip, and **Add tag** over the account's own vocabulary — a native datalist, so what is typed is filed whether or not it is on the list | the tag | no | yes, kept and removed both, per merchant |
| Location / country | one chip with three controls: the name is an inline editor, the country a menu over the bundled table with **No country** on it, and the removal clears both | a picked country clears `receiptCountry` and writes `location.country`; the removal clears `location` and `receiptCountry` together | no | no |
| Row (added by hand) | **Add a row** under the list appends a blank row with its description editor open; Continue and Import wait until it has an amount and a description | nothing — it is born with no grade and no mark to clear | not on arrival while blank (a blank row has nothing to compare; a filled row that appears is checked, as the split row below is), but on every edit to a detection input — date, amount, type or description — so a filled row has been checked | no |
| Row (split) | **Split** in the extras opens an inline amount field; Enter takes that amount into a new row directly under the original, which keeps the purchase's identity — description, date and its marks, currency, type, category, location, tags, photo — and drops notes, the rule link and the verdict, and opens with its description editor focused. The figure taken and the remainder are each rounded to the row's own currency, and the refusal is judged on the rounded remainder; the trigger is hidden altogether on a row worth less than two minor units, since no figure would clear the floor on both halves | `fieldConfidence.amount` on both halves | yes — the original by its amount, the part on arrival; the two are never each other's within-batch twins | no |
| Row (merged) | **Merge into…** lists the other rows in the same currency that have an amount, a description and no standing verdict; the target keeps its id, the amounts net with the type following the sign, tags and photos union, notes join, and the source leaves the batch with everything keyed on its id | `fieldConfidence.amount` on the survivor, whose verdict is written clear | yes, the target — the row that merged away owes none | no |
| Row (removed) | **Remove** in the extras takes the row off the batch, on any row — in one press for a row as it arrived, and after *Remove this row?* for one carrying work made on the card (`editedOnCard`, a split part, or a merge survivor); focus lands on the neighbour's Remove or Add a row | everything keyed on its id — the card's editing state, the wizard's overrule, stamp and verdict, and its entry in the receipt-row set | not for the removed row — nothing left to check — but yes for a survivor whose within-batch verdict named it, since that verdict is now about a row that has gone | no |
| Recurring rule | the offer's checkbox | sets or restores `recurringId` and `isRecurring` | no | no |
| Duplicate verdict | the badge's **Not a duplicate — import it** | `isDuplicate` and `duplicateOf`, reselects the row, and marks it overruled for the rest of the batch | it *is* the overrule | no |

Three mechanics are worth knowing before you add a control here. Every
single-row edit goes through `replaceRow`, which writes a **new row identity**
rather than mutating the `@Input()` object, and the bulk switches, a split and
a merge rebuild the list the same way — a component reading the old object
would otherwise go on displaying it, which is exactly how the category chip
once cached the model's first guess for the life of the card. Anything that settles
the country clears the mark as well as the slot — the chip's remove, and a
country picked from its menu alike: leaving `receiptCountry` behind would let
the mapper's own fallback rebuild the country the reviewer just dismissed or
overruled. And **a control that takes itself off the card names its landing**,
with a landing its own editor can replace naming that editor next: a removal
whose button unmounts with the chip drops focus at the document root
otherwise, and the add trigger it would land on renders only in the `@else` of
its own editor. Editors take their landings from the card's one `EDITORS`
table; a control that is not an editor names its own beside the write
([ADR 0107](ADR/0107-the-review-card-has-one-editing-machine.md)).

The decisions are
[ADR 0099](ADR/0099-the-review-step-edits-what-it-shows.md) for the editors,
[ADR 0100](ADR/0100-a-receipt-dated-before-today-is-a-question-the-reviewer-answers.md)
for the date question and the gate it puts on Continue and Import,
[ADR 0101](ADR/0101-a-corrected-row-is-checked-for-duplicates-again.md) for the
re-check,
[ADR 0102](ADR/0102-the-review-card-adds-a-tag-and-edits-a-location.md) for the
tag field and the location chip, and
[ADR 0103](ADR/0103-the-review-step-adds-a-row-and-the-wizard-is-sealed-while-it-writes.md)
for the hand-added row and the gate it joins,
[ADR 0106](ADR/0106-the-review-step-splits-a-row-and-merges-two.md) for the
split and the merge,
[ADR 0107](ADR/0107-the-review-card-has-one-editing-machine.md) for the one
editing machine and the landings,
[ADR 0108](ADR/0108-the-review-step-removes-a-row.md) for **Remove**, and
[ADR 0109](ADR/0109-a-hand-typed-amount-is-whole-in-its-currency.md) for
rounding a hand-typed figure to its currency.

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
6. Give it a control on the review card, and which control depends on where
   the value came from. A value a source **read** gets an editor that changes
   it in place — a chip that opens a picker or a menu, or an inline trigger
   that swaps for an input — and, if the value is graded, the edit clears its
   `fieldConfidence` entry through `withoutFieldConfidence`. A value the import
   **suggested** gets a remove control in the card's extras area, and an
   editor of its own as well wherever the reviewer can know the value better
   than the source did — which is both suggested fields today — and you decide
   whether a removal is remembered: tags are, and nothing else is.
   Either way the change goes through `replaceRow`, never onto the `@Input()`
   object, and you add a row to *What the review step corrects* above saying
   whether detection re-runs on it. The handler spreads `EDITED_ON_CARD`
   itself, the mark and a cleared `importFailure` — `replaceRow` does not,
   because selection and a duplicate overrule come through it too — and
   returns before it writes when the pick is the value the row already has, so Remove asks before throwing the edit away and
   a choice that changed nothing asks nothing. Decide too what a split part keeps of the
   field and what a merge does with two of it: `splitImportRow` and
   `mergeImportRows` in `import-review.utils.ts` name every field they drop,
   union or take from one side, and a field they do not name rides the
   spread — onto both halves of a split from the original, and onto the
   survivor of a merge from the target alone, the source's value lost.
7. Decide what a row **nobody read** carries for it. `blankImportRow` in
   `import-review.utils.ts` builds the row **Add a row** appends, and it is the
   one producer with no source to learn a value from: absent is the default
   there, and a value has to earn its place. A new optional that the card or
   the write assumes is present needs a line here, or a hand-added row is the
   one shape that breaks it.
