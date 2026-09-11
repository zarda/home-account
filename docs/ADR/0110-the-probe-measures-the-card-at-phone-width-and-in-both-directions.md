# 110. The probe measures the card at phone width, and in both directions

**Status:** Accepted, implemented · **Date:** 2026-09-10 · **Issues:** #393, #388

Reference documentation lives in [../ui-overflow.md](../ui-overflow.md) and
[../rtl.md](../rtl.md).

Extends [0010](0010-nothing-truncates.md) — the chip is the case where "text
reflows, values scale" has to survive a box narrower than the label — and
[0071](0071-direction-comes-from-the-locale-and-physical-css-is-frozen.md),
whose per-file baseline two stylesheets now leave. It closes the hit-box gap
of [0102](0102-the-review-card-adds-a-tag-and-edits-a-location.md).

## Context

Two defects on the same chips, both of them things the overflow probe was
built to catch and neither of them anything the probe could see.

**The chip ran past the card at phone width.** 0106 recorded it from a driven
run: at 390px the wizard leaves each card 240px wide and the category
suggestion chip, sized to its label, reached 12px past the clip. The probe's
own fixture could not reproduce it for two independent reasons. It renders at
288px — narrower, but in the *row* layout, because `@media (max-width: 600px)`
reads the Karma window and not the clip, so the phone's column layout is
unreachable from it. And its `categories` input is empty by default, so every
card in it renders the *Unknown* fallback, which is short enough to fit
whatever else is wrong.

**The box that actually held the width was not the chip's.** The obvious
culprit was `.category-button`'s `min-width: auto`, and it was one of them.
The one that mattered was the card's own `.category-section { flex-shrink: 0 }`
— a flex item of `.card-bottom-row` whose automatic minimum is its content's
width and whose only cap sat inside that same window-scoped media query. A fix
confined to the chip's stylesheet could not turn the probe green, because the
section around it was refusing to be narrowed in the first place.

**And the hit boxes were physical arithmetic inside a logical budget.** The
extras strip pays for the gap between two chip controls with a logical margin,
while the `::after` overhangs that take those controls to 40px were spelled
`left`/`right` — inside 0071's frozen baseline, and 0102's own hit-box known
gap. Under RTL the row reverses and the insets do not, so the place
name's 9px overhang and the country button's 6px one would meet across the
chip's 4px gap: an 11px overlap, two tap targets on top of each other.

## Decision

**The chip yields to the box that holds it, the chips' hit boxes are
positioned logically so both stylesheets leave the direction baseline, and the
probe measures the card at the width the wizard actually leaves it — with a
long category name, and with every hit box measured again under
`dir="rtl"`.**

### The chip yields, in five rules across two stylesheets

| Stylesheet | Rule | What it does |
|---|---|---|
| card | `.category-section` | keeps `flex-shrink: 0`, gains `min-inline-size: 0` and `max-inline-size: 100%` |
| chip | `.category-suggestion` | `min-inline-size: 0`, `max-inline-size: 100%` |
| chip | `.category-button` | `min-width: auto` replaced by `min-inline-size: 0` + `max-inline-size: 100%` |
| chip | `.category-button ::ng-deep .mdc-button__label` | `min-inline-size: 0` |
| chip | `.category-name` | `max-width: 120px` becomes `max-inline-size: min(120px, 100%)` |

`min-inline-size: 0` appears four times because a flex item's *automatic
minimum* is its content's width, and there are four nested flex boxes between
the card and the label: the section, the inline-flex wrapper, Material's
button, and the `.mdc-button__label` span Material projects the content into.
Lifting the minimum at any one of them hands the squeeze to the next; missing
one leaves that box at its content width and everything inside it too.

`flex-shrink: 0` stays on the section deliberately. It is what makes the
section *wrap* onto its own line beside the meta row rather than being
squeezed beside it on desktop; the pair beside it is what that costs — the
cap does the clamping that `flex-shrink: 0` refuses to do once the section is
alone on its line. Flex line-breaking never consults shrink, so the two are
not in conflict, and the media query below only ever reaches the app's own
narrowest window and never a card clipped tighter than that by something else
on the page.

`.category-name`'s cap becomes `min(120px, 100%)` rather than a flat 120px:
120px on a row with room, the wrapper's own width when the card has less, so
the label's box is the one that shrinks and `appFitText`'s measurement of it
is the truth. And `min-inline-size: 0` on the button carries the second job
`min-width: auto` had — beating Material's own `.mdc-button` 64px floor —
which is now stated where it happens rather than inferred.

### The hit boxes are logical, and two baseline entries go

Seven declarations across the two stylesheets convert:
`margin-left`/`margin-right` to their inline equivalents (four),
`text-align: left` to `text-align: start`, and the `::after` inset pair
`left: -9px` / `right: 2px` to `inset-inline-start` / `inset-inline-end`.
`category-suggestion.component.scss` and
`transaction-preview-table.component.scss` both fall to zero physical hits,
and their entries — 2 and 5 — are deleted from `check-direction.mjs`'s
baseline in the same commit, which is 0071's rule about a ratchet that has
stopped ratcheting.

Only the inset pair is geometrically detectable; the other five are covered by
the gate alone, by design.

### The probe measures the 240px card, and both directions

Two cases join the overflow probe:

- **A long category name at the width the wizard leaves the card.** The clip
  goes to 262px, which is where the arithmetic starts: `.table-container`'s
  1px border takes it to 260, `.transactions-list`'s 10px padding either side
  to 240 — the width a stretched flex item in that column list is handed
  regardless of what overflows inside it, and the shape a driven run measured
  against a chip reading *Groceries*. The case sets a real category, asserts
  the name actually reached the chip rather than the *Unknown* fallback,
  reads the list's scrollbar width back rather than hard-coding it, and then
  asserts the card's `scrollWidth`, the chip inside the clip, the label's own
  box, and the 12px floor.
