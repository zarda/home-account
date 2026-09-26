# Overflow: what the app does when content does not fit

The rule is that **nothing truncates**. Text reflows onto more lines; a value
that has to stay on one line scales down to a 12px floor and only then wraps; a
strip of discrete chips scrolls. No ellipsis, nothing clipped away, no control
pushed out of reach.

Why it is that rule rather than an ellipsis, and what was rejected on the way,
is in [ADR 0010](ADR/0010-nothing-truncates.md). Why a strip may scroll instead
of reflowing is in [ADR 0012](ADR/0012-a-strip-scrolls-rather-than-growing-the-row.md),
and why a Material tab strip is one of those strips — along with what a walk of
every route at the account's own font scale found — is in
[ADR 0140](ADR/0140-the-tab-strips-scroll-natively-and-a-layout-holds-at-the-scale-and-the-width-that-broke-it.md).
This document is the part you need when adding a screen.

## The seven invariants

Each is written so it can be checked, because a rule nobody can check is a rule
that quietly stops being true.

---

### G1 — Every flex or grid item holding user data declares its minimum

`min-width: auto` is the default, and it floors an item at its own min-content
size — a promise the container may not be able to keep. The item then refuses
to shrink and pushes its neighbour out of the box instead, which in this app is
usually a button.

Say which one it is:

```scss
.details { flex: 1; min-width: 0; }        // I may shrink to nothing; I reflow
.amount  { flex-shrink: 0; max-width: 50%; } // I keep my content; cap me instead
```

**Check:** every `flex: 1` / `flex: 1 1 …` block contains a `min-width` or a
`max-width`.

**Corollary.** In any row with an unshrinkable trailing control, the sum of
everything that will not yield — fixed widths, gaps, caps — must be under the
narrowest container the row ships in. Write the arithmetic in a comment; see
the top of `transaction-row.component.scss`, which shows where its 112px floor
comes from.

**Scale.** That arithmetic is in px, so the floor it produces has to be in px
too. A floor in `rem` grows with the account's own font scale — the very
thing it exists to resist — so at Extra-large (1.3) a `7rem` description floor
consumed a 243px budget that had not moved, and the four-digit amount beside
it wrapped. Mixing the two units is the defect; either budget and floor are
both scale-relative, or neither is.

**In a wrapping row, write `flex: 1 1 0`, not `flex: 1 1 auto`.** Declaring the
minimum is not enough on its own, and this is the part that is easy to get
wrong because the rule above looks satisfied.

Flex collects items into lines using each item's *hypothetical main size* —
its basis clamped by min and max — and it does that **before** any growing or
shrinking is considered. `flex-basis: auto` resolves to the item's content
size, so a column holding a long description is measured at the full width of
that description, the line breaks early, and the item to its *left* is pushed
onto a line of its own. Shrinking later cannot undo a line break already made.

```scss
.details { flex: 1 1 auto; min-width: 112px; }  // measured at max-content — breaks the line
.details { flex: 1 1 0;    min-width: 112px; }  // measured at 112px, then grows into the rest
```

The floor is what the zero basis is clamped up to, so it is still the only
number line-collection sees. `transaction-row.component.scss` shipped the first
of these and put its category tile alone on a line whenever a description ran
long.

**A `max-width` cap and a zero basis do different jobs, and a growing item may
need both.** The zero basis decides where the line breaks; `max-width` binds
only during the *grow* phase, after the lines are already collected. An item
with `flex-grow: 1` and a zero basis will otherwise expand into all the free
space a wide row has — the period selector's toggle group reached 836px on a
900px row — so where an item should take up slack on a narrow row but never
exceed its own content on a wide one, cap it with `max-width: max-content`.

**A `mat-button-toggle-group`'s own segments need the same declaration, and
a label that cannot shrink further needs somewhere else to go.** Material
renders each `mat-button-toggle` at its own min-content width by default, so
a group with a fixed number of labelled options does not share its row
evenly — the widest label's segment crowds out the others, or the whole
group overflows its container. `mat-button-toggle { flex: 1; min-width: 0 }`
fixes the distribution the ordinary way, on both groups this app currently
has: the theme toggle (`profile-settings.component.scss`) and the
accessibility settings' font-size toggle
(`accessibility-settings.component.scss`).

