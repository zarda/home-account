# 185. A refund is asked about at every door, and a category follows its row's side there and back

**Status:** Accepted, implemented · **Date:** 2026-10-27 · **Issues:** #464

Reference documentation lives in [../receipt-import.md](../receipt-import.md),
[../import-fields.md](../import-fields.md), [../prompts.md](../prompts.md),
[../accessibility.md](../accessibility.md),
[../ui-overflow.md](../ui-overflow.md) and [../analytics.md](../analytics.md).

[0162](0162-a-refund-read-on-the-device-is-filed-as-income-and-the-review-asks-about-it.md)
taught the device to read a refund and the review to ask about it, and wrote
down eleven Known gaps; #464 stayed open on them. This record takes four
groups of those gaps: the cloud readers, which never asked which way the
money moved; the form and the review card, where a change of side lost a
category it could have kept; the parser's misses and false credits, with a
purchase the print argued with that nothing flagged; and the type grade,
which nothing past the review step could see.

Closes six of [0162](0162-a-refund-read-on-the-device-is-filed-as-income-and-the-review-asks-about-it.md)'s Known gaps and narrows two.

It re-examines two more, the priced-line copy and the false credits, and
keeps their readings on the evidence under *What was rejected*. The
simulator run 0162 recorded is left as it was.

Amends
[0162](0162-a-refund-read-on-the-device-is-filed-as-income-and-the-review-asks-about-it.md)
and [0147](0147-a-row-is-graded-by-what-its-door-can-vouch-for.md). Their
rules stand: the type is explicit and never read from a sign, the parser
reads marks and never a word, a row is filed on its own side, and every
grade is one its door can defend. What changes is who grades a type. 0162
set the type grade on the device alone and recorded that no cloud reader
sets one; every cloud receipt reader now grades an income reading the same
way, from one constant. 0162's form flag no longer stands beside the toggle
as an image; a flip back brings back what the first flip moved; a merge holds
the survivor's category to its side whichever side the net lands on; and a
purchase the model read over a negative printed on another total is flagged.
0162 also rejected teaching the cloud single-image prompts a type, and this
record does it.

Applies [0008](0008-universal-receipt-language-support.md) to the parser's
minus, which may now follow a Han or Hangul label: naming two scripts is
typography, not a word table, and no prompt lists the words a refund slip
prints, in any language: the type is defined, not matched. Applies
[0139](0139-a-transaction-read-acted-on-once-names-its-source-and-a-listeners-first-value-is-banned.md)'s
rule that a read acted on once names its source to the catalogue the receipt
resolver and the drain act on: the account's once it has loaded, the shipped
one until then, never an empty listener cache taken for the account's
answer. Applies [0145](0145-a-class-found-by-reading-becomes-a-gate.md) to
four classes found by reading: the loose type default, a flag tooltip the
keyboard cannot reach, a taxonomy parameter the docs do not list, and a
record count with no tile. Applies
[0146](0146-an-icon-that-carries-a-label-is-not-hidden-and-a-category-id-is-never-empty.md)'s
button pattern to the form's type flag, now inside its segment. Applies
[0149](0149-the-review-step-says-what-it-changed.md) to the form's cleared
and restored category, the card's restored one and the catalogue's late
arrival. Applies
[0171](0171-second-copies-fold-into-one-copy-of-each-helper.md) to the model
income grade, the per-field grade builder, the review bar's test, the shape
of a completed import and the parenthesis classes, each folded to one copy,
and to the card's side test, built on the doors' own grader.

## Context

The cloud gap was wider than one missing word. `receiptParse` — the form's
Scan Receipt off the device, and the offline drain — never asked for a type,
and `convertParsedReceipt` wrote `type: 'expense'` whatever came back
(`ai-strategy.service.ts:708` before this change). Gemini's `receiptItems`,
its read of a single photo on the camera and wizard paths, asked for expense
lines only, and its `receiptSummary` wrote an expense too.
`multiImageReceipts` did ask for a type on each line, and consolidation nets
a receipt's lines into a row whose type follows the net, but no mapper graded
the answer: its refunds reached the card as unflagged income, where the
device's were flagged.

Reading for the type found it read loosely in five places: four
`t.type || 'expense'` in the statement, multi-image, Gemini item and
categoriser mappers, and `(t['type'] as …) || 'expense'` in the backup door.
`||` keeps any truthy answer, so a model's `"Income"` went on as the row's
type. Consolidation run in memory added such a line to the receipt's total
instead of taking it off, and a lone one reached confirm typed by a word
`firestore.rules:108` refuses.

The review leftovers were 0162's own. A second flip landed on
`other_expense` rather than bringing *Groceries* back. A merge on one side
kept a wrong-side category. The form's centred toggle group slid sideways by
the flag's width whenever the flag appeared beside it. And the form blanked
a category the new side could not hold silently, and forgot it, so a type
tapped by mistake cost the user a category they had chosen. The drain's
wrong-side id turned out to have a single source: `receiptParse`'s resolver
read the account's catalogue, empty until the listener answers, and resolved
every name to `other_expense` against the empty list.

The parser read `合計-1,280`, `(-12.50)` and `=-12.50` as purchases: a minus
counted only after the line's start, a space or a colon. And `typeVerdict`
passed the parser's reading only when the two totals agreed, so a negative
printed on a total the model did not read reached nobody, and the purchase
went unflagged.

Past the review step, nothing kept the type flag. Reading Import History for
a place to show it found two counts the record already carried and the page
never drew, `receiptsSkipped` and `receiptsFailed`, and a duplicates tile
labelled *Skipped*. Reading analytics for one found the console setup's
dimension list without `action`, which two events already send.

## Decision

**Every receipt reader is asked which way the money moved, and its answer is
read strictly: exactly `income` is a refund, graded for review wherever it
was read, and anything else is a purchase. The form and the review card hold
a row's category to its side through every change of side, and give it back
on the way back. The parser reads three more ways of printing a negative,
and a purchase the print argues with is flagged. A reviewer's answers to the
type flag are counted on the import record, shown on Import History and
reported to analytics.**

