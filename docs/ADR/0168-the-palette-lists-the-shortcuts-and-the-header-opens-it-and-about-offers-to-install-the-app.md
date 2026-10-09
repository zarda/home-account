# 168. The palette lists the shortcuts and the header opens it, and About offers to install the app

**Status:** Accepted, implemented · **Date:** 2026-10-08 · **Issues:** #446

Reference documentation lives in [../shortcuts.md](../shortcuts.md) and
[../pwa.md](../pwa.md), a new document that owns `PwaService`.

Amends
[0112](0112-pwaservice-keeps-only-the-surface-something-calls.md): its rule
stands and is applied again, since `canPromptInstall` and `promptInstall()`
join the surface because About calls them, but its decision not to listen
to `beforeinstallprompt` does not. `PwaService` now holds the event, still
without `preventDefault`, so the browser keeps its own install UI. Closes
two of 0112's Known gaps: there is an in-app install affordance on
Chromium browsers and on iOS, and the app itself now says how to add it to
the Home Screen. A Firefox or desktop Safari user still gets nothing; see
Known gaps.

Closes two Known gaps of
[0073](0073-shortcuts-live-in-the-shell-and-the-palette-reads-the-sidebars-list.md):
the shortcuts are not discoverable, and the palette has no touch entry.
Leaves standing its gaps that no shortcut is rebindable and that the
palette lists destinations, not content. 0073's guard chains stand, and
the new key takes the `n` hotkey's.

## Context

#446 collected two "the surface exists, nobody is led to it" gaps.
[0167](0167-a-notification-carries-its-route-and-a-tap-lands-on-it-and-the-recap-nudge-needs-a-week-with-news.md)
takes the first, the tap; this record takes the second. At `c47d6f26`:

- **The shortcuts.** No template carried a `<kbd>`, `en.json` named no
  `Ctrl+K`, and nothing in the header or any other visible control opened
  the palette; only the Ctrl/Cmd+K binding in `MainLayoutComponent` did.
  Nothing in the app named either shortcut, so only someone who already
  knew the chord could open the palette. On a touch screen nothing opened
  it at all.
- **The install.** `PwaService` offered no install affordance, and the iOS
  Add to Home Screen steps lived only in the README. `checkIsIOS()`
  matched `iphone`, `ipad` or `ipod` in the user agent, which iPadOS Safari
  does not carry: it asks for the desktop site, and its user agent reads as
  a Mac's.

The user's scope answers on 2026-10-03 shaped the rest: `?` opens the
palette on a Shortcuts section; a palette button in the header, which also
gives a touch screen a way in; a one-time hint on desktop; and an About
card that offers Chrome's prompt without suppressing Chrome's own install
UI, lists the steps on iOS, and shows nothing in the native app.

## Decision

**`?` opens the palette on a section listing all three shortcuts. The
header carries a palette button at every width, and on desktop a hint,
shown once per device, that `?` exists. About offers to install the app:
the prompt the browser handed over where there is one, the Home Screen
steps on iOS, and nothing where the app is installed or the browser offers
neither. `PwaService` holds the browser's prompt and never suppresses the
browser's own.**

### `?`

`MainLayoutComponent`'s host map binds it twice, as `keydown.?` and
`keydown.shift.?`. Angular folds Shift into the key it matches, so a US
layout's Shift+/ arrives as `shift.?`, while a layout with an unshifted `?`
sends it bare.

`KeyboardShortcutService.handleHelpHotkey` runs the `n` hotkey's three
guards in its order: an IME composition, an open dialog (so there is never
a second palette), and `ownsTypedKey(event.target)`. Only then does it
`preventDefault()` and open the palette with `data: { section: 'shortcuts' }`.
As with `n`, a key it stands down for is not claimed, because `?` typed
into a field is text. The palette `?` opens is the tracked one, so
Ctrl/Cmd+K toggles it closed. Ctrl/Cmd+K's own dialog config is unchanged
and carries no data.

`ownsTypedKey` is `n`'s third guard moved into `core/utils/keyboard.utils.ts`
with its selector unchanged: native text entry, and the Material widgets
that read printable letters as typeahead, reached by their ARIA roles and
the overlay pane.

### The Shortcuts section

The palette reads `MAT_DIALOG_DATA` as optional. The section shows whenever
the search box is empty (`showShortcuts`): first when the palette was
opened by `?` (`shortcutsFirst`), and after the actions otherwise. It is
never in `filtered()`, and nothing in it is a `.palette-item` or focusable,
so Enter and the arrow keys never reach it.

It is a `<dl>` of three rows, each a `<dt>` of `<kbd>` keys beside a `<dd>`
saying what the keys do:

| Keys | Label key |
|---|---|
| `n` | `shortcuts.addTransaction` |
| `Ctrl` + `K` / `⌘` `K` | `shortcuts.openPalette` |
| `?` | `shortcuts.showShortcuts` |

