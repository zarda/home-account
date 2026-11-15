# 189. A price is no part of a date, a total with no currency mark is read on a sum, a reading past an aside asks its type, and a receipt that prints a code and no sign disputes the model

**Status:** Accepted, implemented · **Date:** 2026-11-15 · **Issues:** #524, #525, #526, #529

Reference documentation lives in [../receipt-import.md](../receipt-import.md),
[../testing.md](../testing.md) and [../e2e.md](../e2e.md).

[0186](0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md) left the device's text parser, and the model lane it is the
second witness on, reading four kinds of receipt wrongly with no flag, and
filed them as #524, #525, #526 and #529. A run of numbers that only looked
like a date took a price into it, and a date OCR wrapped, glued to a number
or printed year first was lost and read as money. A total printed with no
currency mark beside lines that print one lost to the largest marked figure.
A regular price whose parenthesis OCR lost, or whose label was glued to its
sign, read as the total, and a refund whose total is a labelled aside was
filed as a purchase nobody asked about. And on a receipt that prints a
currency code and no sign, any total the model read was lifted to its own
grade. [0188](0188-a-total-is-read-by-where-its-figures-are-printed-under-a-discount-past-round-cash-and-beside-an-unmarked-change-and-the-parser-is-measured-by-a-harness-that-is-kept.md) moved none of these readings. This record reads each
of them, or asks. No word is read ([0008](0008-universal-receipt-language-support.md)).

A browser run of the new readings on a rendered review card met one defect
older than these issues: at phone width the one card of a single receipt was
folded into a list that scrolled. It is fixed here with a spec.

Closes six gaps of [0186](0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md): the refund slip whose total is printed
inside labelled parentheses, the total line led by its date that prints no
currency mark, the two-digit-year date printed year first, the direction a
payment line turned where a run took the total, the day-first date printed
after a whole-number price, and the date glued to a figure by a mark.

Narrows four more gaps of [0186](0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md): the total line that prints no
currency mark beside signed lines, the date OCR wrapped across two lines, the
run that only looks like a date where a price's own figure starts it, and the
receipt that prints no currency sign on the model lane.

Amends [0186](0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md), [0188](0188-a-total-is-read-by-where-its-figures-are-printed-under-a-discount-past-round-cash-and-beside-an-unmarked-change-and-the-parser-is-measured-by-a-harness-that-is-kept.md) and [0147](0147-a-row-is-graded-by-what-its-door-can-vouch-for.md). Their rules
stand. 0186's date still stops at a currency sign and a line break, and now
also at any figure a sign touches, with one exception across a line break;
its aside rule reads an unclosed parenthesis and asks about the type. 0188's
amount rules gain one more correction, and its harness more classes and
columns. 0147's rule for a parser that does not trust its own reading gains
one exception.

Applies [0008](0008-universal-receipt-language-support.md) and [0145](0145-a-class-found-by-reading-becomes-a-gate.md).

## Context

The date reader of 0186 stops a date at a currency sign and a line break and
starts a year-last date neither inside a figure nor at a figure its sign is
glued to. That closed #515, and left seven shapes reading worse than
26.10.180 had, which had read most of them right by accident: its reader
stopped first at a date it had read through a sign or across a line break.
#524 lists them. Each ends in a wrong total at 0.8, a refund filed as a
purchase graded 0, or no date.

