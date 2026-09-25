# 149. The review step says what it changed

**Status:** Accepted, implemented · **Date:** 2026-09-24 · **Issues:** #430

Reference documentation lives in [../import-fields.md](../import-fields.md),
[../receipt-import.md](../receipt-import.md) and
[../accessibility.md](../accessibility.md).

Narrows [0108](0108-the-review-step-removes-a-row.md)'s one-press removal to
the rows that carry nothing the user made on the card. Closes the
unannounced-change gaps that
[0101](0101-a-corrected-row-is-checked-for-duplicates-again.md),
[0102](0102-the-review-card-adds-a-tag-and-edits-a-location.md),
[0107](0107-the-review-card-has-one-editing-machine.md), 0108 and
[0121](0121-a-bulk-currency-switch-says-how-many-rows-it-blanked.md) each
recorded, [0120](0120-a-partial-import-keeps-every-row-it-did-not-write.md)'s
two about a failed row,
[0103](0103-the-review-step-adds-a-row-and-the-wizard-is-sealed-while-it-writes.md)'s
two about the held gate and the seal, and
[0062](0062-the-review-step-can-correct-every-field-the-import-writes.md)'s
third currency. Amends
[0073](0073-shortcuts-live-in-the-shell-and-the-palette-reads-the-sidebars-list.md),
whose command palette relied on each result count replacing the last: the
announcement queue would otherwise have played the counts out figure by
figure, so the palette's count now replaces instead.

## Context

The review card was built across a run of records, 0099 to 0121, and each of
them wrote down a variant of one gap: an action changes a row somewhere the
user is not looking, and nothing says so. For a screen-reader user the moved
focus was the only signal. Seven of them were still standing.

**Nothing on the step had a live region.** Neither the wizard nor the card
injected `AnnouncerService` — 0101's own correction says the wizard never
did. A duplicate verdict that a re-check flipped two cards down, a filed tag,
a withdrawn country, a chip leaving the card and a removed row all changed
the list in silence (0101, 0102, 0107, 0108).

**The per-row currency chip blanked an amount without a word.** Switching a
row to a currency whose minor unit cannot hold its figure rounds the figure to
nothing, and 0121 gave the bulk switch a count of the rows it emptied. The
chip rounds the same way and said nothing — the fork 0117 left open and 0121
kept.

**A failed row came back blind.** A partial import re-offers the rows the
write refused (0120), ticked and identical, with no reason on screen and no
ceiling: a row the rules will always refuse could be confirmed again forever,
and nothing told the user why it had come back.

**The held Continue led nowhere.** A native `disabled` button eats the
click, so pressing it did nothing, and the hint under the list counted the
rows owed without leading to any of them (0103). On a batch of twenty that is
a hunt.

**The seal had no visible half.** `[editable]="!isImporting()"` stops a step
header answering a click while the import writes, and nothing on screen said
so (0103).

**Remove took the user's work with it.** 0108 made Remove one press on every
row, with Deselect as the reversible answer. For a row exactly as a scan read
it that is right — a rescan gives it back. For a row the user had corrected,
split or merged into, one press threw away work nothing could give back.

**A currency outside the curated list could not be picked.** The chip offers
the curated nineteen plus the row's own code, the bulk menu the nineteen
alone, and the transaction form's select has the same ceiling. A receipt whose
currency the model misread as another real code could not be corrected on the
card, nor in the form afterwards (0062).

## Decision

**A change that used to happen in silence is said once; a failed row carries its
reason and stops coming back on its own; a held Continue takes the user to the
row that holds it; a sealed step says it is sealed; Remove asks first only
when the row holds the user's own work; and a currency the pickers do not list
can be typed, provided a loaded rate can convert it.**

### One sentence per change, and one voice

`TransactionPreviewTableComponent` injects `AnnouncerService` and each
handler that changes a row announces once, with the row's description in the
sentence, politely:

| Handler | Sentence |
|---|---|
| `clearDuplicate` | *{description} is not a duplicate* |
| `commitTag`, when a tag is actually filed | *Tag {tag} added to {description}* |
| `removeTag` | *Tag {tag} removed from {description}* |
| `setCountry(row, null)` | *Country removed from {description}* |
| `removeLocation` | *Location removed from {description}* |
| `removeRow` | *{description} removed* |

