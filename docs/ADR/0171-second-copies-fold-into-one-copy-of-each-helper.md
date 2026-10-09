# 171. Second copies fold into one copy of each helper

**Status:** Accepted, implemented · **Date:** 2026-10-10 · **Issues:** #438

Reference documentation lives in
[../locale-formatting.md](../locale-formatting.md),
[../dates.md](../dates.md), [../dashboard.md](../dashboard.md),
[../prompts.md](../prompts.md), [../share-import.md](../share-import.md)
and [../receipt-import.md](../receipt-import.md).

Closes gaps of [0015](0015-reclaimed-receipts-replay-idempotently.md),
[0025](0025-provider-variation-lives-in-the-transport-seam.md),
[0032](0032-a-sweep-is-only-as-wide-as-its-greps.md),
[0058](0058-a-formatted-date-follows-the-chosen-language.md),
[0061](0061-a-period-total-is-swept-exact-or-shown-absent.md),
[0065](0065-an-attempt-is-recorded-where-it-runs.md) and
[0067](0067-a-photo-is-made-to-fit-and-never-costs-its-transaction.md).
The table under *Decision* names the gap each part ends.

## Context

Seven records had left a second copy of something standing in their Known
gaps, most of them until a second site appeared. #438 found that every one
of those sites had appeared and that the copies had started to drift:

- **P1, `dayKey`.** [0032](0032-a-sweep-is-only-as-wide-as-its-greps.md)
  left two private copies: `NlSearchService.toIsoDate`, byte-for-byte
  `dayKey`, and a `padStart` assembly in `DateFormatService.formatDate`,
  which imported `dayKey` and did not call it. A third, in
  `WidgetSnapshotService`, built `monthKey` by hand, and the issue had not
  listed it.
- **P2, times and chart figures.**
  [0058](0058-a-formatted-date-follows-the-chosen-language.md) gave dates
  and numbers one chokepoint and left times out of it. Import History passed
  the service's locale to `toLocaleTimeString`, Security activity passed
  `getIntlLocale()` to it, and both asked for a two-digit hour. The two
  report charts formatted their tooltips and axis ticks with
  `toLocaleString`.
- **P3, request options and the prose switch.**
  [0025](0025-provider-variation-lives-in-the-transport-seam.md) left
  `requestOptions` written in all three provider services, and
  `postProcessProse` as a `switch` on the prompt id in the Gemini service,
  where a forgotten prose prompt fails nothing.
- **P4, the category fold.**
  [0061](0061-a-period-total-is-swept-exact-or-shown-absent.md) left the
  dashboard's `categoryTotals` folding inline, because moving it onto
  `groupExpensesByCategoryWithCounts` changes the order of a tie, a visible
  change it left for its own record. This is that record. Three more
  hand-rolled folds sat outside the issue's list: the AI summary's, the
  export dialog's, which `ExportService.exportToPDF` sorted with no
  tie-break, and the spending-summary prompt's input, which keeps the top
  five, so a tie decided which categories reached the prompt.
- **P5, the camera's error mapper.**
  [0065](0065-an-attempt-is-recorded-where-it-runs.md) sent the record and
  the event through the shared classifier and left the camera dialog's
  `describeError()` deciding what the user reads.
- **P6, the upload ceilings.**
  [0067](0067-a-photo-is-made-to-fit-and-never-costs-its-transaction.md)
  left the dropzone's 10 MB and the stored photo's 2 MB set independently,
  with nothing tying them together. The share intake carried a third
  literal, another 10 MB.
- **P7, the queue-row id.**
  [0015](0015-reclaimed-receipts-replay-idempotently.md) made a replayed
  receipt aim at the ids its first pass wrote, and left the id's shape as a
  coupling held by a comment: the drain built `${id}-${index}` twice, from a
  queue id whose format the queue service owns.

## Decision

**Each part folds into the one copy that already existed, or into a helper
that owns the shape, one commit per part. Two parts depart from the issue:
an exact category tie now orders by category id, and the intake ceiling and
the stored-photo ceiling stay two numbers, held to each other and to the
rules by a spec.**

Each commit is cited by its subject.