### The cloud readers say purchase or refund

**One reader, one grade, one carrier.** `receipt-extraction.utils.ts`, beside
`readFieldConfidence`, holds the three helpers every cloud lane uses:

- `readTransactionType(value)` returns `'income'` for exactly the string
  `"income"` and `'expense'` for anything else — another casing, a synonym,
  a number, nothing;
- `modelTypeGrade(type)` returns `MODEL_INCOME_GRADE`, 0.5, for income and
  nothing for an expense, so a purchase carries no `type` key and absence
  still means "nothing said otherwise";
- `extractedFieldConfidence(row, dateGrade)` builds a row's
  `FieldConfidence` from conditional spreads, or returns `undefined` when
  nothing was graded. It replaces three hand-built copies, in
  `ai-strategy.service.ts` and twice in `ai-import.service.ts`, which is how
  a new grade would have reached one lane and not the others.

`MODEL_INCOME_GRADE` moved there from `native-receipt.service.ts`, so the
device and the cloud grade a model's refund from one constant.
`AGREED_INCOME_GRADE` and `DISPUTED_TYPE_GRADE` stay on the device, where
the second witness is. The parser's `CREDIT_MARK_GRADE` has the same value
and is not folded in: it names a different witness, a mark on the paper
([0045](0045-a-confidence-grade-names-its-source.md)).

**Where the grade is decided.** No single chokepoint exists: a
`receiptParse` row never passes consolidation, a multi-photo row never passes
`convertParsedReceipt`, and `categorizeTransactions` is shared with
statements and CSV. So the policy is the one function above, called at the
three points that already decide each lane's type:

- `parseReceipt` in the shared cloud base, for `receiptParse`, whose
  `ParsedReceipt` gains a required `type`, which `convertParsedReceipt` now
  passes on;
- `consolidateReceiptItems`, for a lone line's type or a merged receipt's
  net. That is the app's verdict, never the model's: a grade the extraction
  brought on a lone line is dropped and set again from the line's own type,
  and a purchase with a refund line inside still nets to a purchase,
  ungraded;
- Gemini's `extractTransactionsFromImage`, for `receiptSummary`.

Every later step only carries the grade. A row headed for the categoriser
carries it as a flat `typeConfidence?` on `ExtractedTransaction`, which
`extractedFieldConfidence` turns into `fieldConfidence.type`. Statements and
backups get the strict type and never a grade.

**The loose default is a gate.** All five loose sites go through
`readTransactionType`, and an ESLint `no-restricted-syntax` selector bans the
shape: an `||` whose right side is the literal `'expense'` or `'income'` and
whose left side is a member named `type`, read directly or through an `as`
cast. Its message names `readTransactionType`. It is appended to the app
block's array, the block whose comment already says to append there, because
a second block would replace the array wholesale; and it is restated in the
analytics-transport block, the one later block that replaces that array under
`src/app`. `scripts/check-lint-guards.mjs` carries its own copy of the
selector string, not an import, so drift shows as a mismatch, and checks it
in both directions on both rows; the spec row's unexpected-selector direction
proves it never reaches a spec. Its `--self-test` hits
`t.type || 'expense'` at an app path once, and leaves
`t?.type || 'expense'`, `t.type ?? 'expense'` and the hitting form in a
`*.spec.ts` alone.

**The prompts ask.** One fragment, `RECEIPT_TYPE_FIELD`, follows
`RECEIPT_COUNTRY_FIELD` in `receipt.prompts.ts` and is used by all four
receipt prompts:

> `"income" for credits/refunds — money given back to the customer —
> "expense" for purchases/debits, whatever the payment method is called`

The clarifier is deliberate: receipts print the payment method as *CREDIT*
or *クレジット*, and the drain writes unreviewed, so the bare word "credits"
could file a card purchase as income.

- `multiImageReceipts` uses the fragment in place of its own words, so the
  clarifier changes its text too.
- `receiptParse` gains `"type": "<income or expense>"` in its JSON skeleton,
  before the amount, the order 0162 gave Swift's `kind`. Its amount bullet
  keeps its opening words and continues *on a refund, the total given back.
  Always a positive number: "type" says which way the money moved.* Its
  defaults line gains `type="expense"`.
- `receiptSummary` does the same with `totalAmount`.
- `receiptItems` asks for each item's price as a positive number and for
  `type` by the fragment, while its two example rows keep
  `"type":"expense"` as the shape of an answer.

`statementTransactions` keeps its own credits-and-deposits wording: a deposit
on a statement is not a refund. Token budgets and `since` are unchanged.

**What does not change.** The form and the drain are source-blind: they read
`type` and `fieldConfidence` whatever produced them, so a cloud refund is
filed and flagged there with no code of its own. The form's asymmetry stands:
an expense reading never overrides a type the user picked, because a strict
expense includes "no answer".

**The shipped catalogue until the account's loads.**
`CategoryService.categoriesOrDefaults()` returns the account's catalogue when
it is non-empty and the shipped one otherwise. `loadCategories` always merges
the built-ins in, so non-empty means loaded. The cloud base's
`mapCategoryNameToId` wrapper, whose one caller is the receipt read, and the
drain's `gradeCategorySuggestion` read it. A cloud refund named *Groceries*
while nothing has loaded now resolves to `food_groceries`, and the drain
grades that onto `other_income` at 0.3, as it would with the catalogue
loaded.

### The form and the card keep a row on its side, there and back

