# Accessibility

What the app guarantees to assistive technology, and where each guarantee is
enforced. This is a young document: it covers the rules that exist rather than
a full audit, and the gaps at the end are real.

## The active route is announced

The link for the page you are on carries `aria-current="page"` in **both**
navigation surfaces, and no other link does
(see [ADR 0055](ADR/0055-the-active-route-is-announced-not-only-coloured.md)).

Before this, the active route existed only as a CSS class: eight links
announced identically, and the current page was information sighted users had
and nobody else did.

The attribute is driven by the same activation `RouterLinkActive` already
tracks for the class, so there is no second source of truth and nothing to keep
in sync.

**The mechanism depends on the host element:**

| Host | Input | Why |
|---|---|---|
| Plain anchor (`bottom-nav`) | `ariaCurrentWhenActive="page"` | `RouterLinkActive`'s own input |
| `a mat-list-item` (`sidebar`) | `[activated]="rla.isActive"` | `MatListItem` host-binds `attr.aria-current`, and a host binding overwrites whatever the template sets on that element |

Do not reach for `[attr.aria-current]` on a `mat-list-item`. It reads as though
it works and it does not — the host binding wins. `[activated]` is also what
gets Material's own forced-colors marker for the row.

`MatListItem` answers `'page'` only when the host is an **anchor**. On a
non-anchor list item, `[activated]` gives the visual treatment and no attribute
at all.

**Each surface is a named landmark.** The sidebar's `nav` is *Main*
(`nav.landmarkMain`) and the bottom nav's is *Quick access*
(`nav.landmarkQuick`). A phone has both, the bottom nav on screen and the
sidebar in its drawer, and unnamed, each was announced only as *navigation*,
so a landmark list could not tell one from the other. The names are short
because a screen reader says *navigation* after them. The sidebar builds its
name with a `computed` over `TranslationService.t`, as it does its link
labels, and the bottom nav uses the translate pipe
([ADR 0165](ADR/0165-the-period-pickers-are-bounded-unavailable-totals-offer-retry-and-three-smaller-papercuts-close.md)).

## Active state is never conveyed by colour alone

Both navigation surfaces originally expressed "active" as colour plus a font
weight. Forced colors replaces author colours with system ones, so those cues
collapse and only the weight is left.

Every colour-built active treatment carries a `forced-colors` counterpart that
survives the mode — an outline or border, not a heavier font:

- `sidebar.component.scss` — an outline on `.nav-item.active`, alongside the
  trailing dash Material draws for an activated anchor.
- `bottom-nav.component.scss` — an outline on the active item's `.icon-pill`.

These are the first `forced-colors` blocks in `src/`. Nothing checks that a new
one appears when a new colour-only active treatment does.

## Accessible names come from the catalog

An `aria-label` is a user-facing string, so it lives in the translation catalog
like any other (see [ADR 0036](ADR/0036-a-user-facing-string-lives-in-the-catalog.md)
and [i18n.md](i18n.md)).

`npm run i18n:check` enforces this: a hardcoded `aria-label` in a template is
flagged, while `[attr.aria-label]` and `[aria-label]` bound through `translate`
are allowed. The checker self-tests these cases, so the rule cannot rot
silently.

**A state must not be folded into a name.** The bottom nav's links carry an
`aria-label` that duplicates the visible label; expressing "current" by
appending to it would break the match between accessible name and visible text.
That is what `aria-current` is for.