| Part | What folded | Into | Commit | Known gap it ends |
|---|---|---|---|---|
| P1 | `toIsoDate`, the `padStart` assembly, the widget's month key | `dayKey`, `monthKey` | `refactor: day and month keys come from one helper` | 0032's fourth, two more private copies of `dayKey` |
| P2 | Two `toLocaleTimeString` calls, four chart `toLocaleString` calls | `LocaleFormatService.formatTime`, `formatNumber` | `refactor: times and chart numbers go through the locale formatter` | 0058's second, times formatted ad hoc |
| P3 | Three `requestOptions`, the prose `switch` | The base's `requestOptions`; a table keyed by every prose prompt | `refactor: request options live in the provider base and the prose fixes are a table` | 0025's first and second |
| P4 | Six hand-rolled category folds and the PDF's sort | `groupExpensesByCategory`, `groupExpensesByCategoryWithCounts`, `compareCategoryTotals` | `refactor: every category fold goes through the shared helper` | 0061's third, the dashboard's inline fold |
| P5 | `describeError`'s three-code table | `parseAIError` | `fix(receipts): the camera names a failed queue write and a bad key like the wizard does` | 0065's last, the camera's own mapper |
| P6 | Two 10 MB literals; an unchecked rules mirror | `IMPORT_FILE_MAX_BYTES`; a spec over `storage.rules` | `refactor: the dropzone and the share intake read one size ceiling` | 0067's first, the dropzone's 10 MB |
| P7 | Two `${id}-${index}` | `queueRowTxId` | `refactor: one helper owns a queued scan's row id` | 0015's fifth, the id coupling |

### P1: day and month keys

`NlSearchService.toIsoDate` is deleted and the search context's `today` is
`dayKey(new Date())`. `DateFormatService.formatDate` splits `dayKey(d)` into
year, month and day for its three numeric patterns. `WidgetSnapshotService`
writes `monthKey(now)`.
`grep -rn "padStart(2, '0')" src/app --include='*.ts' | grep -v spec`
prints `monthKey` and `dayKey` in `transaction-date.utils.ts`, and two hex
encoders, `color-contrast.utils.ts` and `opaque-id.utils.ts`, which pad
bytes rather than dates. Pins hold
the old outputs: the search's `today` and the two day-first and month-first
patterns on 2026-01-05, and the widget's key in a single-digit month. The
search smoke asserts `today` equals `dayKey(new Date())`.

### P2: times and chart figures

Import History and Security activity call `formatTime`, which existed and
which `rate-status` already used. It asks `Intl` for a **numeric hour**, so
the hour is padded only where the locale pads it. Import History joins
`formatDate(date, 'short')` and `formatTime(date)` itself. Security activity
passes the relative day and the time through the translated
`settings.activityAt` pattern, as it did. The two report charts inject
`LocaleFormatService`. A tooltip is `formatNumber(value, '1.2-2')` and a
tick is `formatNumber(Number(value))`, read when Chart.js runs the callback.
`formatReceiptItemLines` keeps its `toLocaleString('en', …)` and gains a
comment citing `docs/locale-formatting.md`, because its text is persisted
onto a note. It is the only line
`grep -rn "toLocaleTimeString\|toLocaleString(" src/app --include='*.ts' | grep -v spec`
prints. The service itself calls `Intl` directly. `createLocaleFormatStub`
gained a `formatTime`, which renders the UTC `HH:mm`. A new smoke case
gives Import History the real service with a `ja-JP` locale and asserts
the row shows the ja time.

### P3: request options and the prose table

`CloudLLMProviderBase` gains one
`protected requestOptions(options?): { signal: AbortSignal } | undefined`,
and the three private copies are deleted. Gemini's copy had returned the
SDK's `SingleRequestOptions`, whose fields are all optional, so the
anonymous shape is assignable to it and the base still names no SDK type,
which is 0025's rule. Each provider spec asserts the SDK call's second
argument: `{ signal }` when a signal is given, `undefined` otherwise.

Every `PROMPTS` entry gains a literal `expects` after `feature:`. Eleven
are `json`, `spendingSummary` is `markdown`, and `categorySuggestion`,
`patternNarrative` and `financialAdvice` are `plainText`.
`ProsePromptId` is every id whose entry's `expects` is not `json`. A render
already returned `expects`. It is known only once the render runs, so the
registry carries it as a literal the type system can read, and a registry
spec holds every entry's literal equal to its render's value.

The Gemini transport's prose clean-ups are now a
`Record<ProsePromptId, ProseFix>`. A new prose prompt fails to compile
there until it says what happens to its answer, even when the answer is
left alone. The fixes stay in the transport, because they are properties of
the model and not of the prompt, which is 0025's other rule.