- **Every hit box under `dir="rtl"`.** The one case in the file that flips the
  fixture, because what is under test there is the stylesheet's logical
  properties and not the card's layout. It re-runs the disjointness pass over
  the chips' hit boxes and the add triggers, and then reads the location
  chip's name trigger and country button directly — the concrete place where a
  physical spelling would have put the one's overhang back on the other.
  Every inset is checked finite first, so a control missing one on a
  given side fails with a message naming the box rather than a bare
  `Expected NaN …`.

### The alternatives that were rejected

- **A narrower `max-width` on the label.** It moves the number without fixing
  the shape: the box would still be sized to a constant rather than to the
  card, and the same defect returns at the next width or the next font.
- **A per-row overflow menu** for the category chip. It hides a control behind
  a control, and 0106 rejected the same idea for Split and Merge for the same
  reason.
- **Dropping `flex-shrink: 0` on the section.** It would squeeze the chip
  beside the meta row on desktop, trading a phone-width overflow for a
  desktop-width squeeze.
- **Converting the insets alone** and leaving the two margins and the
  `text-align` physical. The baseline is per file: a file with any hits keeps
  its entry, and an entry with slack is where the next regression lands and
  passes. Taking the two files to zero is what removes the entries.
- **Widening the probe's existing cases to 262px** instead of adding one. The
  standing cases are pinned at 288px with a fixture built for it; a second
  case is what lets both widths be true at once.

## Consequences

- **`direction:check` reads 99 hits in 33 files**, down from 106 in 35. Two
  more files are done rather than partially converted.
- **The review card is the first surface measured under a forced direction.**
  Nothing else in the tree asserts geometry under `dir="rtl"`; `rtl.md`'s
  *What is tested* names it as the first.
- **The label scales rather than truncating, and wraps once it hits the 12px
  floor.** That is 0010's rule producing the only result it can at these
  widths — every box is at the full width its container offers, so what is
  left for the label is what is left — not a squeeze the fix introduced. The
  chip's `min-height` rather than `height` is what makes a wrapped label
  visible instead of clipped.
- **0102's hit-box gap is closed**, and it is closed by conversion rather than
  by arithmetic: the overhangs reverse with the row now.

## Things that only became apparent while building

- **The probe's row layout hid three of the five rules.** The section and the
  button declarations turned the probe green on their own, and the table of
  what each rule was for missed the omission because of it: an
  inline-flex box in a *block* sizes shrink-to-fit and never below its nowrap
  content, and in the probe's row layout the section's cap happened to hide
  that. The driven run at 390px — the column layout, where
  `.category-section` becomes `width: 100%` — found `.category-suggestion` at
  185px inside a 164px section, with the label still capped flat at 120px.
  The remaining three rules were applied then. **The phone column layout is
  the driven run's to prove**, not the probe's: no Karma fixture can reach a
  media query that reads the browser window.
- **The probe's host was itself OnPush, and nothing said so.** In this Angular
  a component that declares no `changeDetection` gets `OnPush` by default, so
  reassigning the host's plain `categories` field re-ran nothing and the
  table's `@Input()` was never written. The first fix — `markForCheck()` on
  the *table* — worked only because `markViewDirty` dirties every ancestor,
  and its comment blamed "a plain `@Input()` + OnPush child", which is false.
  The host now holds a `signal()` bound as `categories()`, the way the wizard
  binds it.
- **The case passed while the name never landed.** With the categories input
  never written, the chip read *Unknown* — short, fitting, green. A
  `textContent` assertion on the label is what makes the case about the long
  name it claims to be about.
- **The `.category-section` comment credited the wrong property.** It said
  `flex-shrink: 0` produced the wrap; flex line-breaking never consults
  shrink. It also said "the media query above" for a block that is below it.
- **`NaN` does not pass silently, it fails confusingly.** The RTL case's
  finite guard was first described as stopping a `NaN` inset from passing
  every comparison — but `NaN <= 0.5` is false, so Jasmine fails on it either
  way, with a bare unlabelled message. The guard turns a confusing failure
  into a named one; both that comment and the `.extra-add` comment it was
  copied from say so now.
- **`max-inline-size: 100%` on the button measured redundant** beside
  `min-inline-size: 0`. It was prescribed, it is harmless, and it is recorded
  here rather than removed on a measurement taken at one width.
- **Material projects both `mat-icon`s through the leading slot**, so the
  caret renders before the category name rather than after it. Unrelated to
  the width, spotted while reading the chip, and filed as its own follow-up
  (`iconPositionEnd` is the fix). Closed by
  [ADR 0122](0122-the-chips-caret-trails-the-name-and-drops-at-phone-width.md),
  #413.

## Known gaps

- **The probe forces direction on one component, not the page.** `dir="rtl"`
  goes on the clip, so what is proven is that these stylesheets' logical
  properties mirror — not that the page, its overlays or Material's own
  positioning do. `AppDirectionality` is what moves those, and nothing
  measures them.
- **The rest of 0071's list stands.** Swipe-to-reveal's sign convention, the
  directional icons at 14 sites, Chart.js's own `rtl` options and the drawer
  keyframes behind the `direction:physical` marker are all untouched, and 99
  physical hits remain in 33 files.
- **No other surface is measured in both directions.** The review card is
  first because its chips had the arithmetic; every other overflow probe in
  the tree is still LTR-only.
- **The 240px case is one width, taken from one driven run.** It pins the
  arithmetic that produces it — border, padding, scrollbar — so it drifts
  loudly if any of those move, but a phone whose root font differs still
  renders different figures, and only a driven run sees that.
