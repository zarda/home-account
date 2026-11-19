# 196. Sibling controls say what they act on, a name holds its shown words, a focused button shows an indicator inside it, focus stays in the list after a delete, and a failed dashboard read is quiet

**Status:** Accepted, implemented · **Date:** 2026-11-19 · **Issues:** #546

Reference documentation lives in [../accessibility.md](../accessibility.md),
[../i18n.md](../i18n.md), [../testing.md](../testing.md),
[../emulator-blind-spots.md](../emulator-blind-spots.md),
[../dashboard.md](../dashboard.md),
[../receipt-import.md](../receipt-import.md),
[../import-fields.md](../import-fields.md),
[../translation-lens.md](../translation-lens.md),
[../household.md](../household.md), [../goals.md](../goals.md),
[../splits.md](../splits.md), [../period-totals.md](../period-totals.md),
[../receipt-quota.md](../receipt-quota.md),
[../performance.md](../performance.md), [../shortcuts.md](../shortcuts.md),
[../locale-formatting.md](../locale-formatting.md),
[../ui-overflow.md](../ui-overflow.md) and [../e2e.md](../e2e.md).

#546 gathered what the third and fourth browser runs of
[0187](0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)
met outside its issues and left under its Known gaps: controls of one
template that share one bare key as their whole name, two review-card buttons
whose names do not hold the words they show, two filter boxes named by their
placeholders alone, a keyboard-focused icon button marked by a 12% tint and
nothing else, focus dropped to the page after a confirmed delete, five
dashboard reads with no error path, and a receipt sweep that asks storage for
slots already emptied. This record gives each of those controls a name of its
own, draws Material's focus indicator inside every Material button, hands
focus to the row now in a deleted row's place, ends a failed dashboard read
without a word to the global handler, and sweeps only the slots that still
hold an image.

Three changes go past the issue's words: the AI page's key fields, links,
test buttons and model selects name their provider; the save-search box shows
a caption that says what it is for; and the focus indicator reaches every kind
of Material button, not icon buttons alone. The first browser run met four
more defects of the same kinds: two clears both named *Forget all*, a pair of
calendar buttons both named *Open calendar* (two more pairs were found beside
it), a period chip's clear named *Close*, and a toggle group with no name
(seven more were found beside it). They are fixed here, and `icon-labels:check`
gains a tenth rule for the last. The UX audit's findings on the filter panel,
the transaction list, the dashboard's links, the header and the AI page are
recorded here too.

Closes five gaps of [0187](0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md):
the sibling controls that share one bare key as their whole name, Split in tc
and Merge into… in en not named by the words they show, the filter panel's
two text boxes named by their placeholders alone, the keyboard-focused icon
button marked only by Material's state layer, and the five dashboard reads
with no error path.

Narrows one more of 0187's, *Focus can still fall past a menu*: a confirmed
Delete no longer drops focus once its row leaves the list. The datepickers
opened from a menu's entry still give focus back to the detached entry.

Applies [0007](0007-transactional-receipt-edits.md) to the three receipt
sweeps: storage deletes stay first, and a clear removes what existed when it
was asked for. Works beside
[0197](0197-a-deleted-transaction-can-be-brought-back-for-ten-seconds-because-the-delete-waits.md),
whose deferred delete takes a confirmed row out of the list at once, which is
when this record's hand-off runs.

## Context

**Siblings.** The sixth rule of `icon-labels:check` reads controls stamped once
per item. A control rendered once can share its whole name with another of its
own template, and no rule read that. A scan can offer a currency and a
position at once, and the transaction form's two offers each had a dismiss
beside them, both *Close* (`common.close`), beside the form dialog's own
*Close*. Each of the AI page's three provider cards held a remove for its key,
all three *Remove* (`common.remove`), under fields all labelled
`settings.apiKey`. A screen reader moving between them heard one name again
and nothing that said which offer it closed or which key it removed. A scan of
one template for two controls under one key cannot tell controls shown
together from the arms of an `@if` that never show at once.

The AI page's cards were alike in more than their removes. Each card's key
field read *API Key*, its link *Get API Key* and its button *Test Key*, the
same words on every card, and the two cards that hold a model select both read
*Model*.

**Shown words.** A speech-input user says the words a control shows, and
reaches it only if its name holds them (WCAG 2.5.3). The review card's merge
trigger showed *Merge into…* in en while its name read *Merge
{{description}} into another row*; its split trigger showed *分割* in tc while
its name said *將「{{description}}」分成兩列*. Axe's
`label-content-name-mismatch` cannot gate this in Karma, as 0187 found: it is
experimental and off, and forced on it reads an icon's ligature as visible
text.

**The filter boxes.** The search box was named by its placeholder alone,
*Search transactions...*, whose words go once the box holds a query. The
save-search box was named by its placeholder too, *Name this search...*, and
it opens holding the query as the name it offers, selected, so its
placeholder, the only words that said what the box is for, showed only once
the box was emptied.

**A focused button.** Material's icon button sets `outline: none`, which wins
over the app's `:focus-visible` outline, and the focus indicator Material
draws, which every Material button already carries as a hidden `::before`, was
not turned on. A keyboard-focused icon button showed a 12% tint and no
outline, across the app. No one outline colour and offset reads 3:1 on every
surface an icon button sits on: the app's `--color-primary` outline scored
2.60:1 round the clear button on the dark period chip, and 1.09:1 inside the
filled picker button.

**A confirmed delete.** The confirm gave focus back to the row's menu button,
or to its swipe drawer's Delete, and the row's leaving took that control with
it, so focus fell to the page. The issue's fallback, the list's heading, does
not exist, and the select toggle shows only for an account in a household.

**The dashboard's reads.** `DashboardComponent` subscribed to `getBudgets()`,
`getGoals()` and `loadCategories()` with nothing to take an error, and to the
recent rows and the upcoming window with a `next` callback alone. RxJS rethrew
a failing listener from a timer in the Angular zone, where AngularFire runs
every listener callback, so it reached `GlobalErrorHandler`: a console error
per read and the *Error* snackbar, which the handler shows at most once every
ten seconds. Deleting the site's IndexedDB under a signed-in page makes
Firestore terminate and fails every live listener with *Firestore shutting
down*, so five errors were logged under one snackbar.

**The receipt sweep.** Deleting a transaction, wiping the account's
transactions and removing every receipt of a transaction each asked storage
for every slot of the receipt array, gaps included. An image removed earlier
had taken its object with it, so storage answered not-found for its slot and
the console logged an error. `deleteReceiptSlots` counts not-found as
deleted.

