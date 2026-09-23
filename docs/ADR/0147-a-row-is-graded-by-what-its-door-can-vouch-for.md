# 147. A row is graded by what its door can vouch for

**Status:** Accepted, implemented · **Date:** 2026-09-24 · **Issues:** #428, #429

Reference documentation lives in [../import-fields.md](../import-fields.md) and
[../receipt-import.md](../receipt-import.md).

This record takes #428 whole and the third part of #429, the merged count,
because it is the same path: the row a reader produces, the category it is
filed under, the grades it carries onto the review card, and the marks the
card counts.

## Context

Every import door is meant to grade what it could not vouch for
([0045](0045-a-confidence-grade-names-its-source.md)) and to categorise from
the one catalogue rendering the providers share
([0049](0049-the-model-never-sees-an-i18n-key.md)). Seven places still did
not, and each had already been written down as somebody's known gap.

**A receipt was offered income categories.** `buildCategoryPromptCatalog`
filtered on activity, not type, so the on-device model reading a supermarket
receipt was shown *Salary* beside *Groceries* — 0049's second gap. The batch
categoriser rendered the same list for both of its callers: the multi-image
ladder, whose receipt lines are purchases but for the odd refund, and the
wizard's CSV ladder, where a batch mixes both sides of the ledger. And the
catch-all was one id, `other_expense`, for every row: an income row nothing
could categorise was filed as an expense, although the catalogue ships
`other_income` beside it.

**The on-device model's total carried no grade.** Apple Intelligence
structures the OCR text itself and returns no confidence of any kind, so a
figure it misread reached the review card looking exactly like one it read
well. [0013](0013-the-printed-total-is-the-amount-not-the-item-sum.md) named
it: on the path preferred on recent iPhones, "neither the demotion nor the
amount flag exists".

**The single-summary prompt could not grade its date.** `receiptSummary`
asked for no `dateConfidence`, and its Gemini mapping carried the zero-only
shape — a missing date graded 0, a present one graded nothing —
[0079](0079-the-multi-photo-lanes-grade-the-dates-they-read.md)'s first gap.

**A merged multi-image row took its category from one source and its grade
from another.** `categorizeMultiImageTransactions` kept the extraction's
category over the ladder's and reported the ladder's confidence for it —
0045's second gap — and it sent the rows that already carried a category to
the ladder anyway, paying for answers it then threw away.

**The backup door trusted every id.** A `categoryId` in the file was graded
1.0 whether or not the account still held it
([0113](0113-the-wizards-picker-takes-a-backup-and-grades-the-category-it-defaulted.md)'s
first gap), so a category deleted since the backup arrived as *Unknown* with
a confident dot. The door dropped `recurringId` while copying `isRecurring`,
and wrote no snapshot, so every foreign-currency row was re-converted at
today's rate — 0113's second gap; the rule link alone was
[0063](0063-an-import-suggests-only-what-the-account-already-knows.md)'s
third.

**The keyword fallback spoke English.** The exact and partial name passes
already read every shipped locale; the last pass, for free text that names no
category at all, matched English words only —
[0046](0046-an-unrecognized-category-name-is-not-a-category.md) and
[0053](0053-a-resolver-answers-with-a-category-that-still-exists.md) both
recorded it.

**The merged count trusted the model.** The shared cloud base copied the
model's own `wasMerged` claim onto every raw row, consolidation's single-item
branch spread that claim through, and a split part copied its original's
mark — so a merged row split in two counted as two merged items on the
confirm card. [0111](0111-the-position-overlap-pass-is-removed.md) and
[0116](0116-the-merged-count-has-one-producer.md) recorded both halves.

Each of these produces a row the user trusts more than the code can vouch for.

## Decision

**A row is offered the categories of its own side of the ledger and falls
back to its own side's catch-all; every grade on it is one the door that
produced it can defend; and only the app decides that two readings became
one.**

### The type is explicit, never read from the sign

`RawTransaction` gains an optional `type`, a `CategoryRowType` of `'income'`
or `'expense'`, and the two ladder callers pass it. Every filter and check
below runs only when a row carries one, so an untyped caller keeps exactly
the behaviour it had.

