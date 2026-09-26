# Accessibility

What the app guarantees to assistive technology, and where each guarantee is
enforced. This is a young document: it covers the rules that exist rather than
a full audit, and the gaps at the end are real.

## The active route is announced

The link for the page you are on carries `aria-current="page"` in **both**
navigation surfaces, and no other link does
(see [ADR 0055](ADR/0055-the-active-route-is-announced-not-only-coloured.md)).

Before this, the active route existed only as a CSS class: eight links
announced identically, and the current page was information sighted users had
and nobody else did.

The attribute is driven by the same activation `RouterLinkActive` already
tracks for the class, so there is no second source of truth and nothing to keep
in sync.

**The mechanism depends on the host element:**

| Host | Input | Why |
|---|---|---|
| Plain anchor (`bottom-nav`) | `ariaCurrentWhenActive="page"` | `RouterLinkActive`'s own input |
| `a mat-list-item` (`sidebar`) | `[activated]="rla.isActive"` | `MatListItem` host-binds `attr.aria-current`, and a host binding overwrites whatever the template sets on that element |

Do not reach for `[attr.aria-current]` on a `mat-list-item`. It reads as though
it works and it does not — the host binding wins. `[activated]` is also what
gets Material's own forced-colors marker for the row.

`MatListItem` answers `'page'` only when the host is an **anchor**. On a
non-anchor list item, `[activated]` gives the visual treatment and no attribute
at all.

## Active state is never conveyed by colour alone

Both navigation surfaces originally expressed "active" as colour plus a font
weight. Forced colors replaces author colours with system ones, so those cues
collapse and only the weight is left.

Every colour-built active treatment carries a `forced-colors` counterpart that
survives the mode — an outline or border, not a heavier font:

- `sidebar.component.scss` — an outline on `.nav-item.active`, alongside the
  trailing dash Material draws for an activated anchor.
- `bottom-nav.component.scss` — an outline on the active item's `.icon-pill`.

These are the first `forced-colors` blocks in `src/`. Nothing checks that a new
one appears when a new colour-only active treatment does.

## Accessible names come from the catalog

An `aria-label` is a user-facing string, so it lives in the translation catalog
like any other (see [ADR 0036](ADR/0036-a-user-facing-string-lives-in-the-catalog.md)
and [i18n.md](i18n.md)).

`npm run i18n:check` enforces this: a hardcoded `aria-label` in a template is
flagged, while `[attr.aria-label]` and `[aria-label]` bound through `translate`
are allowed. The checker self-tests these cases, so the rule cannot rot
silently.

**A state must not be folded into a name.** The bottom nav's links carry an
`aria-label` that duplicates the visible label; expressing "current" by
appending to it would break the match between accessible name and visible text.
That is what `aria-current` is for.

### A progress indicator is named, or hidden inside the control that names it

Material renders `mat-spinner`, `mat-progress-bar` and `mat-progress-spinner`
as `role="progressbar"` with no content to take a name from. Each one in the
tree either carries a name — `[attr.aria-label]` through `translate`, such as
*Refreshing dashboard data* or *{name}: {percent}% of budget used* — or a
literal `aria-hidden="true"`, because it sits inside a control whose own text
already says what is happening, where a name would say it twice. The shared
`LoadingSpinnerComponent` names itself with its `message`, or `common.loading`.

**A button whose label a spinner replaces keeps its name.** Hiding the spinner
inside such a button would leave it with no name at all while it is busy, so
it carries `aria-busy` and, only while busy, its idle label as `aria-label`
(the *Test API key* buttons, the transaction form's submit, the camera's
process button). Idle, the visible text names it.

**Check:**

```bash
npm run icon-labels:check
```

`scripts/check-icon-labels.mjs` holds two rules over every template: a
`mat-icon` carrying `role="img"` or a label also carries a literal
`aria-hidden` ([ADR 0146](ADR/0146-an-icon-that-carries-a-label-is-not-hidden-and-a-category-id-is-never-empty.md)),
and every progress indicator carries an `aria-label` in any form, an
`aria-labelledby`, or a literal `aria-hidden="true"` — `"false"` and a bound
value hide nothing
([ADR 0151](ADR/0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)).
It reads the markup, so it cannot tell a useful label from a useless one, nor
whether the control a hidden indicator sits in really announces the state;
and it reads each tag alone, so an indicator under a hidden parent repeats the
attribute.