## Decision

### Two dismissals and three removes say what they act on

The form's two dismissals read keys of their own,
`transactions.dismissCurrencySuggestion` and
`transactions.dismissPositionSuggestion`: *Dismiss the currency suggestion*
and *Dismiss the location suggestion*, ja *通貨の提案を閉じる* and
*場所の提案を閉じる*, tc *關閉貨幣建議* and *關閉地點建議*. The position offer sits
under the form's location field, and en names it by that word. The dialog's
own *Close* keeps its word, so the form's three close buttons read apart when
all of them show. `.suggestion-dismiss` keeps its class.

Each of the AI page's removes reads one key with a slot,
`settings.removeApiKey`, *Remove the {{provider}} API key*, filled with the
provider's short name. The page keeps that short name beside the full one in
`allProviders` and reads it through `providerName`.

### The AI page names each provider

- **The key fields** read `settings.apiKeyFor`, *{{provider}} API key*, with
  the short name: *Gemini API key*, ja *Gemini APIキー*. The full names would
  be cut by Material's label ellipsis at 320px: a mutant with them read a
  field of 190px at rest against labels of 192 to 231px in en, ja and tc.
- **The *Get API Key* links and *Test Key* buttons** keep the words they show,
  which the overflow spec pins, and carry an `aria-label` that holds those
  words and adds the provider: `settings.getApiKeyFor`, *Get API Key for
  {{provider}}*, and `settings.testApiKeyFor`, *Test Key for {{provider}}*.
  The test button's name is bound while it is idle too, not only while its
  spinner shows, so the case that pinned no name on an idle button now pins
  the name. tc reads *測試金鑰：{{provider}}*, as *檢視交易：「…」* is built,
  since *測試 Gemini 金鑰* would not hold the shown *測試金鑰* whole.
- **The two model selects** read `settings.modelFor`, *{{provider}} model*,
  ja *{{provider}} モデル*, spaced as the key field on the same card is.
- `settings.apiKey` and `settings.modelLabel` leave the three catalogs with
  their last readers.

### A ninth rule: two controls that can show together do not share a bare key

`icon-labels:check` gains a rule. Two controls of one template, each named by
an `aria-label` that is one key with no parameters (a ternary's either branch
counting as its key), fail when both can render at once.

- **Blocks keep controls apart.** Each `@if`, `@else if` and `@else` is an arm
  of one chain, and each `@case` and `@default` an arm of its switch
  (`armOf`). An `@else` takes its chain from the arm the same run of text
  closed last, which Angular puts just before it. The template walk hands each
  element its arm ancestry, and two controls never render at once when, at the
  deepest chain both sit in, they sit in different arms (`exclusiveArms`). So
  the two arms of an `@if…@else` may share a name and two independent `@if`s
  may not.
- **The cases of a switch on the nearest `@for`'s own item are no arms**: each
  item renders its own case, so two cards show two of them at once. An
  `@defer` and the blocks after it, and an `@for` and its `@empty`, are read as
  rendering together.
- **Only what the sixth rule leaves.** A control stamped once per item, or
  reached by two cases of one held-apart switch, is the sixth rule's and is
  reported there, once (`readPerItem`).
- **Only a control named by its `aria-label`.** Two controls named by their
  own text read the words a sighted user sees too.
- **One template.** Which templates share a page is decided at run time.

The rule has no freeze list; every hit was fixed. Run over the tree before the
fixes, it hit exactly the five controls #546 lists. Today it reads 35 controls
rendered once and named by a bare key, and none shares a key with a control
that can show beside it. Its self-test runs it as the run does, across
templates with the sixth rule's verdict handed on, and nine mutants of the
rule (an `@else` not handed its chain, the case arms dropped, the shallowest
shared chain taken, a ternary not split, the per-item controls not left out,
text-named controls read too, among them) each failed it.

### A name holds the words its control shows

A name **contains** the words its control shows, whole, both read without
regard to case in the reader's locale (`holdsShownWords`, in
`core/services/testing/axe.ts`). It need not open with them. The review
card's cases leave the icon's ligature out of the shown words and fold a
trailing ellipsis away.

- **Merge** shows *Merge…* in en, as ja *結合…* and tc *合併…* already did, and
  its name is unchanged: *Merge {{description}} into another row* holds
  *Merge*.
- **Split** in tc is named *分割「{{description}}」成兩列*, which holds the
  shown *分割*. `QUOTES_A_REAL_DESCRIPTION` is unchanged.
- The describe *a row action's name holds the words it shows* in
  `transaction-preview-table.component.spec.ts` holds Split, Merge and Remove
  on a titled row, and Split and Remove on a blank one, which is offered no
  Merge, in en, ja and tc. Red before the fix it read
  `"Merge Coffee Shop into another row" holds "Merge into"` and
  `"將「Coffee Shop」分成兩列" holds "分割"` false, on both rows; ja passed.

### The search box is named, and the save box shows a caption

**The search box** carries an `aria-label` in its placeholder's own words
without the ellipsis, `transactions.searchBoxLabel`: *Search transactions*,
ja *取引を検索*, tc *搜尋交易*. The placeholder stays. A case removes the
placeholder and still reads the name, in all three languages.

**The save-search box** gets a caption inside its pill, stacked above the box:
a real `<label for>` reading `transactions.saveNameLabel`, *Name for this
search*, ja *この検索の名前*, tc *此搜尋的名稱*. The box's id comes from a
counter, so each panel's label names its own box. The caption is the panel's
muted hint text, `--text-muted` at `--text-xs`, and it wraps rather than being
cut. It shows whenever the box does, holding the query or emptied, and it is
the box's name. The placeholder goes, and `transactions.searchLabelPlaceholder`
leaves the three catalogs. The pill grows from 48 to 60px (8px of padding, an
18px caption, a 2px gap and a 24px box); at a 336px host in Karma the pill is
312 × 60, the caption whole and Save and Cancel 40 × 40 inside it. The
caption reads AA on the pill in all four palettes. A mutation that faded and
clipped the caption failed four cases: the 336px case in en, ja and tc
(scroll widths 126, 84 and 72 against 40) and the plain palette's AA, at
2.75.

### A focused Material button shows an indicator inside it

Every Material button, of every kind, shows Material's own focus indicator,
a solid line in the button's own text colour, inside the button:

```scss
.mat-mdc-button-base {
  --mat-focus-indicator-display: block;
  --mat-focus-indicator-border-color: currentColor;
  --mat-focus-indicator-border-width: 2px;
}
```

