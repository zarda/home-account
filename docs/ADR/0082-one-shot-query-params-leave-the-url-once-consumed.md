# 82. One-shot query params leave the URL once consumed

**Status:** Accepted, implemented · **Date:** 2026-08-30 · **Issues:** #344

## Context

The transactions page reads four query params. `showAll` and `date` describe
a state the page should be in, and behave that way: they survive a reload,
because "show every date" and "start on this day" are still true the second
time the page opens with them on the URL. `action=add` and `tx` are not
state — each names something to *do once*, read through a route-params
subscription (`action`) or the route snapshot (`tx`) — and neither was ever
removed from the URL after being acted on. Reload the page, restore a
bookmarked tab, navigate away and press Back: the add dialog reopens, or the
shortcut's jump and highlight replay, for a URL that looks identical to the
one that already did that.

## Decision

**One helper strips both one-shot keys from the URL the moment either is
consumed**, navigating with `queryParamsHandling: 'merge'` and
`replaceUrl: true` — the repo's first use of that combination; there was no
existing navigation here to match against. `stripConsumedParams` is called
from two places: right after `tx` is captured in `ngOnInit`, and inside the
`action === 'add'` branch of the query-params subscription, after the add
dialog is scheduled. Both keys are cleared in the same call regardless of
which one fired — the helper does not need to know which of the two
triggered it, only that a one-shot action just ran.

`showAll` and `date` are named nowhere in the call: `queryParamsHandling:
'merge'` keeps every param the navigation does not mention, so the two
state-describing params ride through untouched. `replaceUrl: true` keeps the
browser's Back button pointing at whatever page sent the user here, rather
than at the same URL with its one-shot params still attached.

The merge navigation is itself a query-params change, so the subscription
watching for `action === 'add'` fires again once it lands — reading a params
object with `action` now `undefined`, which the existing `=== 'add'` check
already treats as a no-op. Nothing new guards against a second dialog; the
guard that was already there simply had never been exercised by a change
this shape before.

Every producer of these links already navigates with a fresh query-params
object of its own each time rather than mutating one in place — Import
History's **View transaction** entry sets `tx` fresh per click, and the
dashboard's Recent Transactions "add" shortcut is the one other producer of
`action=add` — so stripping the keys after the fact cannot leave a stale
value for a producer to read back.

## Consequences

- **A URL carrying both `tx` and `action=add` strips twice** — once from the
  `tx` branch, once from the `action` branch, the second a redundant no-op
  navigation over params that are already gone. Accepted, to keep the helper
  answering one question ("clear these two keys") rather than tracking which
  caller already asked it to.

## Known gaps

- **The import wizard's own `?source=share` carries the same class of bug**,
  partially self-protecting only because the share stash it names drains on
  first read — a second read finds nothing, even though the URL still claims
  there is something to find. The param itself still lingers on reload and on
  Back. Left for its own change: it is a different door, with its own
  producer and its own drain semantics, and folding it into this helper would
  couple two pages that do not otherwise share code.
