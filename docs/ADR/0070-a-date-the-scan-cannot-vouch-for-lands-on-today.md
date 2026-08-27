# 70. A date the scan cannot vouch for lands on today

**Status:** Accepted, implemented · **Date:** 2026-08-28

Reference documentation lives in [../receipt-import.md](../receipt-import.md).

Keeps the mapper chokepoint
[0059](0059-one-mapper-builds-every-imported-transaction.md) set and the
review-step correction rule
[0062](0062-the-review-step-can-correct-every-field-the-import-writes.md)
standing. The mark it adds obeys
[0064](0064-the-country-comes-off-the-paper-before-the-phone.md)'s "the mapper
names its fields, so a mark cannot reach a document", to which
[0068](0068-a-country-is-stored-on-the-evidence-that-produced-it.md) opened the
one deliberate exception.

## Context

The import review step has graded a date for as long as `fieldConfidence` has
existed. `VERIFY_FIELD_THRESHOLD` is 0.7, the preview table paints a chip on
anything under it, and the in-form scan paints the same chip on the same bar.
What none of that ever did was change the date. A row the reader was twenty
per cent sure of was still filed under the day it misread; the chip was a
request for the user's attention, and a request for attention is defeated by
inattention — which is the ordinary case for a dozen receipts confirmed in one
tap.

The cost of losing that bet is asymmetric, and that asymmetry is the whole
argument. A transaction wrongly dated **today** sits at the top of the list the
user is already looking at, in the period they are already reading, one tap
from the date field. A transaction wrongly dated some day in 2024 is four
hundred rows down a windowed pager, inside no budget period anyone is watching,
in a month whose total has already been read and believed. Both are the same
misreading. Only one of them is findable.

Three separate things had to be true for a fabricated date to get that far, and
all three were.

**The prompts asked for one.** `receiptParse`'s defaults line carried
`date=today`, and `receiptSummary` said "use today if not visible". The model
does not know today's date. Asking it to invent one guarantees a value that is
indistinguishable, downstream, from a date somebody read off paper.

**The producers laundered it.** Where a model answered with no date at all,
four lanes across `cloud-llm-provider.base.ts` and `gemini.service.ts` patched
the hole with `dayKey(new Date())` before the client ever saw the row — and
that string parses perfectly well, so the single null-check that existed, in
`categorizeTransactions`, never fired for it. The base's `parseReceipt` lane
did the same thing one step later, falling back to `new Date()` when its own
`parseDateInput` returned null. Either way, whatever `dateConfidence` the model
had claimed rode along beside the substituted value, unchallenged.

**And most lanes reported no grade to challenge it with.**
`receipt-text-parser.ts` computes a date confidence — 0.9 for an unambiguous
match, scaled down for an ambiguous day/month order or a two-digit year, 0 when
nothing matched, including a match the future-date guard rejected — spends it
in the blended `confidence` figure and never put it on its own interface.
`consolidateReceiptItems` dropped `dateConfidence` on its merge branch. The
strategy lane's `fieldConfidence` carried `amount` and nothing else, so every
date grade that did survive that far died on the hop into the review row.
Apple's foundation model reports no per-field confidence at all, and the
multi-image lane had none to report.

So the app had a threshold, a chip, a tooltip and a percentage, and underneath
them a value nobody had checked.

## Decision

**A date the scan cannot vouch for lands on today, and the row says so.**

### One helper decides, and it decides at the row seams

`resolveImportDate(raw, confidence?, now = new Date())` in
`import-dto.utils.ts` returns `{ date, dateConfidence?, dateAssumed? }` and is
the only place the rule lives:

| What arrived | What comes back |
|---|---|
| A value `parseDateInput` rejects | `now`, graded 0, marked assumed |
| A parseable value graded below `VERIFY_FIELD_THRESHOLD` | `now`, the reader's own grade kept, marked assumed |
| A parseable value graded at or above it | the parsed date, grade kept |
| A parseable value nobody graded | the parsed date, no grade |

The threshold check is strict `<`, so a reading graded exactly 0.7 is kept —
the same bar, read the same direction, as the chip that has always been on
screen. An **`undefined`** confidence never substitutes: a CSV cell and a JSON
backup row have no reader to grade them, and treating "nobody looked" as "the
reader was unsure" would re-date every hand-written import. That is the same
distinction `needsVerification` already draws for the chip.

The three review-row builders in `AIImportService` — `categorizeTransactions`,
`convertStrategyResultToCategories` and `categorizeMultiImageTransactions` —
resolve through it, and so does the offline queue drain.
`confirmImport`'s own last-chance `parseDateInput(txn.date) ?? new Date()` is
left exactly as it was: by then the row has already been resolved, and a guard
that never fires is cheaper than a guard removed on the assumption that it
never will.

