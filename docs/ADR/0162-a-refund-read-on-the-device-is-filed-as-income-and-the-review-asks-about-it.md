# 162. A refund read on the device is filed as income, and the review asks about it

**Status:** Accepted, implemented · **Date:** 2026-10-02 · **Issues:** #464

Reference documentation lives in [../receipt-import.md](../receipt-import.md)
and [../import-fields.md](../import-fields.md).

Amends [0147](0147-a-row-is-graded-by-what-its-door-can-vouch-for.md): its
on-device catalogue stays on the expense side, but no longer because every
scan the device reads is a purchase, and a row's grades now include one for
its type. Keeps 0147's rule that a row's type is explicit and never read from
a JavaScript sign. Applies
[0008](0008-universal-receipt-language-support.md)'s refusal of word tables to
the direction as it already applied to the amount;
[0146](0146-an-icon-that-carries-a-label-is-not-hidden-and-a-category-id-is-never-empty.md)'s
button pattern to the flag on the review card's type toggle, and its literal
`aria-hidden="false"` to the form's; and
[0149](0149-the-review-step-says-what-it-changed.md)'s rule that the review
step says what it changed to a category a flip or a merge moves. The Swift
schema and its TypeScript mirror ship in one commit, as
[0049](0049-the-model-never-sees-an-i18n-key.md)'s coupled pair does.

## Context

On iOS a receipt is read on the device by default: Vision recognises the
text, and Apple's foundation model structures it, or the regex parser does
when the model is unavailable or fails. Both lanes built their row with
`type: 'expense'` written in (`native-receipt.service.ts:169` and `:198`
before this change). Nothing between the text and that literal could say
otherwise: the parser had no notion of a direction, the model's schema had no
field for one, and the AI lane folded a negative total positive with
`Math.abs`. So a refund slip — a returned purchase, a cancelled ticket, any
credit — was imported as spending, and moved every total built on it the
wrong way by twice its amount until somebody flipped the row by hand.

The cloud's multi-image read already got this right. `multiImageReceipts`
asks for `"income"` on a credit or refund line, and consolidation nets a
receipt's lines and lets the net's sign set the row's type. The cloud's
single-image prompts are expense-only too, but the device's two lanes are
what an iPhone reaches first.

0147 had written the gap down as a premise rather than a gap: "Every scan it
reads is a purchase", so the on-device model was shown the expense side of
the catalogue.

Reading the doors for the fix found two places where an income row was lost
even when a reader produced one:

- **The form's Scan Receipt never applied the scanned type.** It filled the
  fields it had read and left the type wherever the form opened, which is
  Expense for a new transaction.
- **A flip on the review card kept the category.** `toggleType` changed the
  type and nothing else, the category menu listed both sides, and confirm
  writes the category as it stands, so a purchase on *Groceries* flipped to
  income was written under *Groceries*. A merge whose net turned the survivor to the other side
  kept the target's category the same way.

## Decision

**A receipt read on the device is filed as income when the receipt says the
money came back — the model's verdict on the AI lane, or on the regex lane,
where no model answers, a negative mark printed on the total itself — and
every such row is graded under the review bar, so the reviewer is asked. A
purchase nothing contradicts stays an expense with no type grade. Wherever a
row's type changes on the review card, its category is held to the side the
type now points.**

### The parser reads the marks on the total, never a word

`ParsedReceiptText` gains `direction`, `'credit'` or `'debit'`, and
`directionConfidence`. A credit is read from the marks a receipt prints on
the winning total's own figure, and from nothing else:

- a minus in any of the five forms OCR hands one back as (`-` `−` `–` `﹣`
  `－`), right before the figure or its currency sign, after the start of the
  line, a space or a colon, ASCII or fullwidth (`Total: -$120.50`,
  `合計：-¥1,280`);
- a minus right after the sign, the sign-first way of printing the same
  negative (`$-12.50`, `US$-5.00`);
- an East Asian accounting triangle, `▲` or `△`, glued to a label or spaced
  from it (`合計▲1,280`, `合計 ▲ ¥1,280`), but never straight after a digit;
