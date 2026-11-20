# 193. A row that is no photo is no drag item, the receipt-or-statement chips are measured, and the upload area shows where a photo will land

**Status:** Accepted, implemented · **Date:** 2026-11-19 · **Issues:** #543

Reference documentation lives in [../accessibility.md](../accessibility.md),
[../ui-overflow.md](../ui-overflow.md), [../testing.md](../testing.md),
[../receipt-import.md](../receipt-import.md),
[../import-fields.md](../import-fields.md) and [../e2e.md](../e2e.md).

Two leftovers of the upload area, recorded by
[0187](0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)
and filed as #543. In a pick that mixed photos and a CSV, a photo dragged
across the CSV slid it aside, and the CSV snapped back to its row only on the
drop: for as long as the drag lasted the list showed an order it would not
keep. And the receipt-or-statement chips over the photos had never been
measured: axe left them unscored, and no painted case read them. This record
also carries the upload area's look while a photo is moved, which showed
neither where the photo would land nor what could move, and two findings on
the same step that are older than this branch: a second press on the picked
chip took the pick away, and four feature chips shaped like the pressed ones
pushed the upload area under a phone's first screen.

Closes two gaps of [0187](0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md):
the CSV that slides while a photo is dragged across it, and the
receipt-or-statement chips that stay unscored.

Amends 0187's *Photos are numbered among photos*, its third item. Its rule
stands: a row that is no photo is never dragged and keeps its row. What
changes is how. Such a row is no drag item at all, so nothing slides it, and a
drop's indices count the photos alone, where 0187 remapped them after CDK's
sort of every row.

Applies [0171](0171-second-copies-fold-into-one-copy-of-each-helper.md). The
drag a spec makes is one helper, `dragByHandle` in
`core/services/testing/drag-by-handle.ts`, which the upload area's spec and
the wizard's smoke share; and the dropzone spec splits a rule's selectors
with the `selectorsOf` that `painted-contrast.ts` exports, not a copy of its
own.

## Context

**The drag.** Every row of the list was a `cdkDrag`, the CSV's disabled:
`[cdkDragDisabled]` held every row but a photo among two or more. A disabled
drag item is still one of the list's items, and CDK slides every item a drag
passes, so a photo dragged over the CSV pushed it aside. 0187 had looked for
the sort's own way out and found none: `cdkDropListSortPredicate` answers only
whether one index may be the target, and a sibling's slide is not asked. So
`onFileDrop` let CDK's move sort a copy of the list, read the photos off it
and wrote them back into the photos' rows. The drop came out right; the drag
did not. In the dropzone spec, b dragged up past the CSV in `[a, csv, b]` left
the CSV at `translate3d(0px, 90px, 0px)` mid-drag. #543 proposed a sort that
skips rows that are no photo, through a custom sort strategy or a CDK hook if
one lands. CDK 22.1.4 keeps its sort strategy private (`_sortStrategy`), and
offers no public hook that holds a row still.

**The chips.** Once photos are picked the upload step asks what they are,
with two chips, *Receipts* and *Statement*, in a `mat-chip-listbox` named by
the question. The photos-picked sweep left them out: axe found their labels'
background overlapped (`bgOverlap`) and left both `incomplete`, for a cause
0187 had not found, and no painted case read them. Material paints them from
its own tokens. The picked chip's label is `--mat-sys-on-secondary-container`
on a `--mat-sys-secondary-container` fill, with a checkmark in the label's
colour; the other chip's label is `--mat-sys-on-surface-variant` on a body
Material leaves clear. The listbox writes its value to the chips in a
microtask once they render, so a case waits for it.

**The look of a moved photo.** The slot a dragged photo left was a copy of
the row at 0.3 opacity on `--surface-hover`: its name still shown, and its
edge solid in `--border-primary`, between 1.0:1 and 2.4:1 on the zone. The
lifted row was drawn on `<body>`, where the list's width query cannot reach
it, so at a phone's width it was laid out as a flex row, not the two-line
grid it lay in; and the row's `transition: all` left it trailing the pointer,
since CDK moves it by its transform. The handle was 26 by 26. Each move
arrow's 48px touch target reached 10px over the other arrow, so a tap meant
for one could land on the other. A zone holding files kept the pointer
cursor, though once a file is picked a click on it opens nothing (*Add more*
does). And every row lifted under the pointer, a CSV and a lone photo, with
nowhere to go, among them.

