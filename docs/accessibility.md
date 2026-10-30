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
are clipped in place (`position: absolute`, a 1px box,
`clip-path: inset(50%)`, the stat card's shape) rather than taken out with
`display: none`, which left four unnamed tabs. The rule is a viewport query
Karma's window cannot reach, so `import-wizard.component.spec.ts` (*the step
headers under the phone rule*) reads its declarations from the stylesheet,
lays them on the rendered labels and sweeps the tab list with axe, in both
schemes. That proves what the rule declares; a 375px browser window is what
proves the cascade
([ADR 0186](ADR/0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)).

**A row's checkbox is named for its row.** Each review card row's checkbox is
named *Select {description}*, and a row with no description yet *Select an
untitled row*, the stand-in the card's other sentences use (see *The import
review step*). *Select all* keeps its visible text as its name. The name is
bound through the toggle's `[aria-label]` input, the one spelling that reaches
the checkbox Material renders inside: Material clears the host's own
`aria-label` and `aria-labelledby`, so `[attr.aria-label]` names nothing
([ADR 0186](ADR/0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)).

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
(the *Test API key* buttons, the transaction form's submit, the camera's
process button). Idle, the visible text names it.

**Check:**

```bash
npm run icon-labels:check
```

`scripts/check-icon-labels.mjs` holds eight rules over every template:

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
- a control stamped once per item in its own template — under an `@for`,
  `*ngFor`, `*cdkVirtualFor` or a table's cell or row definition — does not
  take its whole name from one catalog key with no parameters, bound or
  interpolated, which gives every copy the same name. A key given parameters
  has a slot for the item; whether what fills it tells the items apart is a
  reading question, which is why the upload area's buttons name a file by its
  place as well as its name. A repeated status (a row's spinner) may say the
  same of every item, and a menu button the fourth rule reports is reported
  there. What it found when it landed and was left unfixed is frozen in
  `ITEMLESS_FROZEN` by file, key and how many controls carry that key there:
  27 rows over 28 controls in eleven templates. A hit no row names fails, and
  so does a row whose count is not the tally, while a control that only moves
  changes nothing
  ([ADR 0186](ADR/0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md));
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
  `mat-icon`, which hides itself. A `mat-slider` named on its host names each
  thumb as well, since it forwards no name to them. Two are frozen in
  `UNNAMED_FROZEN`, a list of its own in the shape of the sixth rule's rows,
  with the tag as the key: the budget form's alert-threshold slider and the
  AI page's Auto sync switch
  ([ADR 0186](ADR/0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)).

It reads the markup, so it cannot tell a useful label from a useless one, nor
whether the control a hidden indicator sits in really announces the state;
and it reads each tag alone, so an indicator under a hidden parent repeats the
attribute. Nor can it see a block that holds an option's icon beside other
nodes, which Angular projects whole into the label, or a menu button's name
built in TypeScript, nor a tooltip a directive's host binding adds, and a
literal `tabindex="-1"` passes the fifth rule although Tab skips it. The sixth
cannot see a name built in TypeScript, a ternary between two bare keys, a
name taken from `aria-labelledby` or from the control's text, or a control
repeated only by its parent's repeat: the goal card's edit and delete
buttons, stamped once per goal by the goals page, are neither guarded nor
frozen. The seventh cannot see a reference or an id set in TypeScript or by a
host binding, a bound or interpolated one, an id declared twice or once per
item, which leaves a reference ambiguous rather than empty, or whether the
element named holds any text. The eighth cannot see a name set in TypeScript
or by a host binding, text projected inside an element hidden from a screen
reader, which counts there and names nothing, text only one branch of a
block renders, or whether the name says anything. The script's header lists
the rest.

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
  `.transaction-row:has(.row-activate:focus-visible)`.

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
description*. Picking a country is not announced — the menu it was picked from
is where the user is looking. A failed row's reason stands on its card as
`role="note"` rather than an alert: it happened during the write, before that
render, and interrupts nothing.

### A file on the upload area is named by its place and its name

Each row on the import upload area names its buttons by the file they act
on: *Remove file 2 (image.jpg)*, *Move file 2 (image.jpg) up* and *down*
(`import.removeFileLabel`, `import.moveFileUpLabel`,
`import.moveFileDownLabel`). The place comes first because two photos from an
iPhone are both `image.jpg`, and it is the number the photo badge shows. Every
row used to read *Remove*, *Move up* and *Move down*, so neither the buttons
nor the rows could be told apart by ear. A list of one reads the same way
(*Remove file 1 (statement.csv)*). Pinned in `file-dropzone.component.spec.ts`
by "names each row's remove and move buttons by the file's place and name"
and "renames a row's buttons when its file moves"; the sixth
`icon-labels:check` rule holds the class (*Accessible names come from the
catalog*).

With a photo picked, the upload step asks *What are these images?* above two
chips, *Receipts* and *Statement*. Their listbox is named by that question. It
used to have no name: its `aria-labelledby` named `image-kind-label`, which
the question carried as a class and not as an id. The seventh
`icon-labels:check` rule holds that class
([ADR 0186](ADR/0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)).

### A file the import refuses

The import dropzone refuses a file it cannot take, too large or of a type it
does not read, with a banner under the dashed zone: *{name} is larger than
the 10 MB limit*, or that it is not a supported file type. A file shared from
another app that the share gate turned away is named in the same banner, with
two sentences of the gate's own, *{name} is empty* and *{name} is a backup:
pick it here to import it* ([share-import.md](share-import.md)). The banner is
`role="alert"`, because the refusal answers the pick, the drop or the share
the user just made, and its icon is decorative (`aria-hidden="true"`). It
used to have no role, so a refused file was silent to a screen reader: to
someone who could not see the banner, the pick seemed to have done nothing.

Several refusals share the one alert, one sentence a file, joined by the
reader's own stop, `common.sentenceSeparator`: a Latin stop and a space in
en, 。 alone in ja and tc. None of the four sentences ends in a stop of its
own in any catalog, so none is doubled (pinned in "the sentences its alert
joins", with the rendered "joins the files it refuses with the reader's own
stop"). A share's refusals follow any the user's own pick left standing.

The banner sits below the zone, not inside it. The zone itself is the
`role="button"` that opens the file picker, and ARIA gives a button
presentational children, so an alert inside one is kept only where a browser
chooses to keep it. Chrome does; WebKit, which the iOS app runs in, was not
checked. The drag handlers moved out to a frame around the zone and the
banner, so a file dropped on the banner still lands, and a click on the
banner no longer opens the picker. Pinned in
`file-dropzone.component.spec.ts` by "announces an oversized file it
refuses", which also checks that the banner has no `role="button"` ancestor,
and "takes a file dropped on the refusal banner".

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
ring. Surfaces and brand colours are untouched, and a
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
there: two stylesheets declare it because two paint their own focus and
selection states, and a gate demanding it of the rest would be a gate that
asserts nothing.

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
3:1, the bar WCAG 1.4.11 sets for a graphic that carries meaning. Seven rows
do, because what they hold is a glyph or a dot, never a word:

| Pair | What it holds |
|---|---|
| `--color-ai` on `--surface-card` | the AI features' icons |
| `--color-error` on `--surface-card` | the exact-duplicate mark and the dropzone's hovered remove; the dropzone's banner icon and the data page's danger icon, on their error tints, are measured in the row's reason |
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
`ratio` scores the pair. `withTheme` stamps one theme class for a token
probe; anything that reads `ThemeService.effectiveTheme()` is driven
through the service instead, with `withScheme` from `axe.ts`. `hoverValue`
reads a `:hover` rule from the CSSOM, because Karma cannot hover. Read the
element Material paints, not the host: a chip's label is
`.mdc-evolution-chip__text-label`, and a progress bar's indicator is the top
border of `.mdc-linear-progress__bar-inner`. `theme-aliases.spec.ts` holds
every alias to its token in all four modes. [testing.md](testing.md#colour-as-painted)
has the helpers in full, and how a spec puts a select's options or a menu's
items into each state it measures.

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
  `?tab=` deep link opening on its tab in view.
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
  (`household-plans.component.spec.ts`).
- `switch-on-choice.directive.spec.ts` pins the household switcher's keys.
  A closed `mat-select` takes an arrow key, Home, End, a page key or a typed
  character as a choice, and on the switcher every choice swaps the page for
  another household and moves focus into it, so arrowing through the closed
  switcher would swap household after household. On the closed switcher those
  keys open the list instead, as a native select does on macOS; an open list
  moves through its choices without picking. `household.component.spec.ts`
  pins where focus lands after a swap — the view that came in — and that it
  moves only when it was on the switcher or had dropped to the document.
- Three surfaces of the import wizard the walkthrough never opens are swept
  with axe (WCAG 2.0 A and AA, axe's `wcag2a` and `wcag2aa` tags,
  `color-contrast` included) by their component
  specs, in both schemes. `import-wizard.component.spec.ts` sweeps the upload
  step with two photos and a refused `run.exe` dropped on the real zone, so
  the rows, the previews, the receipt-or-statement question and the alert all
  stand, and checks that the pass scores contrast rather than skipping it;
  and it sweeps the stepper's tab list under the phone rule's declarations
  (*A name hidden for room is clipped, never removed*).
  `transaction-preview-table.component.spec.ts` sweeps the review card with a
  card of every kind of row — plain, doubted, refund, duplicate, and blank as
  **Add a row** makes one — the list let out to its full height so no card
  falls outside the container, and checks the same. The review step around
  the card is not swept.

## Known gaps

- **Only navigation has been audited.** Segmented controls and the period
  selector express selection visually and have not been; the tab strips are
  audited for reachability and keyboard travel only, not for how selection is
  announced.
- **The automated pass is a phone audit of eight routes.**
  `app.smoke.spec.ts` runs axe-core (WCAG 2.1 A and AA, `color-contrast`
  included) inside `expectPage`, so every page the walkthrough opens is
  swept, once in each scheme, forced through `ThemeService`: a pair that
  fails in only one theme fails on any host. Nothing it has found is frozen
  any more. What it cannot see is stated in
  [emulator-blind-spots.md](emulator-blind-spots.md): i18n is not served,
  Karma's window is 756px, eight page-level rules are disabled because the
  run is scoped to the routed element, and `color-contrast` scores nothing
  below the fold of Karma's frame but the five nodes the walkthrough
  scrolls into view (the next gap). `/login` is opened by the redirect case
  and never audited; `/lock`, `/ai`, `/search-history`, `/import/file` and
  `/import/history` are never opened. The import wizard's upload step with
  photos picked and a refusal standing, its step headers under the phone
  rule, and the review card with every kind of row are swept by their
  component specs instead, in both schemes (*What is tested*); the empty
  upload step and the review step around the card are swept by nothing. Nor
  does it open a dialog, a category select or a menu, so the pickers, the
  import review's category menu and the category dialog are held by their
  component specs alone.
  axe's `incomplete` results are not read, so a one-character text, or a
  label axe finds overlapped by another element, is scored by no pass.
  Everything outside that is still a hand-written spec, and nothing sweeps
  for the next instance of a class nobody has met.
- **The axe pass scores only what starts in Karma's frame, and five nodes
  below it.** Every page renders inside the shell's fixed scroller,
  `.main-container`, and axe counts a node under a fixed ancestor as
  offscreen once its top passes the viewport's bottom. An offscreen node is
  skipped outright: it appears in no result, not even `incomplete`. A node
  in plain flow would be scored at any depth. Karma's frame is 756px wide
  and 413px tall. `auditInView` (`core/services/testing/axe.ts`) scrolls a
  node into the band between the header and the frame's bottom before it
  audits, and the walkthrough uses it, in both schemes, on five nodes: the
  spending chart's legend list and the Budget Progress widget on
  `/dashboard`, the overview on `/budgets`, the rules grid on the Recurring
  tab, with an active rule and a paused one, and Upcoming Bills. Everything
  else that starts below the frame is never scored. In the run that
  measured it, that was: on `/dashboard`, Recent Transactions (its top at
  521px), the chart's card around its legend list and AI Insights; on
  `/settings`, all but the top of the profile section and every section
  after it; on `/data`, everything past the first 413px of a page 2687px
  tall; on `/household`'s member view, the second row of figures, the
  member chips, the shared rows, the plans and the members; and on
  `/about`, every card after the first. A node taller than about 285px
  cannot be centred inside the band, so a tall card is audited as its
  parts
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
  and the pipes' specs hold it. The axe pass is the other half: it measures
  what a rendered page paints.
- **Nothing sweeps for the next animation CSS cannot reach.** Chart.js and the
  Material tab strips were found by reading the code; a new WAAPI duration or
  canvas animation will honour neither kill-switch and no gate will say so.
- **The same refusal twice is announced once.** A second refusal of a
  different file changes the banner's text, and the alert says it. Refusing
  the identical file again leaves the text as it was, so there is nothing new
  for the alert to say, though the banner stays on screen and is brought into
  view again.
- **Some controls repeated per item still share one name.** The sixth
  `icon-labels:check` rule's 27 frozen rows, 28 controls in eleven templates,
  still name every copy alike: among them the transaction filters'
  remove-search buttons, the receipt images' remove buttons, the camera's
  photo arrows and remove, and nine review-card controls. The goal card's edit
  and delete, stamped once per goal by the goals page's own repeat, are
  neither guarded nor frozen, since the rule reads a template's own repeats.
- **Two toggles name nothing, frozen by the eighth rule.** The budget form's
  alert-threshold slider carries its `aria-labelledby` on the `mat-slider`
  host, which names no thumb; the AI page's Auto sync switch has a sibling
  label it never references.
- **Settings' Sign out button has no name below 480px.** Its label, the only
  name it has, is taken out with `display: none` there
  (`settings.component.scss`), the shape the wizard's step labels had before
  they were clipped instead.
- **Two stops join sentences in ja and tc.** Only the dropzone's alert joins
  with `common.sentenceSeparator`. `joinSentences` still joins with a Latin
  stop and a space in every language — the review card's names, the form's
  verify text and the wizard's round notice
  ([ADR 0099](ADR/0099-the-review-step-edits-what-it-shows.md)'s gap) — and
  the key is the one a later fold would read.
- **The empty upload step is likely nested-interactive.** With nothing
  picked, the dropzone is a `role="button"` around the Browse button, which
  axe very likely reports; no pass sweeps that state.
- **In a mixed pick the move arrows and the number badge count every file.**
  A photo before a CSV keeps an enabled down arrow that swaps it below the
  CSV, and with a CSV first the photos are numbered 2 and 3.
- **Faded glyphs outside the import wizard are unmeasured.** The upload area
  and the wizard hold no other resting fade, but 21 `opacity` rules elsewhere
  — on the goal card, the forecast, the data hub, login and others — were not
  measured, and `contrast:check` cannot see opacity
  ([ADR 0186](ADR/0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)).
- **Material's own announcements bypass the queue.** A closed single
  `mat-select` whose value an arrow key or typeahead moves calls the CDK
  `LiveAnnouncer` itself with the option's text. The CDK begins every
  `announce()` by clearing its region and cancelling a write still inside its
  delay, so a message the queue handed over less than 100 ms before is never
  placed, and one standing out its gap is replaced early. The snack bar, too,
  moves its text into a live region of its own, beside the announcement
  `NotificationService` makes through the queue
  ([ADR 0149](ADR/0149-the-review-step-says-what-it-changed.md)).
- **A doubted type's tooltip opens for a pointer only.** The type flags on
  the transaction form and the review card are hidden icons inside the
  control the keyboard reaches, whose name speaks the flag's sentence, so a
  screen reader hears it; but the tooltip that shows it belongs to the icon,
  which takes no focus, so a sighted keyboard user sees the amber flag and
  not its sentence. A tab stop inside the segment would nest a focusable
  element in a button
  ([ADR 0185](ADR/0185-a-refund-is-asked-about-at-every-door-and-a-category-follows-its-rows-side-there-and-back.md)).
- **RTL layout is groundwork only** (#86). Direction follows the locale and the
  physical CSS that remains is frozen per file, but no right-to-left locale
  ships and 97 hits are still unconverted (#445) — see [rtl.md](rtl.md).