### "Now" is the instant, not the start of the day

A date the app parses lands at local midnight. `startOfDay(now)` would
therefore tie with every honest row already dated today, and the order among
them would be whatever the pager's tiebreak happens to be. The actual instant
sorts strictly above all of them in a newest-first list, which is the entire
point of moving the row: it is not merely on the right day, it is the first
thing the user sees.

### The mapper stays pure

Resolution happens before `toCreateTransactionDTO`, never inside it. 0059's
chokepoint takes a `Date` and names its fields; a mapper that also decided
*what day it is* would be taking a product decision on a data hop, and it is
the wrong place to take it — the CSV and JSON doors pass through the same
mapper and have no reader whose confidence it could consult.

### `dateAssumed` is a mark, not a field

It rides `CategorizedImportTransaction` beside `currencyFellBack`, it exists
between extraction and confirm, and no document ever carries it. A stored flag
would need a rules clause, an index of nothing, a backfill story and a reader,
for a fact that stops being interesting the moment the user looks at the row.
What the ledger records is the date; that the date is today is the mark's whole
message, and it is visible in the row itself.

### Producers grade a fabricated date at zero instead of laundering it

The helper can only be as honest as what reaches it, so every reader that
patches or fails to read a date now says so:

- `cloud-llm-provider.base.ts` — the `receiptParse` lane overrides
  `fieldConfidence.date` to 0 when its own `parseDateInput` returned null, and
  the statement and multi-image lanes report `dateConfidence: 0` when the model
  sent no date for the day-key patch to stand in for.
- `gemini.service.ts` — the same override on its own image and multi-image
  lanes, which patch the same way and never reached the base's version of it.
- `ai-strategy.service.ts` — grades a parse failure 0, and carries an incoming
  zero through into `fieldConfidence.date`, which is where every producer's
  date grade used to be dropped.
- `receipt-consolidation.ts` — the merge branch passes `dateConfidence` through
  from `first`, the row it took the `date` from.
- `receipt-text-parser.ts` — exports the grade it was already computing.
- `native-receipt.service.ts` — the regex lane reports both grades, and the
  Apple Intelligence lane, which grades nothing else, grades an unreadable date
  at 0 so it cannot land on today unmarked.

### The prompts stop asking for a date the model does not have

`receiptParse` defaults `date=""` and adds, in the same breath as the existing
confidence instruction, "Use 0.0 for `dateConfidence` when no date is printed
or legible — never invent today's date." `receiptSummary` reads "use `""` if
not visible". The client-side detection is what actually enforces this; the
prompt change is what stops the model from being asked to defeat it.

Wording only, so the registry's `since` values do not move — they name the
release a prompt first shipped in, not the last time a line was edited — and
`../prompts.md` is unchanged.

### The card explains the date instead of quoting a percentage

The review card grows a `dateAssumed` chip in `.card-extras`, beside the
suggestion chips. It is **not** dismissible: there is no date editor on that
card, so a remove control would have nothing to clear. The icon carries the
explanation as its accessible name as well as its tooltip.

`verificationTooltip(row, 'date')` speaks the assumed wording rather than the
percentage on such a row. The percentage describes a reading; on an assumed row
the reading is not what is on screen, so quoting it would describe a date that
is no longer there.

### The queue resolves at write time, and drops the mark

The offline drain runs the same helper before handing the row to the mapper, so
a doubted date lands on the day the queue drained rather than on a misread day
in the past. The `dateAssumed` mark is discarded there, because that door has no
review surface to show it on — a mark with no reader is not worth carrying.

### The in-form scan's date value is untouched

The form fills a field the user is looking at and about to submit, with the
verify chip already beside it. Substituting a value under an editable field
somebody has open is worse than flagging it. What the form gains from this
record is the honest grades underneath: an unreadable date now flags there,
where before the fabricated one arrived confident.

### The alternatives that were rejected

- **Keeping the low-confidence date and relying on the chip.** That is the
  status quo, and it works exactly as long as the user's attention does. The
  chip stays; what changes is what happens when nobody acts on it.
- **Writing `dateAssumed` onto the transaction.** Marks are not fields (0064).
  A document flag would be a rules clause and a migration for something that
  the row's own date already tells anyone who looks.
- **Resolving inside `toCreateTransactionDTO`.** See above: 0059's mapper takes
  a date, it does not decide one.
- **Substituting in the in-form lane too**, for consistency. Consistency of
  mechanism is not consistency of situation; the situations differ in whether a
  human is looking at the field.
- **A second, stricter threshold** — flag under 0.7, substitute under, say,
  0.3. Two bars mean a row can be flagged and not moved, and then the chip has
  to explain which of the two things it means. One bar, and it is the bar the
  user has already been reading.
