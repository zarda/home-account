# Keyboard shortcuts and the command palette

Two global shortcuts, both scoped to the signed-in shell. The reasoning and the
rejected alternatives are in
[ADR 0073](ADR/0073-shortcuts-live-in-the-shell-and-the-palette-reads-the-sidebars-list.md).

| Key | What it does |
|---|---|
| `n` | Opens the add-transaction dialog |
| `Ctrl+K` / `Cmd+K` | Toggles the command palette |

## Where they are bound

`MainLayoutComponent`'s host map — nowhere else:

```ts
host: {
  '(document:keydown.n)': 'onAddHotkey($event)',
  '(document:keydown.control.k)': 'onPaletteHotkey($event)',
  '(document:keydown.meta.k)': 'onPaletteHotkey($event)',
}
```

`/login` and `/lock` are top-level routes **outside** this layout, so a
signed-out or locked session can never receive a shortcut. That is a property
of the routing, not a check anybody has to remember to add.

Two lines for the chord because Angular matches the modifier by name, not by
platform: `control.k` is the Windows/Linux chord, `meta.k` the macOS one.

The handlers take `Event` and narrow to `KeyboardEvent`. A host binding's
`$event` is typed `Event` however specific the key qualifier is; declaring
`KeyboardEvent` in the signature compiles under the test tsconfig and fails
`ng build`.

`KeyboardShortcutService` holds all the logic. The layout only forwards.

## The guard chains

They are different on purpose. Adding a guard to one is not a reason to add it
to the other.

### `n` — three guards, in order

1. **IME composition.** A kana or zhuyin confirmation committing the key
   reaches keydown handlers with `isComposing` set (`keyCode` 229 on older
   engines). Reuses `core/utils/keyboard.utils`' `isImeComposition`.
2. **A dialog is already open** (`dialog.openDialogs.length > 0`). The user is
   mid-form, or focused on a confirm button inside one.
3. **A text-entry target** — `input`, `textarea`, `select`, `[contenteditable]`,
   matched with `closest()` so a node *inside* a contenteditable region counts.
   The user is typing `n`, not invoking it.

Only once all three pass does the key `preventDefault()` and open the dialog.
`n` is a single unmodified letter, which is cheap to press by accident; these
guards are what make that acceptable, and they are the first thing to check if
it ever fires when it should not.

### `Ctrl/Cmd+K` — the IME guard, then deliberately not the others

- **No text-entry guard.** A palette has to be summonable from wherever the
  user's hands already are, the transaction search box included. `n` stands
  down in a text field because `n` is a letter somebody is typing; `Ctrl+K` is
  not a letter anybody types.
- **`preventDefault()` on every path**, including the ones that then do
  nothing. Shadowing the browser's own `Ctrl/Cmd+K` — focus the address bar or
  the search field — is the point of claiming the chord at all. A branch that
  let it through would teach the user that the palette is unreliable rather
  than that this particular dialog does not offer one.
- **The palette's own dialog toggles.** A second press closes it.
- **Anybody else's dialog wins.** Mid-form is not the moment to swap the dialog
  out from under a user, and the palette's actions would only stack another
  dialog on top. The key is still swallowed.

## The palette

`Ctrl/Cmd+K`, type a few letters, Enter.

**Go to** lists every destination in the shared nav list — the sidebar's eight
plus three that no navigation *slot* carries (`/search-history`,
`/import/file`, `/import/history`). Those three are still reachable today from
inside a feature — the Smart Search dialog and the Data hub for
`/search-history`, the bottom nav's **Add** menu and the Data page for
`/import/file`, the Data page for `/import/history` — but only the palette
reaches them by name, from anywhere. **Actions** offers Add a transaction and
Scan a receipt, under the same two keys the bottom nav's Add menu uses.

Behaviour worth knowing:

- **Enter in the search box runs the first result.** No arrow key first: the
  handler takes the head of the filtered list, which is the row at the top of
  the panel, because every destination sorts ahead of every action. An empty
  result list leaves Enter inert rather than guessing, and an IME composition
  committing the key is text, not a command.