Picking a country is not announced — the user is looking at the menu they
picked it from; withdrawing one takes the chip away, which is the change a
screen reader would otherwise miss. A commit that files nothing (an empty
field, a tag the row already carries) says nothing.

The wizard injects the service too. `recheckDuplicates` counts the rows whose
`isDuplicate` actually flipped in the reconciliation — not only the row that
was edited, since a within-batch verdict can flip a row two cards away — and
announces *{count} duplicate verdicts updated*, plural on the count. A
re-check that flips nothing says nothing.

**A blank row is *an untitled row*.** A row added by hand can be tagged or
removed before anything is typed into it, and every sentence above has a
description slot. `announceDescription` answers the description, or
`import.untitledRow` when there is none. It is a noun phrase because the slot
sits inside a sentence; the edit trigger's placeholder, *Add a description*,
is an imperative, and dropped into the slot it read as an instruction — *Add a
description removed*. It is lower-case at a sentence's start, as a typed
description may be.

**The bulk blank needed nothing.** `applyCurrencyToSelected` already reports
its count through `NotificationService`, which announces every snackbar it
shows; an announcer call beside it would say the same sentence twice. The
per-row chip now decides blanked-ness the way the bulk switch does —
`amountIsUnfilled` before and after `roundToMinorUnit` — and raises the same
notice with `count: 1`. One key, one voice, for both paths.

**Announcements wait their turn.** The CDK `LiveAnnouncer` writes a message
into its live region only after a delay of about 100 ms, and a second call
inside that delay clears the first before it is ever written. This step makes
such pairs likely: a removal on the card and the wizard's re-check that
answers it, whose read can come back from the offline cache inside the window,
or a snackbar's announcement close behind another. So `AnnouncerService` no
longer hands each message straight through. It keeps a queue, and hands the
next message over only once the one before it has been written and has then
stood for `ANNOUNCEMENT_GAP_MS`, 150 ms. The gap is what keeps the first
message: the CDK writes a message and resolves the promise it returned in the
same timer task, and its next `announce()` begins by clearing the region, so a
message handed over the moment the last one resolved would replace it before
any rendering update had exposed it to the accessibility tree. The gap is
timed by `setTimeout`, outside Angular since it changes nothing a view
renders — not by an animation frame, which never fires in a hidden tab and
would hold every later message behind it. A message with nothing ahead of it
still goes out at once. An empty message is skipped and never joins the queue,
the politeness passes through, and a rejected announcement does not hold back
the ones behind it. The service is root-provided, so there is one queue for
the whole app.

**A message that reports current state replaces instead.** `announce` takes an
optional third argument, `mode: 'queue' | 'replace'`, `'queue'` by default,
and what the message reports decides which. Current state — a count, a
position — is made stale by a later state, so it passes `'replace'`. An event
— a removal, a notice, an alert — is not made stale by anything said after it,
so it queues. `'replace'` drops every waiting message that was itself passed
with `'replace'`, whichever surface raised it, and queues this one at the
back. A message queued with `'queue'` is never dropped: a keystroke in the
palette must not cost a waiting budget alert, a notice or an assertive error
its turn.

The command palette announces its result count on every keystroke, with no
debounce, and passes `'replace'`. Queued, the counts would play out one by one
after the typing stopped. Replaced, a count goes out at most once a turn while
the typing continues — the CDK's delay and then the gap — each the latest
count at that moment, and when the typing stops the last count is the last
count placed. The dashboard layout's move, *{card} moved to position
{position} of {total}*, passes `'replace'` as well, since rapid presses would
otherwise queue positions a later press had already made stale; the
correction a failed save announces, *Couldn't save. {card} is back at position
{position} of {total}*, leads with the failure, an event, and queues. The
transaction list's result count and totals, announced once per filter or sort
change, and the totals an explicit calculation announces, are state and
replace. Every other caller queues: the card's six row events, the count of
verdicts a re-check flipped (what that re-check did, not a standing figure),
the parts a split dropped, every snackbar's notice, and the budget alert and
the weekly recap, each announced once when it appears.

### A failed row says why, and the reason comes from the code