**The rest of the step.** A press on the chip already picked, by click,
Space or Enter, deselected it. Material lets a press toggle a chip off, and
the listbox then reports no value. The wizard's `(change)` binding wrote
`$event.value ?? 'receipt'`. With Receipts picked that was the value the
signal already held, so `[value]` never rebound and the selection was never
put back: both options read `aria-selected="false"` and lost their fill and
checkmark while the photos were still read as receipts. With Statement picked,
the press switched the photos to receipts without a word. Above the steps, the
four things the import can do were outlined chips with a glyph each, the
shape of the receipt-or-statement chips, which are pressed, where these never
were; at a 320px phone en's stood a row each, and with the header and the
stepper they put the upload area under the first screen in en and ja.

## Decision

### A row that is no photo is no drag item

Inside the list's one `@for`, `@if (isImageFile(file))` picks between two row
templates. A photo's row is the only `cdkDrag`, with
`[cdkDragDisabled]="!hasMultipleImages()"`, its badge, its arrows and its
handle. Any other file's row carries no drag directive and no handle. Both
keep `[attr.data-row]="$index"`, which the focus hand-offs select by, and the
files keep the order they were picked in. A file's name, size and type are
written once, in `<ng-template #fileInfo let-file>`, which both rows render.
The remove button, one button with a ternary name before, is written once in
each branch with its own key: `import.removePhotoLabel` with the photo's
number among the photos, `import.removeFileLabel` with the file's number among
the files that are not photos.

With the photos alone as the list's items, the indices a drop reports are
places among the photos. `onFileDrop` takes the photos off the list, moves the
dragged one among them with `moveItemInArray`, and writes them back into the
photos' own rows; every other file keeps its row. The template and the method
change in one commit, `fix: a photo dragged past a CSV no longer slides it`:
handed photo indices, the old remap would read b's `(1, 0)` in `[a, csv, b]`
as a move of the CSV, and leave the list as it was.

A pointer held over the CSV's row is over no item, so CDK sorts nothing: no
row is offset, the drop reports the same place twice, and the list stays as
it was.

The dropzone spec drives the drag as a mouse makes one, through
`dragByHandle` (`test: a CSV's row holds still while a photo is dragged over
it`): the handle scrolled into view, and a press on what a pointer at its
middle hits, which must be the handle or inside it, with a button held and
a click count, or CDK takes it for a screen reader's; a first move past CDK's
5px start threshold; a second onto the target row, where the pointer is held
250ms, past the 200ms glide of the rows the drag slides aside; then the
release, and a wait until the lifted row has glided into its slot. A handle
covered, cut off or deaf to the pointer throws rather than starting a drag a
mouse could not, and so does a drag that lifted no preview, before the reading
mid-drag runs; two cases, *refuses to drag by a handle the pointer cannot
press* and *refuses a drag that never started*, hold both. In *a pick that mixes
photos and a CSV*, *holds a CSV's row still while a photo is dragged past it*
reads, mid-drag, the CSV's `style.transform` as `''` and its offset from
`.file-list` unchanged, with a slot standing and photo a slid aside and drawn
lower; the drop leaves `[b, csv, a]`. *moves nothing for a photo dropped on
the CSV's row* reads no row offset and a drop with equal indices. *offers no
drag on a non-photo row* finds the photos alone among the drag items, and no
`cdk-drag` class on the CSV's row, before and after a move and a remove. Red
before the fix: `Executed 119 of 119 (5 FAILED)`, the CSV at
`translate3d(0px, 90px, 0px)` mid-drag. With a disabled `cdkDrag` put back on
the CSV's row, three cases fail, among them
`the CSV's offset from the list, mid-drag: Expected 180 to be 90`.

### The chips are measured as painted

The wizard spec's *the upload step with photos picked, under the axe sweep*
gains *reads each receipt-or-statement chip's label at AA and the checkmark at
3:1 in the four palettes, in both states*. It waits out the listbox's
microtask, then in each of `PALETTES` checks what each label stands on before
it scores it: the picked label's painted background is
`--mat-sys-secondary-container`, and the other's is the listbox's, the page.
Then `expectPainted` holds the picked label to
`--mat-sys-on-secondary-container` and the other to
`--mat-sys-on-surface-variant` at 4.5:1, and the checkmark, a graphic, to
`--mat-sys-on-secondary-container` at 3:1. A real click on Statement's
primary action flips the pick, and everything is read again. It is the
chips' only contrast reading, so it expects each label and the selected
chip's focus overlay before it reads the palettes: a part a Material rename
stops matching fails it, where it once returned early and skipped every
palette.