- **The first activation wins.** `select()` latches, so a double-click on a row
  — or a click landing on the Enter that already chose — cannot queue the
  command twice and stack two add-transaction dialogs.
- **Rows are buttons, not links.** `app.smoke.spec`'s `aria-current` invariant
  asserts exactly one `a.nav-item` marks itself current on every route (see
  [accessibility.md](accessibility.md)); a second set of route links inside a
  dialog would join that count. Enter on a *focused row* activates a button
  natively, so the only Enter handler of ours is the one on the search box,
  where there is nothing native to preserve.
- **Filtering matches the translated label**, case-insensitively, as a
  substring. The memo folds `translationsVersion()`, so an open palette
  re-filters against the new catalog after a language switch instead of
  matching the previous locale's words.
- **Arrow keys move real DOM focus** between rows — `ArrowDown` from the search
  box lands on the first row, and roving stops at both ends. Focus is what a
  screen reader follows; an active-index highlight is not.
- **The result count is announced** on every keystroke, with no debounce.
  `LiveAnnouncer` is polite, so each message replaces the previous one in the
  live region rather than queueing behind it.
- **The chosen command runs after the close, not beside it.** Both action
  branches open a dialog of their own, and starting one while the palette is
  still animating out stacks two dialogs whose focus restoration then fights.

## One nav list, one quick-add seam

Two shared modules make the palette cheap and keep the surfaces honest.

**`shared/layout/nav-items.ts`** is the single list of destinations, consumed by
the sidebar, the bottom nav and the palette:

| Export | What it holds |
|---|---|
| `NAV_ITEMS` | the sidebar's eight, in display order |
| `PALETTE_ONLY_ITEMS` | three destinations that no navigation slot carries |
| `navItemFor(route)` | a lookup across both, which **throws** on an unknown route |

A surface still decides which items it shows — the bottom nav takes five slots,
centre action included. What it no longer decides is what an item is *called*.
Before this the sidebar said `nav.budget` and the bottom nav said `nav.budgets`
for the same route; the `nav.budget` key is now gone from all three catalogs.

**`core/services/quick-add.service.ts`** is the single add-transaction seam.
Every entry point goes through it — the bottom nav, the transactions page, the
transaction list's empty state, the first-run welcome, the `n` hotkey and the
palette — so the dialog config lives in one place.

## Adding a shortcut

1. **Add the host binding to `MainLayoutComponent`**, not a service listener
   and not a component further in. The layout is the scope; anything else has
   to re-derive "is this session signed in and unlocked".
2. **Put the logic in `KeyboardShortcutService`**, as a `handleXHotkey(event:
   KeyboardEvent)`. The layout's handler takes `Event` and narrows.
3. **Start the guard chain with `isImeComposition`.** Always. Three of the
   app's locales use an IME.
4. **Then decide the other two deliberately.** Does an open dialog mean the key
   should stand down (usually yes), and is the key something a person types
   (a bare letter: yes; a chord: no)?
5. **Decide whether to always `preventDefault()`.** If the chord is one the
   browser owns, claim it on every path or not at all.
6. **Spec the guards individually.** `keyboard-shortcut.service.spec.ts` has one
   case per guard and one asserting the two chains have not been folded
   together; that last one is the regression this design is most likely to take.
7. **If it is a new destination or action**, add it to `NAV_ITEMS` or
   `PALETTE_ONLY_ITEMS` so the palette gets it for free, and give the label a
   key in all three catalogs.

## Known gaps

- **Nothing announces that the shortcuts exist.** No hint in the header, no
  help sheet, no `?` overlay. You have to know the chord to find the palette
  that would have told you about it.
- **Neither is rebindable.**
- **Both are keyboard-only.** The bottom nav's Add menu is the touch path;
  the palette has no touch entry point.
- **The palette finds destinations, not content** — no transactions, categories
  or stored searches. Smart Search is a separate surface with no hotkey.
- **`PALETTE_ONLY_ITEMS` is maintained by hand.** Nothing compares it against
  `app.routes.ts`, so a new route no surface shows will be missing until
  somebody adds it.