Both modifiers are shown, because nothing in the app detects the platform.
Each chord is one unbreakable group (`.shortcut-chord`), so the keys column
wraps only between chords. The section is part of the palette's own
template, an `ng-template` placed through `NgTemplateOutlet`, and uses the
palette's section and title classes. The key caps paint `--text-primary` on
`--surface-muted` with a `--border-strong` edge, a pair `contrast:check`
now scores.

### The header's door, and its hint

**The palette button** (`.palette-button`) sits before Smart Search at
every width. It shows the palette's own `bolt` icon, is named and tooltipped
`palette.title`, and carries `aria-haspopup="dialog"`. It calls
`KeyboardShortcutService.openPalette()`, which opens the plain palette, the
tracked one Ctrl/Cmd+K toggles closed, and does nothing over an open
dialog.

**The hint** (`.shortcuts-hint`) shows at `APP_BREAKPOINTS.desktop`, 1024 px
and up, while `homeaccount.shortcuts-hint-dismissed` is absent from
`localStorage`.

- **Per device.** The key lives in the device's storage, beside the
  sidebar's collapsed state, not on the account.
- **Where.** It hangs off the palette button's start side, absolutely
  positioned inside the 64 px toolbar band, so the wordmark and the buttons
  do not move. It comes before the button in the DOM, so focus meets it in
  the order it is drawn.
- **What.** A decorative `keyboard` icon, `shortcuts.hint` as text, and a
  32 px dismiss button named `shortcuts.hintDismiss`.
- **Retired by any door.** Its dismiss, and the first time any palette
  opens, from the button, Ctrl/Cmd+K or `?`
  (`KeyboardShortcutService.paletteOpened`), both write the key. The
  palette lists every shortcut whenever its search is empty, so once it has
  opened the hint has nothing left to say.
- **Focus.** Dismissing the hint hands focus to the palette button, and so
  does closing a palette opened by a key pressed on the dismiss.
- **Storage that refuses.** A read that throws counts as dismissed: storage
  that cannot be read could never keep a dismissal either, so the hint
  would return on every launch. A write that throws still hides the hint,
  for as long as this header lives.

### The install card

`PwaService` gains the install prompt under 0112's own rule, a member for a
caller that uses it:

- **The `beforeinstallprompt` listener holds the event and never calls
  `preventDefault()`.** In the native app the listener is not attached at
  all.
- **`canPromptInstall`** is true while an event is held.
- **`promptInstall()`** lets the event go before prompting, because an
  event prompts once, and calls `prompt()` before any await, because
  `prompt()` needs the click's user activation. It never rejects; a refusal
  is logged.
- **`appinstalled`** still marks the app standalone, and now clears the held
  event too.
- **`checkIsIOS()`** also counts a user agent that says Macintosh with
  `navigator.maxTouchPoints > 1`: iPadOS Safari asking for the desktop
  site. No Mac reports touch points.

About's `installOffer` picks one of three states:

| When | The card |
|---|---|
| The native app, or `isStandalone()` | None |
| `canPromptInstall()` | `about.install.promptDescription` and an **Install** button that raises the held prompt |
| `isIOS()` | `about.install.iosDescription` and the three steps, in order, with no button |
| Otherwise | None |

The native app is named as well as standalone, though the service already
reports it standalone, because a store build must never carry a web install
offer. The card sits between the welcome card and the feedback card and is
styled by the welcome card's classes. **Install** moves focus to the
feedback button and then raises the prompt; the card leaves with the spent
event.

## What was rejected

- **A lazy Shortcuts section.** Measured, it was 40 B smaller in the
  initial bundle than the inline one, and it shipped that way first. It is
  inline because of what the lazy one did; see *Things that only became
  apparent*.
- **Suppressing the browser's own install UI** so the card is the only
  door. That was 0112's defect: an app that hid Chrome's install UI on
  every visit, including every page that offers nothing in its place. The
  card is a second door, not a replacement.
- **One modifier, chosen by platform.** Nothing in the app detects the
  platform, and a guess from the user agent is what had iPadOS reading as a
  Mac.
- **The hint below the toolbar.** It covered page actions until it was
  dismissed; see *Things that only became apparent*.
- **The hint below desktop widths.** The button is the touch screen's door,
  and `?` needs a keyboard.
- **A session-wide flag for a write that storage refuses.** It cost 187 B of
  initial bundle for storage that answers reads and refuses writes, which a
  desktop browser does only with its quota full.
- **A help overlay of its own.** The palette is already a dialog with a
  focus trap, Escape, and the guards both hotkeys read. `?` opens it on the
  list instead.

## Consequences

- **Three shortcuts, each named in the app.** The palette lists all three,
  and its button reaches it from a touch screen.
- **New i18n keys** in en, ja and tc: `palette.sectionShortcuts`,
  `shortcuts.addTransaction`, `shortcuts.openPalette`,
  `shortcuts.showShortcuts`, `shortcuts.hint`, `shortcuts.hintDismiss`, and
  seven under `about.install`: `cardTitle`, `promptDescription`, `button`,
  `iosDescription`, `iosStepShare`, `iosStepAdd` and `iosStepConfirm`. The
  button reuses `palette.title`.