- accounting parentheses around a figure that carries a sign or is written
  like money (`($12.50)`, `（¥1,280）`, `(12.50)`).

A sign may carry up to three capitals before it (`HK$`, `US$`), and only
capitals: a CJK or lowercase letter there is a word.

What is not a mark: the closing dash a Japanese receipt prints against
alteration (`¥10,000-`); the gap between a description and its price
(`Latte - $4.50`); a minus glued to a reference, a phone number or a row of
dashes (`SKU-1234`, `No.-123`, `03-3461-8901`, `----$12.50`); a triangle
straight after a digit, which joins two runs of digits as a dash does
(`Ref 12▲1,280`, `03▲3461▲8901`); parentheses around a count or a word
(`Points (100)`, `(税込¥1,280)`); and any mark on
another figure — a coupon, a discount, the change, a `(-$1.00 saved)` on the
total's own line. The mark is read against the figure, never the line.

**The figure stays unsigned.** `NUMBER_TOKEN` takes no minus, and the amount
is a positive magnitude whichever way the money moved. A minus inside the
token would make `toAmount` negative, and the zero-or-less skip that keeps a
`-$0.00` change line out of the candidates would then drop the refund's
total itself — and on the AI lane the two readers' totals would never agree.
A zero is never a candidate, so a zero can never be a credit.

**The twin rule.** A refund slip can repeat its total unmarked on the card
line, and a sale can print its tender line as a negative, so the direction is
read from every copy of the winning figure the receipt prints as money —
beside a currency, or written like money — within the half cent the
cash-tendered sum already allows, the winner included:

| The copies of the total | `direction` | `directionConfidence` |
|---|---|---|
| every one marked | `'credit'` | 0.5 (`CREDIT_MARK_GRADE`) |
| some marked, some not | `'debit'` | 0.3 (`TWINNED_MARK_GRADE`) |
| none marked, or no total read | `'debit'` | 0 |

An ambiguous total never becomes a credit. A total read from the plain
numbers has no money to compare with, so there every figure of its value is a
copy. The direction is read from the winner that survives the cash-tendered
demotion, not the note handed over.

`directionConfidence` is not folded into the combined `confidence`, so the
routing that compares the regex lane's confidence against `USABLE_CONFIDENCE`
does not move.

0008 forbids the parser a word table in any language, and this record reads
that as leaving it typography: a minus, a triangle and a pair of parentheses
look the same on a receipt in any script, and reading them is reading
structure, as the digits and currency signs already are. *REFUND*, *返品* and
*CR* are words, and the parser reads none of them.

### The model says purchase or refund

`ReceiptExtraction` in `AppleIntelligencePlugin.swift` gains a `kind`,
guided with `.anyOf(["purchase", "refund"])` and declared before `amount`.
The amount's guide gains `.minimum(0)` and now reads as the final total "as a
positive decimal number — what was paid, or on a refund what was given back".
The instruction says the same: the amount is the final total as a positive
number, for a purchase or a refund, "and the kind says which". It names no
language, lists no word and says nothing of minus signs, so the model and the
parser stay two witnesses rather than one reading twice. `call.resolve`
passes `kind` through.

The TypeScript mirror gains `kind?: 'purchase' | 'refund'`, optional like
`location` and `country` beside it, and the reader compares it strictly: any
other value counts as no verdict. The two halves ship in one commit, and in
one binary: the iOS app bundles its web assets (`capacitor.config.ts` sets no
`server.url`), so no native build ever runs a reader newer than its own
schema.

`Math.abs(extraction.amount)` stays, as a guard behind `.minimum(0)`. A
negative amount from the model is not a verdict on the type (0147); its
`kind` is.

### One verdict for both lanes

`typeVerdict(kind, printed)` in `native-receipt.service.ts` weighs the two
witnesses. The regex lane has no model and passes `kind` as nothing. On the
AI lane, the parser's reading is passed only when the parser's total and the
model's agree at the minor unit (`sameTotal`): a mark the parser found on a
figure the model did not answer says nothing about the model's total, so it
is treated as unmarked.

