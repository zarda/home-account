# Keyboard shortcuts and the command palette

Three global shortcuts, all scoped to the signed-in shell, and a palette that
lists them. The reasoning and the rejected alternatives are in
[ADR 0073](ADR/0073-shortcuts-live-in-the-shell-and-the-palette-reads-the-sidebars-list.md);
why `?`, the palette's Shortcuts section, the header's palette button and its
one-time hint exist is in
[ADR 0168](ADR/0168-the-palette-lists-the-shortcuts-and-the-header-opens-it-and-about-offers-to-install-the-app.md).

| Key | What it does |
|---|---|
| `n` | Opens the add-transaction dialog |
| `Ctrl+K` / `Cmd+K` | Toggles the command palette |
| `?` | Opens the command palette on its Shortcuts section |

The header's palette button opens the same palette at every width, and is
the only way in on a touch screen.

## Where they are bound

`MainLayoutComponent`'s host map — nowhere else:

```ts
host: {
  '(document:keydown.n)': 'onAddHotkey($event)',
  '(document:keydown.control.k)': 'onPaletteHotkey($event)',
  '(document:keydown.meta.k)': 'onPaletteHotkey($event)',
  '(document:keydown.?)': 'onHelpHotkey($event)',
  '(document:keydown.shift.?)': 'onHelpHotkey($event)',
}
```

`/login` and `/lock` are top-level routes **outside** this layout, so a
signed-out or locked session can never receive a shortcut. That is a property
of the routing, not a check anybody has to remember to add.

Two lines for the chord because Angular matches the modifier by name, not by
platform: `control.k` is the Windows/Linux chord, `meta.k` the macOS one.

Two lines for `?` too, because Angular folds Shift into the key it matches: a
US layout's Shift+/ arrives as `shift.?`, while a layout with an unshifted `?`
sends it bare.

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
3. **A target that already owns the letter** — `ownsTypedKey(event.target)`
   in `core/utils/keyboard.utils`, matched with `closest()` so a node *inside*
   one counts. Two families share its selector:
   - native text entry — `input`, `textarea`, `select`, `[contenteditable]` —
     where the user is typing `n`, not invoking it;
   - a Material widget whose key manager reads printable letters as
     first-letter typeahead — `mat-select` (its focused trigger or open panel),
     `mat-menu`, a selection list. None of those is a `MatDialog`, so guard 2
     never sees them, and none is a native control, so the tag selectors never
     see them either. They are reached by their ARIA roles (`combobox`,
     `listbox`, `menu`, `menubar`) and by the `.cdk-overlay-pane` the open ones
     render into.

Only once all three pass does the key `preventDefault()` and open the dialog.
`n` is a single unmodified letter, which is cheap to press by accident; these
guards are what make that acceptable, and they are the first thing to check if
it ever fires when it should not.

### `?` — `n`'s three guards, in `n`'s order

`?` is a printable character too, so `handleHelpHotkey` runs the same chain:
an IME composition, an open dialog, a target that owns the key. Only then does
it `preventDefault()` and open the palette with
`data: { section: 'shortcuts' }`.

- **A key it stands down for is not claimed**, as with `n`: a `?` typed into a
  field reaches the field untouched.
- **Never a second palette.** An open dialog, the palette included, stands the
  key down.
- **The palette it opens is the tracked one**, so `Ctrl/Cmd+K` toggles it
  closed.

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
- **The palette's own dialog toggles.** A second press closes it, whichever
  door opened it.
- **Anybody else's dialog wins.** Mid-form is not the moment to swap the dialog
  out from under a user, and the palette's actions would only stack another
  dialog on top. The key is still swallowed.

Its dialog config is exactly `{ width: '520px', maxWidth: '95vw' }`, with no
data; only `?` passes a section.

## The palette

`Ctrl/Cmd+K`, type a few letters, Enter.