Both readings are at rest. The click focuses the chip, and a focused chip
paints a state layer over its fill, a sibling of the label that the painted
walk does not see. So focus is let go before the second reading, and each
reading first holds `.mat-mdc-chip-focus-overlay` at opacity `'0'`.

At rest, in every palette and both states, the picked label reads 7.22:1 on
its fill and the checkmark 7.22:1; the other label reads 8.56:1 on the page in
light and 14.52:1 in dark. High contrast leaves the `--mat-sys-*` tokens
alone, so its two palettes paint the chips as plain and dark do; the case
measures them all the same, and says why. No palette fails, so no colour
changes, and `.image-kind` takes no `--mat-chip-*` token. With the picked
chip's `--mat-chip-selected-label-text-color` set to
`var(--mat-sys-secondary-container)`, its own fill, the case fails in all four
palettes (`TOTAL: 1 FAILED, 261 SUCCESS`):
`plain, receipt picked: the selected chip's label on what it sits on: Expected 1 to be greater than or equal 4.5.`

Axe is not made to score them. Its `bgOverlap` is Material's own focus
indicator span, `.mat-focus-indicator`, which sits inside each
`.mdc-evolution-chip__text-label`; the sweep's comment names it and points to
the painted case.

### The slot is an empty outline, and the lifted row keeps up

The slot a dragged photo will land in, `.cdk-drag-placeholder`, is an empty
outline: no fill, its children hidden, its edge dashed in
`--color-primary-text`. The edge keeps the row's 1px, so the slot is the
row's own size and nothing below it moves as it opens. `--color-primary-text`
holds a graphic's 3:1 on the zone it shows through, at rest and hovered, in
every palette: 6.30:1 at rest and 6.58:1 hovered in light, 11.60:1 and 6.72:1
in dark, high contrast as its base. `contrast:check` now scores
`--color-primary-text` on `--surface-background` at 3:1, the zone's resting
fill under a finger, where it held that pair exempt; its `--surface-hover`
row names the slot under a mouse. The spec reads the edge as painted: for
the reading the slot takes the edge's colour as its text colour, so the
colour's alpha, the slot's own opacity and every ancestor's are composited
over the zone. Read from the computed border colour alone, a slot faded to
0.3 on the clear fill read about 6.3:1 and passed; as painted it reads
1.6:1 to 2.1:1 and fails, alone or on the `--surface-hover` fill.

The lifted row, `.cdk-drag-preview`, is drawn at full strength (its 0.95
opacity is gone), over `--shadow-overlay`, edged in the slot's colour. CDK
owns its transform, and no rule writes one. The row's `transition: all` is now
`border-color 0.2s ease, box-shadow 0.2s ease`, and the rule that glides the
rows a drag passes leaves out `.cdk-drag-preview` as it leaves out the slot,
so the lifted row keeps up with the pointer.

The photo's row takes `cdkDragPreviewContainer="parent"`: the lifted row is
drawn inside `.file-list`, where the list's width query still lays it out as
it lay, two lines at a phone's width. It takes `cdkDragLockAxis="y"`: a photo
changes its place only up or down, and the lifted row moves only that way.

### Only what moves looks movable

The handle says `grab`, and `grabbing` once pressed (`:active`). While a photo
is held, the list and everything in it say `grabbing`, over a row's own
`default` and a button's `pointer` alike. A zone that holds files says
`default`.

Only a row that can move lifts under the pointer:
`.file-list:not(.cdk-drop-list-dragging) .file-item.reorderable:hover`. A CSV,
or a lone photo, has nowhere to go. Nothing lifts while a photo is held: a row
CDK slides aside passes under the held pointer and would flash the lift
mid-glide. The slot itself takes no pointer; CDK sets `pointer-events: none`
on it.

### The handle and the arrows are targets of their own

The handle is a 40 by 40 box round its glyph, the app's floor for a control,
which stays 40px; nothing moves to 44. Each arrow's touch target is held to
the arrow's own 28px (`--mat-icon-button-touch-target-size: 28px`), as the
filters' suggestion removes hold theirs to 40, so neither reaches over the
other arrow.

Beside the name, the preview, the arrows, the remove button and the handle
now take 204px with their gaps, 196 on a phone. Below a 400px list, where one
line would leave the name under 162px, the arrows and the remove button take
a second line, as before, and the name keeps 129px at 375px.

### On iOS 15 the handle stays 40px

