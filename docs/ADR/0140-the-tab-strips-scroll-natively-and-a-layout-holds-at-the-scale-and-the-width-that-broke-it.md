# 140. The tab strips scroll natively, and a layout holds at the scale and the width that broke it

**Status:** Accepted, implemented · **Date:** 2026-09-18 · **Issues:** #450, #451, #452, #453

Reference documentation lives in [../ui-overflow.md](../ui-overflow.md).

## Context

On 2026-09-17 every route was walked at 320, 375, 768 and 1280 px, in both
themes, at the default font scale and at the account's own Extra-large one.
Four issues came out of it, and they share a single shape: a rule that was
written to solve an overflow, and that stopped being true — or was never true
— without anything failing.

**Eleven declarations were never parsed at all.** `grep -rnE
"minmax\([^()]*minmax\(" src --include='*.scss'` listed eleven
`grid-template-columns: repeat(N, minmax(0, minmax(0, 1fr)))` rules across six
stylesheets. `minmax()` cannot be the max of another `minmax()`, so the
browser drops the whole declaration at parse time and the cascade falls back
to whatever preceded it — usually the mobile single-column default. Six pages
had therefore been rendering one column on tablet and desktop. #450 counted
ten; the eleventh (`monthly-comparison.component.scss:136`) was found by the
grep. The shape dates from `5531ec3` (2026-08-03), *"fix(ui): stop grid tracks
refusing to shrink below their content"* — the commit that fixed
[G2](../ui-overflow.md) by wrapping values that had already been wrapped.
Two of the eleven were base rules with no narrower rule underneath them, so
those two grids had no columns declared at all.