The amount's sign was the obvious carrier and it was rejected on two counts.
The fixtures across the categorisation, provider and parity specs send
positive amounts beside expense categories, so a sign rule would have
declared a direction for rows that never meant to have one. And the CSV door
signs an expense as `-Math.abs(amount)`, which for a zero amount is `-0` —
and `-0 < 0` is false, so a sign rule reads a zero-amount expense as income.
A row that knows its direction says so.

Three helpers in `categorization.utils.ts` carry the rule:

- `categoryFitsType(category, type)` — a `'both'` entry fits either side,
  the rule `CategoryService`'s own expense and income lists already follow.
- `buildCategoryPromptCatalog(categories, translate, type?)` filters parents
  by it. A child is kept only because its parent survived, never on its own
  `type`, so an excluded parent takes its whole branch with it.
- `fallbackCategoryFor(type)` answers `other_income` for an income row and
  `other_expense` for anything else, an untyped row included.

### A catalogue where one fits, a check where one cannot

**The on-device path is shown the expense side.** Every scan it reads is a
purchase, so it renders the catalogue for `'expense'` and hands the name
matcher the expense-fitting categories only. A model that answers with an
income category's name from its own knowledge resolves to nothing and is
graded for review, rather than filed under a category the prompt never
offered.

**The batch categoriser narrows only a batch that points one way.** It sends
one catalogue per request, so `batchRowType` narrows it only when every row is
typed and all of them agree, as a multi-image batch of purchases does. What
the CSV door sends is the unresolved subset: the rows neither the file's own
Category cell nor category memory answered. That subset can hold both sides,
no single catalogue is right for a mixed one, and a catalogue per row would be
a request per row. So a mixed subset keeps the full catalogue — one that
happens to point one way is narrowed like any other batch — and
`applyCategorizations` checks each answer either way: a typed row whose answer
resolves to a category of the other side is refused and filed under its own
catch-all at 0.3, the grade an answer nobody could place already earns. The
check is what makes the mixed case safe; the narrowed catalogue only spares
the model a wrong choice where one catalogue fits.

**Every catch-all a typed row can reach is its own side's.**
`applyCategorizations`' two unresolved branches, a failed chunk's default, the
ladder's floor, the shared mapper `categorizeTransactions`,
`gradeCategorySuggestion` when its caller passes the row's type, and
`toCreateTransactionDTO` all ask `fallbackCategoryFor`. The DTO builder reads
the row's own declared `type`, not the sign-derived guess `dto.type` falls
back on, so a row that never declared a direction keeps `other_expense`
whatever its amount says. `FALLBACK_CATEGORY_ID` stays for the helpers that
have no row type to consult.

**A remembered or named category does not cross sides either.** Category
memory is keyed by merchant alone, and one merchant sits on both sides of the
ledger — a shop's purchases and its refunds. So the ladder takes a remembered
id for a typed row only when it fits the row's type; one on the other side is
no answer, and the row climbs on to the provider like a merchant memory does
not know. The shared mapper and the multi-photo door check a category an
extraction named the same way. The mapper takes a statement or PDF
extraction's: a statement's *Other* resolves to `other_expense` whichever
side its row is on, so an income row answered that way is filed under
`other_income` at 0.3, as an answer nobody could place.
`categorizeMultiImageTransactions` takes the one `importFromMultipleImages`
reads off receipt photos: `multiImageReceipts` asks for `"income"` on a
refund line yet gives only expense categories, such as *Shopping*, as its
examples, so a refund can arrive named for the purchase side. Such a row is
sent to the ladder, which is typed, with the rows the extraction left
unnamed. The camera's cloud read, the strategy service's
`processMultipleWithCloud`, reads the same extraction and hands its rows to
`convertStrategyResultToCategories`, which has no ladder to send a row to: it
passes each row's type and the catalogue to `gradeCategorySuggestion`, which
files a row named for the other side, like an unnamed one, under its own
side's catch-all at 0.3. The offline queue's drain writes the strategy
service's rows for a receipt captured offline straight to the ledger, with no
review step between, and passes each through `gradeCategorySuggestion` the
same way, so a row named for the other side is written under its own side's
catch-all. So memory, statement and PDF extraction, multi-photo receipt
extraction, the camera's cloud read and the offline drain all refuse the
other side. All five ask `categoryFitsType` of the category `CategoryService`
holds under the id, and only of a typed row; an id the catalogue does not
hold, or a catalogue that has not loaded, cannot be shown to be on the wrong
side, and passes.