## A transaction row is a button beside its controls

The row's first line — description and amount — is a native
`<button class="row-head row-activate">`, named *{description}, {amount},
{date}* (`transactions.rowLabel`). The row around it is a plain container: no
role, no tab stop, no listener in its template. Before
[ADR 0151](ADR/0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)
the whole row was a `role="button"` holding the swipe drawer's buttons, the
menu trigger and the maps link, and a button's descendants are flattened away
for assistive technology.

- **The keyboard reaches the button; the pointer reaches the host.** Enter or
  Space on the button is one native click; a click anywhere else on the row,
  the category strip included, is answered by the component host's own click
  listener, which leaves a click on one of the row's own controls, or on the
  strip's scrollbar, to that control. Escape anywhere in the row closes the
  drawer.
- **The menu comes first, and names its row** — *More actions for
  {description}* — because it no longer sits inside a named row. It precedes
  the row button in DOM order, which is Tab order: the list's reserve rules
  need `.row-actions` as the surface's first child.
- **A split part says so.** The button's `aria-label` replaces its content's
  name, so on a split part the button points at the split badge with
  `aria-describedby`.
- **The ring is drawn on the row**, inset, through
  `.transaction-row:has(.row-activate:focus-visible)`.

## Announcements

A live-region announcement made before a write settles is a claim, and a
failed write has to correct it — not just show a visual error toast, which a
screen-reader user reading the announcement has no reason to go looking for.

The dashboard layout editor's keyboard move is the instance of this:
pressing **Move up** or **Move down** announces the position it moved to
immediately, optimistically, before the account's preference write has
landed — reading that wait as lag would be worse than the small chance of
being wrong. A write that then fails announces again, once the rows fall
back to the account's last-known order, naming where the card actually
ended up. See [docs/dashboard.md](dashboard.md) for the exact strings and
[ADR 0132](ADR/0132-the-dashboard-is-arranged-by-the-account-and-a-hidden-card-composes-nothing.md)
for the optimistic-write pattern this follows.

The rule generalizes beyond that one control: anywhere an announcement is
made ahead of a write rather than after it, a failure path needs its own
announcement, not only its own visual notification.

**One voice per event.** `NotificationService` already announces every
snackbar it shows, so a change a snackbar reports is never announced a second
time beside it.

**One announcement at a time.** `AnnouncerService` queues what it is handed.
Handed straight through, a second message inside the CDK `LiveAnnouncer`'s
delay of about 100 ms would clear the first before it was written. Handing
the second on the moment the first is written would be no better: the CDK
writes a message and resolves its promise in the same task, and begins its
next `announce()` by clearing the region, so the second would replace the
first before a rendering update had exposed it to the accessibility tree.
Each message therefore waits until the one before it has been written and has
stood for `ANNOUNCEMENT_GAP_MS`, 150 ms — a timer, since an animation frame
never fires in a hidden tab — and one with nothing ahead of it goes out at
once. That holds for every announcement made through `AnnouncerService`;
Material's own do not pass through it (see Known gaps).

What a message reports decides how it joins the queue. One that reports
current state — a count, a position — passes `'replace'`, since a later state
makes it stale; one that reports an event — a removal, a notice,
an alert — queues, since nothing said after it does. `'replace'` drops every
waiting message that was itself passed with `'replace'`, whichever surface
raised it, and never one passed with `'queue'`, so a keystroke cannot cost a
waiting alert or error its turn. The
state messages are the command palette's result count, a dashboard card's
position after **Move up** or **Move down**, and the transaction list's count
and totals. The palette's count changes on every keystroke: while typing
continues a count goes out at most once a turn — the CDK's delay and then the
gap — each the latest count at that moment, and when typing stops the last
count is the last count placed. A failed move's correction leads with the
failed save, an event, and queues
([ADR 0149](ADR/0149-the-review-step-says-what-it-changed.md)).

