# 151. The frozen accessibility findings are fixed, and the freezes stay empty

**Status:** Accepted, implemented · **Date:** 2026-09-24 · **Issues:** #459

Reference documentation lives in [../accessibility.md](../accessibility.md)
and [../emulator-blind-spots.md](../emulator-blind-spots.md).

Closes the first gap of
[0145](0145-a-class-found-by-reading-becomes-a-gate.md) — the eight
accessibility defects it named and froze — and the two *Known gaps* in
`accessibility.md` that listed them. The freeze tables 0145 introduced stay,
empty.

## Context

0145 put an axe-core pass into the smoke walkthrough and a contrast gate over
the colour tokens. Both found real defects on their first run, on surfaces
that work had no business rewriting, and both froze what they found by name,
in a table the gate reads: three axe rules across six routes, four token
pairs under WCAG AA, and one transition that outran the reduced-motion
kill-switch. A frozen row is a floor that may only improve. This is the list
behind the floors.

**No progress indicator had a name.** Material renders `mat-spinner` and
`mat-progress-bar` as `role="progressbar"` with no content to take a name
from, so axe's `aria-progressbar-name` fired on five of the seven routes the
walkthrough opens. Twenty-five indicators in the tree carried nothing, the
shared `LoadingSpinnerComponent` among them — and some sat inside a button
whose own text already said what was happening, where a name would say it
twice.

**The contrast freeze had gone stale the other way.** The two sites axe had
named on `/dashboard` and `/transactions` were already fixed, but the freeze
was by rule id per route, so it now hid whatever else fired under
`color-contrast` on those two routes. On the CI runner, which renders the
light theme, that included the category chip on `/transactions`: its tile
paints a category's own colour on a tint of that colour, and the orange
tile's icon measured 1.95:1 (`#ff9800` on `#fff2df`). The runs that emptied
the freeze rendered dark, where the chip passed, so CI's light run was the
first to report it.

**The transaction row was a button around buttons.** The wrapper was
`role="button"` with a tab stop and its own click, Enter and Space handlers,
and inside it sat the swipe drawer's Edit and Delete, the projected menu
trigger and the maps link. A button's descendants are presentational to
assistive technology, so the controls inside were flattened away —
`nested-interactive` on `/transactions`.

**Four token pairs painted a fill as text.** The transaction form's and the
recurring dialog's type toggles painted `--color-income` and
`--color-expense` on their own tints (2.07 and 3.08:1 in light), where the
`-text` tokens for exactly that already existed. The login error banner and
the filters' clear button on hover painted `--color-error` on
`--color-error-light` (3.00:1 in dark), with no `-text` token to reach for.
The neutral stat-card icon, the import preview's receipt badge, the period
selector's selected toggle and the bottom navigation's active pill painted
`--color-primary` on `--color-primary-light` (2.60:1 in dark). Two more sites
painted `--color-accent` on the same tint and were in no table at all.

**The sign-in button's `transition: all 0.2s ease !important`** tied the
global reduced-motion kill-switch on importance and beat it on specificity,
so the button kept easing for a user who had asked for no motion.

## Decision

**Each finding is fixed where it is painted, and each freeze table stays,
empty, so the next finding fails the build and joins a list only as a row
that gives its reason.**

### The row's first line is a native button beside its controls

The wrapper, `div.transaction-row`, has no role, no tab stop and no listener
of its own. The row's first line — description and amount, `.row-head` — is a
`<button type="button" class="row-head row-activate">`, named by
`transactions.rowLabel`: *{description}, {amount}, {date}*, the amount the
same `signedAmount()` string the row shows. Nothing interactive sits inside
it. Its siblings are the category strip, `.row-category`, which holds the maps
link, and the date line, `.row-meta`.

**The button is `.row-head`, not a wrapper round it.** `.row-body >
.row-head`, the flex line, `touch-action` and the `~` reserve padding that
keeps the amount clear of the menu all apply to it unchanged. Its reset is
spelled out property by property rather than `all: unset`, which would reset
`box-sizing` to `content-box` and push the 44px reserve past the row's edge,
and it uses logical properties only, since the physical-direction baseline is
frozen.

