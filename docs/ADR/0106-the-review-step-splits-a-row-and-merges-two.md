# 106. The review step splits a row, and merges two

**Status:** Accepted, implemented · **Date:** 2026-09-08 · **Issues:** #371

Reference documentation lives in [../import-fields.md](../import-fields.md)
and [../receipt-import.md](../receipt-import.md).

Extends [0099](0099-the-review-step-edits-what-it-shows.md) — the card is the
editor, and these are its first edits to change *how many* rows there are
beyond the blank one — and
[0103](0103-the-review-step-adds-a-row-and-the-wizard-is-sealed-while-it-writes.md),
whose **Add a row** built the born-editing idiom a split part reuses and
whose "not on arrival" rule this narrows. Departs from
[0060](0060-a-confirmed-import-keeps-its-photos-and-names-its-source.md) for
split parts, and widens
[0101](0101-a-corrected-row-is-checked-for-duplicates-again.md): a filled row
that appears is now a change.

## Context

Consolidation is irreversible. `consolidateReceiptItems` folds every item
sharing a `receiptId` — and every item without one, under `?? 1` — into one
row and drops the constituents; the multi-image door keeps the raw rows only
for a warning count, and `ImportResult` carries none of them, so once the door
closes the only trace of the line items is the merged row's `notes` text. A
receipt the reader took for two, or two receipts it took for one, could not be
put right before the write; the reviewer imported the wrong number of
transactions and repaired the ledger afterwards.

The card had no removal path. `replaceRow` is one-for-one and `addRow` was the
only operation that changed the list's length — 0103's own known gap.

