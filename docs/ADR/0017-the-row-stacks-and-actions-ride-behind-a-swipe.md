# 17. The row stacks its lines, and actions ride behind a swipe

**Status:** Accepted, implemented · **Date:** 2026-08-07 · **Issues:** #219

Revises the row anatomy [0012](0012-a-strip-scrolls-rather-than-growing-the-row.md)
left in place; the strip decision there stands unchanged. Reference
documentation lives in [../ui-overflow.md](../ui-overflow.md).

## Context

0012 fixed how tall a hostile row may become, and knowingly paid for it with
the ordinary ones: the overflow menu moved out of the reflow by stacking under
the category tile, and that leading column — 32 of tile, 4 of gap, 40 of menu,
24 of padding — set every row in the list at 100px, where the text alone needs
about 81. A quarter fewer rows fit on a screen, and a transaction list is
scanned by running down it.

Issue #219 recorded the constraints any revisit has to keep. The menu is the
only route to Delete, and its position must depend on nothing a reflow can
move — that property is what the column bought and why it was not simply
reverted. The touch target does not go under 40px. The tile is what a row is
read by at a glance and does not shrink much further. Nothing truncates and
nothing is clipped out of reach (0010, 0011's cousin rules, 0012).

## Decision

Three decisions, one per constraint the column was serving.

**The row is a three-line text stack beside a bare tile.** Line one carries
the description and the signed amount; line two is the strip, exactly as 0012
built it; line three carries the relative date and the converted amount, which
leave the amount's old trailing stack. Height belongs to the text again:
~81px on an ordinary row, and `overflow-guard.spec.ts` re-decides its hard
bound at 88, the same way it once stated the 100.

**The menu pins to the corner, and the corner is paid for only where it
exists.** `position: absolute` against the surface is the stronger form of
taking a control out of the reflow — same fixed position on every row, at no
height. The 44px reserve under it is granted by `.row-actions:not(:empty) ~`
sibling rules (the slot is deliberately the surface's first child), so the
dashboard card, which projects no menu, reclaims all of it. The head takes the
reserve as padding; the strip takes it as **margin**, because the sticky `+N`
pins to the scrollport's edge and padding would leave the indicator under the
button — the scrollport itself has to end left of it.

**Edit and Delete ride behind a left swipe, as a fast path and not the
route.** The pinned menu remains the keyboard, screen-reader and
discoverability path — which answers the accessibility objection #219 records
against swipe-only actions. A shared `SwipeRevealDirective` translates the
surface and the drawer in lockstep; swipe Delete goes through the same confirm
dialog as the menu's; while closed, the drawer's buttons carry `tabindex="-1"`
and `aria-hidden` so clipped controls never trap focus. At most one row is
open app-wide, a tap or Escape or an outside touch puts it back, and a gesture
born on the strip belongs to the strip.

## Alternatives rejected

**The menu into the trailing stack, under the amount.** Puts a control back
into the reflow that G6 exists to guard, and grows the very lines the stack
was meant to shrink.

**Swipe-only actions.** The density ceiling — and rejected in #219's own
terms: the only route to Delete cannot require a gesture that nothing on
screen announces.

**A 28px tile.** #219 measured it: ~6px saved, paid in the one thing the row
is read by.

**An opaque surface with static actions behind it.** Simpler — one transform
instead of two — but the surface must then carry its own background in every
theme, and the row's hover and the list's highlight flash die underneath it.
The translate-synced drawer keeps the surface transparent; the cost is a
second style write per frame.

**`:has()` for the reserve.** Supported by everything the app targets, but
the forward-only sibling combinator has no support question at all, and
placing the slot first costs nothing.

## Consequences

Measured live at 375px: ordinary rows 83px where they were 100 (and 80 before
0012's move), and a row whose description wraps to two lines takes 107 — the
text decides again, which is the point. Dashboard rows shed the reserve and
the drawer entirely and land at 83 unchanged in anatomy. The strip, its
scroller, its sticky `+N` and its scrollbar-click guard are untouched.

## Things that only became apparent while building

- **`position: sticky` survives a transformed ancestor.** A transform changes
  the containing block for `fixed`, not the scrollport sticky resolves
  against — and the scrollport translates together with the chip. The
  directive spec pins this down so it stays true.
- **Settle state synchronously; let the animation be paint.** Open/closed,
  events and classes are final on pointerup, and the 150ms transition only
  repaints. That is what makes the whole gesture drivable by synthetic
  PointerEvents in Karma — `setPointerCapture` throws `NotFoundError` on
  synthetic events and is try/caught for the same reason.
- **Trust velocity only across a real frame (≥15ms).** Back-to-back synthetic
  dispatches measure as velocity 0 and settle by the half-width rule; a real
  fling reads from elapsed time. Without the floor, a spec's synchronous
  burst computes an absurd velocity and every short drag "flings".
- **A directive's signal input bound from a plain host property did not
  re-evaluate** under `detectChanges()` inside `@for` in the spec harness;
  bound from a signal it invalidates correctly. The probe binds a signal.
- **`overflow: clip` on the row, not just `hidden`** — a hidden-overflow box
  is still a programmatic scroll target, and a focus scroll could shift the
  row and half-reveal the drawer. `clip` cannot scroll.

## Known gaps

- The left swipe against WKWebView's back gesture is untested on a device.
  `allowsBackForwardNavigationGestures` is off and the axes differ (back is a
  right swipe from the left bezel), so the exposure is low, but it is a device
  check, not a spec.
- The drawer opens by pointer only. Keyboard users reach the same actions
  through the menu; there is deliberately no keyboard chord for the drawer
  itself.