**The code travels with the error.** `ImportError` gains an optional `code`.
`confirmImport`'s per-row catch records the thrown error's own `code` when it
is a string, spread in only when present, since the record's `errors` goes to
Firestore and Firestore refuses an `undefined` field.

**`importFailureKey(error)` reads it first**:

- the amount guard's own sentinel, `INVALID_TRANSACTION_AMOUNT`, is
  `import.rowFailedAmount` — *This transaction's amount could not be saved*;
- a code among `permission-denied`, `unavailable`, `deadline-exceeded` and
  `resource-exhausted` is `import.rowFailedConnection` — *The connection
  dropped before this row could be saved*;
- any other code is `import.rowFailedUnknown`, without reading the message;
- no code at all falls back to a lower-cased reading of the message for
  `permission-denied`, `unavailable` or `network`, for an error that carries
  none, such as a `TypeError` off a dropped `fetch`.

The message alone could never have produced the connection reason. A
Firestore rejection keeps its identifier and its prose apart: the code is
`permission-denied`, the message *Missing or insufficient permissions.*, and
the message never contains the code.

The row shows a catalog key's sentence, never `error.message`: that is a raw
code or a provider's English, and not a sentence in the account's language.
It renders under the card's bottom row, above its extras, with an
`error_outline` glyph, as `role="note"` — not `alert`, because the failure
happened during the write, before this render, and interrupts nothing — in
`--color-error-text`
([0151](0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)).

**A second failure sets the row aside.** The wizard's partial branch reads
`result.errors` by `transactionId`
([0115](0115-a-failed-row-is-named-by-its-id.md)), and for each failed row
increments `importAttempts`, stamps `importFailure` and clears the duplicate
mark and check as it did before. After the first failure the row comes back
ticked; after the second it comes back unticked. Re-selecting it is the
user's own choice — a third automatic attempt at a refusal that has not
changed is a loop with no way out. A split starts both of its halves again at
no attempts, and a merge its survivor: none of them is the row the write
refused, and a count carried over would set a row aside on its own first
failure.

**One notice per round, not one per row.** *{count} rows failed to save twice
and were set aside — reselect them to try again*, plural on the count alone. It
names no row: each set-aside row's own reason is already on its card, and a
notice per row would leave only the last one on screen, because a snackbar
replaces the one before it. For the same reason it is not a notice of its own:
it follows the round's *Imported {success} of {total} transactions — {failed}
could not be saved* in the same error, the two sentences joined by
`joinSentences`. A second snackbar raised straight after the count would take
its place before anyone had read it.

**The photos ride in the same notice.** Rows can save without their photos:
the image quota refused them, *The transactions were saved, but {count}
receipt photos were not attached — image storage limit reached*, or the upload
failed, *…could not be uploaded. You can attach them from the transaction.*
Each stays a sentence of its own, because the next step differs, and neither is
folded into the failure count, because calling a round partial for a photo
would invite re-importing rows that already landed. Both join the round's one
notice rather than following it: after the count and the set-aside sentence in
the error when a row failed, after *Successfully imported {count}
transactions* when none did. That notice takes the success tone only when it
carries no photo sentence. With one, skipped or failed, it takes the info tone
each photo sentence had as a notice of its own: a row that saved without its
photo is something to act on, not a failure of the import, and not a plain
success either. A round in which any row failed keeps the error tone.

**The notice stays up as long as it is.** A tone's own duration — 3 s for
success and info, 5 s for an error — was sized for one sentence. A success
notice carries one, *Successfully imported {count} transactions*; an info
notice carries that and one or both photo sentences; an error carries the
round's count and up to three more parts, the set-aside sentence and both
photo sentences. A part is not always one sentence: the failed-upload part is
two in en and ja, and the set-aside part two in ja. `NotificationService`'s
`success`, `info` and `error` take an optional `{ durationMs }`, which every
other caller leaves out. The wizard passes the tone's duration and
`ROUND_NOTICE_MS_PER_EXTRA_SENTENCE`, 2 s, for each sentence past the first,
counting the sentences in the joined text by their stops: a full-width `。`,
`！` or `？` wherever it stands, since Japanese and Chinese put no space after
one, and a Latin `.`, `!` or `?` before whitespace or the end, so a dot inside
a figure or a dotted name ends nothing. A notice of one sentence keeps the
default, and the last sentence of a longer one is still on screen to be read.