### P4: the category fold

Each site below now folds through `transaction-aggregation.utils.ts`. Its
order is larger total first, and an exact tie by category id, compared by
UTF-16 code unit through `compareIds`. Each total is rounded to the cent by
`roundMoney`. The four sites the plan named:

- **The dashboard's `categoryTotals`**, over the base-currency amount,
  through `groupExpensesByCategoryWithCounts`, since the chart reads the
  count.
- **The AI summary's `byCategory`**, through `groupExpensesByCategory`.
- **The report PDF's summary.** The export dialog builds `byCategory`
  through `groupExpensesByCategory`. `exportToPDF` used to sort the caller's
  array in place by total alone. It now ranks a copy with
  `compareCategoryTotals`, the comparator the folds use, exported so the
  rule has one copy, and leaves the caller's array as it was.
- **The spending-summary prompt's input**, in the provider base, through
  `groupExpensesByCategoryWithCounts`. The category name is looked up after
  the fold, on the five rows kept. The budget section's "spent" lines read
  the same fold.

Two more sites folded the same way and were found after the first commit.
`InsightChipsService`'s top-category chip and `SpendingAnalysisComponent`'s
top five each built a `Map` and sorted it by total. Both now read the
shared fold.

Tie specs pin the order at every site: the dashboard (with `0.1 + 0.2`
showing as `0.3`), the export dialog, the PDF, the provider base with a tie
at rank five, the AI summary, the insight chip and the spending analysis.
The dashboard smoke seeds two categories with equal spending, the older row
in the category with the smaller id. The window arrives newest first, so
first-seen order would have listed the other first. It lists them in id
order.

### P5: the camera's error line

`describeError` reads `parseAIError(err).messageKey`. When there is a key,
the dialog shows its catalog sentence. Otherwise it shows the error's own
text, or `import.errorProcessingFailed` when there is none. `parseAIError` is
the classifier the wizard reads, and the one `classifyReceiptFailure`
classes the record and the event with. The three sentinel imports went.

The change is wider than the sentinels. The old table translated
`AI_NO_PROVIDER`, `AI_QUEUED_OFFLINE` and `AI_CLOUD_UNAVAILABLE`, and
showed everything else as it came. Four more failures now have a sentence:

- a rejected key (`import.errorInvalidKey`), which showed the provider's
  wording;
- an answer cut short (`import.errorAnswerIncomplete`), which showed the
  JSON parser's wording;
- a queue write that kept nothing (`import.errorQueueWrite`), which showed
  the bare code;
- a queue write that kept part (`import.errorQueueWritePartial`), which
  also showed the bare code.

That is what the wizard already did. Nine unit cases cover the line: the
four above, and five pins of what it already did, the three translated
codes, a provider's own wording and an error with no text. A camera smoke
case feeds the dialog a failed queue write while online and reads the
line.

### P6: two ceilings, tied

`SHARED_FILE_MAX_BYTES` is renamed `IMPORT_FILE_MAX_BYTES` (10 MB), the
ceiling on an original before anything reads it. The share intake and the
dropzone's `maxFileSize` both read it, so no second 10 MB literal is left.
`MAX_RECEIPT_BYTES` (2 MB) stays in `storage.service.ts`, and its comment
now says that it bounds a photo after `prepareReceiptImage` has compressed
it, and that `storage.rules` repeats it. `storage.service.spec.ts` imports
`storage.rules` as text and finds every `request.resource.size <= …` clause,
two today, and fails if any mention of the size is written another way. It
multiplies each clause out and holds it to `MAX_RECEIPT_BYTES`. A clause
that is not a plain product of digits throws rather than being evaluated. A
third case keeps `IMPORT_FILE_MAX_BYTES` at or above `MAX_RECEIPT_BYTES`,
and a fourth pins it at the 10 MB the refusal states. The import works
through a `declare module '*.rules'` in `src/rules-text.d.ts` and a `.rules`
text loader in `angular.json`'s test options, so the production build never
sees it.

### P7: the queue-row id

`queueRowTxId(item, index)` is exported from `offline-queue.service.ts`, the
module that mints the queue id in `queueImage`. As landed, the drain called
it at two sites, where it planned a photo's row and where it wrote and
skipped, so the plan, the write and the existence check could not name a row
differently. Since #466 the drain works out every row's id once through it,
before anything is written, and the plan, the check and the write read that
one array. The processor spec asserts that the written id and a replay's
`hasTransaction` both come from the helper. Its literal row ids and the
smoke's keys now go through it as well. It landed as `${item.id}-${index}`.
#466 then changed its body and signature on this branch, which is a record
of its own.