- **3px under high contrast**, on `.high-contrast .mat-mdc-button-base`.
- **The text colour**, because it is what the button's label or glyph already
  reads in against what the button sits on, so the indicator reads wherever
  the button does.
- **Inside.** Material draws the line a few px past the edge of a flat,
  raised, stroked or tonal button and the FAB, where the label's colour meets
  the page rather than the fill (a flat button's white label on a white card
  is 1:1), and where a parent that clips its overflow cuts it off. A
  `margin: 0` on each kind's `.mat-focus-indicator::before` at (0,3,1)
  outranks Material's own (0,2,1). The FAB's line follows the FAB's corner,
  and the mini FAB's its own smaller one. Text and icon buttons already draw
  it inside.
- **An icon button's 12% focus state layer goes**
  (`--mat-icon-button-focus-state-layer-opacity: 0`): it tints the fill under
  the indicator, and took a pinned history pin on dark `--surface-muted` from
  3.99:1 to 2.86:1.
- **The app's outline gives way** on a focused Material button through
  `.mat-mdc-button-base:focus-visible { outline: none }` at (0,2,0), over the
  app's own `:focus-visible` at (0,1,0), whichever stylesheet reaches the page
  first; the app and Karma load the sheets in opposite orders. The rule sits
  under `@media (forced-colors: none)`, so forced-colours mode keeps the
  outline Material draws there.
- **A held button**, disabled but kept focusable so a keyboard user reaches it
  and the hint that says why it is held, draws its line in
  `--mat-sys-on-surface-variant`. In its 38% label colour the line scored
  2.2:1 to 2.7:1. The rule names both `.mat-mdc-button-disabled` and
  `.mat-mdc-button-disabled-interactive`, since Material sets the second
  whether or not the button is held.
- **A framed control shows one outline.** The frame mixin in
  `src/theme/_a11y.scss`, which draws the upload area's outline round the zone
  while Browse holds focus, now also hides the indicator of the control it
  frames, so Browse shows one outline, not two.

Chips, menu items, tabs, switches, checkboxes, radios and button toggles keep
their own focus look, and hand-rolled controls keep the app's outline.

`src/app/focus-indicator.spec.ts` reads the rules from the stylesheet (the
three tokens, the 3px width, the icon button's state layer, the outline
cleared outside forced colours alone, each kind's margin and the FAB's and
mini FAB's corners outranking Material's own) and measures the rendered
indicator through `readIndicator` and `expectIndicatorInEveryPalette` in
`core/services/testing/focus-indicator.ts`, in all four palettes, with
Material's focus state layer laid under it. The filters' spec measures Save
and Cancel on the save-search pill and each suggestion's remove on their real
template, and the answer history's spec an open row's pinned pin. Measured in
Karma, plain and dark, high contrast equal to its scheme: an icon button on a
card 9.33 and 12.92, on the page 8.56 and 14.52, on the save pill 8.48 and
10.67, in a field's suffix and in the suggestions 9.33 and 12.92, the pinned
pin 6.24 and 3.99, the period chip's clear 8.34 and 6.96, the filled picker
button 6.29 and 5.95, a dialog header's close 8.87 and 14.36; on their own
fill, flat 4.97 and 6.32, text 5.45 and 7.50, stroked 5.45 and 7.50, raised
5.18 and 8.58, the FAB 5.96 and 5.50. Without the margin rules the flat case
falls to 1.00 (1.27 in dark); without the state-layer rule the pinned pin in
dark reads 2.86. A copy of the outline rule under another query fails:
`Unexpected $[0] = 'screen: .mat-mdc-button-base:focus-visible { outline: none; }'`.

### Focus stays in the list after a confirmed delete

Once a confirmed delete's row leaves, focus goes to the menu button of the row
now in its place, else of the row before it, else to the empty state's
button, and only if focus fell to the document. The chain names both views'
menu buttons for each row, `.action-btn` in the desktop table and
`.row-menu-btn` in the phone list, since only one view renders and which one
can change while the confirm is open, then `app-empty-state button`. It goes
through `focusWhenRendered` with `onlyIfDropped`, so focus the reader has
moved meanwhile stays where it is.

- **The list follows the row.** A confirm that closes on Delete arms
  `deletedRow`, `{ id, index }`. The index is read as the confirm opens, so a
  row that goes while it is open still has a place, and is kept current while
  the row is listed, so rows that load above it move its place with it. An
  effect on the sorted rows hands focus on once the id has gone, and disarms.
- **The row leaves at once.** The page hides a confirmed row while its delete
  waits out the Undo window
  ([0197](0197-a-deleted-transaction-can-be-brought-back-for-ten-seconds-because-the-delete-waits.md)),
  so the hand-off runs as the confirm is answered, not after a refresh.
- **A list still loading waits.** If the row's leaving leaves no row and no
  empty state, the list is still loading past a filter only the loaded rows
  are matched against; the arm stays, and the hand-off runs on the next change
  that brings a row or the empty state.
- **The swipe door lands where a menu does.** The drawer shuts as its Delete
  is pressed, which hides that button and moves it off-canvas, so a confirm
  the drawer opened, cancelled or not, gives focus to the row's
  `.row-menu-btn` (`restoreFocus` with the row's two menu-button selectors,
  read as the confirm closes).
- **A row that comes back** (its Undo, or a delete that failed) is followed no
  more; the page tells the list (`deleteUndone`, `deleteFailed`), which
  scrolls to it and offers focus to its menu button (0197).

The describe *focus after a dialog a row menu opened* in
`transaction-list.component.spec.ts` deletes from the desktop menu, the
phone's menu and the swipe drawer. Red before the fix, 12 cases failed, each
`Expected <body>...</body> to be <button ...>`. The emulator smoke
`delete-undo.smoke.spec.ts` deletes by keyboard through the real menu and
confirm; with the hand-off made to prefer the row before, it read
`Timed out waiting for: focus on the menu button of the row now in the place of the one deleted; found focus on button…row-menu-btn… in row <newer>`.

### A failed dashboard read is quiet and touches nothing

Each of the five reads takes an error callback, `readStopped(read)` in
`dashboard.component.ts`. It returns without a word on `aborted`, which is
Firestore shutting down, and on a refusal (`isRefused`, `permission-denied`),
which is what an open listener hears when the account signs out under it.
Anything else logs one warning, `[Dashboard] The <read> read stopped; the page
keeps what it last showed:` with the error.