**Go to** lists every destination in the shared nav list — the sidebar's nine
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
  Announcements otherwise wait their turn, and a count is current state, so
  the palette announces in `'replace'` mode: each count drops any count still
  waiting, but never a queued event such as a notice or an alert. While typing
  continues, a count goes out at most once a turn — the CDK announcer's delay
  and then the announcer's gap — each the latest count at that moment; when
  typing stops, the last count is the last count placed.
- **The chosen command runs after the close, not beside it.** Both action
  branches open a dialog of their own, and starting one while the palette is
  still animating out stacks two dialogs whose focus restoration then fights.

### The Shortcuts section

A reference list, not commands. The palette reads `MAT_DIALOG_DATA` as
optional and shows the section whenever the search box is empty
(`showShortcuts`): **first** when `?` opened the palette (`shortcutsFirst`),
and after Actions otherwise. Typing hides it, and clearing the query brings it
back.

| Keys | Label |
|---|---|
| `n` | `shortcuts.addTransaction` |
| `Ctrl` + `K` / `⌘` `K` | `shortcuts.openPalette` |
| `?` | `shortcuts.showShortcuts` |

- **It is never a command.** It is not in `filtered()`, and nothing in it is a
  `.palette-item` or focusable, so Enter in the search box and the arrow keys
  never reach it.
- **Markup.** A `<section>` titled `palette.sectionShortcuts`, holding a `<dl>`
  of three rows: a `<dt>` of `<kbd>` keys beside a `<dd>` saying what they do.
- **Both modifiers are shown**, because nothing in the app detects the
  platform. Each chord is one `.shortcut-chord` group that does not wrap, so
  the keys column wraps only between chords; a wrap inside one left `⌘` at the
  end of a line and its `K` alone on the next.
- **It is part of the palette's own template**, an `ng-template` placed through
  `NgTemplateOutlet`, and uses the palette's own section and title classes. It
  is not a lazy component: a lazy section arrived after the palette and was
  missing from a first open made offline.
- **Key caps** paint `--text-primary` on `--surface-muted` with a
  `--border-strong` edge, a pair `contrast:check` scores
  ([accessibility.md](accessibility.md)).

## The header's palette button, and the one-time hint

**The button** (`.palette-button` in `shared/layout/header/`) sits before
Smart Search at every width. It shows the palette's own `bolt` icon, is named
and tooltipped `palette.title`, and carries `aria-haspopup="dialog"`. It calls
`KeyboardShortcutService.openPalette()`, which opens the plain palette — the
tracked one, so `Ctrl/Cmd+K` toggles it closed — and does nothing while any
dialog is open.

**The hint** (`.shortcuts-hint`) says *Press ? to see the keyboard shortcuts*
(`shortcuts.hint`), beside a decorative `keyboard` icon and a 32 px dismiss
button named `shortcuts.hintDismiss`.

| | |
|---|---|
| Shown | At `APP_BREAKPOINTS.desktop` (1024 px and up), while the key below is absent |
| Stored | `homeaccount.shortcuts-hint-dismissed` = `'true'` in `localStorage`: per device and browser profile, not per account, like the sidebar's collapsed state |
| Retired by | Its dismiss, or the first time any palette opens — the button, `Ctrl/Cmd+K` or `?` (`KeyboardShortcutService.paletteOpened`). Both write the key |
| Placed | Absolutely positioned against the palette button's start side, inside the 64 px toolbar band, so the wordmark and the buttons do not move. It comes before the button in the DOM, so focus meets it in the order it is drawn |
| Focus | Dismissing it hands focus to the palette button, and so does closing a palette opened by `?` or `Ctrl/Cmd+K` pressed on the dismiss, since the hint and its dismiss are gone by then (`restoreFocus` on that palette) |

Any opening retires it because the palette lists every shortcut whenever its
search is empty: once it has opened, the hint has nothing left to say. A read
of the key that throws counts as dismissed, since storage that cannot be read
could never keep a dismissal either and the hint would return on every
launch. A write that throws still hides the hint, for as long as this header
lives.

## One nav list, one quick-add seam