### The import review step

The review step says each change below once, naming the row where the
sentence has room for it
([ADR 0149](ADR/0149-the-review-step-says-what-it-changed.md)). The card's and
the wizard's own announcements are polite; a snackbar's follows its tone, so
the set-aside notice, an error, is assertive.

| Event | Sentence | By |
|---|---|---|
| A duplicate verdict overruled | *{description} is not a duplicate* | the card |
| A tag filed | *Tag {tag} added to {description}* | the card |
| A tag removed | *Tag {tag} removed from {description}* | the card |
| A country withdrawn | *Country removed from {description}* | the card |
| A location removed | *Location removed from {description}* | the card |
| A row removed — after *Remove this row?* when it carries work made on the card | *{description} removed* | the card |
| A re-check flipping verdicts, the edited row's or any other's | *{count} duplicate verdicts updated* | the wizard |
| A currency change that rounds amounts to nothing, one row or the selection | *{count} amounts round to nothing in {currency} — add them again* | the snackbar |
| Rows failing a second time and set aside | *{count} rows failed to save twice and were set aside — reselect them to try again*, as the second sentence of the round's *Imported {success} of {total} transactions — {failed} could not be saved* | the snackbar |
| Rows saved without their photos | the image-quota sentence, the failed-upload sentence or both, after the rest of the round's one notice — the error when a row failed, an info notice otherwise | the snackbar |

A round's one notice stays up for its tone's own duration and two seconds
more for each sentence past the first, so a notice that joins three is still
on screen while its last sentence is read. The sentences are counted in the
joined text by their stops, since one part of a notice can hold two: the
failed-upload part does in en and ja, the set-aside part in ja.

A row with no description yet is named *an untitled row*: the slot sits inside
a sentence, so it takes a noun phrase rather than the edit trigger's *Add a
description*. Picking a country is not announced — the menu it was picked from
is where the user is looking. A failed row's reason stands on its card as
`role="note"` rather than an alert: it happened during the write, before that
render, and interrupts nothing.

## Accessibility settings

Three preferences under **Settings → Preferences**, in an *Accessibility* group
below the theme and language controls. `AccessibilityService` carries them from
the account to the document root the way `ThemeService` carries the theme (see [ADR 0070](ADR/0070-accessibility-preferences-ride-the-account-and-land-on-the-root.md)).

| Setting | Stored as | What it does |
|---|---|---|
| Font size | `fontScale?: number` — one of `1`, `1.15`, `1.3` | Sets `--app-font-scale` on `<html>`, which `html { font-size: calc(100% * var(--app-font-scale, 1)) }` reads |
| High contrast | `highContrast?: boolean` | Adds `.high-contrast` to `<html>` |
| Reduce motion | `reducedMotion?: boolean` | Adds `.reduced-motion` to `<html>`, and zeroes the animations CSS cannot reach |

**They ride the account, not the device.** A person who needs larger text needs
it everywhere they sign in, so these sit beside `theme` and `language` on
`UserPreferences` and are written with dotted field paths — only the touched
key is sent.

**Absence resets.** `effectiveFontScale`, `highContrastEnabled` and
`reducedMotionRequested` in `user.model.ts` are total functions over
`UserPreferences | null | undefined`, each returning its default for absent
input (and the font scale also for a value outside the list, which another
build may have written). `AuthService` calls `AccessibilityService.init(prefs)`
*unconditionally* on every preferences sync, so an account switch whose
preferences carry none of these keys resets the previous account's settings
rather than leaving them in force.

### Font size is a variable, not a class

`--app-font-scale` multiplies whatever the root already is, so it **composes
with the browser font size the user set for themselves** instead of overriding
it. That is also why the type scale is expressed in `rem` and icons in `em`: a
non-16px effective root carries every one of them along with it. At the default
scale the property is *removed* rather than set to `1`, so the CSS fallback
stays in control.

### High contrast is not a second theme