iOS 15's WebView, which the app still supports, has no container queries, so
its rows keep one line at any width. There the 40px handle leaves the name a
37px column at 375px, 14px narrower than the 51px beside the old 26px handle.
No `@supports not (container-type: inline-size)` rule gives that WebView the
26px handle back: it would keep a target under the app's 40px floor on that
WebView alone. The narrow name is the trade made for a handle a finger can
hold, and the stylesheet's comment states it.

### A second press keeps the pick

The listbox's `(change)` calls `chooseImageKind`. A value of `receipt` or
`statement` is taken. No value, the listbox's report after a press on the
picked chip, puts the pick back with `source.value = this.imageKind()`, whose
setter selects by value with no user-input event, so nothing is reported
again. The question always has an answer: the photos are read by it, and the
hint under the chips says which. *a second press on the receipt-or-statement
chip already picked* presses each chip, once picked, by click, Space and
Enter: it keeps its fill, its checkmark and `aria-selected`, the other does
not, and the photos and the hint stay as they were
(`fix: a second press on the picked receipt-or-statement chip keeps it picked`,
`test: the picked receipt-or-statement chip stays picked under a click, Space and Enter`).

### The import's features are words

The four features over the steps are a list,
`<ul class="features-list" role="list">`, of four items, each a glyph hidden
from a screen reader and its words in a span: `--text-xs` in `--text-muted`,
the subtitle's colour, with no fill, outline or pointer, wrapping as words do.
`role="list"` because WebKit drops the role from a list drawn without
markers. The header's margin over the list is 16px where it was 24; the list
keeps the 24 over the stepper. The list sets its margins, its items' floor
and its glyphs' size in logical properties, as the upload area's rules
beside it do, so they compute the same in either reading direction. A 320 by
568 phone shows 424px under the wizard's top, between the app bar, the page's
gutter and the bottom nav; at a 288px page the upload area and its 40px of
padding now start within it in en, ja and tc
(`fix: the import's feature list reads as words, and the upload area starts on a phone's first screen`,
`test: the import's features as a list of words, and the upload area on a 320 x 568 first screen`).

### The proofs

`test: the dragged photo's preview, its slot, the cursors and the reorder targets`
adds five cases to the dropzone spec, two of them real drags through the same
`dragByHandle`. Under *the pointer over the upload area*, the cursors are
read from the computed cascade and the CSSOM, and the lift through
`hoverValue`. Under *at a phone's width*, a real
drag at a 303px host finds the lifted row inside `.file-list`, laid out as
`grid`, with neither `all` nor `transform` among its transitions, and still
where the row was after a 60px sideways move; the handle and the arrows'
targets are measured at 303px and 600px. Under *colours, as painted*, the slot
and the lifted row are read in the four palettes. Red before the fix:
`TOTAL: 5 FAILED, 119 SUCCESS`. Each mutation fails its own case:

- `transition: all 0.2s ease` back on the row:
  `what the lifted row transitions: Expected [ 'all' ] not to contain 'all'.`
- `cdkDragPreviewContainer="parent"` taken off:
  `the lifted row, at a 303px list: Expected 'flex' to be 'grid'.`
- `cdkDragLockAxis="y"` taken off:
  `the lifted row, moved sideways: Expected 82 to be close to 22, 0.`
- the `:not(.cdk-drop-list-dragging)` clause dropped:
  `a photo of two while one is held: Expected function to throw an Error.`

`test: emulator proof for per-item names, the still CSV and the receipt sweep`
drags on the real wizard: *a photo dragged by its handle past the CSV is read
where it was dropped, the CSV held still* keeps the CSV's transform `''` and
its place mid-drag, finds a dashed slot in `--color-primary-text` and the
lifted row inside the list, and reads the photos as `[b, a]`.

## What was rejected

- **A custom sort strategy that skips rows that are no photo**, as #543
  proposes. CDK 22.1.4's strategy is a private field of the drop list, and
  CDK offers no public hook for one.
- **A sort predicate.** `cdkDropListSortPredicate` gates where the dragged row
  may land, never whether a sibling slides (0187).
- **Keeping the CSV a disabled drag item.** CDK slides a disabled item as it
  slides any other.
- **A list of photos apart from the other files.** It would give up the order
  the files were picked in, which 0187 keeps.
- **A faded copy of the row as the slot.** Its edge read between 1.0:1 and
  2.4:1 on the zone, and a copy of the row, name and all, reads as a row
  rather than as a place.
- **A 44px handle.** The app's floor for a control is 40px, and the handle is
  held to it like every other.