## What was rejected

- **A padded hour.** Keeping `hour: '2-digit'` would need a second time
  style for two screens, while `rate-status` shows the locale's own hour.
  One vocabulary means one look.
- **A base that names Gemini's options type.** The base must not import an
  SDK (0025). The shape it returns is enough.
- **A `switch` with a `default`, or a table keyed by every prompt id.** The
  first compiles when a prose prompt is forgotten. The second makes every
  JSON prompt state that it has no prose fix.
- **Keeping first-seen order for ties.** See *Departures*.
- **The camera reading `classifyReceiptFailure`.** It answers with a class
  and the classifier's English sentence, not a catalog key, so the camera
  would have needed its own table from classes to keys, which is the copy
  this part removes.
- **One ceiling for intake and storage.** See *Departures*.
- **A constant for the row-id format.** A format string still leaves each
  site to assemble the id. A function owns both the shape and the
  assembly, and its signature is what #466 changed.

## Consequences

- **What a reader sees change:**
  - In en-US a single-digit hour loses its zero pad, on Import History and
    in Security activity: `09:05 AM` is now `9:05 AM`. ja and tc drop it
    the same way.
  - The monthly comparison's and the spending analysis's tooltips show
    exactly two decimals. They used to show a third when the amount had
    one. Axis ticks are unchanged.
  - An exact tie between two categories orders by category id, where it
    used to follow the order the rows arrived in. That holds on the
    dashboard's Spending by Category card, in the report PDF, in the
    spending-summary prompt's top five, in the insight chip's top category
    and in the spending analysis's top five.
  - Category totals round to the cent at the fold. The budget lines in the
    spending-summary prompt read the rounded figure, which shows only at an
    exact threshold.
  - The camera dialog shows a translated sentence for a rejected key and
    for an answer cut short, where it showed the provider's or the parser's
    wording. It does the same for a failed queue write, where it showed the
    bare code.
- **The bundle.** The provider base, already in an initial chunk, now
  imports `transaction-aggregation.utils`, which became its own initial
  chunk. The initial total rose by 722 bytes when the fold first landed.
  The budget figures are in
  [0170](0170-the-animations-runtime-the-unregistered-worker-and-nine-dead-items-come-out.md)
  and [../performance.md](../performance.md).
- **0025's rules stand.** The base names no SDK type, and Gemini's prose
  quirks live in its transport.
- **No rules, indexes or functions change.** `storage.rules` is read by a
  spec, not edited.

## Departures from the issue

- **P4: ties order by category id.** The issue's acceptance asked for the
  dashboard's category order to stay unchanged, under a spec that pins a
  tie. The order it had was first-seen: whichever row the listener
  delivered first, so it followed the window's query order, and an edit to
  a row's date could move it. A spec pinning it would pin delivery order.
  Ties now order by category id, and the tie specs above pin that order at
  every site, the dashboard smoke included. 0061 had named this as the
  visible change that wanted its own record.
- **P6: two ceilings, not one.** The issue proposed one `RECEIPT_MAX_BYTES`
  that the dropzone, the share intake and the upload all import, with a
  spec that the three agree. They are two quantities. The 10 MB ceiling
  bounds an original, which can be a CSV, a PDF, a backup or a photo, before
  anything reads it. The 2 MB ceiling bounds a stored photo after
  compression, and `storage.rules` repeats it. One constant would either
  shrink intake to 2 MB, refusing every CSV, PDF or backup above it and
  the larger photos the compressor fits today, or break the rules mirror,
  which holds the stored ceiling at 2 MB.
  So the intake reads one constant, the stored ceiling stays separate and
  is held to the rules by a spec, and a third case keeps intake at or above
  storage.
- **P1 and P2: the acceptance greps print more than the issue allowed.** The
  issue's `padStart` grep was to print nothing outside `dayKey`; it prints
  `monthKey` in the same module, and two hex encoders that pad bytes, one
  of them, `opaque-id.utils.ts`, added on this branch (*P1*). Its
  `toLocaleString` grep was to print only `LocaleFormatService`; it prints
  `formatReceiptItemLines`' pinned `'en'` call, whose text is persisted
  onto a note, and not the service, which calls `Intl` directly (*P2*).