It moves legibility tokens only — `--border-primary`, `--border-secondary`,
`--text-secondary`, `--text-muted`, `--text-disabled` — each further along the
ramp its own theme already uses, plus a 3px focus ring. Surfaces and brand
colours are untouched, and a `.dark-theme.high-contrast` block continues the
dark-neutral ramp, so contrast and theme multiply rather than fight.

It is unrelated to forced-colors mode, which replaces author colours with
system ones regardless of this setting.

### Reduced motion has to reach three places

`AccessibilityService.reducedMotion()` is the **OR** of the account preference
and the OS's `prefers-reduced-motion`. Three consumers read that one signal,
because CSS alone cannot reach the last two:

| Consumer | How | Why CSS is not enough |
|---|---|---|
| Stylesheets | `.reduced-motion *` collapses animations and transitions to `0.01ms`, mirroring the `@media (prefers-reduced-motion: reduce)` block above it | A media query cannot be switched on from script, so the in-app override needs its own class |
| Material tab strips | `AccessibilityService.tabAnimationDuration` (`'0ms'` / `'200ms'`) bound to `[animationDuration]` | Material animates through the Web Animations API, driven by an explicit input |
| Charts | `ChartThemeService.animation()` returns `false` instead of `{ duration: 400 }` | Chart.js animates a canvas off the main thread, where no stylesheet reaches |

Both kill-switches collapse durations rather than removing animations, so
animation-end hooks still fire.

The settings toggle for this one reads the **stored** preference, not
`reducedMotion()`. Bound to the resolved value it would read "on" —
unturnable off — for anyone whose OS already asks for reduced motion, while
writing `false` to a preference that was already false. Font size and high
contrast read the service's signals, where stored and resolved are the same.

**Adding a new animation?** If it is CSS, both kill-switches already cover it.
If it runs through WAAPI or paints to a canvas, inject `AccessibilityService`
and read `reducedMotion()` — nothing sweeps for the ones that do not.

**Check:**

```bash
npm run motion:check
```

`scripts/check-motion.mjs` holds the CSS half to what is actually checkable: both
kill-switches still exist in `src/styles.scss`, still declare all four properties
with `!important`, and still cover `*`, `*::before` and `*::after` — and no
component stylesheet declares an `!important` duration of its own. That last one
is the way a component gets past them: `*` is specificity zero, so an
`!important` duration in a component rule ties on importance and wins on
specificity, and that component keeps moving for a reader who asked it not to. A
duration of about zero is the kill-switch's own spelling and passes; a
declaration inside the component's **own** `prefers-reduced-motion` block is
cooperating and is skipped. A declaration that has to outrun the kill-switch
would be recorded in the script's `ALLOWED` table with its reason; the table
is empty, and a repair edits it in the same commit.

The check says nothing about `forced-colors`, and there is no rule to write
there: two stylesheets declare it because two paint their own focus and
selection states, and a gate demanding it of the rest would be a gate that
asserts nothing.

### Colour contrast is a property of a pair

**Check:**

```bash
npm run contrast:check
```

A stylesheet declares one token at a time, so nothing in it can say whether a
colour reads — contrast exists only between a foreground and a background, and
the author picks the token against whichever background happened to be on
screen. That is how three dark-mode chips shipped at 4.09, 4.10 and 3.00:1: an
income chip, a warning banner and an expense chip, all on the dashboard, all
under AA, with nothing to say so.

`scripts/check-contrast.mjs` scores a **hand-written table** of the pairs the
app paints, in **four** rendered modes — light, dark, light + high contrast,
dark + high contrast. Three things about that are worth knowing:

- There are four modes, not three: `.high-contrast` and
  `.dark-theme.high-contrast` are separate blocks resolving to different
  palettes.
- The two high-contrast blocks declare **zero** `--color-*` tokens — they
  override `--border-*` and `--text-*` only — so the colour tokens are
  identical there to the ones underneath.
- Pairing cannot be derived from the names. The base token is a **fill**,
  `-light` is a **tinted background**, `-text` is the AA-corrected
  **foreground**. Scoring every token as a foreground on `--surface-card`
  fails 14 of 20 in light, and nearly all of those are false positives: a
  chart bar owes nothing to a card it never sits on.