### The on-device total is cross-checked against the text it came from

The plugin returns no grade, but the OCR text it structured is in hand. So
the path runs the same text through the regex reader the fallback path uses,
`parseReceiptOcrText`, and compares the two totals, each rounded to the minor
unit of whichever currency was read — the model's first, then the parser's,
and two decimal places when neither read one.

| What the two readers say | Amount grade |
|---|---|
| The model read nothing, or nothing above zero | 0 |
| Both read the same total | the parser's grade or 0.8, whichever is higher |
| They differ, and the parser read its figure beside a currency mark (its grade is at least 0.7) | 0.5 — flagged, under the 0.7 bar |
| They differ, and the parser's own reading is weaker than that | 0.8 |

0.8 is `MODEL_READ_GRADE`, 0045's evidence grade — a reading with nothing to
corroborate or dispute it. 0.5 is `REVIEW_AMOUNT_CONFIDENCE`, reused from
consolidation, where it already marks a printed total the item sum disputes;
the same disagreement earns the same flag. A disagreement with a parser that
did not trust its own reading is no evidence against the model.

**The `Math.max` is forward-looking.** The parser's strongest tier grades
0.8, so today the agreeing branch can only produce 0.8. It is written as the
higher of the two so that a parser which one day grades a figure above 0.8
lends that grade to a model that agrees with it.

**A date the model read is graded 0.8 and never lower.** An unreadable one is
graded 0. The cross-check has nothing to add here, and a lower grade would do
harm: `resolveImportDate` replaces any date graded under
`VERIFY_FIELD_THRESHOLD` (0.7) with *now* and marks it assumed, so a read
date graded at 0.5 would be thrown away for today.

The regex path was already grading both fields through the parser's own
grades; a spec now pins that it does.

### The summary prompt grades what it read

`receiptSummary` asks for `amountConfidence` and `dateConfidence`, worded as
`receiptParse` words them, with the same instruction to use 0.0 for a date
that is not printed and never to invent today's. Gemini's
`extractTransactionsFromImage` forwards both through `readConfidence`, so a
malformed grade is dropped rather than trusted, and a missing date is graded
0 whatever the model claimed for it — the idiom the multi-image mapping
already uses.

**No door reaches this prompt today.** `receiptSummary` is rendered only by
Gemini's `extractTransactionsFromImage`, which only `importFromImage` calls,
and only after the strategy service has failed with a retryable error or
read no rows. `importFromImage` is reached only through `importFromFile`'s
dispatcher; the wizard hands that dispatcher only the files it does not take
for images, the camera goes through the strategy service and falls back to
`importFromMultipleImages`, and the form's scan has a prompt of its own. The
change is cheap and closes the part as asked. Whether a path no door reaches
should be removed is the question #437's removal sweep exists to collect.

### A merged row's pair comes from one source

`categorizeMultiImageTransactions` partitions the consolidated rows by whether
the extraction named a category on the row's own side. A row it named keeps
that category at `EXTRACTION_CATEGORY_GRADE`, 0.8 — 0045's evidence rule,
above the 0.5 line the `low_confidence` warning counts under — and never
reaches the ladder. Only the rest are sent, and their answers are stitched
back by position. A batch in which every row is named makes no ladder call at
all: no category-memory load, no provider request.

The shared mapper's own `t.category ? 0.8 : 0.3` now reads the same constant,
so the one grade has one literal.

### The backup door checks the id, and carries the rule link and the rate

**A category is vouched for by the account, not the file.**
`gradeBackupCategory` reads `CategoryService.categories()` once per file:

- no id in the file — the row's own catch-all at 0.3;
- an id this account holds, active, on the row's own side — that id at 1.0;
- anything else, whether unknown, deleted or on the other side — the row's
  own catch-all at 0.3, so the chip's dot and the `low_confidence` count both
  see it;