Equal distribution alone still fails once the account's own font scale
makes a label wider than an even share can hold — three segments cannot
each shrink a checkmark and a whole word past a point where the word stops
being legible. Both groups answer this with a container query of their own
(`container: … / inline-size` on the row, not the viewport, because a
component does not know how wide its own container will be at the point it
renders): below 420px, the option's label wraps onto a second line instead
of overflowing. Hiding the checkmark's wrapper does not release the
inline space Material reserves for it on the checked segment, so both
groups also zero that segment's `padding-inline-start`
(`accessibility-settings.component.scss`, `profile-settings.component.scss`);
without it the selected option carries an empty strip its siblings do not.
`overflow-wrap: anywhere` is part of the same rule for the one label with no
space to wrap on at all.

---

### G2 — `1fr` is never written bare, and `minmax(0, 1fr)` is not always the fix

`repeat(N, 1fr)` means `repeat(N, minmax(auto, 1fr))`, and that `auto` floors
each track at its min-content size. Same defect as G1, one layout mode over.

Which fix depends on what is in the track:

| Track holds | Use |
|---|---|
| text — form fields, cards, stat tiles | `repeat(N, minmax(0, 1fr))` |
| a fixed-size child — icon buttons, swatches | `repeat(auto-fill, minmax(<child>, 1fr))` |

Getting that backwards makes things worse, and the app has a worked example.
`.icons-grid` in the category dialog is five 44px buttons: min-content is
5×44 + 4×8 = 252px, and the dialog is 288px wide on a 320px screen before its
own padding. `minmax(0, 1fr)` gives 41.6px tracks and clips every button.
`auto-fill` drops a column instead, and the button keeps its touch target.

**And `minmax()` cannot be the max of another `minmax()`.**
`repeat(3, minmax(0, minmax(0, 1fr)))` is not a stricter version of the fix,
it is invalid grammar: the browser drops the whole declaration at parse time
and the cascade falls back to whatever came before it — usually the mobile
single-column default. Nothing errors, nothing logs, and the page simply
renders one column on the widths the rule existed for. Eleven of these shipped
at once, written by the commit that first applied the rule above, and six
pages had been single-column on tablet and desktop ever since. Two of them
were base rules with nothing underneath, so those grids declared no columns at
all.

**Check:**

```bash
npm run grid:check
```

`scripts/check-grid-tracks.mjs` scans `src/**/*.scss` for **both** halves of the
rule, masked for comments, with a `--self-test` proving it hits the nested form
(and the nested form under a `@media` line), hits a bare `1fr` written as a
single track, inside a `repeat()`, beside a fixed column and beside a floored
one, and misses `repeat(3, minmax(0, 1fr))`, `repeat(auto-fill, minmax(100px,
1fr))`, `var(--frame-width)`, and either shape inside a comment. CI runs it
between the truncation check and the direction check.

The bare-`1fr` half strips every balanced `minmax(…)` out of the value and then
looks for a surviving `fr`, rather than running the shell grep this rule shipped
with:

```bash
grep -rn "grid-template-columns" src --include='*.scss' | grep "1fr" | grep -v "minmax("
```

That grep judges a whole line, so `minmax(0, 2fr) 1fr` — a repaired track beside
an unrepaired one, which is how a half-done sweep leaves a file — reads as clean
to it. It comes back empty today either way.

---

### G3 — Nothing truncates

No `text-overflow: ellipsis`. Text wraps, with `overflow-wrap: anywhere` where
the content may contain an unbreakable run such as a pasted URL. A value that
must not break carries `appFitText` and scales to 12px — `--text-xs`, the floor
the type scale already declares — and wraps only past that.

**`anywhere`, not `break-word`.** Only `anywhere` reduces an element's
min-content size. `break-word` leaves the element still refusing to shrink,
still pushing its neighbours out, and looking like a fix.