Nothing else is touched. Every card keeps what it last showed, and no new copy
is shown. `upcomingArrived` is left as it was, so a pending `?bill` link is not
answered "absent" from a window that never emitted; a link followed after a
read that had painted and then failed is still asked of the window the card
shows.

The describe *a live read that fails* in `dashboard.component.spec.ts` holds
each read with `unavailable`, `aborted` and `permission-denied`, delivered
inside the Angular zone as AngularFire delivers them. A macrotask later nothing
reached `NgZone.onError`, the `ErrorHandler` double or `console.error`, and
the card's last value is still shown. Before the fix every case failed on
`NgZone.onError: Expected $.length = 1 to equal 0`. With the upcoming window
marked as arrived on a failure, the bill cases read
`the card is asked: Expected 'r2' to be null`.

### The receipt sweep asks only for slots that hold an image

`removeAllReceipts`, `deleteTransaction` and `wipeTransactions` hand
`deleteReceiptSlots` the slots of `receiptImageSlots(transaction)`, the slots
that held an image when the row was read, rather than every slot of the
array. `removeAllReceipts` keeps `slotSpan` for its tombstones and tombstones
only a slot it swept, inside that span. Another device can append past the
span seen at read time or, once its own removal has truncated trailing
tombstones, into a slot that was empty then; either way that image is neither
swept nor tombstoned, and it survives the clear with its object.

The cases *sweeps every slot still holding an image and clears the receipt
fields* and *sweeps only the slots of a multi-image transaction that still
hold an image, gaps skipped* expect slots 0 and 2 once slot 1 was emptied; red
before the fix, `Expected $[2].length = 3 to equal 2`. A wipe case, *skips a
receipt slot whose image was removed before the wipe*, and a racer case,
*leaves an image another device appended into a slot that was empty at read
time*, sit beside them. The emulator smoke *deletes every stored object when
the transaction is deleted* pins the sweep to slots 0 and 2 and still finds
every object gone.

### The memory clears and the calendar pairs are named apart

The first run met two more sets of siblings.

- **The AI page's two *Forget all*.** The remembered-categories card and the
  remembered-tags card each end in a clear, and both read *Forget all* in en
  and tc. Each now carries a bound `aria-label` of its own,
  `aiPage.categoryMemoryClearLabel` and `aiPage.tagMemoryClearLabel`, *Forget
  all remembered categories* and *Forget all remembered tags*, which holds the
  words it shows and names the memory; the name is bound while the button is
  disabled too, and the shown words do not change. Before, both were named
  by their own text, the shape the ninth rule leaves out, so no gate had
  caught them.
- **Calendar buttons in pairs.** The filters' From and To each end in a
  calendar button, and both took the calendar's shared *Open calendar*. The
  recurring rule's Start and End date, shown together once the rule has an end
  date, and the household budget's start and end dates, always shown together,
  had the same pair. All six toggles read one key with a slot,
  `datepicker.openCalendarFor`, *Open calendar: {{field}}*, filled with the
  field's own label: *Open calendar: From*, ja *カレンダーを開く：開始*, tc
  *開啟日曆：從*. The name goes through the toggle's `aria-label` input, which
  Material hands to its inner button in place of the shared label; every
  other date field of the app stands alone and keeps *Open calendar*. The
  filters first read two keys of their own and moved onto the slotted one
  afterwards, with the same words in all three languages.

### The period chip's clear says what it clears, and hands focus on

A chosen month or year shows as a chip on the dashboard, the household
overview and Reports. Its button was named *Close*, though it closes nothing:
it clears the period and returns to the quick ranges. It reads
`dashboard.clearPeriod`, *Clear {{period}}*, filled with the chip's own words:
*Clear Oct 2026*, ja *2026年10月をクリア*, tc *清除 2026年10月*.

The chip and its button leave with the period, so focus on the button fell to
the page. A clear that held focus now hands it, once the render has checked
it, to the quick range the period returns to, *This Month*; a clear made while
focus is elsewhere leaves focus there.

### A single-choice group has a name, and a tenth rule holds it

A `mat-button-toggle-group` that is not `multiple` renders `role="radiogroup"`
on its host, and a screen reader entering one says the group's name before
its first choice. The category manager's Expenses / Income group had none. It
reads `settings.categoryType`, *Category type*. Seven more single-choice
groups had none either, and each now carries a name from the catalogs, none of
them beside a visible label: the transaction form's, the recurring rule's and
the category breakdown's type (`transactions.type`, *Type*, the word the
filters already label that choice with), the goal form's kind
(`goal.kindLabel`, *Goal type*), the contribution's direction
(`goal.directionLabel`, *Add or take back*), the forecast's horizon
(`reports.forecastPeriod`, *Forecast period*) and the period selector's quick
ranges (`dashboard.period`, *Period*). The period selector's key is new
because tc's `settings.period` is *週期*, a recurrence cycle, not a span of
time.

The tenth rule of `icon-labels:check`: a single-select toggle group, a
`mat-radio-group` and any element with a literal `role="radiogroup"` carry
`aria-label` or `aria-labelledby`, in any spelling, with a value that is not
blank (`readGroups`, `scanUnnamedGroups`). A `multiple` group renders
`role="group"` and is not read. It reads 12 groups today, all named, and its
hint quotes the category manager's binding as its model. With the category
manager's name taken off, the gate fails at that template.

### Targets and layouts the audit found on these screens

- **The dashboard's two *View All* links** are 40px tall
  (`min-height: 40px` on `.view-all-link`), their words centred where they
  were; the header row was already that tall for the card's menu.
- **The shortcuts hint's dismiss** in the header is a 40px button, with still
  no 48px touch span spilling past the hint.
- **The filter panel's *Clear all*** keeps the 40px floor, its words centred,
  and the panel's 12px padding still holds its focus outline inside the
  clipping container.
- **The phone's period totals** never start a wrapped line with a dot. Each
  part leads with its dot, the parts' start margin puts the dot of whichever
  part starts a line outside the line's box, and the line's
  `clip-path: inset(-24px -6px)` cuts it. The clip stands 6px out at either
  end, so an action that starts or ends a line keeps its whole focus outline,
  and 24px out above and below, so the actions' 40px tap targets stay whole.
- **The AI page's *Recommended* chip** stands in the Gemini card's header row:
  at the row's end, level with the avatar, where the title and the chip fit,
  and on a line of its own where they do not. The title block is capped at the
  room beside Material's 40px avatar, so the row breaks before the chip and
  never before the title. The chip ends at the header's padding, and the
  file's direction ratchet drops by the right offset it no longer sets.

