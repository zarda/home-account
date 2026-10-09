# 169. A category's colour is drawn through the chip or a pipe that knows its surface, and the axe pass sweeps both themes below the fold

**Status:** Accepted, implemented · **Date:** 2026-10-08 · **Issues:** #461

Reference documentation lives in [../accessibility.md](../accessibility.md),
[../emulator-blind-spots.md](../emulator-blind-spots.md) and
[../testing.md](../testing.md).

Closes three *Known gaps* of
[0151](0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md):
the ten components that painted a category's colour without the chip, the
one theme the axe pass rendered per run, and the desktop table's row menu
that kept the generic *More actions*. Narrows a fourth, the fold: the two
failures it named are fixed and the cards that held them are audited in
view, but a page pass still scores only what starts above Karma's frame.
In [../accessibility.md](../accessibility.md), closes two of the same
gaps, the ten components and the one theme, and rewrites the fold gap to
name what is still below the fold. Corrects how 0151 explained the fold, without
editing it (below).

## Context

0151 made the category chip paint its tile opaque over the card and move
its glyph until it reads 4.5:1 there, with `ensureContrast`. It listed ten
components that painted a category's colour themselves and got none of
that. #461, filed on 2026-09-25, measured them. Three painted the raw
colour on a translucent tint of itself, the colour with `20` appended:
the dashboard's upcoming bills, the recurring rules page and the category
dialog's preview. Seven painted it straight on whatever surface was
beneath: the dashboard's budget widget, the import review's category button
and its menu, the category pickers of the transaction form, the split
parts, the budget form and the recurring dialog, and the category dialog's
icon grid. Two drew a white glyph on it: the spending chart's legend tile
and the category dialog's selected swatch. The category dialog did all
three.

In light, at least thirteen of the sixteen default colours failed at every
site. The worst pair for a default colour, a selected option in dark,
measured 1.36:1. The dialog's own palette did worse: `#eab308` on the
active option in light, at 1.31:1, and a category saved from that palette
carries its colour to every other site. A paused recurring rule's card was
drawn at 70% opacity over the page, and under it even the chip's tile and
glyph measured 2.64 to 3.27:1.

An eleventh site joined two days after the issue was filed. `f26a7c49`
(2026-09-27) gave the household budget dialog a category select whose
options painted `option.color` straight on the panel
(`household-budget-dialog.component.html:24` at that commit).

The smoke walkthrough's axe pass reported none of it. It rendered one
theme, the host's: light on CI, dark on a Mac in dark mode. It scored only
what started in the top 413px of Karma's frame, and the budget widget's
icon and the legend sat far below that. It never opened the Recurring tab
with a rule, a category select's panel or a menu, and never visited
`/import/file`.

Reading the pickers turned up a defect the issue had not named. Four of
them wrapped the option's `mat-icon` and its name together in a `<div>` or
`<span>`. MatOption projects a `mat-icon` that is its own direct child into
a slot beside the label, and everything else into the label, whose text is
the option's `viewValue`. So the ligature led the name. The split part's
closed field read "restaurantFood", typeahead matched icon names, and the
closed select announced them. The open list looked right, because the icon
font draws the ligature as a glyph.

A browser pass of the finished colours met one more naming defect, which
0151 had kept as a Known gap: every row menu on the desktop transaction
table was named *More actions*, and so were the menus of three other lists.

## Decision

**A category's colour reaches a template in one of three ways. The
category chip paints it on its own opaque tile. A glyph painted in it
anywhere else goes through `categoryGlyph:'<surface>'`, which moves the
colour, keeping its hue, until it reads 4.5:1 on every tone of the surface
named. A fill of the colour itself keeps it, is marked as category data,
and draws its glyph in black or white through `readableOn`.
`colors:check` fails any other bound colour. The smoke walkthrough runs
every axe pass once per scheme, forced through the real `ThemeService`,
and audits the cards that start below Karma's frame once they are
scrolled into view. An option's icon stays out of its name, a repeated
menu button names its item, and `icon-labels:check` holds both.**

### The chip, a pipe, or a marked fill

- **The three tinted tiles became the chip.** The upcoming bill's tile is
  `<app-category-chip appearance="tile" size="sm">`. The recurring rule's
  card and the category dialog's preview use the default size. The chip's
  tile is opaque, so the surface under it no longer matters. Two things
  look different: the bill tile's corner radius went from 12px to the small
  tile's 8px, and the preview's glyph from 22px to `--text-xl`, 20px.