- **`startOfDay(now)`**, for a tidier stored value. It ties with every honest
  row dated today and gives up the only property that made "today" the right
  answer.
- **Refusing the row instead of re-dating it.** A receipt whose date could not
  be read is still a purchase that happened, with an amount and a merchant the
  reader did get; dropping it to protect a date loses more than it saves.

## Consequences

- **Duplicate detection runs on the resolved date.** A re-dated row may stop
  matching a stored duplicate that its wrong date would have matched, and may
  start matching something else dated today. That is accepted: the detector
  compares the date it is given, and the date it used to be given was one
  nobody vouched for.
- **The native regex parser's ambiguous readings now move.** An ambiguous
  `03/04` with a four-digit year grades 0.54 (0.9 × 0.6), a two-digit year
  grades 0.5, and both at once 0.3 — all under the bar, so all of them land on
  today, marked. Only an unambiguous four-digit-year match at 0.9 survives.
  This is the largest behaviour change on the on-device path and it is
  deliberate: the parser reads arithmetic, and `03/04` is genuinely two dates.
- **A queued receipt's doubted date is drain-time, not capture-time.** The
  photo may have been taken on a train on Tuesday and written on Thursday; a
  row whose date was read fine keeps it.
- **The review card's date tooltip stops quoting a percentage on an assumed
  row** and explains the substitution instead. The amount tooltip is unchanged,
  so the two fields no longer read the same way on the same card.
- **The in-form scan flags dates it never used to.** Its date value does not
  move, but the honest zeros now reach it, so an unreadable date raises the
  verify chip on the form where the fabricated one used to arrive confident.

## Things that only became apparent while building

- **The multi-image lane patches a missing date too.**
  The pattern `date: t.date || dayKey(new Date())` appears three times
  (`cloud-llm-provider.base.ts:344`, `:406`, `gemini.service.ts:346`), and a
  variant `date: receiptData.date || dayKey(new Date())` appears once
  (`gemini.service.ts:289`), spanning four lanes across the two cloud adapters.
  The multi-image pair was closed a round after the statement pair. The lanes
  read identically at the seam; what hid the second pair is that its prompts
  grade nothing per field, so there was no `dateConfidence` beside the patch to
  draw the eye to it.
- **The strategy lane discarded every date grade there was.** Producing an
  honest zero upstream achieved nothing until `fieldConfidence` on that hop
  stopped carrying `amount` alone. A fix that only wrote zeros would have
  looked complete and changed no behaviour.
- **Consolidation silently dropped the grade on its merge branch.** The merge
  scans the whole group for a location and a country, and takes the `date` from
  `first`; the grade had to come from `first` too, and pairing it with the
  wrong one of those two habits is how it went missing.
- **The regex parser had already done the work.** `dateConfidence` was computed
  and weighted into the blended `confidence` figure, and simply not exported —
  a grade with no reader, sitting one line away from the interface that needed
  it.

## Known gaps

- **The item lanes grade rows, not dates.** `multiImageReceipts` and
  `receiptItems` ask for a row-level confidence and no `dateConfidence`, so a
  **missing or unparseable** date is caught there end-to-end — graded 0 by the
  producer, landed on today, marked — while a merely *doubtful* parseable one
  cannot be, because no producer on that lane populates a partial date grade
  for the helper to compare. Giving those prompts a per-field date confidence
  is the change that would close it.
- **A parseable date the model invented anyway sails through.** The
  architecture catches an empty string, an unparseable string and a graded-low
  reading. A model that ignores "never invent today's date" and answers with a
  well-formed date it made up produces a row this record cannot distinguish
  from a real reading. Prompt compliance covers that case and nothing else
  does.
- **No absurd-year guard.** A confidently parsed `1907-04-02` is kept. The
  future-date guard exists in the regex parser only, and nothing anywhere reads
  a date as implausible on its value alone.
- **The form and the queue show no mark.** The form's user is editing the field
  live; the queue has no UI. Both are deliberate, and both mean the mark is a
  wizard-review artefact, not a property of the import.
- **The strategy lane copies the producer's `fieldConfidence` verbatim.** A
  producer that handed over a malformed `Date` object rather than a string would
  have its row re-dated and marked while the date cell's own verify chip stayed
  quiet, because that chip reads the copied grade. Narrow — every shipped
  producer sends a string, and the `dateAssumed` chip still shows — but the two
  signals are not derived from the same value.
- **Neither the form nor the queue writes a success record**, so a row re-dated
  on those doors leaves no trace anywhere but the transaction. That is 0065's
  named limitation and this record does not reopen it.
