# 12. A strip of chips scrolls rather than growing the row

**Status:** Accepted, implemented · **Date:** 2026-08-03 · **Issues:** #216 (follow-up)

Amends [0010](0010-nothing-truncates.md), which stands. Reference documentation
lives in [../ui-overflow.md](../ui-overflow.md).

## Context

0010 replaced clipping with reflow: text wraps, values scale, nothing is cut
off. On the transaction row that removed the data loss and introduced a
different problem, because it answered *how does content not get destroyed*
without answering *how tall may a row become*.

The row carries a description, a category name, a location and up to five tag
chips, an amount, a converted amount, a date and the overflow menu. Once all of
it wrapped, measured at the 288px probe width `overflow-guard.spec.ts` uses:

| | Wrapped (0010) |
|---|---|
| Category, location and tags | **111px** — six lines |
| Whole row | **347px** |

A list is scanned by running down it. Rows that each pick their own height —
one 80px, the next 347px — cannot be scanned, and the reader loses the thing a
list is for. Nothing was hidden, and the screen was still worse to use.

Two defects in the same change made it more visible than it would otherwise
have been, and both are ordinary bugs rather than decisions:

- `.row-details` was `flex: 1 1 auto`. Flex collects items into lines using
  each item's hypothetical main size, and `flex-basis: auto` resolves to
  max-content — so the line broke at the full width of the description, before
  shrinking was considered, and the category tile was pushed onto a line by
  itself.
- `margin-left: auto` sat on `.row-amount` while the menu was a separate flex
  item. An auto margin right-aligns only the line its own item is on, so when
  the menu wrapped away from the amount it landed at the row's **left** edge —
  the only route to Delete, at the wrong end of the row.

Both are fixed as bugs. Neither needed a decision. What needed one is the
height.

## Decision

**Prose wraps. A strip of discrete chips gets one line and a scroller.**

`.row-category` — the category name, the location chip and the tags — becomes a
horizontal scroll container: `flex-wrap: nowrap`, `white-space: nowrap`,
`overflow-x: auto`, `overscroll-behavior-x: contain` so a fling does not
trigger the browser's back-swipe, and `scrollbar-width: thin`. Chips get
`flex-shrink: 0` and queue along it. The description is untouched and still
wraps.

This does not weaken 0010. A scroller hides nothing that cannot be reached,
which is the entire difference between it and a truncation — an ellipsis
destroys the content, a scrollbar announces it. `.quick-filters` in
`transaction-filters.component.scss` and the desktop table's `.table-scroll`
are the same instrument, and 0010 itself prescribed the second of those.

Two obligations come with it, both non-obvious enough to have their own notes
in the reference doc:

- **The `+N` chip is pinned**, `position: sticky; right: 0`, and moved out of
  `.row-tags` to be a direct child of the scroller — a sticky element can only
  travel within its containing block, and inside the tag group it had nowhere
  to go. Unpinned it sits past the right edge, visible only to a reader who has
  already scrolled far enough not to need it. An overflow indicator that is
  itself hidden by overflow is worth nothing.
- **The row's click handler ignores its own scrollbar.** The row is
  `role="button"`; where the platform draws a classic scrollbar that scrollbar
  is inside the row's hit area, and dragging it would open the editor. A click
  with `offsetY` past the scroller's `clientHeight` is a click on the
  scrollbar, and nothing else.

## Consequences

Measured, same probe widths:

| | Before | After |
|---|---|---|
| Category strip, hostile row | 111px | one line |
| Hostile row, 288px | 347px | ~243px |
| Long description + tags + location, 343px | 295px | ~201px |
| Many tags, 343px | 160px | ~72px |
| Overflow menu at the right edge | not always | always |
| Category tile on the details column's line | not when long | always |

The remaining height on a hostile row is the description, and that is correct:
prose is what the reader came for and it should have the room.

**Costs accepted.** On platforms with classic scrollbars the strip is ~8px
taller when it overflows. The location link can sit off the visible strip until
scrolled to — reachable, but no longer glanceable. And the strip is now a
vertical scroll container too, because when one axis is not `visible` the other
computes from `visible` to `auto`; harmless on one nowrap line, but it is the
same mechanism that broke sliding-window paging from `.dashboard-container`, so
it is written down.

## Alternatives rejected

**Scroll the description as well.** Pins every row to ~72px and makes the list
perfectly uniform. Rejected: it puts 689px of description behind a horizontal
scrubber, so reading what you bought means scrubbing sideways through it. The
reference doc already says prose should wrap, and this is why.

**Leave everything wrapping and cap the row height.** A cap is a truncation
with extra steps — it hides content and offers no way to reach it, which is
exactly what 0010 forbids.

**Gate the scroller behind `min-width: 768px`.** Below the breakpoint the
transactions page shows this row, above it the table, so the scroller would
exist only where it is needed — no scrollbar height on desktop, and no
scrollbar-click to guard. Rejected because the dashboard's Recent Transactions
card renders the same row at every width, so the behaviour would differ between
two places showing the same component, and the rule would be harder to state
than the guard it avoids.

**Reduce the tag cap instead.** Fewer chips is less strip, but it trades a
layout problem for an information one and does nothing for a long category name
or a long location, which were half the width.