- **Every bare glyph goes through the glyph pipe**, with the surface it
  sits on as the argument:

  | Site | Surface |
  |---|---|
  | The dashboard's Budget Progress widget | `subtle` |
  | The import review's category button | `reviewCard` |
  | The import review's category menu | `menu` |
  | The transaction form's and the budget form's closed select | `dialog` |
  | The options of the transaction form, the split parts, the budget form, the recurring dialog and the household budget dialog | `panel` |
  | The transaction form's suggested category | `suggestionChip` |
  | The category dialog's chosen icon | `iconGrid` |

- **A fill keeps the category's colour.** The legend tile has to match its
  chart segment, and the swatch shows the colour being offered, so neither
  is moved. Each sits inside a `colors:allow-start(category-data)` block,
  as do the bars that `category-breakdown`, `spending-analysis` and the
  legend fill with a category's colour. The tile's and the swatch's
  glyphs pick black or white.
- **One palette and one fallback.** The dialog's fifteen colours moved to
  `CATEGORY_PALETTE` in `category.model.ts`, beside
  `CATEGORY_FALLBACK_COLOR`, `#9E9E9E`. The nine fallbacks written out in
  TypeScript read it, and so does the budget card's template, whose
  missing-category fallback was `#666`.

**The gate.** `colors:check`'s binding rule fails a bound colour unless it
is in `category-chip.component.ts`, is a string-literal `var()`, is
corrected last by one of the two pipes, or sits inside a marker with its
reason. "Last" means the expression's outermost pipe is `categoryGlyph`
with a quoted key that `CATEGORY_SURFACES` lists, or `readableOn` with no
argument. The rule reads the keys from the table itself, so a key that
does not exist fails. It covers every colour property and attribute:
`[style.color]`, `[style.background]`, `[style.background-image]`,
`[style.border-*]`, `[style.filter]`, `[attr.fill]`, `[attr.stroke]` and the
rest. It reads each in every spelling Angular compiles to the same binding:
`bind-style.color="c"`, an interpolated `style.color="{{ c }}"` or
`attr.fill="{{ c }}"`, and an interpolated `style="color: {{ c }}"`, which
binds the whole style. A whole bound style, `[style]`, `[ngStyle]` or
`[attr.style]`, is never exempt. A literal written after `color ||` or
`color ??` is its own rule, `category-fallback`, whose advice points at
`CATEGORY_FALLBACK_COLOR`. The category baseline the gate opened with, 34
hits in 21 files, is gone; there is one baseline now, and it is empty.

### Each surface lists its tones, and the hardest one decides

`CATEGORY_SURFACES`, in `core/utils/color-contrast.utils.ts`, lists every
tone a glyph sits on, per surface and per theme:

| Surface | Tones | Hardest, light / dark |
|---|---|---|
| `dialog` | a dialog's surface, under a closed select | `#fbf8ff` / `#121319` |
| `panel` | a select panel's option at rest, hovered, active and selected | `#d5d4dd` (active) / `#3e446b` (selected) |
| `menu` | the panel's four, and the current item's `--surface-menu-current` | `#d5d4dd` / `#3e446b` |
| `subtle` | `--surface-subtle`, under each budget in the dashboard widget | `#f9fafb` / `#242424` |
| `reviewCard` | the review card checked, unchecked, hovered and flagged as a duplicate, each at rest and under the stroked button's hover and keyboard-focus layers: twelve tones a theme | `#dee2f3` / `#4c4d54` |
| `suggestionChip` | `--surface-suggestion` and its hover | `#c6c9ea` / `#2b2f44` |
| `iconGrid` | `--surface-icon-selected` | `#f0f1f9` / `#2b2d36` |

`hardestTone` picks the darkest tone in light and the lightest in dark.
`categoryGlyphColor(color, surface, theme)` is
`ensureContrast(color, hardestTone(…), 4.5, 'darken' | 'lighten')`: the
colour mixed towards black in light and towards white in dark, a step at a
time, until it clears the hardest tone. Every light tone is light enough
that a glyph which clears AA on one is darker than all of them, and every
dark tone is the mirror image, so the glyph loses contrast only as a tone
approaches it. Clearing the nearest tone clears the rest, by construction.
Over the 31 colours a category can carry and every tone of every surface,
the closest call is 4.5004:1, `#a855f7` drawn as `#b874f8` on the dark icon
grid's `#2b2d36`.