Rows come in three kinds: **required** (must clear 4.5:1 in every mode),
**exempt** (recorded with the reason it is not a rule — a disabled control,
a divider, a combination nothing paints), and **frozen** (fails today, pinned
at the ratio it measures, may only improve; when one reaches its threshold the
script asks to have it promoted). `--self-test` asserts that every `--color-*`
token the light palette declares appears in one of those tables or in a named
`NOT_PAINTED` list, so a new token cannot be added unaudited, and runs the
frozen-row ratchet, `frozenRowFinding`, over a synthetic row — at its floor,
worse than it, and clearing its threshold — since the real frozen table is
empty.

The first run fixed four pairs — `--text-muted` moved to gray-600 (it measured
4.39 and 4.43 against `--surface-muted` and `--surface-background`), and the
three dark chips' `-text` tokens each moved one step lighter, with
`--color-expense-light` moving one step darker to meet its text — and froze
four more. Those four are fixed: the type toggles paint the income and expense
`-text` tokens that already existed, and two new ones name the foreground on
the error and primary tints, `--color-error-text` and `--color-primary-text`
([ADR 0151](ADR/0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)).
The frozen table, `KNOWN_FAILURES`, is empty and stays. A pair written into
`PAIRS` that measures under its threshold fails the build, and reaches
`KNOWN_FAILURES` only if someone moves it there by hand, as a row with its
reason and its measured floors. A pair axe's `color-contrast` rule finds on a
route the walkthrough renders fails the smoke walkthrough instead, and is
frozen, if at all, in `axe.ts`'s `KNOWN_VIOLATIONS`, by rule id per route with
its reason — never in `KNOWN_FAILURES`. `--color-income` and `--color-expense`
are named as fills in `NOT_PAINTED`: nothing paints either as text.

**A category's colour is not a token.** The category chip paints a
category's icon, and as a pill its label, in the category's own colour on a
tint of it, and that colour is data — picked from the category dialog's
palette, or carried in a backup — so no row in `PAIRS` can score it. Painted
on a translucent tint of itself, a light category measures 1.95:1 in light —
the orange tile, `#ff9800` on `#fff2df` — and a dark one, even lightened 30%,
measures 3.95:1 in dark — `#9C27B0` as `#ba68c8` on `#3e2043`; every default
colour fails in one theme or the other. So the tint is composited over
`--surface-card` and painted opaque, the foreground sits on one known colour
whatever surface holds the chip, and `ensureContrast`
(`core/utils/color-contrast.utils.ts`) mixes the colour towards black in
light and towards white in dark, keeping its hue, until it reads 4.5:1
there. The gate is `category-chip.component.spec.ts`: it measures the
painted tile and pill for every default category's colour and four hostile
ones, in both themes, and holds the composited surface to the stylesheet's
`--surface-card`
([ADR 0151](ADR/0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)).

## What is tested

- `sidebar.component.spec.ts` and `bottom-nav.component.spec.ts` register real
  routes and navigate for real — `routerLinkActive` tracks router events, so
  nothing short of a navigation exercises it. They assert the mark lands on the
  current link, moves on the next navigation, skips a route no link owns, never
  lands on the centre Add button, and that the accessible name stays the bare
  label.
- `app.smoke.spec.ts` asserts the same invariant inside `expectPage`, so every
  route it visits checks it against the **real route configuration**. It is
  gated on a link for the route being on screen: the surfaces rendered there do
  not carry all nine destinations — `/settings`, `/data`, `/household` and
  `/about` have no link there. The gate tests for the anchor, not the
  attribute, so a regression that drops `aria-current` still fails every route
  that has a link.
- `user.model.spec.ts` pins the three resolvers against absent, null,
  off-list and wrongly-typed input.
- `accessibility.service.spec.ts` drives the service against a faked document,
  asserting the variable is removed rather than set at the default scale, that
  each class lands and lifts, and that the resolved reduced-motion value is the
  OR of the preference and the media query.
- `chart-theme.service.spec.ts` asserts the chart animation follows that signal
  rather than the media query.
