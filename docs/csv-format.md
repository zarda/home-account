# CSV export and import

Two formats out, one parser in. The short version: **the detailed export is the
one that round-trips.** Everything it writes comes back as what it was —
including a category with a comma in it, a note with a line break, and a
description that starts with `=`.

Why the file is treated as a contract rather than a rendering, and what was
rejected on the way, is in [ADR 0011](ADR/0011-the-csv-file-is-a-contract.md).
This document is the part you need when exporting, re-importing, or adding a
column.

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
| `Category` | the translated category name, in the locale that exported |
| `Amount` / `Amount (Base)` | plain decimals, never guarded, so `SUM()` works on the column |
| `Tags` | joined with `; ` in one cell |
| `Location` | the place name only; coordinates stay in the JSON backup |
| `Period` | `weekly`, `monthly`, `yearly`, or empty |
| `Recurring` | `true`, or empty |

## What round-trips, and what does not

| | Detailed CSV | Summary CSV | JSON backup |
|---|---|---|---|
| date, type, amount, currency | yes | yes | yes |
| description, note, tags, location name | yes | — | yes |
| budget period, recurring flag | yes | — | yes |
| **category** | written, **not read back** | written, not read back | yes |
| location coordinates, receipt images, ids | — | — | yes |

**Category is written but never re-imported.** The importer has no `category`
probe, so every row from a CSV lands in the catch-all category and has to be
recategorised by hand. The column is there for reading the file, not for
restoring from it. This is the sharpest reason not to treat a CSV as a backup.

**Summary is lossy on purpose.** It drops description, note, tags and location,
so carrying a period would not make it round-trip — it would only cost it the
at-a-glance shape it exists for. Export detailed if you intend to import again.

For a full-fidelity copy, use **Settings → Export full backup** (JSON), which
carries the whole document, categories included.

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

**Settings → Import CSV** accepts a bank or another app's export. Columns are
matched by name, case-insensitively, on a substring:

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

Date, description and amount are required; a row missing any of them is skipped.
Everything else is optional and read defensively, which is what lets a CSV
exported before `Period` and `Recurring` existed still import.

An amount may be `1,234.56`, `$1,234.56`, `-45.00` or `(45.00)` — the last two
both mean an expense. With no `type` column, the sign decides. With no `amount`
column, `debit` and `credit` are used instead.

### What is validated and quietly dropped

- A **currency** that is not a real ISO code falls back to your base currency.
- A **period** outside `weekly`/`monthly`/`yearly` is dropped. This matters
  because the match is a substring: a statement carrying a `Statement Period`
  column lands on the period probe with a value like `2024-01 to 2024-02`, and
  validation is what keeps that harmless.
- A **recurring** cell is read as true only for `true`, `yes` or `1`; anything
  else means "not set" rather than false.
- Unquoted fields are trimmed, so `Date, Description, Amount` works. Quoted
  fields are returned byte-exact, because trimming them would defeat the
  round trip the quoting exists to provide.
- An unterminated quote at end of file flushes what it has rather than failing —
  a truncated download should import what survived.

## Known gaps

- **The AI import wizard's CSV path drops period and recurrence.** It maps rows
  onto the shape the AI providers return, which has no field for either. Use
  Settings → Import CSV for a round trip.
- **A spreadsheet may show the guard.** The apostrophe reliably stops evaluation
  everywhere, but whether it is displayed varies by application and version. The
  importer strips it back off; a file edited and re-saved by a spreadsheet that
  displays it will keep it as literal text.
- **Category is not imported at all**, from this app's exports or anyone else's.
  There is no `category` probe, so every imported row takes the catch-all
  category. Exported names are translated into whichever locale exported, which
  is part of why matching on them was never attempted.