**Material's tab strips do not scroll.** `MatTabHeader` clips its label
container and pages it with a `transform`, driven only by the chevron buttons
— which carry `touch-action: none` and own the only pointer listeners. A
finger on the titles, or a trackpad swipe, moves nothing (#453), and the third
budgets tab sat behind a chevron at phone width (#451). Two more mechanics
mattered: the header's `_setTabFocus` writes `scrollLeft = 0` after *every*
change of focus index — arrow key or click — and the key manager's
`change` subscription emits the group's `focusChange` synchronously *before*
that write; and `selectedIndexChange` is deliberately silent on the first
pass, so a `?tab=` deep link landing on a later tab has nothing to scroll it
in. The chevrons themselves are always in the DOM, hidden by a class the
header applies when it decides pagination is needed.

**The account's font scale is a real environment, not a hypothetical.** At
Extra-large (1.3) the bottom-nav labels touched, the period picker dropped its
calendar button onto a second row, a four-digit amount wrapped under its
description, and a model name in the AI settings ended in an ellipsis (#452).
A floor written in `rem` is the recurring cause: it grows with the very scale
it exists to resist, so at 1.3 a `7rem` description floor left no room on the
row for the amount beside it.

## Decision

**A tab strip scrolls like every other strip in the app, a grammar the
browser silently discards is caught by a source gate, and a floor stated in px
stays in px.**

### The grammar gate

`scripts/check-grid-tracks.mjs`, in the shape `check-direction.mjs` and
`check-truncation.mjs` already share: a docblock naming the defect, its own
copy of `maskComments` so the script stays runnable standalone, a
`--self-test` with a must-hit list (the nested shape, the nested shape after a
`@media` line) and a must-not-hit list (`repeat(3, minmax(0, 1fr))`,
`repeat(auto-fill, minmax(100px, 1fr))`, the nested shape inside a `//` and a
`/* */` comment), and a live scan of `src/**/*.scss` that exits 1 listing
`file:line` and the offending text. `npm run grid:check` runs the self-test
then the scan, and CI runs it as a step between the truncation check and the
direction check.

A source scan, not a spec, for the reason G3's scanner gives: it catches the
rule added next month, which no fixed set of component tests can. All eleven
declarations were repaired to `repeat(N, minmax(0, 1fr))`.

### The strips

`TabStripScrollDirective` (`mat-tab-group[appTabStripScroll]`) does three
things from its constructor, and one global rule in `src/styles.scss` gives
the container a real scroller:

```scss
mat-tab-group[appTabStripScroll] .mat-mdc-tab-label-container {
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
  padding-block-end: 12px;
}
```

The `padding-block-end` draws the bar in a gutter under the labels, so it no
longer sits on top of the active tab's underline. The divider each page used
to draw on the header moved onto `.mat-mdc-tab-list` for the same reason —
the header sits above that gutter — so the active tab's underline rests
directly on the line and the scrollbar sits below it.

The directive sets `disablePagination = true` before the group's first check,
so the header never measures itself for pagination and the chevrons' class is
never applied. It reveals the landing tab from `afterNextRender`, because
`selectedIndexChange` does not fire on the first pass. And it subscribes to
`selectedIndexChange` directly and to `focusChange` *through a microtask* —
the microtask is what puts the reveal after `_setTabFocus`'s `scrollLeft = 0`,
which would otherwise undo it on every click and every arrow key.
`disablePagination` alone would not do: it removes the chevrons and leaves
`overflow: hidden`, which makes the later tabs unreachable by any means at
all. Material's shorthand leaves `overflow-y: hidden` standing, so only the
inline axis becomes scrollable and no vertical scroll container appears where
[G4](../ui-overflow.md) would have to account for one. The scrollbar stays —
it is the only thing telling the reader there is more off the side, the same
call the category strip and the period selector already make.

One global rule rather than a copy in each page's stylesheet, keyed on the
directive's own attribute: a tab group that has not opted in keeps Material's
behaviour unchanged.

### A floor for a px budget is written in px

`transaction-row.component.scss` divides a stated 243 px budget between its
description and its amount. The description's floor is now `112px`, not
`7rem`: a budget in px divided by a floor in rem is an arithmetic that stops
holding the moment the scale moves, and at 1.3 it left the four-digit amount
nowhere to go. The comment above the rule says so, because the next person to
round a number up will reach for `rem` again.

### The rest of the walk

- **The nav item gets a gutter.** `appFitText` fits a label to its content
  box, so at a large scale two neighbouring labels sit flush; `padding-inline:
  4px` on `.nav-item` is what holds them apart. `.nav-item` in the sidebar
  also takes `width: auto`, because Material's own `.mat-mdc-list-item` sets
  `width: 100%` and the row was sizing to the nav *plus* its margins.
- **The period toggle shrinks before the picker leaves the row.** `flex: 1 1
  0; min-width: 0; max-width: max-content`, carried on `.period-toggle-scroller`
  — the wrapper the pill scrolls inside, not the pill itself. The zero basis
  is what decides line collection (G1) — a content basis breaks the line
  before anything shrinks — and `max-content` caps only the *grow* phase, so
  the scroller takes up slack beside the picker on a narrow row and never
  balloons past its own labels on a wide one. Without the cap it measured
  836 px on a 900 px desktop row. The picker beside it is `flex-shrink: 0`, and both take
  `align-self: flex-start` so the taller group and the 40 px button share a
  top edge rather than reading as two rows.
- **A select value wraps rather than truncating.** Material's own trigger CSS
  sets `nowrap` and an ellipsis on the value box and its text span.
  `truncation:check` scans this codebase's stylesheets, so a vendor rule
  reachable only through `::ng-deep` is invisible to it; `.model-field`
  overrides both with `white-space: normal; overflow-wrap: anywhere`.
- **A hit box is met by its own box, or by an overhang.** The budget card's
  menu button grew to `w-10 h-10` — its ink was the target. The desktop
  table's three inline controls keep their 32 px (and the receipt icon its
  18 px) glyph box and reach 40 px through the `::after` overhang idiom
  [ADR 0110](0110-the-probe-measures-the-card-at-phone-width-and-in-both-directions.md)
  established, with logical insets and clamped `top`/`bottom` so it never
  shrinks a control that is already big enough.
- **The avatar falls back.** Both the header and the settings card now have an
  `(error)` handler behind a `linkedSignal` sourced on the photo URL, so a
  broken image shows the placeholder and a sign-in as a different account
  resets the failure rather than inheriting it.
- **The table's floor is 704 px, not 720.** 768 px, the viewport that first
  shows the desktop table, less the shell's 24 px of padding on each side is
  720 px of content — but wherever the vertical scrollbar on
  `.main-container` is classic rather than overlaid it takes up to 16 px more.
  704 leaves room for it. (The walk measured 712, which is 720 less the
  embedded pane's own 8 px scrollbar; 704 covers the classic 16 too.)
- **An error message wraps anywhere.** The import history's error list took
  `overflow-wrap: anywhere`, as did its title and subtitle: a share-sheet
  attachment id and a thrown message have no space to break on.

## What was rejected

- **Icon-only tabs at phone width.** It fits the strip by deleting the labels,
  and a tab bar whose destinations are five unlabelled glyphs is a worse
  answer to "I cannot reach the third tab" than a strip that scrolls.
- **`mat-tab-nav-bar` instead of `mat-tab-group`.** It is a router-driven
  component; swapping to it would put the tab state in the URL for both pages
  and rewrite two features to fix a scroll gesture.
- **Two-line nav labels.** It buys the space at the cost of the bar's height
  on exactly the screens that have least of it, and `appFitText` already
  solves the label; the gutter was the missing part.
- **A global override of Material's select trigger.** Every select in the app
  would wrap, including the ones whose single-line trigger is load-bearing in
  a dense row. The override sits on the one field whose values are long.
- **stylelint for the grid grammar.** A whole linter and its configuration to
  express one rule that a small script with a self-test expresses directly, in
  the shape three other gates in this repo already share.
- **`text-overflow: clip` for the select value.** `truncation:check` scans for
  the `text-overflow` property itself, so a "harmless" value is still a
  failure. A wrap is expressed by `white-space: normal` alone.
- **A content-sized flex basis for the period toggle.** `flex: 1 1 auto`
  reads as the same fix and is not: line collection measures the item at its
  content size and breaks the row before any shrinking happens (G1).

## Consequences

- Eleven declarations repaired across six stylesheets; `npm run grid:check`
  gates the shape, in CI between truncation and direction.
- A new shared directive and one global rule; both pages opted in, and two
  stale comments that described Material's pagination went with them.
- A grid case per repaired stylesheet, a spec for the directive, and new cases
  on the budget card, the transaction list and the import history. Ten of
  those live in new `*.overflow.spec.ts` files, four of them the first layout
  specs the bottom nav, the sidebar, the header and the period selector have
  ever had. The full enforcement list is in
  [docs/ui-overflow.md](../ui-overflow.md).
- `docs/e2e.md` gains journeys 29–33: the grids at tablet and desktop, the
  strips scrolling, the layouts at the account's own scale, the papercuts, and
  a duplicate check reading the account rather than the cache.

## Departures from the issues

- **"All tabs visible" became "reachable with no chevrons".** #451's P2 and
  #452's P4 both ask for every tab on screen. Five tabs at a legible label
  width do not fit 375 px, and shrinking them until they do is the truncation
  this app does not do ([ADR 0010](0010-nothing-truncates.md)). They close on
  the strip rule instead ([ADR 0012](0012-a-strip-scrolls-rather-than-growing-the-row.md)):
  a strip that scrolls by finger, trackpad and keyboard, with no chevrons in
  the way and the selected tab always brought into view.
- **#452's P5 asks that `truncation:check` fail on the Material fixture; it
  does not.** The scanner reads this codebase's own source, which is what
  makes it catch the site added next month, and it would have to render
  Material's stylesheet to see a vendor rule. The guard for that case is the
  overflow spec, which measures the rendered value.
- **The `min-width: 768px` and 1024 px grid rules are not observable in
  Karma.** The headless window here measures 756 px — `matchMedia("(min-width:
  768px)")` is false — so three of the six grid specs cannot read the column
  count they were written for. They pin the repaired *declaration* through the
  CSSOM instead: an invalid declaration is dropped at parse time, so the
  repaired value serialises as `repeat(N, minmax(0px, 1fr))` and the nested
  one as an empty string. That the rendered columns actually appear is proved
  by the browser run at 768 and 1280 px, and by `grid:check` for the shape.

## Things that only became apparent while building

- **Two of the three inline controls already had a 48 px target.** Material's
  `mat-icon-button` ships its own `.mat-mdc-button-touch-target` span,
  `display: block` and 48 px square, which the browser run read off the DOM on
  the note and action buttons. Their `::after` overhang is belt-and-braces;
  the real gain is the receipt icon, an 18 px glyph on a plain `<button>` with
  no touch target of its own.
- **Tailwind's `truncate` utility passes the truncation gate.** The budget
  card's name carried it. `check-truncation.mjs` scans for the
  `text-overflow` property in stylesheets and a utility class in a template is
  not that — a G3 gap the gate does not close.
- **`check-truncation.mjs` has no self-test.** Every other `*:check` script in
  `scripts/` has one — the oldest source gate does not, so nothing proves its
  comment masking still works.
- **A constructed `KeyboardEvent` carries `keyCode: 0`**, and Material's
  keydown listener sits on the label container rather than the header element.
  A run driving the strips by key has to set `keyCode` explicitly and dispatch
  from the focused tab, or the key reaches nothing and reads as a strip that
  ignores the keyboard.

## Known gaps

- **The reveal can scroll the page.** `scrollIntoView({ block: 'nearest' })`
  will scroll the nearest *vertical* ancestor too, so a `?tab=` deep link on a
  short viewport can move the page under the reader. A horizontal-only reveal
  would be safer.
- **The directive silently owns `disablePagination`.** A page that writes
  `[disablePagination]="false"` on an opted-in group would fight it, and
  nothing says so but a clause in the doc comment.
- **The kept scrollbar costs height where scrollbars are classic.** `thin` is
  not `none` (G4), and on those platforms the strip is a little taller than it
  was.
- **The Japanese and Traditional Chinese tab labels at 1.3 are unmeasured.**
  The strips scroll, so nothing is unreachable, but how much of the strip a
  wider catalog pushes off the edge was not read.
- Both truncation gaps above, and the missing self-test.