**The form's flag takes the checked segment's icon.** While the scan's type
grade is under the bar, the checked segment shows the amber `error_outline`
flag in place of its trend icon, as the card's toggle does. The flag is
literally `aria-hidden="true"` and carries the tooltip, and the segment's
`aria-label` leads with the flag's sentence and ends with *Income* or
*Expense* (`typeButtonLabel`, which mirrors the card's `typeToggleLabel`).
The label goes through MatButtonToggle's `[aria-label]` input, which reaches
the inner `<button>`; `[attr.aria-label]` would land on the host, which
Material nulls. `flagsType(type)` is true for the checked segment while the
type is doubted. The sibling flag beside the group is gone, and the flag
takes the icon's own 24px box, so the group and the checked label do not
move when it appears: the group stays at its 320px cap in the 500px dialog
and fills a phone's narrower column (316px at 375px in journey 104), the
same with the flag and without it. Tapping the flag inside the checked segment
changes nothing; 0162 already said a reviewer who agrees has nothing to
press. `contrast:check` scores the flag on both segment fills at 3:1:
`--color-warning-text` on `--color-expense-light` and on
`--color-income-light`, 4.11 and 4.57 in light, 6.95 and 4.95 in dark.

**The form remembers the category a type change cleared.**
`categoryBlankedByType` holds the category a type change blanked. It is set
before the field is patched, so the patch's empty value does not clear it,
and any category chosen afterwards ends it. In the type handler, a category
the new side cannot hold is blanked and announced —
*Category cleared: {category} is not offered for this type*
(`transactions.categoryClearedForType`) — and an empty field whose held
category fits the side the type has come back to is given it again and
announced — *Category set back to {category}*
(`transactions.categoryRestoredForType`). A scan that moves the type and
names a category for the side it lands on ends the hold silently, since its
own category is the newer answer; one that names none leaves the hold, and
the held pick comes back, aloud. Nothing prefills `other_income`, still for
0162's reason.

**The card remembers what a change of side moved.** `movedCategory`, a
review-step mark that is never written, holds the category and grade a
change of side moved off a row. `categoryOnSide` answers in this order:

1. a mark that fits the target side is restored at its grade, and the mark
   is cleared;
2. otherwise a row category that fits is kept, with the mark;
3. otherwise the category moves to the side's catch-all at the lower of what
   it had and 0.3, and the mark records the id and grade it left.

`fitsSide` asks `gradeCategorySuggestion` about the id alone, at confidence
0, so the card still has one grader, the doors'. An id the catalogue does not
hold, and a catalogue that has not loaded, fit, as before. A pick clears the
mark (`updateCategory`). A split carries it to both halves, as it carries
the type grade. A merge keeps the target's mark when both rows sit on one
side and deletes it across sides; the source's never rides. A restore is a
change of id, so it is announced with the sentence a move already used,
*Category for {description} changed to {category}*, naming the category
that came back.

**A merge holds the survivor whichever side the net lands on.** `mergeInto`
files the survivor through `categoryOnSide` every time, not only when the net
changes sides, and announces when the id changes. A survivor still holding
the other side's category is re-filed on the side it stays on, as a flip
files it.

**The catalogue's arrival holds every row.** `@Input() categories` became a
setter over a private catalogue. When the catalogue goes from empty to
non-empty, `holdRowsToTheirSides()` runs every row through `categoryOnSide`
on its own type, keeps each untouched row's identity, and, if anything moved,
replaces the rows, emits them and marks the card for check. No row is marked
edited: the move is not the reviewer's work. It is said once, without a
count — *Rows filed under the other side's category moved to this side's
catch-all now that your categories have loaded*
(`import.announceCategoriesRefiledOnLoad`) — and only once the view has
initialised: on the first binding the card simply opens with each row on its
side. After the arrival, the merge's re-file is the guard for a catalogue
that changes once loaded, a category edited in another tab.

**The flags' sentences open from the keyboard.** The three self-named flags
that carry a tooltip — the form's amount and date flags and the card's amount
flag — gain a literal `tabindex="0"`: MatTooltip opens on focus, and an icon
takes none by itself. A fifth `icon-labels:check` rule holds the class: a
`mat-icon` with a `matTooltip`, a name and a literal `aria-hidden="false"`
carries a literal `tabindex`, unless an `<ng-template>` is open around it.
The exemption is the wizard's seal icon, stamped into a step header that is
the `role="tab"` control and already the tab stop. The type flags are hidden
icons inside a control that takes focus and names itself, and stay out of the
tab order.

### The parser's marks, and the purchase the print argues with

**A minus may follow a CJK label, an opening parenthesis or an equals sign.**
`MINUS_FOLLOWS` replaces the `[\s:\uFF1A]` before a minus in
`NEGATIVE_BEFORE`'s first alternative with a space, a colon or an equals
sign (each also fullwidth), a Han or Hangul letter, or an opening
parenthesis. `合計-1,280`, `합계-5,900`, `(-12.50)` and `=-12.50` read as
credits. The two parentheses are source constants, class bodies without
their brackets, so `OPENS_BEFORE`, `CLOSES_AFTER` and the minus rule share
one copy. Only the opening one goes in: after a closing one, the area code
of `TEL (03)-3461` would read its number as a credit. The triangle and
sign-first alternatives are untouched.

Two scripts are named rather than a class of letters. `\p{Lo}` would take in
kana, and Vision hands the katakana long-vowel mark back as `-`, so
`コーヒ-480` would become a credit. A minus glued to kana, Thai, Arabic,
Hebrew or Devanagari stays a miss (*Known gaps*).

The rule matters on a joined line, where a label and its figure are one
observation. Vision writes each observation it recognises on a line of its
own (`VisionOCRPlugin.swift:128-148`), so a label recognised apart from its
figure arrives alone, the minus opens the figure's line, and the old rule
read it already. On such split lines the Han and equals widening is moot,
and only `(-12.50)` still needs the new rule.

**A negative on another total flags the purchase.** `typeVerdict` gains
`markedElsewhere`, checked after the twin branch: when it is set the verdict
is an expense graded `DISPUTED_TYPE_GRADE`, 0.3. Its caller passes it when the
model read a total at all, the parser's total differs from it, and the
parser's total prints as a credit. The refund branch still runs first, so a
refund over another total stays income at 0.5. Only a credit counts: a
figure printed both ways elsewhere is the print arguing with itself about
something else. 0162's table gains two rows:

| Lane | The model's `kind` | The print | `type` | `fieldConfidence.type` |
|---|---|---|---|---|
| AI | purchase | a negative on another total | expense | 0.3 (`DISPUTED_TYPE_GRADE`) |
| AI | absent or unrecognised | a negative on another total | expense | 0.3 (`DISPUTED_TYPE_GRADE`) |

A model that answered no amount is already flagged on its amount and gains
nothing here.

**The other readings are kept, and pinned.** The priced-line copy, the lone
restatement, the labelled parenthesised figure and the points line read as
they did, each held by a spec that names it as a known gap, beside the rule
that would move it (*What was rejected*).

### The type grade outlives the review

**One helper says whether a grade asks.** `gradeNeedsVerification(grade)`,
beside `VERIFY_FIELD_THRESHOLD`, is true for a grade under the bar. It folds
the copies in `resolveImportDate`, the form and the card.

**A flip files the type the reader flagged.** A flip drops the type grade, as
0162 decided, and the grade was the only record that the reader doubted the
row. So `typeFlaggedAs`, a review-step mark that is never written, keeps the
side that was flagged. In `import-review.utils.ts`:

- `readerFlaggedType(row)` is the filed verdict, or, while the question is
  open, the row's own type when its grade is under the bar;
- `answerTypeFlag(row)` drops the grade and files the verdict, and
  `toggleType` spreads it. The first verdict stands through a second flip;
- `countTypeAnswers(rows)` returns `{ typesFlagged, typesFlipped }`: a row is
  flagged when its reader flagged it, and flipped when it now stands on the
  other side. A row flipped and flipped back is flagged and not flipped.

A split keeps the mark on both halves, so each half counts. A same-side merge
keeps the target's mark; a cross-side merge deletes it, since the net decides
the side afresh, and the survivor counts as neither.

**The record keeps the counts.** `ImportCompletion`, a `Pick` of
`ImportHistory`, replaces the two inline shapes the importer built and the
history service took. It gains `typesFlagged` and `typesFlipped`, counted over
the rows the write took and written only when above zero.
`import-history.model.ts` now says what was true already: the form's
multi-receipt review writes a record, door `form`; the form's single scan and
the drain write none. `firestore.rules` holds the two fields to whole counts,
`int >= 0`, when present. No rule makes the flipped count at most the flagged
one: one pass derives both.

**Import History shows them.** A record's card draws a tile for each count
it carries: *Photos not attached* and *Photos not uploaded* for
`receiptsSkipped` and `receiptsFailed`, whose figures are in
`--color-warning-text` like the duplicates figure, and *Type flagged* and
*Type changed* for the two new counts, in `--text-primary`. The duplicates
tile reads *Duplicates skipped*, and `import.skipped`, which nothing else
read, is removed in a commit of its own
([0048](0048-a-dead-capability-is-removed-not-guarded.md)). A tile's text is
centred and its caption may break at the tile's edge, so a two-line caption
sits over its figure and a missing translation never pushes the card wide.
`contrast:check` gains the three figure pairs the tiles already painted on
`--surface-muted`. A compile-checked spec makes a gate of the class: every
optional count a completed record can carry has a tile.

**Analytics reports them.** A new event, `receipt_confirm`, since
`26.10.180`, carries `path` (`camera`, `wizard`, `form`), `engine` in
`receipt_import`'s values, and `type_flagged` and `type_flipped`, each
`none`, `one` or `several`, never the count.

- `buildReceiptConfirmPayload` sits beside `buildReceiptImportPayload` and
  reuses its `engineOf`. It takes the door as `Exclude<ReceiptDoor, 'queue'>`,
  the only compile-time guard, since the taxonomy types `path` as a plain
  string. `AnalyticsService.trackReceiptConfirm` sends it.
- The wizard sends it after the record is read back, only for a batch that
  held a receipt photo, once per confirm round, partial rounds included. It is
  sent outside the success-or-failure branching and in a `try` of its own, so
  an analytics throw can never relabel rows that landed as a failed import.
- The form's save of a new transaction its scan filled sends it with path
  `form`. The scan's grade does not outlive a type change, so the side the
  reader flagged is filed when the scan lands, and the save counts it against
  the type saved through `countTypeAnswers`.
- A refused confirm, a failed read-back, a manual or edited save, a discarded
  or failed scan and the drain send nothing.

`analytics:check` holds the docs to the taxonomy's parameters as it held them
to its events: every parameter needs a row in the Parameter values table and
a place in the console setup's list of custom dimensions, and a name in
either that no event declares fails. The list was found missing `action`.

## What was rejected

- **Vendor structured-output schemas.** Swift's `.anyOf` guide is what 0162
  used on the device. On the cloud it would be three mechanisms — Gemini's
  response schema, OpenAI's JSON schema, Claude's tool input — for a prompt
  the registry renders once, and provider variation belongs to the transport
  ([0025](0025-provider-variation-lives-in-the-transport-seam.md)). The
  strict reader already turns every answer into one of two values; a schema
  would only move the refusal of a third into each vendor, with its own
  failure when the model strays.
- **Reading the sign.** Every cloud amount stays a magnitude, and every
  prompt now says so. A model that prints a refund's total negative has said
  nothing its `type` did not, and reading the sign would make the amount a
  second, unasked answer about the direction. 0147's `-0` argument stands.
- **A case-folding or synonym reader.** Folding `"Income"`, or taking
  `"refund"` or `"credit"` as income, reads answers the prompt never offered,
  and *credit* is the payment-method word the clarifier warns about, on a
  door that writes unreviewed. This is the strict reading 0162 gave its
  `kind`, which counts anything but its two words as no verdict, and it rests
  there, not on 0008, which governs what the app reads off a receipt.
- **The parser's marks over the model's transcription.** `receiptParse`
  returns the receipt line by line in `receiptDetails`, and the regex parser
  could read marks off it as it reads Vision's text. But that text is the
  model's own transcription: a minus it dropped or added is the model reading
  again, not a second witness, and a twin rule over lines it reformatted
  would grade it as though it were the paper.
- **Grading statements.** A deposit is an ordinary statement line, and a
  flag on every one is a flag nobody reads.
- **A model-reported type confidence.** No reader measures a direction; a
  number the model reports for one would claim what nothing took, which 0045
  refuses. The grade stays policy: an income reading is always asked about.
- **Bumping `since`.** A registry entry's `Since` dates the prompt id, not its
  wording.
- **A reserved or absolutely placed flag slot.** Beside the group, it does
  not fit at 375px: the group fills the form's 316px column there (journey
  104), which leaves no room for a 24px flag beside it.