### A held Continue takes the user to the row that holds it

The review step's Continue carries `disabledInteractive`. Material then
renders `aria-disabled="true"` rather than the native attribute, so the button
still looks and reads disabled, and still takes focus and a click.

`onReviewContinue()` advances the stepper when `reviewComplete()` holds, and
otherwise asks the card, through `table = viewChild(...)`, to
`revealFirstBlocking()`:

- the first unfilled row outranks the first unanswered date — an unfilled
  row's placeholder is the only sign anything is wrong with it, where a date
  question already carries a chip of its own;
- the row's card is scrolled to the centre of the list's own scroller,
  `block: 'center'`, instantly when either reduced-motion kill-switch is on —
  the OS query or the app's `.reduced-motion` class — and smoothly otherwise;
- an unfilled row opens its amount editor, or its description editor when the
  amount is there, through the card's own `startEdit`, which focuses the input
  the way a tap on the trigger does; a date question takes focus on its date
  button;
- with nothing selected there is nothing to reveal, and nothing advances.

**One signal behind the gate.** The button's `[disabled]` had been a
three-part expression written apart from the `reviewComplete()` computed that
the step's `[completed]` read, and the two agreed by convention. With a held
button that still answers a click, a drift between them would be a press that
advances while the button reads held, or the reverse. `reviewComplete()` now
reads `selectedCount()` — what the badge, the count line and the confirm
step's Import already read — and feeds the step's `[completed]`, the button's
`[disabled]` and the press alike.

### A sealed step wears a lock

While `isImporting()` holds, every step label renders a `lock` icon after its
text: `role="img"`, a literal `aria-hidden="false"`
([0146](0146-an-icon-that-carries-a-label-is-not-hidden-and-a-category-id-is-never-empty.md)),
and `import.stepSealed` — *Step locked while the import is in progress* — as
both its `aria-label` and its `matTooltip`. It goes when the write ends.

The icon is written once, as `<ng-template #sealIcon>` inside `<mat-stepper>`,
and rendered in the four labels through `ngTemplateOutlet`. A bare template
there is invisible to the stepper's content queries, which key on `MatStep`
and `MatStepperIcon`, so declaring it among the steps adds no step. It is
sized in the component's stylesheet, never with a Tailwind text utility, and
`MatTooltipModule` joins the wizard's imports with its selector used
([0128](0128-a-material-module-a-template-never-uses-fails-the-build.md)).

### Remove asks first only when the row holds the user's work

**`editedOnCard` marks a row the user changed.** It is a review-step mark,
never written. Each handler that records the user's own content sets it:
description, amount, the income/expense flip, currency (per row, the bulk
switch, and an offered currency accepted), category, a tag added or removed,
the place name, the location removed, the country, every date answer — a
picked day, **Keep** and **Keep all dates**, through the one `dateAnswered`
they share — the note, the half a split keeps, and the survivor of a merge.
Each spreads one constant, `EDITED_ON_CARD`, which clears the row's
`importFailure` beside the mark: the reason describes the row as it was
submitted, and a row the user has since fixed would otherwise go on saying it
could not be saved. A split clears it on the new part as well.

`replaceRow` does not set it. Selection, a duplicate overruled, a currency
offer dismissed and a recurring link taken or let go come through
`replaceRow` too, and none of those is work: each is one press to give again.
And four real edits never come through it — the bulk switch, the bulk Keep,
the split's kept half and the merge — so a mark set there would have missed
them anyway.

**The type flip counts.** It changes what the row will write as surely as a
category pick does.

**A choice that changes nothing does not mark.** Category, currency and
country return before they write when the pick is the value the row already
has, and the bulk switch leaves a selected row already in the chosen currency
untouched — unmarked, unrounded, uncounted. The country is compared with the
one the chip displays, the location's or else the one the receipt claimed,
rather than the stored field alone: the menu offers the displayed country as
current, and a re-pick of an inferred one would otherwise mark the row.

