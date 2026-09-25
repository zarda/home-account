# CSV export and import

Two formats out, one parser in. The short version: **the detailed export is the
one that round-trips.** Everything it writes comes back as what it was —
including a category with a comma in it, a note with a line break, and a
description that starts with `=`.

Why the file is treated as a contract rather than a rendering, and what was
rejected on the way, is in [ADR 0011](ADR/0011-the-csv-file-is-a-contract.md);
how the importer came to read the Category column back, and the tags cell to
survive a tag containing its own separator, is in
[ADR 0150](ADR/0150-the-csv-reads-back-what-it-writes.md). This document is
the part you need when exporting, re-importing, or adding a column.

## The two formats

Headers are fixed English in both, in every locale. They are how the importer
finds its columns, so translating them would make an export unreadable by the
app that wrote it.

**Summary** — five columns, for reading:

```
Date, Type, Category, Amount, Currency
```

**Detailed** — twelve columns, for round-tripping:

```
Date, Type, Category, Description, Amount, Currency, Amount (Base),
Note, Tags, Location, Period, Recurring
```

| | |
|---|---|
| `Date` | `yyyy-MM-dd`, the **local** calendar day the app displays — not the UTC rendering of the same instant |
| `Type` | `income` or `expense` |
| `Category` | the category's own translated name — never *Parent / Child* — in the locale that exported; `Unknown` for a row whose category id the catalogue does not hold |
| `Amount` / `Amount (Base)` | plain decimals, never guarded, so `SUM()` works on the column |
| `Tags` | joined with `; ` in one cell — or, when a tag contains `; ` or the join would start with `[`, a JSON array of strings (`["a; b","c"]`) |
| `Location` | the place name only; coordinates and the country stay in the JSON backup |
| `Period` | `weekly`, `monthly`, `yearly`, or empty |
| `Recurring` | `true`, or empty |

## What round-trips, and what does not

| | Detailed CSV | Summary CSV | JSON backup |
|---|---|---|---|
| date, type, amount, currency | yes | yes | yes |
| description, note, tags, location name | yes | — | yes |
| budget period, recurring flag | yes | — | yes |
| **category** | by name — see below | by name | yes, by id |
| location coordinates, country, ids | — | — | yes |
| **receipt images** | — | — | see below |

**Category comes back by name, and only an exact one.** The importer matches
the cell against the account's active categories of the row's own type —
stored names, custom names, and every shipped locale's rendering, since the
file does not say which locale wrote it — and takes a match only when exactly
one entry answers. A name that matches nothing, or that two entries of one type
share, is not guessed at: the row takes its type's catch-all, `other_income`
or `other_expense`. That is the sharpest reason a CSV is still not a backup —
a category the account has since deleted, or two custom categories that share
a name, cannot come back through it, where the JSON backup carries the id.

**Summary is lossy on purpose.** It drops description, note, tags and location,
so carrying a period would not make it round-trip — it would only cost it the
at-a-glance shape it exists for. Export detailed if you intend to import again.

**No export carries receipt images.** They are Storage objects, and a text file
holds none. A JSON restore therefore cannot bring a receipt back — but it does
not destroy the ones already on a row it writes over, because it merges rather
than replaces. See [backup-restore.md](backup-restore.md).

**A split purchase exports as plain rows.** Neither CSV format has a column
for the group a split's parts share — each part is just another row, with
its own category and amount, and nothing in the file says the three came
from one purchase. The group id is JSON-only: the full backup carries it,
because that export writes every field a transaction has. See
[docs/splits.md](splits.md).

For a full-fidelity copy, use **Data Management → Export full backup** (JSON),
which carries the whole document, categories included.

## The category summary

A third file, and a different shape: **one row per category and side of the
ledger**, not one row per transaction. Reports → Export offers it as its own
format beside CSV, PDF and JSON, alongside a PDF of the same figures.

```
Type, Category, Amount, Currency, Transactions
```

| | |
|---|---|
| `Type` | `income` or `expense` — a category carrying both yields **two rows**, never a netted one |
| `Category` | the translated category name, as everywhere else |
| `Amount` | the period total, a bare decimal so `SUM()` works on the column |
| `Currency` | always the account's base currency, repeated on every row |
| `Transactions` | how many rows are behind the total |

Expenses come first as a block, then income, each side largest-first — the
order does not reshuffle on a month where income happens to outweigh spending.
The file is **untruncated**: it is the whole period, not a ranked top slice.

**Amounts are in the base currency, converted the way the rest of the app
converts.** Each transaction contributes its write-time `amountInBaseCurrency`
snapshot where it has one, so the summary agrees with the figures on screen for
the same period rather than re-converting history at today's rates.

**It does not import.** Nothing about it round-trips: the totals are not
transactions. Export detailed if you intend to import again.

### `summary` and `summary-csv` are different things

Two unrelated things in this codebase are called summary, and the next person
to touch either will want this stated plainly:

| Name | What it is |
|---|---|
| `ExportOptions.format: 'summary'` | the **five-column, per-transaction** CSV described under [The two formats](#the-two-formats) — lossy, one row per transaction, and what the "Summary CSV" column of the table above refers to |
| the export dialog's `'summary-csv'` | the **per-category totals** file described in this section |

They share four letters and nothing else. Merging them, or teaching one option
to produce the other, silently changes what an existing export writes.
[ADR 0093](ADR/0093-the-summary-export-names-both-sides-of-the-ledger.md) has
the reasoning behind the category summary, including why it is a separate PDF
builder rather than a mode of the existing one.

## Quoting and formula guarding

Every cell goes through one escaper. Two rules beyond RFC 4180 quoting:

> Every exported cell passes through one escaper, which prefixes a single
> apostrophe when the cell does not parse as a decimal number and its first
> character is `=`, `+`, `-`, `@`, tab, carriage return, or an apostrophe; on
> import a leading apostrophe is removed only when the character following it is
> one of those same characters, so every guard the app wrote is undone and an
> apostrophe the app did not write is left alone.

In practice:

- A cell containing `,` `"` `\n` or `\r` is wrapped in quotes, with embedded
  quotes doubled.
- A cell a spreadsheet would read as a formula is prefixed with `'`, so it opens
  as text. Descriptions come from parsed receipts and imported bank statements,
  so this is not hypothetical.
- **Numbers are never guarded.** `-45.00` stays `-45.00`, so summing the Amount
  column in a spreadsheet still works. `-1+1` is not a number, is a live formula,
  and is guarded.
- A description that legitimately starts with an apostrophe — `'til payday` —
  survives the round trip, and so does one in a bank's CSV this app never wrote.

Rows are written `\n`-terminated. The importer accepts `\n`, `\r\n` and a lone
`\r`, because foreign exports use all three.

## Importing someone else's CSV

**Settings → Import CSV** accepts a bank or another app's export. It is one of
two doors: the AI import wizard also accepts a CSV, and its rows climb the same
categorization ladder as image imports (#258) — a merchant the user already
corrected is answered from category memory when the remembered category is on
the row's own side of the ledger, the rest go to the configured
provider in grounded batch calls, and whatever no one can answer keeps a
low-confidence floor the review step flags. Settings → Import CSV stays
model-free. A Category column is read first on both doors: a row whose cell
names a category exactly keeps it — on the wizard at full grade, without a
model call — and only the rest are categorised, by the ladder on the wizard and
as the type's catch-all on Settings → Import CSV, whose preview says how many
rows that will be. Either way, columns are matched by name,
case-insensitively, on a substring:

| Column | Header names accepted |
|---|---|
| date | `date`, `transaction date`, `posted date` |
| description | `description`, `memo`, `payee`, `merchant` |
| amount | `amount`, `value`, `sum` |
| debit / credit | `debit`/`withdrawal`/`expense`, `credit`/`deposit`/`income` |
| type | `type`, `transaction type` |
| currency | `currency` |
| period | `period` |
| recurring | `recurring` |
| note | `note` |
| category | `category` — matched exactly by name over the row's own type, as above |
| tags | `tags` — a cell that starts with `[` and parses as a JSON array of strings is read as that array; any other cell splits on `; `, the export's own join, which is what a file written before the JSON form still imports through. Each tag is normalized the way the form normalizes a typed one |
| location | `location` — the cell becomes the place name; coordinates are never invented |

Amount is the only truly required value: a row too short to reach the date,
description or amount column is skipped, and so is a row whose amount cannot
be read — but a missing date defaults to today and a missing description to
`Unknown` rather than skipping the row. Everything else is optional and read
defensively, which is what lets a CSV exported before `Period`, `Recurring`,
or the read-back of `Note`/`Tags`/`Location` existed still import.

An amount may be `1,234.56`, `$1,234.56`, `-45.00` or `(45.00)` — the last two
both mean an expense. With no `type` column, the sign decides. With no `amount`
column, `debit` and `credit` are used instead.

### What is validated and quietly dropped

- A **currency** that is not a real ISO code falls back to your base currency.
- An **amount** is rounded to that currency's minor unit, on the wizard's door
  and on the data hub's alike: `179.33 JPY` imports as `179`, because the yen
  has no minor unit to keep the fraction in
  ([ADR 0117](ADR/0117-every-doors-figure-is-whole-in-its-currency.md)).
- A **category** cell that names no active category of the row's type
  exactly, or names two, is not guessed at: the row takes its type's
  catch-all. Settings → Import CSV counts those rows on its preview —
  *N rows' categories could not be matched and will use the default
  category* — and a file with no Category column counts none.
- A **period** outside `weekly`/`monthly`/`yearly` is dropped. This matters
  because the match is a substring: a statement carrying a `Statement Period`
  column lands on the period probe with a value like `2024-01 to 2024-02`, and
  validation is what keeps that harmless.
- A **recurring** cell is read as true only for `true`, `yes` or `1`; anything
  else means "not set" rather than false.
- An empty **note**, **tags** or **location** cell produces no field at all —
  never an empty string, an empty list, or a `{ name: '' }` the rules would
  accept while meaning nothing.
- Unquoted fields are trimmed, so `Date, Description, Amount` works. Quoted
  fields are returned byte-exact, because trimming them would defeat the
  round trip the quoting exists to provide.
- An unterminated quote at end of file flushes what it has rather than failing —
  a truncated download should import what survived.

## Known gaps

- **A spreadsheet may show the guard.** The apostrophe reliably stops evaluation
  everywhere, but whether it is displayed varies by application and version. The
  importer strips it back off; a file edited and re-saved by a spreadsheet that
  displays it will keep it as literal text.
- **A category is matched by name, not by id.** A category deleted since the
  export, or two custom categories of one type sharing a name, take the
  catch-all; the preview says how many rows, not which.
- **An older file's Tags cell can be misread as JSON.** A cell written before
  the JSON form existed that happens to parse as an array of strings — the
  single tag `["x","y"]`, or the two tags `["a` and `b"]` joined as
  `["a; b"]` — is read as that array.
