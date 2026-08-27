# 73. Shortcuts live in the shell, and the palette reads the sidebar's list

**Status:** Accepted, implemented · **Date:** 2026-08-27 · **Issues:** #80

Declines the third acceptance criterion under
[0048](0048-a-dead-capability-is-removed-not-guarded.md)'s rule, and keeps the
navigation surfaces' accessible-name invariant from
[0055](0055-the-active-route-is-announced-not-only-coloured.md) intact.
Reference documentation lives in [../shortcuts.md](../shortcuts.md).

## Context

#80 asks for three things: an `n` hotkey and a `Ctrl/Cmd+K` command palette
built over the sidebar's nav config, and the unused `SpeedDialFabComponent`
"mounted and functional (**or explicitly removed if superseded**)".

Two facts made the shape of the answer. The nav config was duplicated — the
sidebar had one array, the bottom nav another — and they had already drifted:
the same `/budgets` route was labelled `nav.budget` in one and `nav.budgets` in
the other, so the app called one destination two different things depending on
the width of the window. And `SpeedDialFabComponent` no longer exists: it was
deleted in the #216 sweep, for a `z-index` of 1099/1100 that sat above the CDK
overlay container at 1000 — dialogs and menus would have opened *underneath*
it, breaking an invariant `styles.scss` documents.

## Decision

**The shell owns the keys, one list owns the destinations, and the speed dial
stays deleted.**

### Host map on `MainLayoutComponent`, so login and lock can never receive a key

```
'(document:keydown.n)': 'onAddHotkey($event)',
'(document:keydown.control.k)': 'onPaletteHotkey($event)',
'(document:keydown.meta.k)': 'onPaletteHotkey($event)',
```

`/login` and `/lock` are top-level routes **outside** this layout, so a
signed-out or locked session cannot reach a shortcut — by construction, not by
a route check somebody has to remember to add to a new one. A service holding
its own `document` listener would have fired everywhere and needed exactly that
check.

Two lines for the chord because Angular matches the modifier by name, not by
platform: `control.k` is the Windows/Linux chord and `meta.k` the macOS one,
and a single `keydown.k` with a hand-rolled `event.ctrlKey || event.metaKey`
test gives up the framework's own key normalisation to save one line.

### The guard chains differ on purpose

For `n`, three guards in order, each earning its place:

1. **IME composition** — a kana confirmation committing the key must never be
   read as a command. Reuses `keyboard.utils`' `isImeComposition`.
2. **A dialog is already open** — the user is mid-form, or focused on a confirm
   button inside one; a second `n` must not spawn another form.
3. **A target that already owns the letter.** Two families, one selector.
   Native text entry — `input`, `textarea`, `select`, `[contenteditable]` —
   where the user is typing `n` rather than invoking it. And a Material
   overlay widget whose key manager consumes printable letters for
   first-letter typeahead: `mat-select` (focused trigger or open panel),
   `mat-menu`, a selection list. None of those is a `MatDialog`, so guard 2
   never sees them, and none is a native control, so the tag selectors never
   see them either — they are reached by their ARIA roles (`combobox`,
   `listbox`, `menu`, `menubar`) and by the `.cdk-overlay-pane` the open ones
   render into.

For `Ctrl/Cmd+K`, the IME guard stays first for the same reason and then the
chain deliberately diverges:

- **There is no text-entry guard.** A palette has to be summonable from
  wherever the user's hands already are — the transaction search box included.
  `n` stands down in a text field because `n` is a letter somebody is typing;
  `Ctrl+K` is not a letter anybody types.
- **`preventDefault()` runs on every path**, including the ones that go on to
  do nothing. Shadowing the browser's own `Ctrl/Cmd+K` is the point of claiming
  the chord at all; a branch that let it through would teach the user that the
  palette is unreliable rather than that this particular dialog does not offer
  one.
- **The palette's own dialog toggles; anybody else's wins.** Mid-form is not
  the moment to swap the dialog out from under a user, and the palette's
  actions would only stack another dialog on top of it.

### `NAV_ITEMS` is hoisted, and the drift is retired

`shared/layout/nav-items.ts` holds `NAV_ITEMS` (the sidebar's eight, in display
order), `PALETTE_ONLY_ITEMS`, and `navItemFor(route)`, which **throws** on an
unknown route rather than returning `undefined` — a typo'd route in a caller
has to fail a spec, not render a blank slot.

`PALETTE_ONLY_ITEMS` is the three destinations that no navigation *slot*
carries. Each is still reachable from inside a feature — `/search-history`
from the Smart Search dialog and the Data hub, `/import/file` from the bottom
nav's Add menu and the Data page, `/import/history` from the Data page — so
what the palette adds is a way to reach them **by name**, not a first door.

A surface still decides which items it shows: the bottom nav picks five,
centre action included, because a sixth crowds the labels on a phone. What it
no longer decides is what an item is *called* or which icon it wears. The
`nav.budget` key is deleted from all three catalogs; the drift it caused cannot
recur, because there is no second place to disagree from.