- **`role="img"` inside the segment.** A named image inside a button is
  spoken as part of the button's own content; 0146's button pattern hides
  the icon and lets the button's name say the sentence once.
- **A focusable type flag.** A tab stop inside a toggle segment is a
  focusable element nested in a button, and the segment already takes focus
  and says the sentence. Its cost is a known gap.
- **A drain unknown-id rule.** Filing an id the catalogue does not hold onto
  the row's catch-all had no production path once the drain reads the
  shipped catalogue, and it would contradict the card's pinned rule, which
  keeps such an id because nothing shows it is on the wrong side.
- **`\p{Lo}` before a minus.** It takes in kana, and `店 / アイスコーヒ-480 /
  合計 480` (a `/` is a line break) reads twinned at 0.3, a purchase made
  doubtful by its own coffee.
- **The copy and restatement rules, and the parentheses cap (M1–M3).** M1
  keeps a copy of the total only when it carries its own sign or is written
  like money. M2 reads a total marked by parentheses alone, beside an
  unmarked figure printed as money and at least half its value, as a
  restatement: a purchase graded 0.3. M3 asks unsigned parentheses for a
  decimal fraction before they mark a credit. Each was run over a battery of
  60 receipt texts, 31 refunds and 29 purchases, on joined lines and with
  every label split from its figure, against the parser as shipped.
  *Corrections* counts a wrong type and a wrong amount once each; a *silent*
  row is wrong with neither the amount nor the type flagged.

  The battery names its refunds R and its purchases P. The ones named below
  read, with `/` for a line break and the shop's name and date left out:

  - R6 `RETURN / Jacket 59.99 / Tax 4.80 / Total (64.79)` and R7
    `Jacket $59.99 / Tax $4.80 / Refund total ($64.79)`: refund slips that
    put only the total in parentheses.
  - R10 `商品 (1,180) / 消費税 (100) / 合計 (1,280)`, R11 `合計 (1,280)` and
    R12 `취소 / 카페라떼 (5,900) / 합계 (5,900)`: sign-less JPY and KRW
    refunds in parentheses with no currency mark.
  - R16 `合計-¥1,280`, R19 `Total (-$12.50)`, R22 `合計（-¥1,280）` and R28
    `返品 / おにぎり-¥168 / 合計-¥168`: a minus glued to a label or opened by
    a parenthesis.
  - R23 `REFUND / Mooring rope 10m -$10.00 / TOTAL -$10.00`, R24
    `Rope 10m -10 USD / TOTAL -10 USD`, R25 `Cable 1m -$1.00 / Total -$1.00`,
    R26 `2 pcs -$2.00 / Total -$2.00` and R32 `ロープ 10m -¥10 / 合計 -¥10`:
    a size on a priced line equal to the total.
  - P1 `合計 ¥1,180 / (¥1,280)`, P5 `合計 1,180 / (1,280)`, P6
    `Jacket $59.99 / Was ($79.99) / Total $59.99`, P7
    `定価(¥1,580) / 割引 -¥300 / 合計 ¥1,280` and P12
    `合計 ¥1,180 / （¥1,298）`: purchases beside a larger figure in
    parentheses.
  - P8 `Total $12.50 / (Reg $15.00)` and P44
    `Total $4.50 / You saved (-$5.00)`: a regular price and a saving in
    parentheses.

  Joined lines:

  | Parser | Refunds: credit / 0.3 / debit 0 (of 31) | Purchases: debit 0 / 0.3 / credit (of 29) | Corrections | Silent rows |
  |---|---|---|---|---|
  | before this record | 16 / 6 / 9 | 19 / 1 / 9 | 36 | R16, R19, R22, R28, P8, P44 |
  | shipped | 24 / 7 / 0 | 16 / 1 / 12 | 31 | P8 |
  | M1 | 29 / 2 / 0 | 16 / 1 / 12 | 26 | P8 |
  | M2 | 22 / 9 / 0 | 16 / 6 / 7 | 28 | P8 |
  | M1 and M2 | 27 / 4 / 0 | 16 / 6 / 7 | 23 | P8 |
  | M3 | 21 / 7 / 3 | 20 / 1 / 8 | 30 | P8 |

  Split lines:

  | Parser | Refunds: credit / 0.3 / debit 0 (of 31) | Purchases: debit 0 / 0.3 / credit (of 29) | Corrections | Silent rows |
  |---|---|---|---|---|
  | before this record | 20 / 2 / 9 | 19 / 1 / 9 | 32 | R16, R19, R22, R28, P8, P44 |
  | shipped | 28 / 3 / 0 | 16 / 1 / 12 | 27 | P8 |
  | M1 | 29 / 2 / 0 | 16 / 1 / 12 | 26 | P8 |
  | M2 | 26 / 5 / 0 | 16 / 6 / 7 | 24 | P8 |
  | M1 and M2 | 27 / 4 / 0 | 16 / 6 / 7 | 23 | P8 |
  | M3 | 25 / 3 / 3 | 20 / 1 / 8 | 26 | P8 |

  On the battery each rule is a net gain in corrections. M1 turns the size
  on a priced line into a credit (R23–R26 and R32 on joined lines; on split
  lines the shipped parser already reads all but R24 as credits); M2 turns
  five false credits (P1, P5, P6, P7, P12) into purchases graded 0.3, their
  amounts still wrong, and loses the refunds R6 and R7; M3 makes the
  sign-less points lines plain purchases. Their cost sits in the
  counterexamples outside it. A fixture with no layout named reads the same
  joined and split:

  | Fixture | Should read | Shipped | M1 | M2 | M3 |
  |---|---|---|---|---|---|
  | `REFUND / Jacket $59.99 / Tax $4.80 / ($64.79)` | refund | credit | credit | 0.3 | credit |
  | `返品 / ジャケット ¥5,980 / 消費税 ¥598 / (¥6,578)` | refund | credit | credit | 0.3 | credit |
  | `Shop / Total ¥  480 / VISA -¥480`, joined | purchase | 0.3 | credit | 0.3 | 0.3 |
  | `Shop / Total ¥ / 480 / VISA / -¥480`, split | purchase | credit | credit | credit | credit |
  | `Shop / TOTAL 14 Card -$14`, joined | purchase | 0.3 | credit | 0.3 | 0.3 |
  | `Shop / TOTAL 14 Card / -$14`, split | purchase | credit | credit | credit | credit |
  | `Shop / Total -$14 / VISA 14 USD` | purchase | 0.3 | credit | 0.3 | 0.3 |
  | `店 / ¥ 合計 480`, joined | purchase | debit 0 | credit | debit 0 | debit 0 |
  | `店 / ¥ 合計 / 480`, split | purchase | debit 0 | debit 0 | debit 0 | debit 0 |
  | the sign-less JPY and KRW slips R10–R12, `合計 (1,280)` | refund | credit | credit | credit | debit 0 |

  On joined lines M1 files three purchases as refunds, and a fourth when its
  copy list comes up empty (a fallback to the old copies saves that one and
  changes nothing on the battery). On split lines the shipped parser already
  reads the `VISA -¥480` and `Card -$14` slips as credits, so M1 moves only
  `Total -$14 / VISA 14 USD`, and `¥ 合計 480` stays a plain expense. M2
  moves refund slips to purchases graded 0.3, the Japanese tax-line slip
  among them; one more refund slip,
  `REFUND / Item 1 $10.00 / Item 2 $5.00 / ($15.00)`, keeps its credit under
  M2 only because a date defect cuts `Item 1 $10.00` out of the amount hunt.
  M3 loses three sign-less refunds to plain purchases, with no type flag;
  only their amount grades, at 0.5, still ask.

  The decision rests on which side the errors fall, not on the count. Every
  wrong type the shipped parser keeps on these fixtures is flagged. On joined
  lines it holds the three purchases M1 reaches on the side 0162 called
  safe, an expense flagged at 0.3, and M1 moves all three to income — the
  reading the form applies over a type the user picked, and the drain writes
  unreviewed — to win refunds that were already flagged. On split lines the
  shipped parser already reads two of those three as credits, so there M1
  trades one purchase for one refund that was already flagged. M3 turns three
  right refunds into purchases the type never asks about. M2 trades flagged
  outcomes for flagged outcomes, and costs the refund slips that print their
  total exactly as a restatement does. Two more rules were weighed while
  designing and rejected: requiring another marked figure before
  parentheses count, which broke five pins, and a decimal rule for the
  amount (*Known gaps*).
