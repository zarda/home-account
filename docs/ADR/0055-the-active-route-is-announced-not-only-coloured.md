# 55. The active route is announced, not only coloured

**Status:** Accepted, implemented · **Date:** 2026-08-17 · **Issues:** #274

Follows [0036](0036-a-user-facing-string-lives-in-the-catalog.md) in treating
what assistive tech receives as part of the interface rather than a decoration
of it. Reference documentation lives in
[../accessibility.md](../accessibility.md).

## Context

`grep -rn "aria-current" src/` returned nothing. The attribute was not emitted
anywhere in the app.

Both navigation templates set `routerLinkActive="active"` and stopped there, so
the active route existed as a CSS class and in no other form. A screen-reader
user on `/budgets` who opened the drawer and arrowed through the links heard
eight identical announcements — "link, Dashboard", "link, Transactions", "link,
Budget" — with nothing indicating the page they were already on.

Both surfaces are reachable at every screen size: the sidebar is docked on
desktop and presented as an overlay drawer on smaller layouts, and the bottom
nav is the only always-visible navigation on a phone. So this was not one
template's oversight.

Two mechanisms were already in the stack and neither was wired up.
`RouterLinkActive` accepts `ariaCurrentWhenActive`, and `MatListItem` declares
an `activated` input that host-binds `aria-current`.

The visual signal was thin in a second way. The sidebar's active treatment is a
background plus an accent colour on icon and label; the bottom nav's is a
tinted pill plus a primary colour and a heavier label. Forced colors replaces
author colours with system ones, so both collapse to a font-weight difference.
There was no `forced-colors` media query anywhere in `src/`.

Neither spec could have caught any of it: both used `provideRouter([])`, so
there was no route for a link to be active on.

## Decision

**An active or current state that a sighted user can see is also exposed to
assistive technology, and is not conveyed by colour alone.**

For navigation that means `aria-current="page"` on the link for the current
route, driven by the same activation state that drives the CSS class — no
second source of truth, no component logic.

### The mechanism differs by host, and the host decides

- **Plain anchors** take `RouterLinkActive`'s `ariaCurrentWhenActive="page"`.
- **`mat-list-item` anchors** take `[activated]`, bound from the
  `routerLinkActive` template reference.

This is not a style preference. `MatListItem` host-binds
`[attr.aria-current]="_getAriaCurrent()"`, and a host binding wins over
anything the template sets on the same element, so both `ariaCurrentWhenActive`
and a hand-written `[attr.aria-current]` are silently overwritten there. Using
`[activated]` also gets two things for free: Material answers `'page'` rather
than `'true'` only when the host is an anchor, and it already ships a
forced-colors indicator for an activated anchor.

**The state goes in `aria-current`, never in the accessible name.** The bottom
nav's links carry an `aria-label` duplicating the visible label; appending
"current" to it would break the match between accessible name and visible text,
trading one defect for another.

### Colour is never the only carrier

Where an active treatment is built from colour, it carries a `forced-colors`
counterpart that survives the mode — an outline or border, not a heavier font.

### The alternatives that were rejected

**`[attr.aria-current]` on both surfaces, for symmetry.** It does not work on
the sidebar, for the host-binding reason above, and it would have failed
silently: the template reads as though it does something.

**A component-level `isActive` signal feeding both the class and the
attribute.** Duplicates what `RouterLinkActive` already tracks, and gives the
two signals separate chances to disagree.

**Leaving forced colors for a later accessibility pass.** The active treatment
under forced colors is the same defect as the missing attribute — the state is
present for some users and absent for others — and both cost a few lines in
the file already being edited.

## Consequences

- On any route, the link for the current page carries `aria-current="page"` in
  both surfaces, and no other link does.
- The mark follows real navigation with no reload, because it is driven by the
  activation `RouterLinkActive` already tracks.
- The bottom nav's accessible names are unchanged — still the bare label.
- Under forced colors the active item in both surfaces is distinguishable by
  something other than font weight.
- New navigation surfaces inherit the requirement, and a mat-list-based one has
  to use `[activated]` rather than the input its neighbour uses.

## Things that only became apparent while building

- Material's `_getAriaCurrent()` returns `'page'` only when the host element is
  an anchor, and `null` otherwise. Binding `activated` on a non-anchor list
  item therefore yields the visual treatment and no attribute at all — quiet in
  exactly the way that made the original omission hard to see.
- The forced-colors indicator Material draws for an activated anchor means the
  sidebar's non-colour cue arrived with the accessibility fix rather than
  needing to be designed. That is an argument for `[activated]` beyond the host
  binding.
- Asserting the attribute in the route smoke test had to be gated on a link for
  the route being on screen. The surfaces rendered there do not carry all eight
  destinations, so three routes had no link to mark and failed a blind
  assertion. The gate tests for the anchor rather than the attribute, so it
  does not weaken what the check catches.

## Known gaps

- Only navigation is covered. Tab strips, segmented controls and the period
  selector express selection visually and are not audited here.
- The `forced-colors` counterparts are the first in the codebase; nothing yet
  checks that a new colour-only active treatment gets one.
- Neither surface exposes a landmark role beyond the `nav` element, and the two
  are indistinguishable to a user listing landmarks.