| Lane | The model's `kind` | The print on the row's total | `type` | `fieldConfidence.type` |
|---|---|---|---|---|
| AI | refund | marked | income | 0.6 (`AGREED_INCOME_GRADE`) |
| AI | refund | twinned or unmarked | income | 0.5 (`MODEL_INCOME_GRADE`) |
| AI | purchase | marked | expense | 0.3 (`DISPUTED_TYPE_GRADE`) |
| AI | purchase | twinned | expense | 0.3 (the parser's) |
| AI | purchase | unmarked | expense | — |
| AI | absent or unrecognised | marked | income | 0.5 (the parser's) |
| AI | absent or unrecognised | twinned | expense | 0.3 (the parser's) |
| AI | absent or unrecognised | unmarked | expense | — |
| Regex | — | marked | income | 0.5 (the parser's) |
| Regex | — | twinned | expense | 0.3 (the parser's) |
| Regex | — | unmarked, or no total read | expense | — |

A plain expense carries no `type` key at all: the grade is spread only when
there is one. `FieldConfidence.type` is new, and its absence means "nothing
said otherwise", not "unread". No cloud reader sets it.

### Why a fixed grade is honest

0147 asks that every grade on a row be one its door can defend. No reader
measures a direction — the model reports no confidence of any kind, and a
mark is printed or it is not — so the type grade is policy, and the policy is
that the device reading income is always asked about. Every income grade is
under `VERIFY_FIELD_THRESHOLD` (0.7), and so is every ambiguous expense.
[0045](0045-a-confidence-grade-names-its-source.md) rejected a flat 0.8
because it claimed more than the code knew and read as a confident chip. This
grade claims less: it can only send a row to review, never wave one through.
Agreement grades above a lone witness (0.6 over 0.5) to keep the order
honest, and both are flagged.

That is also why the flag's sentence carries no percentage. The amount and
date tooltips report the reader's own grade as one; the type's would report a
measurement nobody took. It has its own key, `import.verifyType`, called with no
parameters, on the card and in the form alike.

### The model's catalogue stays on the expense side

A refund slip lists the goods going back, and only expense entries name
them, so the model is still offered the expense side and its answer still
resolves over the expense entries. Its id rides on the income row, and the
camera's converter and the drain re-file it through `gradeCategorySuggestion`
with the row's own type: an income row naming an expense category lands on
`other_income` at 0.3, the grade for an answer that resolved to nothing. The
regex lane names no category (`categoryAttempted: false`), so its income row
lands on `other_income` at 0.1. The form leaves such a category blank
instead (below).

### The review card asks on the toggle

While `fieldConfidence.type` is under the bar, the trend icon inside the
card's `.type-toggle` swaps for the amber `error_outline` flag, the way the
date chip swaps its calendar icon. The flag icon is `aria-hidden="true"`,
literally, and the button's `aria-label` leads with the flag's sentence and
ends with *Income* or *Expense* — 0146's button pattern, so the toggle is
announced once. No new class and no new style: the button keeps its income or
expense colour, so the type stays legible beside the flag. A type flag does
not hold Continue.

`needsVerification` and `verificationTooltip` take `keyof FieldConfidence`,
and the type answers with its own branch ahead of the amount-or-date choice,
which would otherwise have worded it as a date.

### A flip answers the question, and the category follows

`toggleType` drops the type grade, as a date answer drops the date's, and
holds the category to the new side through `categoryOnSide`:

- a category the new side cannot hold moves to that side's catch-all, at the
  lower of what the row had and 0.3, so a move never grades a row higher —
  a catch-all nobody categorised stays at its 0.1, a hand-added row at 0;
- a category that fits both sides keeps its place and its grade, and so does
  one the catalogue does not hold, or a catalogue that has not loaded, since
  nothing shows it is on the wrong side.

The grader is the one the doors use, so the card cannot disagree with them
about which side an id sits on. A move is announced — *Category for
{description} changed to {category}* — because the chip it changed sits
elsewhere on the row from the toggle that was pressed, naming a blank row
*an untitled row* (0149). The rule holds for every row the card shows,
cloud-read ones included.

### The menu offers the row's own side

`CategorySuggestionComponent` takes the row's type as `rowType`, and the card
binds it. The menu lists the categories that fit that side, `'both'` ones
included; a row with no type is offered every side. The name, icon and colour
are still looked up in the whole catalogue, so a wrong-side category the row
already holds is named, never *Unknown*.

### Merge and split

`mergeImportRows` drops the type grade only when the two rows sat on opposite
sides. Then the net decides the direction, and the reader's doubt about which
way the target's figure went no longer bears on it; on one side the target's
grade rides through, as the date's does. It stays pure, with no catalogue to
judge a category by, so the card's `mergeInto` holds a survivor whose net
turned it to the other side to that side through `categoryOnSide`, and
announces a move. A net that stays on the target's side leaves the category
where it was. A split keeps the type grade on both halves: a split does not
touch the type.

### The form files an income reading and flags it

The in-form Scan Receipt files the scanned type when the reading is income,
or when the type standing in the form was filed by an earlier scan and the
user has not changed it since (`typeFromScan`). An expense reading never
overrides a type the user picked, the one the form opened with included.

- The type is patched before the category, so the category list follows it: an
  income category the reading named applies, and an expense one is not on the
  list and stays blank. The required field asks, as the form asks for any
  missing category; nothing prefills `other_income`.
- A flag stands beside the type toggle while the scan's type grade is under
  the bar: `role="img"`, a literal `aria-hidden="false"` and the type's
  sentence as its label. Any type change clears it, and the hold with it; the
  amount's and the date's flags stay.
- Discarding the photo withdraws the flag but not the hold. The type the scan
  filed is still standing beside the amount and description it read, and a
  purchase scanned next has to be able to take that income back.

### The drain writes the type as read

The offline drain writes the row's type as the device read it, and files the
category through the same grader, with no review step between. No code
changed there; its specs pin that a queued device refund lands as income on
`other_income`.

## What was rejected

- **Keyword tables** — *REFUND*, *返品*, *CR*. 0008, and the model is the
  reader of words.
- **Reading the type from a sign** — a signed `NUMBER_TOKEN`, or the model's
  negative amount. 0147's `-0` argument stands, and a signed token would have
  dropped the refund's total at the zero skip.
- **A boolean `typeAssumed` mark.** It carries no grade, the card's flags and
  `withoutFieldConfidence` already read `FieldConfidence`, and every row
  builder that names its fields would have needed teaching to carry it.
- **Flagging every device row.** A flag on every purchase is a flag nobody
  reads.
- **A percentage in the type's sentence.** It would report a reading nothing
  took.
- **Always patching the form's type.** The cloud single-image path hard-codes
  expense, so an Income the user had picked would be overwritten by a type the
  cloud never read.
- **Resetting the hold on a discard**, which would leave a purchase scanned
  next unable to take back a discarded refund's income, so it would be saved
  as income; and **restoring the pre-scan type on a discard**, which would
  move the type alone while the scan's amount and description stay.
- **Prefilling `other_income` in the form.** The form has no confidence dot to
  say a prefilled catch-all is a guess, so it would be saved by a user who
  never looked; the empty required field asks instead.
- **Filing under `other_income` › Refund.** 0147 files a row nobody could
  place under its side's catch-all, the child can be deactivated, and the
  menu lists top-level entries only.
- **Holding Continue on a type flag.** The toggle is the only answer the card
  has, and a reviewer who agrees with the reading has nothing to press; a gate
  would have needed a Keep of its own, as the date question has.
- **Dropping the type grade on every merge.** On one side the net decides
  nothing about direction.
- **A currency-code step in the mark reading**, which reviews of the first
  draft found misreading (`SALE ALL -$5.00` read as Albanian lek). The
  strategy service already substitutes the base currency and flags it.
- **Teaching the cloud single-image prompts a type now.** `receiptParse`,
  `receiptItems` and Gemini's `receiptSummary` are a prompt and a mapper
  change each, `receiptParse` across all three providers, and none of them is
  the device reading #464 is about.

## Consequences

- **A refund slip read on an iPhone is income** when the model says refund,
  or, on the regex lane, when the total prints as a negative: on the camera's
  review card on `other_income`, flagged on its toggle, and in the form as
  Income, flagged, with the category left for the user. A negative total the
  model calls a purchase stays an expense, flagged; a slip that says neither
  is still a purchase.
- **The reading reaches iOS users only with a new native build.** The app
  bundles its web assets, so neither the parser and the verdict nor the Swift
  `kind` arrive by a web deploy. A merge delivers the card's flip, menu and
  merge rules at once, for every row the card shows — cloud-read rows on the
  web included — and the flag's code, idle on the web, where no reader grades
  a type.
- **A confirmed refund overwrites its merchant's remembered category.**
  Category memory is keyed by merchant (`category-memory.service.ts:80-84`),
  and confirm remembers every selected row's category
  (`ai-import.service.ts:1654-1659`), so a refund filed under `other_income`,
  flipped or not, replaces the purchase category remembered for that shop.
  The next purchase there on a door that asks memory finds the answer on the
  other side, passes it over (0147) and asks the provider, or lands on its
  catch-all at 0.1 when none is configured.
- **Every on-device row carries up to three grades.** A plain purchase still
  carries two.
- **The card's type toggle carries an `aria-label`** on every row, flagged or
  not. Unflagged it is the type the button shows, the name its text already
  gave it.
- **A flip or a cross-side merge can move a category**, and says so. A
  reviewer who wanted a category of the other side on a row flips the type
  first; the menu no longer offers it.
- **The Swift half is compile-checked only.** `AppTests` does not compile the
  plugin ([0040](0040-the-native-seams-answer-to-xctest.md)); an `xcodebuild`
  of the app target does, and `canImport(FoundationModels)` is true on the SDK
  it builds with, so a wrong guide type fails the build rather than compiling
  to the stub. The simulator run called it but never saw it answer (Known
  gaps).
- **Two catalog keys** in en, ja and tc: `import.verifyType` and
  `import.announceCategoryRefiled`.
- **No rule, index or stored field changes.** `fieldConfidence` never reaches
  a document, since the mapper names its fields.

## Departures from the issue

- **The flag's record is 0147, not 0146.** The issue asked whether a refund
  deserves "the verification flag the amount and date already use (ADR
  0146)". 0147 is the record that grades a row by what its door can vouch
  for; 0146 governs the flag's accessible name, and is applied here for that.
- **The door matrix lives in `import-fields.md`.** The issue asked for a line
  in `receipt-import.md`'s door matrix. The matrix gains a row, and
  `receipt-import.md` says door by door which receipt paths can emit an income
  row, which is what its acceptance line asks.
- **The routing the issue cites is the cloud's.** `ai-import.service.ts:777-781`
  (as the issue numbered it), which sends a refund line named for the purchase
  side to the ladder, is the cloud multi-image path that the wizard's photos
  and the camera's fallback take. A device row never reaches it; the camera's
  converter and the drain re-file it through `gradeCategorySuggestion`
  instead.
- **No refund keyword.** The issue listed *refund*, *return*, *credit* and
  *void* among what the parser does not look for. It still does not: the
  model reads words, and the parser reads marks.
- **An unmarked direction is not graded.** The acceptance line asks that "an
  unreadable or ambiguous direction is graded rather than assumed". An
  ambiguous one is: a total printed both ways, or a purchase the print
  disputes. A total nothing marks stays an ungraded expense, by the user's
  decision — grading it would flag every receipt.
- **The doors were widened.** The issue was about the reading. The card's
  category on a flip and its menu, and the form's Scan Receipt, were added at
  the user's request. Four rules go further than that request: a merge that
  turns the survivor to the other side re-files its category as a flip does;
  the form takes back an income a discarded scan filed; the form's type flag
  clears on any type change, as the card's does on a flip; and a merge across
  sides drops the type grade, the weakest of the four and the easiest to take
  back.

## Things that only became apparent while building

- **A time can share the total's value.** The slip's `14:32` holds a plain
  14, and on a refund of exactly `-$14.00` the first twin rule counted it as
  an unmarked copy, which turned a credit into an ambiguous purchase. Twins
  now count only the figures printed as money when the winner is one.
- **A triangle is often spaced from its figure**, by an ASCII or an
  ideographic space, and the first rule read `合計 ▲ 1,280` as a purchase. A
  space after a minus is the gap between a description and its price
  (`Latte - $4.50`), so the minus still takes none; a triangle is never a
  description's dash, so it now may.
- **The form's discard had to leave the hold standing.** The first design
  cleared it with the photo, and a purchase scanned after a discarded refund
  would then have been saved as income, since an expense reading may only
  move a type a scan filed.
- **A type change on the card re-runs the duplicate check.** Import stays
  disabled until it settles, but `confirmImport()` called directly does not
  wait, so the emulator suites wait for the re-checks to settle before they
  confirm a flipped row.
- **The review card was too narrow on a phone**, and had been before any of
  this. The browser run of the flags found its content column 141px wide at
  375px — Material's 24px of step padding on top of the wizard's own 16px —
  with every chip on a line of its own. A phone rule trims Material's padding
  on the stepper's content to the 5px a focus ring needs inside its clip, and
  takes those back out of the wizard's gutter (card 273px, content 189px).
  Karma's window is 756px wide, so no spec can apply the media query;
  journey 79's 375px step in [../e2e.md](../e2e.md) measures it.

## Known gaps

- **The cloud single-image prompts stay expense-only.** `receiptParse`, read
  through `convertParsedReceipt` by the in-form scan and the drain off the
  device; `receiptItems`, Gemini's read of a single photo on the camera and
  wizard paths; and Gemini's `receiptSummary`. A refund read there lands as an
  unflagged purchase.
- **The drain writes unreviewed**, and keeps an expense id a device refund
  named while the account's catalogue has not loaded
  (`categorization.utils.ts:227-233`), since an empty list cannot show it is on
  the wrong side.
- **A `purchase` verdict over a marked print with a different total is an
  unflagged expense.** The print is ignored because it speaks of another
  figure; the amount is flagged when the parser's own grade is at least 0.7,
  and the type is not.
- **A second flip does not bring a moved category back.** A purchase on
  *Groceries* flipped to income and back lands on `other_expense`, the
  catch-all of the side it returned to.
- **A same-value figure on a priced line counts as a copy.** A size of
  `10m -$10.00` on a slip whose total is `-$10.00` reads as a copy of the
  total, unmarked, so the refund is an ambiguous purchase, flagged — the safe
  side, but a miss.
- **Misses.** `合計-1,280` (a minus glued to a label), `(-12.50)`, `=-12.50`,
  and a minus Vision dropped all read as a purchase.
- **False credits.** A lone `(¥1,280)` restatement that wins its tier, or a
  `Points (1,250)` line on a receipt that prints no currency sign, reads as a
  credit. Each lands as flagged income, never silently.
- **The simulator never showed the AI lane answering.** On the iPhone 17 /
  iOS 26.2 simulator the on-device model failed every request
  (FoundationModels `GenerationError` -1), so every scan fell back to the
  regex lane. That lane's answers matched the table: `refund.png` was income
  on `other_income`, flagged; `refund-tender.png` an expense, flagged; and
  `jp.png` an expense with no type flag. The Swift `kind` was built and
  called, but its verdict was never seen; the AI lane rests on the unit specs
  and the compile check.
- **The type grade is in neither analytics nor Import History.** A refund
  read on the device, and how often a reviewer flips one back, are invisible
  past the review step.
- **The form's centred toggle group shifts** by the flag's width when the flag
  appears.
- **A merge on one side leaves a wrong-side category where it was.** The
  re-file runs only when the net changes sides, so a target that already held
  a category of the other side — one kept while the catalogue had not loaded —
  keeps it through a same-side merge.