## What was rejected

- **One outline for every button, in one colour, outside or inside.** No
  colour and offset read 3:1 on every surface: outside, 2.60:1 on the dark
  period chip; inside, 1.09:1 in the filled picker button.
- **Material's indicator where Material draws it.** Outside a filled or
  outlined button the label's colour scores about 1.0:1 against the page, and
  an `overflow: hidden` parent cuts it off.
- **The indicator on icon buttons alone**, as #546 asks. Text, flat, stroked
  and raised buttons and the FAB would have kept the app's outline, a second
  focus look beside the first.
- **Full provider names in the AI page's field labels.** Material's label
  ellipsis cuts them at 320px.
- **Names that open with their shown words.** "Opens with" would force an
  unnatural Japanese name, whose verb ends the sentence.
- **A naive sibling rule**, two controls of one template under one key. It
  cannot tell the arms of one `@if…@else` from two independent `@if`s; the
  rule reads the arm ancestry instead.
- **A Material outlined field for the save box.** It would be a second look
  beside the search pill it opens from.
- **A label for the save box that only a screen reader reads.** The box was
  first named by an off-screen label; a sighted reader still saw nothing that
  said what the box was for while it held the query, so that label became the
  caption.
- **Storing the control that held focus in the delete's arm.** It always
  leaves with the row, and the view can change while the confirm is open, so
  both views' menu buttons are named instead.
- **The drawer's own Delete as the swipe door's landing.** It is shut by then,
  `tabindex="-1"` and `aria-hidden`.
- **A list heading or the select toggle as a fallback.** The list has no
  heading, and the toggle shows only in a household.
- **Clearing a card, or answering a bill link, when a read fails.** The card
  keeps what it last showed, with no state change and no new copy; marking the
  upcoming window as arrived would answer a waiting link "absent" for every
  rule.
- **An emulator case for the dashboard shutdown.** A shutdown in the smoke
  would break the app every later case shares.
- **Reusing `settings.period` for the period selector's group.** In tc it is
  a recurrence cycle.

## Consequences

- A screen reader hears *Dismiss the currency suggestion*, *Dismiss the
  location suggestion* and *Close* on the form, and a remove, a field, a link
  and a test button per provider on the AI page, and a model select on the
  two cards that hold one, each apart.
- A speech-input user saying *Merge* in en or *分割* in tc reaches the review
  card's button. en shows *Merge…* where it showed *Merge into…*.
- The search box keeps its name while it holds a query. The save box shows
  what it is for while it holds one, and its pill is 60px tall where it was
  48.
- A keyboard user sees a 2px line, 3px under high contrast, inside every
  focused Material button, in the button's own text colour. Icon buttons lose
  their 12% focus tint, and no Material button shows the app's outline outside
  forced colours.
- After a confirmed delete from any of the list's three doors, focus is on the
  menu button of the row now in its place.
- Clearing the period chip by keyboard puts focus on *This Month*.
- Eight more single-choice groups announce what they choose.
- A dashboard read that fails leaves the card as it was and logs one
  `[Dashboard]` warning, or nothing for a shutdown or a refusal; the *Error*
  snackbar no longer shows for it. The dashboard shutdown has no emulator
  surface: a shutdown in the smoke would break the app every later case
  shares, so the unit cases hold it, and the browser run's last step read it.
- A delete, a wipe or a clear asks storage for no slot whose image was removed
  before, so the not-found line for such a slot is gone. A row that holds a
  receipt count but no URL, which is inconsistent data, used to be swept at
  slot 0 and now sends an empty slot list, since no URL names an object there.
- `icon-labels:check` gains its ninth and tenth rules; its self-test passes
  323 cases today. The eighth rule's account of what it cannot see no longer
  cites the AI page's test buttons, which are named in both states now.
- New catalog keys, in en, ja and tc: the two dismissals, the four AI page
  keys with a provider slot and `settings.modelFor`, `searchBoxLabel`,
  `saveNameLabel`, the two memory clears, `datepicker.openCalendarFor`,
  `dashboard.clearPeriod` and five group names. `settings.apiKey`,
  `settings.modelLabel` and `transactions.searchLabelPlaceholder` leave them.

## What the browser runs found

### Run 1, on 19 November 2026

The UX audit walked the touched screens first, on 18 November, against the
local emulators, the app served from this branch's checkout on port 4300 with
the bundle naming `demo-home-account` alone, signed in as Alex, at 1024 and
320px in the light scheme, with the pane hidden. The run proper, journeys 121
to 124 ([../e2e.md](../e2e.md)), drove the same set-up on 19 November with
every change for #546 in, signed in through a session record written into the
page, emulators only. The pane emulated 1024×768 in an 800×600 view and
painted about four frames a second, so every read followed a flush and
finished animations; anything `:focus-visible` was reached by real keys, and
the swipe door by the pane's own drag. It read en, ja and tc, light and then
dark through Settings' Theme control, 375px dark and 320px light. Journeys 121
and 123 hold this record's parts.

- **Siblings and the AI page.** With both offers set on the form's state, its
  three closes read *Dismiss the currency suggestion*, *Dismiss the location
  suggestion* and *Close*; ja *通貨の提案を閉じる* / *場所の提案を閉じる* /
  *閉じる*; tc *關閉貨幣建議* / *關閉地點建議* / *關閉*. On `/ai`, with three
  keys set in the page's state (no blur, no press), each field read *Gemini
  API key* or its provider's short name the same way, each remove *Remove the
  … API key*, each link *Get API Key for …* and each test button *Test Key for
  …*, the provider filled in; ja and tc held their shown words. The floating
  labels were whole at 320px in en, ja and tc.
- **Split, Merge… and Remove.** On a two-row CSV's review card, every name held
  its shown words, the ellipsis folded, and its row, in three languages; the
  two rows read apart; en's Merge showed *Merge…*.
- **The filter boxes.** The search box was named *Search transactions* with
  and without its placeholder (ja *取引を検索*, tc *搜尋交易*). The save box was
  named by its real label, *Name for this search* (ja *この検索の名前*, tc
  *此搜尋的名稱*), 12px, shown while the box held *Parking*; Save and Cancel
  40 × 40. The caption read on its pill 6.87 plain, 9.37 high contrast, 5.84
  dark and 11.12 dark high contrast. At a 280px host the caption was whole at
  152px, the pill 256 × 60, Save and Cancel 40 × 40 inside it.