Three seams stood between the card and either control. `planReceiptAttachments`
attaches rows sharing a `receiptId` **once** (0060), so a naive split would
hand the photo to the first part and nothing to the second. The wizard's
`onTransactionsUpdated` skipped any id absent before ("a first population is
not a change"), so a part — born filled — would never have been
duplicate-checked, unlike the blank row 0103 documents, whose first edit is
what checks it. And eight per-id containers keep state for a row that a merge
removes — `overruled`, `recheckStamp` and the `duplicateChecks` entries on the
wizard; `editing`, `amountRejected`, `notesOpen`, `draftNotes` and
`fellBackEligible` on the card — none of them pruned by anything but
`processFiles` — and `duplicateChecks` alone by the partial import that keeps
the failed rows — because no edit on the card had ever made a row's id stop
appearing.

The issue's premise was half wrong. `applyMultiImageDeduplication` — the
position-overlap pass that rewrites `wasMerged` and `mergedFromImages` — has no
production caller; the live cross-photo merge is consolidation alone. That dead
helper is left for a record of its own —
[ADR 0111](0111-the-position-overlap-pass-is-removed.md), #389.

## Decision

**A split moves an amount into a new part that keeps the purchase's identity
and drops what is singular; a merge folds a row into a target that keeps its
id; and a row takes part in a merge, on either side, only when it has an
amount, a description and no standing verdict.**

### A part keeps what identifies the purchase and drops what is singular

**Split**, in a row's extras ahead of **Add location** and **Add tag**, opens
an inline field for the figure the new row takes. `splitImportRow` keeps the
original at the remainder under its own id and builds the part from the same
row: description, date and its marks, currency, type, category and
confidence, location, `receiptCountry`, tags, `suggestedTags`, period, the
currency marks and a copy of `imageMetadata` travel — the receipt was read
once, and splitting the amount does not reread the date. Notes, the rule link
and offer, and the duplicate verdict do not: a note about the whole receipt is
not a note about a fraction of it, and a verdict was reached about a different
figure. Both halves lose the amount's grade — the reviewer's hand settled both
figures, 0099's rule — and the remainder is `roundMoney(row.amount − taken)`.
The original keeps its id so the wizard's diff sees an ordinary amount change;
the part is spliced directly under it and opens with its description editor
focused, `addRow`'s idiom, because the copied description is rarely right for
a line taken out on its own.

### `splitFrom` is a mark on the row, and it is never written

Like `dateReviewed` it rides `CategorizedImportTransaction` and stops at the
mapper: `toCreateTransactionDTO` names every field it forwards, so a mark on
the row cannot leak into a document. It lives on the row rather than inside
`imageMetadata` because it has readers on every door, photo or not:
`planReceiptAttachments` keys a row carrying it on its own id, and
`findWithinBatchDuplicates` never makes rows born of one split each other's
twins. A bill halved is the first natural use of Split, and `isSameRow` — same
type, amount, day and a similar description — would flag the part
`within_batch` on the very re-check the split fires. A CSV row split evenly has
no `imageMetadata` at all.

### Every part uploads its own copy of the photo

0060's "attach once per receipt" is about a group the pipeline made; a part is
a transaction the reviewer made, whose evidence happens to be the same photo.
The planner's group key for a row carrying `splitFrom` is `split:<its own id>`,
apart from the receipt group and apart from its siblings — keyed on the
shared `splitFrom` value, a receipt split into three would attach only the
first part.

### A merge keeps the target's id

**Merge into…** lists the other rows in the same currency as *description ·
amount · date*, from a lazy menu the way the country menu is built.
`mergeImportRows(target, source)` is pure. The amount is the signed net — an
income line nets off an expense, the type follows the sign, expense on exactly
zero — through `roundMoney`. The target's identity wins outright: id,
description, date and its marks, category, currency, period, the rule link,
`splitFrom`; a location or country the target lacks is taken from the source.
Tags and `suggestedTags` union through `normalizeTags`; notes join on a new
line, a blank note read as none; `imageMetadata` is the target's block with
`mergedFromImages` the union of both sides' sources, read through
`imageSources`, and `wasMerged` set — or a copy of the lone side. The result
is unflagged, without a pointer, selected, and without the amount's grade.
Different currencies are refused, because nothing here converts, and the menu
never offers one. The kept id is what lets the wizard's diff see an amount
change on a row it already knows, so the re-check fires with no new signal.

### A row takes part only when it has an amount, a description and no standing verdict

A blank target's placeholder category and copied date would win over the
source's real ones, with only the empty description caught by the unfilled
gate — a reviewer who then names the row ships a wrong category and date
without a sign. A flagged target's verdict cleared on the way through would
answer a question the reviewer was never shown, and should the re-check behind
it fail, a real duplicate would be left unflagged and selected — the one edit
that would fail open, where an amount edit on a flagged row leaves the flag
standing. So a blank row is filled first and a flagged one is overruled first,
by the badge's own control. Selection is not read: a row the reviewer left out
can still merge, and comes back selected. The rule is judged in the helper, on
both sides; the card's `canMerge` and `mergeTargets` read it too, so the
trigger renders only where the menu would have something to offer.

### A filled row that appears beside rows already on the card is a change

`onTransactionsUpdated` treats an id absent from the previous emission as
changed when that emission was non-empty and the row is filled. A first
population is still not a change — the previous set is empty then — and
neither is a blank hand-added row: its first edit is what checks it, as 0103
says. Nothing else would ever check a part.

### State keyed on a vanished id is pruned on both sides

The wizard drops `overruled` and `recheckStamp` for every id gone from the
batch and filters `duplicateChecks` to the ids still present; a stamp pruned
out from under an in-flight re-check makes `standing()` false for it, so a
reply that lands afterwards is dropped by the mechanism 0101 already built. The
card's `forgetRow` drops its five containers' entries. A gone row owes no
verdict and no overrule — left standing, a stored check for it would ride the
`storedOnly` fold on every later re-check, hidden from the screen.

### The helper is the single judge

`splitImportRow` and `mergeImportRows` return `null` for what they refuse, and
the card treats `null` as the answer: `commitSplit` holds the field open marked
invalid and says why — a `role="alert"` line the field names through
`aria-describedby`, the amount editor's own shape — and `mergeInto` returns.
The card keeps no judgement of the figure beside the helper's; its own guards
are for a row gone from the table by the time the commit or the click lands,
and for a row against itself, which the helper refuses too. A control that
pre-judged a figure the helper then refused is what produced the crash below.

### `mergeInto` resolves both rows by id at click time

The lazy menu's items hold the row objects of the render that built them,
and the wizard replaces a row under the same id whenever a re-check reconciles
its verdict. Resolving both rows by id when the click lands makes the merge
independent of whether a refresh ran in between; a row gone from the batch by
then is the same no-op a stale split commit is.

### The alternatives that were rejected

- **An item picker.** A model-level item list exists only on the multi-image
  door, and the reader's verbatim `receiptDetails` does not parse into one.
  An amount is what every door's row has.
- **Merge with the row above.** It covers consolidation's adjacent mistakes
  and nothing else.
- **A selection-based merge.** It overloads `selected`, which means "import
  this row".
- **First-part-only photos.** 0060's rule is about a group the pipeline made,
  not a transaction the reviewer made; a part with no photo is a transaction
  whose evidence sits on another.
- **One uploaded object shared by two transactions.** The storage path is
  keyed per transaction id and a transaction deletes its own slots; an object
  shared by two would go with whichever went first.
- **`splitFrom` inside `imageMetadata`.** A CSV row split evenly has none, and
  would be flagged as its own twin on the first re-check.
- **A per-row overflow menu for the two controls.** It would hide two
  controls behind a third; the receipt badge is not an anchor either, because
  both actions apply to every door's rows.

## Consequences

- **One quota slot per extra part.** Each part uploads its own copy of the
  photo, and the quota is charged per uploaded image.
- **The badge is on both parts** — the same receipt, the same photo — and after
  a merge it names the union of both sides' photos.
- **A net-zero merge lands on the unfilled gate.** An amount of nothing loses
  both triggers and holds Continue and Import until a figure is typed.
- **A part of a row with a standing date question carries the mark, not the
  gate.** It shows the chip, but `receiptRowIds` is stamped once at extraction
  and never contains the part's id — the footing every assumed date outside a
  receipt batch already has.
- **A source row's open date question leaves with it.** The target's date
  and marks win outright, so a receipt row still owing a date answer merged
  into a row whose date is settled frees Continue without the question being
  answered — the reviewer chose the target's date, which is the rule. The
  reverse stays gated: a target with an open question keeps its marks.
- **0103's "not on arrival" is now true of blank rows only.**
- **A cross-receipt merge keeps the target's `receiptId`**, so the source's
  drops out of `receiptsDetectedCount` — a displayed count, nothing written.
- **A merged row reads as "1 item merged".** `wasMerged` on the survivor is
  what `mergedItemsCount` counts, so the processing step's banner (shown only
  for more than one photo) and the confirm step's *Items merged* card count
  the survivor as one merged item after any merge of two photo rows, whatever
  either side carried before — 1 where two unstamped rows showed 0, 1 where
  two consolidated rows showed 2, two rows of one photo included. The
  extraction result's own `multiImageMetadata.itemsMerged` counts something
  else — the reader's `wasMerged` over the raw rows, before consolidation
  stamps its own — is 0 in practice, and is rendered nowhere: that figure is
  removed by [ADR 0116](0116-the-merged-count-has-one-producer.md), #392, and
  the survivor's own count stands.