- **The 26px handle on iOS 15** (*On iOS 15 the handle stays 40px*).
- **Teaching axe to score the chips.** Its overlap is a span every shipped
  chip carries; a sweep that hid it would score a chip that is not the one
  shown. The painted case reads the chip as it is.
- **`--mat-chip-*` tokens on the chips.** Every palette reads AA as Material
  paints them.
- **Chips that cannot wrap, for the features.** Material's chip set wraps
  inside its own `.mdc-evolution-chip-set__chips`, so a `flex-wrap: nowrap` on
  the set never held; and a feature is no choice, where a chip on this step
  is one.

## Consequences

- A photo dragged past a CSV slides the photos it passes and nothing else.
  The CSV keeps its row and its place on screen from the press to the drop.
- A drop's indices count the photos. In `[csv, a, b]`, b dropped on the first
  photo reports `[1, 0]` where it reported `[2, 0]`, and a photo dropped on
  the CSV's row reports one place twice. A CSV's row carries no `cdk-drag`
  class, so a list read that took every row without `cdk-drag-disabled` for a
  draggable one now reads the class itself (journeys 111 and 112 in
  [../e2e.md](../e2e.md)).
- The chips are held at AA, and the checkmark at 3:1, in four palettes and
  both states, at rest. No colour changed.
- A dragged photo's slot is an empty dashed outline in
  `--color-primary-text`; the lifted row is edged in the same colour over the
  overlay's shadow, at full strength, inside the list, on the pointer, and
  only up or down.
- The cursors say what a press will do: `grab` on a handle, `grabbing` while a
  photo is held, `default` on a zone that opens nothing. Only a row that can
  move lifts under the pointer.
- The handle is a 40px target, and each arrow's touch target is its own 28px.
  On iOS 15's one line the name is 37px at 375px.
- `contrast:check` scores one pair it exempted.
- A second press on the picked chip leaves it picked, by pointer, Space or
  Enter.
- The import's features are words in `--text-muted`, and at 320 by 568 the
  upload area starts on the first screen: in Karma's pinned face it starts
  366px under the wizard's top in en, 338 in ja and 302 in tc, where en's
  started at 480 and ja's at 434.
- One drag helper serves the upload area's spec and the wizard's smoke.

## What the browser runs found

### Run 1, on 19 November 2026

Emulators only, as Alex, signed in by a session record written into the
page, served from this branch's checkout, the bundle naming
`demo-home-account` alone. The pane emulated 1024 by 768 and painted about
four frames a second, a background page, so every read followed a flush and
finished animations. The upload area was read at 1024px in light, at 375 by
812 in dark, and at 320 by 720 in light. Journey 122 is that run's upload
area ([../e2e.md](../e2e.md)). The audit made before any code, on 18 November,
had walked the same step in light at 1024px and 320px, in a hidden pane, and
judged nothing on hover or real focus.

**What the audit found here, and how it reads now.**

- The handle was 26 by 26, each arrow's 48px touch span reached 10px over
  the other arrow, and the zone kept `cursor: pointer` after a pick. Fixed by
  `fix: the upload area shows an empty slot where a photo will land, and only what moves looks movable`,
  held by
  `test: the dragged photo's preview, its slot, the cursors and the reorder targets`.
  At 1024px the handle read 40 by 40 with the `grab` cursor, the arrows 28 by
  28 with neither touch target over the other arrow, and the zone's cursor
  `default` once files were picked.
- At 320px the import's four features were outlined pills with icons, the
  shape of the Receipts and Statement chips, and with the header and the
  stepper they put the upload area below the first screen. Fixed by
  `fix: the import's feature list reads as words, and the upload area starts on a phone's first screen`,
  held by
  `test: the import's features as a list of words, and the upload area on a 320 x 568 first screen`.
  At 320 by 720 the features read as a plain list, the header's margin 16px,
  and the zone began at y 425; at 375 by 812, in dark, at y 403.

**The drag, at 1024px.** With `[a.png, rows.csv, b.png]` picked, the CSV's
row was no `cdk-drag` and had no handle, the photos were reorderable, and the
hover lift's only rule was
`.file-list:not(.cdk-drop-list-dragging) .file-item.reorderable:hover`. With
b's handle pressed and moved onto a's row by page events, as the spec's
harness makes them, `[csv Δtop, csv transform, a transform]` read
`[0, '', translate3d(0px, 172px, 0px)]`. The lifted row's parent was
`.file-list`, its `transition-property` `border-color, box-shadow`, its
shadow `rgba(0,0,0,.15) 0 4px 12px` at opacity 1, and the cursor `grabbing`
on the handle and the list; the slot was dashed, 1px, in `rgb(63,81,181)`,
its name hidden. The drop gave `[b, csv, a]`. The pane's own drag, by trusted
pointer events, then took `[b, csv, a]` to `[a, csv, b]`, and the previews'
strip followed, `[a.png, b.png]`.