- **The focus indicator, on eleven kinds of button.** Each was read after a
  real Tab or Shift+Tab, `:focus-visible` true: Material's indicator, display
  block, 2px (3px in both high-contrast palettes), margin 0, in the button's
  text colour, the app's outline none. Against what it is drawn over, plain /
  high contrast / dark / dark high contrast: the desktop row menu 8.87 / 8.87
  / 14.36 / 14.36; the FAB 5.97 / 5.97 / 5.52 / 5.52, on its 16px corner; the
  text button Select 5.02 / 5.02 / 8.71 / 8.71; Save search in the pill 8.48
  / 8.48 / 10.67 / 10.67; the period chip's clear 8.34 / 8.34 / 6.96 / 6.96;
  the month picker with a month chosen 6.29 / 6.29 / 5.95 / 5.95; the receipt
  viewer's header close 8.87 / 8.87 / 14.36 / 14.36 and its footer Close 5.19
  / 5.19 / 8.57 / 8.57; the flat Add Goal 4.95 / 4.95 / 6.29 / 6.29; the
  stroked Contribute 4.94 / 4.94 / 7.77 / 7.77; a pressed history pin 6.30 /
  6.30 / 5.43 / 5.43.
- **Focus after a delete, from three doors.** From the desktop menu by
  keyboard (Enter on the menu button, End, Enter, Tab, Enter), the confirm
  read *Are you sure you want to delete "e2e two images"?*; the row left at
  once, 15 rows to 14, and focus was on the menu button of the row now at
  index 1, `:focus-visible`. From the phone's menu at 375px, dark, the row
  left at once, 13 to 12, the totals went from $2,550.98 to $2,538.98, and
  focus was on the menu button of the row now at index 1. The swipe door, a
  drag of the pane's pointer from 234 to 84, opened the drawer (Edit and
  Delete 72 × 83, named with the row); Delete and the confirm left the row and
  put focus on the `.row-menu-btn` of the row now at index 0. Undo from each
  door is [0197](0197-a-deleted-transaction-can-be-brought-back-for-ten-seconds-because-the-delete-waits.md)'s.
- **The receipt sweep.** A row of three images had its middle one removed
  through the receipt manager (`receiptUrls` `[url, '', url]`, `receiptCount`
  2) and was deleted. Once the delete was real, Storage received two
  requests, `DELETE …/receipts/<id>` and `DELETE …/receipts/<id>_2`, none for
  slot 1, and no object was left.
- **The dashboard shutdown, the run's last step.** With `/dashboard` open as
  Alex, the origin's IndexedDB was deleted. Firestore terminated with the
  SDK's own warnings; the app logged `[OfflineQueue] Closing so a newer
  version can open` and `RowSharing`'s line that the account's households were
  not read. No `[GlobalErrorHandler]` line, no error-level console line, no
  window error or unhandled rejection and no *Error* notice followed; the
  cards kept what they showed, and the session stayed, since it lives in
  `localStorage`.
- **Contrast and the sweep.** In dark, a contrast sweep of every text node
  against its composited background, shown to fail on a planted line at 2.72,
  found nothing under its bar on `/transactions` with the filters open, on
  `/ai` or on the dashboard. At 375px dark, `/dashboard` and `/ai` scrolled
  nothing sideways and held no unnamed control, no text under AA and no target
  under 24px.

**The audit's findings, re-walked.** They were read again at 320px light,
375px dark, 1024px in both schemes and in ja and tc at 320px.

- **The dashboard's *View All* links** were 68 × 21 on 18 November, under the
  24px minimum; they read 68 × 40 at 1024 and at 320px. Fixed by `fix: Recent
  Transactions' View All is a 40px target` and `fix: Upcoming Bills' View All
  is a 40px target`.
- **The shortcuts hint's dismiss** was 32 × 32; it read 40 × 40 at 1024. Fixed
  by `fix: the shortcuts hint's dismiss is a 40px target`.
- **The AI page's *Recommended* chip** at 320px sat on the provider's title,
  chip x 167 to 279 over title x 89 to 260 in one row, reading *Google
  [RECOMMENDED]*. It stands at y 556 under the title (y 503 to 532), no
  overlap, and the three titles stand beside their avatars. Fixed by `fix: the
  AI page's Recommended chip stands clear of the provider's title`.
- **The filter panel's *Clear all*** was 94 × 33; it read 94 × 40. Fixed by
  `fix: the filter panel's Clear all is a 40px target`.
- **The phone's period totals** at 320px wrapped with a separator leading the
  second line, *· Net Balance*; the second line starts *Net Balance*, with no
  leading separator. Fixed by `fix: the phone's period totals never start a
  wrapped line with a dot`.

Struck by the audit on these screens: the header's three icon buttons overlap
their neighbours' touch spans by 4px each way, which is Material's own layout
for adjacent 40px buttons; and a dashboard row's `.row-head` is 24px tall
inside an 83px row.

**Found:** four defects of this record's kinds, all small, each fixed with a
spec red before its fix and read again in the browser the same day, at
1024×768 in dark, in en, ja and tc through the live language switch. A fifth,
the sign-in page with no heading, is
[0194](0194-one-painted-contrast-helper-and-one-focus-hand-off-a-card-is-scored-part-by-part-and-no-page-skips-a-heading-level.md)'s.

- **Two *Forget all* on `/ai`.** The two memory clears showed together, both
  *Forget all* in en and tc; ja differed only by chance, *すべて削除* and
  *すべて忘れる*. Red: `nothing to forget: the two names, apart: Expected 'Forget all' not to be 'Forget all'.`
  Fixed by `fix: the AI page's two Forget all buttons say what they forget`
  and `test: the two memory clears are named apart, in three languages`. Read
  again: *Forget all remembered categories* and *Forget all remembered tags*
  (ja *記憶したカテゴリをすべて削除* / *記憶されたタグをすべて忘れる*, tc
  *將已記住的分類全部忘記* / *將已記住的標籤全部忘記*), each holding its shown
  words, 40px tall.
- **Two *Open calendar* in the filters.** From's and To's calendar buttons
  shared one name, and the fix found the same pair in the recurring-rule
  dialog and the household budget dialog. Red, on the recurring dialog:
  `the two names, apart: Expected 'Open calendar' not to be 'Open calendar'`.
  Fixed by `fix: the filters' two calendar buttons name their date field`,
  `test: the From and To calendar buttons read apart` and `refactor: the
  filters' calendar buttons take the one slotted name`. Read again: *Open
  calendar: From* / *Open calendar: To* (ja *カレンダーを開く：開始* /
  *カレンダーを開く：終了*; tc *開啟日曆：從* / *開啟日曆：至*), 40 × 40; the
  recurring dialog *Open calendar: Start Date* / *Open calendar: End Date
  (Optional)*; the household budget dialog *Open calendar: Starts on* /
  *Open calendar: Ends on (optional)*; the transaction form's single toggle
  still *Open calendar*.
