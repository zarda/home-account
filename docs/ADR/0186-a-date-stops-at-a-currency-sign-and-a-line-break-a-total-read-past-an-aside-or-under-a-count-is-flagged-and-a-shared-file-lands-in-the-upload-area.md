# 186. A date stops at a currency sign and a line break, a total read past an aside or under a count is flagged, and a shared file lands in the upload area

**Status:** Accepted, implemented · **Date:** 2026-10-31 · **Issues:**
#515, #516, #518

Reference documentation lives in [../receipt-import.md](../receipt-import.md),
[../share-import.md](../share-import.md), [../dates.md](../dates.md),
[../import-fields.md](../import-fields.md),
[../accessibility.md](../accessibility.md),
[../locale-formatting.md](../locale-formatting.md),
[../ui-overflow.md](../ui-overflow.md) and [../e2e.md](../e2e.md).

[0185](0185-a-refund-is-asked-about-at-every-door-and-a-category-follows-its-rows-side-there-and-back.md)
left two parser readings recorded and unfixed in its Known gaps: a priced line
read as a date, which also drops the price from the amount hunt (#515), and a
regular price in parentheses read as the total, graded 0.8 with no flag
(#516). A date now stops at a currency sign and at a line break, so a priced
line whose sign stands before its price is money. That puts every count, size
and code printed beside such a price back in the amount hunt, where it
outranks the price, so this record also decides which figures on a line are
money. The text parser grades under the review bar a total it reads past a
labelled aside, or under a larger count it takes for one that might have been
the total, as it already graded one the cash-tendered sum picked; and on the
device's model lane a model that agrees with a total a rule picked no longer
lifts it. Some receipts the old date reader read right only because it
stopped at a date it had read through a sign or across a line break read
wrong now; each such class is listed under Known gaps with its counts, a
pinned case and a battery row.

A file shared from another app never reached the upload area (#518). The
share wrote the wizard's selection alone; the dropzone kept its own list and
sent the whole of it on its next change, so the next pick or remove dropped
the shared file without a word. A shared file now lands on the dropzone's
list as a pick's would, with its row and its preview, and a file the share
gate turns away is named in the dropzone's own alert. A share made while the
wizard is open reaches it, one drain at a time; one made while a run or a
review holds the wizard waits; and two files of one name each keep their own
row and preview.

The first browser run met nine defects older than these issues, on the
upload area, the wizard's step headers, the review card and a device row's
flags, and the specs added for them met two more. Each is fixed here with a
spec, and three of their classes become gates. Among them, a device row's
amount and date flags no longer quote a percentage nothing measured.

Closes a gap of
[0185](0185-a-refund-is-asked-about-at-every-door-and-a-category-follows-its-rows-side-there-and-back.md)
and one of
[0165](0165-the-period-pickers-are-bounded-unavailable-totals-offer-retry-and-three-smaller-papercuts-close.md).

Narrows a gap of
[0147](0147-a-row-is-graded-by-what-its-door-can-vouch-for.md).

Amends [0013](0013-the-printed-total-is-the-amount-not-the-item-sum.md),
[0147](0147-a-row-is-graded-by-what-its-door-can-vouch-for.md) and
[0162](0162-a-refund-read-on-the-device-is-filed-as-income-and-the-review-asks-about-it.md).
Their rules stand. 0013's largest-wins keeps its cash-tendered correction and
gains three more: which figures on a line are money, a count and an aside.
0147's model lane keeps the parser's own grade on a total a rule picked, and
flags a model that differs from a total the parser read beside a currency mark
even where a rule or the cash-tendered sum moved it there. 0162 left the
percentage off the type's sentence because no reading stood behind one; a
device row's amount and date sentences now carry none either.

Applies [0008](0008-universal-receipt-language-support.md): every rule here
reads typography, never a word, in any language. Applies
[0019](0019-share-intake-lands-through-a-stash.md)'s promise that a shared
file ends at the wizard's ordinary intake, through the dropzone's own gate,
which held in the code only for the wizard's selection. Applies
[0036](0036-a-user-facing-string-lives-in-the-catalog.md) to ten new keys in
en, ja and tc, the word for a byte and the stop that joins sentences among
them. Applies [0045](0045-a-confidence-grade-names-its-source.md): a flag
quotes a percentage only where a model reported one. Applies
[0113](0113-the-wizards-picker-takes-a-backup-and-grades-the-category-it-defaulted.md):
a backup stays out of the share door, and its refusal sends the reader to the
upload area, which takes one. Applies
[0123](0123-the-unit-sweep-is-silent-on-a-normal-path.md): every new case is
silent on a passing run. Applies
[0144](0144-a-blanked-template-is-paired-with-a-describe-that-renders-it.md):
the share is driven through the wizard's rendering describe, with the real
dropzone. Applies [0145](0145-a-class-found-by-reading-becomes-a-gate.md): a
list keyed by a file's name becomes a lint rule, the battery's readings a
spec, and three classes of unnamed control rules of `icon-labels:check`.
Applies [0171](0171-second-copies-fold-into-one-copy-of-each-helper.md):
Import History's copy of the file-size formatter folds onto the one the
upload area reads.

## Context

### The parser

The text parser is the device's last resort when no model can read a receipt,
and the second witness to the total Apple Intelligence reads there: the model
reports no grade, so its amount is graded by whether the parser read the same
figure (0147). Both of 0185's parser gaps sit in that reader.

The date pattern's separator took any run of one to three characters that are
neither digits nor cased letters, a currency sign and a line break included.
So the `1 $10` of `Item 1 $10.00` read as a date in 2000 (10 January, or 1
October on a device that writes the day first), graded 0.3, and the matched
text came out of the amount hunt: a one-line receipt read no amount, a date
printed further down lost to the slip above it, and a total's cents read
together with a date printed under it (`Total $5.15` over `01/15/2026` read
2026, dated 15 May 2001). A code beside a price read as a date graded 0.9,
which the import keeps (`SKU 2025 $1.10` read 10 January 2025). Of 13,608
receipts built from six layouts of 72 prices under 31 counts, and 216 coded
lines, 10,755 read as dates.

The amount hunt took the largest figure on any line that printed a currency
mark, so a regular price in parentheses under the total
(`Total $12.50 / (Reg $15.00)`) read 15.00 at 0.8 with no flag: the one silent
row of 0185's sixty-receipt battery.

Fixing the date alone makes the amount worse. The counts, sizes and codes the
date pattern used to swallow (`Pack of 24`, `SKU 1234`, `500ml`) come back
into the hunt on a line with money and outrank the price. The slip had been
hiding a defect 26.10.180 already has wherever the slip does not reach:
`SKU 1234 $1.45` reads 1234. With only the date pattern changed, 5,842 of
18,690 priced-line receipts that 26.10.180 read right or flagged (1,543 of
them wrong but flagged) read a count at 0.8 instead (5,846 to 5,926 under the
other zone and day orders). A rule that reads such figures as no money has to
know when a bare whole number is the total itself (`Total 1280 Tax ¥116`,
`内税 ¥72 合計 980`), and a total picked by inference rather than off the print
has to say so in its grade, or the model lane lifts whatever a model agrees
with to 0.8.

The old pattern also read right some receipts it had no business reading
right. The reader takes the first date it can, and the sign and the line break
gave it one on lines that print none, above the total: the `1 $10.00` of a
priced line, or the cents that end one line and the figures that open the
next. Having found it, the reader never reached a later run that only looks
like a date, and the line break it read across joined a bare total to a signed
line. A date that stops at the sign and at the line break gives up both
accidents, so every class that exposes was measured on both lanes before the
rule was chosen, against 26.10.180 and against the narrower and the wider
rules under What was rejected.

Every reading here is typography: digits, marks, signs, parentheses, the line
a figure is printed on and its place on that line. No word is read in any
language (0008), and every class found by reading receipts becomes a gate
(0145). Silence is counted in the stricter sense throughout: an amount read
wrong at 0.7 or more, a refund read as a purchase graded 0, or a purchase read
as a credit graded 0.5 or more; on the model lane, a wrong amount graded 0.7
or more, counted once for each figure the receipt prints, as a model might
read any of them. Every count is as read on 30 October 2026: the future-date
guard turns down a date more than a day ahead of the clock, so a count that
takes in such dates moves from one day to the next, and the guard, not the
zone's offset, makes the spreads given with a second figure.

### The shared file

0019 put a shared file through a stash to the wizard's ordinary intake,
behind the dropzone's own gate. In the code that held only for the wizard's
selection. `consumeSharedFiles` handed the files to `onFilesSelected`, and
the dropzone, which keeps its own list and emits the whole of it on each
change, never saw them. The upload area showed nothing while **Process with
AI** was enabled, and the next pick or remove sent the zone's list alone,
dropping the shared file without a word.

Three neighbours sat beside it:

- **The share gate said nothing.** It dropped what it would not take — a file
  over the 10 MB ceiling, an empty one, one of a type it does not take, a
  backup — before the wizard saw it. A raw HEIC from the Files app, which
  [0039](0039-a-share-arrives-typed-and-the-stash-answers-to-its-owner.md)
  records as rejected, was one.
- **A reused wizard never drained.** The wizard read its query params once,
  from the route's snapshot. On iOS a share made while the wizard is open
  navigates to the same route with new params, the router reuses the wizard,
  and the share waited for a later load.
- **Rows and previews were keyed by the file's name.** Two photos from an
  iPhone are both `image.jpg`, so two shared at once showed one preview
  twice, and removing either blanked the other.

## Decision

### A date stops at a currency sign and a line break, and a total read past an aside or under a count is flagged

Six decisions, each read from typography alone. No word is read (ADR 0008).

1. **Dates.**
   - A date is read from figures printed together on one line, and never
     through a currency sign: DATE_SEPARATOR excludes \p{Sc} and the line
     break. It still takes one to three of any other mark or space, so a
     two-digit year may follow any of them, as on 26.10.180 (`15.01.26`,
     `15/01-26`, `15/01 26`, `15/01/'26`).
   - A date whose year comes last never starts inside a figure, right after a
     digit and a mark that joins it to more digits, nor at a figure a currency
     sign is glued to: the cents of `$145.01` are not the day of
     `$145.01 01 01 24`, which keeps its 145.01 and is dated 1 January 2024,
     and the 27.01 of `Total $27.01 12/5/24` starts no date, so the total reads
     27.01, dated 5 December 2024. Only a sign glued to the figure bars it: past
     a space or a line break, a date after a trailing sign still reads
     (`Total 5,00 € 15.01.26`, `Summe 12,50 €` over `15.01.2026`). The rule
     reads the character before the date rather than looking behind it: the
     app's iOS deployment target, 15.6, has no lookbehind.
   - The year-first pattern keeps 26.10.180's shape and its place ahead of
     the year-last one. It shares the separator, so it too stops at a
     currency sign and a line break. The reader's loop, its group numbers and
     its future-date guard are unchanged.
   - Of the 13,608 priced-line receipts, 10,755 read as dates on 26.10.180
     and 3,530 now (3,532 on Tokyo's clock). They are the two layouts that
     print no sign, or print it after the price (`Milk 1 3.25`,
     `Brot 1 2,10 €`), 1,765 of 2,232 each, every one graded 0.3 or 0.5. The
     layouts with the sign before the price or the price on a line of its own
     read no date, and no amount among the 13,608 is wrong.
   - Of 418 receipts in 38 date formats and 11 contexts, none loses its date
     and 56 gain one. Of 7,680 receipts whose total's cents a spaced date
     follows, 1,080 that 26.10.180 read silently read right.
   - The bar on a glued sign was measured on its own sets. Of 9,600 receipts
     whose total line ends in a date after the price (ten ways of printing the
     sign or the code beside it, eight prices, six formats, twenty dates, under
     `Item 1 $1.00`), each of the seven forms led by a sign or a code read 377
     of 960 silently without the bar, and 26.10.180 711 of every form's 960.
     With it, the three glued forms (`$27.01`, `€27,01`, `-$27.01`) read none
     silently; the forms with the sign spaced from the price or a code before
     it (`$ 27.01`, `€ 27,01`, `USD 27.01`, `USD27.01`) keep their 377, and the
     three trailing forms read none silently either way. The bar's cost: of
     1,080 receipts with a date glued after a sign (`€15.01.26`; `$`, `€` or
     `£`, on its own line, after a label or before the total on its line, six
     formats, twenty dates), 26.10.180 read every amount right and dated 810;
     now none is dated, 378 read a wrong amount silently and 378 flagged
     (Known gaps). The counts elsewhere in this record were taken before the
     bar, with the glued forms counted in; the battery's rows and lists are
     re-recorded under it.

2. **Which figures on a line are money** (amends 0013's 'largest-wins, with
   one correction').
   - A figure is money where a sign or the receipt's code touches it, or where
     it has cents or grouping.
   - A sign between two figures touches the one it is glued to, else the one
     written like money; where nothing tells them apart, it touches both, and
     both are money.
   - A bare whole number beside money on its line is a count, a size or a
     code, and falls to the plain tier, even where it repeats that money's
     value (`TOTAL 14 Card -$14`). An aside prices no line.
   - The two halves of a time are neither money nor a count. For the
     direction, every figure on a line that prints money is a copy of a total
     of its value, counts and the halves of a time included.
   - Copies of the total are read off the line, not the tier.
   - These rules move a reading at its tier's own grade, because the figure
     then read is printed as money, unless a larger count stands beside it
     (decision 3).

3. **A count that might have been the total**, called a rival below.
   - A count stands where a total does when a letter follows it past a space,
     past a run of marks or a percent figure, or past letters glued to it such
     as a currency written in letters (`Total 9, Tax $1.00`,
     `Total 120 8% Tax $9.60`, `合計 980円 内税 ¥72`), or when it is printed after
     its line's money (`内税 ¥72 合計 980`). A count of what a price buys stands
     before the price (`Pack of 24 $5.00`, `緑茶 500ml ¥151`).
   - Where a count larger than the figure read stands beside money, and the
     figure is printed once in its tier or the count stands where a total
     does, the reading is graded 0.6 'count'.
   - Where that count shares a line with a copy of the total, or stands where
     a total does on any line, the total's credit mark is twinned to 0.3
     (`Total 12 Tax -$0.96`; `Coupon -$3.00` over `Tax $1.00 Total 12`).
   - The cash-tendered pair may take, as the total or as the change, a count
     printed on the pick's own line or one standing where a total does.

4. **The labelled aside** (#516).
   - A figure inside parentheses that hold a letter as well, and not
     credit-marked, is never the total while its tier holds a figure printed
     on its own, unless the cash-tendered sum picks it: asides still count in
     that sum, and as copies of the total.
   - Passing it, or keeping it for want of anything else while a weaker tier
     holds a figure printed on its own, is graded 0.75× its tier, 'aside': 0.6
     beside a currency mark, 0.38 among figures written like money.
   - Fullwidth parentheses count, and so does one left unclosed at the end of
     a line that the next line closes.
   - TENDER_DEMOTION_FACTOR is renamed DEMOTION_FACTOR and exported.
     ParsedReceiptText gains amountDemotion?: 'tender' | 'aside' | 'count',
     present only when set.

5. **The model lane** (amends 0147's agreement and disagreement grades). Of
   the three corrections that move or keep the parser's reading on something
   other than its own print, the cash-tendered sum is arithmetic on the print;
   the aside and the count are rules. Each leaves a demoted reading in the
   strongest tier graded at least VERIFY_FIELD_THRESHOLD × DEMOTION_FACTOR.
   - Agreement: a total a rule picked keeps the parser's grade, 0.6. A total
     the cash-tendered sum picked still lifts to 0.8, unless the aside or the
     count rule holds of it too and labels it (Things that only became
     apparent).
   - Disagreement: disputed at 0.5 wherever the parser read its figure beside
     a currency mark, graded 0.7 or more or moved there by a rule or by the
     cash-tendered sum. A disagreement with a parser reading weaker than that
     still lifts the model's total to 0.8, as 0147 decided.

6. **Gates** (ADR 0145).
   - A sweep of 1,800 readings: counts, codes and prices printed with the sign
     before the price, or on a line of their own.
   - 48 named parser cases: 15 red before the change, 16 cost pins (red
     before the change because 26.10.180 read or graded them better, each a
     known gap below) and 17 pins. Each turns red under a named one-line
     change to the parser.
   - 12 native unit cases and 7 smoke cases, five on the device lane and two
     on the wizard's rendered review card.
   - receipt-text-parser.battery.spec.ts, which records every reading of the
     60-receipt battery (refunds R1 to R32 and purchases P1 to P52, not all
     numbered), ADR 0185's 13 counterexamples (X1 to X13) and this record's
     178 (C1 to C180; the two that repeated battery rows are left out), with
     ADR 0185's score and with silence counted in the stricter sense. It and
     the year-first pin hold the clock at 30 October 2026.

### A shared file lands in the upload area

1. **The share gate says why it refuses.** `shareRefusal(file)` replaces
   `isAcceptedShare` and asks, in order: larger than `IMPORT_FILE_MAX_BYTES`
   (`tooLarge`); a JSON backup by its type or its extension (`backup`);
   neither an accepted type nor an accepted extension (`type`); no bytes
   (`empty`). Size before type is the dropzone's own order, so a file both
   gates refuse gets the dropzone's reason. `consumeAll()` returns
   `{ accepted, refused }`, each refusal with its reason, and still clears
   the source either way. A share past the claim window is in neither list:
   it may be another account's, and its name is not this session's to read.
   The gate stays stricter than the dropzone, which takes a backup and does
   not ask whether a file is empty.
2. **A refused share is told in the dropzone's own alert.** It uses the
   dropzone's sentences (*is larger than the 10 MB limit*, *is not a
   supported file type*) and two new ones, `import.fileEmpty` (*{name} is
   empty*) and `import.shareBackup` (*{name} is a backup: pick it here to
   import it*). A backup has its own sentence because the dropzone shows it
   a JSON chip, so *not a supported file type* would give the wrong reason.
   The lost-share notice (0165) stays apart: a refused file arrived, and a
   lost share never did.
3. **`adopt(files, refused)` on the dropzone, beside `forget()`.** It puts a
   file on the list through the same private `take()` the dropzone's own
   pick runs — the same gate, row, preview and banner — but emits nothing. It
   takes a file already listed, or one repeated in the batch, once; honours
   `multiple=false`; takes nothing once the dropzone is destroyed, since the
   wizard asks after an await; and keeps a refusal the user's own pick put in
   the banner, adding the share's after it. The wizard then writes its
   selection from the dropzone's whole list, so a file picked while the stash
   was read stays.
4. **The wizard listens to its query params.** A stream over
   `queryParamMap`, filtered to `source=share`, strips the flags (saying
   `import.shareLost` once for `error=1`) and drains with `concatMap`, one
   drain at a time: on iOS the plugin reads a share without removing it until
   `completePendingShares`, so two quick activations would otherwise adopt
   one photo twice. A queued drain reads the source the one before it
   emptied, and a drain that finds nothing returns before touching the
   dropzone. A drain that throws is handed to the `ErrorHandler`, so the
   stream stays open for the next share. The sign-in effect's late navigation
   now reaches a listening wizard, which strips the flag it brings back.
5. **A share waits while the wizard is busy or holds a review.** While
   `isImporting()`, `processingBusy()` or `extractedTransactions().length > 0`
   holds, the wizard strips the flag and does not drain: the iOS folder is not
   completed and the web stash is not consumed. A drain would reset the run,
   since a change of selection empties the rows, and break what
   `confirmImport` relies on; adopting the file while keeping the rows would
   consume a share that is then never imported. While the stash is read,
   `shareDraining()` holds **Process with AI** and `processFiles()` as a run
   does: the guard is read before the stash answers, so a run started then
   would read a selection the drain then changes, and the drain would empty
   the rows an earlier batch of the run had appended, on a fresh wizard or
   an open one. The error card's **Try again** waits on it too: pressed then,
   it would clear the error and start nothing, and the card would claim
   nothing was found. A share drained while a run's own card stands (an error,
   photos queued for later, nothing found) sends the stepper back to the
   upload step, where the file or its refusal is; left on that card, an
   error would turn into a false *No transactions found*, and the queued
   card's **Done** would leave the wizard over a share nobody saw.
6. **Rows and previews are keyed by the file, not its name.** The dropzone
   tracks `file` and keys its previews in a `Map<File, string>`; the wizard's
   tiles track the preview's URL. `forget()`'s same-name rule goes, since it
   existed only because previews were keyed by name. A lint selector bans
   `@for (…; track x.name)` in templates, and `lint-guards:check` holds it
   with self-test fixtures; it failed on exactly the two sites when it
   landed.
7. **The fallback with no dropzone stays, labelled as such.** Only the
   blanked template the unit suite renders has no dropzone; there the drain
   hands the accepted files to `onFilesSelected`. Its comment and its pin say
   so.

### The device's amount and date flags name the scan

On the device every amount and date grade is policy: the parser's evidence
tiers, the demotion, the model-read grade and the dispute grade. No model
reported any of them, and on the regex lane no model runs, yet the review
card and the form phrased each as *the AI was only 60% sure*. 0162 left the
percentage off the type's sentence for this reason.

- The converter marks a row the device read, `readOnDevice`, from its
  `source`. The mark travels through a split and a merge, and is never
  written: the mapper and the row builder pick their fields.
- On such a row the amount's flag says *Double-check this amount — the scan
  could not read it for certain* (`import.verifyAmountOnDevice`). The form
  reads the scan's own `source` and says the same of the date
  (`import.verifyDateOnDevice`). On the card a doubted device date keeps the
  assumed-date wording, because the import dates every grade under the bar
  as assumed.
- A cloud reader's flag keeps the percentage its model reported: the receipt
  prompts ask the model for it.
- The card and the form choose between the two sentences in one helper,
  `fieldDoubtSentence` in `import-review.utils.ts` (0171). What each says
  around it stays its own: the card's assumed date before it, the form's
  not-today sentence after it.

## The score

ADR 0185's columns: refunds read credit / twinned at 0.3 / debit 0, and
purchases read debit 0 / twinned / credit; a correction for each wrong type
and each wrong amount; and the rows read silently as 0185 counted them. The
clock is held at 30 October 2026, and the readings are the same in both zones
and under either day order, but for 26.10.180's on the priced lines.

The battery's sixty receipts:

| Parser | Refunds: credit / 0.3 / debit 0 (of 31) | Purchases: debit 0 / 0.3 / credit (of 29) | Corrections | Silent rows |
|---|---|---|---|---|
| 26.10.180, joined | 24 / 7 / 0 | 16 / 1 / 12 | 31 | P8 |
| this record, joined | 24 / 7 / 0 | 16 / 1 / 12 | 31 | none |
| 26.10.180, split | 28 / 3 / 0 | 16 / 1 / 12 | 27 | P8 |
| this record, split | 28 / 3 / 0 | 16 / 1 / 12 | 27 | none |

ADR 0185's thirteen counterexamples, X1 to X13: no reading moves.

This record's counterexamples:

| Rows, parser | Refunds: credit / 0.3 / debit 0 | Purchases: debit 0 / 0.3 / credit | Corrections | Silent rows |
|---|---|---|---|---|
| C1–C173 (171), 26.10.180, joined | 12 / 1 / 10 | 145 / 2 / 1 | 60 | 41 |
| C1–C173, this record, joined | 11 / 6 / 6 | 138 / 9 / 1 | 93 | 25 |
| C1–C173, 26.10.180, split | 16 / 0 / 7 | 138 / 0 / 10 | 101 | 70 |
| C1–C173, this record, split | 15 / 1 / 7 | 138 / 0 / 10 | 105 | 64 |
| C1–C180 (178), this record, joined | 12 / 7 / 7 | 141 / 10 / 1 | 98 | 27 |
| C1–C180, this record, split | 16 / 2 / 8 | 141 / 1 / 10 | 110 | 66 |

Two sets of receipts built for a class:

| Set | 26.10.180 | This record |
|---|---|---|
| Priced lines (18,690) | 2,857 to 2,962 silent, by zone and day order | none silent; 24 read right and flagged now read wrong and flagged |
| Unlabelled bare totals (168) | 8 silent | 112 silent |

The counterexamples are built to break the parser, so they are not a sample
of receipts. Of the joined C1–C173 set's 25 silent rows, 9 were silent on
26.10.180 too; the other 16 are battery rows of the classes in Known gaps.
C174 to C180 are the rows of the three classes found last and of the two
classes widened then; two of them read silently in each layout. The
battery spec asserts the sixty's scores and every list of silent rows; the
counterexamples' other columns come from a run of the same rows. In the
stricter sense the sixty's silent rows fall from 13 to 12 in both layouts
(P8), ADR 0185's thirteen keep theirs (X12 and X13 joined; X6, X7, X12 and
X13 split), and this record's counterexamples hold 34 joined and 84 split,
against 31 and 81 for C1–C173 and 44 and 84 there on 26.10.180.

### The restatement rule, read again

ADR 0185 noted, under What was rejected, that one refund slip,
`REFUND / Item 1 $10.00 / Item 2 $5.00 / ($15.00)` (X2), kept its credit under
its restatement rule, M2, only because the date defect cut `Item 1 $10.00` out
of the amount hunt.

With this record's date rule, M2 (applied on top of this record's parser)
reads X2 as a purchase graded 0.3. X1 and X5 stay at 0.3, as under M2 on
26.10.180.

M2's battery rows are otherwise unchanged:
- joined 22 / 9 / 0 | 16 / 6 / 7 | 28;
- split 26 / 5 / 0 | 16 / 6 / 7 | 24.

The only difference from 0185's M2 row is that P8 is no longer silent.

So with the date read right, M2 loses three refund slips to doubted purchases
on the battery's counterexamples, not two. 0185's decision to reject M2
stands, on firmer ground.

## What was rejected

**Dates.**

- Excluding the currency sign alone: the line-break and cents slips remain.
- Barring a date from starting after a sign and a space, as well as at a
  figure the sign is glued to: the date after a trailing sign is lost
  (`Total 5,00 € 15.01.26`, and `Summe 12,50 €` over `15.01.2026`). The start
  rule bars only a glued sign, and so leaves the spaced and code-led forms of
  the runs in Known gaps open.
- Refusing a two-digit year after '.' or ',': loses `15.01.26`.
- Requiring the mark between the day and the month again before a two-digit
  year, with a space either side and an apostrophe allowed, so that a count
  and a price with no sign between them (`Milk 1 3.25`) are no date, and
  reading the figures a date that rule then turns down leaves on its line as
  money in no tier. Each shape such a date leaves has to be listed, and the
  shapes beside the list go silent: 14,824 of 142,848 receipts whose date's
  first mark is spaced, doubled or an apostrophe; 4,872 of 27,648 such dates
  on their own line, on slips that print no currency mark; 6,076 of 360,000
  receipts over pairs of marks; 21,897 of 51,840 dates a currency code
  touches; and 2,331 of 11,160 dates after a total that ends in a code. Over
  four seeded sets of 40,000 generated receipts it newly reads 114 receipts
  silently, against this record's 36.
- That rule with its list generalised (spaces and up to two marks wherever a
  mark may stand, an apostrophe, a calendar check on the day and month) and
  with only a sign that touches the date alone protecting it. The date classes
  above close, but a one- or two-digit figure before a total with cents (a
  quantity, a count, the minutes of a time) now makes the total part of a date
  it turns down: 60,928 of 88,200 refund slips whose only total follows such a
  figure, and 28,216 of 63,000 whose total follows a time, read 0 or a card
  number at direction 0, and 60,928 of 88,200 such purchases that print a
  coupon are filed as credits.
- Letting a date start inside a figure, as 26.10.180 does: 594 of the 7,680
  receipts whose total's cents a spaced date follows keep 26.10.180's silent
  reading, and with the sign and the line break excluded, 3,724 of 138,240 and
  5,448 of 168,000 receipts whose total line ends in a date after cents, under
  a line 26.10.180 read a date through, lose their cents (this record leaves 0
  and 1,344 of them, Known gaps).
- A guard that a year-last date is the whole run: no date whose last number
  runs on into a mark and another digit (`12/5` after `$27.01 12`). It closes
  most of the runs that only look like a date (1,344 to 288 and 228 to 60
  among the total's own figure, 1,920 to 384 on card lines, 1,264 to 508 on
  quantity lines) and reads `TOTAL $12.50 01/15/2026` and
  `Total $5.15 01/15/26` right. But the date it then reads leaves a smaller
  total under a larger item: 2,586 of 138,240 receipts that 26.10.180 read
  silently and this record reads right or flagged read silently again, and so
  do 16, 7, 8, 10 and 9 receipts of five seeded sets of 40,000; 8,784 more
  model answers are lifted silently in the first set, and 212 among 4,320
  receipts whose date wraps across two lines.
- A guard that three two-digit groups joined by one mark printed twice
  (`23.01.27`) are no money. It closes the year-first date read as money (864
  of 58,464 and 2,700 of 32,256 receipts; 4, 1, 1 and 2 of four seeded sets).
  But where that figure was the only one the receipt marked as money, the
  parser falls under the bar, and a model total that differs is lifted to 0.8:
  4,032 and 5,508 more model answers go silent on those receipts, 41, 73, 14
  and 72 in the seeded sets, 672 among 138,240 receipts with a date after the
  total, and one receipt of a seeded set newly reads silently.
- The year-first pattern repeating its mark: loses `Ref 2025 1.10` and the CJK
  and Hangul dates.
- The date fix without an amount rule: see Context.

**Count rules.**

- Cents or grouping alone as the trigger: misses integer prices.
- A sign or the receipt's code touching the figure as the only trigger, with
  none for cents or grouping: the purchases `Total ¥  480 / VISA -¥480` and
  `TOTAL 14 Card -$14` (X6 and X7, which 0185 pins), joined, become refunds
  graded 0.5, as they already are split.
- Keeping a bare whole number that repeats its line's money as money
  (`TOTAL 14 Card -$14`): no regex-lane reading on any set becomes or stops
  being silent. But a bare total beside its own money then counts as a second
  printing of the figure read, which keeps a cash-tendered pick ahead of the
  count rule: 14 more model answers of a seeded set of 40,000 generated
  receipts and 6 of a second 40,000 are lifted to 0.8 silently, against 11
  right answers it keeps unflagged; `Total 388 Card $388` under
  `Water 500ml $288` reads 388 at 0.8 rather than 0.6 (C154).
- No copy either for a bare whole number beside money, with no exemption for
  one that repeats that money's value: `TOTAL 14 Card -$14` files a purchase
  as a refund.
- A word only past a space: 468 of 924 receipts whose bare total is followed
  by a tax line's label after a space, a comma, a period, a slash, a bar or
  the currency's letters read the smaller figure silently, and 798 of 1,827
  receipts whose bare total is printed after its line's money, or past a run
  of marks or a percent figure.
- A word past at most two marks: 156 of those 1,827 read silently
  (`Total 12 ... Tax $0.96`, `Total 120 8% Tax $9.60`).
- A count standing where a total does only when a word follows it, never after
  its line's money: 306 of the 1,827 read silently (`Tax $1.00 Total 9`), 60
  of 448 receipts that print a coupon or a saving beside a bare total read
  silently, `値引 ▲¥100 合計 980` files a purchase as a refund, and cash and
  change after such a line read the cash (`Tax $0.96 Total 12` over
  `Cash $20.00` and `Change $8.00`).
- Dropping the printed-once guard whenever a count outranks the figure read:
  closes 84 of the 104 receipts of the unlabelled class (Known gaps), but
  flags 2,831 more of 18,690 priced-line receipts read right, and 194 more of
  464 and 151 more of 648 two-item receipts.
- Keeping the printed-once guard only for a count whose own line prints the
  figure read (`Pack of 24 $5.00` over `Total $5.00`): closes 28 of those 104
  (the shape of `Item $11.04 / Subtotal $11.04 / Total 12 $0.96`, not of
  `Total 12 $0.96 / Tax $0.96`), at 151 more flagged right readings among 648
  two-item receipts.
- Copies read off the tier: `Card -$14 / TOTAL 14 Tax $1.04` becomes a refund.
- No rival rule: `Total 12 Tax -$0.96` becomes a refund, and so do 196 of the
  448 coupon receipts.
- A rival that twins the mark only on its own line: 140 of those 448 file the
  purchase as a refund (`Coupon -$3.00` over `Total 12 Tax $0.96`).
- Counts kept out of the tendered pair: `合計 538 お預り ¥1,000 お釣り ¥462` reads
  1000 at 0.8, and 517 of the 40,000 read silently.
- Counts only from the pick's own line: `Total 12 Tax $0.96` over
  `Cash $20.00` and `Change $8.00` reads 20.00 at 0.8; 42 of the 1,827 and 85
  of the 40,000 read silently.
- Any count in the tendered pair: `Item 3 $2.00` over `Total $5.00` reads 3.00
  at 0.6. It closes the 2 receipts of the first seeded set in the class of the
  cash where no pair adds up (Known gaps), and opens 2 others in the second.
- A discount read by arithmetic: where the largest unmarked figure, less a
  figure printed negative, leaves another unmarked figure printed after it,
  read that one, flagged. It closes 2,082 of the 3,123 receipts of the
  discount class (Known gaps) among 5,634, cannot see a saving printed
  unmarked (`You saved $1.00`), and makes 29 of the 40,000 and 41 of the
  second 40,000 newly read silently.
- A sign spaced from two bare figures going to the one before it: 253 of 360
  receipts with a sign spaced from two bare figures, which this record reads
  right, read a figure other than the total, flagged.
- A shared sign always, or by default, going to the next figure:
  `Summe 12 € 3 Artikel` reads 3.
- Half of a time as no copy: 82 of 223 receipts whose time repeats a
  whole-dollar total read silently, 57 of them right on 26.10.180, filing a
  sale as a refund.

**Aside variants**, as for the count: no credit exemption; tender sums over
figures printed on their own; asides out of the copies; ASCII-only
parentheses; no carry across lines; no lone fallback.

**Model lane.**

- Keeping 0147's disagreement rule (a model total that differs from a parser
  reading graded under 0.7 lifts to 0.8). These go silent: 980 model answers
  among 216 bare-total receipts, 438 among 464 two-item, 1,168 among 924
  labelled bare totals, 446 among 648 two-item, 1,980 among 1,827 count-last
  and mark-run receipts, and 11,175 and 27,039 of two seeded sets of 40,000.
- Lifting a disagreement with a cash-tendered pick to 0.8, flagging rule picks
  only: 52 model answers of 48 cash receipts whose priced line holds a size or
  a count, 444 of the first 40,000 and 449 of the second go silent, a model
  reading the cash or the change.
- Flagging that disagreement only where the model's figure is the larger: 26
  of the 48, 334 of the first 40,000 and 361 of the second stay silent,
  against 730 flagged right answers of the first 40,000 where this record
  flags 2,112.
- Flagging every disagreement with a parser that read any total, however weak:
  it closes the class of receipts with a date-and-code line (Known gaps) and
  72,636 to 74,370 answers per such set that 26.10.180 lifts too, but flags
  the right model answer on 2,073 to 2,198 of each 40,000 generated receipts
  in the four sets that print such receipts, 13 and 11 in the two that do not,
  and 1,944 of 32,256 year-first receipts. It amends 0147 beyond these issues.
- Lifting agreement on a count whose line holds one money figure:
  `Total 1280 Tax ¥116`, with the model at 116, becomes 0.8, silent.
- Landing the lane change after the parser change: the commits between would
  carry 0147's rule over the new parser, with the silent answers of the first
  bullet.

**The shared file.**

- **A dropzone that owns the selection.** The wizard would read its files
  from the dropzone alone, which ends the class outright, but 31
  `onFilesSelected` calls and 46 `selectedFiles` reads in the blanked suite
  rest on the wizard's own.
- **A bound `[files]` input.** Three writers would race one binding under
  OnPush, where `adopt()` is one call the host makes and reads back.
- **A snackbar per refusal.** A second voice beside 0165's lost-share notice,
  for files that did arrive.
- **A rendered case that fails on Angular's duplicate-key warning (NG0955)
  as the gate for name-keyed lists.** Its premise, that 0185's case with two
  photos of one name printed that warning, was false: the warning fires only
  on a render that finds both duplicates already listed, and that case's
  sequence never does. A case at each site stops no third site either; the
  class is syntactic, so it is a lint rule (0145).

**Words.** No rule reads a word: not the total's label, not a regular price's
(`Reg`, `定価`), not a count's unit, in any language (0008). The 'smaller
money figure on a Total line' shape #516 offered needs one.

## Consequences

- A priced line whose sign stands before its price reads as money. The
  one-line priced receipts that read no amount on 26.10.180 now read the
  price, and their combined confidence rises (`Item 1 $10.00`: 0.18 to 0.59),
  so they stay on the device rather than falling under USABLE_CONFIDENCE.
- A priced line that prints no sign, or prints it after the price, still reads
  as a date, graded 0.3 or 0.5, as on 26.10.180: alone (`Milk 1 3.25`,
  `Brot 1 2,10 €`) it reads no amount, flagged, and under a total line the
  amount is right. In each of four such layouts 1,765 of 2,232 read so (1,766
  on Tokyo's clock), none silently; 26.10.180 read 386 of each 2,232 `Brot`
  lines silently (365 to 385 under the other zone and day orders), and they
  now read right or flagged.
- A demoted reading in the strongest tier lowers the parser's combined
  confidence by 0.12, a quarter of the amount's 0.48 share.
  - On the regex lane the row's confidence is Vision's times the parser's. An
    undated receipt read under a count (`Room 412 $89.00`: 0.59 to 0.47) falls
    under USABLE_CONFIDENCE 0.4 once Vision reports under about 0.85, and
    AIStrategyService then tries a cloud engine where one is configured,
    keeping the device's reading when the cloud's is no better. A dated one
    (0.81 to 0.69) stays.
  - On the model lane the row's confidence is Vision's own, so its routing is
    unchanged.
- The review card flags more regex-lane amounts.
  - Of receipts 26.10.180 read right with no flag, these now read a wrong
    figure, flagged: 196 of 216 bare totals beside an 8% tax or tip, 738 of
    924 labelled bare totals, 1,470 of 1,827 count-last and mark-run receipts,
    and 336 of 448 coupon receipts.
  - These still read right, flagged: 31 of 464 and 25 of 648 two-item
    receipts.
- A date is lost, date 0 and flagged, where 26.10.180 read it: a date OCR
  wrapped across two lines (`15/01/` over `2026`), and one printed after a
  total on its line whose figure, its sign spaced from it, starts a run that
  cannot be a date (`TOTAL $ 12.50 01/15/2026`, which reads 12.50 under the
  count, flagged, where 26.10.180 read 2026 silently). With the sign glued,
  `TOTAL $12.50 01/15/2026` reads 12.50 dated 15 January 2026.
- The model lane flags more right answers:
  - 2,112 of the right model answers to a seeded set of 40,000 generated
    receipts, 1,762 of them because a disagreement with a cash-tendered pick
    is flagged where the parser's pick is the change;
  - 850 of a second 40,000's;
  - 1,543 to 1,564 of the 18,690 priced-line receipts', by zone and day
    order;
  - 792 of the 924's, 216 of the 216's, 1,725 of the 1,827's and 448 of the
    448's;
  - 3,336 of the 5,634 discount receipts'.
  That is the price of never lifting a model's misreading of a count, the cash
  or the change.
- It also lifts more wrong ones, in the classes Known gaps lists with their
  counts.
- ParsedReceiptText gains an optional field, and DEMOTION_FACTOR is exported;
  native-receipt.service.ts is their only consumer. The key is spread only
  when set, so existing assertions on undemoted readings are unaffected.
- receipt-text-parser.battery.spec.ts holds every reading of the battery, ADR
  0185's thirteen and this record's 178, joined and split, and the silent rows
  in both senses, with the clock held at 30 October 2026. A change that moves
  a reading edits its row, and the record that makes the change states the
  new score. It runs in test:ci and is left out of test:dates
  ([../dates.md](../dates.md)): its readings are the same in both zones and
  under either day order.
- A shared file shows on the upload area with its row and preview, a later
  pick or remove keeps it, and **Process with AI** is enabled beside a list
  that says why. A share the gate refuses is named in the alert, and leaves
  **Process with AI** disabled when nothing else is picked.
- `consumeAll()` returns `ConsumedShares`, and `isAcceptedShare` is gone;
  the wizard is the only caller.
- 0165's returned share flag is stripped again by the listening wizard. Only
  the dropped `error=1` it records beside it stays open.
- **Where it ships.** The parser and the device lane reach iPhones only with
  a native build: the web build never runs the parser. The share fixes and
  the browser run's fixes ship with the web deploy, and reach the iOS app's
  web layer with its next build. No Swift changed.
- **Ten catalog keys** in en, ja and tc: `import.fileEmpty`,
  `import.shareBackup`, `import.removeFileLabel`, `import.moveFileUpLabel`,
  `import.moveFileDownLabel`, `import.verifyAmountOnDevice`,
  `import.verifyDateOnDevice`, `import.selectRowLabel`,
  `common.fileSizeBytes` and `common.sentenceSeparator`.
- **English reads differently in places.** A file's size reads *281 B* and
  *1.5 kB*, where it read *281 Bytes* and *KB*; the upload area's buttons name
  their file (*Remove file 1 (statement.csv)*) even on a list of one; a device
  row's doubted amount names the scan.
- **The gates grow**: the track-by-name lint selector, with its row and
  self-test fixtures in `lint-guards:check`; three `icon-labels:check` rules
  with their frozen lists; and the battery spec.
- **The initial bundle grows.** The parser, the device lane, the share gate
  and the locale formatter are in it. Its figures, and the warning budget
  they are held to, live in [../performance.md](../performance.md).

## What the browser runs found

### Run 1, on 30 October 2026

The first run drove the branch, with every parser and share change in and
none of the fixes below, against the emulators on port 4300, at 1024×768 and
375px, in en, ja and tc, light and dark. No vendor was contacted and no key
typed or stored.

- **The regressions held**: journey 79 steps 1 to 5, 83 step 4 and its
  reused wizard given `?source=share&error=1` (one lost-share notice, one
  drain, the same wizard), 87 steps 4 and 5, 88 step 6 and 105 step 3.
- **Journey 109 held** ([../e2e.md](../e2e.md)). A shared photo showed its
  row and thumbnail with **Process with AI** enabled and no alert; a CSV
  picked after it kept both; removing the CSV left the photo; a second share
  made with the wizard open joined the list in the same wizard (the share's
  arrival was triggered from the console, so that step is diagnostic-grade);
  four refused shares were named in one alert, with no row and no snackbar;
  and two photos named `image.jpg` showed two thumbnails, removing the second
  keeping the first's.
- **Journey 110 held**, diagnostic-grade: the two Capacitor bridges were
  stood in for in the page. `Total: $120.50` over `(Reg $150.00)` read 120.50
  with the amount graded 0.6 and flagged on the card; `Rope 1 $10.00` over
  its total and the day's date read 10.00 at 0.8 and the date at 0.9,
  unflagged; a model agreeing on 120.50 kept 0.6, flagged. The priced-line
  step, as run with the day's date printed year first, did not tell the old
  parser from the new: 26.10.180 reads that text the same way, since its
  date reader tries a year-first date before it reaches the priced line.
  [../e2e.md](../e2e.md) now prints that step's date year last, which only
  this parser reads; run 3 drove it.
- **The sweep**, at 1280 and 375px in three languages and both schemes, over
  the upload step with two shared photos and four refusals and over the
  review card, found nothing scrolling sideways, clipped, wrapped or off
  screen.

It met nine defects, all older than this wave, and the specs written for two
of them met two more. Each is fixed here with a spec red before the fix. The
re-check, on 31 October 2026, drove each fix in the same venue after a fresh
pre-flight.

- **The upload area's row buttons named no file.** Every row's buttons read
  *Remove*, *Move up* and *Move down*, so two rows, and two photos both
  called `image.jpg`, could not be told apart by ear. Each button now names
  its file by its place, the number the photo badge shows, and its name:
  *Remove file 2 (image.jpg)*, *Move file 2 (image.jpg) up*. Two dropzone
  cases were red before the fix. Re-check: *Move file 1 (image.jpg) up*
  through *Remove file 2 (image.jpg)*, and in ja and tc
  `1番目のファイル（image.jpg）を上へ移動` and `移除第 2 個檔案（image.jpg）`.
- **A file's size read in English in Japanese and Chinese.** The upload area
  wrote *281 Bytes* and *KB* in every language, outside the locale formatter.
  `LocaleFormatService.formatFileSize` now writes it: Intl's short units from
  a kilobyte up, in steps of 1024 taken on the figure as written, to one
  place; and below that the catalog's word for a byte, which CLDR writes in
  English for traditional Chinese. A rendered case read *281 Bytes* where
  *281 バイト* was due. Re-check: `281 B`, `1.5 kB`, `1.5 MB`; ja `281 バイト`,
  `1.5 KB`; tc `281 位元組`, `1.5 kB`.
- **Import History's size chip had its own copy of that formatter**, writing
  *KB* and *B* in every language. It folds onto the one formatter; its
  rendering case read *2 KB* where the formatter's answer was due. Re-check,
  of the formatter alone, since fresh emulators hold no import record:
  `2 kB` and `500 B`, in Japanese `2 KB` and `500 バイト`. The rendered chip
  waits for a later run.
- **The refusal alert kept the language it was raised in.** It stored its
  sentences when it refused, so after a switch to Japanese the page read
  Japanese and the alert English. The dropzone now keeps the names it
  refused and the reasons, and writes the sentences as the banner renders: a
  switch rewrites the alert in place and brings nothing into view, and a
  fresh pick that refuses the same file again brings it into view again.
  Re-check: the alert read
  *big-statement.csv is larger than the 10 MB limit. notes.txt is not a
  supported file type*, then the same in Japanese and Chinese after each
  switch, scrolled into view once; `notes.txt` refused alone twice scrolled
  it twice more.
- **The alert joined its sentences with a Latin stop.** In ja and tc it read
  `. ` between sentences that end in 。. It now joins them with
  `common.sentenceSeparator`: a stop and a space in en, 。 alone in ja and
  tc; and a catalog pin holds that none of the four sentences ends in a stop
  of its own. Re-check: journey 109's four refusals read as in run 1 in
  English, and with no `. ` in ja and tc.
- **A two-photo row at phone width left the name a column of 51px.** At
  375px the row's fixed parts — preview, arrows, remove, handle and their
  gaps — took 182 of its 233px, the name broke over four lines, and the size
  and type ran under the arrows. A container query on the list now puts a
  photo row's arrows and handle under the name when the list is under 400px
  wide. A case at the zone's 303px width read a 35px column and five lines
  before the fix, and 113px and at most two after. Re-check at 375px: both
  rows with their arrows under the name, a 129px name column, the page 375px
  wide, the same in Japanese; at 1280 both rows on one line. That layout put
  the remove button on the name's line and the arrows under it, though Tab
  reaches the arrows first. The second line now holds the arrows and remove,
  in that order, and the handle, which takes no focus, stands beside the
  name; the name's column is the same width, the third column being as wide
  as the remove button either way.
- **A device row's flags quoted a percentage nothing measured.** A doubted
  amount on a row the device read said *the AI was only 60% sure it read it
  correctly*. The decision above names the scan instead. Four unit cases and
  two smoke cases were red before it. Re-check, journey 110's first receipt:
  read 120.50, amount 0.6 and date 0.9, marked as read on the device; the
  card's amount flag *Double-check this amount — the scan could not read it
  for certain*, no date flag, and the sentence in ja and tc.
- **The receipt-or-statement chips had no name.** Their listbox's
  `aria-labelledby` named `image-kind-label`, which the question above it
  carried as a class, not an id. The question now carries the id. An axe
  pass over the upload step with two photos and a refused file, in both
  schemes, was red before. Re-check: the listbox named *What are these
  images?*, and in ja and tc; axe over the step found no violation in light,
  dark, Japanese, Chinese or at 375px, leaving for review only contrast over
  overlapping backgrounds: the two chips, and the photo tiles' white names on
  their dark band, 5.74:1 at worst over white.
- **The wizard's step headers lost their names below 600px.** The phone rule
  took the step labels out with `display: none`, which left four tabs with no
  name. They are clipped in place instead: `position: absolute`, a 1px box,
  `clip-path: inset(50%)`. The rule's declarations, read from the stylesheet
  by a shared `styleRules()` helper and laid on the rendered labels, are
  measured and swept with axe, since Karma's window never reaches the
  query. Re-check at 375px: each header a tab named *Upload*, *Processing*,
  *Review* and *Import*, 48px wide with the label clipped or gone; the same
  in Japanese; axe over the tabs found nothing; at 1280 the labels show.
- **A review row's checkbox had no name.** Each is now named for its row,
  *Select {description}*, and a blank row's *Select an untitled row*; *Select
  all* keeps its text as its name. A naming case and an axe pass over the
  review card, every kind of row shown, were red before. Re-check:
  *Select e2e-516 Harbour Supplies* and, on a row added by a real click,
  *Select an untitled row*, in ja and tc too; axe over the card found
  nothing, light and dark.
- **The upload area's resting icons were faded under contrast.** The upload
  step's new axe pass met the move arrows at 3.18:1, the drag handle at 2.34
  light and 2.81 dark, which also fails a graphic's 3:1, and the remove
  button at 3.18. They now rest in `--text-muted` at full strength, 7.56:1
  light and 7.07:1 dark; the arrows and the handle hover in
  `--text-primary`, remove in `--color-error`; a disabled arrow stays faded,
  as it may. Re-check: those colours at rest, and hovered with a real
  pointer.
- **The category chip's caret was faded under contrast.** The review card's
  new axe pass met it at 3.2:1 in light on every card. It rests in the chip's
  label colour now. Re-check: 5.94:1 light, 8.34:1 dark.
- **Three classes became `icon-labels:check` rules.** The sixth: a control
  stamped once per item in its own template takes a name with a slot for the
  item, not one bare key; what it found and this wave did not fix is frozen
  by file, key and count, 27 rows over 28 controls. The seventh: a literal
  `aria-labelledby`, `aria-describedby`, `aria-controls`, `aria-owns` or
  `for` names an id its own template declares; it read 25 references and
  froze nothing. The eighth: a Material checkbox, slide toggle or radio
  button names the control it renders inside, and a slider named on its
  host names its thumbs; two rows are frozen.

The re-check took no screenshots and met no new defect. One reading departed
from the case's: at 375px `e2e-109-shared.png` took one line, not two. The
browser drew it in PT Sans, 120px in its 129px column, where the spec's
pinned Verdana breaks it; the column's width, which the case holds, does not
depend on the font.

### Run 2, on 31 October 2026

The second run drove the final tree, every fix above in, after a fresh
pre-flight in the same venue: at the pane's 1024px, and by emulation at 1280
and 375px, in en, ja and tc, light and dark, with journeys 109 and 110 as
[../e2e.md](../e2e.md) wrote them then, journey 110's priced-line step with
the day's date printed year first (run 1). No vendor was contacted and no
key typed or stored.

- **The regressions held**: journey 79 steps 1 to 5 (at 375px the card
  273px wide and its content 189, the dropzone's focus ring 4 with room of
  8, 5, 149 and 5), 83 step 4 and its reused wizard, 87 steps 4 and 5 (the
  mid-run photo's row removed by its new name, *Remove file 1
  (e2e-87-midrun.png)*), 88 step 6 and 105 step 3.
- **Import History's size chip, rendered.** Journey 87's failed record reads
  *112 B*, *112 バイト* and *112 位元組*, which the re-check read only
  through the formatter.
- **Journey 109 held, all seven steps as written**, those no run had read in
  that form included: the selection checks after the remove and with two
  photos of one name, the alert in ja and tc with no `. `, the buttons'
  names in ja and tc, and the phone-width row, both rows a grid with a 129px
  name column and nothing clipped at 375px, both on one line at 1280. The
  banner read from 679 to 768 in a 768px window again.
- **Journey 110 held**, diagnostic-grade, every reading as run 1's, with the
  row marked as read on the device on all three texts, the priced line's
  card reading *-$10.00* unflagged, and the flag sentence and the checkbox's
  name in ja and tc.
- **The sweep**, re-measured over the upload step with two shared photos and
  four refusals and over the review card, found nothing scrolling sideways,
  clipped, wrapped or off screen, and axe no violation. It left for review
  only contrast over the two receipt-or-statement chips' overlapping
  backgrounds and, at 375px, the hint under them, which axe found partly
  covered where the page stood.

It met no defect. Two of its own readings were corrected before they were
recorded. A wrap check that measured a button's height counted its padding
as a line on every review-card button; counting the text's line boxes showed
none wrapped, in any language. And two screenshots showed part of the page
still dark after a switch to light, where the computed colours were light and
a repaint drew them so.

### Run 3, on 31 October 2026

The third run drove what the whole-branch review changed after run 2, on the
final tree, after a fresh pre-flight in the same venue, at the pane's 1024px
and by emulation at 375 and 1280px. No vendor was contacted and no key typed
or stored.

- **Journey 110 held, all three steps**, diagnostic-grade. The priced line
  over its total, its date now printed year last (01/15/2026), read 10.00 at
  0.8 and the date at 0.9; the card showed *-$10.00* with no amount flag, and
  the date chip flagged for the day rather than the reading, named *This
  receipt is dated Jan 15, 2026, not today …* then *Change date (currently
  Jan 15, 2026) …*. The aside and model-lane steps read as before.
- **Journey 109's step 7 held as written**: at 375px both rows a grid with a
  129px name column and nothing clipped, the arrows and the remove button on
  the line under the name, centred level, in the order Tab reaches them, the
  drag handle beside the name; at 1280px both on one line.
- **A share made over a run's own card.** A header-only CSV processed to *No
  Transactions Found*; a share raised from the console then, as iOS raises
  one, sent the stepper back to the upload step with the CSV and the shared
  photo listed and selected, Process enabled, no snackbar and the stash
  empty. Focus moved to the Upload step's header, as Material's stepper moves
  it when the selection changes under it.
- **The sweep** of the upload step with two shared photos at 375px found
  nothing scrolling sideways, clipped or off screen, and axe no violation and
  nothing left for review, its clip check first proved on a planted fault.

It met no defect.

## Departures from the issues

- #515 proposed one of two date fixes. This record keeps the currency-sign
  exclusion, adds the line-break exclusion and the rule that a date never
  starts inside a figure, and rejects refusing a year after '.' or ','.
- #515 asked that a priced line read as money. One whose sign stands before
  its price does; one that prints no sign, or prints it after the price, still
  reads as a date, graded under the bar, as on 26.10.180 (Known gaps).
- #515 asked for a date fix only. This record adds the count rule, the time
  rule, the shared-sign rule, the tendered-pair change, the rival twin and the
  'count' grade, because the date fix alone turns flagged wrong dates into
  silent wrong amounts.
- #516 offered either 'read 12.50' or 'flag 15.00'. This record reads 12.50 at
  0.6, and rejects the 'smaller money figure on a Total line' shape, which
  needs a word table.
- The model-lane amendment of 0147, the 0013 amendment, the committed battery
  spec, the native and wizard smoke cases and the docs/dates.md note go beyond
  #515 and #516.
- #515's acceptance criterion 'npm run test:dates' covers
  receipt-text-parser.spec.ts and native-receipt.service.spec.ts, both in its
  list. The battery spec is deliberately left out of it.
- #518 asked that a share the dropzone would refuse be refused with the same
  notice. Two of the share gate's refusals have no sentence in the dropzone,
  an empty file and a backup, so each has its own; a backup's sends the
  reader to pick it in the upload area.
- #518 named the upload area alone. The three neighbours found beside it —
  the silent gate, the wizard reused without a drain, and two files of one
  name — are fixed here too, and a share made while a run or a review holds
  the wizard waits rather than resetting it.
- Eleven defects older than these issues, met by the browser run and by the
  specs written for its fixes, are fixed here, with Import History's copy of
  the size formatter folded: the standing rule is that a UI defect met while
  testing is fixed in the wave that met it. With them come the amendment of
  0162 and three `icon-labels:check` rules, beyond all three issues.

## Things that only became apparent while building

- **A committed reading depended on the day it ran.** Read day first,
  `23.01.27` is 23 January 2027, which the future-date guard turns down only
  while it is more than a day ahead. From 22 January 2027 the year-first pin
  and two battery rows would have gone red with no change to the code. Both
  hold the clock at 30 October 2026, and moving the hold to 1 June 2027
  turns them red. The same guard moves the counts here from day to day.
- **The day-first date after a whole-number price is lost to a run the
  reader turned down, not to the rule that a date never starts inside a
  figure.** The reader resumes its search after a run it turns down, and in
  `Milch 2 € 13 24.07.24` the run `13 24.07`, whose month is past 12, took the
  real date's day and month. Removing that rule leaves the class's pin green;
  the rule decides two other battery rows, C173 and C179.
- **The cash-tendered sum's pick can carry another rule's label.** The sum
  pairs over asides, so on `Cash $50.00 / (Total $43.10) / Change $6.90` it
  picks the aside as the total: 43.10 at 0.6 'tender'. With a plain figure in
  a weaker tier (`Store 72`) the same reading is labelled 'aside', at the same
  0.6, and a model that agrees keeps 0.6 instead of lifting it to 0.8. A
  larger count beside money does the same: over those cash and change lines,
  `Item 72 $43.10` reads 43.10 at 0.6 'count', where `Item 1 $43.10` reads it
  'tender'.
- **A drain that throws would have ended the stream.** An error passed down
  an RxJS stream completes it, so no later share would drain. The drain's own
  `.catch` hands the error to the `ErrorHandler` instead, and the next share
  drains.
- **`track file` assumes a file is listed once.** `adopt()` takes a file
  already listed, or repeated in its batch, once, and a real pick or drop
  makes fresh `File` objects, so no door the app has lists one twice; a
  caller that handed the dropzone the same `File` twice would give the list
  two rows of one key. `take()` releases a file's old preview before it
  makes its new one, so no blob is left behind either way.
- **Material's toggles clear `attr.aria-label` on their host.** The
  checkbox, slide toggle and radio button bind the host's `aria-label` and
  `aria-labelledby` attributes to null, so `[attr.aria-label]` names
  nothing; only the `[aria-label]` input reaches the control inside. The
  eighth rule counts the input alone.
- **Axe scores an icon's ligature as text in the unit suite.** Karma serves
  no icon font, so axe reads each glyph as 16 to 18px text and holds it to
  4.5:1. The suite already held resting glyphs to that bar, and the upload
  area's icons and the chip's caret are held to it here.
- **Karma's reporter rewrites the word *absolute* in failure messages.**
  `position: absolute;` prints as `position: ;`, and a computed `absolute`
  prints empty, which cost several runs of the step-label case to see
  through.

## Known gaps

### The parser

Silent here means silent in the stricter sense: an amount read wrong at 0.7 or
more, a refund read as a purchase graded 0, or a purchase read as a credit
graded 0.5 or more; on the model lane, a wrong amount graded 0.7 or more,
counted once for each figure a receipt prints. Nothing below is called flagged
that is silent in that sense. The counts come from constructed receipts and
from six seeded sets of 40,000 generated receipts (the first two with
discounts, times, card digits and dates in mixed formats; the other four
adding receipts that print no currency sign, codes beside the date, spaced and
mixed date marks, gift cards, deposits, points, tips and cash), read at UTC−5
and UTC+9, with the day first and with the month first. Every count is as
read on 30 October 2026; every silent-class count is the same in all four,
unless a second figure is given, and the future-date guard makes those
spreads. How often real receipts show each class is unmeasured.

**Silent, and new with this record receipt by receipt; pinned and counted.**
Each mechanism is older: 26.10.180 reads the same way wherever its date
reader, or a count it read as money, did not take a figure first.

From the count and aside rules:

- **A total printed bare beside a smaller figure with nothing, or only marks
  or a percent figure, between them** (`Total 12 $0.96`, `Total 12 = $0.96`,
  `Total 12 8% $0.96`), where the smaller figure or the one read is printed
  again (`Tax $0.96` below it; `Item $11.04` and `Subtotal $11.04` above it),
  or the cash and the change follow.
  - It reads the smaller figure, the subtotal or the cash at 0.8.
  - Typography cannot tell it from `Pack 12 $0.96` over `Total $0.96`, which
    the printed-once guard exists to keep. With a word between the figures, or
    with the total printed after the money, it is flagged.
  - Of 168 such receipts with nothing between the figures (four currencies,
    seven totals, six layouts), 104 newly read silently (112 in all);
    26.10.180 read 94 of the 104 right. 78 model answers that agree with the
    reading are lifted. With only marks or a percent figure between them, 86
    of 90, and 77 agreements.
  - Pin: 'reads a total printed bare beside a smaller figure with no word
    between them as that figure or the cash, unflagged where the smaller or the
    read one is printed again or the cash and change follow, the known gap'.
    Battery rows C120, C121 and C178.
- **The cash, where no pair of figures beside a currency mark adds up to it**,
  because the total or the change prints no currency mark
  (`Latte 2 $8 / Total 9 / Tax $1 / Cash $10 / Change $1`; `받은돈 ₩100` over a
  bare `거스름돈 12`).
  - It reads the cash at 0.8. 26.10.180 reads it the same way unless a count,
    half of a time or part of a date made up a pair by chance (8 + 2 over
    $10), which it read flagged.
  - 2, 3, 3, 4, 3 and 3 of the six seeded sets.
  - Pin: 'reads the cash where no pair of figures beside a currency mark adds
    up to it, the known gap'. Battery rows C137, C141 and C142, the last read
    silently on 26.10.180 too, as half of a time, and C139, silent on
    26.10.180 too.
- **A refund slip whose total is printed inside labelled parentheses beside
  smaller figures** reads the largest other figure as a purchase graded 0
  (C30). One receipt of the second seeded set is new, where 26.10.180 twinned
  the total's mark and flagged it. Pin: 'reads past a price with tax, or a
  total, printed as an aside: flagged on a purchase, and on a refund slip read
  as a purchase, the known gap'.

From the date rule, where 26.10.180's date through a sign or across a line
break had read the receipt right:

- **Any figure printed negative (a discount, coupon, gift card, deposit or
  points) that takes the total under a priced item**
  (`Item 1 $3.00 / Coupon -$1.00 / Total $2.00`), and a saving printed
  unmarked as well.
  - Largest-wins (0013) reads the item at 0.8. 26.10.180 reads the receipt the
    same way wherever the item's line prints no count; where it prints one,
    the count and the price read as a date and the total was what was left.
  - 3,123 of 5,634 such receipts; 5 of the second seeded set and 1 of the
    fourth.
  - Pin: 'reads the item any figure printed negative (a discount, coupon, gift
    card, deposit or points) takes the total under, the known gap'. Battery
    rows C151 to C153 and C155.
- **A total line led by its date that prints no currency mark, under a signed
  line** (`Bagel $4.50 x2` over `1/13/24 Total 45.00`).
  - It reads the signed figure at 0.8. 26.10.180 read a date across the line
    break (the `2` of `x2` and the `1/13` below it), which joined the total to
    the signed line.
  - 7,712 of 61,440 receipts whose line above the total ends in a short
    figure; 1, 5, 5 and 8 of the second, fourth, fifth and sixth seeded sets.
  - Pin: 'reads a signed figure over a total line led by its date that prints
    no currency mark, the known gap'. Battery rows C156 and C157.
- **A total line that prints no currency mark beside signed lines**, where
  26.10.180 had read the signed figure's count and price as a date
  (`Brot 1 €2,10` over `Kaffee 2 x 5,10 10,20` and `Summe 10,20`).
  - It reads the signed figure at 0.8, as 26.10.180 does wherever its date
    reader did not take that figure first (C92, C138).
  - 508 of 3,048 receipts with a quantity line; 1, 2 and 2 of the third,
    fourth and fifth seeded sets.
  - Pin: 'reads a signed figure over a total that prints no currency mark, the
    known gap'. Battery row C158.
- **A date OCR wrapped across two lines** (`13.01.` over `24`).
  - The date is lost, and what it leaves is read as money: the day and month,
    written like money, or a year left on a line with a currency code. On a
    slip that prints no currency mark the refund reads as a purchase at
    direction 0; after a total that prints a code the day and month are read
    at 0.8; and `13.01.` over `2024 14:32 EUR`, above lines that print a
    dollar sign, reads 2024 at 0.8.
  - 208 of 4,320 receipts with a date wrapped in ten ways.
  - Pin: 'reads no date OCR wrapped across two lines, and reads a part it
    leaves as money, the known gap'. Battery rows C149 (split), C159, C160
    and C180.
- **A two-digit-year date printed year first** (`23.01.27`) that, read day
  first, falls in the future. The reader turns it down, and the three groups
  read as one figure written like money (2301.27). 26.10.180 read a date
  across the line break above it (`7` over `23.01`).
  - 864 of 58,464 and 2,700 of 32,256 receipts with such a date under a header
    that ends in a figure, the second set including slips that print no
    currency mark; 4, 1, 1 and 2 of the third to sixth seeded sets. These
    counts move as the dates in them stop being in the future.
  - Pin: 'reads a two-digit-year date printed year first as one figure of
    money, the known gap', with the clock held at 30 October 2026. Battery
    rows C161 and C162.
- **A run that only looks like a date, where a price's own figure starts it**,
  its sign spaced from it, a code before it, or no sign at all. 26.10.180
  stopped at a date it read through a sign above these lines (the `1 $10.00`
  of `Item 1 $10.00`). This reader goes on, takes part of a price into a
  date, and reads another figure at 0.8. A sign glued to the price bars the
  run from starting there (Decision 1), so `Total $27.01 12/5/24` reads 27.01
  and `Card ****1234 $3 1/13/24` reads 3; the counts below were taken before
  that bar and count those glued forms in:
  - the total's whole part, its cents and the date's first number
    (`Total $ 27.01 12/5/24` and `Total USD 27.01 12/5/24` are dated 27
    January 2012 and read 24; `Total $ 5.15 01/15/26` reads 26): 1,344 of
    168,000 receipts whose total line ends in a date after cents, 228 of 6,912
    with payment lines or a date printed above (with cash and change below,
    the cash is read), and 1 of the fifth seeded set;
  - a card line's whole-number amount and the date after it
    (`Card ****1234 $ 3 1/13/24` reads 1234): 1,920 of 12,288 receipts, and 2
    of the fourth seeded set;
  - a unit price's cents and the line total's whole part (`2 x 5,10 10,20 €`
    reads 20): 756 of 3,048 receipts with a quantity line, and 1 of the second
    seeded set;
  - a count printed before the total, and the total (`Summe (2) 12,10 €` is
    read as a date in 2010, and the item above it is read): 696 of 6,000
    receipts.
  - Pin: 'reads a run that only looks like a date where a price's own figure
    starts it, and loses that price, the known gap'. Battery rows C166 to
    C168; C163 to C165, their signs glued, read right (C164 flagged, as the
    cash-tendered sum's pick). Pin for the glued forms: 'reads a price its
    sign is glued to as money, and the date printed after it as that date'.
- **The same run, where a payment line repeats the total, turns the
  direction instead**, with the amount right. With the total's own figure in
  the run, its sign spaced from it, the payment line's copy alone decides the
  direction: a refund whose card or cash line prints the total unmarked is
  filed as a purchase graded 0
  (`REFUND / Item 1 -$10.00 / Total -$ 27.01 01/13/25 / VISA $27.01`), and a
  sale whose card line prints the total negative with a code as a credit
  graded 0.5 (`… / Total $ 27.01 01/13/25 / Card -27.01 USD`). 26.10.180
  twinned both at 0.3, flagged, and with the sign glued this record does too.
  - 1,694 of 25,920 receipts with a payment line under such a total, counted
    before the bar on a glued sign.
  - Pin: 'reads the direction off a payment line where a run that only looks
    like a date took the total's own figure, the known gap'. Battery rows
    C176 and C177, their signs glued, twin at 0.3. Pin for the glued forms:
    'twins the direction off a payment line where the total's sign is glued to
    it, as 26.10.180 does'.
- **A day-first date printed right after a whole-number price whose sign
  stands apart from it** (`Laden / Milch 2 € 13 24.07.24 / Summe €26,00`).
  - The reader turns down the run of the price and the date's day and month
    (`13 24.07`, whose month is past 12) and resumes after it, so the date is
    never read, and its three groups read as one figure of money at 0.8:
    2407.24. On a refund slip the refund is filed as a purchase graded 0.
    26.10.180 read a date through the sign (`2 € 13 24`), which split the
    figure, and read the total. With the sign glued, the price's figure
    starts no run and the date reads (`Milch 2 €13 24.07.24` reads 26.00,
    dated 24 July 2024).
  - 16,800 of 259,200 receipts built for it (16,980 on Tokyo's clock), and
    1 of a seventh seeded set of 40,000. 17,640 model answers (17,820 on
    Tokyo's clock) that agree with the reading are lifted. These were counted
    before the bar on a glued sign.
  - Restarting the search just after a turned-down run's first number would
    read the date; that is unmeasured against the other classes.
  - Pin: 'reads a day-first date printed right after a whole-number price as
    one figure of money, the known gap'. Battery rows C174 and C175, their
    signs glued, read right. Pin for the glued forms: 'reads a day-first date
    printed right after a whole-number price its sign is glued to'.
- **A date glued to a figure by a mark** (`Bon 4711.13/01/25`,
  `Bon 4711,13.01.2025`) is not read: a date whose year comes last never
  starts inside a figure. 720 of 4,800 such dates are lost. On a refund slip
  that prints no currency sign the figure then wins the amount, and the
  refund is filed as a purchase graded 0
  (`Storno / Bon 4711.13/01/25 / Brot -2,50 / Summe -12,50` reads 4711.13 at
  0.5): 50 of the 4,800. Pin: 'reads no date glued to a figure by a mark, the
  known gap'. Battery row C179. A date printed year first keeps 26.10.180's
  start, so one glued so is read (`Bon 4711.2025-01-13`).
- **A date glued after a currency sign** (`Shop / €15.01.26 / Summe €5,00`)
  is not read: a date whose year comes last never starts at a figure a sign
  is glued to (Decision 1). Day first with dots, its groups read as one
  figure of money at 0.8 (1501.26); with slashes, as counts beside the money,
  under the bar (`Date:$01/15/2026 Total $5.00` reads 5.00 at 0.6 'count').
  26.10.180 read both dates, and the total. 378 of 1,080 such receipts read
  silently and 378 flagged. Pin: 'reads no date glued after a currency sign,
  and reads a day-first one as one figure of money, the known gap'.
- **A bare figure on a line whose only money is a labelled aside**
  (`(IVA 5% €9,24) Points 1847` under `Summe 184,73 EUR`) reads as the total:
  an aside prices nothing, so the whole number beside it is the line's money.
  26.10.180 read the tax rate and the aside's figure as a date through the
  euro sign. 1 of the fifth seeded set. Pin: 'reads a bare figure on a line
  whose only money is a labelled aside as money, the known gap'. Battery row
  C169.

On the model lane:

- **A receipt that prints no currency sign, only a code beside its date or its
  time** (`13 .01/ 25 JPY`, `15.01.2026 14:32 EUR`).
  - 26.10.180's parser read a figure of the date or the time there at 0.8, so
    it disputed every model total at 0.5. This record's parser reads the
    receipt's own figures under the bar, and 0147's rule for a parser that
    does not trust its own reading grades the model's total on its own: one
    that differs from the parser's is lifted to 0.8, right or wrong, and so is
    one that agrees with the parser's weak pick.
  - Disagreements: 3,283, 3,115, 3,116 and 3,161 answers of the third to sixth
    seeded sets (the first two print no such receipt), and 21,882 and 8,226
    among the year-first receipts above. Agreements with a weak pick: 88, 75,
    76 and 73, and 22.
  - The time's part arrives with the count and time rules, the date's with the
    date rule.
  - Pin: 'lifts a model total that differs from a text parser reading under
    the bar on a receipt that prints no currency sign, the known gap'. Battery
    rows C170 and C171.
- **A model that reads the same wrong figure as the parser** is lifted to 0.8
  where the parser read it at 0.8, or where the cash-tendered sum picked it
  (Decision 5).
  - 26.10.180 lifts the same agreements. The answers new with this record are
    those where 26.10.180's parser read another wrong figure (a count, half of
    a time or part of a date) and disputed the model by accident.
  - On receipts both parsers read silently: 19, 66, 187, 166, 179 and 173
    answers of the six seeded sets; 8,184 among 138,240 receipts with a date
    after the total, 172 among the 168,000, 24,112 among the 61,440 date-led
    totals, 798 among the wrapped dates, 1,858 and 3,432 among the year-first
    receipts, 1,886 among the 6,000 counts before a total, and 255 among the
    discount receipts. With a cash-tendered pick: 3, 11, 21, 18, 16 and 14 of
    the six seeded sets.
  - Each silent class above adds the agreements with its own reading, at most
    one per receipt.
  - Pins: 'lifts a model total that agrees with a figure the text parser reads
    wrongly at 0.8, the known gap' and 'lifts a model total that agrees with a
    cash-tendered pick, the known gap'. Battery rows C138 to C140 and C142.

**Flagged costs.** Each was right on 26.10.180, or flagged right, unless its
line says it was silent there, and is now flagged wrong or flagged right;
each is pinned.

- A total printed bare beside a smaller figure, with a word between them or
  with the total after its line's money, reads the smaller or the largest
  other figure at 0.6 'count': C18, C19, C41-C49, C94-C97, C105-C111 and
  C122-C128; 196 of 216 bare totals beside an 8% tax or tip; 738 of 924
  labelled bare totals; 1,470 of 1,827 count-last and mark-run receipts. Pin:
  'reads a total printed bare beside a smaller figure as that figure, graded
  under the bar, the known gap'.
- Where a marked figure stands beside such a total, a purchase reads debit 0.3
  (C54, C65, C112, C113, C125, C134, C135; 336 of 448 coupon receipts), and a
  refund whose bare total stands where a total does reads as a purchase graded
  0.3 (C136, which 26.10.180 read silently as a purchase graded 0). Pin:
  'reads no credit off a figure a larger count might have been the total in
  place of, the known gap'.
- A total inside labelled parentheses beside smaller figures reads the largest
  other figure at 0.6 'aside' on a purchase: P50, C31, C32, C33, C38. Pin:
  'reads past a price with tax, or a total, printed as an aside: flagged on a
  purchase, and on a refund slip read as a purchase, the known gap'. On a
  refund slip the same reading is silent (above). C90, a refund, reads 20.00
  at 0.6 credit 0.5, where 26.10.180 read 25.00 silently as a purchase
  graded 0.
- The cash-tendered sum's pick of an aside, with a plain figure in a weaker
  tier, is labelled 'aside' rather than 'tender' (Things that only became
  apparent): a model that reads the same total keeps 0.6, flagged, where it
  would lift a tender pick to 0.8.
- A count of a refund's own value on a priced line twins its total at 0.3:
  C17, and 24 of 18,690 priced-line receipts. Pin: 'reads a count of a
  refund's own value on a priced line as a copy of its total, the known gap'.
- A refund whose time, on the total's own line, repeats its total twins it at
  0.3 (C59). Silent on 26.10.180, now flagged, not right. Pin: 'reads half of
  a time of the total's value as an unmarked copy of it'.
- A total printed once beside a larger count on another line is graded 0.6: 31
  of 464 and 25 of 648 two-item receipts; and C71,
  `Pack of 24 cans $5.00 / Total $5.00`, a count followed by a unit word,
  which 26.10.180 read silently as 24.
- A tax or tip rate printed as a percent is such a count:
  `Food $12.00 / Tip 18% $2.16 / Total $14.16`, which 26.10.180 read right,
  and C13 (`Tax 8% $0.40 / Total $5.40`) and
  `Milk £1.20 / Bread £1.10 / VAT 20% £0.38 / Total £2.30`, which it read
  silently as the rate, read right at 0.6 'count'. The rate stays a rival
  because it is the only flag on a total printed bare under it:
  `Tax 8% $0.96 / Total 12`, `Tax 8% $0.40 / Total 5.40` and
  `Food $12.00 / Tip 18% $2.16 / Total 14.16` read the rate's money or the
  item at 0.6, and would read it at 0.8 with rates left out. Pins: 'grades a
  total under a tax or tip rate printed as a percent, the rate a count that
  might have been the total, the known gap' and 'reads a total printed bare
  under a tax or tip rate as another figure, flagged only by the rate, the
  known gap'.
- A lone labelled total printed with a time stays right but is graded 0.6:
  C39.
- A date OCR wrapped across two lines is lost (date 0) where the amount beside
  it reads right. Pin: 'reads no date OCR wrapped across two lines, and reads
  a part it leaves as money, the known gap'.
- The cash-tendered sum reads the change where the change is larger than the
  total, at 0.6, as 26.10.180 did; `Pack of 3 cans $2.00 / Total $5.00` reads
  3.00 at 0.6 (C119).
- Model lane, right answers now flagged: a single priced line with a larger
  count, a model reading the price (0.8 to 0.6: 1,378 to 1,399 of 2,232, by
  zone and day order), and the answers counted under Consequences. Native
  pins: 'keeps the text parser's grade when it read the same figure under a
  larger count', 'flags a model total that differs from one the text parser
  picked by a rule' and 'flags a model total that differs from a
  cash-tendered pick'.
- Refunds whose count might be the total on the total's line read twinned 0.3,
  where 26.10.180 read them silently wrong: C70, C72.
- Split onto two lines, the bare-total classes read silently, as on 26.10.180:
  the split rows of C18-C19, C41-C49, C54, C65, C93-C97, C99-C117, C122-C130
  and C134-C136.

**Flagged, as on 26.10.180, where a stricter date rule would have read them.**

- A priced line that prints no sign, or prints it after the price, reads as a
  date graded 0.3 or 0.5, and drops out of the amount hunt: 1,765 of 2,232 in
  each of four layouts (1,766 on Tokyo's clock). Under a total line
  (`Item 9 3.25 / Total 3.25`, `Item 9 3,25 € / Total 3,25 €`) the amount is
  right; alone (`Milk 1 3.25`, `Brot 1 2,10 €`) no amount is read. All 216
  `Tax 8% 1.04` lines of the kind read as dates with the month first, and
  204 with the day first: the other 12 read, day first, as dates in November
  or December 2026, which the future-date guard turns down until they pass.
  Pin: 'reads a priced line printed with no sign, or with its sign after the
  figure, as a date, flagged, the known gap'. Battery rows C3 and C172.
- Receipts 26.10.180 reads silently that a stricter date rule would have read
  right stay so: 78 of 4,464 receipts whose `dd.mm yy` date shares the total's
  line, 552 of 71,424 whose date prints two different marks, 330 of 15,360
  slips that print no currency mark, 3,348 of 7,680 whose total's cents a
  spaced date follows, 195 of 11,160 with a comma between the day and the
  month, 512 of 13,824 with a doubled mark or a run of spaces, and 616 of
  360,000 over pairs of marks.

**Silent and unchanged from 26.10.180, pinned in the battery's lists.**

- A restated or labelled figure in parentheses that outranks the total and
  reads as a credit (`Was ($79.99)`, `定価(¥1,580)`, `(¥1,280)` under
  `合計 ¥1,180`, `（¥1,298）`), as does a label glued to its sign (`(REG$15.00)`):
  P1, P6, P7, P12, X12, C34.
- A saving larger than the total, printed negative: P44, P45.
- A points line in parentheses on a receipt that prints no currency sign, read
  as a credit at 0.5: P2-P5, X13.
- A reference number glued to a Han label, read as a negative where it wins
  from the plain numbers: P16, P34.
- An aside the rule cannot see: no closing parenthesis (C36), no parentheses
  (C37).
- A refund slip whose only total is labelled in parentheses (`(Total $64.79)`:
  C40), or with its currency in letters there (C35), read as a purchase graded
  0.
- A currency sign spaced from two bare figures, which reads both and so the
  larger (C66, `Item 24 $ 5`).
- Cash whose change is itself round (C91).
- A total with cents whose figure starts a date printed after it on its line,
  its sign spaced from it or a code before it (`Total $ 5.15 01/15/26` reads
  26), the run listed above. With the sign glued it reads right: C75.
- The two misses: a minus Vision did not read, and a minus glued to kana or to
  a Thai, Arabic, Hebrew or Devanagari label, each leaving a refund a plain
  purchase.
- `Ref 2025 1.10` reads as a date at 0.9 (165 code receipts). Pin: 'reads a
  four-digit code before a price with no sign as a date, the known gap'.

0147's gap '0013's demotion still has no say over the model's figure'
narrows: a disagreement with a cash-tendered pick read beside a currency mark
is flagged now; agreement with one still lifts it where no rule labels it
too, and a disagreement with a weaker tier's pick still keeps 0.8.

None of these classes is filed as an issue. Grouped by the change that would
take each up, they are seven: the date reader's displaced runs (the run from
a price's own figure, the day-first date after a whole-number price, the
year-first two-digit date, the wrapped date, the date glued to a figure and
the date glued after a sign),
with the two rejected guards' counts; the model lane's disagreement policy
on receipts with no currency sign; totals and change with no currency mark
beside signed lines, and the date-led total; any figure printed negative
under a priced item; the unlabelled bare total; the asides the rule cannot
see, with the refund total printed as one; and a sign spaced from two bare
figures, round change and cash where no pair adds up.

### The device's flags

- **The flag does not say why the parser doubted its total.** A reading
  demoted past an aside or under a count says *the scan could not read it
  for certain* like any other. Naming the reason would carry
  `amountDemotion` through the row, and on the model lane the flagged figure
  is the model's, not the parser's demoted pick.
- **Two cloud flags still quote a percentage no model reported.**
  Consolidation grades an item sum, or a total that strays far from it, at
  `REVIEW_AMOUNT_CONFIDENCE`, which reads *50% sure*; and the form grades a
  cloud date that will not parse at 0, which reads *0% sure* of a date
  nothing read. Both are 0045's class, outside the device.
- **The category chip's percentage** (*High confidence (95%) — the AI is
  confident…*) is the same class, on every lane.

### The shared file

- **A share that waits is not said.** One the busy guard defers is stripped
  from the URL with nothing said. It drains on the next navigation that
  carries the flag: a later share, the next load, whose sign-in effect counts
  the stash and sends it there, or on iOS the next activation. A plain visit
  to the upload step does not drain it. A share with no owner on it, which
  is every iOS share and a web share made signed out, can outlive the
  30-minute claim window while it waits, and is then dropped unread.
- **A share drained while the wizard is leaving** is consumed and not
  imported, as it was before.
- **The sign-in effect's navigation still drops `error=1`.** It passes no
  `queryParamsHandling`, so 0165's second share-flag gap stands: a share lost
  beside an earlier one still waiting brings no notice.
- **A raw HEIC** shared from the Files app is refused for its type, now with
  its name in the alert; neither gate takes HEIC.
- **A backup is refused at the share door**, by design, and a CSV typed
  `application/vnd.ms-excel` with no `.csv` extension is refused there too,
  though a pick would take it.
- **A share the gate refused as too large is quoted the dropzone's limit.**
  The two are the same only because both read `IMPORT_FILE_MAX_BYTES` and
  the wizard sets no other `maxFileSize`.
- **The share-target POST and the iOS extension and plugin lane are driven
  by no browser journey.** Journey 109 writes the stash in the worker's row
  shape and drives everything after it.

### The upload area, the review card and their gates

- **The frozen per-item controls.** The sixth rule's 27 frozen rows, 28
  controls in eleven templates, still name every copy alike, among them the
  transaction filters' remove-search buttons, the receipt images' remove
  buttons, the camera's photo arrows and remove, and nine review-card
  controls. The goal card's edit and delete, stamped once per goal by the
  goals page's own repeat, are neither guarded nor frozen: the rule reads a
  template's own repeats.
- **Two toggles stay unnamed, frozen by the eighth rule.** The budget form's
  alert-threshold slider carries its `aria-labelledby` on the `mat-slider`
  host, which names no thumb; the AI page's Auto sync switch has a sibling
  label it never references.
- **Settings' Sign out button has no name below 480px.** Its label, the only
  name it has, is taken out with `display: none` there
  (`settings.component.scss:81-85`), the class the step labels had.
- **`joinSentences` still joins with a Latin stop in ja and tc** (0099's
  gap): the review card's names, the form's verify text and the wizard's
  round notice. Only the dropzone's alert reads `common.sentenceSeparator`,
  the key a later fold would read.
- **Two places are swept by no axe pass.** The empty upload step, where the
  dropzone is a `role="button"` around the Browse button, which axe very
  likely reads as nested-interactive; and the review step's body, of which
  only the review card is swept.
- **In a mixed pick the move arrows and the number badge count every file.**
  A photo before a CSV keeps an enabled down arrow that swaps it below the
  CSV, and with a CSV first the photos are numbered 2 and 3.
- **Twenty-one fades outside this wave are unmeasured.** The upload area
  and the wizard hold no other resting fade, but 21 `opacity` rules
  elsewhere — on the goal card, the forecast, the data hub, login and
  others — were not measured, and `contrast:check` says it cannot see
  opacity.
- **Neither of those two classes is a gate**, unlike the three this record
  makes one. A control's only name taken out with `display: none` under a
  media query, and a resting glyph faded under its bar by `opacity`, came to
  light in the browser run and the axe sweeps, not by reading a file, so
  0145 does not ask for a check; and neither reads from one file. The first
  needs a component's stylesheet and template read together, the media
  query's width resolved, and the control's whole name traced to the hidden
  element. The second needs the colour painted behind the glyph, which
  `contrast:check`'s table does not hold: an `opacity` it scored would read
  its token's full-strength ratio. The step headers' case and the upload
  area's painted-colour cases hold the instances fixed here; Sign out and
  the 21 fades wait for a sweep that renders them.
- **iOS 15's WebView keeps the one-line photo row.** It has no container
  queries, so at phone width the name keeps its narrow column there and only
  the size and type wrap. No device run checked it. A photo row dragged at
  phone width shows the one-line row for the moment it is dragged.
- **The name column's line count depends on the font.** A case that counts
  lines reads them in the spec's pinned font; the browser's PT Sans gave one
  line where Verdana gives two.