- `accessibility-settings.component.spec.ts` pins that only the touched
  preference key is written, and that the reduced-motion toggle shows the
  stored value rather than the resolved one.
- `firestore-rules.smoke.spec.ts` pins that the dotted update of all three
  fields is accepted — no rules change was needed, and that is asserted rather
  than assumed.
- `tab-strip-scroll.directive.spec.ts` pins the tab strips' keyboard
  behaviour: the arrow keys walk focus along the strip and each tab they reach
  is scrolled into view, rather than sitting behind a chevron a keyboard user
  has no way to press. Material's header resets the strip's scroll after every
  focus change, so this is the assertion that would fail first if the
  correction were dropped. Both opted-in pages have their own case for a
  `?tab=` deep link opening on its tab in view.
- The 40px tap-target floor is measured where the glyph is smaller than the
  target: `transaction-list.component.spec.ts` reads the note button, the
  receipt icon and the row actions trigger — each a 32px (or unsized) glyph box
  with a 40px hit box through the `::after` overhang — and
  `budget-progress-card.component.spec.ts` reads the card's menu trigger, which
  meets the floor by its own box. See
  [ui-overflow.md](ui-overflow.md) for the idiom.

## Known gaps

- **Only navigation has been audited.** Segmented controls and the period
  selector express selection visually and have not been; the tab strips are
  audited for reachability and keyboard travel only, not for how selection is
  announced.
- **No landmark structure beyond `nav`.** The two navigation surfaces are
  indistinguishable to a user listing landmarks.
- **The automated pass is a phone audit of eight routes, in one theme.**
  `app.smoke.spec.ts` runs axe-core (WCAG 2.1 A and AA, `color-contrast`
  included) inside `expectPage`, so every page the walkthrough opens is swept,
  and nothing it has found is frozen any more. What it cannot see is stated in
  [emulator-blind-spots.md](emulator-blind-spots.md): i18n is not served,
  Karma's window is 756px, eight page-level rules are disabled because the run
  is scoped to the routed element, four routes (`/ai`, `/search-history`,
  `/import/file`, `/import/history`) are never opened, and `color-contrast`
  reports nothing below the fold of Karma's frame (the next gap). Each run
  renders the one theme the host's `prefers-color-scheme` resolves — light on
  the CI runner, dark on a Mac in dark mode — so a failure that exists only in
  the other theme is seen only where that theme renders, and nothing committed
  pins it; the same page says how to run the other. The dashboard's subtitle
  failed in light only, at 4.43:1, and was found by reading. The category chip
  failed in both themes — thirteen of the sixteen default colours in light,
  four in dark, `#E91E63` in both — and CI's light run was the first to report
  it: the walkthrough's rows and budget use one category, orange, which failed
  in light at 1.95:1 and passed in dark at 5.85:1, and the default colours,
  the ones that failed in dark among them, render only in the Categories panel
  on `/settings`, which the walkthrough leaves collapsed and axe does not
  measure. Everything outside that is still a hand-written spec, and nothing
  sweeps for the next instance of a class nobody has met.
- **The axe pass measures only the top 413px of a page.** Karma's frame is
  756px wide and 413px tall and scrolls inside its own body, and axe's
  `color-contrast` rule cannot measure a node below that fold: it leaves the
  node incomplete rather than failing it, the harness reads violations only,
  and scrolled into the frame the node is measured like any other. On
  `/transactions` the seeded rows' chips sit inside the frame. On `/budgets`
  the budget card's chip starts 445px down, and on `/dashboard` the two
  recent-transaction chips start at 591px and 675px, the spending chart's
  legend at 1426px and the budget card's icon at 1602px, so none of those is
  measured. Two of them fail on the walkthrough's own orange category — the
  budget card's orange icon at 2.06:1 in light, and the legend's white glyph
  at 2.16:1 in both themes, both among the sites listed below that paint a
  category's colour without the chip — and the smoke walkthrough passes
  regardless.