- **The period chip's clear named *Close*.** Red:
  `"Close" closes nothing: Expected 'Close' not to be 'Close'.` Fixed by `fix:
  the period chip's clear button says what it clears` and `test: the period
  chip's clear button is named for its period`. Read again, with October 2026
  chosen: *Clear Oct 2026* / *2026年10月をクリア* / *清除 2026年10月*, holding the
  chip's words, 24 × 24; a real Enter on the focused clear took the chip away
  and left focus, `:focus-visible`, on the checked *This Month*.
- **The category manager's type group with no name.** Red:
  `the group's name: Expected '' to be 'Category type'.` Fixed by `fix: the
  category manager's type group has a name` and `test: every toggle group of
  the app has an accessible name`. Read again, every group a `radiogroup`:
  the category manager *Category type* / *カテゴリの種類* / *類別類型*, the
  period selector *Period* / *期間* / *期間*, Reports' Categories *Type* /
  *種類* / *類型* and Forecast *Forecast period* / *予測期間* / *預測期間*, the
  recurring rule and the transaction form *Type*, the goal form *Goal type* /
  *目標の種類* / *目標類型*, the contribute dialog *Add or take back* /
  *追加するか戻すか* / *存入或取回*; Settings' Theme and Font size were named
  already. `/settings` and every Reports tab held no unnamed control.

The console at the re-read held one 404 and three `ERR_CONNECTION_REFUSED`
lines, as the run's own did, since that set-up starts no functions emulator.

Seen and left open: the boxes of the desktop row menu's `.action-btn` and of
the form's `.suggestion-dismiss` read 32 × 32 (*Focus after a delete*, under
Known gaps, says what their targets are); and after Continue, Material moves
focus to the import's Review step header, whose focus state layer reads as a
grey block in dark.

## Departures from the issues

- **"Contains", not "opens with".** #546 proposed names for Split and Merge
  that open with their visible words. A name holds them whole instead (What
  was rejected).
- **en's shown Merge text changed, not its name.** *Merge into…* became
  *Merge…*, as ja and tc already showed; the name is unchanged.
- **No list heading, so the fallback is the previous row, then the empty
  state.** #546 proposed the list's heading after the row in the deleted row's
  place. There is none, and the select toggle shows only in a household.
- **The 404s' true source.** #546 lays the console 404s at the sweep of a
  `''` slot. The 404s 0187's third run logged came from the rows it wrote past
  the rules, which carried a made-up receipt, not from emptied slots. The
  app's own data meets the same line only for a slot whose object is already
  gone, and the sweep now skips such a slot; this record's run read no request
  for it.
- **Every button kind, not icon buttons.** #546 asked for an indicator for
  icon buttons; every Material button gets Material's, inside it.
- **An error callback in the component, not `catchError`.** #546 offered
  either. The five reads take callbacks in `DashboardComponent`; the services'
  streams and their thirteen other consumers are unchanged (Known gaps).
  `permission-denied` is quiet too, beside the shutdown's `aborted`.
- **"No `GlobalErrorHandler` call" is read on the zone.** Under TestBed a zone
  error never reaches an `ErrorHandler`: the fixture subscribes to
  `NgZone.onError` itself and rethrows. The cases read `NgZone.onError`, where
  the unfixed tree failed, and keep an `ErrorHandler` double for any other
  path.
- **The save box loses its placeholder.** #546 offered labels for both boxes;
  the save box's caption made its placeholder, which showed only once the
  box was emptied, redundant, and its catalog entry goes with it.
- **More than the issue named.** The AI page's fields, links, test buttons and
  model selects; the first run's memory clears, calendar pairs, chip clear and
  toggle groups, with the tenth rule; the chip's focus hand-off; and
  `removeAllReceipts` tombstoning only the slots it swept.

## Things that only became apparent while building

- **The swipe door's confirm gave focus to a shut button.** Before this
  branch, a confirm the drawer opened, cancelled or confirmed, gave focus
  back to the drawer's Delete, which was shut by then, `tabindex="-1"`,
  `aria-hidden="true"` and off-canvas. Red:
  `Expected <button class="swipe-action swipe-action-delete" tabindex="-1" aria-hidden="true">`
  to be the `.row-menu-btn`. It now lands on the row's menu button.
- **The first readings left Material's focus layer out.** Inside the button,
  with Material's 12% focus state layer composited, a flat button reads 4.97
  and 6.32 and the FAB 5.96 and 5.50, where a reading without the layer gave
  6.48 and 7.74 and 7.21; every kind still clears 3:1.
- **A field's suffix does not clip.** `.mdc-text-field` is `overflow: hidden`,
  but Material's outlined field sets `overflow: visible`, and every field in
  the app is outlined. The clipping case is the search suggestions' scroller,
  where a remove button's box ends at the scroller's padding edge: an outset
  line would be cut there, and the inset one fits.
- **A held button's indicator was the faintest line on the page.** In the 38%
  label colour Material gives a disabled button it read 2.29 for text and
  stroked and 2.20 for flat in light, 2.72 and 2.35 in dark.
- **A framed control would have shown two outlines.** Browse sits inside the
  upload area's frame, which draws its own outline round the zone.
- **The mini FAB needed a corner rule though the app has none.** Without it
  the FAB's (0,3,1) rule would give a mini FAB the large corner over
  Material's own; the case reads `Expected '16px' to be '12px'` when the two
  rules swap.
- **A zone error under TestBed ends the run.** `ComponentFixture` rethrows
  what `NgZone.onError` hears, which Karma reports as an error in `afterAll`
  and then a disconnect after 30 s of silence. Red for the five reads was
  recorded in separate focused runs.
- **[0007](0007-transactional-receipt-edits.md)'s premise for the span does
  not hold after a truncating removal.** It sweeps only the span seen at read
  time because "an appender always targets slots at or past that length".
  Once a removal has truncated trailing tombstones, an append can land in a
  slot that was empty at read time. The full-span sweep would have deleted
  that image's object; a sweep narrowed to the slots that held an image would
  have tombstoned its entry, until `removeAllReceipts` learned to tombstone
  only what it swept.