- **A split doubles that count.** A row consolidation folded from several
  items carries `imageMetadata.wasMerged: true`; the kept half keeps the
  block through the spread and the part takes a copy, so after a split
  `mergedItemsCount` counts the part as a second merged item, and a
  merged-then-split row counts twice on the confirm card. Same class as the
  two above. Of the other displayed counts, `receiptsDetectedCount` is
  unchanged by a split — the part copies `receiptId` — and
  `duplicatesSkipped` by a merge, since the rule keeps a flagged row off
  both sides.
- **The amount rule is "to the cent".** On a `45.675` row split by 20 the
  halves sum to 45.67, not `roundMoney(45.675)` = 45.68: `45.675 * 100`
  happens to land on exactly 4567.5 and rounds up, while `(45.675 − 20) * 100`
  does not.
- **A merge costs a Firestore read**, 0101's: the survivor's amount changed.
- **Focus is named for the control that leaves.** A split lands in the part's
  editor; a merge lands on the survivor's own merge trigger, or on its
  description trigger when the merge took the last other row in its currency.
  Material's own focus restore targets the trigger the click removed, and
  `afterNextRender` runs after the change detection that removed it, so the
  card's choice wins.
- **Up to two more 40px controls per row** in an extras strip that was already
  the card's widest line at 288px; the probe measures both, and the open split
  field, on its widest row.

## Things that only became apparent while building

- **Half-cent rounding produced a zero kept row, twice.** The first helper
  rounded the remainder but not the figure and guarded on the raw figure:
  `19.999` on a 20.00 row gave a kept row at 0, and `10.005` drifted the sum a
  cent. Rounding the figure first was not enough: `45.675` split by `45.67`
  still gave a kept row at 0, because `roundMoney(45.675)` is 45.68 — the
  multiply lands on the boundary — while `roundMoney(45.675 − 45.67)` is 0.
  The guard now judges the rounded remainder itself, spelled `!(remainder > 0)`
  so a `NaN` row amount is refused too, since `NaN <= 0` is false.
- **The first fix introduced a crash.** Rounding inside the helper left the
  card's own raw pre-guard (`amount >= row.amount`) beside it: `19.999` passed
  the card, the helper returned `null`, and destructuring it threw inside the
  event handler after the editor had already been closed. The card now calls
  the helper first and treats `null` as the rejection — the single-judge rule
  above is this finding written down.
- **The overflow probe's two rows share no currency.** One is JPY and the other
  USD everywhere in that file, and the currency-offer chips are pinned on it,
  so no merge trigger renders in the standing fixture. The merge case overrules
  the second row's flag through the badge's own control and re-denominates it
  through its own currency menu — real edits, the fixture untouched — before it
  measures anything.