**In four palettes.** The slot's outline read 6.58:1 on the zone in plain and
high contrast and 6.72:1 in dark and dark high contrast, the figures the
dropzone spec reads on the hovered zone, and the lifted row's edge was the
slot's colour. The picked chip's label and its checkmark read 7.22:1 in each
palette, the other chip's label 8.56:1 in the light pair and 14.52:1 in the
dark pair, and the same once Statement was picked. A second press on the
picked chip, Receipts and then Statement, kept it picked: `aria-selected`
stayed `true`, and what the photos are read as did not change.

**At 375 by 812, in dark.** A photo's row was a grid of `40px 129px 40px`,
111px tall, its handle 40 by 40. Mid-drag the lifted row followed the pointer
60px for 60px, inside `.file-list`, laid out as a grid of the same columns,
259 by 111; the CSV's Δtop was 0 with no transform, and photo a stood at
`translate3d(0, 194px, 0)`. The drop gave `[b, csv, a]`.

A sweep of every text node against its composited background, in dark at
1024px, found nothing under its bar on `/import/file`'s first screen, with
files picked, or on the review card.

**Found:** nothing on the upload area or on the chips. The run's five defects
lay on other screens, and
[0194](0194-one-painted-contrast-helper-and-one-focus-hand-off-a-card-is-scored-part-by-part-and-no-page-skips-a-heading-level.md)
and
[0196](0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)
record them.

### Run 2, on 21 November 2026

Emulators only, as Alex, on run 1's data loaded back into them, served from
this branch's checkout at
`docs: the records and references follow the last fixes`, the bundle naming
`demo-home-account` alone. The pane emulated 1024 by 768, and every read
followed a flush and finished animations. Journey 122 was read at 1024px in
light and at 375 by 812 in dark, the theme switched through Settings' Theme
control; journeys 111 and 112, whose pass lines were rewritten from the code
after run 1, were read in the browser.

**The drag, at 1024px, read again, identical.** With
`[a.png, rows.csv, b.png]` picked, the CSV's row was no `cdk-drag` and had no
handle, the handle read 40 by 40 under `grab`, the zone `default`, and the
four arrows 28 by 28 with neither touch target over the other arrow. Held by
page events, `[csv Δtop, csv transform, a transform]` read
`[0, '', 'translate3d(0px, 172px, 0px)']`. The lifted row lay in `.file-list`,
its `transition-property` `border-color, box-shadow`, its shadow
`rgba(0, 0, 0, 0.15) 0px 4px 12px 0px` at opacity 1, and the cursor
`grabbing` on the handle and the list; the slot was dashed, 1px, in
`rgb(63, 81, 181)`, its name hidden. The drop gave `[b, csv, a]`, and the
pane's own drag took it back to `[a, csv, b]`, the previews' strip
following, `[a.png, b.png]`.

**The hover lift.** The journey's read of the stylesheet returned no lift
rule at all, a fault of the read and not of the app. In Chrome 156 every
style rule carries a `cssRules` list, empty, for nesting, and the read kept a
rule only where it had no such list, so every plain rule was dropped. Read
with each rule kept beside the rules nested in it, the lift had one rule,
`.file-list:not(.cdk-drop-list-dragging) .file-item.reorderable:hover`, its
`box-shadow` `var(--shadow-sm)`, the rule run 1 recorded.

**In four palettes.** The slot's outline was read against the first opaque
fill behind the list, `#f5f5f5` in light and `#121212` in dark, which are
`--surface-background`: 6.30:1 in plain and high contrast and 11.6:1 in dark
and dark high contrast, the figures this record gives at rest, with the
lifted row's edge the slot's colour in each. Run 1's 6.58:1 and 6.72:1, the
figures this record gives for the hovered zone, were read against another
fill; both readings clear the 3:1 a graphic needs. The chips read again,
identical in all four palettes: the picked label and its checkmark 7.22:1,
the other label 8.56:1 in light and 14.52:1 in dark. A real click on
Statement swapped the states and the figures with them, and a second real
click on the picked Statement, then on Receipts once picked again, kept each
picked: `aria-selected` stayed `true`, and `imageKind` read `statement`,
then `receipt`.