- a catalogue that has not loaded yet — the file's id, kept, at 0.3. An
  empty list can neither vouch for the id nor show that it is wrong, so it
  rewrites nothing and grades for review.

**A rule link is kept only when it names a rule this account holds.**
`backupRuleIds` reads `RecurringService.listAll()` once per file, and only
when some row carries a link. Paused rules count: a paused rule still owns the
rows it posted. A read that fails keeps no link at all. A dangling link is
worse than none, because the recurring detector files a linked row under its
rule and never clusters it again — a link to nothing hides the charge under a
rule that does not exist.

**The file's rate travels, never its converted figure.** The door reads the
snapshot a backup row carries and keeps `fileRate: { exchangeRate,
baseCurrency, currency }` — the rate, the base it converts into, and the
currency it converts from. The card can change the amount after the file was
read — an edit, a split, a merge — and `addTransaction` writes a supplied
snapshot verbatim, so a copied `amountInBaseCurrency` would be written beside
an amount it no longer describes. At confirm, `fileRateSnapshot` computes
`amountInBaseCurrency` as the amount actually being written times the file's
rate: the same unrounded product `TransactionService` stamps on a live row,
with the file's rate in place of today's. It does so only while the row's
currency is still the one the rate converts from and the file's base currency
is the account's; otherwise it passes nothing and the write converts at
today's rate, as it would for any row.

A split part and a merge survivor carry `fileRate` through the spread, and the
write-time check is what keeps that right: a part is stamped from its own
amount, a merge is refused across currencies so the target's rate always
applies to a same-currency sum, and a currency changed on the card drops the
rate. A date changed on the card keeps it — the stored rate is the one in
force when the row was recorded, not the rate on the date it carries, which is
also what `addTransaction` stamps for a new row. `fileRate` is a review-row
mark and never reaches a document: `toCreateTransactionDTO` names every field
it forwards.

**The snapshot reader is shared, and so is its guard.** The restore's reader
is lifted into `import-dto.utils.ts` as `readTransactionSnapshot`, used by the
restore and the backup door alike. It refuses a record unless all three parts
are present, the rate is finite and above zero, and the base-currency figure
is finite — so the restore, which never checked either, refuses a rate of
zero, a negative one and an overflowed one too, and an overflowed figure,
which it would otherwise write verbatim.

### The keyword fallback reads three languages

`CATEGORY_KEYWORDS` replaces the English keyword map: a table keyed by target
id, nine ids, each holding its English words and, for eight of them, Japanese
and Traditional Chinese ones. Keyed by id because one id needs several words
in three languages, which a keyword-to-id map can only express by repeating
the id. It stays in code rather than the catalogs because a catalog value is a
string leaf in all three files, and an array would break that parity.

A Japanese or Chinese word identical to the id's exact shipped name is left
out: the name passes already resolve any input containing it, so a keyword
repeating it could never fire. `交通` is the shipped name of `transport` in
both the Japanese and the Chinese catalog, for one. `food` stays English-only
on purpose: a bare character for food sits inside other categories' names —
`食料品` (groceries) and `寵物食品` (pet food) among them — so free text about
any of them that matched no name would be pulled onto `food`. Matching is
unchanged — a substring of the lower-cased answer,
tried last, and a target the account no longer holds is skipped.

### Only the app decides *merged*

The multi-image prompt no longer asks for `wasMerged`, and the shared cloud
base writes `false` on every raw row whatever the model says. Consolidation's
single-item branch writes `false` too, since a group of one merged with
nothing. A split part is written `wasMerged: false`: a fraction of a merged
receipt is not a merged receipt.

Two producers of `true` remain, and both are the app's own verdict:
consolidation folding two or more items of one receipt group, and the card's
merge. The wizard's `mergedItemsCount` needed no change — it counts the mark,
and every producer of the mark now means it.

**A split part keeps `mergedFromImages`.** Consolidation hard-codes
`imageIndex` to 0 on a merged row, and `imageSources` falls back to
`[imageIndex]` when `mergedFromImages` is empty — so a part stripped of its
sources would attach photo 0 and show the badge *1*, whichever photos the
purchase was actually read from.

