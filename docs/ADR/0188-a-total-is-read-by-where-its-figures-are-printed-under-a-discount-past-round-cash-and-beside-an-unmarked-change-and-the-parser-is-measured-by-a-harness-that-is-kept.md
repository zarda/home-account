# 188. A total is read by where its figures are printed: under a discount, past round cash and beside an unmarked change, and the parser is measured by a harness that is kept

**Status:** Accepted, implemented · **Date:** 2026-11-14 · **Issues:** #527, #528, #530

Reference documentation lives in [../receipt-import.md](../receipt-import.md),
[../testing.md](../testing.md) and [../e2e.md](../e2e.md).

[0186](0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md) left the device's text parser reading a wrong amount at its
tier's grade, with no flag, on five kinds of receipt it recorded under Known
gaps and filed as #527, #528 and #530: a discount printed under a larger item
or subtotal, cash over a round total, cash where the total or the change
prints no currency mark, a total printed as a bare whole number beside a
smaller figure, and a currency sign spaced alike from two bare figures. Each
is a case where the largest figure beside a currency mark is not the total,
and where the sums the parser already tried could not say so. This record
adds the one thing those sums left unread: where on the receipt the figures
are printed. Change is printed after the cash it was given for and the total
before it; a discount and the total it leaves are printed after the figure
the discount was taken from; a subtotal and its tax are printed together. No
word is read ([0008](0008-universal-receipt-language-support.md)).

0186 counted its classes on generated receipts whose generators were never
kept, so none of its counts can be run again. The measurement is a script in
the repository now, `scripts/measure-receipt-parser.mjs`, which reads the same
seeded receipts on two versions of the parser and fails where one newly reads
silently. Its counts replace 0186's for the classes this record touches; they
do not continue them.

A browser run of the new readings on a rendered review card met one defect
older than these issues: the amount's flag stood flush against the amount.
It is fixed here with a spec.

Closes two gaps of [0186](0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md), the cash where no pair of figures beside a
currency mark adds up to it and cash whose change is itself round.

Narrows three more gaps of [0186](0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md): any figure printed negative under a
priced item, the total printed bare beside a smaller figure, and a currency
sign spaced from two bare figures.

Amends [0013](0013-the-printed-total-is-the-amount-not-the-item-sum.md) and [0186](0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md). Their rules stand. 0013's
largest-wins keeps its cash-tendered correction, which now reads the pair's
place on the receipt as well as its sum, and gains a correction for a
discount. 0186's count rule gains one more way a count may have been the
total, its sign rule a tie-break from the receipt's other lines, and its
model lane a fourth label it treats as a rule's.

Applies [0008](0008-universal-receipt-language-support.md) and
[0145](0145-a-class-found-by-reading-becomes-a-gate.md).

## Context

`readAmount` in `src/app/core/services/receipt-text-parser.ts` sorts a
receipt's figures into three tiers (beside a currency mark, written like
money, plain) and takes the largest figure of the strongest tier that holds
one. Before this record three corrections moved or flagged that pick: the
cash-tendered sum, a labelled aside, and a larger count that might have been
the total. A figure kept the line it was printed on and nothing else about
its place.