**At 375 by 812, in dark, read again, identical.** The zone's top stood at
403, a photo's row was a grid of `40px 129px 40px`, 111px tall, its handle
40 by 40, and nothing scrolled sideways. Mid-drag the lifted row followed the
pointer 60px for 60px, inside `.file-list`, laid out as a grid of the row's
columns, 259 by 111; the CSV's Δtop was 0 with no transform, and photo a
stood at `translate3d(0px, 194px, 0px)`. The drop gave `[b, csv, a]`.

**Journeys 111 and 112.** Journey 111's first step, a real Tab from the
stepper's header, put keyboard focus on Browse. The zone had no role, tab
stop or name, and its ring read `solid`, 2px at a 2px offset; Browse's own
outline and the focus indicator each Material button draws inside itself
since
[0196](0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)
both read `none`, so one ring showed; Browse read *Browse Files*, its glyph
hidden, described by *Supports CSV, PDF, images, and JSON backups*. Journey
112, a CSV picked and then two photos, read the badges `[null, '1', '2']`,
the arrows `[[], [true, false], [false, true]]` and `drag`
`[[false, false], [true, true], [true, true]]`, as written. The pane's own
drag of photo 2's handle onto photo 1's row logged one drop, `[1, 0]`,
places among the photos, and left
`['e2e-112.csv', 'e2e-112-b.png', 'e2e-112-a.png']`, the names renumbered
from *Move photo 1 (e2e-112-b.png) up* to *Remove photo 2 (e2e-112-a.png)*,
and nothing of the drag behind: no preview or slot, and every row's
transform `none`.

**Found:** nothing on the upload area or on the chips, and journeys 111 and
112 held as written. The one wrong reading here was journey 122's own
stylesheet read, which in Chrome 156 drops every plain rule.

## Departures from the issues

- **No sort strategy.** #543 proposes a sort that skips rows that are no
  photo. CDK keeps its strategy private and has no public hook; the CSV is no
  drag item instead, which asks nothing of CDK it does not offer.
- **The CSV is read by its transform as well as its place.** The acceptance
  asks for its position mid-drag; the spec reads both, and a second drag onto
  the CSV's own row reads that nothing moves.
- **The unselected chip is read on the page.** #543 asks for each label
  against its painted fill. The unselected chip has none, its body clear, so
  its label is read on the page, and the case checks that it stands there.
  The case also reads the checkmark at 3:1 and both states, at rest.
- **Axe still does not score the chips.** The issue names axe's `incomplete`;
  its cause is found and recorded, and the painted case is the guard.
- **The upload area's look while a photo moves is no part of #543.** The
  slot, the lifted row, the cursors, the lift and the targets came with it,
  and building them added four details nobody had asked for: no lift while a
  photo is held, no 0.95 opacity on the lifted row, a slot that keeps the
  row's 1px edge, and a case for the axis lock.
- **The second press and the feature list are no part of #543.** Both are
  older than this branch, and both are on its step.

## Things that only became apparent while building

- 0187 looked for a way to steer CDK's sort past the CSV and found none. The
  way out was not in the sort: the CSV slid only because it was one of the
  list's items, disabled or not.
- The CSV's place could not fail the first draft of the case. The rows CDK
  slides aside glide for 200ms, and a rect read right after CDK sets a
  transform reads where the glide starts: without a wait, a check that photo
  a is drawn lower failed with
  `a, drawn lower where it slid: Expected 0 to be greater than 0`. The
  pointer is now held 250ms before the reading, and the CSV's offset fails on
  its own under the mutation.
- Under that mutation the drop still came out right. CDK reported `(2, 0)`,
  places in the whole list, and `onFileDrop`'s `moveItemInArray` over the two
  photos clamps the 2 to 1, so only the mid-drag reads fail. And no plausible
  mutation fails a drop case with equal photo indices; the real drag onto the
  CSV's row carries that proof.
- Axe's overlap is the focus indicator span inside each chip's label. With it
  hidden, axe scores both labels (7.22:1 and 14.51:1 in dark); with the
  chip's state-layer overlay or its graphic hidden, it still reports the
  overlap.
- The chip's host paints nothing; its fill is painted by an element between
  the host and the label, which `paintedBackground` finds.
- The click that flips the chips focuses one, and its state layer then lies
  over the fill at 0.12 opacity, with no fade under the specs' motion-off
  provider:
  `plain, statement picked: nothing lies over the selected chip's fill: Expected '0.12' to be '0'.`
  Hence the reading at rest.