Two shared modules make the palette cheap and keep the surfaces honest.

**`shared/layout/nav-items.ts`** is the single list of destinations, consumed by
the sidebar, the bottom nav and the palette:

| Export | What it holds |
|---|---|
| `NAV_ITEMS` | the sidebar's nine, in display order |
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
   to re-derive "is this session signed in and unlocked". A key typed with
   Shift on some layouts and without it on others needs both bindings, as `?`
   has.
2. **Put the logic in `KeyboardShortcutService`**, as a `handleXHotkey(event:
   KeyboardEvent)`. The layout's handler takes `Event` and narrows.
3. **Start the guard chain with `isImeComposition`.** Always. Three of the
   app's locales use an IME.
4. **Then decide the other two deliberately.** Does an open dialog mean the key
   should stand down (usually yes), and is the key something a person types
   (a printable character: yes, so use `ownsTypedKey`; a chord: no)?
5. **Decide whether to always `preventDefault()`.** If the chord is one the
   browser owns, claim it on every path or not at all.
6. **Spec the guards individually.** `keyboard-shortcut.service.spec.ts` has one
   case per guard and one asserting the two chains have not been folded
   together; that last one is the regression this design is most likely to take.
7. **List it in the Shortcuts section**, a row in the palette's
   `ng-template #shortcuts`, with its label under `shortcuts.*` in all three
   catalogs.
8. **If it is a new destination or action**, add it to `NAV_ITEMS` or
   `PALETTE_ONLY_ITEMS` so the palette gets it for free, and give the label a
   key in all three catalogs.

## Verifying it

- `keyboard-shortcut.service.spec.ts`: each guard of each chain; `?` opens the
  palette on its section and claims the key; the palette button's plain
  config; `paletteOpened` after each door.
- `main-layout.component.spec.ts`: a real `?` keydown, with and without Shift,
  reaches the handler and nothing else.
- `command-palette.component.spec.ts`, in a describe that renders the real
  template: the section's place, its `<kbd>` rows, that it is never a command,
  "is in the DOM on the very first open, after one render and nothing
  awaited, and stays", and "never splits a chord across lines" at 520 px and
  288 px.
- `header.component.spec.ts` and `header.overflow.spec.ts`: the button at every
  width; the hint at desktop only, its dismiss, its retirement when the button
  or `?` opens the palette, the focus hand-off, focus back on the palette
  button when a palette opened from the dismiss closes (through the real
  dialog), both storage failures, and the hint inside the toolbar band in en,
  ja and tc at 1024 px.
- Against the emulators, `shortcuts.smoke.spec.ts` "opens the palette on its
  Shortcuts section from '?', passes the axe sweep, and closes on Escape", and
  `add-entrypoints.smoke.spec.ts` audits the header with the hint at 1440 px.

## Known gaps

- **None is rebindable.**
- **The keys are keyboard-only.** On a touch screen the header's palette
  button is the way in, and the bottom nav's Add menu the touch path to the
  add form.
- **The palette finds destinations, not content** — no transactions, categories
  or stored searches. Smart Search is a separate surface with no hotkey.
- **The hint is per device.** Another browser, or this one after its storage
  is cleared, shows it again, though the account has seen it.
- **The hint returns after a lock where storage refuses writes.** The lock
  screen is outside the shell, so unlocking mounts a new header, which reads
  no dismissal. Only storage that answers reads and refuses writes, which a
  desktop browser does with its quota full, reaches this.
- **`PALETTE_ONLY_ITEMS` is still maintained by hand**, but no longer
  silently: `nav-items.spec.ts` compares `NAV_ITEMS` and `PALETTE_ONLY_ITEMS`
  against `app.routes.ts` in both directions, so a loadable route with no
  entry fails the suite, and so does an entry naming a route that no longer
  exists. `login` and `lock` are named exemptions — both are guarded and
  unreachable while the palette exists
  ([ADR 0145](ADR/0145-a-class-found-by-reading-becomes-a-gate.md)).