**`rowCarriesReviewerWork(row)`** reads three things: the mark; `splitFrom`,
because a split part is made on the card rather than edited; and a non-empty
`imageMetadata.mergedReceiptIds`, which only a merge the user made writes, and
whose removal would take the merged receipt's photo with it.

**Remove.** A row carrying none of the three leaves in one press — 0108's
rule stands for it, and a blank row added by hand is one of those. Any other
opens `ConfirmDialogComponent`: *Remove this row?* and *Your changes to
{description} will be lost. To leave it out of this import and keep them,
deselect it instead*, the warn colour, the delete icon. The message names
Deselect, the reversible answer 0108 relied on.

**Confirm finds the row by id.** While the question is open, a re-check can
reconcile a verdict and hand the row back as a new object under the same id;
the object the press captured would then be found nowhere, and Confirm would
remove nothing. A row that has left the batch by then is a no-op, the rule
`mergeInto` keeps for a stale commit. The removal is announced once, after
Confirm.

The card injects the root-provided `MatDialog` without importing
`MatDialogModule`: its template renders no dialog selector, and 0128's gate
would refuse the import.

### A currency the pickers do not list can be typed

`CurrencyCodeDialogComponent`, in `shared/components`, is one field. It closes
with the code in capitals, or with nothing on Cancel, and checks in this
order:

1. **Is it a currency?** `readCurrencyCode` — the shape, trimmed and
   upper-cased, against the runtime's own ISO table,
   `Intl.supportedValuesOf('currency')`, where the runtime publishes one.
   *Not a currency code — use its three letters, such as ISK*, so `XYZ` and
   `isk1` are refused as not being codes before the rate table is asked
   anything.
2. **Can it be converted?** `CurrencyService.canRepresentCurrency` — the
   loaded rate table, or the curated list before one lands. *No exchange rate
   for {code} yet, so it cannot be converted.*