- **A discount (#527).** `Shop / Item 1 $3.00 / Coupon -$1.00 / Total $2.00`
  read 3.00 at 0.8, and so did a subtotal printed above the coupon and the
  Japanese `小計 / 値引 / 合計` layout. A figure printed negative entered its tier
  as a positive candidate and nothing subtracted it.
- **Cash over a round total (#530, part 2).** The cash-tendered sum stood
  down wherever the larger figure of its pair was itself round, because
  `{450, 50, 500}` is equally a total with its change and a subtotal with its
  tax. A cash receipt for a round total is such a pair, so
  `Total $15.00 / Cash $20.00 / Change $5.00` read 20.
- **A total or a change with no currency mark (#530, part 3).** The pair was
  drawn from the figures beside a currency mark, so `Total 9` over
  `Cash $10` and `Change $1` never paired and the cash was read.
- **A bare total (#528).** `Item $11.04 / Subtotal $11.04 / Total 12 $0.96`
  read 11.04 at 0.8: the 12 is a count by its print, and the count rule
  stood down because the figure read is printed twice.
- **A spaced sign (#530, part 1).** In `Item 24 $ 5` the sign touches both
  figures alike, both were money, and 24 won over `Total $ 5`.

On the model lane a model that read the same wrong figure as the parser was
lifted to 0.8, so each of these went unflagged there too.

## Decision

### A figure keeps its place in reading order

Every candidate carries `at`, its place in reading order, line by line and
left to right along a line; `row` stays the line. The line loop of
`readAmount` runs in two passes: every line is read first, and only then is
each figure settled as money or as a count, so that what one line prints can
be weighed against the others. `signedSides` (formerly `signedFigures`)
returns which side of each figure a sign touches and the pairs of neighbours
one sign touches alike. No reading moved on this change alone.

A rule below that reads a figure for where it is printed **moves** the
reading only where no copy of the pick is printed negative and the figure it
would read is printed unmarked. A refund's cash and change are not read
apart on their order, and `REFUND / Total -$15.00 / Cash $20.00 /
Change $5.00` keeps its 20.

### Cash stands between its total and its change

The cash-tendered sum still looks for two figures that add up to a pick
shaped like a note, and still takes the pair with the largest larger figure.
What it does next depends on where that pair is printed.

- Where the larger figure is not round, and a pair stands on both sides of
  the pick, the figure printed **before** the pick is the total, whichever of
  the two is larger. `Total $4.00 / Cash $20.00 / Change $16.00` reads 4.00,
  where it read the change. A pair printed wholly after the pick, or wholly
  before it, reads its larger figure as before
  (`$43.10 / $6.90 / $50.00` keeps 43.10 at 0.6).
- Where the larger figure is round, the rule stands down while a pair of that
  figure sits wholly on one side of the pick: before it, a subtotal and its
  tax (`Subtotal $15.00 / Tax $5.00 / Total $20.00`), or after it, a total
  printed above its parts (`合計 ¥500 / 小計 ¥450 / 消費税 ¥50`). Only where
  every such pair has the pick between its figures is the one printed before
  the pick read: `Total $15.00 / Cash $20.00 / Change $5.00` reads 15.00,
  and `合計 ¥980 / お預り ¥1,000 / お釣り ¥20` reads 980.

Each is graded 0.75× its tier and labelled `'tender'`, as before.

### A total or a change with no currency mark pairs with the cash

Where no pair adds up at all, the figures of the strongest tier look past it:
one of them and one figure the receipt does not mark as money, a count on
another line included, pair where they add up to the pick **and** the pick
stands between them. The one printed before the pick is read, `'tender'`.
`Latte 2 $8 / Total 9 / Tax $1 / Cash $10 / Change $1` reads 9, and
`CASH $20.00` over `CHANGE DUE 0.82` reads the 19.18 above it. A count and
the price it counts are printed together, on one side of the pick, so
`Item 3 $2.00` over `Total $5.00` keeps 5.00 at 0.8, which is what 0186's
rejected variant, any count in the pair, could not do. The halves of a time
are never such a figure. Only the tier beside a currency mark looks past
itself.

### A discount leaves the total printed after it

Where no cash was tendered, and the pick is printed unmarked and is no aside,
`discountDemotion` looks for a figure printed negative **after** the pick (a
minus, a triangle or accounting parentheses: a coupon, a gift card, a deposit,
points) and for what it leaves:

- the pick less the discount is another figure of the tier, printed unmarked
  after the pick (`Item $3.00 / Coupon -$1.00 / Total $2.00`;
  `小計 ¥749 / 値引 -¥100 / 合計 ¥649`); or
- it is that figure once one more figure printed after the pick is added
  back, a tax under the discount or a second item
  (`Subtotal $5.30 / Coupon -$1.00 / Tax $0.34 / Total $4.64`;
  `Milk $4.80 / Bread $1.10 / Coupon -$1.50 / Total $4.40`).

The figure left is read, the largest where several fit, graded 0.75× its tier
with a new label, `'discount'`. Labels are named in the order aside, count,
tender, discount.

On the model lane `'discount'` is a rule's pick, as every label but
`'tender'` is: a model that agrees keeps the parser's 0.6, and one that reads
the item is disputed at 0.5. `native-receipt.service.ts` needed no change for
that, only a sentence. The cash-tendered sum is checked by the cash itself;
the discount's sum reads past the largest figure on a receipt that hands over
nothing to check it by, so agreement does not lift it.

### A count that two figures add up to may have been the total

A count larger than the figure read is also a rival where the figure read
and another figure of its tier, of another value, add up to it: a subtotal
and its tax make the total, and two prices do not make the count of what one
of them buys. `Item $11.04 / Subtotal $11.04 / Total 12 $0.96` is graded
0.6, `'count'`. It flags and never moves. The other figure has another value
because a price and the total that repeats it add up to twice the price,
which a dozen at 6.00 is by chance (`Item 12 $6.00` over `Total $6.00`).

### A spaced sign goes to the figure printed again

Where a sign is shared by two bare figures on a line, the one the receipt
prints again as money on another line owns it, and the other is a count:
`Item 24 $ 5` over `Total $ 5` reads 5 at 0.8. A figure counts as printed
again where another line holds its value beside a currency mark, outside an
aside, touched by a sign or written like money, and not itself sharing a
sign there, so two lines that each leave the question open settle nothing for
each other. Where neither figure is printed again, or both are, both stay
money, which keeps `Summe 12 € 3 Artikel` and `Total 2 $ 8`.

### The measurement is kept

`scripts/measure-receipt-parser.mjs` loads the parser from a git ref and from
the working tree, as source text with its one import replaced by the five
lines it imports, and reads the same receipts on both. A seeded generator
writes fifteen classes of 3,000 receipts (plain, refunds, four shapes of
cash, discounts marked and unmarked, three shapes of a total above its
parts, bare totals, priced lines, two-item receipts, spaced signs) and six
sets of 40,000 that mix them with times, dates, card digits and telephone
numbers, a tenth of them with every currency sign gone. Each is read joined
and split, as the battery splits a line. It counts, per class and layout,
the receipts read silently in 0186's stricter sense before and after, those
newly silent, right readings newly flagged, right readings gone wrong and
wrong ones gone right; and for the model lane, per figure a receipt prints,
the wrong answers left at or over the bar and the right ones flagged, graded
as `agreedAmountGrade` and `disputedAmountGrade` grade them. It exits 1 where
any receipt newly reads silently.

The clock is held at the battery's, the zone is the process's and the day
order is a flag. `--self-test` proves the generator repeats itself, the
loader reads a ref and the tree, and a planted regression is counted; CI runs
that, in a step of its own, and nothing else of it, because its checkout is
one commit deep. The counts below are from
`node scripts/measure-receipt-parser.mjs --base origin/main` at seed 20261114,
in `America/New_York` and `Asia/Tokyo`, month first and day first.

### The amount's flag stands clear of the amount

The flag that asks about a doubted amount is an icon printed inline before
the figure. It had no gap of its own, so its ring ran into the minus or plus
that leads the amount. It has 4px after it now
(`.amount-section .verify-flag`), asserted at the 288px card with the
longest amount the layout spec carries.

## The score

The battery's sixty receipts and 0185's thirteen: no reading moves, in either
layout, so the sixty's scores stand as 0186 states them.

0186's counterexamples, C1 to C180 (178 rows), in 0185's columns:

| Parser | Refunds: credit / 0.3 / debit 0 | Purchases: debit 0 / 0.3 / credit | Corrections | Silent rows | Silent, stricter sense |
|---|---|---|---|---|---|
| 26.11.182, joined | 12 / 7 / 7 | 141 / 10 / 1 | 98 | 27 | 34 |
| this record, joined | 12 / 7 / 7 | 141 / 10 / 1 | 87 | 17 | 24 |
| 26.11.182, split | 16 / 2 / 8 | 141 / 1 / 10 | 110 | 66 | 84 |
| this record, split | 16 / 2 / 8 | 141 / 1 / 10 | 94 | 50 | 68 |

Leaving the joined lists: C66, C91, C121, C137, C139, C141, C142, C151, C153
and C155. Leaving the split lists: C91, C99 to C104, C129, C130, C137, C139,
C141, C142, C151, C153 and C155. No row joins a list. C104 and C130 joined
were flagged and wrong, the larger change, and are flagged and right.

The harness, 3,000 receipts a class, silent before → after:

| Class | Joined | Split | Right, newly flagged | Right → wrong |
|---|---|---|---|---|
| Cash | 909 → 7 | 909 → 7 | 0 | 0 |
| Cash over a round total | 3,000 → 189 | 3,000 → 189 | 0 | 0 |
| Cash, total with no mark | 3,000 → 0 | 3,000 → 0 | 0 | 0 |
| Cash, change with no mark | 2,999 → 6 | 2,999 → 6 | 0 | 0 |
| Discount printed negative | 2,315 → 591 | 2,316 → 591 | 0 | 0 |
| Discount printed unmarked | 2,309 → 2,309 | 2,310 → 2,310 | 0 | 0 |
| Total above its parts, three shapes | 0 → 0 | 0 → 0 | 0 | 0 |
| Bare total | 2,999 → 1,007 | 3,000 → 1,966 | 0 | 0 |
| Spaced sign | 469 → 247 | 2,088 → 2,077 | 0 | 2, joined |
| Plain, priced lines, two items | 0 → 0 | 0 → 0 | 0 | 0 |
| Refunds | 186 → 186 | 186 → 186 | 0 | 0 |

The six seeded sets, 480,000 readings over both layouts: 186,040 read
silently before and 59,678 after; 129,001 wrong readings are right; 14 right
readings are wrong, each flagged; 2 right readings are newly flagged; none
newly reads silently. On the model lane, per figure printed, 325,724 wrong
answers stood at or over the bar before and 197,842 after, and 196,562 right
answers were flagged before and 90,592 after. The two zones read alike, and
day first moves one receipt of the sixth set, split.

The generated receipts are built from the classes the rules were written for,
so their shares say what a rule does to a class, not how often a real receipt
is one. How often real receipts print any of these shapes is unmeasured.

## What was rejected

- **Flagging the discount without moving the reading**, #527's narrower
  variant. The total is printed on the receipt and the sum finds it; with the
  guard on marked copies no generated receipt newly reads silently, which is
  what cost 0186's own moving variant its 29 and 41.
- **Reading a saving printed with no mark** (`You saved $1.00`), by flagging
  a pick where two unmarked figures printed after it add up to it, the later
  the larger. It would close 886 of the 2,309 unmarked discounts and 138 more
  of the marked, and flag 1,411, 1,498 and 1,430 of each 3,000 totals printed
  above their parts; on two seeded sets of 20,000 it closed 393 and 423 silent
  readings and flagged 1,680 and 1,822 right ones. A total above its tax
  summary is a common print and a saving with no mark needs its label read.
- **Standing down the round-change rule only where both figures are printed
  before the pick**, #530's own proposal. A total printed above its round
  parts would then read the part, flagged. Standing down for a pair on either
  side keeps it, at no cost the harness can find.
- **Any count in the tendered pair**, rejected by 0186 and still out:
  the pick must stand between the two.
- **Lifting a model that agrees with a discount's total**, as one that agrees
  with a cash-tendered pick is lifted. Nothing printed checks the discount's
  sum the way the cash checks the tender's.
- **A karma spec for the measurement.** It cannot load another version of the
  parser beside the tree's, and it would have to be kept out of `test:ci`.

## Consequences

- A receipt with a coupon, a gift card, a deposit or points under its item
  or subtotal reaches the review card as its total, and the card asks about
  the amount. So does cash over a round total, and cash beside a total or a
  change that prints no currency mark.
- A right reading is flagged where its figures add up by chance. The ones
  found are pinned: a bare number above a round total with a later figure
  that completes the sum (`Table 12 / Total $20.00 / Tip $8.00` reads 12 at
  0.6), and a count that is the total plus a price
  (`Item 13 $1.00 / Total $12.00 / Card $12.00`, 12 at 0.6).
- Where a pair stands on both sides of a pick shaped like a note, the figure
  before the pick is read, which is wrong where the pair is a chance one
  (`Item 5 ¥ 2 / Item 20 ¥ 8 / Item 7 ¥ 8 / Total ¥ 18` reads 2, flagged,
  where it read 18, flagged). The spaced-sign class holds the two the harness
  found.
- A parser change is measured by one command, and the next record can state
  its counts against this one's.
- The model lane gained no code. A model that reads the cash or the item is
  disputed where it was lifted; one that agrees with a discount's total stays
  flagged.

## What the browser runs found

### Run 1, on 14 November 2026

Emulators only, as Alex, at the pane's 1024px and at 375px, light and dark,
in English, Japanese and Traditional Chinese, served from this branch's
checkout; the bundle named `demo-home-account` alone and the console held no
error from first load to teardown. Journey 117 is diagnostic-grade, as
journey 110 is: the two Capacitor bridges are stood in for on a child of the
app's own `NativeReceiptService`, and the reading reaches a real review card
through the camera's converter, duplicate check and hand-off.

- The coupon receipt showed `-$2.00`, the `小計 / 値引 / 合計` receipt
  `-¥649`, round cash `-$15.00`, the unmarked change `-$19.18` and the bare
  total `-$11.04`, each with the flag *Double-check this amount — the scan
  could not read it for certain*; in Japanese and Traditional Chinese the
  flag read in the reader's language.
- The spaced sign showed `-$5.00` and `Subtotal / Tax / Total` `-$20.00`,
  with no flag.
- With a model answering, the item under a coupon was graded 0.5 and the
  total 0.6; the cash over a round total 0.5 and the total 0.8.
- Journey 110's aside and priced line read as they did, and the upload area
  kept its one button.
- **Found:** the amount's flag stood flush against the amount, 0px, at both
  widths. Fixed, and read again at 4px in both widths and both themes.

Nothing was imported and no row was written but the language switches.

## Departures from the issues

- **0186's sets are not re-run.** #530 asks for the 360 and the six seeded
  sets, and #528 for the 168, the 90, the 18,690 priced lines and the 464 and
  648 two-item receipts, beside 0186's counts. Those generators were never
  kept. Each line is met with the harness's own class of the same shape, on
  both versions, and the counts stand alone.
- **C66 and C121 leave the joined lists only.** Split into a label and a
  figure, the line shares no sign and prints no count.
- **C152 stays silent.** A saving printed with no mark is not read (above).
- **The sixty's score cases are not restated**, because no row of the sixty
  moves.
- **The round-change rule stands down for a pair on either side of the
  pick**, not only before it.
- **#528's unlabelled bare total over its tax** (`Total 12 $0.96 / Tax $0.96`,
  C120 and C178) keeps its pin, as the issue allows: neither a sum nor an
  order tells it from `Pack 12 $0.96` over `Total $0.96`.

## Things that only became apparent while building

- The count sum flagged `Item 12 $6.00` over `Total $6.00`: a price and the
  total that repeats it are two figures that add up. A pin of 0186's caught
  it; the harness's classes did not, and the other figure must now have
  another value.
- A commit that staged part of a file by filtered hunks left the parser
  unparseable, and the harness's own self-test, which loads the parser at
  `HEAD`, was what said so.
- The pane's page kept a 1024px layout in an 800px capture; geometry was read
  from the page, not from the picture.

## Known gaps

### The parser

Silent, pinned, and unchanged by this record:

- A saving printed with no mark of its own under a larger item
  (`Item 1 $3.00 / You saved $1.00 / Total $2.00`, C152), and a saving
  larger than the total, marked or not (P44, P45).
- A discount where the larger item is not the first and no subtotal is
  printed (`Bread $1.10 / Milk $4.80 / Coupon -$1.50 / Total $4.40`).
- A total printed bare before a smaller figure with nothing, or only marks or
  a percent figure, between them, over its tax (C120, C178), and any bare
  total split onto a line of its own (C121, split).
- A sign spaced from two bare figures on a receipt of one priced line, or
  split from its figures (C66, split).
- Cash where an item equals the change, so that a pair stands wholly before
  the cash; cash printed above its total; and cash where neither the total
  nor the change is beside a currency mark (`Total 12 $0.96 / Cash $20.00 /
  Change 8`).
- The 189 of 3,000 round-total cash receipts, and the 591 of 3,000 marked
  discounts, the harness still reads silently, which are these shapes.

Flagged costs are listed under Consequences.

### The measurement

- The harness's receipts are generated, in four currencies and Latin labels;
  it measures a rule's effect on a class, not real receipts.
- It mirrors the model lane's two grade functions by hand. A change to
  `native-receipt.service.ts` that it does not follow is caught by nothing
  but its reader.
- Its counts are not 0186's and cannot be set beside them.

### The browser run

- Journey 117 answers Vision and the on-device model from the page. No photo
  is read and no device is driven.
- The run walked one review card. It is not a sweep of the wizard.