- The second press was met while the chips were being measured, by reading
  Material's chip: a press focuses the chip and then toggles it, and the
  listbox reports `undefined` when none is selected. Material reads a key's
  legacy `keyCode`, which a constructed keyboard event leaves at 0, so the
  cases set it and check that the chip took the key itself.
- While `transition: all` stood, a sideways move could not show the axis
  lock: the transition held the lifted row at its start. The lock is proved
  only now the transition is gone.
- The lift's exclusion was first argued from the slot, which a real mouse was
  thought to hover. CDK gives the slot no pointer; the reason that holds is
  the rows that glide under the held pointer.
- The handle's `:active` cursor is read from the CSSOM, and a selector list
  split on its commas breaks inside `:is()` and `:not()`. With a probe rule
  `:is(.tmp-none, .drag-handle):active { cursor: copy }` in the page, the
  pressed handle read `['grabbing']` under that split and
  `['copy', 'grabbing']` under `selectorsOf`, which `painted-contrast.ts` now
  exports and the spec uses.
- `contrast:check` held `--color-primary-text` on `--surface-background`
  exempt, because nothing painted it straight on the page. The slot does,
  under a finger, so the pair is scored at 3:1. The move first left it in
  both lists, and the gate's self-test now fails a pair that is exempt and
  scored at once.
- The feature chips' height came from Material's chip set, which wraps inside
  its own element, so a `flex-wrap: nowrap` on the set had never held; at a
  288px page en's four stood one 32px row each. The header's 16px margin buys
  en 8px more, 374px to 366 against the 384 the zone may start at, for CI,
  whose face is DejaVu Sans rather than the Verdana the case pins.

## Known gaps

### The drag

- **A photo can still overlap the CSV until the drop.** CDK slides each
  photo a drag passes by one offset, worked from the photos' own rows, and
  knows nothing of the CSV between them. When two photos differ in height, as
  when a long name wraps, or when the pointer jumps past several rows in one
  move, a photo can be drawn over the still CSV until the drop. The CSV itself
  never moves. A sort that measured the rows between items would close it;
  CDK keeps its sort private.
- **The lifted row's badge is unread.** CDK shows the lifted row as a
  `popover` in the top layer, and the browser's own rule for a popover gives
  it `overflow: auto`, which may clip the photo's number, drawn 6px outside
  the row. This was seen in reading CDK, not measured; a run that reads the
  badge on a lifted row would settle it.
- **No drag was read on a device.** The run's drags were page events and the
  pane's own pointer events. A drag on an iPhone simulator would read CDK's
  touch path.
- **iOS 15's one line leaves the name 37px at 375px** (*On iOS 15 the handle
  stays 40px*). An `@supports not (container-type: inline-size)` rule that
  gave that WebView the 26px handle would widen it to 51px, with a target
  under the floor.
- **A zone that holds files still changes its fill under the pointer.**
  `.dropzone:hover` repaints it to `--surface-hover` though a click on it
  opens nothing; only its cursor changed. Scoping the hover fill to the empty
  zone, with the multi-image hint's own hovered mix beside it, would close
  it.
- **The lift was read from its rule.** Under the pane's own drag the run read
  the order the drop left; the lift and the cursors it read from the rule and
  the computed style. A run that watched a row pass under a held photo would
  see the exclusion; the dropzone spec reads it through the CSSOM.

### The chips

- **Axe still leaves the chips unscored.** The painted case is their only
  contrast reading. A sweep that hid the focus indicator span for the
  contrast rule alone would score them, on a chip without its span.
- **A focused chip is not pinned.** Its state layer, the label's colour at
  0.12 over the fill, brings the picked label from 7.22:1 to about 6.0:1 in
  light and 5.4:1 in dark, still AA, worked by hand. A case that read the
  focused chip with the layer laid over its fill would close it.
- **The chips keep Material's own focus look.**
  [0196](0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)
  draws the focus indicator inside every kind of button and leaves chips out.

### The rest of 0187's upload area

- **Three of its gaps stand as 0187 records them:** a pick made through
  Browse drops focus to the page, a tap's remove moves focus on WebKit, and
  no gate reads a hidden file input inside the element whose click asks it.
  Its gap on the focus helpers is
  [0194](0194-one-painted-contrast-helper-and-one-focus-hand-off-a-card-is-scored-part-by-part-and-no-page-skips-a-heading-level.md)'s.