## What was rejected

- **Reading the direction from the sign.** See above: the fixtures, and `-0`.
- **One typed catalogue for the CSV batch.** A batch mixes both sides, and the
  categoriser sends one catalogue per request. Splitting a batch by type would
  double the requests for a mixed file to spare the model a choice the
  post-check refuses anyway.
- **Carrying the file's converted figure.** It is only right while the amount
  is the file's amount, and the review card exists to change the amount.
- **Keeping a rule link the account cannot confirm.** The detector trusts a
  link completely; a wrong one costs more than a missing one, which the user
  can add.
- **Grading a disputed date for review.** A grade under 0.7 replaces the read
  date with today, so the date question would then be asked about a date
  nobody read.
- **Matching keywords against the translated names in the session locale**,
  which #428 proposed. The name passes already read every shipped locale; what
  failed was free text that names no category, which a list of names does not
  reach.

## Consequences

- **An income row nothing could categorise lands on `other_income`** wherever
  its type is known: the CSV ladder's floor and a failed chunk, the shared
  mapper, the DTO builder and the backup door. So does one whose only answer
  sat on the other side, on every path the Decision names — category memory,
  statement and PDF extraction, multi-photo receipt extraction, the camera's
  cloud read and the offline drain. A backup row naming no category is filed
  under its own side's catch-all too, where it used to land on
  `other_expense` whatever it was.
- **The multi-image ladder sends fewer rows.** A row the extraction named on
  its own side costs no tokens and no memory lookup. A refund line named for
  the purchase side is sent like an unnamed one.
- **A refund from a remembered merchant costs a provider call.** The memory's
  answer for the merchant is on the purchase side, so the refund climbs to the
  provider — or to its own catch-all at 0.1 when none is configured.
- **Every on-device reading carries both grades**, at the price of one regex
  pass over text already in memory.
- **`AIImportService` injects `CategoryService`.** The backup door reads it
  once per file. The service's own spec provides a stub of it, the wizard
  smoke uses the real one, and the six specs that stub the whole import
  service need nothing.
- **`OfflineQueueProcessorService` injects `CategoryService` too**, for the
  drain's side check. Its unit spec provides a stub, and its smoke uses the
  real service.
- **The restore's reader is stricter.** Beside the finite, positive rate it
  now requires `baseCurrency` to be a non-empty string rather than any truthy
  value, so a hand-edited file carrying anything else converts at today's rate
  instead of writing it verbatim. A file this app writes carries neither.
- **The *Items merged* card counts a merged-then-split row once.**
- **Nothing deploys.** `fileRate` is a review-row mark and `wasMerged` never
  reaches a document; no rule, index or stored field changes. Two prompts
  changed: `receiptSummary` gained its two grades and `multiImageReceipts`
  lost the `wasMerged` field, each asserted in `prompt-registry.spec.ts`.
- **The emulator suites prove the two paths a mock cannot.** The on-device
  smoke seeds an income category beside the custom and deleted ones and reads
  the catalogue the model is sent back off a live Firestore merge; the wizard
  smoke feeds a backup naming a category the account lacks and a row carrying
  a historical rate, then reads the written document back — the rate the
  file's, the figure the row's amount at that rate.

## Departures from the issues

- **#428's sixth part was already met as written.** Its acceptance line —
  `matchCategoryName` resolves a Japanese category name — held before any of
  this, because the name passes read every shipped locale. The spec now pins
  it under a named *locales* block, and the part delivered is the keyword
  table, which was the English-only piece.
- **#428's third part is not the camera's.** The issue calls it the camera's
  single-summary path; the camera reaches the strategy service and
  `importFromMultipleImages`, and the summary prompt is reached by no door at
  all. The issue also expected the prompt registry check to demand the change
  of every provider. It inspects no prompt's fields, so `receiptSummary` stays
  Gemini-only and the two lines asked nothing of OpenAI or Claude.
- **#428's first part needed a check as well as a catalogue.** A type
  parameter covers the paths that send one kind of row; the CSV ladder sends
  both, and the post-check is the half the proposal did not have.
