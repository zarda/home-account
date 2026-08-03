# 9. Nothing truncates: text reflows, values scale

**Status:** Accepted, implemented · **Date:** 2026-08-03 · **Issues:** #216

Reference documentation lives in [../ui-overflow.md](../ui-overflow.md). This
record keeps the decision and the reasoning.

## Context

Long content hid parts of the UI all over the app. The transaction row was the
worst of it: a long category name painted straight over the amount and the
overflow menu — the only route to Delete — and was then chopped mid-glyph by
`.mobile-list { overflow: hidden }`. The desktop table was worse still. Its
five columns already claim a fixed 418px inside a card with `overflow: hidden`
and no horizontal scroll, so between 768px and 1023px the amount and the menu
were cut off at the card's edge with nothing to scroll and no way to reach
them.

The code did not look like it had this problem, which is why it survived.
Three rules said they truncated:

```scss
.row-description { display: flex; overflow: hidden;
                   text-overflow: ellipsis; white-space: nowrap; }
```

None of them had ever rendered an ellipsis. `text-overflow` has no effect on a
flex container, and the text each of them targeted was a bare text node inside
one — an *anonymous flex item*, which no selector can reach and which
`min-width: 0` on the parent does not touch either. They clipped. A reviewer
reading the stylesheet would conclude the case was handled.

Three mechanisms, all of them present in about thirty other places:

| | |
|---|---|
| Content hidden behind content | flex items with no declared minimum, grid tracks floored at min-content, tables with no scroller |
| Truncation that silently fails | the three dead `text-overflow` rules above |
| Chrome covering content | the home indicator over the last row on any layout without a bottom nav; the landscape cutout over the header and page gutters; three surviving `100vh` |

#214 had already fixed this class of bug for dialogs, so the shape of a fix was
known. What was not settled was what should happen to content that does not
fit.

## Decision

**Nothing truncates.** Text reflows onto more lines. A value that must stay on
one line — an amount above all — scales down to the 12px floor the type scale
already declares, and only past that floor may it wrap.

### Reflow and scale, rejecting both ellipsis and uniform truncation

The alternative was to make truncation work properly: repair the three dead
rules and ellipsise consistently everywhere. It was rejected because an
ellipsis is hidden information wearing a badge that says so, and for the one
thing this app exists to display it is worse than that. `stat-card.component.scss`
already carried half of this decision as a comment — *"a truncated amount reads
as a different number, so never ellipsize"* — and nothing distinguishes
`¥123,4…` from `¥123,400`. This generalises that rule to every value in the
app.

The cost is real and is the main thing to weigh before revisiting: rows grow
taller when their content is long. `overflow-guard.spec.ts` bounds it by
asserting that an *ordinary* row still does not reflow at 375px, so wrapping is
what happens under pressure rather than what happens.

### Scaling a number, rejecting breaking it across lines

`overflow-wrap: anywhere` would have wrapped a long amount for free, with no
directive and no measurement. A number split over two lines is harder to read
than a smaller whole one, and worse, a wrap can be mistaken for two numbers.
Scaling costs a directive and a measurement pass; wrapping remains the last
resort once 12px cannot save it, because showing all of it badly still beats
showing some of it well.

### Fixes in place, rejecting a mixin partial and new global rules

The obvious refactor was a `src/theme/_layout.scss` with `truncate`,
`scroll-x` and `flex-min` mixins. Rejected. The repo's one partial,
`_breakpoints.scss`, exists because media-query *strings* must be byte-identical
across files and CSS gives no way to share them; three declarations that read as
what they do have no such problem. A mixin compiles to the identical output and
removes from the call site the one thing a reviewer needs to see. The house
convention is the opposite — reasoning sits beside the declarations, as above
`mat-icon.mat-icon` and the dialog block — and a frictionless `@include truncate`
would have been a loaded gun pointed at the rule this record establishes.

New global rules in `styles.scss` were rejected for a sharper reason, and it is
worth stating because it looks like inconsistency with #214. The dialog fix
lives in `styles.scss` because `.mat-mdc-dialog-surface` sits in the CDK overlay
container, outside every component's encapsulation, and because Material's own
`max-height: 65vh` is injected after `styles.scss` and has to be outranked. It
was **forced, not chosen**. Every defect here is in the app's own component DOM,
where a component stylesheet reaches it. The dialog fix's shape does not
generalise; only two tokens are added globally.

A blanket `* { min-width: 0 }` was disqualified by direct evidence:
`stat-card.component.scss` deliberately uses `max-width: calc(100% - 52px)`
*instead*, because it needs the automatic minimum size to survive. A global
would have silently deleted that decision.

### Plain horizontal scroll on the table, rejecting a sticky actions column