### The palette

`Ctrl/Cmd+K`, type a few letters, Enter. Every destination in both lists plus
two quick actions, filterable, in one `MatDialog`.

- **Rows are `<button>`, not `<a routerLink>`.** Anchors are the obvious
  spelling, and `app.smoke.spec`'s `aria-current` invariant asserts that
  exactly one `a.nav-item` marks itself current on every route — a second set
  of route links living in a dialog would join that count. Buttons also keep
  Enter activation native, with no keydown handler of ours to get wrong.
- **Filtering matches the translated label**, and the memo folds
  `translationsVersion()` for the reason `TranslatePipe` does: the catalog is
  replaced on a language switch under a signal the query knows nothing about,
  so without that read an open palette would keep filtering the previous
  locale's words.
- **Arrow keys move real DOM focus** between rows rather than tracking an
  active index and painting it. Focus is what a screen reader follows, and it
  is the pattern `transaction-filters` already uses to step from its search box
  into the suggestion list. It stops at both ends: the list has a top and a
  bottom.
- **The chosen command runs in `afterClosed`**, never beside the close. Both
  action branches open a dialog of their own, and starting one while the
  palette is still animating out stacks two dialogs whose focus restoration
  then fights — the palette's lands last and pulls focus out of the form the
  user just asked for.
- The result count is announced politely on every keystroke, with no debounce:
  `LiveAnnouncer` is polite, so each message replaces the one before it rather
  than queueing behind it.

Rejected: **a CDK overlay**, which is what #80 proposed. The app has one dialog
surface; `MatDialog` brings the focus trap, focus restoration, the backdrop and
Escape, and — the part that matters here — `dialog.openDialogs`, which is the
value both hotkey guards read. A bare overlay would have needed its own answer
for each of those and would have been invisible to the guard that stops the
`n` hotkey firing over an open form.

### `SpeedDialFabComponent` stays deleted

#80's own criterion offers the escape hatch — *or explicitly removed if
superseded* — and this is the explicit part.

It was already deleted, in the #216 sweep, and
[0048](0048-a-dead-capability-is-removed-not-guarded.md) is the rule it was
deleted under: a path that is neither wired up nor deleted is half-present, and
half-present is the bug. Reinstating it would mean reintroducing a component
whose `z-index` broke the shell's stacking invariant, to duplicate an
affordance that now has three: the bottom nav's Add menu — add, scan, import,
all three through `QuickAddService` — the `n` hotkey, and the palette's own
action rows. **That is the supersession**: the touch counterpart #80 wanted the
speed dial to be already exists, in the surface touch users actually reach for.

## Consequences

- The sidebar, the bottom nav and the palette cannot disagree about a
  destination's label, icon or route. A new destination is one array entry plus
  a key in three catalogs.
- Three routes (`/search-history`, `/import/file`, `/import/history`) become
  reachable **by name, from anywhere**, without joining a navigation surface
  that has no room for them. Each already had a door inside a feature — the
  Smart Search dialog, the bottom nav's Add menu, the Data page — so what is
  new is naming them, not reaching them.
- Every add-transaction entry point in the app now goes through
  `QuickAddService` — six callers, one dialog config.
- The `n` hotkey is a single unmodified letter, which is cheap to press by
  accident. The open-dialog guard and the target guard — native text entry
  plus the overlay widgets that read letters as typeahead — are what make that
  acceptable, and they are the first thing to check if it ever fires when it
  should not.

## Things that only became apparent while building

- **A host binding's `$event` is typed `Event`** however specific the key
  qualifier is. Declaring the handler's parameter as `KeyboardEvent` compiles
  under the test tsconfig and fails `ng build`, which is how it got missed the
  first time. The handlers take `Event` and narrow.
- **The palette's `paletteRef` has to be cleared conditionally.** An
  `afterClosed` that lands after a newer palette has already opened would
  otherwise forget the newer one, and the next `Ctrl+K` would open a second.
- **`navItemFor` throwing is what caught the drift.** Writing the bottom nav's
  five slots as lookups by route meant every route had to exist in the shared
  list before the app would boot at all, which is a stronger check than a spec
  comparing two arrays.

## Known gaps

- **The shortcuts are not discoverable.** Nothing in the UI says `n` or
  `Ctrl+K` exists — no hint in the header, no help sheet, no `?` overlay. The
  palette's own title is the only place either is named, and you have to know
  the chord to see it.
- **Neither shortcut is rebindable**, and `n` may collide with a future
  single-key affordance.
- **Nothing reaches these from a touch device.** Both are keyboard-only by
  nature; the bottom nav's Add menu is the touch path, and the palette has no
  touch entry point at all.
- **The palette lists destinations, not content.** It cannot find a
  transaction, a category or a stored search — the Smart Search dialog is a
  separate surface with a separate hotkey (none).
- **`PALETTE_ONLY_ITEMS` is a manual list.** A new route that no navigation
  surface shows will not appear in the palette unless somebody adds it, and no
  gate compares the list against `app.routes.ts`.