- **#428's second part had no grade to report.** "Grade the amount the way the
  regex path does" assumed a grade to pass on; the model has none, so one is
  derived by cross-checking the text it read.
- **#428's fifth part carries the rate, not the snapshot.** The issue asked for
  the snapshot. The figure in it is wrong the moment the card edits the amount.
- **#429's third part found one more carrier.** The issue named the model's
  claim, consolidation, the merge and the split's copy. Consolidation's
  single-item branch also spread the model's claim through untouched — 0116
  recorded the path — and now writes `false` itself.

## Things that only became apparent while building

- **A rate of `1e999` is a valid JSON number.** It parses to `Infinity`,
  passes a `> 0` check, and would have written an infinite base-currency
  figure that `firestore.rules` accepts, since the rules ask only `is number`.
  The finite checks — on the rate and on the figure — went into the shared
  reader rather than the door, which is how the restore got them. A spec
  cannot produce the case by round-tripping an object through
  `JSON.stringify`, which writes `Infinity` as `null`; the file has to be
  written as text.
- **The mapper held a second bare 0.8 for the same grade.** Two literals for
  one evidence rule is how the multi-image path and the mapper would have
  drifted apart; both read `EXTRACTION_CATEGORY_GRADE` now.
- **The obvious Japanese and Chinese keywords were often the categories' own
  names.** A keyword equal to a shipped name is dead on arrival, which a table
  written from a dictionary rather than from the catalogs would not show.
- **Stripping a split part's photo sources would have attached the wrong
  photo.** Resetting the merged mark looked like it wanted the whole merged
  block cleared; the attachment planner reads `mergedFromImages` as the only
  honest source list a consolidated row has.

## Known gaps

- **A rule link carried from a backup is invisible on the review card.** The
  card's link control renders from `recurringMatch`, which the backup door
  never sets — it offers no rule, by design — so the user can neither see nor
  remove a link the file carried. Surfacing it means setting `recurringMatch`,
  which also switches on the `recurring_occurrence` duplicate verdict for the
  row: a decision of its own, left for its own issue.
- **The rule check can drop a link to a rule that exists.** `listAll()` is a
  one-shot read, but not a server-only one; with the persistent cache it can
  answer offline from a partial cache. It errs towards no link. The server-only
  read would refuse offline and drop every link instead.
- **0113's second gap narrows and stands.** The rule link and the rate travel
  now; no import door carries `goalId`, and the row is still stamped with the
  moment it was imported rather than the one the backup recorded.
- **0013's demotion still has no say over the model's figure.** The amount
  flag exists on the on-device path now, but the parser's cash-tendered
  demotion lowers only the parser's own grade, and a disagreement with a
  parser that doubts itself keeps the model's 0.8.
- **When the two readers disagree about the currency, the model's decides the
  rounding.** A yen total compared at a dollar's two places, or the reverse,
  can call two readings equal or different on the minor unit alone.
- **A missing total does not zero the summary prompt's amount grade** the way a
  missing date zeroes its date grade. The unfilled-amount gate holds such a row
  anyway.
- **Three keywords land on a parent where a child fits better.** `電車` and
  `捷運` file under `transport` and `網購` under `shopping`, although
  `transport_publicTransit` and `shopping_onlineShopping` ship and carry no
  keywords of their own. `加油` is also everyday Chinese for encouragement, so
  a free-text answer using it that way files under fuel.
- **`applyCategorizations` looks the resolved category up twice** — once inside
  `resolveCategoryId`, once to check its side.
- **Some behaviour is pinned only one level away.** The restore reader's
  stricter `baseCurrency` is pinned by the util spec alone, and
  `receipt-consolidation.spec.ts` has no single-item `wasMerged: false` case,
  which the import service's spec covers end to end.
- **The summary prompt still has no door.** It grades correctly for a path
  nothing reaches.
- **The shared name list trims, and that reaches the model's resolver too.**
  See [0150](0150-the-csv-reads-back-what-it-writes.md): a custom name stored
  with stray spaces now matches a model's answer that it did not match before.
