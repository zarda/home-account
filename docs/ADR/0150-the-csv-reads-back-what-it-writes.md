# 150. The CSV reads back what it writes

**Status:** Accepted, implemented · **Date:** 2026-09-24 · **Issues:** #443

Reference documentation lives in [../csv-format.md](../csv-format.md).

Closes the deliberate non-round-trip
[0011](0011-the-csv-file-is-a-contract.md) recorded, and the two gaps
[0059](0059-one-mapper-builds-every-imported-transaction.md) carried beside it.

## Context

0011 made the CSV a contract: every column the detailed export writes comes
back on import as what it was. One column was the exception, and 0011 said so
in its known gaps. `parseCSV` had no `category` probe, so every row through
Settings → Import CSV landed on the catch-all whatever the file said, and had
to be recategorised by hand. Closing it meant matching a translated display
name back to a category id, across locales and against categories the user
had renamed — a different problem from CSV syntax, and deliberately not
started there. [0045](0045-a-confidence-grade-names-its-source.md) left the
Settings door filing every row under the catch-all for the same reason, and
0059 recorded Category as export-only.

The wizard's CSV door was no better, in the other direction. It never read
the column either, and overwrote every row with the categorisation ladder's
answer, so a file that named every category correctly still went to the
ladder — and, with a provider configured, to a model — and came back graded as
a guess.

The tags cell had the second hole. The export joins tags with `; ` and the
importer split on the same literal, so a tag containing the separator came back
as two — 0059's other gap. The escaper was not the problem: commas, quotes
and newlines inside a tag survive it. The join was.

## Decision

**A category the file names exactly is the category the row gets; a name the
file does not name exactly is not guessed at; and a tags cell is written in a
shape its reader cannot misread.**

### Exact names only, over the row's own side

`resolveExactCategoryName(name, type, categories, translate)` in
`categorization.utils.ts` trims and lower-cases the cell and compares it with
every name an active catalogue entry of the row's own type can be written
under: its stored name, that name through the active translation, and its
rendering in every shipped locale. A `'both'` entry fits either type. Exactly
one entry matching is an answer; none, or more than one, is not.

**The ladder's matcher is the wrong tool for a file.** `matchCategoryName` is
built for a model's free text: after the id and the exact names it tries a
partial match and then a keyword table, because a model answering "gas
station" meant something and the job is to find out what. A file's cell is not
free text. It is a name this app wrote, so it names a category exactly or it
does not name one. Given the partial pass, a near-name would land on whichever
entry the pass met first — *Food* on *Food & Drinks*, when *Fast Food* and
*Pet Food* contain it just as well — and on the Settings door nobody would be
shown the guess.

**Every shipped locale, and custom names.** The export writes names in the
locale that exported it, and the file does not say which that was. A file
written in Japanese reads back in an English session. A custom category
matches under the name the user typed.

**Ambiguity reads as unmatched.** The export writes a category's own name,
never *Parent / Child*, so two custom children with the same name under
different parents are written identically, and a cell naming them names
neither. Picking one would file the row under a category the file may not have
meant. On the shipped catalogue this never fires: across all 133 default
entries, no two of one type share a name in any shipped locale. The one name
the two sides do share — *Miscellaneous*, a child of both catch-alls —
resolves, because the row's type decides which side it is looked up on.

`categoryNameCandidates` builds the name list, and `matchCategoryName` now uses
it too, so the two resolvers differ only in what they do with a name once it
is found. Both trim what they compare.

### The Settings door stays model-free and says what it could not match

`parseCSV` probes a `category` column, reads the catalogue once per file, and
sets two things on a row. `categoryId`, when the cell resolved; and `category`,
the cell as written, whenever the file carries the column at all — the signal
that the file named a category, whatever came of it. `toCreateTransactionDTO`
already honoured `categoryId`, and falls back to the row's own side's
catch-all ([0147](0147-a-row-is-graded-by-what-its-door-can-vouch-for.md))
when there is none.

**An unmatched row takes its catch-all, and the preview counts it.** The door
makes no model call and needs no connection, and a ladder fallback would
change both for every file a bank exports. The ladder is also
private to `AIImportService`, which injects `ExportService`, so reaching it
from here would be a cycle as well as a request. Instead
`unmatchedCategoryCount` counts the rows whose file carried the column and
resolved nothing — an empty cell included — and the preview says *N rows'
categories could not be matched and will use the default category*
(`settings.csvUnmatchedCategories`) when there are any. A file with no Category
column counts nothing and shows nothing: it named no categories, so it has none
unmatched.

### The wizard door keeps a named category

The wizard's CSV door reads the `categoryId` the parser already resolved — it
never resolves a cell a second time — and grades it `EXACT_CATEGORY_GRADE`,
1.0. Nothing was read and nothing was guessed: a name in the file was checked
against the catalogue that named it. Only the rows the parser could not resolve
climb the ladder, and a file whose every row resolved makes no ladder call at
all.