**The keyboard through the button, the pointer through the host.** The
component declares `host: { '(click)': 'onActivate($event)',
'(keydown.escape)': 'closeSwipe()' }`. A native button turns Enter or Space
into exactly one `click`, which bubbles to the host, and nothing in the row
turns either key into an activation of its own — the swipe directive's
capture-phase `keydown` listener only stands its post-drag guard down — so one
press is one activation. A click anywhere else on the row, the category strip
included, reaches the same listener, which ignores a click on the strip's own
scrollbar ([0012](0012-a-strip-scrolls-rather-than-growing-the-row.md)'s
filter) and a click inside any button, link or menu item of the row other than
`.row-activate`: the drawer's buttons, the maps link and the projected menu
trigger each keep their own click. The listeners live on the host because the
template accessibility lint refuses a click or key listener on an element that
cannot take focus, and host bindings are not template-linted. Escape anywhere
in the row closes the drawer.

**The menu comes first, and carries the row's name.** `.row-actions` has to
stay the surface's first child — the reserve rules are `~` sibling selectors
keyed on it — so in DOM order, which is Tab order here, the projected menu
button precedes the row button. It no longer sits inside a named row, so it
names its own: *More actions for {description}* (`common.moreActionsFor`).

**A split part is still said to be one.** The button's `aria-label` replaces
the name its content would compute, which would silence the split badge's
label inside it — the only way a screen reader learns the row is part of a
larger purchase. On a split part the button carries `aria-describedby`
pointing at the badge.

**The focus ring is drawn on the row.** The button's own outline is removed,
and `.transaction-row:has(.row-activate:focus-visible)` draws a 2px ring
inset — the list and the dashboard card both clip at the row's edge — with the
3px high-contrast variant beside it.

### A progress indicator is named, or hidden inside the control that names it

Every one of the twenty-five is one or the other.

- **The shared spinner names itself**: its `message` when the caller gives
  one, `common.loading` otherwise.