**The one shape where `break-word` is the right answer: a *sentence* whose box
is already free to shrink.** `anywhere` breaks greedily between characters, so
every line ends mid-word — unreadable for prose, which is what the currency
offer chip's label is (`.currency-offer .extra-text` in
`transaction-preview-table.component.scss`). Where the box can already shrink
on its own — `min-width: 0` on every level between the text and its container —
the min-content argument above does not apply, and `break-word` is what keeps
word boundaries while still breaking the one word too long to fit a line.
`normal` is the trap in that shape: the box shrinks, the long word does not
break, and the ink paints straight through the shrunk box and out of the card.
That overflow is invisible wherever the word happens to fit, so it surfaces on
whichever machine has the wider font fallback rather than on the one that
shipped it. A spec can pin the wider face itself: see *Karma serves no fonts*
in `docs/testing.md`.

**Four corollaries worth knowing, because between them they made five rules in
this app dead code for a long time:**

- `text-overflow` has no effect on a flex or grid container. A rule that sets
  both `display: flex` and `text-overflow` does nothing.
- Nor does it apply to a plain **inline** box, and neither do `overflow` or
  `max-width`. A `<span>` is inline unless something blockified it — being a
  flex item does, being projected into a Material button's own
  `.mdc-button__label` does not. Give it `display: inline-block` first.
- A bare text node inside a flex container is an *anonymous flex item*. No
  selector reaches it, and `min-width: 0` on the parent does not apply to it.
  If you need to style the text, wrap it in an element.
- A Material button projects every `mat-icon` in its content through its
  **leading** slot, ahead of `.mdc-button__label`, unless that icon carries
  `iconPositionEnd`. The order the template writes them in does not decide
  it, and no margin moves it: Material's own leading- and trailing-icon rules
  are (0,3,0) and beat a component stylesheet's (0,2,0), so a margin written
  for the position the icon is not in is dead twice over. The category chip's
  caret carried one until
  [ADR 0122](ADR/0122-the-chips-caret-trails-the-name-and-drops-at-phone-width.md).

**A dead truncation is not a harmless one.** It is a claim, in the stylesheet,
that the case is handled, and a reviewer reads it as one. `.category-name` in
`category-suggestion.component.scss` carried `overflow`, `text-overflow` and a
120px `max-width` on an inline box, so none of the four declarations did
anything and the chip quietly sized itself to its label — about 170px past the
row holding it. Nobody looked, because the stylesheet said it was capped.

**And a live one hides in the opposite way.** `insight-transaction-list`
truncated for real, on a plain span in a block context, and survived the first
sweep *because* it worked: a rule that clips is easy to spot in a screenshot,
and a rule that truncates cleanly reads as a decision somebody made.

**Check:**

```bash
npm run truncation:check
```

`scripts/check-truncation.mjs`, which is the grep this section used to ask you
to run by hand, masked for comments so the notes explaining a deleted rule do
not trip it. It reads the source rather than the rendered page, so it catches
the site added next month as well as the ones found so far — which no fixed set
of component tests can. What it cannot see is whether the replacement works;
`shared/truncation-guard.spec.ts` measures that. CI runs it on every push and
pull request, between the composite-index check and the unit tests.

---

### G4 — Nothing is clipped that cannot be reached another way

Every `overflow: hidden` is paired with either a scroll affordance or a visible
indicator, and no interactive element sits in the clipped region.

- `overflow-x: hidden` does not prevent overflow, it destroys the evidence.
- **It also does more than you asked.** When one axis is not `visible`, the
  other computes from `visible` to `auto` — so `overflow-x: hidden` silently
  makes the box a *vertical* scroll container.
- Never hide a scrollbar. It is the only thing telling the reader there is more
  off the edge.
- An overflow indicator (`+3`, a fade) gets `flex-shrink: 0`. It has to outlive
  the things it counts, or a visible truncation becomes a silent one.

**A control is not reachable if its target is under 40px, and the ink is not
the target.** Where the glyph can grow, grow it — the budget card's menu
button went from `w-7` to `w-10`. Where it cannot, because the row or the
table cell it sits in is built around a 32px (or an 18px) glyph, the hit box
overhangs the ink instead, in the form
[ADR 0110](ADR/0110-the-probe-measures-the-card-at-phone-width-and-in-both-directions.md)
settled on:

```scss
.note-button {
  position: relative;
  &::after {
    content: '';
    position: absolute;
    top: min(0px, calc((100% - 40px) / 2));
    bottom: min(0px, calc((100% - 40px) / 2));
    inset-inline: min(0px, calc((100% - 40px) / 2));
  }
}
```

`min(0px, …)` is what makes it safe to apply without measuring: a control
already 40px or wider gets an overhang of zero rather than a negative inset
that would shrink its target. The insets are logical, so two adjacent
overhangs do not land on top of each other under `dir="rtl"` — see
[rtl.md](rtl.md) for the pair whose physical spelling would have.

Two things to know before adding one. Material's `mat-icon-button` already
ships a 48px `.mat-mdc-button-touch-target` span of its own, so an overhang
on one of those is belt-and-braces rather than the fix. A plain `<button>`
wrapped around a bare `mat-icon` has no target at all, and measures the
icon's own em box — which is where this earns its keep.

**Check:** no `scrollbar-width: none` or `::-webkit-scrollbar { display: none }`
on a scrolling element.

**Check, specific to this app:** no `overflow-x: auto` on any **ancestor** of
`app-transaction-list`. `findScrollParent` walks up for the first vertically
scrolling ancestor and adopts it as the sliding window's paging root; the rule
above means an `overflow-x` up there becomes one, and paging stops with no
error. `transaction-overflow.smoke.spec.ts` asserts the root is still
`.main-container`.

---

### G5 — Screen-sized boxes use `dvh` and inset by `--safe-*`

iOS resolves `vh` against the *largest* viewport — the one with Safari's
toolbars collapsed — so a `vh`-sized box is taller than what is on screen
whenever they are showing.

```scss
min-height: 100vh; // fallback where dvh is unsupported
min-height: 100dvh;
```

Every full-bleed or `position: fixed` box pads by `max(<gutter>, var(--safe-…))`
on each edge it touches. **The larger, never the sum** — a gutter already wider
than the inset costs nothing, and adding them indents the content twice. Exactly
one element owns each inset.

Read the **variables**, never `env(safe-area-inset-*)` directly. That
indirection is what makes the behaviour testable: `env()` cannot be overridden
from a stylesheet, a custom property can, and these insets are 0px on every
machine CI runs on. `safe-area.spec.ts` depends on it.

**Check:** every `[0-9]vh` is immediately followed by a `dvh` line; every
`position: fixed` block references a `--safe-*` or is nested inside one that
does.

---

### G6 — A trailing control group travels as one flex item

`margin-left: auto` right-aligns **only the line its own item is on**. In a
wrapping row, two trailing items — a value and the control beside it — can end
up on different lines, and the one without the margin lands at the row's *left*
edge.

```html
<div class="row-trailing">   <!-- flex-shrink: 0; margin-left: auto -->
  <div class="row-amount">…</div>
  <div class="row-actions"><ng-content /></div>
</div>
```

Wrap them, put the auto margin on the wrapper, and they wrap together or not at
all. The transaction row shipped them as two items and put its overflow menu —
the only route to Delete — at the left edge of the row whenever the amount was
wide enough to wrap away from it.