- **Contrast is measured for the pairs somebody listed.** `npm run
  contrast:check` scores a hand-written table of the pairs the app actually
  paints, in all four rendered modes, and every failure it has found is fixed.
  What it cannot see is a colour that is not a token — a hex literal in a
  component stylesheet, a Material default, a Tailwind utility class, a
  category's own colour — or a pair nobody added a row for. The category
  chip's spec measures that colour; the axe pass is the other half of the
  rest: it measures what a rendered page paints, above the fold, in its one
  theme.
- **Ten components paint a category's colour without the chip**, so the
  correction the chip applies never reaches them. Figures are for the sixteen
  default colours. *On a tint of itself*, in both themes: the dashboard's
  upcoming bills (`upcoming-bills.component.html`), the recurring rules page
  (`recurring-transactions.component.html`) and the category dialog's preview
  (`category-form-dialog.component.html`) paint the raw colour on the icon
  over the colour with `20` appended, which takes on the surface beneath — the
  Material card's `#f4f2fc` / `#1a1b22`, `--surface-card` and
  `--surface-subtle` respectively, and a paused rule's card is drawn at 70%
  opacity besides. Thirteen colours fail there in light, down to 1.75:1
  (`#8BC34A`), and six to eight in dark, down to 2.08:1 (`#3F51B5`). *On the
  surface beneath, with no tint of its own*: the dashboard's budget card icon
  on `--surface-subtle` (`budget-progress.component.html`, `#FF9800` at 2.06:1
  in light); the import review's category button and its menu
  (`category-suggestion.component.html`); the category pickers of the
  transaction form — its options, the field showing the choice, and its
  suggestion chip — of the split parts, the budget form and the recurring
  dialog, whose select panel is `#efedf6` / `#1f1f26`; and the category
  dialog's icon grid, on its selected icon. Thirteen fail in light, down to
  1.75:1, and five in dark — `#9C27B0`, `#E91E63`, `#607D8B`, `#3F51B5` and
  `#795548` — down to 2.26:1. *White on the colour*, the same in both themes:
  the dashboard spending chart's legend tile (`spending-chart.component.html`,
  its glyph white in `spending-chart.component.scss`) and the category
  dialog's selected swatch. On the legend, which draws the account's
  categories, `#FF9800` measures 2.16:1, `#4CAF50` 2.78:1 and the `#9E9E9E`
  fallback 2.68:1; all of the sixteen default colours but `#9C27B0`, `#3F51B5`
  and `#795548` fail. The swatch grid draws only the dialog's own palette,
  fifteen Tailwind 500s, and twelve of them fail under the white glyph; the
  same palette fails the preview too, all fifteen in light and ten in dark.
  Each site is left for a follow-up, which can put the chip there or pass the
  colour through `ensureContrast` against the surface it sits on. The bars and
  chart segments filled with a category's colour are graphics beside a printed
  amount or percentage, not text, and are not counted
  ([ADR 0151](ADR/0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)).
- **Eighteen places paint `--color-error` as a foreground on the card**, where
  it measures 3.76:1 in light and passes in dark. The table scores
  `--color-error` on its own tint only, and the axe pass measures only what is
  on screen, in its one theme. They are listed in
  [ADR 0151](ADR/0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md);
  `--color-error-text` is the token to reach for.
- **Nothing sweeps for the next animation CSS cannot reach.** Chart.js and the
  Material tab strips were found by reading the code; a new WAAPI duration or
  canvas animation will honour neither kill-switch and no gate will say so.
- **Material's own announcements bypass the queue.** A closed single
  `mat-select` whose value an arrow key or typeahead moves calls the CDK
  `LiveAnnouncer` itself with the option's text. The CDK begins every
  `announce()` by clearing its region and cancelling a write still inside its
  delay, so a message the queue handed over less than 100 ms before is never
  placed, and one standing out its gap is replaced early. The snack bar, too,
  moves its text into a live region of its own, beside the announcement
  `NotificationService` makes through the queue
  ([ADR 0149](ADR/0149-the-review-step-says-what-it-changed.md)).
- **RTL layout is groundwork only** (#86). Direction follows the locale and the
  physical CSS that remains is frozen per file, but no right-to-left locale
  ships and 107 hits are still unconverted — see [rtl.md](rtl.md).