- **P5: the camera reads `parseAIError`, not `classifyReceiptFailure`.** The
  issue set `describeError` beside `classifyReceiptFailure` and proposed
  the classifier in the dialog. The dialog reads the classifier both share,
  for the catalog key `classifyReceiptFailure` does not return (see *What
  was rejected*).

## Things that only became apparent while building

- **The registry was never checked against its own interface.** `PROMPTS`
  was `as const` and nothing more, so a required `expects` on
  `PromptDefinition` would have checked nothing. It closes with
  `as const satisfies Record<string, PromptDefinition>`, which keeps the
  literal types and also starts checking each entry's `feature`. All
  fifteen entries passed.
- **The prose table is an instance field.** The plan sketched a module
  constant. The fixes call the service's private members and read its
  current model id, which a module constant cannot reach, so the table is
  the private field `proseFixes`. The service is a root singleton, so one
  table exists either way.
- **The lookup widens rather than casts.** The base hands the override any
  prompt id. Casting it to `ProsePromptId` would type every lookup as
  found and still need the check. The table is read through
  `Partial<Record<PromptId, ProseFix>>`, a lookup that can honestly come
  back empty, and an empty one returns the trimmed text, as the old
  `default` did.
- **The spending summary's budget lines read the old map.** Deleting the
  map failed to compile at the budget section, which had looked up "spent"
  per category in it. The breakdown and the budget lines now read the one
  fold.
- **The plan's four fold sites were six.** The insight chip and the
  spending analysis came to light after the first commit, and the PDF's
  ranking turned out to need the comparator rather than an order it
  trusted. `compareCategoryTotals` was exported for it, and the helpers sort
  by it too.

## Remaining folds, by design or deferred

- **The reports page's category breakdown**
  (`category-breakdown.component.ts:116-139`) folds whichever side the
  reader picked, income included, so the expense-only helpers do not fit
  it. It sorts by total with no tie-break. `groupByCategoryAndType`, which
  keeps income and breaks ties by id, is the candidate for a follow-up.
- **`TransactionService.getPeriodCategoryTotals`** folds the previous
  period into an unrounded, unsorted list, which its readers look up by
  category. Its order reaches anything only through
  `computeCategoryDeltas` (`spending-insight.utils.ts:114` and `:128`),
  which folds the current period itself and sorts by the size of the change
  with no tie-break, so only an exact tie in the change is affected. One
  follow-up covers both: a `compareIds` tie-break in that sort.
- **The search's `topCategories`** (`nl-search.service.ts:229-240`) rolls
  each category up to its parent before it folds, which no shared helper
  does, and its answer is persisted to the answer history. It sorts with no
  tie-break.

## Known gaps

- **The AI summary's `byCategory` has no reader.** `getFinancialAdvice`
  reads income, expense and balance and nothing else. The field stays,
  because `MonthlyTotal` requires it and the export and the providers share
  that type, so it is computed, now ranked by the fold, and pinned by a
  contract case on what the advice call is handed. Removing it would be a
  [0048](0048-a-dead-capability-is-removed-not-guarded.md) removal of its
  own.
- **The provider base is 999 lines.** 0025's third gap stands. This record
  moved code into the base, not out of it.
- **The camera says less than the wizard about a failure with no key.** A
  rate limit, a network failure, a spent quota, a server error or a timeout
  carries no `messageKey`, so the camera's one line is still the provider's
  wording. The wizard's card adds a translated title and, for the first
  three, a translated hint.
- **The camera's queue-write line is proved at the component.** Online, with
  a usable cloud provider, the import service throws
  `AI_QUEUE_WRITE_FAILED` only if the connection drops between the dialog's
  check and its own. The smoke scripts both doubles, and the browser run
  could not reach the camera door, which is phone-only.
- **Dates outside the issue's grep still call `Intl` themselves.** Date
  labels in the spending analysis, the monthly comparison, the period
  selector, the export dialog, the insights views, `DateFormatService` and
  the forecast pass the active locale to `toLocaleDateString` or to a
  `new Intl.DateTimeFormat`. They follow the language, and they are not
  routed through the service.
- **No spec pins a chart's ticks after a language switch.** The callbacks
  read the locale when Chart.js runs them, and the redraw that follows a
  switch is what makes them follow it.
