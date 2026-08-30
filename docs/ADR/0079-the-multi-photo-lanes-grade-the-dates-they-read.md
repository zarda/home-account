# 79. The multi-photo lanes grade the dates they read

**Status:** Accepted, implemented · **Date:** 2026-08-30 · **Issues:** #341

Closes a known gap of
[0074](0074-a-date-the-scan-cannot-vouch-for-lands-on-today.md). Reference
documentation lives in [../receipt-import.md](../receipt-import.md) and
[../prompts.md](../prompts.md).

## Context

0074 gave every import row a place to land when its date could not be
trusted: `resolveImportDate` substitutes `now` for a value nothing can parse,
or one the reader graded below `VERIFY_FIELD_THRESHOLD`, and marks the row so
the review step can say why. That record's own "Known gaps" named the hole it
left open: `multiImageReceipts` and `receiptItems` — the two prompts behind
every photo import that is not the single-summary camera lane — asked the
model for one confidence covering the whole row, and nothing asking about the
date on its own. A missing date still got caught: every producer on these two
lanes already patched a blank date with `dayKey(new Date())` and reported a
fabricated `dateConfidence: 0` for the substitution, so an empty reading
landed on today exactly as 0074 intended. A date the model *read* — badly,
ambiguously, ready to be wrong — had no confidence of its own to fall below
the bar with. `resolveImportDate` had nothing to distrust, so it kept
whatever string arrived, however doubtful the reading behind it.

The rest of the pipe had no such gap. `consolidateReceiptItems`'s merge
branch already forwards `dateConfidence` from the row it takes the date
from; `categorizeMultiImageTransactions` already resolves through
`resolveImportDate(t.date, t.dateConfidence)` and already folds the result
into `fieldConfidence.date`; `resolveImportDate` itself already treats a
graded-but-low date exactly like an unparseable one. All three were built and
wired ahead of anything that could exercise them on this lane, because
nothing here had a grade to send.

## Decision

**Both multi-photo prompts now ask for a per-row `dateConfidence`, not only a
per-row `confidence`.** `multiImageReceipts` and `receiptItems` each gain a
`dateConfidence` field description, an instruction to lower it when the date
is blurred, cut off, ambiguous or inferred rather than plainly read, and the
same zero-case rule receiptParse already carries: "Use 0.0 for
`dateConfidence` when no date is printed or legible — never invent today's
date." Nothing else about either prompt changes: the row-level `confidence`
field stays, and still means what it always meant — how sure the model is of
the *item*, not the date on it.

### The mapping only had to stop inventing a grade it did not have

Every reader on this lane already forwarded whatever `dateConfidence` the
model sent when a date came back at all; what none of them did was
distinguish "the model reported none" from "the model reported zero,"
because there was never a reported value to tell the two apart. Gemini's
per-image itemization — `extractWithPositionMetadata`, behind `receiptItems`
— now keeps that distinction explicit: a missing date still fabricates
`dateConfidence: 0` (the patch standing in for it is a fabrication, and says
so), a date that was read keeps the model's own grade when it sent one, and
when the model sent none the key is absent altogether rather than holding a
stand-in `undefined`. The base's multi-image mapping in
`cloud-llm-provider.base.ts` — behind `multiImageReceipts`, shared by
OpenAI, Claude and Gemini's own multi-image path — already wrote
`dateConfidence: t.date ? t.dateConfidence : 0` before this record, and is
untouched by it: it was already shaped to forward whatever grade arrived, and
simply had nothing to forward until the prompt started asking for one.

### The alternatives that were rejected

- **A separate, stricter prompt for a "doubtful date" case.** The row already
  carries one confidence field the model understands; asking for a second
  general-purpose grade and re-explaining a rule already given for the first
  `dateConfidence` (receiptParse's) was more vocabulary for the same
  judgment, not a clearer one.
- **Deriving a date grade from the row confidence.** A model sure of the
  price and merchant but never asked about the date would have that
  confidence borrowed for a field it never assessed — the exact laundering
  0074 wrote these prompts to stop doing in the other direction.

## Consequences

- **A doubtful-but-parseable date on a multi-photo or single-photo-itemized
  import now lands on today, marked, the same way a statement or
  receipt-parse import already did.** The behaviour 0074 shipped for two
  lanes now covers four.

## Departures from the issue

- The issue cited "ADR 0075's note" for the `since` rule governing the
  registry. The note belongs to 0074, not 0075 — 0075 is about the import
  history record, not the prompt registry.
- `since` values name the release a prompt id first shipped in, not the last
  time its wording changed, so neither prompt's entry moves in
  `docs/prompts.md` even though both prompts' text did. That document is
  unchanged by this record.

## Things that only became apparent while building

- **The base lane's `dateConfidence: t.date ? t.dateConfidence : 0` and
  Gemini's single-photo `...(t.date ? (t.dateConfidence !== undefined ? {
  dateConfidence: t.dateConfidence } : {}) : { dateConfidence: 0 })` answer
  the same question in different shapes.** The base's ternary writes the key
  with an `undefined` value when a date was read but ungraded; Gemini's
  spread omits the key entirely in that case. Every downstream reader checks
  `!== undefined`, so the two are functionally identical today — but they
  are two answers to one question, and a shared helper would be one answer
  instead, if the base lane is ever touched again.
- **`receiptItems`' registry spec had no field-list loop to extend.**
  `multiImageReceipts`' existing test asserts a whole array of field names in
  one loop; `receiptItems` had never grown one, so its new assertions are
  direct `toContain` checks instead of an added array entry.

## Known gaps

- **The single-summary camera lane still cannot grade its date.**
  `receiptSummary` — the one prompt behind `extractTransactionsFromImage`, a
  whole receipt folded into one row — has no `dateConfidence` field, and
  nothing here gives it one. Its Gemini mapping already carries the same
  zero-only shape the other lanes had before this record
  (`...(receiptData.date ? {} : { dateConfidence: 0 })`), waiting to forward
  a real grade the day the prompt offers one.
- **A model that ignores the instruction and invents a plausible-looking
  date is still not caught here.** That is 0074's known gap, not narrowed by
  this one: grading the date is the model's own claim, and a model that
  claims confidently is indistinguishable from one that read correctly.