`stickyEnd` would keep the overflow menu pinned while the table scrolls. It
needs resting *and* hover backgrounds duplicated in both themes, which would
drift from the `.mat-mdc-row` rule the first time anyone changed it — and it
buys little, because the whole row already emits `edit`, which is the menu's
own first item. Nothing is unreachable while the menu is scrolled out of sight.
`monthly-comparison` had already made the same call.

## The mitigation decisions

Each of these is invisible from the diff. A `:not()` selector or a
ResizeObserver pointed at a parent reads as arbitrary unless the alternative is
recorded.

**`:not(.with-bottom-nav)` rather than a rule plus a cancelling rule.** The
home-indicator inset could have been set unconditionally on `.main-container`
and zeroed under `.with-bottom-nav`. Identical behaviour today. Two rules that
have to stay in sync eventually do not; mutually exclusive selectors cannot
drift apart.

**`appFitText` observes the parent, never the host — and only its width.** A
font-size write changes the host's own `scrollWidth`, so watching the host
feeds the directive its own output. Watching the parent closes that path but
not the one through the other axis: a shorter value makes a shorter parent,
which is still a resize. Height never decides whether something fits, so a
height-only change is not a reason to re-measure. Both are asserted, along with
the arrangement settling in the shape it actually runs in, where the parent is
sized by its content.

**Consumers read `var(--safe-left)` and never `env()`.** This is the clearest
case in the change of a decision made *for* testability. `env()` cannot be
overridden from a stylesheet or a test; a custom property can. On every machine
CI runs on those insets are 0px, so without the indirection the landscape-cutout
behaviour could not be exercised before it reached a phone. It should stay in
that form.

**The table scroller is a descendant, never an ancestor.** `findScrollParent`
in `transaction-list.component.ts` walks *up* for the first vertically
scrolling ancestor and adopts it as the sliding window's paging root. An
`overflow-x` on a wrapper above the list would make that wrapper's `overflow-y`
compute to `auto`, and the window would stop loading with no error. A smoke
spec asserts the root is still `.main-container`, because a comment cannot
enforce it.

**Grid tracks classified before conversion.** The obvious fix is the regression
at two of the fourteen sites. `.icons-grid` and `.colors-grid` in the category
dialog hold fixed 44px buttons; five fixed columns need 5×44 + 4×8 = 252px and
the dialog is 288px wide on a 320px screen before its own padding, so
`minmax(0, 1fr)` would have produced 41.6px tracks and clipped every button —
a bug introduced by the fix for a bug. Those two take
`repeat(auto-fill, minmax(44px, 1fr))`, which drops a column instead of
shrinking the target.

## Things that only became apparent while building

**The dead `text-overflow` rules were not fixable in CSS.** The ellipsis has to
live on a real element, and the text it applies to was a bare interpolation
inside a flex container. Had the decision gone the other way — repair the
truncation — it would still have needed a template change at each site. A
`truncate` mixin would have been applied to the same wrong element.

**`overflow-wrap: anywhere` and `break-word` are not interchangeable here.**
Only `anywhere` reduces an element's min-content size. `break-word` would have
let a pasted URL go on refusing to shrink and go on pushing the amount off the
row — visibly fixing nothing while looking like a fix.

**`overflow-x: hidden` had made the dashboard a vertical scroller.** When one
axis is not `visible`, the other computes from `visible` to `auto`. So
`.dashboard-container`, which was only trying to suppress horizontal overflow,
had silently become exactly the kind of ancestor `findScrollParent` adopts.
Nobody had written that; it fell out of the spec.

**Type does not scale linearly.** Text set at exactly `base / ratio` still
landed about 1.5px over in testing — hinting and sub-pixel rounding. A pixel
over is a clipped glyph, which is the thing this exists to prevent, so the
computed size carries a 2% margin.

**Karma's context iframe is 756px.** Twelve pixels short of the breakpoint that
switches the transactions page to its table, so the smoke test measures the
mobile list. That is the view most users see, and the table is covered by
`capture-overflow.mjs` at 768, 1024 and 1440 — but it is worth knowing before
writing a spec that assumes the desktop shape.

## Known gaps

`capture-overflow.mjs` is not run by CI. It needs a dev server, the emulators,
and an environment swap that is deliberately not committed, so it stays a
before/after instrument for UI changes, as `capture-dialogs.mjs` is. The parts
that could be moved into CI were: the row geometry, the ordinary-row bound, the
directive's behaviour and the safe-area arithmetic all have unit specs, and the
page-level case has a smoke spec.

The five invariants in [../ui-overflow.md](../ui-overflow.md) are stated as
greps, not enforced by a lint rule. `grep -rn "1fr" src --include=*.scss` outside
a `minmax(` comes back empty today; nothing stops the next one being added.