- **Nine standalone indicators carry a translated label**: the dashboard's
  refetch bar (`dashboard.refreshing`), the two budget bars
  (`budgets.progressLabel`, with the budget's name and percentage), the goal
  bar (`goals.progressLabel`), the wizard's two progress bars
  (`import.progressLabel`), the data page's import bar
  (`settings.importProgressLabel`), the receipt tile's spinner
  (`receipts.loading`) and the account-deletion bar (`common.loading`).
- **Fifteen carry a literal `aria-hidden="true"`**: each sits inside a
  control that already says what is happening — by its visible text, its own
  label, or a labelled spinner beside it — or under a parent that is already
  hidden, where the tag repeats the attribute because a per-tag gate cannot
  see a parent. Five of them sat in buttons that said nothing while busy,
  which the next paragraph answers.

**A button whose label a spinner replaces keeps its name.** Five buttons swap
their text for a spinner while busy — the three *Test API key* buttons, the
transaction form's submit and the camera's process button — so hiding the
spinner would leave a button with no name at all. Each carries `aria-busy`
while it is busy and, only then, its idle label as `aria-label`; idle, the
attribute is absent and the visible text names it as before. Each branch of
the label's ternary is piped on its own, since `i18n:check` reads a quoted
literal immediately before `| translate` and would not see one inside a piped
ternary.

**The gate.** `icon-labels:check` gains a second rule: a `mat-spinner`,
`mat-progress-bar` or `mat-progress-spinner` needs an `aria-label` in any
form, an `aria-labelledby`, or a literal `aria-hidden="true"`. Only `"true"`:
unlike the icon rule, nothing reads this attribute at construction, so
`"false"` or a bound value hides nothing and names nothing. The script's file
skip widened so a template with an indicator and no icon is still read, and
its header states what the rule cannot see.

### Two text tokens name the foreground

`--color-error-text` (`#b91c1c` light, `#fecaca` dark) and
`--color-primary-text` (`#3F51B5` light, `#c5cae9` dark) are declared beside
their families. The light primary value is the fill's own, because the light
pairing never failed; the dark one is lightened. On their tints they measure
5.30 and 5.74:1, and 6.15 and 5.56:1.

- The two type toggles and the recurring dialog's frequency preview moved to
  the income and expense `-text` tokens, and so did the five other places that
  painted those fills as text — the monthly comparison, the snapshot
  comparison and the recurring list on the reports page. That is what lets
  `NOT_PAINTED` say of `--color-income` and `--color-expense` what is now
  true: a fill for bars, dots and the toggles' tints, never text.
- The login banner's text and the filters' clear button on hover, where the
  tint appears behind it, moved to `--color-error-text`.
- The neutral stat-card tone, the preview's receipt badge, the period
  selector's toggle text and its `.period-chip`, the active bottom-navigation
  pill and the profile page's checked toggle moved to
  `--color-primary-text` — the period chip and the profile toggle from
  `--color-accent`.
- The review card's failure reason
  ([0149](0149-the-review-step-says-what-it-changed.md)) wears
  `--color-error-text` from the start.

`KNOWN_FAILURES` is empty. The gate scores eighteen required pairs in all four
rendered modes.

### Three light-grey texts move onto `--text-muted`

With `color-contrast` unfrozen, the run in dark reported one node: the count
beside the Transactions title, whose `dark:` variant — gray-500 on the dark
page — reads 3.87:1. It moved to a component class on `--text-muted` (6.93:1
in light, 7.38:1 in dark), and so did two siblings on the same Tailwind
pairs: the budget period on the dashboard's budget card, which renders only
once a budget is active and which axe did not report, and the dashboard's
subtitle.

**The subtitle fails in light only**, gray-500 on the light page background at
4.43:1, and its `dark:` partner passes. The walkthrough's account keeps the
default `theme: 'system'` and nothing in the harness pins a colour scheme, so
the pass renders whichever theme the host's `prefers-color-scheme` resolves,
one per run: light on the CI runner, dark on a Mac in dark mode. The runs
that unfroze the rule rendered dark and could not see the subtitle; CI's
light run renders it, but `/dashboard`'s rule-id freeze hid every
`color-contrast` node on that route. It was found by reading the pairs, and
CI's light run now passes it.

### A category's colour is moved until it reads on its own tint

`CategoryChipComponent` paints a category's icon — and, as a pill, its label
— in the category's colour on a tint of the same colour. The tint was that
colour at alpha `0x20` in light and `0x40` in dark, and the foreground was
the colour itself in light and the colour lightened 30% in dark, so a light
category colour could not clear AA in light whatever lay beneath.

**The tint is composited once and painted opaque.** A chip is rendered on the
transaction list's card, on Material cards on the dashboard, budgets and
reports, on the settings category list's `--surface-subtle`, and under a
row's hover and highlight tones, and a translucent tint takes on whichever
is underneath, so no one foreground could be shown to clear AA on all of
them. The tint is now mixed over `--surface-card` — `CHIP_SURFACE`, `#ffffff`
in light and `#1e1e1e` in dark — at the strength it had, and painted opaque:
the icon and the label sit on that colour and no other. Every resting
surface is within 13 levels a channel of the card in either theme, so a tile
looks as it did.

**The foreground moves only as far as it must.** `ensureContrast`, in
`core/utils/color-contrast.utils.ts`, mixes the category's colour towards
black in light and towards white in dark, in a hundred steps, and keeps the
first shade that reaches 4.5:1 on the tile. Mixing towards black or white
moves the lightness and keeps the hue: the orange tile's icon is `#a16000` in
light, at 4.54:1, and a colour that already clears is left as it is, as that
orange is on its dark tint at 4.70:1. Where black or white itself falls
short, the answer is whichever of the two contrasts more. A colour that is
not opaque hex, `#rgb` or `#rrggbb`, cannot be measured: it passes through
unchanged, on the plain card surface. Three-digit hex is read — the budget
card's `#666` fallback used to become `#66620` — and a colour without its
`#` is normalised. Relative luminance uses sRGB's 0.04045 threshold, the one
axe uses.

**The gate is the chip's spec, not `contrast:check`.** A category's colour is
data — picked from the category dialog's palette, or carried in a backup —
so no token table can score it. `category-chip.component.spec.ts` renders a
tile and a pill for every colour in the default catalogue and four hostile
ones (`#FFFF00`, `#FFFFFF`, `#000000`, `#777777`), in both themes, and
measures the computed colour against the computed background by the WCAG
formula written out in the spec rather than the utility's. It asserts the
tile opaque and the hue kept, and holds `CHIP_SURFACE` to the stylesheet's
`--surface-card` in both themes.

### The sign-in transition names what it moves

`transition: background-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s
ease`, with no `!important`. `.google-btn` still outranks Material's own
button rule on specificity, and the kill-switch's `!important` now wins under
reduced motion. The gate is the proof: the login spec runs under
`NoopAnimationsModule`, whose own rule reads zero seconds with the fix or
without it, so a computed-style assertion there could never fail.

### The freezes stay, empty

`KNOWN_VIOLATIONS` and `KNOWN_VIOLATION_REASONS` in
`core/services/testing/axe.ts` are `{}`, `KNOWN_FAILURES` in
`check-contrast.mjs` is `[]`, and `ALLOWED` in `check-motion.mjs` is `{}`.
Every mechanism stays: a violation, a failing pair or an outrunning duration
fails the build, and the only way past is a row with its reason. The axe and
contrast tables' comments call the empty table the goal state; the motion
table's says a repair edits it in the same commit.

**The contrast gate scores only the pairs it is told of.** It reads tokens,
not components, so it cannot see that a stylesheet has started painting a
fill as text. The next such pair is met in one of two places. Written into
`PAIRS`, a ratio under its threshold fails the build, and the pair reaches
`KNOWN_FAILURES` only if someone moves it there by hand, as a row with its
reason and its measured floors. Found by axe's `color-contrast` rule on a
route the walkthrough renders, it fails the smoke walkthrough instead, and is
frozen, if at all, in `axe.ts`'s `KNOWN_VIOLATIONS`, by rule id per route
with its reason — never in `KNOWN_FAILURES`.

An empty production table would have turned its own self-tests vacuous, so
they stopped leaning on it. `unexpectedViolations(results, route, known)`
takes its table as a parameter and the axe spec passes fixture tables of its
own; `check-motion.mjs`'s row check is `allowedRowValid`, which the self-test
runs over fixture rows, a valid one and three it must refuse, as well as over
every row of the live table; and `check-contrast.mjs`'s ratchet is
`frozenRowFinding`, run against a synthetic frozen row at its floor, worse
than it, and clearing its threshold, and its loop is `findingsFor`, which
`run()` hands the production tables and the self-test hands tables of its
own, a frozen row among them.

## What was rejected

- **A stretched `::after` over the row.** `.row-surface` is
  `position: relative` and the swipe directive puts a `transform` on it,
  which makes the surface the overlay's containing block: `inset: 0` covers
  the surface, not the row. And the category strip has to sit above any such
  overlay to stay clickable and trackpad-scrollable, which breaks the pinned
  behaviour that a plain click on the strip opens the row.
- **Moving the controls out of the surface.** The reserve rules that keep the
  amount clear of the menu are `~` sibling selectors on `.row-actions` as the
  surface's first child.
- **Naming every indicator.** A spinner inside a button that already reads
  *Sending...* would be announced twice.
- **Counting `aria-hidden="false"` or a bound `aria-hidden` as an answer** in
  the progress rule. Neither removes the node, and neither names it.
- **Changing `--color-primary` or `--color-error` themselves.** Each passes on
  the card, where most of the sites that paint it sit; what failed was the
  tint beneath a handful. A `-text` token moves those and nothing else.
- **Deleting the freeze tables once empty.** An empty table is the mechanism
  working: the next finding either fails or is recorded, with its reason.
- **A darker foreground on the translucent tint.** The tint takes on the
  surface under it, and a chip sits on half a dozen, so a foreground chosen
  against one could not be shown to clear AA on the rest.
- **Scoring category colours in `contrast:check`.** Its table pairs tokens;
  a category's colour is stored on the category and passes through none.

## Consequences

- **Every route the walkthrough opens is swept with nothing frozen**, and
  `contrast:check` and `motion:check` record nothing.
- **A row on the Transactions list is two tab stops** — its menu, then the
  row — where it was one; a dashboard row, which has no menu, is one.
- **Enter on the row button while the drawer is open closes the drawer**, as a
  tap does: the synthesized click meets the swipe directive's
  tap-while-open guard, which the wrapper's own Enter handler used to bypass.
  A second Enter opens the row. The directive's post-drag guard stands down on
  a key press, so the first Enter after a touch swipe is not taken for the
  click a drag leaves behind.
- **Eight catalog keys**: six indicator labels and the two row names. The
  labels open three new top-level namespaces, `budgets`, `goals` and
  `receipts`, beside the existing `budget`, `goal` and `receiptImages`.
- **A theme leaked between specs, and no longer does.**
  `chart-theme.service.spec.ts` keeps the real document — its service reads
  live computed styles — and a case that set the dark theme stamped
  `dark-theme` on the real root and never took it off, so whichever spec ran
  next and read a computed colour read the dark palette. The file now clears
  both theme classes after each case, and the budget card's assertion
  resolves `--text-muted` at the moment it compares.
- **A category tile is opaque.** On a hovered or highlighted row it keeps its
  resting colour rather than taking on the row's tone, and a light
  category's icon and label read darker in light than the colour picked for
  it.
- **Nothing deploys.** Styles, templates, components and scripts only.

## Departures from the issue

- **The contrast unfreeze fixed three sites, not two.** The issue named the
  count and the budget period. Axe reported the count alone; the budget
  period moved because it is the same failing pair, and the subtitle because
  its light pairing fails, on a route whose freeze hid it from the light run.
- **The category chip was not in the issue.** It failed in light only, and
  surfaced when CI's light run met the emptied freeze on `/transactions`.
- **The busy buttons were not in the issue.** Hiding their spinners was; a
  button whose only content is a hidden spinner has no name, so they carry
  one while busy.
- **The row's split badge needed a description**, which the issue could not
  have named: it is the button's own label that silences the badge.
- **Five more fill-as-text sites moved**, so that the reason recorded for the
  two fills is true.

## Things that only became apparent while building

- **The pass renders one theme, the host's**: light on the CI runner, dark on
  a Mac in dark mode. The subtitle is the case a dark run cannot see, and the
  category chip the case a green run in dark let through to CI.
- **The pass measures above the fold only.** The orange tile failed at 1.95:1
  on `/dashboard` (two chips) and `/budgets` (one) as well, and axe reported
  neither: Karma's frame was 413px tall where it was measured, and those
  chips sat below it. Only the `/transactions` rows sat inside it.
- **A spec leaked the dark theme into the rest of the suite.** A colour
  assertion that passed alone failed in the full run, deterministically, at
  the same place.
- **`all: unset` would have broken the reserve**, by way of `box-sizing`.
- **A per-tag gate cannot see a parent's `aria-hidden`.** The two spinners in
  the list's edge rows sit under a hidden row and repeat the attribute so the
  gate can read it.
- **A piped ternary hides its literals from `i18n:check`.**
- **An empty table makes the self-test that reads it vacuous**, in all three
  freezes: the axe spec, the motion gate and the contrast gate.
- **A touch drag leaves no click behind.** The swipe directive swallows the
  click that follows a drag and waited for it until the next pointerdown; a
  touch that travelled is no tap, so none came, and the first Enter on the row
  button after a swipe was swallowed in its place — neither closing the drawer
  nor opening the row. A key press now stands the guard down, except mid-drag,
  where the click is still to come.

## Known gaps

- **Eighteen places still paint `--color-error` as a foreground on the card**,
  where it measures 3.76:1 in light (6.03:1 in dark). Twenty lines match the
  pattern `color: var(--color-error)`; two of them set a border colour. The
  eighteen are in the security activity list, the security settings, the app
  lock, the filters' clear button at rest, the transaction form, the split
  parts, the receipt viewer, the import wizard (two), the duplicate warning,
  the file dropzone (three), the import preview table, the recurring rules
  page (two), the data page and the note translation. No freeze named them:
  the contrast table scores `--color-error` on its tint, not on the card, and
  the axe pass measures only what is on screen, in one theme.
- **The axe pass renders one theme per run, the host's** — light on the CI
  runner, dark on a Mac in dark mode. A failure that exists only in the other
  theme is invisible to that run, no run prints which theme it rendered, and
  nothing committed pins one; a developer runs the other through a Karma
  launcher of their own, as
  [../emulator-blind-spots.md](../emulator-blind-spots.md) describes. 0145's
  other bounds stand: a phone-width audit of seven routes.
- **The axe pass measures only what is above the fold.** `color-contrast`
  reports no node below Karma's frame, so a failure further down a route
  goes unreported, as the orange tile's did on `/dashboard` and `/budgets`.
- **Three places paint a category's colour on its own tint without the
  chip.** The dashboard's upcoming bills, the recurring rules page and the
  category dialog's preview each set the colour with `20` appended as the
  background and the raw colour on the icon, so a light category fails there
  as it did in the chip.
- **The row's name repeats.** The menu button before it names the
  description, and the date line after it is read again; and the button's
  label silences the receipt count inside it.
- **The row's focus ring is unpinned.** No spec asserts it; journey 56 of the
  browser protocol reads it.
- **The desktop table's row menu keeps the generic *More actions*.** It sits
  in a table row that gives it context; the list row no longer does, which is
  why only the list's menu names its row.
- **The motion gate's row check accepts any non-empty reason**, where it once
  wanted more than twenty characters.
- **The import wizard's three indicators are proven by the gate alone.** The
  walkthrough never opens `/import/file`.
- **The progress rule reads literal forms.** A label that says nothing useful
  passes it, and so does a hidden indicator inside a control that does not in
  fact announce the state.