**The pipe reads the theme.** `categoryGlyph` is impure and memoised on
the colour, the surface and the theme, as `LocationLabelPipe` is. It reads
`ThemeService.effectiveTheme()` inside its transform, which is what
repaints an OnPush view on a theme switch. A pure pipe would keep the
first theme's colour. A colour it cannot read passes through unchanged,
and an absent one comes back empty, which a style binding renders as no
colour.

**The tones are held to the stylesheet.** A pipe cannot read the cascade,
so the tones are literals inside a `token-mirror` marker, and
`category-glyph.pipe.spec.ts` holds each one to what paints it. Material's
tones are probed with Material's own expressions, component token
included: the dialog's container, the select panel and its option states,
and the menu. A state layer is mixed at the system state opacities. The
named `--surface-*` tokens are read as declared. For the review card, a
real `mat-stroked-button` is rendered on each base, and its hover and
focus layers are read and composited. One case per surface compares the
list with what was measured, in both themes ("holds menu to what the
stylesheet paints, in both themes"), and "puts every category colour, and
hostile ones, at 4.5:1 or more on every tone of every surface" measures
the 31 colours and fourteen hostile ones with `painted-contrast`'s
`ratio`, not with the code under test.

### Black or white on a fill

`readableOn(fill)` returns `#000000` or `#ffffff`, whichever contrasts
more. On a fill of luminance L, black scores (L + 0.05) / 0.05 and white
1.05 / (L + 0.05). The two multiply to 21, so the better of them is never
under √21, about 4.58:1, whatever the fill. The pipe is pure, because the
answer does not depend on the theme. `ensureContrast`'s last resort, when
even black or white falls short of the target, is now `readableOn` too.
The legend's and the swatch's `color: white` are gone.

### A paused rule's card is not faded

`.recurring-card.paused { opacity: 0.7 }` is deleted, and the card's
`[class.paused]` binding with it, since nothing else read the class. The
Paused chip already says the rule is paused. Faded, the whole card fell
under AA, the chip's corrected glyph included. Pinned by
`recurring-transactions.component.spec.ts` "leaves a paused rule unfaded,
its category glyph at AA or better on its tile, in both themes".

### The eleventh site

The household budget dialog's category select is a multiple select over
the built-in expense categories, ninety options. Its glyphs go through
`categoryGlyph:'panel'`, like the other pickers. Its spec measures every
option at rest and active in both themes. A multiple select paints no
selected fill, so a chosen option is measured as one at rest.

### An option's icon is not part of its name

At the four pickers that wrapped it, in the split parts, the transaction
form, the budget form and the household budget dialog, the option's
`mat-icon` is now a direct child of `mat-option`, as the recurring dialog
already had it. The name is bare text beside it. Each picker's spec reads
`MatOption.viewValue` and expects the name alone; the split parts' spec
also reads the closed field after a pick ("reads only the picked name in
the closed field").

`icon-labels:check` gains a third rule: inside a `mat-option`, a
`mat-icon` has no element between it and the option. Control-flow blocks
are not elements and do not count. An `ng-container` does.

### A repeated menu button names its item

Four lists stamped a menu button per item, each named by
`common.moreActions`, *More actions*: the desktop transaction table, the
budget cards, the recurring rules and the category manager. A screen
reader moving down a list heard the same name at every row, and nothing
said which item the menu would edit or delete. 0151 had kept the desktop
table's as a Known gap, on the ground that its table row gave it context.
Each now names its item with `common.moreActionsFor`, *More actions for
{description}*: the transaction's description, the budget's name, the
rule's name and the category's name, as the phone's transaction row
already did. Pinned per list, for instance by
`transaction-list.component.spec.ts` "names each row menu after the row it
belongs to".

`icon-labels:check` gains a fourth rule: a `matMenuTriggerFor` element
stamped once per item does not take its name from `common.moreActions`.
"Once per item" is read inside a template, as an `@for` or an element
under `*ngFor`, `*cdkVirtualFor` or a table's cell or row definition, and
across templates: the budget card's button sits in no repeat of its own,
and the overview's `@for` is what repeats it. A trigger rendered once may
keep *More actions*.

### The walkthrough audits both themes, and the cards below the fold

- **Both schemes, through the service.** `AUDIT_SCHEMES` is
  `['light', 'dark']`. `withScheme`, in `core/services/testing/axe.ts`,
  forces a scheme the way the Settings control does, through
  `ThemeService.setTheme`, so the chip, the glyph pipe and the chart palette
  follow it as well as the stylesheet. It then restores the preference and
  both theme classes on `<html>`. Every page pass, every in-view audit and
  the household switcher's panel run once per scheme. The walkthrough sets
  the light preference before its first page, so it renders the same
  scheme between passes on any host, and puts the preference and the
  classes back in a `finally` and again in `afterAll`.
- **The fold, in axe's terms.** Every routed page renders inside the
  shell's `.main-container`, a `position: fixed` scroller. axe treats a node
  under a fixed ancestor as offscreen once its top reaches the viewport's
  bottom, and an offscreen node is skipped outright: it is in neither the
  violations nor the `incomplete` results. A node in plain flow would be
  scored at any depth. `auditInView(node)` scrolls the node to the middle of
  the scroller, instantly, waits a frame, and refuses to audit unless the
  whole node lies between the 64px header and the viewport's bottom.
  Otherwise part of it would read as clean without having been scored.
- **Five nodes are audited in view.** On `/dashboard`, the spending chart's
  legend list and the Budget Progress widget. On `/budgets`, the overview.
  On `/budgets?tab=recurring`, the rules grid, with an active rule and a
  paused one seeded in the walkthrough's orange category, so the tile, the
  paused card and the Paused chip are all on screen. And on `/dashboard`
  again, once that rule exists, Upcoming Bills.
- **A page is audited loaded.** `expectPage` waits for the route's
  landmark, for the data it names, and until no `app-loading-spinner` is
  left on the route, so a section that loads after the landmark is scored
  as it settles rather than as its spinner.
- **The timeout** rose to 300 seconds. The walkthrough went from 11 passes
  to 36.

The out-of-tree Karma launcher that
[../emulator-blind-spots.md](../emulator-blind-spots.md) described, for
running the walkthrough in the other theme, is retired. The walkthrough
renders both on any host.

## What was rejected

- **One surface per site, picked by hand.** A glyph corrected for a
  select panel at rest fails on the active option, and the issue's worst
  pairs were on the active and selected tones. The surface lists every
  tone, and the spec holds the list to the stylesheet, so a new state
  layer or a changed token fails a case rather than a reader.
- **A pure glyph pipe with the theme as an argument.** Every call site
  would have to read the theme itself, and an OnPush view would repaint on
  a switch only where somebody remembered to.
- **Darkening the legend tile or the swatch.** The issue offered it where
  the colour does not have to match anything. The legend tile matches its
  chart segment, and the swatch is the colour the user is choosing.
- **Keeping the paused fade and correcting the glyph under it.** Opacity
  fades the glyph, its tile and the card's text together. No glyph colour
  can make up for that, and the Paused chip already says what the fade
  said.
- **Two Karma launchers, light and dark.** That needs a committed Karma
  config, which the repo has never had, and a second smoke run in CI for
  one spec's sake. A launcher also reaches the app only through
  `prefers-color-scheme`, so it says nothing once the account's theme is
  anything but `system`. Forcing the scheme through the service renders
  both on any host, in one run.

## Consequences

- **Every category glyph outside the chip clears 4.5:1 on every tone it
  sits on, in both themes.** On light surfaces, a light category's glyph
  reads darker than the colour picked for it, and on dark surfaces a dark
  one reads lighter. A colour that already clears is drawn as picked.
- **The legend's and the swatch's glyphs are black on a light fill** where
  they were white.
- **A paused rule's card is drawn at full strength**, its Paused chip the
  only sign.
- **The bill tile's corners are 8px and the preview glyph 20px.** An
  option's icon sits Material's own 16px from its name, where the four
  wrapped pickers had 8px or 12px.
- **A budget whose category is gone fills its chip `#9E9E9E`**, the one
  fallback, where it was `#666`.
- **The glyph pipe and its table are in the initial bundle**, about 2.7 kB,
  because the transaction form, which `QuickAddService` loads eagerly, uses
  the pipe.
- **The walkthrough fails a contrast pair in either scheme on any host.**
  A run on a Mac in dark mode can no longer pass what CI's light run fails.
- **No rules, indexes or functions change.**

## Departures from the issue

- **Eleven sites, not ten.** The household budget dialog's select arrived
  after the issue was filed.
- **Three tones the issue did not list.** The issue named the suggestion
  chip at rest, the menu's current item and the review card's own tones.
  The surface table adds the chip's hover, a keyboard-focused menu item
  and the stroked button's hover and focus layers over each review-card
  tone, which were measured rather than assumed.
- **The option-icon fix** was not in the issue. It was met while reading
  the pickers, and fixed before their glyphs.
- **The row menus were not in the issue either.** A browser pass of this
  work met the desktop table's menus, every one named *More actions*, and a
  sweep of every menu trigger in the tree found the three other lists.
- **The Recurring tab is audited in view as well as by its page pass.** The
  issue asked for the page to be visited with a rule. Its page pass reached
  only part of the two cards.
- **The pickers' specs measure two probe colours in every state, not all
  31.** `GLYPH_PROBE_COLOURS` is the lightest seeded colour, `#8BC34A`, and
  the darkest a category can take, `#3F51B5`. Unmoved, each measures under
  2.5:1 on a select panel in its own scheme. The 31 colours are measured
  on every tone of every surface by the pipe's own spec, and each site's
  spec measures the two probes in every state the site paints, or, where
  the site cannot offer both, every colour it does offer: the household
  budget dialog offers only expense categories, so its spec measures the
  dark probe and every expense colour on its ninety options.

## Things that only became apparent while building

- **A node below the fold is not left `incomplete`; it is never looked
  at.** 0151, [../accessibility.md](../accessibility.md) and
  [../emulator-blind-spots.md](../emulator-blind-spots.md) said axe left a
  node below the fold `incomplete` and the harness, which reads violations
  only, dropped it. A fixture under a 2000px spacer in plain flow was
  scored at once. What hides the lower cards is axe's offscreen test: the
  shell's fixed scroller makes every node whose top is past the viewport's
  bottom offscreen, and an offscreen node is in no result at all. The
  `axe.spec.ts` fold fixture wraps its pair in a fixed scroller for that
  reason.
- **`block: 'center'` centres in the scroller, not in the band.** The
  scroller runs from the top of the viewport, behind the 64px header. A
  centred node keeps its top below the header only while it is at most
  about 285px tall in a 413px frame, although the band is 349px. So the
  walkthrough audits the spending chart's legend list rather than its
  card. The budget overview measured 256px.
- **`ThemeService` stamps a class only when the effective theme changes.**
  After a restore puts back the classes from before a pass, the service
  still believes its own class is on `<html>`, so forcing the scheme it
  already resolves to stamps nothing. `withScheme` passes through the
  other scheme when the DOM disagrees with the service, and throws if the
  class is still missing, so a stubbed service cannot pass the host's
  scheme off as the forced one. It also ticks inside the Angular
  zone: ticked from outside, the service's effect started a second tick
  during the first, which Angular refuses as NG0101 and only logs.
- **The closest call is on the icon grid.** The figure first worked out
  was `#f43f5e` on the dark Budget Progress widget, at 4.5008:1. Measured
  over the whole table, the icon grid's 4.5004:1 is lower.
- **A keyboard-focused menu item is the select panel's active tone.** Both
  are on-surface at the focus opacity over the same container. The menu's
  list carries it once.
- **A pipe inside a conditional corrects one branch.** Angular parses
  `on ? c : d | categoryGlyph:'panel'` as a pipe on `d` alone. The gate
  refuses the exemption to a binding whose top level is a conditional.
- **An alpha joined on before a pipe defeats it.** `parseHexColor` reads
  only opaque hex, so `c + '80' | categoryGlyph:'panel'` comes back
  unchanged, and `readableOn` answers white for any translucent fill. The
  gate refuses the exemption when a literal is joined on before the pipe: a
  string or a number after a `+`, or a template literal that interpolates.
- **The whole-branch review found bindings the rule could not see.**
  `bind-style.color="c"`, an interpolated `style.color="{{ c }}"` or
  `attr.fill="{{ c }}"`, and an interpolated `style` compile to the same
  bindings as their bracketed forms, and passed. So did a binding to
  `background-image`, `filter`, `border-image` or a `-webkit-` text colour,
  and a `c + 80` or a `` `${c}80` `` before a pipe. The rule reads each now.
  An interpolation is the binding's expression only when it is the whole
  value; text beside it is joined on, so it is a hit.
- **A select option shows its selected fill only once the keyboard has
  left it.** The panel opens with the chosen option active, and Material
  paints the active layer in place of the selected fill. The specs take the
  active mark off the chosen option to measure the selected state,
  through `eachOptionState` in `core/services/testing/option-states.ts`.
- **The pipe brought `ThemeService` into specs that had faked
  `matchMedia`.** One review-table spec replaced `window.matchMedia` with a
  plain object for reduced motion, and the service, now constructed by the
  card's glyph pipe, called `addEventListener` on it and threw. The stub
  now answers only its own query.
- **The sweeps found nothing on the finished tree.** The earlier slices had
  fixed every pair they reach. To show they score what they claim, two
  #461 defects were put back by hand, the budget widget's bare binding and
  the paused fade. The new walkthrough failed five expectations, among them
  the widget's glyph in light only and the paused card in both schemes, in
  view and on the page. The walkthrough before it passed the same tree.
- **The two-theme sweeps met a failure axe does not report.** The Budgets
  tab badge's count read 4.42:1 in dark. axe filed it under `incomplete`,
  as one character of text, and the harness reads violations only. It was
  found by reading the incomplete results by hand, and fixed with the
  colour work of
  [0164](0164-colours-come-from-theme-tokens-and-a-gate-keeps-them-there.md).
- **A pass audited whatever had rendered.** `/reports` named no data, and
  its light pass audited the report's loading spinner while the dark pass,
  a moment later, audited the first tab. `/settings`' categories and
  sign-in activity load after the profile its pass waited for. Waiting the
  spinners out found the settings avatar placeholder's glyph at 2.43:1 in
  light and 2.25:1 in dark, `--text-disabled` on `--surface-hover`; it now
  takes the empty states' circle and glyph.
- **The category dialog's grids named nothing.** Its 25 icon buttons and 15
  colour swatches, which this work recoloured, sat in a `radiogroup` with
  no radios: each icon's glyph is `aria-hidden`, each swatch is empty, and
  neither said which was picked, so a screen reader heard forty times
  *button*. The second browser run found it reading the dialog's tree. Each
  group is now a `group` of toggle buttons, each named from the catalog
  (`settings.categoryIconNames.*`, `settings.categoryColorNames.*`, the
  colours in `CATEGORY_PALETTE`'s order) and carrying `aria-pressed`;
  `category-form-dialog.component.spec.ts` checks every name resolves in
  `en.json` and that axe finds no unnamed button. Toggle buttons rather
  than radios, because radios ask for arrow-key roving and a single tab
  stop, which a 25-button grid read at a glance does not need.

## Known gaps

- **A page pass still scores only the top of the page.** Karma's frame is
  413px tall, and the five in-view audits are the only places the
  walkthrough looks lower. In the run that checked this, these started
  below the frame and are named by no in-view audit: on `/dashboard`, the
  Recent Transactions card (its top at 521px, its first chip at 597px), the
  spending chart's card around its legend list, and AI Insights; on
  `/settings`, all but the top of the profile section, which starts at
  373px, and every section after it, from the rate status at 549px down to
  the category manager; on `/data`, everything past the first 413px of a
  page 2687px tall; on `/household`'s member view, the second row of
  figures, the member chips, the shared rows, the plans and the members;
  and on `/about`, every card after the first.
- **`auditInView` has a size limit.** A node taller than about 285px in a
  413px frame throws, and the budget overview is 256px. A second seeded
  budget would make it throw, and the overview would then be audited as
  its summary and its cards.
- **A section that loads without a spinner is audited as it stands.** The
  pass waits for the landmark, the data it names and the route's loading
  spinners, and for nothing else.
- **The walkthrough opens no dialog, no category select and no menu.** The
  only overlay it audits is the household switcher's panel. The pickers,
  the import review's menu and the category dialog are held by their
  component specs, and `/import/file`, where the review card lives, is
  never visited. `/login` is opened by the redirect case and never audited,
  and `/lock`, `/ai`, `/search-history` and `/import/history` are never
  visited.
- **axe's `incomplete` results are not read.** A one-character text, and a
  label axe finds overlapped by another element, are filed there. In the
  runs that built the sweeps the second kind included the Paused chip's
  label, the period toggles' desktop labels, the inputs on `/settings` and
  `/household`, and the household switcher's closed trigger. No pass scores
  them.
- **The gate trusts what reaches the pipe.** It checks that the key exists,
  not that it names the surface the glyph sits on. Each pipe passes over
  what it cannot read, so a `var()`, or an alpha the data already carries,
  is for the component's rendered spec to measure. A colour set from a
  host binding, `Renderer2` or `element.style`, or through a bound custom
  property a stylesheet then reads, is not seen at all.
- **The menu's glyphs are a little lighter than the menu needs in dark.**
  The `menu` surface includes the select panel's selected tone, which no
  menu item paints. In dark it is the hardest menu tone.