**The stronger version of this is to take the control out of the reflow.** A
position that depends on nothing content-sized is a property no amount of
careful wrapping gets you. The transaction row pins its overflow menu — the
only route to Delete — to the surface's top-right corner with `position:
absolute`, and pays for the covered corner only when a menu is projected: the
slot is the surface's first child, and `.row-actions:not(:empty) ~` sibling
rules grant the head its 44px of padding and end the strip's scrollport left
of the button (margin, not padding — the sticky `+N` pins to the scrollport
box). Out of the flow, the control also adds no height. The previous form of
this rule stacked the menu under the tile in a fixed-width column, which
bought the same position at 100px on every row; issue #219 tracked that cost
and [ADR 0017](ADR/0017-the-row-stacks-and-actions-ride-behind-a-swipe.md)
retired it.

**Check:** in any wrapping flex row, no trailing item carries `margin-left:
auto` while a sibling that must stay beside it does not. And assert the
control's *position*, not its containment — a control at the wrong edge is
still inside the row, which is how `overflow-guard.spec.ts` passed on this for
a release.

---

### G7 — A strip of discrete chips scrolls; prose wraps

Reflowing is right for text and wrong for a strip. A row carrying a category, a
location and five tags stacked six lines deep on a phone, and a list whose rows
each choose their own height is a list nobody can scan. Give the strip one line
and a scroller.

```scss
.row-category {
  flex-wrap: nowrap;
  white-space: nowrap;
  overflow-x: auto;
  overscroll-behavior-x: contain;   // a fling must not trigger the back-swipe
  scrollbar-width: thin;            // thin is fine; none is G4
}
.tag-chip { flex-shrink: 0; }       // chips queue, they do not squash
```

Every scrolling strip also keeps a 12px gutter under its content
(`padding-block-end: 12px`, never `padding-bottom` — taller than an overlay bar, which paints bottom-aligned in the gutter and would otherwise sit on the content) so the bar it never hides
(G4) is drawn below the labels, chips or segments instead of over them — the
tab strips, `.quick-filters`, `.insight-chips` and the period toggle all
carry it. On the period toggle the scroller and the pill are two different
elements (`.period-toggle-scroller` wraps `.period-toggle`): the gutter lives
on the scroller, outside the pill's rounded border, so the pill's own height
still matches its segments' instead of growing a blank band inside the frame.

Three things that are easy to miss:

- **The overflow indicator has to be pinned, not just present.** `+2` as the
  last child of a scroller sits past the right edge, visible only to a reader
  who has already scrolled far enough not to need it. `position: sticky; right:
  0`, and it must be a **direct child of the scroller** — a sticky element can
  only travel within its containing block, so nested one box deeper it has
  nowhere to go.
- **A scroller inside a clickable row swallows a click it should not.** Where
  the platform draws a classic scrollbar, that scrollbar is inside the row's
  hit area and dragging it fires a click on the row. Guard it: a click whose
  `offsetY` is past the scroller's `clientHeight` is a click on its scrollbar.
  See `onActivate` in `transaction-row.component.ts`.
- **`overflow-x: auto` makes the box a vertical scroll container too** (G4).
  Harmless on a single nowrap line, but it is the same rule that broke paging
  from `.dashboard-container`, so check nothing walks the tree looking for one.

**A strip of tabs is a strip.** Material's `mat-tab-group` is the exception
that had to be made into the rule: it clips its label container and pages it
with a `transform`, driven only by the chevron buttons, which carry
`touch-action: none` and own the only pointer listeners. A finger on the
titles moves nothing, a trackpad moves nothing, and a tab behind a chevron is
a destination most readers never find. `TabStripScrollDirective`
(`mat-tab-group[appTabStripScroll]`) opts a group into the ordinary treatment:
it sets `disablePagination` so the chevrons are never shown, and one global
rule in `src/styles.scss`, keyed on the directive's own attribute, gives the
label container `overflow-x: auto`, `overscroll-behavior-x: contain` and
`scrollbar-width: thin` — the same three declarations as the chip strip above;
the same rule set puts the strip's divider on `.mat-mdc-tab-list` rather than
the header, so the active tab's underline rests on the line and the bar sits
below it in its gutter. A group that has not opted in keeps Material's
behaviour.

Two things that will bite the next one:

- **`disablePagination` alone makes it worse.** It takes the chevrons away and
  leaves `overflow: hidden`, so the later tabs become unreachable by any
  means. The scroller is the half that matters.
- **Material resets the scroll on every focus change.** `_setTabFocus` writes
  `scrollLeft = 0` after each change of focus index — arrow key *and* click —
  and the group emits `focusChange` synchronously *before* that write. A
  reveal called from that subscription is undone immediately; queue it in a
  microtask and it lands after. The first selection is silent altogether, so
  the landing tab is revealed from `afterNextRender` instead.

Prose does not get this treatment. A description behind a horizontal scrubber
means scrolling sideways to read what you bought — 689px of it, measured on the
worst row in the app. Reasoning in [ADR 0012](ADR/0012-a-strip-scrolls-rather-than-growing-the-row.md).

A swipe gesture layered on the row must leave the strip's own panning alone.
The reveal directive refuses any gesture born inside the strip
(`swipeRevealIgnore`), and `touch-action: pan-y` sits only on the row's leaf
lines — effective touch-action intersects down the ancestor chain, so one
ancestor-level `pan-y` would take the strip's horizontal touch scrolling with
it. Content clipped only *in transit* while the surface slides is not a G4
violation: at every rest state nothing is hidden, and every action behind the
swipe keeps a non-gesture route — the pinned menu.
[ADR 0017](ADR/0017-the-row-stacks-and-actions-ride-behind-a-swipe.md).

---

## Where each rule is enforced

| | |
|---|---|
| `shared/directives/fit-text.directive.spec.ts` | the directive: scales, floors at 12px, writes nothing when the value fits, does not oscillate |
| `shared/overflow-guard.spec.ts` | a hostile row keeps its menu, amount and `+N` inside the clipping card — and an ordinary row still does not reflow at 375px, bounded hard at 88px. Also positional, since containment was not enough: the menu pins to the row's top-right corner, the tile stays on the body's line, the strip stays one line and ends left of the menu, the dashboard shape reclaims the reserved corner, and the insight drill-down row does not truncate |
| `features/ai/import/transaction-preview-table/transaction-preview-table.overflow.spec.ts` | the import review card at 288px with everything a receipt can put on it: the amount stays whole beside the currency menu, the fallen-back marker, the suggestion chips and their remove buttons stay reachable, and the bulk currency button wraps rather than shoving the count badge off the header. Also every control the review step added — the date button and the currency chip keep their 6px gap along whichever axis the meta row wrapped onto, and the picker they open has no box in that row at all; the inline amount and description editors stay inside the clip with their triggers' width; the question chip's Keep and calendar halves are 40px controls that never reach into the row of chips below; and the duplicate badge's overrule is a 40px control on the badge that stays clear of the description. Also the controls that add rather than correct — the **Add tag** trigger, which is on every row, and its editor stay inside the clip (both probe rows carry a location, so **Add location**, which stands only where nothing was suggested, is not measured here), the **Add a row** control sits under the list and outside the rows' own scroller, the location chip's name and country reach 40px through an overhang the way its removal does, and (the file's one measurement taken at a desktop width, because at 288px the chips never stand beside it) the add trigger does not carry the chips sharing its line up to its own height. Also the two controls that change how many rows there are — **Split**, whose trigger stands on a filled row worth at least two of its currency's minor units and whose open editor is measured on the widest row the way the amount and description editors are, and **Merge into…**, whose trigger renders only once two rows share a currency, so its case first overrules the second fixture row's flag through the badge's own control and re-denominates the row through its own currency menu (real edits, leaving the standing fixture and the offer chips it pins untouched) and then measures both triggers inside the clip, at 40px, and clear of the chips' hit boxes below them — by their own boxes, since an add trigger has no `::after` overhang for the chips' pass to read. Also the two things the 288px fixture cannot see on its own — the category suggestion chip measured on the 240px card journey 10 recorded (a 262px clip less the container's border and the list's padding), carrying a long real category name rather than the fixture's *Unknown* fallback, with the chip inside the clip, the card's `scrollWidth` inside its `clientWidth`, and the label's own `scrollWidth` inside its box at a font size no smaller than the 12px floor — and, at that width, the caret's computed `display` reading `none` while the desktop case reads it standing, with the label's own text measured at no more than three lines (five with the caret) by `Range.getClientRects()`. That pair is readable in a probe only because the rule is a container query on the card: a viewport query reads Karma's window, never a card clipped narrower than it, so the probe could neither see it nor be trusted when it did; and every chip hit box and add trigger measured a second time under `dir="rtl"` on the clip, each inset checked finite before it is compared, with the location chip's name trigger and country button read directly — the pair whose overhangs would meet if the insets were still physical |
| `shared/directives/swipe-reveal.directive.spec.ts` | the gesture: axis lock, strip exclusion, click suppression — the click after a drag a key was held down through included — one open row app-wide, snap and fling, pointercancel recovery, a disabled directive doing nothing, and the sticky `+N` staying pinned on a translated surface. Also the ways out of an open drawer, none of which activates the row: a tap on the surface, Escape from the row button, a pointerdown outside, and Enter on the row button, which puts the drawer back and leaves the next Enter to activate. `transaction-row.component.spec.ts` pins the same Enter stand-down on the real row, and Escape from any control in it |
| `shared/safe-area.spec.ts` | `max()` not sum; one owner per inset |
| `features/transactions/add-affordance.spec.ts` | the transactions header's add FAB keeps its 48px while the period totals sharing its row yield — and, at every width, exactly one add affordance is on screen |
| `features/transactions/transaction-overflow.smoke.spec.ts` | the same on a real page, plus the paging root |
| `shared/truncation-guard.spec.ts` | the two things a deleted truncation is replaced by: text wraps inside its box without shoving its neighbour out, and a label that cannot wrap scales while its control survives |
| `scripts/check-truncation.mjs` | G3 across the whole source, `npm run truncation:check` |
| `shared/directives/tab-strip-scroll.directive.spec.ts` | the strip mechanics on a 300px host: no chevrons on an overflowing strip, a label container that really scrolls, a newly selected tab brought into view, the tab the arrow keys walk to kept in view, and a clicked tab staying put after the reader scrolled to it — the case Material's focus reset breaks |
| `features/budgets/budgets.overflow.spec.ts`, `features/reports/reports.overflow.spec.ts` | the two opted-in pages: the chevrons never appear, and a `?tab=` deep link opens on its tab already in view |
| `features/reports/<name>/<name>.overflow.spec.ts` for category-breakdown, monthly-comparison and spending-analysis, `features/settings/profile-settings/profile-settings.overflow.spec.ts`, and cases in `ai-settings-page.component.spec.ts` and `transaction-filters.component.spec.ts` | G2 as rendered: the column count of each repaired grid. Karma's window is 756px, so the three whose rules start at 768px or 1024px cannot be read as layout — those pin the repaired *declaration* through the CSSOM instead, where an invalid value serialises as an empty string |
| `scripts/check-grid-tracks.mjs` | both halves of G2 across the whole source — the nested `minmax()` and a bare `fr` track with no floor — `npm run grid:check` |
| `shared/layout/bottom-nav/bottom-nav.overflow.spec.ts`, `shared/components/period-selector/period-selector.overflow.spec.ts` | the two rows the account's own font scale breaks: a gutter between two fitted nav labels at 1.3 and at the default, and the calendar button staying beside the toggle group at 1.3 while the group stops at its content width on a desktop row |
| `shared/layout/sidebar/sidebar.overflow.spec.ts`, `shared/layout/header/header.overflow.spec.ts` | the drawer never scrolls sideways to reach a nav row; the header avatar falls back to its placeholder on a load failure and recovers when the URL changes (the settings card's own case is in `settings.component.spec.ts`) |
| `features/settings/ai-settings-page/ai-settings-page.overflow.spec.ts` | the longest catalog model name wraps in the select trigger instead of ellipsizing, at both font scales |
| cases in `transaction-list.component.spec.ts`, `budget-progress-card.component.spec.ts`, `import-history.component.spec.ts` | the 40px targets — the note button, the receipt icon and the row actions trigger reaching it through the overhang while their glyph boxes stay 32px and unsized, and the budget card's menu trigger reaching it by its own box — plus the desktop table fitting its floor width without a sideways scrollbar, and an attachment id and an error message carrying a URL wrapping inside their cards |
| `docs/ui-audit/tools/capture-overflow.mjs` | five pages × seven widths × (en, ja, faked insets), run before/after a layout change |

Every row but the harness runs in CI: the unit specs through `test:ci`, the
smoke spec through `npm run smoke`, and the source checks through
`npm run truncation:check` and `npm run grid:check`. The harness needs a dev server and the emulators,
so it is a before/after instrument for UI pull requests, like
`capture-dialogs.mjs`.

## Using `appFitText`

Put `white-space: nowrap` on the host in the component's stylesheet — the
directive writes no style at all while the value fits, so the nowrap has to
come from the cascade.

```html
<span class="amount" appFitText>{{ formatAmount() }}</span>
```

It measures in a batched pass rather than during change detection, shares one
`ResizeObserver` across the app, and skips the DOM write entirely in the common
case. Use it for values that must not break: amounts, the header wordmark,
navigation labels. Do not use it for prose — prose should wrap.