- **Stamping every producer.** 0162 rejected a mark on every row builder, and
  this record adds builders. The flagged side is filed where the flag is
  answered, the flip, and read off the grade while the question is open.
- **A `receipt_import` income param.** `receipt_import` fires when the
  attempt settles, before review, so it can never see a flip.
- **Reusing `transaction_add`.** It counts the form's own saves, not a
  reviewed batch, and has no place for a count. Its `method` already declares
  `ai_import` and its `type` `mixed`, values nothing sends.

## Consequences

- **The cloud half ships on the web deploy; the parser and `typeVerdict`
  reach iPhones only with a native build.** The app bundles its web assets,
  so a merge delivers the prompts, the mappers, the shipped-catalogue
  fallback, the form, the card, Import History and analytics to the web at
  once, and to iOS with its next build, which also carries the parser's new
  marks and the flagged purchase.
- **The rules deploy with the merge, and the old rules accept the new
  fields.** The import record's rules name no `hasOnly`, so a record the new
  app writes under the old rules passes with its two counts unchecked until
  the rules deploy.
- **The GA4 console step is manual.** `type_flagged` and `type_flipped`, and
  `action`, which was never registered, need event-scoped custom dimensions
  by hand after merge, and GA4 does not backfill.
- **More rows ask.** Every cloud income reading is flagged, the multi-photo
  read's included, and so is every AI-lane purchase whose parser total prints
  a negative and differs from the model's.