- **A `contrast:check` row** for the key caps.
- **A Chromium browser that hands over its prompt shows both doors**, its
  own install UI and the card.
- **iPad Safari now counts as iOS.** The camera's Home Screen hint, shown
  for `isIOS() && !isStandalone()`, reaches it too, and About lists the
  steps there.
- **The initial bundle carries `?` and the section**, about 2.5 kB, **the
  header's button and hint**, about 2.8 kB, and **the prompt in
  `PwaService`**, about 0.5 kB. The About card is in About's lazy chunk.

## Departures from the issue

- **The header carries a palette button, at every width.** #446 proposed
  the `?` key and a one-time desktop hint. The button is the user's
  addition, and it is what closes 0073's touch gap.
- **Any opening of the palette retires the hint**, not only its dismiss,
  since the palette then shows the list the hint points at.
- **`?` works at any width with a keyboard.** Only the hint is desktop-only.
- **The install card has three states, not one.** The issue asked for an
  install card on the About page. It offers the browser's prompt, lists the
  steps on iOS, and shows nothing in the native app, by the user's scope
  answer.

## Things that only became apparent while building

- **A lazy section went missing from a first open made offline.** Loaded
  through a dynamic import, the section arrived after the palette: opened
  by `?`, *Go to* moved down once as it popped in above it, and a first open
  with no network showed the palette without it. Inline, it renders with
  the palette for 40 B more. Pinned by `command-palette.component.spec.ts`
  "is in the DOM on the very first open, after one render and nothing
  awaited, and stays".
- **A chord split across lines.** In the browser, the keys column wrapped
  `⌘ K` with `⌘` at the end of one line and `K` alone on the next, which
  reads as two shortcuts. Each chord is now a group that does not wrap.
  Pinned by "never splits a chord across lines at 520 px" and at 288 px.
- **The hint below the toolbar covered the page.** Hung below the header at
  the inline end, at 1440 px it lay over the page's own header actions, such
  as `/transactions`' Add button, until it was dismissed. It moved into the
  toolbar band, outside the row's flow. Pinned by `header.overflow.spec.ts`
  "overflow guard: the header with the ? hint at 1024 px" in en, ja and tc.
- **Two controls took focus with them when they left.** Dismissing the hint
  dropped a keyboard user on the page, and so did **Install**:
  `promptInstall()` lets the event go in the click's own task, so the card,
  and the focused button with it, went on the next render. The dismiss now
  hands focus to the palette button, and **Install** moves it to the
  feedback button before it raises the prompt. Moving focus does not spend
  the user activation `prompt()` needs. Pinned by "hands focus to the
  palette button when the hint is dismissed, so a keyboard keeps its place"
  and "hands focus on to the feedback button as it leaves, rather than
  dropping it on the page".
- **A palette opened from the dismiss closed onto the page.** `?` or
  Ctrl/Cmd+K pressed on the dismiss retires the hint as the palette opens,
  so the dialog had only the departed button to restore focus to. A palette
  opened from inside the hint now restores focus to the palette button
  (`restoreFocus`). Pinned by `header.component.spec.ts` "hands focus to the
  palette button when ? on the dismiss opens a palette that then closes",
  and its Ctrl+K twin.
- **0112's pin had a title that stopped being true.** Its case *ignores
  beforeinstallprompt* still asserts `preventDefault` is not called, but the
  service no longer ignores the event. It is now *captures
  beforeinstallprompt without preventDefault, so the browser keeps its own
  install UI*, and *can offer the prompt once the browser hands one over*
  asserts the event is held.

## Known gaps

- **Whether Chrome raises its dialog for a held event was not seen.** The
  browser the run used is embedded and has no install UI, so the card was
  driven with a dispatched `beforeinstallprompt` carrying a stubbed
  `prompt()`. That proves the wiring: one prompt, the card gone, focus on
  the feedback button. Chrome's own dialog was not checked.
- **Firefox and desktop Safari get no card.** Neither hands over a prompt,
  and neither is iOS, so About offers nothing there.
- **The iOS steps name Safari.** Another browser on iOS also reports iPhone
  or iPad in its user agent and gets the same steps.
- **The iOS branch is proven by unit specs only.** The browser run cannot
  present an iOS user agent with touch points.
- **A prompt fired before the service exists is missed.** The listener is
  attached when `PwaService` is first constructed, during app
  initialisation. Chrome fires `beforeinstallprompt` after the page loads,
  so this is unlikely.
- **The hint returns after a lock where storage refuses writes.** The lock
  screen is outside the shell, so unlocking mounts a new header, which
  reads no dismissal.
- **No shortcut is rebindable**, `?` included, and the palette still lists
  destinations, not content. Both are 0073's, unchanged.
