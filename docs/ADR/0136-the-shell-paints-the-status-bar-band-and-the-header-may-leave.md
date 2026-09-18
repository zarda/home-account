# 136. The shell paints the status-bar band, and the header may leave

**Status:** Accepted, implemented · **Date:** 2026-09-17 · **Issues:** #426

No reference document owns this directly. The safe-area inset rule it is an
instance of is G5 in [../ui-overflow.md](../ui-overflow.md) — "exactly one
element owns each inset" — which this record has to read narrowly, below.

## Context

On iOS, the fixed header pays for the status-bar area itself: its own height
is `64px + var(--safe-top)`, with `padding-top: var(--safe-top)` pushing its
content down below the notch. That has worked since the header first started
hiding on scroll — the mobile-only scroll handler adds `.hidden`, which
`transform: translateY(-100%)` slides fully off-screen, header and safe-area
band together.

That is also exactly the defect. The band was never a fixed part of the
screen; it was a property of the header's own box, and the header's hide
animation is designed to remove that box from view. Scrolling on a page tall
enough to hide the header therefore slides the safe-area band away with it,
and `.main-container` — fixed, padded by `calc(64px + var(--safe-top))` at
rest — goes on scrolling its rows underneath the notch and the clock with
nothing painted behind them. On the web this is invisible: `--safe-top`
resolves to `0px` there, so the header never had a band to lose in the first
place, and the defect only exists on a device with a real inset.

## Decision

**The band moves to the shell, as its own element, and the header keeps
hiding exactly as it always did.**

`main-layout.component.scss` gains a `:host::before` — a fixed,
pointer-transparent strip pinned to the top of the viewport, `height:
var(--safe-top)`, painted in `--surface-card`. It does not move when the
header hides, because nothing about the header's own transform touches it;
it is a second, independent box answering to the same custom property.

**Why the layout owns it, not the header.** The header's whole *reason* to
hide is to give scrolled content more room — the safe-area band is the one
part of that box the page does not want to lose along with the header, so it
cannot go on being drawn by the thing that is leaving. Moving it to a
component that is never removed from the DOM is the direct fix; teaching the
header to leave a piece of itself behind when it hides would have meant
carving a second stacking context out of an element whose whole job is now
to have exactly one.

**One z-index under the header.** `z-index: calc(var(--z-header) - 1)` reads
as 799 against the app's scale (`--z-header: 800`), which sits it above the
docked sidebar (790) and the ordinary content, and below the header itself,
the drawer backdrop (900) and the drawer (910). The band never needs to be
above the header — it exists for the moment the header is *gone* — and
staying under it means the header's own shadow and border still read as the
topmost edge whenever it is showing.

**Zero height on web is the existing contract, inherited for free.**
`--safe-top` already resolves to `0px` outside a real inset
(`styles.scss`), so the new element collapses to nothing there without a
media query or a platform check of its own — the same indirection that lets
`safe-area.spec.ts` exercise this in a browser that has no notch to give it.

## What was rejected

- **Teaching the header to leave its band behind on hide** — splitting one
  element's paint from its own transform is a heavier change than adding a
  second element that was never going to move, for the same visual result.
- **A z-index above the header**, so the band would always show even while
  the header is visible — rejected because the header already paints that
  area correctly while it is on screen; the shell's band only has work to do
  once the header is gone.

## Consequences

- `main-layout.component.scss` gains one rule; `main-layout.component.spec.ts`
  gained cases for the band's presence, height and stacking order (21 → 23).
- No change to `header.component.ts` or `.scss` — its hide animation, and
  the scroll logic that drives it, are exactly what they were.
- Verified on the simulator: scrolling a page long enough to hide the header
  leaves the band painted under the clock, with the header itself off-screen
  and nothing behind it drawing through.

## Departures from the issues

None. Tracker #426's first part asked for content to stop appearing under
the status bar on a hidden header, and that is the whole fix.

## Known gaps

- **A landscape cutout is the content gutter's problem, not this band's.**
  The band only ever answers to `--safe-top`; the side insets that matter in
  landscape are unrelated custom properties this decision does not touch.
- **No real-device run.** Verification here is the simulator; nothing about
  the fix is simulator-specific, but a physical device with a notch has not
  confirmed it independently.
- **Dark theme relies on the surface token, not verified natively.** The
  band paints `--surface-card`, the same token the header itself uses, so it
  should track a theme switch identically — but that was read from the
  stylesheet, not watched on a device switching themes.