- **A statement line answered other than exactly `income` is an expense.**
  Before, a word such as `"Income"` went on as the type and the write was
  refused.
- **A confirmed cloud refund overwrites its merchant's remembered category**,
  as 0162 recorded for the device's: confirm remembers every selected row's
  category, whichever side.
- **Seven catalog keys** in en, ja and tc —
  `transactions.categoryClearedForType`,
  `transactions.categoryRestoredForType`,
  `import.announceCategoriesRefiledOnLoad`, `import.statPhotosSkipped`,
  `import.statPhotosFailed`, `import.statTypeFlagged` and
  `import.statTypeFlipped` — and `import.skipped` removed.
- **One event and two record fields**: `receipt_confirm`, and `typesFlagged`
  and `typesFlipped` on the import record.
- **Four gates grow**: the lint selector and its guard row, the fifth
  `icon-labels:check` rule, `analytics:check`'s parameter comparison, and the
  tile spec; `contrast:check` gains five pairs.

## What the browser runs found

The first run drove the code in a browser against the emulators on port
4300, at 1024×768 and 375px, with providers answered from the page
([../e2e.md](../e2e.md)): no vendor was contacted and no key typed or
stored. The real prompts, mappers, consolidation, converter, grader, card and
form ran.

- **The regressions held**: journeys 79, 87, 88, 91, 94, 99 and 102. On 79's
  flipped row the card announced *Other Income*, kept `movedCategory` and
  `typeFlaggedAs`, and the record read `typesFlagged` 2 and `typesFlipped` 1;
  in the form the flag stood inside the checked segment, named *Double-check…
  Income*, and the group stood 348px from the left and 320px wide with the
  flag and without it.