- **A direct instance assignment does not re-render this OnPush card in the
  harness.** `fixture.detectChanges()` refreshes an OnPush view only while it
  is dirty — creation, `setInput`, a template listener, `markForCheck` — and
  `component.transactions = …` marks nothing. That is why the stale-reference
  case works at all (the open menu's items keep the objects they were given),
  and why the trigger-count case has to re-render through `setInput`.
- **The stale-reference guard's stated reason was wrong before it was right.**
  Under zone.js the tick after a reconcile refreshes the open menu's contexts
  before a click can dispatch, so the wizard cannot hand `mergeInto` a stale
  object today; the harness can, and a zoneless scheduler could order it
  differently. The guard stays, with the honest reason on it, and a direct-call
  case pins it independently of the fixture's behaviour.
- **The mergeable rule made two fallbacks unreachable.** `mergeLabel` and
  `mergeOptionLabel` each carried a blank-description branch; under the rule
  neither the trigger nor a menu item renders for a blank row. Both were
  removed rather than kept beside a comment — 0097's half-present rule — while
  `splitLabel`'s fallback stays, because the split trigger does render on a
  row with no description yet.
- **The Split trigger's blank fallback is `import.splitRow`, not
  `import.addDescription`.** The first cut mirrored `editDescriptionLabel` and
  named an action the control does not perform, colliding with the real
  add-description trigger's name on the same row.
- **An empty split field trapped the reviewer.** Empty parsed as unreadable,
  `aria-invalid` held the field open, and Escape was the only way out. An
  empty or whitespace commit now closes ahead of the parse, on Enter as on
  blur — the rule `commitTag` and `commitPlaceName` already follow for a field
  that opens empty by design.
- **The split editor refused in silence.** It turned `aria-invalid` with no
  message while the amount editor pairs the same state with `aria-describedby`
  and a `role="alert"` line, and only reading the two side by side showed it;
  the split field now mirrors the amount editor's, with one message for both
  refusals — a figure that would not read and one the row cannot spare.
- **`afterNextRender` runs in the zone's tick, not inside `detectChanges()`.**
  In the emulator suite the split's emission starts a real re-check whose
  promise chain keeps the zone unstable, so the part's focus lands one task
  later than `addRow`'s does; the case yields once before it looks.
- **A blank note is not an absent one.** `convertParsedReceipt` copies
  `receiptDetails` verbatim, so a total-only receipt arrives with `notes: ''`;
  a truthiness test read that as absent and a nullish fallback then kept it
  over the other side's real note. Blank is now read as absent on both sides,
  and absent is the key gone, the way the part leaves it.
- **The stamp prune under an in-flight re-check had nothing pinning it.**
  Losing the one `delete` line would let a gone row's stored verdict ride the
  `storedOnly` fold forever, hidden by `duplicateInfos`; a case now resolves
  the reply after the row has left and asserts it is dropped.
- **The emulator suite runs with no catalog.** The translation service's
  initializer never runs under the test bed and the test target serves
  `public/` alone, so rendered text is keys: the badge and menu assertions
  there go through `imageMetadata`, `receiptPhotos()` and the item count,
  never through the DOM's text.
- **The driven run found what the 288px probe cannot.** At 390px the wizard
  leaves each card 240px wide, and the category suggestion chip — sized to its
  label, *Groceries* at 185px — reaches 12px past it. That chip predates this
  record and the probe's fixture category is shorter; it is left for a record
  of its own —
  [ADR 0110](0110-the-probe-measures-the-card-at-phone-width-and-in-both-directions.md),
  #393.

## Known gaps

- **No plain Remove.** 0103's gap stands. The mechanics now exist — `forgetRow`,
  the wizard's prune, a focus fallback named for a control that leaves — and a
  Remove would reuse all three. Closed by
  [ADR 0108](0108-the-review-step-removes-a-row.md), #391.
- **A split cannot pick items.** An amount is all it takes off.
- **The twin exemption is one generation deep.** `sameSplit` knows a part and
  its original, and two parts of one original; a part split again is not
  exempt against its grandparent or its aunt, so an even second split can be
  flagged `within_batch` on its own re-check and deselected.
- **A merge across two receipts with a third row still on the source's receipt
  uploads that receipt's photo twice** — once inside the merged row's union,
  once under the third row's own group.
- **The blank note is normalised at the merge, not at its producer.**
  `convertParsedReceipt` still writes `notes: ''`, and every other reader of
  the row still meets the empty string.
- **A decimal typed into a zero-decimal currency is stored with it.**
  `parseAmountInput` accepts decimals and `roundMoney` rounds to cents whatever
  the currency, so `179.33` on a JPY row stores `179.33` and renders `¥179`.
  The split field inherits what the amount editor already did. Closed by
  [ADR 0109](0109-a-hand-typed-amount-is-whole-in-its-currency.md), #394.
- **A merge is not undoable.** The source's own description, date, category
  and notes are gone except the note text joined in; splitting an amount back
  off makes a new part with the survivor's identity, not the row that was
  folded in.
- **The survivor says "1 item merged" where the extraction result's
  `itemsMerged` says 0**, as above; neither figure is wrong about what it
  counts, and the second is displayed nowhere. Closed by
  [ADR 0116](0116-the-merged-count-has-one-producer.md), #392.