Whether a figure is read beside a currency mark is decided by its own line,
and the first tier that holds anything wins. So one marked figure anywhere on
a receipt outranks every unmarked one, the total included (#526).

A figure is a labelled aside only between two parentheses, and up to three
capitals before a sign were the sign's own. An aside is never a credit, so a
refund whose total is one reads as a purchase graded 0 (#529).

On the model lane a total that differs from a parser reading under the bar
is graded on its own ([0147](0147-a-row-is-graded-by-what-its-door-can-vouch-for.md)). On a receipt with no currency sign
every parser reading is under the bar (#525).

## Decision

### A date that starts inside a run is still read, and a date written whole is preferred

The year-last scan starts again just after each run's first number, where it
used to go on from the run's end. `Milch 2 € 13 24.07.24` reads 26.00 on
24 July 2024: `13 24.07` makes no date, and `24.07.24` starts inside it.

A date **written whole** is two short numbers and a year on one mark printed
twice, with no space in it (`24.07.24`, `1/13/24`). A run that makes a date
without being written whole waits for a whole date that starts inside it, and
the whole one is read. `Total $ 27.01 12/5/24` reads 27.01 on 5 December
2024, where `27.01 12` read as 27 January 2012 and the total as 24; so do the
code form, the card line (`Card ****1234 $ 3 1/13/24`) and
`Total $ 5.15 01/15/26`. With the total in the amount hunt again, a payment
line that repeats it disagrees with it, and the direction is twinned at 0.3
as the glued forms already were.

### A price is no part of a date

`readCurrency` runs before `readDate`, which is handed the receipt's marker.
`signedFigures` reads every line as the amount hunt does (`signedSides`) and
lists the figures a sign or the code touches, glued or one space away. A run
is turned down where it cuts one of them, or holds one whole behind its sign
(`takesInMoney`). `Kaffee 2 x 5,10 10,20 €` reads 10.20 and no date, on the
purchase and on its refund, where the cents and the next whole part read as
10 May 2010 and the total as 20. A run written whole is a date whatever
touches it (`€ 15.01.26`, `15.01.26 €`).

A run that holds a price whole **before** the sign after it still reads
(`Summe (2) 12,10 €`). Barring it reads an item above a discount that only
such a run kept out of the amount hunt: 52 receipts newly silent in the
prototype. It stays a gap.

### A date that would lie ahead was not read the way it was written

Nothing is dated ahead. Where a date is turned down only for lying ahead:

- written whole, with a two-digit year and a first group that cannot be a
  month, it is read year first, graded 0.3: `23.01.27` is 27 January 2023 and
  `26.10.30` is 30 October 2026, where each stood as one figure of money
  larger than the total;
- with both numbers able to be a month, it is read in the other order from
  the device's: on 30 October 2026, `11/08/26` is 11 August to a month-first
  device.

The issue names the first. The second is its neighbour, and without it five
whole-price receipts in 20,000 newly read silently on a month-first device.

### A date written whole is read across a line break

A date written whole whose year OCR wrapped is read where the second mark
stands beside the break, on either side of it: `13.01.` over `24`, `15/01`
over `/2026`. A minus that starts the next line marks that line's figure, and
a number that runs on as a figure (`24.50`) is no year. A line that ends in a
figure still parts a date from what follows, so `Total $5.15` over
`01/15/2026` reads as it did, and `28.09` over `26`, with no mark beside the
break, stays two lines.

### A date glued to a number by another mark is a date

A date never starts inside a figure. Cents carry on in the mark that joined
them or in a space, so a date written whole on a mark of its own, right after
a joining mark, is read: `Bon 4711.13/01/25`, `Bon 4711,13.01.2025`. The
number it was glued to leaves the amount hunt with it. The cents of
`$145.01 01 01 24` are still no day.

### Every date written whole leaves the amount hunt

Only the text of the date read came out before the amounts were hunted. A
second date left its numbers behind as counts beside the money or as a year
among the plain numbers. With a reader that restarts and reads a date in its
other order, which of two dates is read first changes more often, and what
the other leaves with it. Every other date the receipt writes whole, year
first or on one mark printed twice, now comes out too. A date read across a
line break leaves the break where it was.

### A total with no currency mark is read on a sum, or asked about

Only for the tier beside a currency mark, and only where neither the cash nor
a discount moved the reading (`unmarkedTotal`). A figure written like money,
on a line the receipt does not mark as money, larger than every marked
figure, puts the reading under the bar with a label of its own, `'unmarked'`.

- Where one of the marked figures and one more figure of money add up to it,
  it is read: `Eggs $10.86 / Tax $0.87 / Total 11.73` reads 11.73, and so
  does the total between its subtotal and its tax, or above both.
- Where nothing adds up to it, the marked figure is kept:
  `Bagel $4.50 x2 / Total 45.00` reads 4.50.

Both are graded 0.6. The reading moves only on a receipt that prints the pick
unmarked every time, as 0188's do. Three figures are no such total: one that
carries another mark than the pick (a balance in accounting parentheses), one
with a short group in its middle (`Lot 13.01.31`), and a round figure
standing between a marked figure and one after it that add up to it, which is
the cash (`Total $49.03 / Cash 50.00 / Change $0.97`).

On the model lane the label is a rule's (`pickedByRule`): a model that agrees
keeps the parser's 0.6, and one that reads the subtotal is disputed at 0.5.
No code changed there for it.

### A sign's capitals are a currency's, and an unclosed parenthesis ends with its line

The capitals before a sign are the sign's own only where a currency is
written with them: those the platform prints in a sign (`NT$`, `HK$`, `CA$`),
a currency code it knows, or the letters one begins with (`US$`, `S$`). They
come from the platform's currency data, and the patterns are built on the
first receipt read rather than when the module loads, since the web build
never runs the parser. `(REG$15.00)` is a labelled aside.

An opening parenthesis before a figure that nothing on its line closes is
closed by the end of that line: `(Reg $15.00` is the aside `(Reg $15.00)`.
One carried from the line before closes the same way only where the figure's
line holds no word of its own, as the second half of `(Reg` over `$15.00`
does.

### A reading that is or passed an aside asks which way the money moved

Labelled parentheses around a refund's total and around a regular price are
the same print. Where the figure read is an aside, or the reading passed one,
and nothing marks it, the direction is graded 0.3 (`TWINNED_MARK_GRADE`), so
the review asks about the type. `REFUND / (Total $64.79)` is still read as a
purchase, and asked about. So is a figure whose copy is printed as an aside:
one item, and `(Total ¥4,493)` repeating it. A credit printed on the figure read is kept:
`($64.79)` and `(Refund -$64.79)` stay credits at 0.5, and [0185](0185-a-refund-is-asked-about-at-every-door-and-a-category-follows-its-rows-side-there-and-back.md)'s rejection
of the restatement rule stands.

### A receipt that prints a code and no sign disputes the model

In `disputedAmountGrade`: where the parser read a currency, the OCR text
holds no currency sign, and the parser read any total, a model total that
differs is graded 0.5. There the parser's grade is low for want of a sign,
not for want of a reading. An agreement is graded as any other is. A receipt
that prints no currency at all is graded as before.

### The measurement grows

`scripts/measure-receipt-parser.mjs` gains sixteen classes: a date after the
total, elsewhere, after a card line and after a whole price; a two-digit year
printed first; a wrapped date; a date glued by a mark and one glued after a
sign; figures that only look like a date; a total with no mark and the
balance that rule costs; a regular price and a tax as asides; a refund total
as an aside; a receipt with a code and no sign; and one with no mark at all.
Where a class knows its date the date is judged. Two columns say what a
newly silent receipt was before, and how many purchases have their type newly
asked about. The model lane's mirror follows the code-only rule, and
`--grades-before-0189` leaves it off for the base side. A set's noise no
longer prints a date later than the held clock, nor a line inside a wrapped
date.

### A lone review card has no fold

`.transactions-list` folds at 70dvh. With one row the list carries `lone` and
no fold.

## The score

The battery's sixty receipts: the amounts stand. Purchases score
14 / 3 / 12 in both layouts, where they scored 16 / 1 / 12: P8 and P50 are
read past an aside and now ask about their type. Refunds, corrections and the
twelve rows silent in the stricter sense are unchanged, and so are 0185's
thirteen.

0186's counterexamples, C1 to C180 (178 rows), in 0185's columns:

| Parser | Refunds: credit / 0.3 / debit 0 | Purchases: debit 0 / 0.3 / credit | Corrections | Silent rows | Silent, stricter sense |
|---|---|---|---|---|---|
| 26.11.183, joined | 12 / 7 / 7 | 141 / 10 / 1 | 87 | 17 | 24 |
| this record, joined | 16 / 10 / 0 | 127 / 25 / 0 | 71 | 7 | 7 |
| 26.11.183, split | 16 / 2 / 8 | 141 / 1 / 10 | 94 | 50 | 68 |
| this record, split | 20 / 5 / 1 | 128 / 15 / 9 | 79 | 39 | 52 |

Leaving the stricter joined list: C30, C34 to C36, C40, C138, C156 to C162,
C166, C167, C179 and C180. Leaving the stricter split list: the same without
C160. C41 and C43 leave the split list of 0185's sense, their type now asked
about beside an aside that repeats the figure read. No row joins a list. Left
in the joined list: C37, C92, C120, C152, C168, C169 and C178.

The harness, 3,000 receipts a class, silent before → after, against
26.11.183 in New York time, month first:

| Class | Joined | Split | Right, newly flagged | Right → wrong | Dates read right, joined |
|---|---|---|---|---|---|
| Date after the total | 308 → 194 | 196 → 194 | 74, split | 0 | 2,433 → 2,991 |
| Date elsewhere | 1 → 0 | 924 → 7 | 1 | 0 | 2,919 → 2,942 |
| Date after a card line | 19 → 0 | 47 → 46 | 0 | 0 | 2,326 → 2,998 |
| Date after a whole price | 515 → 221 | 1,461 → 948 | 0 | 0 | 1,690 → 2,644 |
| Two-digit year first | 259 → 230 | 1,028 → 474 | 0 | 0 | 127 → 339 |
| Wrapped date | 246 → 235 | 611 → 338 | 6 and 3 | 0 | 0 → 1,468 |
| Date glued by a mark | 322 → 296 | 1,104 → 609 | 0 | 1 and 1 | 509 → 2,405 |
| Date glued after a sign | 834 → 777 | 1,156 → 780 | 0 | 0 | 0 → 0 |
| No date printed | 0 → 0 | 942 → 6 | 240 and 123 | 0 | none printed |
| Total with no mark | 2,732 → 73 | 2,732 → 73 | 0 | 0 | |
| Balance under a marked total | 0 → 0 | 0 → 0 | 2,391 | 4 | |
| Regular price as an aside | 1,085 → 0 | 1,085 → 0 | 0 | 0 | |
| Tax as an aside | 0 → 0 | 0 → 0 | 0 | 1,004 | |
| Refund total as an aside | 934 → 233 | 934 → 233 | 0 | 0 | |
| Code and no sign | 0 → 0 | 0 → 0 | 0 | 0 | |
| No mark at all | 0 → 0 | 0 → 0 | 0 | 0 | |
| 0188's fifteen classes | unchanged | unchanged | 0 | 0 | |

No date read right before is lost, and none is newly read wrong at or over
the bar, in any class. On the model lane the code-only class kept 9,694 wrong
answers at or over the bar before and keeps 104; 104 right answers are
flagged where none was.

The six seeded sets, 480,000 readings over both layouts: 80,174 read silently
before and 45,279 after; 22,242 wrong readings are right; 5,252 right
readings are wrong, each flagged, nearly all of them the tax printed after a
parenthesis that never closes; 12,097 right readings are newly flagged,
nearly all of them the balance under a marked total; 16,790 purchases have
their type newly asked about. On the model lane, per figure printed, 277,400
wrong answers stood at or over the bar before and 201,252 after, and 107,682
right answers were flagged before and 117,017 after.

**Nine receipts of the sets newly read silently month first, and eleven day
first**, all in the split layout but one. None read right before: each read a
wrong amount on 26.11.183 and was flagged only because the numbers of a date
left in the amount hunt stood beside the money as a count, or completed a
cash-tendered sum. With the date read as a date, that flag is gone. They are
of two kinds 0188 already lists as read silently: a sign spaced from two bare
figures and split from them (`Tea 4 ¥ 30` over `Total ¥` and `120`, which
reads 30), and a price split from its code onto a line of its own
(`Soap 2 JPY` over `982`, which reads 2). The harness exits 1 on them, and
this record accepts them by name. The two zones read alike.

The generated receipts are built from the classes the rules were written
for, so their shares say what a rule does to a class, not how often a real
receipt is one. A third of the tax-as-an-aside class is the unclosed form
that costs; how often a real receipt prints it is unmeasured, as it is for
every shape here.

## What was rejected

- **Reading a date glued after a currency sign** (`€15.01.26`), #524's
  seventh part. Dropping the sign from what a date may not follow reads all
  3,000 of that class's dates. In the split layout, where a spaced sign or a
  code is parted from every price, it also takes the date's numbers out of
  the amount hunt on receipts whose reading was wrong and flagged only by
  them: 31 and 33 receipts newly silent a run, against 9 and 11. It is left
  out, and the gap stands.
- **Barring every run that holds a price**, the sign after it included. It
  closes `Summe (2) 12,10 €` (C168) and newly reads 52 receipts silently.
- **Moving the reading to any larger unmarked figure**, sum or no sum. The
  cash printed with no mark between a total and its change is such a figure,
  and so is a points balance.
- **Only flagging an unmarked total**, never reading it. The sum is on the
  receipt; reading it turned 1,889 of 3,000 wrong readings right a layout,
  and the reading stays under the bar either way.
- **Seeing a total printed as a bare whole number** (`合計 980` over
  `内税 ¥72`). A store or receipt number on another line looks the same.
- **Keeping the parser's grade where a model agrees with its weak pick on a
  code-only receipt.** Of 3,000 such receipts it leaves 16 wrong answers at
  the bar and flags 2,984 right ones; lifting leaves 104 and flags 104.
- **Disputing every model total a parser reading under the bar differs
  from**, the broad variant 0186 measured. It flags the right answer on about
  one receipt in twenty of every mixed set.
- **Letting a tier of plain numbers pair across tiers with the cash on a
  code-only receipt.** It reads C170's total and moves a battery row #525
  asks to leave alone.

## Consequences

- A receipt whose date follows a price, wraps onto two lines, is glued to a
  number or is printed year first reaches the review card with the total its
  own. A date read year first, or in the device's other order, is graded
  under the bar, so the row is dated today and asks about its date as any
  date under the bar does.
- A total printed with no currency mark reaches the card as the total where
  the receipt's own figures add up to it, and the card asks about the amount.
- **A right total over a larger figure with no mark is asked about**: a
  points balance, a card balance. Where that balance happens to be the total
  and an item added up it is read in the total's place, flagged: 4 of 3,000.
- **A total printed after a parenthesis that never closes**
  (`Total (incl. tax $12.50`) reads the figure before it, flagged, as its
  closed form does.
- **Every purchase read past an aside has its type asked about.** Its amount
  was already asked about, so no row gains a first question, except a lone
  aside (`Shop / (Reg $15.00)`), which gains one.
- On a receipt that prints a code and no sign, a model that reads the cash or
  an item is disputed; a model that reads the printed total is disputed too
  wherever the parser read another figure.
- The sign patterns are built on the first receipt, so the first scan on a
  device pays for asking the platform every currency's sign once.
- A single receipt's review card is shown whole at phone width.

## What the browser runs found

### Run 1, on 15 November 2026

Emulators only, as Alex, at the pane's 1024px and at 375px, in English,
Japanese and Traditional Chinese, served from this branch's checkout; the
bundle named `demo-home-account` alone and the console held no error from
first load to teardown. Journey 118 is diagnostic-grade, as journeys 110 and
117 are: the two Capacitor bridges are stood in for on a child of the app's
own `NativeReceiptService`, and the reading reaches a real review card
through the camera's converter, duplicate check and hand-off. The pane was
hidden, so every read was flushed first, and the session record was fetched
by the page from a loopback server that answered this origin alone.

- The date after a spaced price read 27.01 dated today, and the wrapped date
  12.50 dated today, with no flag on the amount.
- The year-first date read 630, where it read 2,610.30; graded 0.3, the date
  was moved to today and asked about.
- The total with no mark showed `-$11.73` with the flag *Double-check this
  amount — the scan could not read it for certain*, 4px clear of the amount;
  the balance under a marked total kept `-$12.50`, flagged.
- The lost parenthesis showed `-$12.50` with the amount's flag and the type
  toggle's, which read in the reader's language in Japanese and Traditional
  Chinese; the refund printed as an aside asked about its type.
- With a model answering on the code-only receipt, the cash was graded 0.5
  and the total 0.8.
- Journey 117's readings held. Journey 110's two aside steps read their
  amounts as before and now carry the type's grade, 0.3.
- **Found:** at 375px the one card of a single receipt, 618px tall with a
  date question on it, stood in a list folded at 568px and scrolled inside
  it. Fixed, and read again with the card whole and nothing scrolling
  sideways.

Nothing was imported and no row was written but the language switches. The
run did not switch to the dark theme.

## Departures from the issues

- **#524's seventh part is not done.** A date glued after a currency sign is
  still not read (above), and its pin stands.
- **C168 stays silent**, so #524's line that C166 to C168 leave both lists is
  met for C166 and C167.
- **Receipts newly read silently are not zero.** #524 does not ask for zero
  and 0186 recorded 36; this record names its nine and eleven.
- **A rule #524 does not name**: a date that lies ahead in one order of day
  and month is read in the other.
- **A rule no issue names**: every date written whole leaves the amount hunt.
- **#526's points balance keeps 12.50 but not its grade.** The acceptance
  line pins the grade; it is 0.6 now, which is the rule's cost.
- **C156 and C157 are asked about, not read.** No sum backs 45.00. The issue
  allows the marked figure under 0.7.
- **The sixty's score changes** (#529 allows it stated): purchases
  14 / 3 / 12.
- **#525's agreement with a weak pick is lifted**, the first of the three
  outcomes the issue offers, on the counts above. The right total on C170's
  text is disputed, because the parser reads the cash there.
- **0186's sets are not re-run**, as in 0188: each acceptance line is met
  with the harness's own class of the same shape.

## Things that only became apparent while building

- Restarting the search inside a run closed most of #524's first two parts on
  its own, before any rule knew which figures were money: the date written
  whole after the price was simply found.
- A date rule is measured by the flags it removes as well as the readings it
  fixes. The first version of "every whole date leaves the amount hunt" made
  92 receipts newly silent, all of them wrong already and flagged by a date's
  leftover numbers; the unmarked-total rule, written for another issue,
  covered all but the nine.
- The first unmarked-total rule read the cash: a total and its change add up
  to it. Position told them apart, as it does in 0188.
- A harness class can cost a set its zero: a line of noise between the two
  halves of a wrapped date was the generator's doing, not a receipt's.
- A spec that pinned a flag as absent on the date chip failed for a reason
  unrelated to the reading: the camera door asks about any date that is not
  today.

## Known gaps

### The parser

Silent, pinned, and unchanged by this record:

- A date glued after a currency sign (`€15.01.26`), not read, and day first
  with dots read as one figure of money.
- A run that holds a whole price before the sign after it
  (`Summe (2) 12,10 €`, C168).
- A date whose year wrapped with no mark beside the break (`28.09` over
  `26`, C149 split).
- A two-digit-year date printed year first whose day-first reading is a day
  that has been (`26.10.15` reads 26 October 2015, at 0.5, under the bar).
- A time printed before the date on its line (`10:15:26 01/15/2026`), which
  is read as the date.
- A total printed as a bare whole number beside signed lines (C92).
- A regular price printed with no parenthesis (C37), and a word that is also
  a currency code glued to its sign (`(ALL$15.00)`).
- A refund whose total is a labelled aside is asked about, not read as a
  refund. The 233 of 3,000 the harness still reads silently in that class
  print no label: accounting parentheses around a figure with its sign
  spaced after it, `(16,04 €)`, which are read as neither a credit nor an
  aside.
- The nine and eleven receipts of the sets named under The score, and the
  split-layout shapes they belong to.

Flagged costs are listed under Consequences.

### The model lane

- On a receipt that prints a code and no sign, a model that shares the
  parser's weak pick is lifted to 0.8 (the cash on C170's text).
- A receipt that prints no currency at all still grades a model total on its
  own: 8,062 wrong answers at the bar in 3,000 receipts of that class.
- A model that reads the same wrong figure as a confident parser is still
  lifted, as 0186 lists.

### The measurement

- As in 0188: generated receipts, four currencies, Latin labels, and a mirror
  of the model lane kept by hand.
- Adding classes changed the mixed sets, so the set counts here are not
  0188's and cannot be set beside them.

### The browser run

- Journey 118 answers Vision and the on-device model from the page. No photo
  is read and no device is driven.
- The run walked single cards in a hidden pane, in light only.