- **The new journeys held.** The form's cloud scan carried the type into the
  prompt and filed a refund as Income with the category blank, and the
  category request it made offered only income parents; switching back and
  forth said *Category set back to Groceries* and *Category cleared:
  Groceries is not offered for this type*. Gemini's single-photo read filed
  a refund line as income on `other_income`, type graded 0.5, beside a
  purchase line, and the record counted the photos the page refused. With no
  provider, the catalogue's arrival re-filed a kept refund and said so once;
  a double flip brought *Groceries* back at 0.9; a same-side merge re-filed a
  wrong-side survivor. Import History drew every tile at 1024 and at 375px,
  where both cards fit and axe found nothing. The drain wrote a queued cloud
  refund as income on `other_income`, no grade written.
- **The UI sweep** found the form's segments on one line at font scale 1.3,
  and the camera dialog fitting at 375px but not at 1024px.

It found four defects, each fixed here with a spec:

- **The wizard said it found nothing while photos were being queued.**
  `importFromMultipleImages` queues offline photos before it raises
  `isProcessing`, so the processing step read *No Transactions Found* with
  **Try Again** mid-write. A `runInFlight` signal now spans the whole run, and
  the empty result waits for it. **Process with AI** stays disabled for as
  long, so a second press cannot queue the same photos twice. Older than this
  wave.
- **The camera dialog scrolled sideways on a tablet or desktop.** A
  `min-width: 500px` from 768px up sat inside a 500px dialog that pads its
  body 24px a side, so the body scrolled 548px wide in 500px. The min-width
  is gone. Older than this wave.
- **A same-day refund was an exact duplicate of its purchase.** The duplicate
  check's exact branch — same day, same amount, a similar description —
  ignored the type, where its likely and possible branches did not, so a
  refund returned the day it was bought, under the purchase's name and
  amount, was skipped as a copy of it. The exact branch now needs the same
  type. Older than this wave, and found only because refunds now reach it.
- **A scan that moved the form's type back said one category and filled
  another.** It announced *Category set back to* the held pick, then filled
  the category it read. A scan that names a category for the side it lands
  on now ends the hold silently.

Not run in the first pass: the review card's 375px read on journey 106's
rows, which journey 79's covers, and the language switch on the new cards,
whose labels journey 91 read in ja and tc.

The second run, on 2026-10-27, drove the branch with the four fixes in, in
the same venue, after the same pre-flight, before **Process with AI** was held
disabled through a run. Journeys 79, 87 (steps 4 and 5), 104, 105, 106, 107
and 108 held in the steps it reached ([e2e.md](../e2e.md) lists them), and
each of the four fixes was checked again. The
processing card held through a queue write kept open from the page, and the
step never read *No Transactions Found*. The camera dialog's content measured
500 of 500 at 1024, with no scrollbar. Journey 106's doubted purchase read as
a *likely* duplicate of journey 105's mug, not an *exact* one of journey 79's
income row. A purchase scan that named its own category, after a refund scan,
announced only *Receipt scanned successfully*, with no *set back*. The second
run found no new defect.

A third check, the same day, drove journey 87's step 4 on the branch with
**Process with AI** held disabled through a run, before the fix below. With
the queue write held open, the step showed the processing card; back on the
upload step, with the photo still picked, **Process with AI** was disabled,
and a real press queued nothing more. On the release the queue held one
entry. It found a fifth defect, older than this wave:

- **A photo queued offline came back on the next pick.** The wizard drops the
  queued photos from its own selection, but the dropzone kept its own list and
  re-sent the whole of it on its next change. Back on the upload step the
  queued photo still showed as picked; a new pick, or removing the other one,
  put it back in the wizard's selection, and a real press queued the same
  photo a second time under a new row seed, whose rows the drain would have
  written twice. The dropzone now forgets exactly the batch the queue was
  handed, and a photo picked while the write runs stays picked in both lists,
  its previews with it.

A fourth check, the same day, drove journey 87's steps 4 and 5 as
[e2e.md](../e2e.md) now writes them, on the branch's code with every fix in
but one later guard the dropzone's spec holds (a kept document sharing a
forgotten photo's name no longer keeps its preview alive), after the same
pre-flight on fresh emulators. With the write held, **Process with AI**
was disabled and a real press queued nothing more; a photo picked mid-write
stayed picked in both lists after the release, with both of its previews
still loading, while the queue held the one photo it had been handed. After
**Back**, removing that photo emptied both lists, and a new pick held only
the new photo. The drain failed the entry as step 5 says. The fourth check
found no new defect.

## Departures from the plan

The plan settled each of the design's forks before building. Where the
build went otherwise:

- **The copy and restatement rules are rejected on different ground than
  the plan gave.** The plan said each candidate rule trades one flagged
  outcome for another, one for one. The table says otherwise: on the battery
  each is a net gain. The readings are kept because of where the errors
  land, not because the rules gain nothing.
- **A cross-side merge writes a fresh mark only when it moves the category.**
  The plan said a cross-side merge writes one. It deletes the target's mark,
  and the re-file writes a new one only when the survivor's category does
  not fit the net's side.
- **A scan's own category ends the form's hold.** The plan had the way back
  restore a cleared category whenever the field was empty. The first
  browser run found a scan announcing the restore and then filling its own
  category over it.
- **Two readers set the flat type grade.** The plan had consolidation set
  `typeConfidence` alone. Gemini's `receiptSummary` reader sets it too,
  because its row reaches the review through the same categoriser; both set
  it from `modelTypeGrade`.
