# 93. The summary export names both sides of the ledger

**Status:** Accepted, implemented · **Date:** 2026-09-01 · **Issues:** #65

## Context

Everything the app aggregates by category drops income on the way. The
dashboard chart, the reports breakdown, the PDF's category table — all of them
call one of the `groupExpensesBy*` helpers, and every one of those filters to
`type === 'expense'` before it counts anything. That is right for a spending
chart and wrong for the thing #65 asked for: a per-category total for the year,
for a tax return or an accountant, where a missing salary category is not a
tidier report but a wrong one.

A helper that silently drops half the ledger is a hazard precisely because the
name does not say so at the call site. `groupExpensesByCategory(transactions)`
reads like "group by category". Building the summary on top of one of those and
then wondering why the income rows are absent is the defect this record exists
to make impossible to write twice.

There is a second, quieter divergence in the same file. `ExportService` converts
through `CurrencyService.amountInBase`, which prefers the write-time
`amountInBaseCurrency` snapshot ([0033](0033-a-stored-figure-is-re-taken-only-when-its-input-moved.md)).
The export **dialog** has its own private `toBaseCurrency` that calls
`convert()` live, and the existing PDF path goes through it. The two disagree
for any row written when rates were different, and they have disagreed since
before this wave.

## Decision

**One new aggregation helper, `groupByCategoryAndType`, named for filtering
nothing.** It keys on `type|categoryId`, so a category carrying both an expense
and an income yields two rows rather than one netted one — `other` is a real
category on both sides, and netting it would make a month of equal flows read
as no activity at all. Expenses come first as a block, then income, each side
largest-first, so the order does not reshuffle on the month income happens to
outweigh spending.

**Conversion goes through `amountInBase`, not through a live `convert()`.**
This is the deliberate side of the divergence above. Matching the dialog would
make a legacy row total one way in this file and another way on every screen
that shows the same period; the summary agrees with the app instead. The
dialog's own live conversion is left exactly where it was — changing it is a
separate decision about a shipped surface, not something to slip into a new
export.

**The PDF is a separate builder, not a mode of `exportToPDF`.** `exportToPDF`
does two things this summary must not do: it slices its category table to the
ten largest rows, and it sorts `report.summary.byCategory` **in place**,
reordering an array its caller still owns. The summary is the whole period by
definition — a tax return does not stop at the tenth category — and a report
builder has no business mutating its input. A flag threaded through the
existing builder would have had to defeat both behaviours conditionally,
inside a function that is already long enough to be hard to read.

**The totals block is summed from the rounded rows, not from the raw
transactions.** A figure printed under a table must agree with the table to the
cent; summing the same numbers twice by two different routes is how it stops
doing so.

**The CSV writes bare decimals through `formatAmount`, never `formatCurrency`.**
A symbol or a thousands separator fails `csv.utils`' numeric test, the cell
picks up the formula guard from
[0011](0011-the-csv-file-is-a-contract.md), and `SUM()` over the column returns
0 in every spreadsheet. The column exists to be summed.

Rejected: **teaching `groupExpensesByCategoryWithCounts` an "include income"
flag.** The name would then be a lie in one of its two modes, and every
existing call site would have to be read to find out which mode it was in.

Rejected: **netting income against expense within a category.** See `other`,
above.

Rejected: **reusing the dialog's live conversion for consistency with the PDF
beside it.** Consistency with a known divergence is not consistency.

## Consequences

- The dialog gains two formats, `summary-csv` and `summary-pdf`, beside the
  existing `csv`, `pdf` and `json`. Their labels stay the format name, so two
  rows read CSV and two read PDF; the translated description and the icon are
  what tell them apart.
- **`'summary-csv'` and `ExportOptions.format: 'summary'` are unrelated.** The
  older one selects the five-column, lossy, per-**transaction** CSV that has
  shipped since [0011](0011-the-csv-file-is-a-contract.md); the new one is
  per-**category** totals. They share four letters and nothing else.
  [../csv-format.md](../csv-format.md) states the distinction for the next
  reader; merging them would silently change what an existing export produces.
- The summary CSV is not importable, and neither is the older summary format —
  the importer has no `category` probe at all.
- `roundMoney` is now imported by the dashboard as well, for the upcoming net
  ([0091](0091-the-upcoming-card-reads-the-live-schedule-not-the-ledger.md)).

## Things that only became apparent while building

- **The CJK font has to be threaded into every table explicitly.** `setFont` on
  the document does not reach `autoTable`'s own styles, so a table left on the
  default family renders as tofu for a ja or tc reader while the headings above
  it read correctly. The offline spec only ever proves the helvetica fallback,
  never the threading — that part is reviewed, not tested.
- **A zero denominator is reachable in the percentage column.** A period can
  hold rows that all convert to nothing, and `0/0` prints `NaN%` in a document
  the user is about to hand to an accountant.
- **An untruncated table needs its own page-break check.** With ten rows a
  heading always had room for its table; with a whole year's categories a
  heading can land at the foot of a page and introduce nothing.

## Known gaps

- **The dialog's live conversion is still there.** The two PDF exports in the
  same dialog can print different totals for the same period on an account with
  legacy rows in a foreign currency. This record chose the correct side for the
  new export and left the old one alone; reconciling them is its own change.
- **Nothing pins the font threading.** As above — the spec covers the fallback
  path because that is the one an offline runner can reach.
