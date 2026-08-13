# Overflow: what the app does when content does not fit

The rule is that **nothing truncates**. Text reflows onto more lines; a value
that has to stay on one line scales down to a 12px floor and only then wraps; a
strip of discrete chips scrolls. No ellipsis, nothing clipped away, no control
pushed out of reach.

Why it is that rule rather than an ellipsis, and what was rejected on the way,
is in [ADR 0010](ADR/0010-nothing-truncates.md). Why a strip may scroll instead
of reflowing is in [ADR 0012](ADR/0012-a-strip-scrolls-rather-than-growing-the-row.md).
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
the top of `transaction-row.component.scss`, which shows where its 7rem floor
comes from.

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
.details { flex: 1 1 auto; min-width: 7rem; }  // measured at max-content — breaks the line
.details { flex: 1 1 0;    min-width: 7rem; }  // measured at 7rem, then grows into the rest
```

The floor is what the zero basis is clamped up to, so it is still the only
number line-collection sees. `transaction-row.component.scss` shipped the first
of these and put its category tile alone on a line whenever a description ran
long.

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

**Check:**

```bash
grep -rn "grid-template-columns" src --include='*.scss' | grep "1fr" | grep -v "minmax("
```

comes back empty.

---

### G3 — Nothing truncates

No `text-overflow: ellipsis`. Text wraps, with `overflow-wrap: anywhere` where
the content may contain an unbreakable run such as a pasted URL. A value that
must not break carries `appFitText` and scales to 12px — `--text-xs`, the floor
the type scale already declares — and wraps only past that.

**`anywhere`, not `break-word`.** Only `anywhere` reduces an element's
min-content size. `break-word` leaves the element still refusing to shrink,
still pushing its neighbours out, and looking like a fix.

**Three corollaries worth knowing, because between them they made four rules in
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
| `shared/directives/swipe-reveal.directive.spec.ts` | the gesture: axis lock, strip exclusion, click suppression, one open row app-wide, snap and fling, pointercancel recovery, and the sticky `+N` staying pinned on a translated surface |
| `shared/safe-area.spec.ts` | `max()` not sum; one owner per inset |
| `features/transactions/transaction-overflow.smoke.spec.ts` | the same on a real page, plus the paging root |
| `shared/truncation-guard.spec.ts` | the two things a deleted truncation is replaced by: text wraps inside its box without shoving its neighbour out, and a label that cannot wrap scales while its control survives |
| `scripts/check-truncation.mjs` | G3 across the whole source, `npm run truncation:check` |
| `docs/ui-audit/tools/capture-overflow.mjs` | five pages × seven widths × (en, ja, faked insets), run before/after a layout change |

Every row but the harness runs in CI: the unit specs through `test:ci`, the
smoke spec through `npm run smoke`, and the source check through
`npm run truncation:check`. The harness needs a dev server and the emulators,
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