### A tags cell its reader cannot misread

`encodeTagsCell` keeps the `; ` join for the ordinary case, so an untouched
export still reads as plain text in a spreadsheet. It writes a JSON array of
strings instead in two cases:

- **some tag contains `; `** — the split cannot tell it from a boundary;
- **the join, trimmed, would start with `[`** — the reader takes a leading `[`
  as its cue to try JSON, so a join that merely looks like an array would be
  read as one. The single tag `["x","y"]` would come back as two tags, and the
  single tag `[]` as none at all.

`decodeTagsCell` reads the JSON form only when the cell starts with `[` *and*
parses to an array of strings. Anything else takes the old split — which is
what keeps a file written before this format importing, a tag spelled
`[draft]` included. The escaper already quotes a cell containing `"` or `,`,
so the JSON form passes through `escapeCsvCell` and `parseCsvRows` unchanged.

## What was rejected

- **The ladder's matcher for the file.** See above: its partial and keyword
  passes exist to guess, and a file names a category or does not.
- **Falling back to the ladder on the Settings door**, which #443 proposed. It
  would put a model call on the one import door that makes none, and a guess on
  the door that has no review step to show it.
- **Matching only in the exporting locale**, which #443 also proposed. The
  file does not record it.
- **Picking one of two same-named entries.** Either choice is a guess the file
  did not make.
- **Always writing JSON.** Every export would lose its plain-text tags column
  for the sake of a case almost no tag meets.
- **Escaping the separator inside a tag.** It invents an escape convention of
  this file's own, which anyone editing the cell in a spreadsheet would have to
  know and keep.

## Consequences

- **Export, then import, restores every row's category**, through either door,
  in whichever shipped locale the file was written — the detailed and the
  summary format alike, since both carry the column.
- **The CSV is still not a backup.** A category comes back by name, so one the
  account has since deleted, or two that share a name, take the catch-all; ids,
  coordinates, the country and receipt images still travel only in the JSON
  backup.
- **The wizard door no longer pays for rows the file already answered.**
- **`AIImportService` gains no translation dependency.** The name is resolved
  once, in the parser, and the door reads the answer.
- **One catalog key**, `settings.csvUnmatchedCategories`, plural in English and
  a plain count in Japanese and Traditional Chinese.
- **An emulator file proves the round trip end to end.**
  `csv-round-trip.smoke.spec.ts` writes an expense and an income transaction
  in two categories, one carrying the tag `a; b`, through the real
  `TransactionService`; exports them through `ExportService.exportToCSV`;
  imports the text through the data hub's own confirm path; and reads both new
  documents back with their categories and the one tag intact.

## Departures from the issue

- **Unmatched rows take the catch-all and are counted, rather than climbing
  the ladder.** A product decision, for the reasons under *What was
  rejected*.
- **Every shipped locale, not the exporting one.**
- **JSON only when the plain join would be misread**, rather than a JSON array
  in every cell. The issue offered the array or an escaped separator; the
  conditional array keeps the common file unchanged, and its second condition —
  a join that starts with `[` — is one the issue did not name.

## Things that only became apparent while building

- **A cell can look like JSON without being meant as JSON.** The first cut
  wrote the array only when a tag contained `; `; a single tag spelled as a
  JSON array came back as two tags, and one spelled `[]` came back as none. The
  writer now tests the same leading `[` the reader keys on.
- **The export suite's auth mock was signed out.** `CategoryService` clears its
  categories when no user is signed in, on the microtask queue rather than at
  once, so a category a case seeded survived the export's synchronous read and
  was gone by the time the import read the catalogue after an `await`. Nothing
  noticed until the importer read the catalogue at all. The suite's auth mock
  now signs in.
- **The wizard door resolved each row twice.** Its first cut matched the cell
  again, with its own translation dependency, although the parser it calls had
  already done the work. It reads the parser's answer now.
- **The type filter is what keeps *Miscellaneous* resolvable.** Without it the
  shipped catalogue would carry one ambiguous name, in all three languages.

## Known gaps

- **A cell an older build wrote that happens to parse as a JSON array of
  strings is read as that array.** A single tag spelled `["x","y"]` comes back
  as two, and the two tags `["a` and `b"]`, joined as `["a; b"]`, come back as
  one. The older writer had no reason to avoid either.
- **The preview counts the unmatched rows; it does not name them.** A file
  with a few custom duplicates says how many rows will use the default
  category, not which.
- **A deleted category cannot come back through a CSV.** Its name matches no
  active entry, so the row takes the catch-all; the JSON backup is the door
  that carries ids.
- **Each row rebuilds every entry's name list.** Resolution costs rows times
  catalogue entries; nothing caches the candidate lists across the rows of one
  file.
- **The trim reaches the model's resolver too.** `categoryNameCandidates` trims
  each name for both callers, which widens `matchCategoryName`'s partial pass
  for a custom name stored with stray spaces: it now matches an answer it used
  to miss. Benign, and not what the change was for.