- **Three defects older than #464, and not about refunds, are fixed here**:
  the wizard's empty result while queuing, the camera dialog's sideways
  scroll, and the dropzone handing a queued photo back. The standing rule is
  that a UI defect met while testing is fixed in the wave that met it.
- **`analytics:check` runs a `--self-test` first**, as the other checks
  do, feeding its comparisons synthetic documents for each way the table and
  the list can drift.

## Things that only became apparent while building

- **The device half of 0162's drain gap was never reachable.** The
  on-device reader resolves its model's answer over the same catalogue, read
  from the same empty list, so with nothing loaded it names no category at
  all, and the drain files the income row on `other_income`. The wrong-side
  id the drain kept came from the cloud.
- **`receiptParse` resolved every name to `other_expense` against an empty
  list.** The resolver falls back to the expense catch-all when nothing
  matches, and an empty catalogue matches nothing. Every receipt read before
  the listener answered was filed on `other_expense`: a wrong-side id on a
  refund, and a lost category on a purchase.
- **Karma never loads the dialog container's stylesheet.** A spec of a
  component that opens in a dialog renders it with none of
  `mat-dialog-content`'s rules, so the form's toggle geometry and the camera
  dialog's content box are measured with the block display and padding set
  inline, and the phone padding the form sets below 480px with them.
- **Angular 22 runs input writes with no active consumer.** The card's
  catalogue setter emits rows to the wizard during the wizard's own change
  detection. Input writes and output listeners run with no reactive consumer,
  so the emission raises no NG0600 and needs no deferral. NG0100 is the risk
  it does carry, and the default no-changes pass cannot see it: it skips
  OnPush views nothing marked. The host spec runs under
  `provideCheckNoChangesConfig({ exhaustive: true })`, where a probe binding
  that changes on every pass fails.
- **Five loose coercion sites, not four.** The plan named the four
  `t.type || 'expense'`; the backup door's `(t['type'] as …) || 'expense'`
  is a fifth, so the selector matches a cast in front of the member too. It
  matches the left side by the member name `type` alone: any `||`
  defaulting a property called `type` to `'expense'` or `'income'` is
  caught, whatever the object. An optional chain (the form's
  `transaction?.type || 'expense'`, which seeds the form from a stored row)
  and `??` (a test-data default) are not, and neither reads a model's or a
  file's answer.

## Known gaps

- **A minus Vision dropped** still reads as a purchase: nothing on the
  paper is left to read.
- **A minus glued to kana, or to an uncased label of another script** — Thai,
  Arabic, Hebrew, Devanagari — is a miss. Only Han and Hangul are named.
- **A reference glued to a Han label reads as a negative.** `伝票-1234` now
  marks its figure, so where that figure wins the amount the receipt is a
  credit — flagged, with the wrong amount.
- **A labelled parenthesised figure that outranks the total** —
  `Total $59.99 / Was ($79.99)`, `定価(¥1,580)` — reads as a credit with the
  wrong amount, flagged.
- **`Points (1,250)`'s amount.** On a receipt that prints no currency sign,
  the grouped figure is the only one written like money, so it outranks the
  plain total, and its parentheses make it a credit: flagged income with the
  wrong amount. The one typography rule found for the amount, that a receipt
  printing cents prints its total with cents, misreads `1.5L`, `0.35kg` and
  `2.5%`.
- **The priced-line copy.** `Mooring rope 10m -$10.00 / TOTAL -$10.00` on a
  joined line reads the size as an unmarked copy of the total: the refund is
  a purchase graded 0.3, flagged.
- **The lone restatement.** `合計 ¥1,180 / (¥1,280)` reads the parenthesised
  price with tax as a credit with the wrong amount, flagged.
- **A refund the model calls a purchase** lands on the cloud doors as an
  unflagged expense: no second witness reads the paper there, and a purchase
  carries no grade.
- **A purchase receipt whose refund line nets to a purchase** is an ungraded
  expense. Consolidation grades the receipt's net, so a return line inside a
  sale is folded in unasked.
- **The drain writes unreviewed and uncounted.** A queued refund lands as
  income on `other_income`, but nobody sees its flag, the grade never reaches
  a document, and the drain writes no success record, so its flags reach
  neither Import History nor `receipt_confirm`.
- **A failed read-back sends no event.** The wizard reports from the record it
  read back; a confirm whose rows landed and whose read-back failed reports
  nothing.
- **A split save on the form counts one reading.** The form's save is one row
  to `countTypeAnswers`, however many parts the split writes.
- **A doubted type's sentence opens on hover or long-press only.** The type
  flags on the form and the card are hidden icons inside a control that takes
  focus and speaks the sentence, but the tooltip that shows it belongs to the
  icon, which the keyboard never reaches.
- **Rows handed to the card after its catalogue loaded are not held.** The
  arrival rule runs when the catalogue goes from empty to non-empty. Rows a
  camera hand-off converted against an empty catalogue, bound after the
  account's has loaded, keep a wrong-side category until a flip or a merge
  re-files them.
- **`receiptSummary` has no door.** It asks for the type and grades an income
  reading, but only `importFromImage`'s fallback reaches it, and no screen
  hands that a file.
- **No keyed model has read a refund through the new prompts.** No vendor was
  contacted. The wording rests on the registry specs and on the page-answered
  browser runs; a keyed run of the model probe's refund fixtures is drafted
  and not filed.
- **No simulator run.** No Swift changed, and the device-lane changes are
  TypeScript the specs drive on the same text, so 0162's simulator gap stands
  as it was.
- **Two parser readings found while designing are neither filed nor fixed.**
  The trailing-year date pattern's separator spans ` $`, so `Item 1 $10.00`
  reads as 10 January 2000, graded 0.3, and drops that line from the amount
  hunt. And `Total $12.50 / (Reg $15.00)` reads 15.00, graded 0.8, with no
  flag: the one silent row on the battery.