**A short label is the name too.** The bottom nav names the dashboard with
a shorter word than the other surfaces (ホーム in ja, where ダッシュボード
does not fit the tab; [ui-overflow.md](ui-overflow.md#using-appfittext)).
One translated string feeds both the visible label and the link's
`aria-label`, so the name is still exactly what is shown. The active
label's bold is unchanged: it costs that label no width, and in normal
colour mode it is a cue that is not colour; under forced colors the outline
above carries the state
([ADR 0182](ADR/0182-a-control-reads-in-the-accounts-language-and-date-format-and-nothing-re-provides-materials-adapter-or-words.md)).

**A button that shows only a glyph or a colour is named for what it picks.**
The category dialog's icon grid and colour swatches show no text: each
button carries its icon's or colour's name from the catalog, and
`aria-pressed` says which one is picked, the selection its ring and fill
show. They are toggle buttons in a named `group`, not radios, which would
ask for arrow-key roving and one tab stop
([ADR 0169](ADR/0169-a-categorys-colour-is-drawn-through-the-chip-or-a-pipe-that-knows-its-surface-and-the-axe-pass-sweeps-both-themes-below-the-fold.md)).

**A name hidden for room is clipped, never removed.** Below 600px the import
wizard's four step labels give way to their numbered circles, since the
labels truncated past reading there. Each step header is a `role="tab"` named
by its label and, while the import is written, by the lock in it
([ADR 0149](ADR/0149-the-review-step-says-what-it-changed.md)). So the labels
are clipped in place rather than taken out with `display: none`, which left
four unnamed tabs. The rule is a viewport query Karma's window cannot reach,
so `import-wizard.component.spec.ts` (*the step headers under the phone
rule*) reads its declarations from the stylesheet, lays them on the rendered
labels and sweeps the tab list with axe, in both schemes. That proves what
the rule declares; a 375px browser window is what proves the cascade
([ADR 0186](ADR/0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)).
Settings' Sign out had the same shape on a card below 480px, where it shows
its icon alone: its label, the button's only name, was taken out with
`display: none`, and is clipped now (`settings.component.spec.ts`, *Sign out
under the phone rule*).

Every such clip is one mixin, `visually-hidden` in `src/theme/_a11y.scss`,
which a stylesheet reaches with `@use 'a11y'` through the `src/theme`
include path: an absolutely positioned 1px box with `min-width: 0`,
`overflow: hidden`, `clip-path: inset(50%)` and `white-space: nowrap`. Its
insets stay auto, so the box sits where its text stood and the caller's
container needs no position of its own. The wizard's step labels, Sign out,
the stat card's `.delta-sr`, the transaction list's select column header
(`.select-header-label`) and the onboarding dialog's step sentence
(`.step-sentence`) all use it, and no Tailwind `sr-only` is left under
`src/`, not even in a comment. Tailwind reads the `.html` and `.ts` files
under `src/` for class names, comments included, and a spec comment that
named the utility once built it into the global stylesheet, about 140 bytes
of it. Specs, the `*.testing.ts` helpers, `core/services/testing/` and
`test-main.ts` are left out of what it reads now (`content` in
`tailwind.config.js`), so a word in a spec ships nothing, and only the app's
own files can build a utility
([ADR 0195](ADR/0195-a-gate-holds-the-test-main-to-the-builders-init-specs-stay-out-of-the-stylesheet-a-lone-date-run-is-silent-and-the-opacity-gate-reads-a-url-in-a-comment-as-a-comment.md)). A
pin in the list's and the onboarding dialog's specs reads the mixin's
`clip-path`, a box of 1px or less, and the words still in the name, so the
utility, whose `clip: rect(…)` leaves `clip-path` at `none`, fails it; a
copy of the mixin's declarations written by hand would pass
([ADR 0187](ADR/0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)).

**A row's checkbox is named for its row.** Each review card row's checkbox is
named *Select {description}*, and a row with no description yet *Select an
untitled row*, the stand-in the card's other sentences use (see *The import
review step*). *Select all* keeps its visible text as its name. The name is
bound through the toggle's `[aria-label]` input, the one spelling that reaches
the checkbox Material renders inside: Material clears the host's own
`aria-label` and `aria-labelledby`, so `[attr.aria-label]` names nothing
([ADR 0186](ADR/0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)).

**A toggle is named on the control a screen reader lands on.** `mat-slider`
takes no name input and forwards nothing to its thumbs, so the budget form's
alert slider is named on its thumb: the label's words sit in a
`<span id="threshold-label">` of their own, beside the `: ` and the value,
and the `<input matSliderThumb>` carries `aria-labelledby="threshold-label"`.
The name, *Alert when spending reaches*, holds no figure, since the thumb
speaks its own `aria-valuetext`. The AI page's Auto sync switch is named by
the words beside it: the span carries `id="auto-sync-label"` and the
`mat-slide-toggle` `aria-labelledby="auto-sync-label"`, which Material hands
to the `role="switch"` button inside, as the dashboard layout settings' card
toggles do. The shared axe pass (`runAxe`) runs `button-name` without its
`explicit-label` check, which takes any `<label for>` pointing at a button
as its name, even one out of sight: Material renders such a label beside
its switch and hides it while it projects nothing, so a switch nobody named
passed every sweep. Only `button-name` drops the check, so a field named by
its `<label for>` keeps that name. The AI page's spec runs the pass over the
real row, with Material's empty label in place
([ADR 0192](ADR/0192-a-control-repeated-per-item-names-its-item-in-its-own-text-too-a-button-is-named-in-every-branch-and-an-unlabelled-switch-fails-the-axe-pass.md)).
Settings' four switches, *Send reminders*, *Show the weekly recap*, *Require
a PIN* and *Share anonymous usage statistics*, pointed `aria-labelledby` at
their section's label, which Material hands to the switch in place of its
own `<label for>`: each was named by its section's title, and the words
shown beside it were not in its name (WCAG 2.5.3). Each now keeps its own
label, and the section's label names the row round it, a `role="group"`
with `aria-labelledby`. The usage statistics switch is described by the
free plan's note through the toggle's `[aria-describedby]` input; bound as
an attribute on the host, which is no control, the note described nothing
([ADR 0192](ADR/0192-a-control-repeated-per-item-names-its-item-in-its-own-text-too-a-button-is-named-in-every-branch-and-an-unlabelled-switch-fails-the-axe-pass.md)).

**A control stamped once per item names its item.** A list of buttons that
all say *Delete* cannot be told apart by ear, nor can the rows they act on.
Each per-item control's name carries the item's own slot, read from what its
row shows, and a control that shows words keeps them whole inside its name
(*A name holds the words its control shows*, below)
([ADR 0187](ADR/0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md),
[ADR 0192](ADR/0192-a-control-repeated-per-item-names-its-item-in-its-own-text-too-a-button-is-named-in-every-branch-and-an-unlabelled-switch-fails-the-axe-pass.md)):

| Where | Named by | For instance |
|---|---|---|
| The review card's fields and its three buttons | the row's description, in 「」 in tc, or *an untitled row*, never quoted (`announceDescription`) | *Amount of {description}*, *Not a duplicate — import {description}*, *Remove the suggested location from {description}* |
| The review card's *Add location*, *Add tag* and *Notes* | the row's description, as the card's other controls; *Notes* reads its field's own label, `import.notesLabel` | *Add location to {description}*, *Add tag to {description}*, *Notes for {description}* |
| A receipt image's controls | its number, the one its thumbnail's alt says, and the transaction where the list holds several | *Move image {index} up* in the camera, *Remove image {index} of {description}* in the receipt manager, *Remove new image {index}* and *Remove stored image {index}* on the transaction form |
| The receipt manager's thumbnails, each a button named by its image's alt | the image's number and the transaction (`receiptImages.imageNumberOf`) | *Receipt image {index} of {total} for {description}* |
| The upload area's rows | a photo's number among the photos, or a file's among the other files, and its name | *Move photo 2 (image.jpg) up*, *Remove file 1 (rows.csv)* (below) |
| About's feedback list | the entry's place and its category | *Delete feedback {position} ({category})* |
| The saved answers, in the search history and the search dialog | the question and the date the row shows | *Delete {query} ({date})*, *Pin {query} ({date})*, and in the history *Refresh {query} ({date})* |
| An answer card's *View matching transactions* | the answer and its period, or a count answer's period alone, since its label already says what the button says | *View matching transactions ({answer}, {period})* |
| The goal form's items | the item's place, since its name is a field being typed | *Delete item {position}* |
| The goal card's Edit, Delete, *View Transactions* and *Contribute* | the goal's name | *Edit {name}*, *Delete {name}*, *View Transactions for {name}*, *Contribute to {name}* |
| The recurring groups | the group's label | *Track {name} as recurring*, *Show transactions for {name}* |
| An insight card's *View transactions* and its show or hide toggle | the insight's title, and what tells it from another card of its kind: its category, and a recurring payment's figure a month | *View transactions: {name} ({detail})*, *Show transactions: {name}* |
| An import record's *View transaction*, *View transactions* and *Delete* | the file's name and when it came in, since two photos can share a file name and two records a count | *View transactions ({count}) from {name} ({date})*, *Delete {name} ({date}) from import history* |
| The dashboard's two *View All* links | the card's title | *View All {name}* |
| The filter panel's suggestions | the saved search's label or else its query, and the recent query | *Remove saved search {name}*, *Remove recent search {query}* |
| The transaction list's note and receipt buttons, and the row's swipe *Edit* and *Delete* | the transaction's display name, in 「」 in tc when it is the description (`quotedTransactionName`) | *View note for {description}*, *View receipt for {description}*, *Edit {description}*, *Delete {description}* |
| The household overview's goal button, on one's own shared rows | the transaction's display name | *Count toward a goal: {name}* |

The receipt manager lists the images of several transactions, so its
thumbnails' alt names the transaction too; the camera, the transaction form
and the receipt viewer each hold one transaction's images and keep
`receiptImages.imageNumber`, *Receipt image {index} of {total}*. A
thumbnail's tooltip, *View image*, describes it without saying the
transaction again.

A transaction with no description is *an untitled transaction* wherever a
control or a dialog names it, through `transactionDisplayName(description, t)`
(`core/utils/transaction-display.utils.ts`): the list's row checkboxes and
menu triggers, the note and share dialogs, the receipt viewer's subtitle,
the transaction row's own button and the household overview's goal button.
Each dialog reads it in its own template, so the name follows a language
switch made while the dialog is open. The list's note and receipt
buttons, the row's swipe *Edit* and *Delete* and the receipt manager's image
controls read it through
`quotedTransactionName`, since tc quotes the transaction in their names: a
description goes in the reader's own quotation marks, `common.quotedName`
(none in en and ja, 「」 in tc), and the stand-in goes bare, so a blank
row's note button reads *查看未命名的交易的備註*. A sentence that quotes a
description in every catalog never quotes those words, which in quotes read
as the row's own name: the list's delete and stop-sharing confirms ask
instead about *this untitled transaction*, or a split part's delete about
*this untitled part of a split purchase*, from keys of their own chosen by
`isUntitled(description)`, the test the display name reads
([i18n.md](i18n.md#a-transaction-with-no-description)). `i18n:check` fails a
translated slot filled with a description read straight off a value, and
`translation-keys.spec.ts` a key that quotes `{{description}}` itself unless
it is listed with why its caller never hands it a stand-in. A toggle button
keeps its name while its state changes: the two pin buttons read one key,
and `aria-pressed` alone says whether the answer is pinned. ja puts the item
before の or quotes it in 「」 with the verb last; tc quotes it and puts the
verb first. A field commits on Enter or blur, never per keystroke, so a
description being typed does not rename the field it is typed into. Each
name is pinned in en, ja and tc in a describe that renders the real
template, read by axe's own name computation (`accessibleName`,
[testing.md](testing.md#shared-stubs)) against the catalog's words, but for
the review card's: its spec reads them through the echo stub, as keys and
parameters, and in tc through tc's catalog, a titled row's in 「」 and a
blank row's by the stand-in with no quotation mark (*every field and button
on a card names its row*). The table's newer rows, the review card's add
buttons, the goal card's four actions, the receipt manager's thumbnails and
the rest, are read through the shipped catalogs in en, ja and tc; each that
shows words is held to them by `holdsShownWords`, and two of a kind are
read one after the other so they cannot share a name: two rows, two photos
both called image.jpg imported on different days, two Rising trends in
different categories
([ADR 0192](ADR/0192-a-control-repeated-per-item-names-its-item-in-its-own-text-too-a-button-is-named-in-every-branch-and-an-unlabelled-switch-fails-the-axe-pass.md)).

**A tooltip on a named control says its whole name, or nothing the name
says.** The CDK describes a tooltip's host by the tooltip's text, through
`aria-describedby`, unless that text is the host's whole `aria-label`. The
review card's keep-date button and the accept button of its offered currency
showed the reason alone as their tooltips, words their joined names already
read, so a screen reader heard the reason twice and a sighted reader saw
part of the name. Both tooltips now show the whole name and describe
nothing. Each name opens with the words its chip shows, *Dated {date} —
keep it?* or *Looks like {country} — use {currency}?*, and then says why the
row is asked, so a speech-input user reaches the button by the words they
see (WCAG 2.5.3). They used to open with the reason and end in *Keep
{date}*, or read *Use {currency} for this row* before the reason, words the
chip never showed. The transaction form's offer was always named by its own
text, which holds its reason. The duplicate overrule reads one key with one
set of parameters for its name and its tooltip; the amount flag and each
category grade's dot carry a tooltip equal to their `aria-label`; and the
date, currency and type flags sit on hidden icons inside the controls whose
names carry their sentences. `transaction-preview-table.component.spec.ts`
(*a tooltip a reader reaches on the card*) walks every tooltip on the card
that a reader reaches and holds each to its control's whole name with an
empty description, in en and ja, and *a chip that asks is named first by
the words it shows* holds the keep-date and offer names, in en, ja and tc,
to open with their chips' words and then read the reason whole, with no
stop after the question's mark
([ADR 0187](ADR/0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)).

**A name holds the words its control shows.** A control named by an
`aria-label` that also shows words keeps those words whole inside its name,
so a speech-input user reaches it by what they see (WCAG 2.5.3). The name
*contains* them; it need not open with them, since a ja sentence ends in its
verb. Both are read without regard to case in the reader's own locale
(`holdsShownWords`, in `core/services/testing/axe.ts`), and the cases that
call it leave a hidden glyph's ligature out of the shown words and fold a
trailing ellipsis away. So tc reads
*檢視交易：「{name}」* for the goal card's *檢視交易*, not a sentence that
splits the shown words round the goal. Two of the review card's buttons used
to miss: in en *Merge* showed *Merge into* and an ellipsis, two words its
name, *Merge {description} into another row*, did not hold together, and in
tc *Split* showed 分割 while its name said 分成. en now shows *Merge…*, as ja
*結合…* and tc *合併…* did, and tc's Split is named *分割「{description}」成兩列*.
The describe *a row action's name holds the words it shows* in
`transaction-preview-table.component.spec.ts` holds Split, Merge and Remove
on a titled row, and Split and Remove on a blank one, which is offered no
Merge, in en, ja and tc
([ADR 0196](ADR/0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)).

**Controls that can show together say what each acts on.** Two controls
rendered once, side by side, can share a name as surely as a list's copies
can, and a screen reader moving between them hears one name twice
([ADR 0196](ADR/0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)):

- **The transaction form's two dismissals**, on the currency offer and on
  the scanned position's offer, which a scan can show at once, both read
  *Close*. They are *Dismiss the currency suggestion* and *Dismiss the
  location suggestion* (`transactions.dismissCurrencySuggestion`,
  `transactions.dismissPositionSuggestion`), beside the dialog header's own
  *Close*.
- **The AI page names each provider.** Each key field is labelled *{provider}
  API key* (`settings.apiKeyFor`), with the provider's short name, which
  Material's floating label keeps whole at 320px, and the model selects of
  the two cards that hold one, which both read *Model*, are *{provider}
  model* (`settings.modelFor`). A key field's remove is *Remove the
  {provider} API key* (`settings.removeApiKey`). The *Get API Key* links and
  *Test Key* buttons keep the words they show and carry an `aria-label` that
  holds them and the provider (`settings.getApiKeyFor`,
  `settings.testApiKeyFor`). The two *Forget all* buttons, one for the
  remembered categories and one for the tags, are *Forget all remembered
  categories* and *Forget all remembered tags*
  (`aiPage.categoryMemoryClearLabel`, `aiPage.tagMemoryClearLabel`).
- **A pair of calendar buttons is named by field.** The filters' From and
  To, the recurring rule dialog's start and end dates and the household
  budget dialog's start and end each bind one slotted key,
  `datepicker.openCalendarFor`, *Open calendar: {field}*, filled with the
  field's own label, through `MatDatepickerToggle`'s `[aria-label]` input; a
  host `attr.aria-label` does not reach the button inside. Every other date
  field stands alone and keeps *Open calendar*.

The ninth `icon-labels:check` rule holds the controls named by a bare key in
their `aria-label` (below). No rule reads two controls named by their own
text, as the memory clears, the links and the test buttons were.

**A single-choice group is named for what it chooses.** A
`mat-button-toggle-group` that is not `multiple` renders `role="radiogroup"`
on its own host, as a `mat-radio-group` does, and a screen reader entering
one says the group's name before its first choice. The category manager's
Expenses / Income group had no name, nor had seven more: each announced its
first choice and its place among the others, and nothing that said what was
being chosen. Each carries an `aria-label` on its host now: *Category type*
in the category manager (`settings.categoryType`), *Type* on the
transaction form, the recurring rule and the Reports categories
(`transactions.type`), *Goal type* on the goal form (`goal.kindLabel`), *Add
or take back* in the contribute dialog (`goal.directionLabel`), *Forecast
period* (`reports.forecastPeriod`) and *Period* on the period selector's
quick ranges (`dashboard.period`). Settings' Theme and Font size, the
feedback dialog's category and the export dialog's format were named by
their labels already. Each component's spec reads its group's name, and the
tenth `icon-labels:check` rule fails a group with none (below)
([ADR 0196](ADR/0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)).

### A progress indicator is named, or hidden inside the control that names it

Material renders `mat-spinner`, `mat-progress-bar` and `mat-progress-spinner`
as `role="progressbar"` with no content to take a name from. Each one in the
tree either carries a name — `[attr.aria-label]` through `translate`, such as
*Refreshing dashboard data* or *{name}: {percent}% of budget used* — or a
literal `aria-hidden="true"`, because it sits inside a control whose own text
already says what is happening, where a name would say it twice. The shared
`LoadingSpinnerComponent` names itself with its `message`, or `common.loading`.

**A button whose label a spinner replaces keeps its name.** Hiding the spinner
inside such a button would leave it with no name at all while it is busy, so
it carries `aria-busy` and, only while busy, its idle label as `aria-label`
(the transaction form's submit, the camera's process button). Idle, the
visible text names it. The AI page's three *Test Key* buttons carry their
name in both states, *Test Key for {provider}*, since the visible text alone
did not tell them apart
([ADR 0196](ADR/0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)).

**Check:**

```bash
npm run icon-labels:check
```

`scripts/check-icon-labels.mjs` holds ten rules over every template, and
its self-test has 323 cases:

- a `mat-icon` carrying `role="img"` or a label also carries a literal
  `aria-hidden` ([ADR 0146](ADR/0146-an-icon-that-carries-a-label-is-not-hidden-and-a-category-id-is-never-empty.md));
- every progress indicator carries an `aria-label` in any form, an
  `aria-labelledby`, or a literal `aria-hidden="true"` — `"false"` and a
  bound value hide nothing
  ([ADR 0151](ADR/0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md));
- inside a `mat-option`, a `mat-icon` is a direct child of the option. The
  option projects such an icon into a slot beside its label and everything
  else into the label, whose text is the option's `viewValue`: what the
  closed select shows, what typeahead matches and what the trigger
  announces. An icon wrapped with the name in a `<div>` or `<span>` puts its
  ligature at the front of the name, while the open list, drawing the
  ligature as a glyph, looks right. Control-flow blocks are not elements
  and do not count; an `ng-container` does
  ([ADR 0169](ADR/0169-a-categorys-colour-is-drawn-through-the-chip-or-a-pipe-that-knows-its-surface-and-the-axe-pass-sweeps-both-themes-below-the-fold.md));
- a menu button stamped once per item does not take its name from
  `common.moreActions`, which names no item, so every copy down a list
  would say the same. It names its item with `common.moreActionsFor`, as
  *More actions for {description}*. "Once per item" is an `@for`, an
  element under `*ngFor`, `*cdkVirtualFor` or a table's cell or row
  definition, or a component that another template stamps that way: the
  budget card's button sits in no repeat of its own, and the overview's
  `@for` repeats it
  ([ADR 0169](ADR/0169-a-categorys-colour-is-drawn-through-the-chip-or-a-pipe-that-knows-its-surface-and-the-axe-pass-sweeps-both-themes-below-the-fold.md));
- a `mat-icon` with a `matTooltip`, a name and a literal
  `aria-hidden="false"` carries a literal `tabindex`, so its sentence opens
  for the keyboard: MatTooltip opens on focus, and an icon takes none by
  itself. The form's amount and date flags and the review card's amount flag
  carry `tabindex="0"`. An icon under an open `<ng-template>` is exempt — the
  wizard's seal icon is stamped into a step header that is already the
  `role="tab"` control and the tab stop — and so is a hidden icon inside a
  control that takes focus and names itself, as both type flags are
  ([ADR 0185](ADR/0185-a-refund-is-asked-about-at-every-door-and-a-category-follows-its-rows-side-there-and-back.md));
- a control stamped once per item does not take its whole name from one
  catalog key with no parameters, bound or interpolated, which gives every
  copy the same name. A ternary between two such keys, piped once after it,
  `(cond ? 'a' : 'b') | translate`, or in each branch, the last with its
  parentheses or without (`cond ? ('a' | translate) : 'b' | translate`), is
  one of them and is reported with both its keys: every copy gets one of two
  names, neither of which says which item it acts on. A key given parameters,
  on either branch or on the pipe after a ternary, has a slot for the item;
  whether what fills it tells the items apart is a reading question, which is
  why the upload area's buttons name a photo by its number as well as its
  name. A repeated status (a row's spinner) may say the same of every item,
  and a menu button the fourth rule reports is reported there
  ([ADR 0186](ADR/0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)).
  A control's own text is read too (`readOwnTexts`). A link, a button, a
  Material toggle or an element with a control's role takes its name from
  what it holds when no `aria-label` or `aria-labelledby` names it, and text
  that is one key with no parameters, or a ternary between two, names no
  item as such a label does: every transaction row's swipe drawer read
  *Edit* and *Delete*. The text is every run the control holds outside a
  `mat-icon` and outside an element with a literal `aria-hidden="true"`,
  with control-flow syntax taken out. Each control records where its name
  comes from, `via: 'label'` or `via: 'text'`, and both feed the same tally
  across templates and the same freeze, since a key is one name however a
  control comes by it. A text hit is reported at the control's opening tag,
  and its hint asks for the words it shows kept and the item added, in an
  `aria-label` whose sentence holds them (WCAG 2.5.3). Two text-named
  controls are exempt: one inside a `<mat-menu>`, whose panel opens for the
  one trigger that is already held to name its item; and one with a bound
  `aria-describedby`, as the household's six buttons are, named by what they
  do and described by their item. That second exemption is a Known gap, not
  a pattern to copy
  ([ADR 0192](ADR/0192-a-control-repeated-per-item-names-its-item-in-its-own-text-too-a-button-is-named-in-every-branch-and-an-unlabelled-switch-fails-the-axe-pass.md)).
  "Once per item" is read two ways, as the fourth rule reads a menu
  trigger: inside the template, an `@for` or an element under a repeating
  structural directive; and across templates, a component another template
  stamps that way, so the goal card's Edit and Delete are repeated although
  nothing repeats in the card's own template (`scanItemlessAcross`, the run's
  own path). One reading is held apart: an `@case` under an `@switch` whose
  subject is the nearest `@for`'s own item renders for the one item that
  matches it, so it lifts that repeat, inside the template and across it.
  The dashboard stamps its cards that way, and the insights card's Refresh
  is one button on the page. What two or more of the switch's cases reach
  still repeats, a component's selector or a control under one bare key
  alike, whether a case writes it or reaches it through a component it
  stamps, at any depth (`heldApartAcross`): the card menu, written into all
  five cards, stays repeated, and so does the empty state, which four of
  the cards stamp. An `@default`, an `@switch` on something the item holds and
  an outer `@for` around the switch still repeat. Only this rule holds cases
  apart; the fourth, fifth, seventh and eighth read as before. Its freeze,
  `ITEMLESS_FROZEN`, is empty and stays so, as
  [ADR 0151](ADR/0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)
  keeps an emptied freeze: the 28 controls it froze when it landed all name
  their item now, and so do the ten more the text pass found when it
  landed, so a new hit fails. The run reads *Checked the controls stamped
  once per item across 103 template(s): 0 take their name from a key with no
  parameters (0 by their aria-label, 0 by their own text), 0 frozen by name;
  14 template(s) belong to a component another template stamps once per
  item*, 14 where the fourth rule counts 19, since the five dashboard cards
  are lifted by their `@case`
  ([ADR 0187](ADR/0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md),
  [ADR 0192](ADR/0192-a-control-repeated-per-item-names-its-item-in-its-own-text-too-a-button-is-named-in-every-branch-and-an-unlabelled-switch-fails-the-axe-pass.md));
- each id a literal `aria-labelledby`, `aria-describedby`, `aria-controls`,
  `aria-owns` or `for` lists is declared by a literal `id` in the same
  template, before or after the reference. A dangling one resolves to
  nothing without a word: axe lists it for review, not as a violation, and
  the control keeps whatever else names it, often nothing. It read 25
  references when it landed and froze none
  ([ADR 0186](ADR/0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md));
- a `mat-checkbox`, `mat-slide-toggle` or `mat-radio-button` projects text,
  or carries `aria-label` or `aria-labelledby` as a literal, an
  interpolation or a bound input (`[aria-label]`, `[aria-labelledby]`), so
  the control it renders inside itself is named. `[attr.aria-label]` does not
  count, since Material clears it on the host, and neither does a
  `mat-icon`, which hides itself
  ([ADR 0186](ADR/0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)).
  A `mat-slider` is read by its thumbs, whatever its host carries, since it
  forwards no name to them: each `matSliderThumb`, `matSliderStartThumb` or
  `matSliderEndThumb` input carries `aria-label` or `aria-labelledby` with a
  value, as a literal, an interpolation or a binding, `[attr.aria-label]` and
  `[attr.aria-labelledby]` included, since a thumb is the input itself
  ([ADR 0187](ADR/0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)).
  A button, a link and an element with a control's literal role are named
  the same way, by an `aria-label` or `aria-labelledby` in any spelling with
  a value that is not blank, or by what they hold. And what a control holds
  names it only in the states that render it: the transaction filters'
  toggle had a name only while its badge's count rendered, inside an
  `@if`, so with no filter set it had none. So what the control holds has to
  render in every state of its blocks (`readTree`, `heldBy`). Anything
  outside every block renders always; an `@if` renders in every state when
  it ends in a plain `@else`, an `@switch` when it has an `@default` (or
  Angular's exhaustive `@default never;`), and an `@for` when it has an
  `@empty`, each with something in every branch. A `@defer` is read as an
  `@if` with no `@else`. Text, an interpolation and an `<img>` whose alt is
  not empty render a name, and so, read as words, do a component, an
  `<ng-content>` and an element a binding or a template outlet fills; a
  `mat-icon` does not, nor does anything under a literal
  `aria-hidden="true"` or inside an `<ng-template>`. A control that holds
  nothing at all fails too, and a hit says which it is (`sometimes`), since
  the fixes differ. Its freeze, `UNNAMED_FROZEN`, is empty and stays so: the
  slider and the switch it froze are named. The run reads *Checked 19
  checkbox, slide toggle and radio button tag(s), 349 button(s), link(s) and
  element(s) with a control's role, and 1 slider(s) across 103 template(s):
  231 take their name from what they hold, 17 of them through a
  control-flow block; 0 name nothing in some state of their blocks or in
  all, 0 frozen by name*
  ([ADR 0192](ADR/0192-a-control-repeated-per-item-names-its-item-in-its-own-text-too-a-button-is-named-in-every-branch-and-an-unlabelled-switch-fails-the-axe-pass.md));
- two controls of one template, each named by an `aria-label` that is a
  bare key, do not share that key when both can render at once. Each `@if`,
  `@else if` and `@else` is an arm of one chain, and each `@case` and
  `@default` an arm of its switch; two controls never render at once when,
  at the deepest chain both sit in, they sit in different arms, so the two
  arms of an `@if…@else` may share a name and two independent `@if`s may
  not. The cases of a switch on the nearest `@for`'s own item are no arms,
  since two cards show two of them at once; an `@defer` and the blocks after
  it, and an `@for` and its `@empty`, are read as rendering together. A
  control stamped once per item is the sixth rule's and is reported there.
  Only a control named by its `aria-label` is read: two named by their own
  text read the words a sighted user sees too. It has no freeze. The run
  reads *Checked 35 control(s) rendered once and named by an aria-label with
  a key with no parameters across 103 template(s): 0 share a key with a
  control of their template that can show beside them*
  ([ADR 0196](ADR/0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md));
- each single-choice group, a `mat-button-toggle-group` that is not
  `multiple`, a `mat-radio-group` and any element with a literal
  `role="radiogroup"`, carries `aria-label` or `aria-labelledby` in any
  spelling, with a value that is not blank (`readGroups`). A screen reader
  entering such a group says its name before its first choice. The category
  manager's Expenses / Income group had none, nor had seven more toggle
  groups, the transaction form's type, the period selector's quick ranges
  and the forecast's horizon among them: each announced its first choice and
  its place among the others, and nothing that said what was being chosen.
  The axe pass the specs run reads no radiogroup's name, so nothing failed.
  A `multiple` group renders `role="group"` and is not read. The run reads
  *Checked 12 single-choice group(s), toggle groups that are not multiple,
  radio groups and elements with role="radiogroup", across 103 template(s):
  0 carry no name*
  ([ADR 0196](ADR/0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)).

It reads the markup, so it cannot tell a useful label from a useless one, nor
whether the control a hidden indicator sits in really announces the state;
and it reads each tag alone, so an indicator under a hidden parent repeats the
attribute. Nor can it see a block that holds an option's icon beside other
nodes, which Angular projects whole into the label, or a menu button's name
built in TypeScript, nor a tooltip a directive's host binding adds, and a
literal `tabindex="-1"` passes the fifth rule although Tab skips it. The sixth
cannot see a name built in TypeScript, a ternary nested in another or with a
branch that is not a quoted key, a label wrapped whole in parentheses or a
branch in doubled parentheses, a name taken from `aria-labelledby`, a
component stamped through an outlet or a dialog, or a selector or key that
two switches on the same item each reach in one case: its tally counts the
cases of one switch. Of a control's own text it reads only one bare key
alone, so text that is a key beside literal words or beside a second key,
or a key beside a component or an `<img>` that adds to the name, is not
read; nor is the text a toggle projects when an `[attr.aria-label]` sits on
its host, nor whether a bound `aria-describedby` points each copy at its
own element. The seventh cannot see a
reference or an id set in TypeScript or by a host binding, a bound or
interpolated one, an id declared twice or once per item, which leaves a
reference ambiguous rather than empty, or whether the element named holds
any text. The eighth cannot see a name set in TypeScript or by a host
binding, a `title`, which is not read, so a control named by one alone
fails, a structural `*ngIf`, read as rendering always, an element hidden by
a bound `[attr.aria-hidden]`, read as rendering, an `aria-label` bound to an
expression that is null in some states, read as naming the control in every
state (the camera's process button and the form's submit take that shape),
whether a component, a projection or a binding renders any words, or
whether the name says anything. Neither the sixth nor the eighth counts a
chip or a button toggle as a control. The ninth cannot see a control named
by its own text, a field named by its `<mat-label>`, controls in two
templates shown on one page, such as the shared dialog header's *Close*
beside a dismiss in the form it heads, or two blocks that their conditions
keep apart without an `@else`, such as two `@if`s on one signal and on its
negation, which it reads as rendering together. The tenth cannot see a
name or a role set in TypeScript, by a host binding or through
`[attr.role]`, reads a `[multiple]` bound to an expression as multiple
whatever it holds, and cannot tell whether the name says what is chosen.
The script's header lists the rest.

### A dialog is named by its title alone

Material names a dialog by its `mat-dialog-title`, through the container's
`aria-labelledby`, and `aria-labelledby` takes every word under the element
it names. The shared header, `app-dialog-header`, which 19 dialogs draw, held
its close button inside that `h2`, so each dialog was named for its title
and *Close*: *Note Close*, *メモ 閉じる*, *備註 關閉*, and a headings list
read the same words. The header's row is a `div` now. The `h2` holds the
title and any glyph beside it, which `mat-icon` hides, and the close button
stands beside the `h2`, so the dialog is named by the title's words. The
confirm, the currency code and the AI search dialogs write their own
titles, which hold words and, in the AI search, an `aria-hidden` glyph, and
no control.

And each one is a `dialog`. `MatDialog.open` spreads
`MAT_DIALOG_DEFAULT_OPTIONS` in place of Material's own defaults, not over
them, and the app's options named only the sizing and the two focus
settings, so no dialog carried a role or `aria-modal`.
`provideAppDialogs()` (`core/config/dialog.config.ts`) starts from
`new MatDialogConfig()` and changes three keys: the width, the max width,
and the focus trap's timing. Focus moves into a dialog as it renders rather
than after its 150ms entrance, so keys typed straight after the press that
opened it reach the dialog, not the page behind. The old options gave the
app that trap by leaving the key out; it is kept now on purpose.

A dialog a menu's entry opened gives focus back to the menu's button when
it closes. The dialog returns focus to what held it as it opened, and that
is the entry, which has left the page with its menu by then, so focus fell
to the page: cancelling a row's Delete from its menu left a keyboard user
at the top (the third browser run). `provideAppDialogs()` carries the rule,
`returnFocusPastTheMenu`, beside its options: once the dialog has gone,
focus left on the page goes to the button whose `aria-controls` named the
menu. Focus the dialog could put back stays where it went, as where a dialog
was told where to return it, and the return carries the close's own origin,
a keyboard focus after Escape and a mouse focus after a click on the
backdrop, as the CDK's own restore would; that is read from the CDK, and no
spec pins it. A datepicker a menu's entry opens is no dialog, and still
drops focus that way (*Known gaps*).

Pinned in `dialog-header.component.spec.ts`, `dialog.config.spec.ts`,
`app.config.spec.ts` and, for the menu's button,
`transaction-list.component.spec.ts` (*What is tested*); no gate reads what
a title holds (*Known gaps*)
([ADR 0187](ADR/0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)).

## No page skips a heading level

A reader who moves by headings learns a page's shape from their levels, and
a level skipped reads as a section missing. A page's title is its `h1`, and
what stands directly under it sits one level down
([ADR 0194](ADR/0194-one-painted-contrast-helper-and-one-focus-hand-off-a-card-is-scored-part-by-part-and-no-page-skips-a-heading-level.md)):

- **Card titles and sections are `h2`.** The dashboard's card titles, the
  budget card's and the goal card's names, the Data page's five sections and
  the AI summary's title are `h2`, and Budget Progress, the recurring list
  and two Reports cards, the country and recurring-versus-one-off cards,
  write their title as `<h2 mat-card-title>`. What stood under them moved up
  with them: upcoming bills' day header, the category breakdown's section
  title and the recurring list's two section labels are `h3`.
- **An empty state sits one level under what it stands under.** The shared
  empty state draws an `h3`; the eighteen that stand directly under a page's
  `h1` take `[headingLevel]="2"`, and those under a card title keep the
  `h3`.
- **The sign-in page's title is its `h1`.** The page stands outside the
  shell, and its title was a plain `mat-card-title`, so it had no heading at
  all. It is `<h1 mat-card-title>` now, with the look it had (*Known gaps*).

The walkthrough runs axe's `heading-order` alone, once for each page it
sweeps whole, after the passes in both schemes
(`expectHeadingsInOrder(root, where)`, over `headingsOutOfOrder` in
`core/services/testing/axe.ts`), the wizard's spec runs it over the
upload step the same way, and the sign-in page's spec over that page, which
the walkthrough opens only through its redirect. The rule is best
practice, outside the WCAG run every sweep makes, which is left as it was.
A run that meets no heading says so, `heading-order: no heading found`,
since an inapplicable rule reports no violation. With the Data page's first
section put back to `h3`, `npm run smoke` failed the walkthrough at
`heading-order on /data` with `Unexpected $[0] = 'heading-order (1): h3'`.
Each site holds its outline in its own spec's real-template block, and that
is what holds the Reports tabs past the first, which the walkthrough
audits only in view or never opens (*Known gaps*). Run 1 in the browser, on 19
November 2026, found no skip on any page it walked, all five Reports tabs
and an empty account's pages included.

## A transaction row is a button beside its controls

The row's first line — description and amount — is a native
`<button class="row-head row-activate">`, named *{description}, {amount},
{date}* (`transactions.rowLabel`). The row around it is a plain container: no
role, no tab stop, no listener in its template. Before
[ADR 0151](ADR/0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)
the whole row was a `role="button"` holding the swipe drawer's buttons, the
menu trigger and the maps link, and a button's descendants are flattened away
for assistive technology.

- **The keyboard reaches the button; the pointer reaches the host.** Enter or
  Space on the button is one native click; a click anywhere else on the row,
  the category strip included, is answered by the component host's own click
  listener, which leaves a click on one of the row's own controls, or on the
  strip's scrollbar, to that control. Escape anywhere in the row closes the
  drawer.
- **The menu comes first, and names its row** — *More actions for
  {description}* — because it no longer sits inside a named row. It precedes
  the row button in DOM order, which is Tab order: the list's reserve rules
  need `.row-actions` as the surface's first child.
- **A split part says so.** The button's `aria-label` replaces its content's
  name, so on a split part the button points at the split badge with
  `aria-describedby`.
- **The ring is drawn on the row**, inset, through
  `.transaction-row:has(.row-activate:focus-visible)`, which
  `a11y.frame-ring` in `src/theme/_a11y.scss` writes for the row, the
  upload area and the filter panel's two pills round their text boxes
  alike, clearing the control's own ring.

## A focused button shows an indicator inside it

Every Material button, of every kind, text, flat, stroked, raised, tonal,
icon and the FAB, shows Material's own focus indicator while it has keyboard
focus: a solid line 2px wide, 3px under high contrast, in the button's own
text colour, drawn inside the button. Material draws it as the `::before` of
a span inside every button and leaves it hidden until asked, and
`src/styles.scss` asks, on `.mat-mdc-button-base`
([ADR 0196](ADR/0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)).
Before, Material cleared its icon buttons' outline, and a focused one was
marked by its 12% state layer alone.

- **The text colour**, because the button's label or glyph already reads in
  it against what the button sits on, so the line reads wherever the button
  does. No one colour does that on every surface a button sits on: the
  app's `--color-primary` outline scored 2.60:1 round the clear button on
  the dark period chip, and 1.09:1 inside the filled picker button.
- **Inside**, because a line drawn outside a button meets whatever is round
  it. Material draws this one a few px past the edge of a flat, raised,
  stroked or tonal button and the FAB, where the label's colour meets the
  page rather than the fill (a flat button's white label on a white card is
  1:1), and where a parent that clips its overflow cuts it off. A `margin: 0`
  at (0,3,1) takes Material's offset back, over its own (0,2,1); the FAB's
  line keeps the FAB's corner. Text and icon buttons already draw it inside.
- **An icon button's 12% focus state layer goes.** It tinted the fill under
  the line, and took a pinned answer's pin on dark `--surface-muted` from
  3.99:1 to 2.86:1.
- **The app's outline gives way** on a Material button, at (0,2,0) over the
  app's own `:focus-visible` at (0,1,0), whichever stylesheet reaches the
  page first, since the app and Karma load them in opposite orders. The rule
  sits under `@media (forced-colors: none)`, so forced colours keep the
  outline Material draws there.
- **A held button**, disabled but kept focusable so a keyboard user reaches
  it and the hint that says why it is held, draws its line in
  `--mat-sys-on-surface-variant`: in its 38% label colour the line scored
  2.2:1 to 2.7:1.
- **A framed control shows one outline.** `a11y.frame-ring` hides the
  indicator of the control it frames as it clears that control's outline,
  so Browse, inside the upload area's frame, shows one outline, not two.

Chips, menu items, tabs, switches, checkboxes, radios and button toggles
keep their own focus look, and hand-rolled controls the app's outline.
`src/app/focus-indicator.spec.ts` reads the rules from the stylesheet and
measures the rendered line through `readIndicator` and
`expectIndicatorInEveryPalette` (`core/services/testing/focus-indicator.ts`)
in the four palettes, with Material's focus state layer laid under it, at
3:1 or better on what it is drawn over. On their own fill, in Karma, plain
and dark, a flat button's line reads 4.97 and 6.32, a text or stroked
button's 5.45 and 7.50, a raised button's 5.18 and 8.58 and the FAB's 5.96
and 5.50. Four specs read it on their real templates, through the same
helper: the filter panel's, on Save and Cancel in the save pill and on each
suggestion's remove; the answer history's, on an open row's pinned pin; the
goal card's, on Edit and Delete; and the header's, on the shortcuts hint's
dismiss. Run 1 in the
browser, on 19 November 2026, read the line after a real Tab onto eleven
buttons: drawn inside, 2px and 3px under high contrast, in the button's
text colour, from 4.94:1 up in all four palettes.

## The category dot says where its grade came from

The dot beside a review card's category chip is a graphic with a name of its
own (`role="img"`), and its name is its tooltip. It used to read *High
confidence (95%) — the AI is confident about this category* for a category
answered from memory, and *(100%)* for one the reviewer had picked: a figure
nothing had measured, said aloud. The name now says where the grade came
from, *You filed this merchant here before*, *You picked this category*,
*This category comes from the backup* and the rest, and quotes a percentage
only for a categorizer answer that carried its own
([import-fields.md](import-fields.md#what-the-chip-says-of-its-grade),
[ADR 0190](ADR/0190-a-review-sentence-names-where-its-grade-came-from-and-quotes-a-percentage-only-where-a-model-reported-one.md)). The colour still follows the grade, and still owes 3:1 to the card
around it in both themes (`category-suggestion.component.spec.ts`).

A flagged amount or date is named the same way: by why it is doubted, with a
percentage only where a model reported one
([receipt-import.md](receipt-import.md)).

## A filter date says why it is refused

The transaction filters' compact grid has no room beneath a field, so
Material's subscript is hidden there, and text that is no date in From or To
showed the error outline alone. Each input is described by a text of its own,
kept off the screen with the app's `visually-hidden` mixin: empty while the
field reads as a date, *Enter a valid date.* once the reader has left it
holding a parse error, and announced politely as it appears. It is filled
when the outline is drawn, not on the first keystroke, since every first
keystroke of a date is text that is no date
([ADR 0191](ADR/0191-sorts-reminders-the-filter-dates-and-an-open-calendar-follow-the-readers-language-the-taxonomy-declares-only-what-is-sent-and-the-budgets-page-follows-its-tab-while-open.md)). Pinned in `transaction-filters.component.spec.ts` and, on the routed
page with an axe pass, in `app.smoke.spec.ts`.

## The filter panel's text boxes say what they are for

The search box is named *Search transactions*
(`transactions.searchBoxLabel`; ja *取引を検索*, tc *搜尋交易*), its
placeholder's own words without the ellipsis. A placeholder is no name, and
it goes as soon as the box holds a query; the placeholder stays, as the
hint it was.

The save-search box opens holding the query as the name it offers, so a
placeholder in it showed only once the box was emptied, and was all a
screen reader had to name it by. A caption now stands above the box inside
its pill, *Name for this search* (`transactions.saveNameLabel`; ja
*この検索の名前*, tc *此搜尋的名稱*): a real `<label for>`, whose `for` names
that panel's box alone, shown whatever the box holds, and the box's name.
The placeholder and its key are gone. The caption takes the panel's hint
look, `--text-muted` at `--text-xs`, and wraps rather than being cut; the
pill grows from 48 to 60px, and Save and Cancel keep 40px inside it. The
caption reads at AA on the pill in the four palettes; run 1, on 19 November
2026, measured 6.87, 9.37, 5.84 and 11.12 to 1, plain, high contrast, dark
and dark high contrast. Pinned in `transaction-filters.component.spec.ts`
by *names the search box with its placeholder taken away* and the describe
*the save-search box's caption (real template)*, in en, ja and tc
([ADR 0196](ADR/0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)).

## The filter panel hands focus on when its controls go

A focused control that its own handler takes off the page drops focus to the
page, and a keyboard user starts again from the top. The transaction filters
had three such places
([ADR 0187](ADR/0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)):

- **Clear all** goes once nothing is left to clear. Focus goes to the filter
  toggle, which stays, heads the panel it opened and then reads *Filters*
  with no count; not to the search box, whose focus opens the recent
  searches under it. The panel clearing itself on load, to show every
  transaction, moves no focus.
- **A suggestion applied from the keyboard**, reached by ArrowDown and
  pressed with Enter, goes with the panel that held it. Focus goes back to
  the search box, where a pointer tap had left it all along.
- **The save-search box** takes focus as it opens, with the query it offers
  as the name selected, so a typed name replaces it and Enter alone keeps
  it. Enter, the box's Save or Cancel, Escape, or a second press on Save
  search closes it, and focus goes back to Save search. Once an emptied
  query has taken Save search away too, there is nothing to save, so only
  Cancel and Escape close it, and focus goes to the search box, whose focus
  opens its suggestions, as it does under any empty query. The second press
  closes it the way Cancel does because a tap focuses nothing in WebKit
  (Safari and the iOS app), so focus would still be in the box the press
  takes away. An Enter or an Escape that ends an IME composition is the
  IME's. The Enter that saves is cancelled, since its keypress would
  otherwise press Save search, which holds focus by then. Save search says
  with `aria-expanded` whether the box is open, as the filter toggle does,
  and the box's own button is named *Save* (`common.save`): while the box
  was open, both read *Save search*, and the first closes the box unsaved
  (the third browser run). A voice command for Save search still closes the
  open box unsaved, as a disclosure does.

Each goes through `focusWhenRendered` (`shared/utils/focus-when-rendered.ts`),
the one helper for a hand-off made once a render has settled, which the
upload area, the review card, the household pages, the dashboard layout
settings, a split's parts, the receipt viewer, the note translation lens
and the transaction list use too
([ADR 0194](ADR/0194-one-painted-contrast-helper-and-one-focus-hand-off-a-card-is-scored-part-by-part-and-no-page-skips-a-heading-level.md)).
A held Enter presses once: the helper drops the repeats of Enter and Space
held across a hand-off until the key is let go or pressed afresh, so no
repeat folds the panel Clear all left open or opens the box a close has
just shut. A held Enter on the filter toggle itself still opens and closes
the panel on every repeat, as any toggle does. Each text box's pill draws
the ring while the box has focus (a text box matches `:focus-visible` on a
click as on a key), 2px solid `--color-primary` at a −2px offset and 3px
under high contrast, through `a11y.frame-ring`, since the box's own
`outline: none` outranks the app's ring and a focused box showed only its
caret; the save box's caption sits inside its pill, so the ring takes it in
too. Save search, and Save and Cancel in the save box's pill, show a
Material button's focus indicator (*A focused button shows an indicator
inside it*). Pinned in
`transaction-filters.component.spec.ts` by the describe *focus after Clear
all, a suggestion or the save-search box takes the pressed control away
(real template)* and its nested *an Enter held down through the hand-off*,
*the save-search box, as it opens* and *Save search and the box it opens,
told apart*, and by *the two text boxes' ring (real template)*. A
suggestion's own remove still drops focus (*Known gaps*).

## Focus stays in the list after a delete

A confirmed delete takes its row off the list, and with it the control that
held focus: the confirm gives focus back to the row's menu button, which
leaves with the row. Once the row has gone, and only if focus fell to the
document, focus goes to the menu button of the row now in the deleted row's
place, else of the row before it, else to the empty state's button. The
hand-off lists each row's two menu buttons, `.action-btn` in the desktop
table and `.row-menu-btn` in the phone list, since only one view renders
and which one can change while the confirm is open. The list has no
heading to fall back on, and its select toggle shows only for an account in
a household, so neither is a landing
([ADR 0196](ADR/0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)).

- **The row's place is followed.** It is read as the confirm opens, so a
  row that goes while it is open still has a place, and kept current while
  the row is listed, so rows that load above it move it along.
- **The row leaves at once.** The page hides a confirmed row while its
  delete waits out the Undo window
  ([ADR 0197](ADR/0197-a-deleted-transaction-can-be-brought-back-for-ten-seconds-because-the-delete-waits.md)),
  so the hand-off runs as the confirm closes. A list left with no row and no
  empty state is still loading, and the hand-off waits for one or the other.
- **The swipe door lands where a menu does.** The drawer shuts as its Delete
  is pressed, which hides that button and moves it off-canvas, so a confirm
  the drawer opened, cancelled or not, gives focus to the row's
  `.row-menu-btn`.
- **A row that comes back is offered focus.** Undo, or a delete that
  failed, lists the row again; the list scrolls to it and puts focus on its
  menu button if focus fell to the document or was left in the Undo notice,
  which keeps it while it plays its way out and then drops it. Focus the
  reader has put anywhere else stays there, and a later delete still waiting
  to hand focus on decides instead
  ([ADR 0197](ADR/0197-a-deleted-transaction-can-be-brought-back-for-ten-seconds-because-the-delete-waits.md)).

Every hand-off here goes through `focusWhenRendered` with `onlyIfDropped`.
Pinned in `transaction-list.component.spec.ts` by the describe *focus after
a dialog a row menu opened (real template)*, through the desktop actions
menu, the phone's trailing menu and the phone's swipe drawer, and its
nested *when the page hides the row the moment its delete is confirmed*.
`delete-undo.smoke.spec.ts` deletes by keyboard through the real menu and
confirm against the emulators, and finds focus on the row now in the
deleted row's place and back on the row after Undo. Run 1 in the browser,
on 19 November 2026, deleted from the desktop menu, the phone's menu and the
swipe door, and found focus on the menu button of the row now in its place
each time, and on the row's own after Undo.

## The period chip's clear hands focus to the quick ranges

The period selector shows a month or a year picked from its calendars as a
chip with a clear button. The clear was named *Close*, which said nothing of
what it closed; it is *Clear {period}* (`dashboard.clearPeriod`), holding
the chip's own words. A clear pressed with focus on it takes the chip, and
itself, off the page, so focus goes to the quick range the period returns
to, the checked *This Month*, once the render that removes the chip has
checked it; a clear made while focus is elsewhere leaves focus alone.
Pinned in `period-selector.component.spec.ts`, in en, ja and tc for the
name
([ADR 0196](ADR/0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)).

## Announcements

A live-region announcement made before a write settles is a claim, and a
failed write has to correct it — not just show a visual error toast, which a
screen-reader user reading the announcement has no reason to go looking for.

The dashboard layout editor's keyboard move is the instance of this:
pressing **Move up** or **Move down** announces the position it moved to
immediately, optimistically, before the account's preference write has
landed — reading that wait as lag would be worse than the small chance of
being wrong. A write that then fails announces again, once the rows fall
back to the account's last-known order, naming where the card actually
ended up. See [docs/dashboard.md](dashboard.md) for the exact strings and
[ADR 0132](ADR/0132-the-dashboard-is-arranged-by-the-account-and-a-hidden-card-composes-nothing.md)
for the optimistic-write pattern this follows.

The rule generalizes beyond that one control: anywhere an announcement is
made ahead of a write rather than after it, a failure path needs its own
announcement, not only its own visual notification. The dashboard's card
menu is the second instance: its Hide and its moves announce before the
save settles, and a failed save is followed by where the card really is
([docs/dashboard.md](dashboard.md#the-card-menu)).

**One voice per event.** `NotificationService` already announces every
snackbar it shows, so a change a snackbar reports is never announced a second
time beside it.

**A notice with an action is heard once, and names its action.** A deleted
transaction's notice carries *Undo* in place of Close, and stays while its
delete waits out a ten-second window (`UNDO_WINDOW_MS`), which stands still
while the notice is hovered or holds focus
([ADR 0197](ADR/0197-a-deleted-transaction-can-be-brought-back-for-ten-seconds-because-the-delete-waits.md)).
Material's snack bar would read the action's label out with the message in
its own live region, so that region is off for this notice
(`withAction` opens it with `politeness: 'off'`), and the notice is
announced once, politely, through the queue, in words that name the action:
*Deleted {description}. Undo is available for a few seconds.*
(`transactions.deletedWithUndo`, with the translated `common.undo` in its
`{{action}}` slot, so every language names the button it shows). What it
shows is *Deleted {description}* beside **Undo**. Undo announces *Restored
{description}* (`transactions.restored`) once, from the service that
restores it, and focus comes back with the row (*Focus stays in the list
after a delete*). A delete that fails brings the row back and opens an
error notice, *Couldn't delete {description}* (`transactions.deleteFailed`),
only once no Undo notice is up, since one opened over the next row's notice
would take that Undo away. The single-row confirm no longer says the delete
cannot be undone.

**One announcement at a time.** `AnnouncerService` queues what it is handed.
Handed straight through, a second message inside the CDK `LiveAnnouncer`'s
delay of about 100 ms would clear the first before it was written. Handing
the second on the moment the first is written would be no better: the CDK
writes a message and resolves its promise in the same task, and begins its
next `announce()` by clearing the region, so the second would replace the
first before a rendering update had exposed it to the accessibility tree.
Each message therefore waits until the one before it has been written and has
stood for `ANNOUNCEMENT_GAP_MS`, 150 ms — a timer, since an animation frame
never fires in a hidden tab — and one with nothing ahead of it goes out at
once. That holds for every announcement made through `AnnouncerService`;
Material's own do not pass through it (see Known gaps).

What a message reports decides how it joins the queue. One that reports
current state — a count, a position — passes `'replace'`, since a later state
makes it stale; one that reports an event — a removal, a notice,
an alert — queues, since nothing said after it does. `'replace'` drops every
waiting message that was itself passed with `'replace'`, whichever surface
raised it, and never one passed with `'queue'`, so a keystroke cannot cost a
waiting alert or error its turn. The
state messages are the command palette's result count, a dashboard card's
position after **Move up** or **Move down**, the transaction list's count and
totals, the count of rows chosen in the transactions select mode (with the
cap's note in the same message when a choice was refused, so a run of refused
choices never piles notes up behind the count), and the household overview's
count of rows shown after **Show more**. The palette's count changes on every
keystroke: while typing continues a count goes out at most once a turn — the
CDK's delay and then the gap — each the latest count at that moment, and when
typing stops the last count is the last count placed. A failed move's
correction leads with the failed save, an event, and queues
([ADR 0149](ADR/0149-the-review-step-says-what-it-changed.md)).

**The transaction form says what a type change did to the category.** The
category list is per side, so changing the type blanks a category the new
side cannot hold, and the blank alone shows that something went, not what:
*Category cleared: {category} is not offered for this type*. The form holds
the category it blanked, and turning the type back to the side it fits,
while the field is still empty, gives it back: *Category set back to
{category}*. Any category chosen in between ends the hold, and a scan that
moves the type and fills its own category ends it silently, since what the
field then shows is the scan's newer answer. The split's parts the new type
cannot hold were already said the same way
([ADR 0185](ADR/0185-a-refund-is-asked-about-at-every-door-and-a-category-follows-its-rows-side-there-and-back.md)).

### The import review step

The review step says each change below once, naming the row where the
sentence has room for it
([ADR 0149](ADR/0149-the-review-step-says-what-it-changed.md)). The card's and
the wizard's own announcements are polite; a snackbar's follows its tone, so
the set-aside notice, an error, is assertive.

| Event | Sentence | By |
|---|---|---|
| A duplicate verdict overruled | *{description} is not a duplicate* | the card |
| A tag filed | *Tag {tag} added to {description}* | the card |
| A tag removed | *Tag {tag} removed from {description}* | the card |
| A country withdrawn | *Country removed from {description}* | the card |
| A location removed | *Location removed from {description}* | the card |
| A category moved — to the other side's catch-all by a flip of the row's type or by a merge, whichever side its net lands on, or back to the category an earlier flip moved, by a flip back ([ADR 0162](ADR/0162-a-refund-read-on-the-device-is-filed-as-income-and-the-review-asks-about-it.md), [ADR 0185](ADR/0185-a-refund-is-asked-about-at-every-door-and-a-category-follows-its-rows-side-there-and-back.md)) | *Category for {description} changed to {category}* | the card |
| Rows already on screen moved to their side's catch-all when the account's categories arrive after them, said once for the batch ([ADR 0185](ADR/0185-a-refund-is-asked-about-at-every-door-and-a-category-follows-its-rows-side-there-and-back.md)) | *Rows filed under the other side's category moved to this side's catch-all now that your categories have loaded* | the card |
| A row removed — after *Remove this row?* when it carries work made on the card | *{description} removed* | the card |
| A re-check flipping verdicts, the edited row's or any other's | *{count} duplicate verdicts updated* | the wizard |
| A currency change that rounds amounts to nothing, one row or the selection | *{count} amounts round to nothing in {currency} — add them again* | the snackbar |
| Rows failing a second time and set aside | *{count} rows failed to save twice and were set aside — reselect them to try again*, as the second sentence of the round's *Imported {success} of {total} transactions — {failed} could not be saved* | the snackbar |
| Rows saved without their photos | the image-quota sentence, the failed-upload sentence or both, after the rest of the round's one notice — the error when a row failed, an info notice otherwise | the snackbar |

A round's one notice stays up for its tone's own duration and two seconds
more for each sentence past the first, so a notice that joins three is still
on screen while its last sentence is read. The sentences are counted in the
joined text by their stops, since one part of a notice can hold two: the
failed-upload part does in en and ja, the set-aside part in ja.

A row with no description yet is named *an untitled row*: the slot sits inside
a sentence, so it takes a noun phrase rather than the edit trigger's *Add a
description*. The stand-in is never quoted: tc puts a filled row's
description in 「」 through `common.quotedName`, and the stand-in bare, so a
blank row's removal is announced as *已移除未命名的項目*. Picking a country
is not announced — the menu it was picked from is where the user is
looking. A failed row's reason stands on its card as
`role="note"` rather than an alert: it happened during the write, before that
render, and interrupts nothing.

### The upload area has one button

The import upload area, empty, is a frame with one native button inside it,
**Browse Files**, in the transaction row's shape
([ADR 0151](ADR/0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)).
The `.dropzone` carries no role, no tab stop, no `aria-label` and no key
handler. As a `role="button"` wrapped round Browse it made Browse, the hint
and the file types its presentational children (axe's
`nested-interactive`), gave the keyboard two stops that did one thing,
opened the picker twice on Enter and kept Space from Browse
([ADR 0187](ADR/0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)).

- **Browse is the one keyboard route.** Tab meets one stop on the empty
  zone, and Enter or Space opens the picker once, as a native button does.
  Browse is named by its own words and described by the hint, *Supports
  CSV, PDF, images, and JSON backups*, through `aria-describedby` and the
  zone's own `hintId` (`dropzone-hint-<n>`, from a module-level counter), so
  it never reads another zone's hint. The title, *Drop files here or click
  to upload*, is only a heading, an `h2` one level under the page's `h1`.
- **A pointer click on the empty zone opens the picker once.** The
  component's host answers it (`onZoneClick`), as the transaction row's
  host does, and asks the hidden input once when three guards pass: nothing
  is picked, the click landed inside the `.dropzone`, and it came from no
  button, link or input inside the zone. The input guard is why one click
  asks once: the picker is the input's own click, which bubbles back out
  through the zone. Once a file is listed, adding more is the work of **Add
  more files**, and a click on the rows opens nothing; nor does a click on
  the refusal banner.
- **The ring goes round the zone.** The zone is never `:focus-visible`
  itself, so `a11y.frame-ring('.dropzone', '.browse-btn', 2px)`
  (`src/theme/_a11y.scss`) draws `.dropzone:has(.browse-btn:focus-visible)`
  2px solid `--color-primary` at a 2px offset, 3px under high contrast, and
  clears Browse's own ring and the focus indicator Browse, a Material
  button, would draw inside itself, so one ring shows
  ([ADR 0196](ADR/0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)).
  The transaction row's ring comes from the same mixin at −2px.
- **The Data page's backup upload area stays one `role="button"`.** Nothing
  inside it is a control, so it nests none. Its hidden input sits just
  before the area rather than inside it, so a press or a click asks the
  input once, and Space's keydown is cancelled before the area asks, so the
  page does not scroll under it.

Pinned in `file-dropzone.component.spec.ts` by "offers Browse as the empty
zone's one control, described by the hint", "keeps one tab stop on the empty
zone, Browse", the cases under *a key pressed on Browse*, "asks the input
once a click, though the input's own click bubbles back out through the
zone", "opens nothing from the refusal banner" and "rings the zone while
Browse has keyboard focus, 3px under high contrast, and clears Browse's
own". The wizard's spec sweeps the empty step with axe and finds nothing in
either scheme (*What is tested*).

### A photo on the upload area is named by its number among the photos

Each row names its buttons by the file they act on, and a photo by its
number among the photos, the number its badge shows: *Remove photo 2
(image.jpg)*, *Move photo 2 (image.jpg) up* and *down*
(`import.removePhotoLabel`, `import.movePhotoUpLabel`,
`import.movePhotoDownLabel`). The number comes first because two photos from
an iPhone are both `image.jpg`. A file that is no photo is numbered among the
other files and is only ever removed, *Remove file 1 (rows.csv)*
(`import.removeFileLabel`), so `[rows.csv, image.jpg, rows.csv]` reads
*Remove file 1*, *Remove photo 1* and *Remove file 2*. ja and tc count a
photo with 枚目 and 張, a file with 番目 and 個. A screen reader hears the
number a sighted reader sees
([ADR 0187](ADR/0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md),
which amends ADR 0186's place-and-name rule).

In a pick that mixes photos and a CSV, the files keep the order they were
picked in, and the photos are numbered among themselves in place. The
badges, the arrows and the drag handles stand once two photos are listed. An
arrow steps past a row that is no photo and swaps the two photos: in
`[a, csv, b]`, b's up arrow gives `[b, csv, a]`. Up is disabled at photo 1
and down at the last photo. A row that is no photo is no drag item at all:
inside the list's one `@for`, `@if (isImageFile(file))` picks between two row
templates, and only the photo's row is a `cdkDrag`. So a photo dragged past
a CSV leaves the CSV's row where it stood, where CDK used to slide it aside
and snap it back on the drop, and a drop's indices count the photos alone
([ADR 0193](ADR/0193-a-row-that-is-no-photo-is-no-drag-item-the-receipt-or-statement-chips-are-measured-and-the-upload-area-shows-where-a-photo-will-land.md)).
The wizard hands the reader the photos in badge order.

A drag shows where the photo will land and what can move. The slot it will
land in is an empty outline, its edge dashed in `--color-primary-text`,
which holds a graphic's 3:1 on the zone it shows through: 6.30:1 at rest
and 6.58:1 hovered in light, 11.60:1 and 6.72:1 in dark, high contrast as
its base. The lifted row is drawn inside the list
(`cdkDragPreviewContainer="parent"`), so at a phone's width it keeps its
two-line layout, at full strength, and moves only up or down
(`cdkDragLockAxis="y"`), keeping up with the pointer now that the row's
`transition: all` is gone. The handle says `grab`, and `grabbing` once
pressed; while a photo is held the whole list says `grabbing`; a zone that
holds files says `default`, since a click there opens nothing. Only a row
that can move lifts under the pointer, and nothing lifts while a photo is
held. The handle is a 40 by 40 target round its glyph, and each arrow's
touch target is held to the arrow's own 28px, so neither reaches over the
other
([ADR 0193](ADR/0193-a-row-that-is-no-photo-is-no-drag-item-the-receipt-or-statement-chips-are-measured-and-the-upload-area-shows-where-a-photo-will-land.md)).

A move that lands a photo at either end used to drop keyboard focus to the
page, since the pressed arrow is disabled there. Focus follows the moved
photo to its new row: the arrow pressed, while the photo can still go that
way, else its other arrow, else its remove (`focusWhenRendered`,
`shared/utils/focus-when-rendered.ts`). A drag moves no focus. A remove
takes its own button off the page, and the last file's takes the list with
it, so focus goes to the remove of the row that takes the removed file's
place, else of the row before it, and to Browse once the list is empty,
after a click as after a key. Nothing is announced: the remove that takes
focus reads the file now in that place. An Enter held down moves a photo one
place, or removes one file. Each repeat used to press the control focus had
moved to, so a held Enter on an arrow sent the photo to one end and back,
and one on a remove emptied the list and then opened the picker from
Browse; `focusWhenRendered` now drops the repeats where focus lands until
the key is let go or pressed afresh.

Pinned in `file-dropzone.component.spec.ts` by "names each row's remove and
move buttons by the file's place and name", "renames a row's buttons when its
file moves", and the cases under *a pick that mixes photos and a CSV*,
*focus after a photo moves* and *focus after a row is removed*; the sixth
`icon-labels:check` rule holds the class (*Accessible names come from the
catalog*). Two cases under *a pick that mixes photos and a CSV* drag a photo
by its handle with real pointer events and read the CSV's row still
mid-drag; the slot, the lifted row, the cursors and the targets are held
under *the pointer over the upload area*, *at a phone's width* and
*colours, as painted*. Run 1 in the browser, on 19 November 2026, read the
CSV still mid-drag and dragged with the pane's own pointer from
`[b, csv, a]` to `[a, csv, b]`.

With a photo picked, the upload step asks *What are these images?* above two
chips, *Receipts* and *Statement*. Their listbox is named by that question. It
used to have no name: its `aria-labelledby` named `image-kind-label`, which
the question carried as a class and not as an id. The seventh
`icon-labels:check` rule holds that class
([ADR 0186](ADR/0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)).
axe cannot score the chips' labels, so `import-wizard.component.spec.ts`
measures them as painted, in the four palettes and with either chip picked:
the picked chip's label and checkmark on its fill, the other's label on the
page ("reads each receipt-or-statement chip's label at AA and the checkmark
at 3:1 in the four palettes, in both states"). At rest, in every palette
and with either chip picked, the picked label reads 7.22:1 on its fill and
its checkmark 7.22:1, and the other label 8.56:1 on the page in light and
14.52:1 in dark; high contrast leaves Material's `--mat-sys-*` tokens alone,
so its palettes paint the chips as their bases do. It reads them at rest,
not focused (*Known gaps*)
([ADR 0193](ADR/0193-a-row-that-is-no-photo-is-no-drag-item-the-receipt-or-statement-chips-are-measured-and-the-upload-area-shows-where-a-photo-will-land.md)).

A press on the chip already picked, by click, Space or Enter, keeps it
picked. The listbox reported no value after such a press and the binding
wrote back the value it already held, so both chips read
`aria-selected="false"` and lost their fill and checkmark while the photos
were still read as receipts; the pick is now put back whenever the listbox
reports none. Pinned in `import-wizard.component.spec.ts` under *a second
press on the receipt-or-statement chip already picked*
([ADR 0193](ADR/0193-a-row-that-is-no-photo-is-no-drag-item-the-receipt-or-statement-chips-are-measured-and-the-upload-area-shows-where-a-photo-will-land.md)).

### A file the import refuses

The import dropzone refuses a file it cannot take, too large or of a type it
does not read, with a banner under the dashed zone: *{name} is larger than
the 10 MB limit*, or that it is not a supported file type. A file shared from
another app that the share gate turned away is named in the same banner, with
two sentences of the gate's own, *{name} is empty* and *{name} is a backup:
pick it here to import it* ([share-import.md](share-import.md)). The banner is
`role="alert"`, because the refusal answers the pick, the drop or the share
the user just made, and its icon is decorative (`aria-hidden="true"`); the
icon reads in the message's own `--color-error-text` (*A glyph at rest is
not faded under its bar*). It used to have no role, so a refused file was
silent to a screen reader: to someone who could not see the banner, the pick
seemed to have done nothing.

Several refusals share the one alert, one sentence a file, joined by the
reader's own stop, `common.sentenceSeparator`: a Latin stop and a space in
en, 。 alone in ja and tc. The alert joins them through `joinSentences`, the
import area's one way to join two sentences
([i18n.md](i18n.md#two-sentences-joined)). None of the four sentences ends in
a stop of its own in any catalog, so none is given up or doubled (pinned in
"the sentences its alert joins", with the rendered "joins the files it
refuses with the reader's own stop"). A share's refusals follow any the
user's own pick left standing.

The banner sits below the zone, not inside it. The zone was once the
`role="button"` that opened the file picker, and ARIA gives a button
presentational children, so an alert inside one is kept only where a browser
chooses to keep it; no `role="button"` stands in the upload area now (*The
upload area has one button*). The drag handlers sit on a frame around the
zone and the banner, so a file dropped on the banner still lands, and a
click on the banner opens nothing. Pinned in
`file-dropzone.component.spec.ts` by "announces an oversized file it
refuses", which also checks that no `role="button"` stands anywhere in the
upload area, and "takes a file dropped on the refusal banner".

Below the zone, the banner can land under the fold: on a 768px-tall window
the zone fills the first screen, so a sighted user who dropped a file saw
nothing change. When the banner appears or what it refuses changes, the
dropzone scrolls it into view with `block: 'nearest'`, after the render that
inserts it, and a fresh pick that refuses the same file again brings it into
view again. A share's refusal is brought into view the same way. The scroll
is never smooth, so reduced motion has nothing to turn off, and it moves no
focus: an alert is announced where it is. Pinned by "brings a refused file's
message into view, and again when the next refusal rewrites it", "brings the
banner into view again when the same file is refused a second time",
"announces a share the gate refused in the same alert, brought into view"
and "scrolls nothing for a file it takes".

The banner keeps the names it refused and the reasons, never the sentences,
and writes the sentences as it renders. So a reader who switches language
with the alert standing reads it in the new language: the switch rewrites it
in place and brings nothing into view. Whether a screen reader announces the
rewritten alert again was not checked. Pinned by "rewrites a standing refusal
in the language the reader switches to" and "brings nothing into view when
the language changes under a standing refusal"
([ADR 0186](ADR/0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)).

## Accessibility settings

Three preferences under **Settings → Preferences**, in an *Accessibility* group
below the theme and language controls. `AccessibilityService` carries them from
the account to the document root the way `ThemeService` carries the theme (see [ADR 0070](ADR/0070-accessibility-preferences-ride-the-account-and-land-on-the-root.md)).

| Setting | Stored as | What it does |
|---|---|---|
| Font size | `fontScale?: number` — one of `1`, `1.15`, `1.3` | Sets `--app-font-scale` on `<html>`, which `html { font-size: calc(100% * var(--app-font-scale, 1)) }` reads |
| High contrast | `highContrast?: boolean` | Adds `.high-contrast` to `<html>` |
| Reduce motion | `reducedMotion?: boolean` | Adds `.reduced-motion` to `<html>`, and zeroes the animations CSS cannot reach |

**They ride the account, not the device.** A person who needs larger text needs
it everywhere they sign in, so these sit beside `theme` and `language` on
`UserPreferences` and are written with dotted field paths — only the touched
key is sent.

**Absence resets.** `effectiveFontScale`, `highContrastEnabled` and
`reducedMotionRequested` in `user.model.ts` are total functions over
`UserPreferences | null | undefined`, each returning its default for absent
input (and the font scale also for a value outside the list, which another
build may have written). `AuthService` calls `AccessibilityService.init(prefs)`
*unconditionally* on every preferences sync, so an account switch whose
preferences carry none of these keys resets the previous account's settings
rather than leaving them in force.

### Font size is a variable, not a class

`--app-font-scale` multiplies whatever the root already is, so it **composes
with the browser font size the user set for themselves** instead of overriding
it. That is also why the type scale is expressed in `rem` and icons in `em`: a
non-16px effective root carries every one of them along with it. At the default
scale the property is *removed* rather than set to `1`, so the CSS fallback
stays in control.

### High contrast is not a second theme

It moves legibility tokens only — `--border-primary`, `--border-secondary`,
`--border-strong`, `--text-secondary`, `--text-muted`, `--text-disabled` —
each further along the ramp its own theme already uses, plus a 3px focus
ring, and a 3px focus indicator inside a Material button. Surfaces and brand
colours are untouched, and a
`.dark-theme.high-contrast` block continues the dark-neutral ramp, so
contrast and theme multiply rather than fight.

It is unrelated to forced-colors mode, which replaces author colours with
system ones regardless of this setting.

### Reduced motion has to reach three places

`AccessibilityService.reducedMotion()` is the **OR** of the account preference
and the OS's `prefers-reduced-motion`. Three consumers read that one signal,
because CSS alone cannot reach the last two:

| Consumer | How | Why CSS is not enough |
|---|---|---|
| Stylesheets | `.reduced-motion *` collapses animations and transitions to `0.01ms`, mirroring the `@media (prefers-reduced-motion: reduce)` block above it | A media query cannot be switched on from script, so the in-app override needs its own class |
| Material tab strips | `AccessibilityService.tabAnimationDuration` (`'0ms'` / `'200ms'`) bound to `[animationDuration]` | Material animates through the Web Animations API, driven by an explicit input |
| Charts | `ChartThemeService.animation()` returns `false` instead of `{ duration: 400 }` | Chart.js animates a canvas off the main thread, where no stylesheet reaches |

Both kill-switches collapse durations rather than removing animations, so
animation-end hooks still fire.

The settings toggle for this one reads the **stored** preference, not
`reducedMotion()`. Bound to the resolved value it would read "on" —
unturnable off — for anyone whose OS already asks for reduced motion, while
writing `false` to a preference that was already false. Font size and high
contrast read the service's signals, where stored and resolved are the same.

**Adding a new animation?** If it is CSS, both kill-switches already cover it.
If it runs through WAAPI or paints to a canvas, inject `AccessibilityService`
and read `reducedMotion()` — nothing sweeps for the ones that do not.

**Check:**

```bash
npm run motion:check
```

`scripts/check-motion.mjs` holds the CSS half to what is actually checkable: both
kill-switches still exist in `src/styles.scss`, still declare all four properties
with `!important`, and still cover `*`, `*::before` and `*::after` — and no
component stylesheet declares an `!important` duration of its own. That last one
is the way a component gets past them: `*` is specificity zero, so an
`!important` duration in a component rule ties on importance and wins on
specificity, and that component keeps moving for a reader who asked it not to. A
duration of about zero is the kill-switch's own spelling and passes; a
declaration inside the component's **own** `prefers-reduced-motion` block is
cooperating and is skipped. A declaration that has to outrun the kill-switch
would be recorded in the script's `ALLOWED` table with its reason; the table
is empty, and a repair edits it in the same commit.

The check says nothing about `forced-colors`, and there is no rule to write
there: three stylesheets declare it, each because it paints a focus or
selection state of its own. The sidebar and the bottom nav outline their
active item in forced colours, and `src/styles.scss` takes the app's outline
off a Material button only under `forced-colors: none`, so forced colours
keep the outline Material draws there. A gate demanding it of the rest would
be a gate that asserts nothing.

### Colour contrast is a property of a pair

**Check:**

```bash
npm run contrast:check
```

A stylesheet declares one token at a time, so nothing in it can say whether a
colour reads — contrast exists only between a foreground and a background, and
the author picks the token against whichever background happened to be on
screen. That is how three dark-mode chips shipped at 4.09, 4.10 and 3.00:1: an
income chip, a warning banner and an expense chip, all on the dashboard, all
under AA, with nothing to say so.

`scripts/check-contrast.mjs` scores a **hand-written table** of the pairs the
app paints, in **four** rendered modes — light, dark, light + high contrast,
dark + high contrast. Three things about that are worth knowing:

- There are four modes, not three: `.high-contrast` and
  `.dark-theme.high-contrast` are separate blocks resolving to different
  palettes.
- The two high-contrast blocks declare **zero** `--color-*` tokens — they
  override `--border-*` and `--text-*` only — so the colour tokens are
  identical there to the ones underneath.
- Pairing cannot be derived from the names. The base token is a **fill**,
  `-light` is a **tinted background**, `-text` is the AA-corrected
  **foreground**. Scoring every token as a foreground on `--surface-card`
  fails 14 of 20 in light, and nearly all of those are false positives: a
  chart bar owes nothing to a card it never sits on.

Rows come in three kinds: **required** (must clear its threshold in every
mode), **exempt** (recorded with the reason it is not a rule — a disabled
control, a divider, a combination nothing paints), and **frozen** (fails
today, pinned at the ratio it measures, may only improve; when one reaches
its threshold the script asks to have it promoted).

A required row's threshold is 4.5:1, the bar for text, unless the row names
3:1, the bar WCAG 1.4.11 sets for a graphic that carries meaning. Eight rows
do, because what they hold is a glyph, a dot or an outline, never a word:

| Pair | What it holds |
|---|---|
| `--color-ai` on `--surface-card` | the AI features' icons |
| `--color-primary-text` on `--surface-background` | the upload area's drop slot, a dashed outline, on the zone's resting fill under a finger: 6.30:1 in light, 11.60:1 in dark ([ADR 0193](ADR/0193-a-row-that-is-no-photo-is-no-drag-item-the-receipt-or-statement-chips-are-measured-and-the-upload-area-shows-where-a-photo-will-land.md)); it used to be exempt, painted by nothing |
| `--color-error` on `--surface-card` | the exact-duplicate mark and the dropzone's hovered remove; the data page's danger icon, on its error tint, is measured in the row's reason |
| `--color-error` on `--surface-background` | the import wizard's failure icons, and the low-confidence dot on an unchecked review card |
| `--color-warning-text` on `--surface-background` | the review card's amount and type flags, and the medium-confidence dot |
| `--color-success-text` on `--surface-background` | the wizard's success glyph, and the high-confidence dot |
| `--color-warning-text` on `--color-expense-light` | the transaction form's type flag in the checked Expense segment: 4.11:1 in light, 6.95:1 in dark |
| `--color-warning-text` on `--color-income-light` | the transaction form's type flag in the checked Income segment: 4.57:1 in light, 4.95:1 in dark |

A row at 3:1 says nothing about text in the same colour: `--color-error`
is 3.76:1 on the light card, so error text reads in `--color-error-text`.

`--self-test` asserts that every `--color-*` token the light palette declares
appears in `PAIRS`, `EXEMPT` or `KNOWN_FAILURES`, or in a named `NOT_PAINTED`
list, so a new token cannot be added unaudited. It also runs the frozen-row
ratchet, `frozenRowFinding`, over a synthetic row — at its floor, worse than
it, and clearing its threshold — since the real frozen table is empty.

The first run fixed four pairs — `--text-muted` moved to gray-600 (it measured
4.39 and 4.43 against `--surface-muted` and `--surface-background`), and the
three dark chips' `-text` tokens each moved one step lighter, with
`--color-expense-light` moving one step darker to meet its text — and froze
four more. Those four are fixed: the type toggles paint the income and expense
`-text` tokens that already existed, and two new ones name the foreground on
the error and primary tints, `--color-error-text` and `--color-primary-text`
([ADR 0151](ADR/0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)).
The frozen table, `KNOWN_FAILURES`, is empty and stays. A pair written into
`PAIRS` that measures under its threshold fails the build, and reaches
`KNOWN_FAILURES` only if someone moves it there by hand, as a row with its
reason and its measured floors. A pair axe's `color-contrast` rule finds on a
route the walkthrough renders fails the smoke walkthrough instead, and is
frozen, if at all, in `axe.ts`'s `KNOWN_VIOLATIONS`, by rule id per route with
its reason — never in `KNOWN_FAILURES`. `--color-income` and `--color-expense`
are named as fills in `NOT_PAINTED`: nothing paints either as text.

Dark `--text-muted` is not a Tailwind gray. Gray-400 measured 4.28:1 on
`--surface-hover`, where muted copy sits on the review card's resting chips
and under every hover, so the token is gray-400 lifted towards white along
its own hue to `#a3a9b5`, 4.60:1 there
([ADR 0164](ADR/0164-colours-come-from-theme-tokens-and-a-gate-keeps-them-there.md)).

**A category's colour is not a token.** The category chip paints a
category's icon, and as a pill its label, in the category's own colour on a
tint of it, and that colour is data — picked from the category dialog's
palette, or carried in a backup — so no row in `PAIRS` can score it. Painted
on a translucent tint of itself, a light category measures 1.95:1 in light —
the orange tile, `#ff9800` on `#fff2df` — and a dark one, even lightened 30%,
measures 3.95:1 in dark — `#9C27B0` as `#ba68c8` on `#3e2043`; every default
colour fails in one theme or the other. So the tint is composited over
`--surface-card` and painted opaque, the foreground sits on one known colour
whatever surface holds the chip, and `ensureContrast`
(`core/utils/color-contrast.utils.ts`) mixes the colour towards black in
light and towards white in dark, keeping its hue, until it reads 4.5:1
there. The gate is `category-chip.component.spec.ts`: it measures the
painted tile and pill for every default category's colour and four hostile
ones, in both themes, and holds the composited surface to the stylesheet's
`--surface-card`
([ADR 0151](ADR/0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)).

A category's colour reaches a template in one of three ways, and
`colors:check` fails any other
([ADR 0169](ADR/0169-a-categorys-colour-is-drawn-through-the-chip-or-a-pipe-that-knows-its-surface-and-the-axe-pass-sweeps-both-themes-below-the-fold.md)):

- **The chip**, `<app-category-chip>`, wherever a tile or a pill fits. Its
  tile is opaque, so the surface under it does not matter.
- **A glyph through `categoryGlyph`**, named for the surface it sits on:
  `cat.color | categoryGlyph:'panel'`. Anywhere else, a glyph in the
  category's colour sits on whatever is beneath it, and that is rarely one
  colour: a select option is painted at rest, hovered, active and selected.
  `CATEGORY_SURFACES`, beside `ensureContrast` in
  `core/utils/color-contrast.utils.ts`, lists every tone each surface takes
  in each theme. `categoryGlyphColor` moves the colour against the hardest
  of them, the darkest in light and the lightest in dark, the same way the
  chip moves its own glyph, so the glyph clears 4.5:1 on every tone. The
  pipe reads `ThemeService.effectiveTheme()`, so a theme switch repaints
  it. The surfaces are:

  | Key | What the glyph sits on |
  |---|---|
  | `dialog` | a dialog's surface, under a closed select |
  | `panel` | a select panel's option at rest, hovered, active and selected |
  | `menu` | the same four, and a menu's current item on `--surface-menu-current` |
  | `subtle` | `--surface-subtle`, under each budget in the dashboard's Budget Progress widget |
  | `reviewCard` | the import review card checked, unchecked, hovered and flagged as a duplicate, each at rest and under the category button's hover and keyboard-focus layers |
  | `suggestionChip` | the transaction form's suggested category, `--surface-suggestion` and its hover |
  | `iconGrid` | the category dialog's chosen icon, on `--surface-icon-selected` |

- **A fill of the colour itself**, which keeps it: the spending legend's
  tile matches its chart segment, and the category dialog's swatch is the
  colour on offer. Its glyph goes through `readableOn`, black or white,
  whichever contrasts more. One of the two always reaches at least √21,
  about 4.58:1, so the pipe needs no theme. A fill sits inside a
  `colors:allow-start(category-data)` block with its reason. The bars of
  the spending legend and of the reports' category breakdown and spending
  analysis are fills too: graphics beside a printed amount or percentage,
  held to no contrast.

**Adding a site.** Use the chip where a tile fits. Otherwise pipe the
colour through `categoryGlyph` with the key of the surface the glyph sits
on. A surface the table lacks gets a key, its tones in both themes, and a
case in `category-glyph.pipe.spec.ts` that holds those tones to what paints
them. The gate checks that the key exists, not that it names the right
surface, so the site's own spec measures the painted glyph in each state
the site paints and in both themes. A missing category's colour is
`CATEGORY_FALLBACK_COLOR`, `#9E9E9E`, and the category dialog offers
`CATEGORY_PALETTE`; both live in `category.model.ts`.

**The gate is the specs.** `category-glyph.pipe.spec.ts` measures the 31
colours a category can carry (the seeded colours, `CATEGORY_PALETTE` and
the fallback) and fourteen hostile ones on every tone of every surface, and
holds each surface's tones to the stylesheet: Material's own expressions
for the dialog, the select panel and the menu, the named `--surface-*`
tokens, and a rendered stroked button's state layers.
`readable-on.pipe.spec.ts` paints the glyph on every one of the 31 fills.
Each site renders its real template and measures its glyph in both
themes, a select's options through `eachOptionState`
([testing.md](testing.md#colour-as-painted)).

### Colours come from tokens

**Check:**

```bash
npm run colors:check
```

Every colour the app paints is a token declared in `src/styles.scss`, which
the dark theme and the two high-contrast blocks redeclare. A colour written
anywhere else — a hex in a component stylesheet, `text-gray-400` in an
`@apply` or a template, a colour string in a chart dataset — paints the same
in all four rendered modes, so neither dark mode nor high contrast reaches
it, and `contrast:check`, which scores token pairs, never sees it. When
`scripts/check-colors.mjs` landed it counted 612 such colours in 53 files,
many of them under AA in one theme or the other. None is left, apart from
the literals marked below with their reasons
([ADR 0164](ADR/0164-colours-come-from-theme-tokens-and-a-gate-keeps-them-there.md)).

| Where the colour is painted | How it names the colour |
|---|---|
| A component stylesheet | `var(--token)`, or a `color-mix()` of tokens for a tint (below) |
| A template, or a class string in TypeScript | a theme alias from `tailwind.config.js` |
| A Material component | the component's own `--mat-*` token, set to a `var()` (below) |
| A Chart.js canvas | `ChartThemeService.palette()`, re-read when the theme or high contrast changes |
| A category's colour | the category chip, or the `categoryGlyph` and `readableOn` pipes |

**The aliases name roles, not shades**, and each is a `var()`, so it follows
the theme and high contrast, which no `gray-*` or `indigo-*` utility did:

| Aliases | Tokens |
|---|---|
| `fg`, `fg-secondary`, `fg-muted`, `fg-disabled`, `fg-inverse` | `--text-primary`, `-secondary`, `-muted`, `-disabled`, `-inverse` |
| `surface-background`, `surface-card`, `surface-elevated`, `surface-hover`, `surface-hover-active`, `surface-active`, `surface-subtle`, `surface-muted`, `surface-strong`, `surface-sunken` | the `--surface-*` token of the same name |
| `line`, `line-subtle`, `line-strong` | `--border-primary`, `--border-secondary`, `--border-strong` |
| `brand`, `brand-soft`, `brand-text` | `--color-primary`, `--color-primary-light`, `--color-primary-text` |
| `accent`, `accent-light` | `--color-accent`, `--color-accent-light` |
| `error-text`, `warning-text`, `success-text`, `ai` | `--color-error-text`, `--color-warning-text`, `--color-success-text`, `--color-ai` |
| `income`, `expense`, `success`, `error`, `warning`, `info`, each with `-soft`; `income-text`, `expense-text` | the `--color-*` fill, its `-light` tint, its `-text` foreground |

Nineteen of these utilities, `text-fg-disabled` and `bg-surface-card`
among them, are named by no template yet, only by `theme-aliases.spec.ts`,
which Tailwind no longer reads; they stay in the stylesheet through the
`safelist` in `tailwind.config.js`, as the theme's colour API
([ADR 0195](ADR/0195-a-gate-holds-the-test-main-to-the-builders-init-specs-stay-out-of-the-stylesheet-a-lone-date-run-is-silent-and-the-opacity-gate-reads-a-url-in-a-comment-as-a-comment.md)).

A gray picks a role by what it was for. Text in gray-900 or 800 is `fg`,
gray-700 or 600 is `fg-secondary`, and gray-500 or 400 is `fg-muted`.
`fg-disabled` is for a disabled control only: it is gray-400 in light, which
measures 2.29:1 as running text on the Material card. A mark that says
something, however quiet it looks (a row's receipt or split mark, a summary
icon), is information and reads in `fg-muted`, so nothing paints
`fg-disabled` today. A gray-100 or 200 border is `line`, and a gray-300 one
is `line-strong`.

**No `/alpha` on an alias.** A `var()` cannot be split into channels, so
Tailwind generates nothing for `bg-brand/12`, and says nothing. The gate
flags it. A translucent colour is a `color-mix()` in the component's
stylesheet.

**A tint mixes with what it replaces.** A tint that carries text is
`color-mix(in srgb, var(--color-X) N%, <the background it replaces>)`:
`--surface-card`, `--surface-background`, or a dialog's `--mat-sys-surface`.
It is opaque, so the text on it is a pair of two known colours rather than
of whatever lies underneath. A border or a glow mixes with `transparent`.
The six tints that a category glyph or a review card sits on are named
surfaces in `styles.scss`, mixed the same way: `--surface-suggestion` and
`--surface-suggestion-hover`, `--surface-icon-selected`,
`--surface-review-selected`, `--surface-review-duplicate` and
`--surface-menu-current`.

**A fill token is not a foreground.** Text reads in `-text`. A glyph may
read in the fill only where a 3:1 row in `contrast:check` holds it (above).
A label on solid red sits on `--color-error-strong`, since white on
`--color-error` is 3.76:1.

**A glyph at rest is not faded under its bar.** An icon button rests in a
token that clears 4.5:1 on its surface, at full strength, rather than in a
stronger colour faded with `opacity`. The upload area's move arrows, drag
handle and remove button rest in `--text-muted`, 7.56:1 on the light card and
7.07:1 on the dark one, where faded they measured 3.18:1, and the handle 2.34
and 2.81:1, under even a graphic's 3:1. Hover takes a colour of its own:
`--text-primary` for the arrows and the handle, and `--color-error` for
remove, held by its 3:1 row above, since axe never hovers. A disabled arrow
keeps Material's disabled colour, faded further, which WCAG 1.4.3 and axe
both exempt, and the fade is what tells it from an arrow that moves. The
review card's category chip rests its caret in the chip's label colour, 5.94:1
in light and 8.34:1 in dark, where at 70% it read 3.2:1. The bar is text's
4.5:1 rather than a graphic's 3:1 because Karma serves no icon font: axe reads
each ligature as 16 to 18px text and holds it to 4.5:1, and the transaction
form's and the confirm dialog's specs already held their glyphs there
([ADR 0186](ADR/0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)).
For the same reason the upload area's refusal banner paints its glyph in
the message's own `--color-error-text`, as the review notices' glyphs take
`--color-warning-text`: 5.24:1 in light and 11.41:1 in dark on the banner's
10% error tint, where `--color-error` read 3.04:1 in light. It is
`contrast:check`'s `--color-error-text` row on `--surface-card` that names
it, beside the message, and no longer the 3:1 row above
([ADR 0187](ADR/0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)).

**Material is coloured through its tokens.** A host `color` or a utility on
a Material element mostly paints nothing. Material colours a menu item's
label and icon, a chip's label, a button's label and edge and a progress
bar's indicator from its own `--mat-*` tokens, in rules that outrank a
component's class or tie with it and win on stylesheet order. Set the token:

| To colour | Set |
|---|---|
| A destructive menu item | the global `.menu-item-destructive` class, which sets `--mat-menu-item-label-text-color` and `--mat-menu-item-icon-color` to `--color-error-text` |
| A chip | `--mat-chip-label-text-color` and `--mat-chip-elevated-container-color` |
| An outlined button's edge | `--mat-button-outlined-outline-color` |
| A text button's label | `--mat-button-text-label-text-color` |
| A progress bar's indicator | `--mat-progress-bar-active-indicator-color`; under `mat.theme()` a `[color]` input stamps a class that paints nothing |

A colour rule nested under a component's own class never reaches a menu
item at all, because the menu renders in the overlay.

**A literal that has to stay is marked where it stands**, with
`colors:allow(<kind>) <reason>` on its line, or
`colors:allow-start(<kind>) <reason>` … `colors:allow-end` around a block.
In a template, a marker alone on the line before a tag covers that tag up to
its `>`. An inline template is a string to the script, so it is marked by a
`//` block around its property. A marker counts only inside a comment.

| Kind | For |
|---|---|
| `brand` | the login gradients and glass, the Google logo, the AI provider avatars and the settings link tiles |
| `scrim` | a veil over a photo, which is the same in every theme |
| `category-data` | a category's colour, as the default palette or as a fill: a bar, a swatch, a legend tile |
| `token-mirror` | a TypeScript constant that a spec holds to the stylesheet (`CHIP_SURFACE`, `CATEGORY_SURFACES`) |
| `token-fallback` | the chart palette's values for a canvas drawn before the stylesheet loads |
| `browser-chrome` | the `theme-color` meta, which the browser reads as a literal |

The script's `ALLOWED` table records, per file and kind, how many hits the
markers exempt, and why. The count fails when it is stale in either
direction, and so does a marker that exempts nothing, so a block cannot
quietly widen. Adding, removing or moving a marker edits that row in the
same commit.

**What the gate fails**, over `src/app/**/*.{scss,html,ts}` (specs and
`testing/` helpers aside) and `src/styles.scss` (a theme token's own
declaration aside). A component's inline `styles:` is read as the
stylesheet it is, so every rule below applies to it:

- a Tailwind palette utility, in an `@apply`, a stylesheet value, a
  template's class bindings or any TypeScript string, and an alias given an
  `/alpha`;
- a hex, `rgb()`/`hsl()` or named colour in a stylesheet value, or quoted in
  TypeScript or in a template attribute or binding, `bg-[#…]` included; a
  hex or functional colour anywhere in an `@apply`; and a named colour
  inside an arbitrary value, `text-[red]`, in an `@apply` or a class list. A
  system colour such as `CanvasText` passes inside a `forced-colors` block;
- `var(--declared, <colour>)`, a fallback that can never paint, and
  `var(--undeclared, <colour>)`, which always does; and a `color-mix()`
  with an operand that is not a declared `var()`, `transparent` or
  `currentColor`;
- a colour bound in a template (`[style.color]`, `[style.background]`,
  `[style.background-image]`, `[style.filter]`, `[style]`, `[attr.fill]`,
  …), in any spelling Angular compiles to the same binding:
  `bind-style.color="c"`, an interpolated `style.color="{{ c }}"` or
  `attr.fill="{{ c }}"`, and an interpolated `style="color: {{ c }}"`. It
  passes only as the category chip's own, as a string-literal
  `'var(--token)'`, when `categoryGlyph` or `readableOn` corrects it last
  with nothing joined on before the pipe (a string or a number after a `+`,
  or a template literal that interpolates), or when it is marked.

It counts per file and per matched token, so swapping one colour for
another is a new token and a stale one, and both fail. Its `BASELINE` is
empty and stays so: the answer to a new colour is a token, or a marker with
its reason. What it cannot see is listed in the script's header. The largest
items are a colour assembled at runtime or read from data, a colour set from
code (a host binding, `Renderer2`, a custom property bound as
`[style.--name]`), and whether a token is the right one:
`var(--text-muted)` on a tint passes here and may still fail AA.

**How a colour is tested.** A spec that holds a colour renders the real
template and measures what is painted, in both themes, through
`core/services/testing/painted-contrast.ts`. `paintedColor` and
`paintedBackground` composite translucent fills and faded ancestors, and
`ratio` scores the pair. `tokenValue` reads what a token computes to under
the palette on `<html>`, and `expectPainted(node, token, label)` holds a
node to being painted in that token at 4.5:1 or a floor it names, reading
the node's colour once its motion has settled;
`inPalette` runs a check under each of `PALETTES`, the four rendered modes.
These are the only copies: the 37 spec files that kept an `expectPainted`,
`tokenValue` or `tokenColour` of their own read through the shared ones
([ADR 0194](ADR/0194-one-painted-contrast-helper-and-one-focus-hand-off-a-card-is-scored-part-by-part-and-no-page-skips-a-heading-level.md)).
`withTheme` stamps one theme class for a token
probe; anything that reads `ThemeService.effectiveTheme()` is driven
through the service instead, with `withScheme` from `axe.ts`. `hoverValue`
reads a `:hover` rule from the CSSOM, because Karma cannot hover. Read the
element Material paints, not the host: a chip's label is
`.mdc-evolution-chip__text-label`, and a progress bar's indicator is the top
border of `.mdc-linear-progress__bar-inner`. `theme-aliases.spec.ts` holds
every alias to its token in all four modes. [testing.md](testing.md#colour-as-painted)
has the helpers in full, and how a spec puts a select's options or a menu's
items into each state it measures.

### Resting text is a token, and a resting fade fails

**Check:**

```bash
npm run opacity:check
```

Secondary text reads in `--text-muted` at full strength, never in the
colour around it faded with `opacity`. A fade is measured by nothing:
`contrast:check` scores tokens, not what an `opacity` makes of them. Nor can
high contrast reach one: it strengthens the muted token, `#374151` in light
and `#e5e7eb` in dark, and a faded line was never in it. Eleven lines rested
that way, at 0.7, 0.75 or 0.8, and each is now
`color: var(--text-muted)` with no opacity
([ADR 0187](ADR/0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)):

| Component | Lines |
|---|---|
| The goal card (`goal-progress-card.component.scss`) | `.goal-date`, whose 14px `event` glyph takes its colour, `.target`, `.linked-breakdown`, `.status`, `.items-count`, `.item-amount` and `.goal-note` |
| The forecast (`forecast.component.scss`) | `.forecast-note`, `.forecast-bucket-note` and `.rate-caption` |
| The Goals tab (`goals.component.scss`) | `.goals-hint` |

`.status.reached-note` reads in the card's own colour (`color: inherit`):
reaching the goal is the card's news. In light, dark and each under high
contrast, the muted lines paint 6.82, 7.27, 9.30 and 13.86 to 1 on the
card's surface and the Goals hint 6.93, 7.94, 9.45 and 15.13 on the page.
Each component's real-template describe holds every line, over `PALETTES`,
to a computed opacity of `'1'`, the colour `tokenValue('--text-muted')` and
4.5:1 as painted (`expectPainted`); the goal card's glyph is held to 4.5:1
too, since axe reads a ligature as text.

`scripts/check-opacity.mjs` keeps a fade off resting text, by
[ADR 0145](ADR/0145-a-class-found-by-reading-becomes-a-gate.md)'s rule: a
resting fade is readable from one file. It runs in CI's *Check resting
opacity* step.

- **What fails.** A stylesheet `opacity` between 0 and 1, as a number or a
  percentage (`0.7`, `.7`, `70%`, with or without `!important`), and a
  Tailwind `opacity-NN` below 100, an arbitrary `opacity-[…]` or the
  arbitrary property `[opacity:…]`, in an `.html` template, an inline
  `template:` or a stylesheet's `@apply`. `opacity: 0` and `opacity: 1`
  pass: hidden and full strength are how a reveal starts and ends. `:hover`
  and `@media` exempt nothing, and `hover:opacity-80` fails as `:hover`
  does.
- **Only a state that ends is exempt.** A declaration in a `@keyframes`
  frame no fill mode holds, prefixed or not, where a pulse is motion and the
  reduced-motion switches end it; under `:disabled` or `[disabled]`, where a
  control owes no contrast (WCAG 1.4.3) and the fade tells it from a live
  one; and in CDK's four moving drag states, `.cdk-drag-preview`,
  `.cdk-drag-placeholder`, `.cdk-drag-animating` and `.cdk-drag-dragging`.
  `.cdk-drag-handle`, `.cdk-drag-disabled` and a bare `.cdk-drag` sit on an
  item at rest and exempt nothing. A state named inside `:not(…)` or
  `:has(…)` is not the subject's own, so `&:hover:not(:disabled)` fails. A
  utility, `[opacity:…]` among them, is exempt only under a `disabled:` or
  `group-disabled:` variant.
- **A frame an animation holds does not end.** The `to` frame, or `from` in
  reverse (`reverse` or `alternate-reverse`), of an animation a rule runs
  with a `forwards` or `both` fill fails like a resting fade: the element
  rests on it, and the reduced-motion switches cut the run to 0.01ms and
  leave the fill mode, so the frame holds from the first paint. A rule's
  `animation-fill-mode` and `animation-direction` longhands join each
  animation the rule names, so a shorthand's fill beside a direction
  longhand, and a shorthand's direction beside a fill longhand, both count.
  A quoted name counts, as do the `-webkit-` forms and the keywords in any
  case. A `from` frame that `both` holds only through a delay passes.
- **A state sits on the faded element or on one around it.** A compound
  joined to the next by `+` or `~` is a sibling, so `.a:disabled + .hint`
  and `.a:disabled ~ .hint` fail, as `.row:has(:disabled) .hint` and
  `peer-disabled:opacity-60` do, while `button:disabled .label` and
  `button:disabled > .icon` pass. A label beside its control
  (`input:disabled + label`) fails like a hint, since the gate cannot tell
  the two apart; it takes `--text-disabled`, not a fade or an `ALLOWED` row.
- **How it reads a stylesheet.** Each declaration is read with every
  selector above it, nested blocks included, since an exempt state almost
  always sits a level above its `opacity` line. The levels resolve as Sass
  resolves them, `&` standing for the level above and a selector with no
  `&` sitting under it, so `.a:disabled { & + .hint {…} }` fades the hint. A
  declaration is exempt only when every selector its levels resolve to is in
  a state that ends, and the arms of an `:is(…)` or `:where(…)` count as a
  list: `.a:disabled, .b` still fades `.b`, and `.a:is(:disabled, :hover)`
  still fades `.a:hover`. One lexer blanks comments and steps past an
  unquoted `url(…)` alike, blanking its address in code alone, so the `//`
  of `url(http://…)` opens no comment, and a `url(` inside a comment stays
  comment: `/* url(x */ .a { opacity: .5; } /* ) */` reads the fade between
  the two comments
  ([ADR 0195](ADR/0195-a-gate-holds-the-test-main-to-the-builders-init-specs-stay-out-of-the-stylesheet-a-lone-date-run-is-silent-and-the-opacity-gate-reads-a-url-in-a-comment-as-a-comment.md)).
- **What it reads.** Every `.scss`, `.css` and `.html` under `src`, and
  every `template:` and `styles:` string, quoted or in backticks, in a
  non-spec file that declares a `@Component`, a second component's
  included; a `template:` in a comment is not read. A `${…}` is blanked in a
  `styles:` string only: a `template:` string keeps its substitutions, and
  a class picked inside one is read.
- **`ALLOWED` and its ratchet.** One row: the sign-in card's tagline at
  `opacity-80` over the translucent glass card, a colour chosen for the fade
  that `login.component.spec.ts` measures through it at every stop of the
  gradient behind the card, in both themes. A row's count must match its
  file's exactly, so a new fade fails, and so does a repair left off the
  table.
- **What it cannot see**: a `[style.opacity]` or `[ngStyle]` binding, a
  static `style="opacity: …"` attribute, and an opacity set from TypeScript;
  `filter: opacity()` and alpha inside a colour; an opacity that is not a
  literal (`var(--x)`, a Sass variable, a `calc()`), in a declaration,
  `opacity-[…]` or `[opacity:…]` alike; the SVG paint opacities; whether
  the faded element holds any text; a keyframe declared in another file,
  that is, a global `@keyframes` (in `src/styles.scss`, or in a component
  with `ViewEncapsulation.None`) run from another stylesheet, or one a Sass
  partial or mixin brings in, since Angular scopes a component's keyframes
  to it under the default emulated encapsulation, which every component
  here keeps, and `src/styles.scss` and the partials declare none; a fill
  mode or a direction set in a rule that does not itself name the
  animation; the order and comma position of a rule's animation
  declarations, so a later `animation-direction: normal`, a shorthand
  written after a direction longhand, or a `normal, reverse` list beside two
  animations moves the held frame unseen; a paused animation, which rests on
  its first frame; an `alternate` or `alternate-reverse` run held after an
  even number of iterations; a `template:` that is not a string literal (a
  constant, or the strings of a concatenation after its first); and a spec's
  host template.

The run reads *Checked 105 stylesheets and 104 templates, inline ones
included, for resting fades (1 recorded)*; its self-test has 153 cases. Of
the 24 fractional `opacity` declarations the stylesheets held before the
change, the 13 left were all exempt: four keyframe frames, three disabled
controls and six drag states. Two of those drag states, the upload area's
lifted row at 0.95 and its slot at 0.3, went when the slot became an empty
outline
([ADR 0193](ADR/0193-a-row-that-is-no-photo-is-no-drag-item-the-receipt-or-statement-chips-are-measured-and-the-upload-area-shows-where-a-photo-will-land.md)),
so 11 are left, four of them drag states.

## What is tested

- `sidebar.component.spec.ts` and `bottom-nav.component.spec.ts` register real
  routes and navigate for real — `routerLinkActive` tracks router events, so
  nothing short of a navigation exercises it. They assert the mark lands on the
  current link, moves on the next navigation, skips a route no link owns, never
  lands on the centre Add button, and that the accessible name stays the bare
  label.
- `app.smoke.spec.ts` asserts the same invariant inside `expectPage`, so every
  route it visits checks it against the **real route configuration**. It is
  gated on a link for the route being on screen: the surfaces rendered there do
  not carry all nine destinations — `/settings`, `/data`, `/household` and
  `/about` have no link there. The gate tests for the anchor, not the
  attribute, so a regression that drops `aria-current` still fails every route
  that has a link.
- `sidebar.component.spec.ts` ("names its landmark, apart from the bottom
  nav") and `bottom-nav.component.spec.ts` ("names its landmark, apart from
  the sidebar") pin each surface's name. `app.smoke.spec.ts` checks the pair
  in the real shell with `expectLandmarksNamed`, on its first `/dashboard`
  visit. Karma's frame is below the desktop breakpoint, so the sidebar is in
  the overlay drawer: the helper opens it through the header's menu button,
  asserts exactly two `nav` elements in the shell, each named and no two the
  same, and closes it again, so no later axe pass audits a page behind the
  drawer's backdrop. The walkthrough serves no i18n, so "no two the same"
  compares keys; the catalogs are `i18n:check`'s.
- `user.model.spec.ts` pins the three resolvers against absent, null,
  off-list and wrongly-typed input.
- `accessibility.service.spec.ts` drives the service against a faked document,
  asserting the variable is removed rather than set at the default scale, that
  each class lands and lifts, and that the resolved reduced-motion value is the
  OR of the preference and the media query.
- `chart-theme.service.spec.ts` asserts the chart animation follows that signal
  rather than the media query.
- `accessibility-settings.component.spec.ts` pins that only the touched
  preference key is written, and that the reduced-motion toggle shows the
  stored value rather than the resolved one.
- `firestore-rules.smoke.spec.ts` pins that the dotted update of all three
  fields is accepted — no rules change was needed, and that is asserted rather
  than assumed.
- `tab-strip-scroll.directive.spec.ts` pins the tab strips' keyboard
  behaviour: the arrow keys walk focus along the strip and each tab they reach
  is scrolled into view, rather than sitting behind a chevron a keyboard user
  has no way to press. Material's header resets the strip's scroll after every
  focus change, so this is the assertion that would fail first if the
  correction were dropped. Both opted-in pages have their own case for a
  `?tab=` deep link opening on its tab in view. Once the strip has opened,
  the directive spec's cases under *when the labels change after the strip
  opens* keep the tab the strip last revealed whole when a label before it
  widens or the strip narrows, keep the tab the keys walked to rather than
  the selected one, and leave a strip the reader scrolled where they left
  it;
  `budgets.overflow.spec.ts` keeps Goals in view at 343px when the Budgets
  count arrives after the strip opened.
- The 40px tap-target floor is measured where the glyph is smaller than the
  target: `transaction-list.component.spec.ts` reads the note button, the
  receipt icon and the row actions trigger — each a 32px (or unsized) glyph box
  with a 40px hit box through the `::after` overhang — and
  `budget-progress-card.component.spec.ts` reads the card's menu trigger, which
  meets the floor by its own box. See
  [ui-overflow.md](ui-overflow.md) for the idiom. The sharing controls are
  held to the same floor: the select mode's toggle and each row's checkbox
  (`transaction-list.component.spec.ts`), each *Shared with* chip in the form
  (`transaction-form.component.spec.ts`), the household overview's
  *Count toward…* button on one's own shared rows
  (`household-overview.component.spec.ts`) and the plans section's controls
  (`household-plans.component.spec.ts`). So is each search suggestion's
  remove in the filter panel (`transaction-filters.component.spec.ts`): a
  40px button whose touch target is held to its own box, so it neither
  scrolls the panel sideways nor reaches into the rows around it
  ([ui-overflow.md](ui-overflow.md#g4--nothing-is-clipped-that-cannot-be-reached-another-way)).
- `switch-on-choice.directive.spec.ts` pins the household switcher's keys.
  A closed `mat-select` takes an arrow key, Home, End, a page key or a typed
  character as a choice, and on the switcher every choice swaps the page for
  another household and moves focus into it, so arrowing through the closed
  switcher would swap household after household. On the closed switcher those
  keys open the list instead, as a native select does on macOS; an open list
  moves through its choices without picking. `household.component.spec.ts`
  pins where focus lands after a swap — the view that came in — and that it
  moves only when it was on the switcher or had dropped to the document.
- The import wizard's surfaces are swept with axe (WCAG 2.0 A and AA, axe's
  `wcag2a` and `wcag2aa` tags, `color-contrast` included) by their component
  specs, in both schemes. The wizard's sweeps of its steps stand on the
  page's fill (`standOnThePage`, [testing.md](testing.md#shared-stubs)),
  since text below Karma's 413px body box is otherwise left unscored; the
  stepper's tab list needs none, at the top of the wizard, and nor does the
  review card, whose root paints `--surface-card`.
  `import-wizard.component.spec.ts` sweeps:
  - the empty upload step, which finds nothing;
  - the upload step with two photos and a refused `run.exe` dropped on the
    real zone, so the rows, the previews, the receipt-or-statement question
    and the alert all stand;
  - the review step, landed with both notices, the duplicate warning and
    both hints on it (`landReviewStep()`), the review list let out to its
    full height;
  - and the stepper's tab list under the phone rule's declarations (*A name
    hidden for room is clipped, never removed*).

  A pass over a whole step keeps one pass node per rule, so the hidden file
  input alone can hold `color-contrast`. Each word-holder is therefore scored
  by its own nodes of one contrast run (`expectEachContrastScored`): the
  title, the hint, each
  file type with every element inside it hidden, its glyph among them,
  Browse's label (`.browse-btn .mdc-button__label`), each paragraph of each
  notice and hint, the header, the warning's title and Back. A case runs
  axe's best-practice `heading-order` alone over the wizard, empty and with
  photos picked, and finds the order kept (`expectHeadingsInOrder`).
  `transaction-preview-table.component.spec.ts` sweeps the review card with a
  card of every kind of row — plain, doubted, refund, duplicate, and blank as
  **Add a row** makes one — the list let out to its full height so no card
  falls outside the container (`withEveryCardShown`)
  ([ADR 0187](ADR/0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)),
  and, in each scheme, scores each part's words by its own nodes:
  `.description-text`, `.amount-text`, `.extra-text`, and the date chip's,
  currency chip's and duplicate badge's words, which stand in spans of
  their own (`.date-chip-text`, `.currency-chip-code`, `.duplicate-label`)
  since a bare text node cannot be a part. About's install card is scored
  the same way, its title, its body and its button's label or each of its
  steps
  ([ADR 0194](ADR/0194-one-painted-contrast-helper-and-one-focus-hand-off-a-card-is-scored-part-by-part-and-no-page-skips-a-heading-level.md)).
- Headings: the walkthrough runs `heading-order` once on every page it
  sweeps whole, and each site that moved a level holds its outline in its
  own spec's real-template block (*No page skips a heading level*).
- The focus indicator: `focus-indicator.spec.ts` reads its rules from the
  stylesheet and measures the rendered line of every button kind in the four
  palettes (*A focused button shows an indicator inside it*).
- Every per-item name, the alert slider's, the Auto sync switch's and
  Settings' four switches' names and Sign out's are pinned in
  en, ja and tc through the real catalogs (`catalogTranslator`), read by
  `accessibleName`, axe's own name computation, never off `textContent`,
  but for the review card's per-row names, which its spec reads through the
  echo stub and, in tc, through tc's catalog. A name that shows words is
  held to them by `holdsShownWords`. The review card's tooltips are
  read through the catalogs, in en and ja: under *a tooltip a reader
  reaches on the card*, each tooltip a reader reaches is its control's whole
  name, and `accessibleDescription` reads nothing after it. The keep-date
  and offer names are read in en, ja and tc under *a chip that asks is
  named first by the words it shows*.
- The dialogs: `dialog-header.component.spec.ts` opens a dialog drawn with
  the shared header under the app's options, titled as the note, the
  receipt viewer and the share dialog are, and reads each dialog's name as
  its title alone, in en, ja and tc; it also pins the header's row (a short
  title midway between the start and the close button on a 40px line, a
  long one wrapping with the close button kept in the row;
  [testing.md](testing.md#karma-serves-no-fonts)).
  `dialog.config.spec.ts` holds `provideAppDialogs()` to Material's defaults
  but its three changes, and a dialog opened under it to the `dialog` role,
  `aria-modal="false"` and its title's name, with focus inside before its
  entrance ends. It also opens a dialog from a menu's entry and finds focus
  on that menu's button once the dialog has gone, beside two pins: a dialog
  told where to return focus keeps it there, and one no menu opened leaves
  focus it dropped on the document for the page's own recovery.
  `transaction-list.component.spec.ts` (*focus after a dialog a row menu
  opened (real template)*) cancels the second row's Delete confirm from the
  desktop actions menu and the phone's trailing menu, both through the
  shared `pressMenuEntry`
  ([testing.md](testing.md#one-helper-per-job)), and from the swipe
  drawer's own Delete, and finds focus on that row's menu button.
  `app.config.spec.ts` holds
  the app to one set of dialog options, the ones `provideAppDialogs()` gives.
- Where focus goes once a press takes the pressed control off the page, or
  disables it, is read as `document.activeElement` after the render the
  press asks for, in the real template: `file-dropzone.component.spec.ts`
  under *focus after a photo moves* and *focus after a row is removed*, and
  `transaction-filters.component.spec.ts` under *focus after Clear all, a
  suggestion or the save-search box takes the pressed control away (real
  template)*, which also reads the box's selected name as it opens, a typed
  name saved in its place and the Enter that saves cancelled (*The filter
  panel hands focus on when its controls go*);
  `transaction-list.component.spec.ts` after a confirmed delete, Undo and a
  failed delete (*Focus stays in the list after a delete*); and
  `period-selector.component.spec.ts` after the period chip's clear. A held
  Enter is sent as its repeats (`pressKey`), and each repeat after a
  hand-off presses nothing where focus lands: under the filter panel's
  nested *an Enter held down through the hand-off* and *the save-search
  box, as it opens*, under both of the upload area's describes, on the
  review card, whose editor opens once for an Enter held down on its
  trigger and stays open, on the dashboard layout settings' *Move down* and
  on a household member's *Remove*. `focus-when-rendered.spec.ts` holds the
  shared helper itself: where focus lands, `onlyIfDropped`, the held key and
  a component destroyed before its render
  ([ADR 0194](ADR/0194-one-painted-contrast-helper-and-one-focus-hand-off-a-card-is-scored-part-by-part-and-no-page-skips-a-heading-level.md)).

## Known gaps

- **Only navigation has been audited.** Segmented controls and the period
  selector express selection visually and have not been, beyond a name for
  every single-choice group, which the tenth `icon-labels:check` rule holds;
  the tab strips are audited for reachability and keyboard travel only, not
  for how selection is announced.
- **The automated pass is a phone audit of nine routes.** `app.smoke.spec.ts`
  runs axe-core (WCAG 2.0 A and AA, axe's `wcag2a` and `wcag2aa` tags,
  `color-contrast` included) inside `expectPage`, so every page the
  walkthrough opens is swept, once in each scheme, forced through
  `ThemeService`: a pair that fails in only one theme fails on any host. Each
  such page also gets one `heading-order` run (*No page skips a heading
  level*). Nothing it has found is frozen any more. What it cannot see is
  stated in [emulator-blind-spots.md](emulator-blind-spots.md): i18n is not
  served, Karma's window is 756px, eight page-level rules are disabled
  because the run is scoped to the routed element, and `color-contrast`
  scores nothing below the fold of Karma's frame but the nodes the
  walkthrough scrolls into view (the next gap). `/login` is opened by the
  redirect case, which reads its
  lead line's colour against its token and runs no pass, so it is never
  audited; `/lock`, `/ai`, `/search-history` and `/import/history` are never
  opened. `/import/file` is opened with nothing picked; the import wizard's
  upload step with photos picked and a refusal standing, its review step, its
  step headers under the phone rule and the review card with every kind of
  row are swept by their component specs instead, in both schemes (*What is
  tested*). Nor does it open a
  dialog, a category select or a menu, so the pickers, the import review's
  category menu and the category dialog are held by their component specs
  alone. axe's `incomplete` results are not read, so a one-character text, or
  a label axe finds overlapped by another element, is scored by no pass.
  Everything outside that is still a hand-written spec, and nothing sweeps for
  the next instance of a class nobody has met.
- **The axe pass scores only what starts in Karma's frame, and fourteen
  nodes below it.** Every page renders inside the shell's fixed scroller,
  `.main-container`, and axe counts a node under a fixed ancestor as
  offscreen once its top passes the viewport's bottom. An offscreen node is
  skipped outright: it appears in no result, not even `incomplete`. A node
  in plain flow is scored at any depth only where a fill stands behind it,
  its own or one `standOnThePage` paints: below body's box, text with none
  is left `incomplete` (*Other sweeps may stand below Karma's body*, below).
  Karma's frame is 756px wide and 413px tall. `auditInView`
  (`core/services/testing/axe.ts`) scrolls a node into the band between the
  header and the frame's bottom before it audits, and the walkthrough uses
  it, in both schemes, on fourteen nodes: the spending chart's legend list
  and the Budget Progress widget on `/dashboard`, the filter grid on
  `/transactions`, the overview on `/budgets`, the Forecast tab's header and
  summary on `/reports`, the rules grid on the Recurring tab, with an active
  rule and a paused one, Upcoming Bills, the goal card's header, progress,
  items, note and actions on the Goals tab
  ([ADR 0192](ADR/0192-a-control-repeated-per-item-names-its-item-in-its-own-text-too-a-button-is-named-in-every-branch-and-an-unlabelled-switch-fails-the-axe-pass.md)),
  and the upload area's contents on `/import/file`. Everything else that starts below the frame is never
  scored. In the run that measured it, that was: on `/dashboard`, Recent
  Transactions (its top at 521px), the chart's card around its legend list
  and AI Insights; on `/settings`, all but the top of the profile section
  and every section after it; on `/data`, everything past the first 413px of
  a page 2687px tall; on `/household`'s member view, the second row of
  figures, the member chips, the shared rows, the plans and the members; and
  on `/about`, every card after the first. A node taller than about 285px
  cannot be centred inside the band, so a tall card is audited as its parts
  ([ADR 0169](ADR/0169-a-categorys-colour-is-drawn-through-the-chip-or-a-pipe-that-knows-its-surface-and-the-axe-pass-sweeps-both-themes-below-the-fold.md)).
- **Contrast is measured for the pairs somebody listed.** `npm run
  contrast:check` scores a hand-written table of the pairs the app actually
  paints, in all four rendered modes, and every failure it has found is fixed.
  A colour that is not a token can no longer reach the screen unseen:
  `npm run colors:check` fails a hex, a named colour, a palette utility, a
  `var()` fallback or a bound colour outside a reasoned marker (see
  *Colours come from tokens*). What neither script sees is a token on the
  wrong surface. `colors:check` passes any token, and `contrast:check` scores
  only the pairs its table names. It cannot read a pair at all when the
  surface is Material's (the card, a dialog, a menu, a progress track, all
  `light-dark()` pairs that `mat.theme()` emits) or one of the
  `color-mix()` surfaces. Those pairs are held only by the rendered spec of
  the component that paints them, and their ratios are written into the
  table rows' reasons. The sweep that found ten fill tokens painted as
  foregrounds under their bar, after every gate had passed, was a reading,
  and nothing repeats it. A category's own colour is data; the chip's spec
  and the pipes' specs hold it. A token faded with `opacity`, which neither
  script scores, fails `opacity:check` at rest (*Resting text is a token, and
  a resting fade fails*). The axe pass is the other half: it measures
  what a rendered page paints.
- **Nothing sweeps for the next animation CSS cannot reach.** Chart.js and the
  Material tab strips were found by reading the code; a new WAAPI duration or
  canvas animation will honour neither kill-switch and no gate will say so.
- **The same refusal twice is announced once.** A second refusal of a
  different file changes the banner's text, and the alert says it. Refusing
  the identical file again leaves the text as it was, so there is nothing new
  for the alert to say, though the banner stays on screen and is brought into
  view again.
- **The sixth rule's remaining blind spots.** A selector or key that two
  switches on the same item each reach in one case is counted as rendered
  once, and a label wrapped whole in parentheses, or a branch in doubled
  parentheses, is not read (*Accessible names come from the catalog*). Its
  text pass exempts a control with a bound `aria-describedby`, so the
  household's six buttons stay named by what they do, alike on every copy,
  and described by their item, which a screen reader reads after the name,
  after a pause or not at all; a name that holds the item and the words each
  shows, with the exemption dropped, would close it
  ([ADR 0192](ADR/0192-a-control-repeated-per-item-names-its-item-in-its-own-text-too-a-button-is-named-in-every-branch-and-an-unlabelled-switch-fails-the-axe-pass.md)).
- **No rule reads siblings named by their own text.** The ninth rule reads
  controls named by a bare key in their `aria-label`; two controls that can
  show together and are named by the words they show, as the AI page's two
  *Forget all* were, pass it. It reads one template, too, so the shared
  dialog header's *Close* beside a dismiss in the form it heads is not
  read, nor any pair across two templates shown on one page
  ([ADR 0196](ADR/0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)).
- **A photo can still overlap the CSV until the drop.** The CSV's row is no
  drag item and never moves, but CDK slides each photo a drag passes by one
  offset worked from the photos' own rows. When two photos differ in height,
  as when a long name wraps, or when the pointer jumps past several rows in
  one move, a photo can be drawn over the still CSV until the drop
  ([ADR 0193](ADR/0193-a-row-that-is-no-photo-is-no-drag-item-the-receipt-or-statement-chips-are-measured-and-the-upload-area-shows-where-a-photo-will-land.md)).
- **axe leaves the receipt-or-statement chips unscored.** It reports both
  labels `incomplete` for overlapping backgrounds, overlapped by the focus
  indicator span Material puts inside each label; with that span hidden, it
  scores both. A painted case reads them instead (*A photo on the upload
  area is named by its number among the photos*), at rest only: a focused
  chip paints a state layer over its fill, a sibling of the label that the
  walk in `painted-contrast.ts` does not see. Worked by hand, it brings the
  picked label from 7.22:1 to about 6.0:1 in light and 5.4:1 in dark,
  still AA, and no case pins it
  ([ADR 0193](ADR/0193-a-row-that-is-no-photo-is-no-drag-item-the-receipt-or-statement-chips-are-measured-and-the-upload-area-shows-where-a-photo-will-land.md)).
- **Some headings are held by nothing that runs.** axe judges a root's first
  heading against the last heading before it anywhere in the document, the
  document's first heading passes at any level, and `page-has-heading-one`
  stays disabled because Karma owns the document, so a page whose first
  heading were an `h2` with no `h1` would pass. On `/reports` the
  walkthrough orders the first tab alone: it audits the Forecast tab only in
  view and never opens the categories, monthly and insights tabs, so their
  unit outline cases hold them. Headings the AI provider writes into the AI
  summary's text and the insight narrative are not held, and the Settings
  outline wants one decision: the security activity's label is a span, like
  every Settings section's, while its empty state is an `h2`. Some card
  titles are no heading at all, so a reader who moves by headings does not
  find them, though nothing skips: the AI page's nine cards, the import
  history's records, the insight cards and narrative, and the spending
  analysis's and monthly comparison's two cards each keep a bare
  `mat-card-title`
  ([ADR 0194](ADR/0194-one-painted-contrast-helper-and-one-focus-hand-off-a-card-is-scored-part-by-part-and-no-page-skips-a-heading-level.md)).
- **The sign-in title's utilities do nothing in the app.** The `h1` keeps
  the classes the card title had, `text-2xl font-bold text-center mt-4`, and
  in the built app the card's own rule, which loads after the utilities,
  wins: it draws 22px, weight 400, a 28px line and no margin, and only
  `text-center` acts. Karma loads the sheets the other way round, where the
  utilities win, 24px, weight 700, a 32px line and a 16px top margin; the
  spec pins both orders. The title was left with the look the app drew
  before it was a heading, and any other `mat-card-title` whose typography
  utilities lose to the card's sheet in the app has not been looked for
  ([ADR 0194](ADR/0194-one-painted-contrast-helper-and-one-focus-hand-off-a-card-is-scored-part-by-part-and-no-page-skips-a-heading-level.md)).
- **Other sweeps may stand below Karma's body.** The wizard's three sweeps
  of its steps (empty, photos picked, the review step), its *colours, as
  painted* cases, the Goals hint's case and the household plans' sweep call
  `standOnThePage`; the command palette's case paints the palette on its
  dialog's surface, and `auditPlanDialog` runs its pass at every
  half-screenful of the plan dialog's scroller. Every `runAxe` caller that
  did not stand on the page was read once for its lowest text, and those
  three, whose contrast pass left text unscored, were moved
  ([ADR 0194](ADR/0194-one-painted-contrast-helper-and-one-focus-hand-off-a-card-is-scored-part-by-part-and-no-page-skips-a-heading-level.md)).
  A sweep added since, of a fixture taller than 413px with no fill of its
  own, may leave its lower text unscored and read clean, and the
  walkthrough's pass over the household switcher's open panel scores none
  of its options: axe leaves every one undecided (`bgOverlap`). A dialog
  open over a scrolled Karma page has the CDK pin `<html>` above the
  viewport, and axe then throws inside `color-contrast` and skips the rule
  for every node of the dialog. `auditPlanDialog` runs from the page's top
  and refuses a stop where axe skipped a rule on an error; the shared pass
  every other audit runs refuses no such skip, so a rule skipped that way
  reads clean there.
- **A few colour probes stay outside the shared helpers.** Every
  `expectPainted`, `tokenValue` and `tokenColour` a spec kept of its own
  is gone, but the probes of other properties, a surface, a fill or a size,
  and a few single-token probes written inline stay in their specs. A case
  that reads its node's colour inside `expect(…)` before `tokenValue`
  settles motion reads the node unsettled, as it did before; a node is read
  settled only where the case goes through `expectPainted` or
  `paintedVerdict`
  ([ADR 0194](ADR/0194-one-painted-contrast-helper-and-one-focus-hand-off-a-card-is-scored-part-by-part-and-no-page-skips-a-heading-level.md)).
- **Material's own announcements bypass the queue.** A closed single
  `mat-select` whose value an arrow key or typeahead moves calls the CDK
  `LiveAnnouncer` itself with the option's text. The CDK begins every
  `announce()` by clearing its region and cancelling a write still inside its
  delay, so a message the queue handed over less than 100 ms before is never
  placed, and one standing out its gap is replaced early. The snack bar, too,
  moves its text into a live region of its own, beside the announcement
  `NotificationService` makes through the queue
  ([ADR 0149](ADR/0149-the-review-step-says-what-it-changed.md)), for every
  notice but the one with an action, whose region is off
  ([ADR 0197](ADR/0197-a-deleted-transaction-can-be-brought-back-for-ten-seconds-because-the-delete-waits.md)).
- **Undo is offered for ten seconds.** The window stands still while the
  notice is hovered or holds focus, but nothing lets a reader lengthen it or
  turn it off beforehand (WCAG 2.2.1), and a dialog opened during the window
  covers the Undo while the window runs on under it
  ([ADR 0197](ADR/0197-a-deleted-transaction-can-be-brought-back-for-ten-seconds-because-the-delete-waits.md)).
- **A doubted type's tooltip opens for a pointer only.** The type flags on
  the transaction form and the review card are hidden icons inside the
  control the keyboard reaches, whose name speaks the flag's sentence, so a
  screen reader hears it; but the tooltip that shows it belongs to the icon,
  which takes no focus, so a sighted keyboard user sees the amber flag and
  not its sentence. A tab stop inside the segment would nest a focusable
  element in a button
  ([ADR 0185](ADR/0185-a-refund-is-asked-about-at-every-door-and-a-category-follows-its-rows-side-there-and-back.md)).
- **No gate reads what a dialog's title holds.** `aria-labelledby` takes
  every word under the element it names, so a control inside a
  `mat-dialog-title` puts its name on the end of the dialog's. The shared
  header is held by its spec, and the three titles written by hand (the
  confirm, the currency code, the AI search) hold only words and at most an
  `aria-hidden` glyph. An `icon-labels:check` rule that fails a control
  inside `mat-dialog-title` would close it.
- **The confirm dialog is a `dialog`, not an `alertdialog`,** and its
  message is not wired as its description. Twenty-eight call sites open it,
  and no shared opener sets either once.
- **Most dialog specs run Material's options, not the app's.** Only
  `dialog.config.spec.ts`, `dialog-header.component.spec.ts`,
  `transaction-list.component.spec.ts`'s *focus after a dialog a row menu
  opened (real template)*, `focus-indicator.spec.ts`, for its dialog
  header's close, and `delete-undo.smoke.spec.ts` provide
  `provideAppDialogs()`; a dialog any other
  spec opens traps focus only once its entrance ends, where the app's does
  as it renders, and leaves focus on the page once a menu's entry that
  opened it has gone, where the app's gives it to the menu's button.
- **A menu's entry that opens no dialog still drops focus.** The return to a
  menu's button is the dialogs' rule alone. The transaction filters'
  *Custom* menu and the period selector open a datepicker from an entry,
  and the picker gives focus back to that entry, which has left with its
  menu. A dialog closed before its menu has left the page, a submenu's entry
  and `restoreFocus: false` are outside the rule; the app has none of the
  three. These were read, not driven. A confirmed Delete no longer drops
  focus with its row (*Focus stays in the list after a delete*).
- **Focus after a delete can wait, or shift.** A list whose row leaves and
  that shows neither a row nor its empty state, as after a first load that
  failed and was never retried, holds the hand-off until the next confirm
  or until it is destroyed; and rows that a prefetch lands in the same list
  change as the row's leaving can still move the place it lands
  ([ADR 0196](ADR/0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)).
- **A tooltip is held to its control's name on the review card and the
  receipt manager's thumbnails alone.**
  `receipt-image-manager.component.spec.ts` reads each thumbnail's
  description as its tooltip's own words, *View image*, and finds it never
  says the transaction the name carries; nothing compares the two anywhere
  else. The receipt manager's other image controls keep their short words
  as a tooltip (*Remove image* on *Remove image 2 of {description}*), which
  the CDK reads after the name as a description.
- **A suggestion's remove pressed from the keyboard still drops focus.** The
  remove asks Firestore to delete the saved or recent search, and its row
  goes when the listener reports the delete, after the press has been
  handled, so nothing is there yet to hand focus on to and it drops to the
  page with the row.
- **Material's touch target is held to its button in a few places only.**
  An icon button's 48px touch target reaches 4px past its 40px box on every
  side, over any control that close, so a tap near one button's edge can
  press the one beside it: in the filter panel, each suggestion's remove
  reached up over the bottom of the remove above it, and a tap there removed
  the wrong search. The suggestion removes, the household overview's *Count
  toward…* button and the household plans' edit and delete buttons set
  `--mat-icon-button-touch-target-size: 40px`, the upload area's reorder
  arrows hold theirs to their own 28px, where Material's 48 reached 10px over
  the other arrow
  ([ADR 0193](ADR/0193-a-row-that-is-no-photo-is-no-drag-item-the-receipt-or-statement-chips-are-measured-and-the-upload-area-shows-where-a-photo-will-land.md)),
  and the header's shortcuts hint, its dismiss now a 40px button, takes the
  dismiss's touch target away. The goal card's Edit and Delete keep
  Material's target and stand 8px apart, the two 4px edges of their touch
  spans, where the two touched and their spans overlapped by 8px
  ([ADR 0192](ADR/0192-a-control-repeated-per-item-names-its-item-in-its-own-text-too-a-button-is-named-in-every-branch-and-an-unlabelled-switch-fails-the-axe-pass.md));
  the header's three icon buttons, whose spans reach 4px over each
  neighbour, which is Material's own layout for adjacent 40px buttons, were
  read and left as they are
  ([ADR 0196](ADR/0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)).
  No other row or scroll container that holds an icon button has been
  checked for it
  ([ui-overflow.md](ui-overflow.md#g4--nothing-is-clipped-that-cannot-be-reached-another-way)).
- **Focus after a pick in the upload area.** A pick made through a focused
  Browse takes Browse away with the empty zone, and nothing on the pick
  path asks for focus, so it drops to the page. On WebKit a tap focuses no
  button, so a tap's remove now puts focus on the next remove, as a tap on
  an arrow already did; an icon button no longer paints Material's focus
  state layer (*A focused button shows an indicator inside it*).
- **A hand-off made outside `focusWhenRendered` passes a held key on.** The
  shared helper (`shared/utils/focus-when-rendered.ts`) drops the repeats of
  a key held across the move, and the household pages and the four
  components that kept a private copy (the dashboard layout settings, a
  split's parts, the receipt viewer and the note translation lens) go
  through it now
  ([ADR 0194](ADR/0194-one-painted-contrast-helper-and-one-focus-hand-off-a-card-is-scored-part-by-part-and-no-page-skips-a-heading-level.md)).
  The focus calls the dashboard, its card menu, the transactions page and
  the list's select mode make for themselves, and the period chip's clear,
  let each repeat press the control focus lands on: a held Enter on a
  dashboard card menu's entry can reopen the menu on its button and press
  its first entry again. These were read, not driven.
- **Controls other than Material's buttons keep their own focus look,
  unmeasured.** Chips, menu items, tabs, switches, checkboxes, radios and
  button toggles are not held against their surfaces, and hand-rolled
  controls keep the app's outline; the import's Review step header, which
  Material focuses after Continue, shows its focus state layer as a grey
  block in dark. Forced colours are read from the stylesheet alone, and the
  upload area's drag handle takes no focus, so it has no indicator
  ([ADR 0196](ADR/0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)).
- **Nobody listened for the search box's placeholder.** The box's name was
  read with and without its placeholder; whether a screen reader also
  speaks the placeholder after the name, and how WebKit and VoiceOver treat
  it once the box holds a query, was not heard.
- **No gate fails an `outline: none` with nothing in its place.** A check
  that the same selector has a `:focus-visible` rule or an `a11y.frame-ring`
  include would prove a ring is written, not that it paints, since a
  selector that outranks it passes too. The tree holds four such
  declarations besides the mixin's own, each paired: the filter panel's two
  boxes, through the ring round their pills, which *the two text boxes'
  ring* reads from the CSSOM; the review card's notes field, with a
  `:focus-visible` rule of its own that no spec reads; and a Material
  button's, under `forced-colors: none`, through the focus indicator drawn
  inside it, which `focus-indicator.spec.ts` measures.
- **No gate holds a name to the words its control shows.** The specs that
  read a name through `holdsShownWords` hold the controls they name; a
  control added later is held only if its spec adds such a case. Settings'
  four switches are pinned by their own specs, but no gate holds a switch's
  name to the words it projects. axe's
  `label-content-name-mismatch` is experimental and outside the `wcag2a`
  and `wcag2aa` runs, and Karma serves no fonts, so it would read an icon's
  ligature as shown text. A rule that reads both keys from the catalogs and
  checks one holds the other, per locale, would close it
  ([ADR 0192](ADR/0192-a-control-repeated-per-item-names-its-item-in-its-own-text-too-a-button-is-named-in-every-branch-and-an-unlabelled-switch-fails-the-axe-pass.md),
  [ADR 0196](ADR/0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)).
- **What the quoting gate cannot follow.** tc quotes a description through
  `common.quotedName`, but for the seven keys `translation-keys.spec.ts`
  lists, each with why its caller never hands it a stand-in; any other key
  that quotes `{{description}}` itself, in any catalog, fails. Nothing
  checks that reason once it is written, a listed key handed the quoted name
  would read 「「…」」, and a slot under another name is not read
  ([i18n.md](i18n.md#a-transaction-with-no-description)).
- **RTL layout is groundwork only** (#86). Direction follows the locale and the
  physical CSS that remains is frozen per file, but no right-to-left locale
  ships and 97 hits are still unconverted (#445) — see [rtl.md](rtl.md).
