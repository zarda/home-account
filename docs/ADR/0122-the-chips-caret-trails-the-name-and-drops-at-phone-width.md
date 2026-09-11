# 122. The chip's caret trails the name, and drops at phone width

**Status:** Accepted, implemented · **Date:** 2026-09-11 · **Issues:** #413

Reference documentation lives in [../ui-overflow.md](../ui-overflow.md).

Extends [0010](0010-nothing-truncates.md), whose rule — text reflows, values
scale, nothing is cut — is what turns a narrow chip into a tall one, and
[0110](0110-the-probe-measures-the-card-at-phone-width-and-in-both-directions.md),
closing the follow-up it filed while reading this chip: "Material projects
both `mat-icon`s through the leading slot, so the caret renders before the
category name rather than after it."

## Context

The category suggestion chip is a `mat-stroked-button` carrying three
things: the category's own icon, its name, and a dropdown caret saying the
name is a menu. The measured DOM order was
`[ripple][category-icon][dropdown-icon][mdc-button__label]`.

Material's button template has two `ng-content` slots for icons, and it
selects the trailing one on `[iconPositionEnd]`. Without that attribute
every `mat-icon` in the button's content projects through the **leading**
slot, whatever order the template writes them in. So the caret painted
before the name, and no amount of ordering in our own template would have
moved it.

The chip's stylesheet had a margin written for the caret it did not have:

```scss
.dropdown-icon { … margin-inline-start: -2px; }
```

In a trailing position that pulls the caret in toward the label. In the
leading position it tightened the gap to the category icon instead — and it
did not even do that, because it never applied: Material's own leading-icon
rule is more specific at (0,3,0) than this file's (0,2,0) selector. A
declaration written for one layout, sitting in a file describing another,
losing a cascade fight nobody had noticed it was in.

The second half is what the chip does when the card is narrow. Since the
chip began yielding to the card, `appFitText` scales the label down to its
12px floor and then wraps — 0010's rule, and the right one. At the width the
review list leaves a card on a phone, "Groceries & household supplies"
became a column of 12px text standing beside an icon and a caret. Nothing is
hidden and nothing truncates; it is simply a bad shape, and the width it
needs is being spent on the caret.

## Decision

**The caret projects through the trailing slot with Material's own spacing,
and it is hidden when the card — not the window — is narrow.**

### `iconPositionEnd`, and no margin of ours

The attribute goes on the caret's `mat-icon` and the `margin-inline-start`
comes out. Spacing is then Material's own `.mdc-button__label + .mat-icon`
rule — 8px toward the label, 8px pulled back into the end padding, mirrored
under `[dir=rtl]` by Material's own stylesheet, which ships the physical
pair for both directions. A margin declared in this file would lose to that
rule at the same specificity the deleted one was already losing at, so the
right move is not to declare one.

### A container query on the card

```scss
.transaction-card { container: review-card / inline-size; }

@container review-card (max-width: 480px) {
  .dropdown-icon { display: none; }
}
```

This is the first rule in the app keyed on an element's width rather than on
the viewport's, and the reason is 0110's trap. The card's own phone layout
is `@media (max-width: 600px)`, which reads the window — and in a unit probe
the window is Karma's, never the 240px clip the card is actually being
measured in. A viewport rule here would be unprovable by any probe: it would
either match everything or nothing depending on the runner's window, and
whatever it did would have no relationship to what a card clipped narrower
than the window does. A container query is read by the probe and by a real
phone in exactly the same way, because both are asking the card.

480px is chosen against two real widths: a phone's card is under about
380px, and the 600px viewport layout leaves one near 500px. The caret goes
on the narrow half and stands everywhere else. The chip is a menu trigger
with or without it — the whole label is the trigger.

The query is declared on the card and answered in the chip's own stylesheet,
two components apart. That works because `@container` walks the **DOM**, not
the style-encapsulation boundary, and `.transaction-card` is a real ancestor
of the chip. Standalone — the chip rendered with no card above it — the
query matches nothing and the caret shows, which the standalone probe
asserts.

### The alternatives that were rejected

- **The chip on a line of its own.** This is the layout that reaches two
  lines, and it was offered and declined in favour of the smaller change.
  See *Known gaps*: it is the honest cost of this record.
- **A viewport media query on the chip.** Unprovable, for the reason above,
  and wrong in kind: what the label has is a share of the card's row, and
  the card is not the window.
- **Reaching into the chip from the card with `::ng-deep`.** It puts the
  chip's layout in the card's file and survives only as long as nobody
  refactors the selector it is written through.

## Consequences

- **The chip's stylesheet stays at a hard zero for `direction:check`.**
  `container`, `@container` and `display: none` are all neutral to the
  checker, and the change removed a logical property rather than adding a
  physical one. The frozen baseline is unmoved.
- **The caret's position is asserted at one width and in both directions.**
  The desktop-width case reads DOM order and geometry, and a new case
  repeats the geometry under `dir="rtl"` on the clip; the narrow cases do
  not read it, because at those widths there is no caret to read.
- **Two probes measure the same rule from opposite sides.** The card probe
  sees the caret gone at 240px; the standalone chip probe sees it present
  with no card above it. Between them they pin that the rule is the card's
  width and not something ambient.

## Things that only became apparent while building

- **The label's box is 80px, and its own cap is not what binds it.**
  `.category-name` carries `max-inline-size: min(120px, 100%)`, which is
  never reached: at the 240px card the button itself is 128px — 18px icon,
  6px gap, 80px label, 24px padding — so what the label gets is the button's
  share of the row, minus everything else in the button. Removing the caret
  is the only thing on this path that gives the name more width.
- **The probe read five lines with the caret and three without.** Measured
  on a real category name at the card width journey 10 records. The caret,
  its gap and its share of the end padding are worth two lines of a
  thirty-character name.
- **`appFitText` at its floor wraps character by character.** The directive
  sets `white-space: normal` and `overflow-wrap: anywhere` once it reaches
  12px, so the line count is a direct function of the box's width rather
  than of where the words break — which is why 24px of caret is worth whole
  lines.
- **The caret's computed `display` was `block`, not `inline-block`.** It
  matters only to whoever writes the next assertion about it, and it was
  wrong in the first reading of the chip.
- **Layout containment was the risk worth checking, and it was not one.**
  `container-type: inline-size` makes the card a containing block for
  absolutely positioned descendants, which would have moved the `::after`
  hit boxes the extras' probes measure. It does not reach them:
  `.extra-accept` and `.extra-remove`/`.extra-country` each declare
  `position: relative` themselves, so the containing-block search stops
  before the card, and the file declares no `z-index` at all. Every hit-box
  and RTL case passed unchanged.

## Known gaps

- **#413 asked for at most two lines, and this layout reaches three.** The
  issue offered two shapes — a name in at most two lines, *or* the chip on
  its own full line — and the caret drop was chosen knowing it reaches
  three: the option was described, before it was taken, as saving about 24px
  and leaving a thirty-character name needing three lines at the floor. The
  measurement bears that out exactly (five lines to three, an 80px label).
  Two lines needs the full-line layout, which was considered and not taken.
  The probe pins the measured three rather than the criterion.
- **The label's cap and the card's column layout are untouched.**
  `min(120px, 100%)` stands unreached, and the chip still shares its row
  with the amount and the other extras; nothing here changes what the card
  gives the chip, only what the chip spends it on.
- **`MatChipsModule` is imported by the chip component and unused** — it
  renders a `mat-stroked-button`, not a `mat-chip`. Noticed while reading
  the component and left alone.