- **Material's calendar toggle takes its name through an input.**
  `MatDatepickerToggle` binds `[attr.aria-label]="ariaLabel || _intl.openCalendarLabel"`
  on its inner button, so a host `[attr.aria-label]` does not reach the button;
  the `aria-label` input does.
- **Axe reads no radiogroup's name.** The category manager's axe case passed
  with the group's name removed; only the name cases failed. So the gate holds
  it.
- **The model selects were the AI page's second pair.** Both read *Model*,
  and turned up beside the removes once those were named.
- **The audit's first fixes on two of these screens did not hold.** The
  *Recommended* chip's first wrap dropped each provider's title under its
  avatar at 320px; the title block's cap keeps it beside. The totals line's
  first clip was a margin on `overflow-x: clip`, which Chrome applies only
  where both axes clip, and which the iOS 15 WebView, with no clip value at
  all, would have shown as a dot before every line; `clip-path` is drawn on
  both.

## Known gaps

### Names and their gates

- **No rule reads siblings named by their own text.** The first run's two
  *Forget all* had that shape, and the ninth rule leaves it out by design. A
  rule that compares the text of two controls that can show together would
  close it.
- **The ninth rule reads one template.** The shared dialog header's *Close*
  beside a dismiss in the form it heads is not read, nor any pair across two
  templates shown on one page.
- **What else the ninth rule cannot see:** a name built in TypeScript; a field
  named by its `<mat-label>`, as the AI page's key fields and model selects
  are; a ternary nested in another; a menu trigger named by
  `common.moreActions`; and two blocks their conditions keep apart without an
  `@else`, such as two `@if`s on one signal and its negation, read as
  rendering together.
- **What the tenth rule cannot see:** a name or a role set in TypeScript or by
  a directive's host binding, or bound through `[attr.role]`; a `[multiple]`
  bound to an expression, read as multiple whatever it holds; and whether the
  name says what is chosen.
- **No gate reads label in name.** The cases that use `holdsShownWords` hold
  the controls this record names; a control added later is held only if its
  spec adds such a case.
- **The app smoke cannot tell the two filter calendars apart.** No catalog is
  served there, so it reads `datepicker.openCalendarFor` twice; the unit specs
  hold the per-field words.
- **The new words want a native read in ja and tc.** The caption, the AI
  page's provider names (tc's *測試金鑰：{{provider}}* above all), the two
  memory clears, the calendar names, *Clear {{period}}* and the five group
  names have not been read by a native reader.
- **Nobody listened for the search box's placeholder.** The run read the box's
  name with and without it; whether a screen reader then also speaks the
  placeholder, and how WebKit and VoiceOver treat it once the box holds a
  value, was not heard.

### The focus indicator

- **Other controls keep their own focus look.** Chips, menu items, tabs,
  switches, checkboxes, radios and button toggles are not measured against
  their surfaces here, and hand-rolled controls keep the app's outline. The
  import's Review step header, focused by Material after Continue, shows its
  focus state layer as a grey block in dark.
- **Forced colours are read from the stylesheet alone.** The spec finds the
  outline rule only under `forced-colors: none`; no run emulated forced
  colours.
- **The upload area's drag handle is no button.** It is a `cdkDragHandle`
  element and takes no focus, so it has no indicator; the photo row's arrows
  and remove do.

### Focus after a delete

- **A list that never shows a row or its empty state keeps the arm.** If the
  row's leaving leaves neither, as after a first load that failed and was
  never retried, the hand-off waits until the next confirm or until the list
  is destroyed.
- **A prefetch in the same change can still shift the place.** The index is
  followed while the row is listed, so only rows that land in the same list
  change as the row's leaving can move the landing.
- **Two 32px boxes.** The run read the desktop row menu's `.action-btn` and
  the form's two `.suggestion-dismiss` buttons at 32 × 32. The figure is the
  box, not the target: `.action-btn` carries an `::after` overhang that
  takes its target to 40px, as its stylesheet's comment says. The
  dismissals are `mat-icon-button`s that keep Material's 48px touch span at
  the theme's density 0, since nothing in the form's stylesheet holds it in,
  and no spec measures where that span reaches.
- **0187's datepickers opened from a menu's entry** still give focus back to
  the detached entry.

### The dashboard's reads

- **Thirteen other consumers of the same streams have no error path.**
  `loadCategories()` is subscribed with nothing to take an error in
  `transactions.component.ts`, `search-answer-history.component.ts`,
  `transaction-form.component.ts`, `budget-form.component.ts`,
  `budgets.component.ts`, `data-management.component.ts`,
  `reports.component.ts`, `ai-search-dialog.component.ts` and
  `import-wizard.component.ts`, and with a `next` alone in
  `recurring-transactions.component.ts` and
  `recurring-form-dialog.component.ts`; `getGoals()` with nothing in
  `transaction-filters.component.ts` and `transaction-form.component.ts`. A
  failing listener there still reaches the global handler. An error path on
  each, or one in the services' streams, would close it.
- **What a card showed is checked on its signals.** For budgets, goals and
  categories the cases read the service-owned signals the cards bind, not the
  rendered cards.
- **No emulator case.** The shutdown is held by the unit cases and the browser
  run's last step (Consequences).

### The receipt sweep

- **An emptied slot whose object survived a failed sweep is orphaned.** The
  sweep never asks for a `''` slot again, so an object a failed earlier sweep
  left behind stays, a variant of 0007's failed-sweep gap. A reconciler, which
  0007 left to the server-side quota work, would close it.
- **A slot refilled after a truncating removal can outlive its row.**
  `deleteTransaction` and `wipeTransactions` skip a slot that was an interior
  `''` when the row was read. If another device's removal truncates the array
  and its next append refills that slot before the delete, the new object
  outlives the document with nothing naming it. The old full-span sweep
  deleted it, at the price of asking for every emptied slot; the same
  reconciler would close it.

### The rest

- **The phone's totals line was not read on iOS 15.** Its clip is a
  `clip-path`, which caniuse-lite lists as drawn unprefixed by iOS Safari
  from version 13; no simulator or device has shown the line there. A run on
  an iOS 15 simulator would close it.
- **The period chip's clear has a 24 × 24 box**, as the run read it. It is a
  `mat-icon-button`, and nothing in the period selector's stylesheet holds
  in Material's 48px touch span, which the theme's density 0 keeps round the
  box; no spec measures where that span reaches. Nothing here changed its
  size; a case that hit-tests the span would say whether it reaches the
  40px floor.