**The rate refusal is the point of the second check.** A code no table
carries reaches `getExchangeRate`'s `?? 1` and converts one-to-one against the
base currency ([0148](0148-every-figure-names-its-rate.md)'s gap), and every
total it touched would be wrong without a word. The entry refuses such a code
rather than write a row that converts at par. The check runs again on Confirm,
because the rates can land while the dialog is open. There is no `maxlength`:
cutting a pasted `EURO` to `EUR` would accept something the user did not type,
so the refusal speaks instead.

**On the card**, both currency menus end with *Other currency…*. The answer
takes the path a listed pick takes — `updateCurrency` for the row's menu,
`applyCurrencyToSelected` for the bulk one — so the rounding, the blanking
notice, the session memory, the same-value guard and the mark all follow it,
and it lands on the row as the batch holds it, found by id. Focus goes back to
the menu's own trigger by element: the entry that opened the dialog leaves with
its menu, and the dialog's default — whatever was focused when it opened —
would be a detached node, dropping focus to the document root.

**In the form**, the currency select's last option is bound to a sentinel,
`other-currency`, which is never three letters and so never collides with a
code. `mat-select` writes an option's value into the control before
`selectionChange` fires, so the handler puts the previous value back without
emitting, and only then decides whether to open the dialog: it opens only for
a pick made from the open panel. On a closed, focused select the arrow keys
and typeahead select an option without opening anything, and Material still
fires `selectionChange` for that, so an arrow press landing on the last option
would otherwise throw a dialog in front of someone who was only moving through
the list — a change of context on input. Such a pick is put back and nothing
opens. An answer goes in the scan path's order — `ensureCurrencyListed`, so
the select has an option to show it by, then the control — and the control's
subscribers take it as the hand edit it is. The control's changes are
filtered once, into the one stream both currency subscribers read, so the goal
labels, the split remainder and the session memory never see the sentinel.
Focus returns to the select.

## What was rejected

- **Announcing the bulk blank.** `NotificationService` already announces the
  snackbar that carries the count; a second call is the same sentence twice.
- **Showing `error.message` on the row**, which #430 proposed. It is a raw
  code or a provider's English, and a Firestore message does not name its
  cause.
- **One notice per set-aside row.** Only the last would stand.
- **Setting the mark in `replaceRow`.** Four of the paths that carry no work go
  through it, and four that carry work do not.
- **Asking before removing any row with content**, which #430 proposed. A row
  exactly as the scan read it is the reader's work, a rescan gives it back,
  and Deselect is one press away; the question is for work a rescan cannot
  give back.
- **Remove on the confirm step**, which #430 also proposed. The confirm step
  lists no rows, by a product decision, and a Remove there would need one.
- **Accepting any ISO code.** A code no loaded table carries converts at par.

## Consequences

- **The review card speaks.** Six row events and the verdict count are
  announced, and a per-row blank raises the notice the bulk switch raises.
- **Every announcement made through `AnnouncerService` waits for the one
  before it**, and for the gap after it. The queue is in the root service, so
  every caller shares it. A state message — the palette's result count, a
  dashboard card's position, the transaction list's count and totals —
  replaces a state message still waiting, never a queued event. Material's own
  announcements do not pass through it (see Known gaps).
- **A confirm round raises one notice.** Its outcome, the rows it set aside
  and the photos that did not attach are read together: in the error when a
  row failed, in an info notice when every row saved but a photo did not
  attach, and in the success notice otherwise. It stays up 2 s longer for each
  sentence past the first.
- **`NotificationService` takes an optional duration.** Only the wizard's
  round notice passes one; every other snackbar keeps its tone's.
- **An import record's `errors` can carry a `code`.** `firestore.rules` asks
  only that `errors` is a list, so nothing deploys; the Import History page
  still renders the message alone.
- **Nineteen catalog keys**, in all three catalogs: eight for the
  announcements (the verdict count plural), four for failure (the set-aside
  notice plural), one for the seal, two for Remove's question and four in a
  new top-level `currency` namespace beside `currencies`.
- **Continue's `disabled` DOM property is always false now.** Every
  assertion on the held gate reads `aria-disabled`; one reading `.disabled`
  would pass whatever the gate did.
- **Nothing deploys.** `editedOnCard`, `importFailure` and `importAttempts`
  are review-step marks that `toCreateTransactionDTO` never forwards, and no
  rule, index or prompt changes.
- **The wizard smoke renders what the unit describes cannot.** On the real
  stepper and card it sees a row refused twice come back unticked with its
  reason rendered; a lock on every header while a held write runs and none
  after; a press on the held Continue leaving focus in a blank row's amount
  field; and an edited row asking, Cancel keeping it, Confirm removing it, and
  the row never written.

## Departures from the issue

- **P1's fifth event was already voiced.** The issue listed five silent
  mutations, the bulk-blanked amount among them; `NotificationService`
  announces that snackbar. What shipped is six per-row events and the verdict
  count, with a country pick left silent on purpose.
- **P3 shows a reason, not the error's text**, and reads it from the code. A
  row is not re-offered a third time, as asked — it comes back unticked, where
  the user can still choose it.
- **P4 focuses as well as scrolls**, and reveals an unanswered date when no
  row is unfilled.
- **P6 is narrowed**, by a product decision: a confirmation only for a row that
  carries work made on the card, and no Remove on the confirm step. 0108's
  one-press removal stands for a bare row. The type flip counts as work; a
  choice that changes nothing does not.
- **P7's entry is a dialog** behind the last item of both menus and of the
  form's select, and it refuses a code no loaded rate can convert.

## Things that only became apparent while building

- **A blank row broke every sentence.** The first announcements interpolated
  the description as it stood, so a hand-added row was announced as
  *removed*; the edit trigger's placeholder, tried next, read as an order.
- **A Firestore message never contains its code.** A classifier that read the
  message could not have reached the connection reason on any real Firestore
  failure. `FirestoreError`'s constructor is private in the shipped typings,
  so the specs model a refusal as the `{ code, message }` object the app
  actually receives.
- **A snackbar replaces the one before it.** That is what turned one notice
  per row into one notice per round, and then folded the round's count, the
  set-aside count and the photo sentences into one notice.
- **The CDK writes a message and resolves its promise in the same task.** A
  queue that handed the next message over on that promise alone cleared each
  message the moment it was written. Specs against a stubbed announcer pinned
  the order and could not see it; the spec that did reads the real CDK live
  region.
- **`disabledInteractive` makes every `.disabled` assertion vacuous.** Seven in
  the wizard smoke read it; each would have passed however the gate behaved.
- **Two expressions guarded one gate.** They had agreed only because nothing
  pressed the held button.
- **A dialog is a window in which the row can be replaced.** Both Remove's
  question and the code dialog resolve the row by id when the answer lands.
- **A dialog opened from a menu item returns focus to a detached node**, since
  the item leaves with its menu.
- **`mat-select` writes the sentinel before anyone can refuse it.** The
  subscribers filter it; putting the previous value back without emitting is
  what keeps the select showing the real currency.
- **A closed select changes on an arrow key.** A focused `mat-select` moves
  its value with the arrow keys and typeahead without opening its panel, and
  reports each move as a selection, so the last option was one keypress from
  opening a dialog nobody asked for.
- **A spec that renders the form cannot stub `MatDialog` from the TestBed.**
  The form imports `MatDialogModule`, whose own provider shadows the TestBed's
  spy, so the rendering describe spies on the instance the component injects.

## Known gaps

- **A rules refusal reads as a dropped connection.** `permission-denied` is
  grouped with the connection codes, as a refusal worth offering a retry for;
  a document the rules will always refuse is told *The connection dropped…*
  as well, until its second failure sets it aside.
- **The mark has sixteen writers and no chokepoint.** Each handler spreads
  `EDITED_ON_CARD` itself. A new editing handler that forgets it lets its row
  leave without asking, and leaves a failed row's reason standing beside the
  edit; the specs pin one case per handler that has it, which cannot catch one
  that never did.
- **A bare scanned row still costs a rescan.** 0108's first gap stands: the
  question is asked for work made on the card, and a row as the scan read it
  leaves in one press, with nothing said about the rescan.
- **Remove is still not on the confirm step.** 0108's last gap, kept by
  decision.
- **A bulk switch counts the rows it empties; it does not name them.** 0121's
  last gap stands. The per-row chip now says that it blanked its row.
- **The lock's tooltip is a long press on a touch screen.** The `aria-label`
  carries it to assistive technology; a sighted touch user has the icon.
- **The reveal's reduced-motion branch that reads the `.reduced-motion` class
  is untested.** The OS query's branch is pinned.
- **`selectedTransactionIds` is written in five places and read by none.** The
  gate stopped reading it; the wizard still mirrors it.
- **Focus after Cancel is not pinned by a spec.** The dialog's own restore
  returns it to the pressed Remove; the unit describe stubs the dialog, which
  never takes focus away, so a spec there could not fail.
- **An uncurated code reads as itself twice.** Only the curated nineteen carry
  translated names, and `currencyInfoFor` answers any other with its own code
  as the name, so the row's menu reads *ISK · ISK*. `Intl.DisplayNames` would
  give a real one; nothing asks it yet.
- **The code dialog says what a code looks like only after a wrong one.** The
  field is labelled *Currency* and carries no hint; *use its three letters,
  such as ISK* appears only as the error for a code it refused.
- **A device that has only ever had the built-in table refuses every
  uncurated code.** The compiled-in constants cover the curated nineteen;
  until a live table lands, the dialog answers *No exchange rate … yet* to
  anything else.
- **The gap exposes a message; it does not wait for it to be spoken.** 150 ms
  is time for a rendering update to put the text in the accessibility tree,
  not for a reader to finish saying it. Whether a reader finishes a message
  before the next, or cuts it short, is the reader's own policy, and the spec
  reads the live region, not what a reader says.
- **Material's own announcements bypass the queue.** A closed single
  `mat-select` whose value an arrow key or typeahead moves calls the CDK
  `LiveAnnouncer` itself, from its closed-select keyboard handler, with the
  option's text and a 10 s duration. The CDK's `announce()` begins by clearing
  the region and cancelling a write still inside its delay, so a message the
  queue handed over less than 100 ms before is never placed, and one standing
  out its gap is replaced early. The snack bar, too, moves its text into a
  live region of its own after a delay of its own, beside the announcement
  `NotificationService` makes through the queue.
- **The form's sentinel passes through the control.** A future subscriber
  that reads the control's own changes, or the whole form's, rather than the
  one filtered stream sees it; and a dismissed dialog leaves the control
  dirty, which nothing reads today.
