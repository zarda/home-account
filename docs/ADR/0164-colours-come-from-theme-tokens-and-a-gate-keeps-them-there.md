# 164. Colours come from theme tokens, and a gate keeps them there

**Status:** Accepted, implemented · **Date:** 2026-10-08 · **Issues:** #436

Reference documentation lives in [../accessibility.md](../accessibility.md).

Applies [0145](0145-a-class-found-by-reading-becomes-a-gate.md): a class of
defect found by reading, a colour written outside the theme's tokens,
becomes `colors:check`, a script in 0145's shape, and what it found is fixed
rather than frozen. Closes the gap of
[0151](0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)
that eighteen places still painted `--color-error` as a foreground on the
card, and the same gap in [../accessibility.md](../accessibility.md), whose
"Contrast is measured for the pairs somebody listed" now says what the new
gate sees.

## Context

`src/styles.scss` declares the colours the app paints as custom properties,
and the dark theme and the two high-contrast blocks redeclare them. A colour
written anywhere else paints the same in all four rendered modes: dark mode
and high contrast never reach it. #436 counted about thirty such places in
component stylesheets and templates. A reading of the tree at `c47d6f26`
found far more:

- 457 Tailwind palette utilities (`text-gray-500`, `dark:bg-red-900`, …) on
  228 `@apply` lines in 28 component stylesheets;
- 36 more in seven templates, 16 of them in the confirm dialog;
- 30 in four TypeScript class-string sources, 12 of them in two computed
  class helpers on the budget card that no template read;
- about 44 live raw colours, and 30 `var(--declared, #literal)` fallbacks that
  could never paint, 25 of them in the import preview table;
- three tokens nobody declared, `--color-warn`, `--color-accent-rgb` and
  `--color-primary-rgb`, so each always painted its fallback: the receipt
  manager's limit line was `#d32f2f` in both themes;
- 18 colour literals in chart datasets, which a canvas paints as strings.

Many of them failed AA where they stood. The dashboard's budget percentages
measured as low as 2.68:1 in light, gray-400 meta text 2.29:1 on the
Material card, the import review's possible-duplicate icon 1.63:1, the
swipe-delete label 3.76:1 in light and 2.77:1 in dark, and the confirm
dialog's icon 2.72:1 on its dark circle. Nothing reported them.
`contrast:check` scores the token pairs its table lists, and a colour
outside the tokens is in none of them. No gate read a stylesheet for colour.
The smoke walkthrough's axe pass measured one theme and the top of each page
it opened.

## Decision

**Every colour the app paints is a token declared in `src/styles.scss`,
reached through `var()`, a `var()`-backed Tailwind alias, a Material
component token set to a `var()`, or `ChartThemeService` for a canvas. A
colour that has to stay literal, such as a provider's logo, a scrim over a
photo or the category data itself, carries a marker with its reason.
`npm run colors:check` fails anything else, and nothing is frozen in it.**

### Aliases, by role

`tailwind.config.js` gains `var()`-backed aliases. A template or a
TypeScript class string keeps the utility shape it already had, and the
colour follows the theme and high contrast:

| Alias | Token |
|---|---|
| `fg`, `fg-secondary`, `fg-muted`, `fg-disabled`, `fg-inverse` | `--text-primary`, `-secondary`, `-muted`, `-disabled`, `-inverse` |
| `surface-background`, `surface-card`, … `surface-sunken` | the ten general `--surface-*` tokens |
| `line`, `line-subtle`, `line-strong` | `--border-primary`, `--border-secondary`, `--border-strong` |
| `brand`, `brand-soft`, `brand-text` | `--color-primary`, `--color-primary-light`, `--color-primary-text` |
| `accent`, `accent-light` | `--color-accent`, `--color-accent-light` |
| `error-text`, `warning-text`, `success-text`, `ai` | `--color-error-text`, `--color-warning-text`, `--color-success-text`, `--color-ai` |

The grays map by role. Gray-900 and 800 became `fg`, gray-700 and 600
`fg-secondary`, and gray-500 and 400 both became `fg-muted`. Gray-400 is
light's `--text-disabled`, but as running text it measured 2.29:1 on the
Material card, so nothing readable is painted in it. For borders, gray-100
and 200 became `line`, and gray-300 (gray-600 in dark) became `line-strong`.

### Four tokens and six surfaces

- `--border-strong` (`#d1d5db` / `#545454`) is one step past
  `--border-primary`, for a hover outline or a dashed edge. Each
  high-contrast block overrides it.
- `--color-success-text` (`#15803d` / `#86efac`) is the readable success
  colour. The base token is a fill, 2.28:1 on white.
- `--color-ai` (violet-600 / violet-400) paints the AI and multi-image
  features, so they read apart from the brand indigo beside them.
- `--color-error-strong` (`#b91c1c` / `#f87171`) is a solid red under
  `--text-inverse`, since white on `--color-error` is 3.76:1. The
  swipe-delete action is filled with it.

Six named surfaces replace tints that components used to paint for
themselves: `--surface-suggestion` and its hover, `--surface-icon-selected`,
`--surface-review-selected`, `--surface-review-duplicate` and
`--surface-menu-current`. Each is a `color-mix()` of its tint into the
surface it covers. Each is opaque, so a colour painted on it is a pair of
two declared colours.

### A tint mixes with what it replaces

A tint that carries text is a `color-mix()` of a token into the background
it replaces:

```scss
color-mix(in srgb, var(--color-X) N%, var(--surface-card))
```

That background is the card, the page, or a dialog's `--mat-sys-surface`.
The tint is opaque, and the text's contrast no longer depends on whatever
happens to sit underneath. A border or a glow mixes with `transparent`. An
alias takes no `/alpha`, so a translucent utility became a `color-mix()` in
the component's stylesheet.

### A fill token is not a foreground

The base `--color-*` token is a fill, `-light` is a tinted background, and
`-text` is the readable foreground. Text reads in `-text`. A glyph may stay
on the fill only where a `contrast:check` row holds it at the 3:1 that WCAG
1.4.11 asks of a graphic. Of the eighteen places 0151 counted:

- the ten that were text now read in `--color-error-text`;
- the recurring rules page's two, its Delete item's label and icon, are now
  `.menu-item-destructive` (below);
- the six glyphs stay on `--color-error`, held at 3:1 by two such rows, one
  on the card and one on the page.

### Material is coloured through its tokens

A host `color` does not reach what Material paints. A menu item's label and
icon, a chip's label, an outlined button's edge, a text button's label and a
progress bar's indicator each read a `--mat-*` token. Material's rule either
outranks a utility or a component class, or ties with it and wins on
stylesheet order. So each site sets the token to a `var()`:

- `.menu-item-destructive` in `styles.scss` sets
  `--mat-menu-item-label-text-color` and `--mat-menu-item-icon-color` to
  `--color-error-text`. It replaced four reds and an `!important`.
- A budget bar sets `--mat-progress-bar-active-indicator-color`: the
  success, warning or error `-text` token for its severity. A reached goal's
  bar uses the success one.
- The Paused chip sets `--mat-chip-label-text-color` and
  `--mat-chip-elevated-container-color`.
- The receipt buttons' and the data page's export buttons' edges set
  `--mat-button-outlined-outline-color`.

### Charts read the palette

`ChartThemeService.palette()` gains `income`, `expense` and `accent` fills,
each with an edge. The income and expense edges read the `-text` tokens,
because the fills fall under 3:1 on the light card. The accent clears 3:1 as
it is and serves as its own edge. The palette is re-read when the theme or
high contrast changes. The datasets read it inside their own computed
signals, so the canvas redraws. Translucent fills go through `hexToRgba`,
which uses Chart.js's own colour parser, because a hand-built `rgba()`
string is a literal to the gate.

### Dead colour code is deleted, not recoloured

The deleted code includes:

- the budget card's `alertChipClass` and `alertTextClass`;
- the transaction filters' `.add-btn` and `.add-label`, with their 640 px
  rules;
- the dashboard budget widget's `::ng-deep` `--mdc-linear-progress-track-color`
  rule;
- `styles.scss`'s dark `--mdc-outlined-text-field-*` block.

Material 22 reads neither of the last two. Each slice deleted the dead rules
it found in the same way.

### The gate

`scripts/check-colors.mjs` runs as `npm run colors:check`, and in CI between
the contrast and icon-label checks. It reads `src/app/**/*.{scss,html,ts}`,
leaving out specs and `testing/` helpers, and `src/styles.scss`, where a
theme token's own declaration is exempt. A component's inline `styles:` is
read as a stylesheet. It fails four kinds of colour:

- **A palette utility**, in an `@apply`, a stylesheet value, a template's
  class bindings or any TypeScript string. An alias given an `/alpha` fails
  too, because Tailwind silently generates nothing for it.
- **A literal.** That is a hex, `rgb()`/`hsl()` or named colour in a
  stylesheet value, or a colour quoted in TypeScript or in a template,
  Tailwind's arbitrary `bg-[#…]` included. In an `@apply` it is a hex or a
  functional colour anywhere, or a named colour inside an arbitrary value
  (`text-[red]`), which a class list is read for too. A system colour inside
  a `forced-colors` block passes.
- **A fallback or a mix.** `var(--declared, #literal)` is a fallback that
  can never paint. `var(--undeclared, #literal)` is one that always does. A
  `color-mix()` fails when an operand is not a declared `var()`,
  `transparent` or `currentColor`.
- **A bound colour** (`[style.color]`, `[style]`, `[attr.fill]`, …), in
  any spelling Angular compiles to the same binding: `bind-style.color`, an
  interpolated `style.color="{{ c }}"`, or an interpolated `style`. #461's
  category work widened this rule to every colour property and attribute,
  and lets a bound colour through only on the category chip, as a
  string-literal `var()`, or when `categoryGlyph` or `readableOn` corrects
  it last.

Counts are kept per file and per matched token. Swapping `text-gray-500`
for `text-slate-500` therefore gives one new token and one stale one, and
both fail. `--print-baseline` generates the baseline, which fails when it is
stale in either direction. It opened at 612 hits in 53 files, plus 34
category hits in 21 files that #461 cleared, and it is empty now.

A colour meant to be literal is marked where it stands, with
`colors:allow(<kind>) <reason>` on its line or an `allow-start` …
`allow-end` block around it.
The `ALLOWED` table records, per file and kind, how many hits the markers
exempt, with a reason. That count fails when it is stale in either
direction, so a block cannot widen silently. There are six kinds:

- **`brand`:** the login gradients and glass, the Google logo, the provider
  avatars and the settings link tiles;
- **`scrim`:** a veil over a photo;
- **`category-data`:** a category's own colour, as data or as a fill;
- **`token-mirror`:** a TypeScript constant that a spec holds to the
  stylesheet;
- **`token-fallback`:** the values the chart palette uses before the
  stylesheet loads;
- **`browser-chrome`:** the `theme-color` meta.

Today 150 hits are marked, in 17 files.

### How each slice was held

The conversion ran one area of the app at a time. Each slice removed its
files' baseline rows in its own commit. A slice that cleared a file converted
every hit in it, not only the ones the issue named. Each colour it changed is
measured as painted, in both themes, by a spec that renders the real
template.

- `core/services/testing/painted-contrast.ts` composites translucent fills
  and faded ancestors, reads a `:hover` rule from the CSSOM, and stamps a
  theme for a token probe.
- `theme-aliases.spec.ts` holds every alias to its token in all four modes.

The closing commit deleted the Tailwind config's `primary` hex ramp, which
nothing used. The gate still lists `primary` as a palette name, so
`text-primary-600`, which now generates no CSS, fails instead of silently
disappearing.

## What was rejected

- **Per-site classes.** A component class for each painted colour, such as
  `.percent-warning { color: var(--color-warning-text) }`, would have
  converted the stylesheets. The template utilities and the TypeScript class
  strings would then have become class bindings, one component at a time.
  An alias keeps the shape those call sites already have, and it carries
  high contrast to every utility at once. No `gray-*` or `indigo-*` utility
  ever followed high contrast.
- **A ratchet left standing.** `direction:check` keeps its physical-direction
  hits frozen per file, and `colors:check` could have frozen its 612 the
  same way and let them drain. But many were AA failures in one theme or the
  other, and a frozen row goes unseen until somebody reads the table. The
  baseline stays as a mechanism and stays empty, as 0151 kept its freezes.
  The next colour either fails or is marked with a reason.
- **`<alpha-value>` aliases.** Tailwind's `rgb(var(--x-rgb) / <alpha-value>)`
  form would make `bg-brand/12` work. The price is a channel-triple twin of
  every token in all four palettes. The tree already held that shape once:
  the About page's `rgba(var(--color-accent-rgb, 63, 81, 181), 0.1)`. Its
  twin was never declared, so it painted the fallback in every theme. A
  translucent tint also takes on whatever lies under it, which is exactly
  the defect the opaque mixes remove.

## Consequences

- **The issue's four checks hold:**
  - its hex grep prints fourteen lines, all inside `brand` blocks;
  - no colour utility is left in a template;
  - the import wizard's error icons, the dropzone's status colours and the
    category manager's Delete follow the theme;
  - `colors:check` self-tests, runs in CI and fails a fixture with one raw
    colour.
- **Dark mode and high contrast reach every surface the tokens paint.**
  `--border-strong` joins the legibility tokens high contrast moves, and the
  chart palette follows high contrast too.
- **Some changes are visible:**
  - The ten error lines that moved to `--color-error-text` are `#fecaca` in
    dark, a pale pink, where they were `#f87171`. In light they are
    `#b91c1c`, a darker red than the `#ef4444` they replaced.
  - A budget bar shows its severity in green, amber or red, where every bar
    was Material's indigo. A reached goal's bar is green.
  - The budget card's Delete item reads red for the first time. Its old rule
    never reached the overlay the menu renders in.
  - The camera's drag handle and the import caption sit on an even 60%
    black veil. Over white paper that veil is a mid grey, and a white glyph
    on it reads 5.74:1.
- **The web manifest's `theme_color` is the brand `#3F51B5`**, matching the
  light `theme-color` meta and `ThemeService`. It was `#1976d2`. The iOS copy
  under `ios/` follows on the next `cap sync`.
- **`contrast:check` gained a row for every new pair this work paints:**
  the new tokens, the error text and glyphs, the review card's flags and
  dots, and five graphics held at 3:1.
- **No rules, indexes or functions change.**

## Departures from the issue

- **The scope is wider than the issue.** The issue counted about thirty
  colours in stylesheets and templates and proposed a gate over `*.scss` and
  `*.html`. The user widened it to everything: all 228 `@apply` lines, the
  TypeScript class strings, the chart datasets, the dead and undeclared
  fallbacks, and whatever the two-theme scrolled sweeps then exposed, such
  as the Budgets tab badge at 4.42:1 in dark. So the gate also reads
  TypeScript and `styles.scss`, counts per token rather than per file, and
  carries #461's binding rule.
- **`--color-ai` is a new token.** The issue asked for each raw colour to be
  replaced by the semantic token it means, and it named the four semantic
  families. The violets in the import wizard, the dropzone and the data page
  meant none of them. Folding them into `--color-accent` would have made the
  AI features indistinguishable from the brand indigo beside them, so they
  got their own token. It is held at 3:1 on the card, as an icon colour.
- **Critical is folded into warning.** The dashboard's budget percentage and
  the budget card's alert painted a budget's critical step orange. There is
  no orange token, and a fifth semantic family for one step was not worth
  it. Critical now reads in `--color-warning-text`, as the bars' severity
  mapping already grouped it with warning. The budget alert banner already
  painted critical in the expense red, and it is unchanged. The alert's
  words name the step.

## Things that only became apparent while building

- **Fill tokens were still painted as foregrounds after the last slice.** A
  sweep of `--color-warning`, `--color-success`, `--color-info` and
  `--color-error` found 18 foreground sites. Ten were under their bar, down
  to 1.76:1 for a review card's verify flag in light, and moved to `-text`:
  the date chip, the flags and the confidence dots. Several of
  `contrast:check`'s `NOT_PAINTED` reasons, which said a token was never
  text, had been untrue. The duplicate badge read 4.41:1 on its 15% warning
  tint, and it moved to `--color-warning-light` (4.68:1). The gate cannot
  see any of this: a fill token is still a token.
- **`[color]` on a progress bar paints nothing.** Under `mat.theme()`, which
  the app adopted in `779dae26`, the `mat-accent` and `mat-warn` classes
  carry no colour. Material 22 paints the indicator from
  `--mat-progress-bar-active-indicator-color` alone, falling back to
  `--mat-sys-primary`. So every budget bar was the same indigo, whether it
  was a warning or over budget, and so was the goal card's reached bar. The
  indicator is the top border of `.mdc-linear-progress__bar-inner`, not a
  background, so the specs read `borderTopColor`.
- **The scored pair made the Budgets tab badge vanish.** On the scored
  `--color-primary-text` / `--color-primary-light` pair, the count read
  6.15:1, but the pill itself was 1.03:1 against the light page. The fill is
  now a 16% primary tint mixed into the page, so the count reads 4.99:1 in
  light and 9.45:1 in dark. Its spec holds the pill at least 1.2:1 from the
  strip behind it.
- **A host colour does not reach a Material label.** The Paused chip's
  `color: … !important` never reached `.mdc-evolution-chip__text-label`.
  Material paints that label from `--mat-chip-label-text-color`, so the
  label read in Material's on-surface-variant. A delete item's rule nested
  under the budget card's class never reached the item at all, because the
  menu renders in the overlay. A top-level component rule does reach it,
  because the overlay keeps the item's `_ngcontent` attribute. On the
  recurring rules page, such a rule outranked the tokens that
  `.menu-item-destructive` sets, so it was deleted.
- **Karma cannot hover, and it orders stylesheets backwards.**
  - A `:hover` colour is read from the CSSOM with `hoverValue`, matching the
    selector by `includes` because emulated encapsulation rewrites it, and
    is then applied by hand.
  - Karma links the global stylesheet at the end of `<body>`, after every
    component `<style>`, while the app has it first. So a rule that ties
    with a Material rule on specificity passed in Karma and lost in the
    app. The transaction form's spec rebuilds the app's order
    (`withAppCascade`). The outlined buttons' dashed edges go through
    Material's own token, which paints the same in either order.
- **`--mat-sys-*` are `light-dark()` pairs.** They follow `color-scheme`,
  which the theme class on `<html>` sets. A probe with neither class
  therefore reads the host's OS scheme, so `withTheme` stamps exactly one.
  `contrast:check` reads declared values, so it cannot score a pair painted
  on them (see Known gaps).
- **Deleting dead colour rules showed what they had hidden.** The insights
  summary's `.structured-content` rules were encapsulated and never reached
  the markdown bound through `[innerHTML]`. So the summary had never been
  styled. It is now styled through `:host ::ng-deep`, and the markdown
  helper no longer wraps a heading in a paragraph.
- **A `mat-icon` sized by a Tailwind `text-*` utility takes that utility's
  line-height**, which pushes the glyph below the centre of its row. Seven
  such icons were found. Each now takes its size from the type tokens, with
  a 1 em box and a line-height of 1.
- **The second browser run found two pairs no table scored, both older than
  this work.** The data page's kind glyph, `--color-primary` on its own 14%
  tint, read 3.97:1 at rest in dark and 2.68:1 once the row's hover surface
  lightened what was under it; it now takes `--color-primary-text`, 8.53:1
  at rest and 5.7:1 hovered. The import wizard's upcoming step number,
  `--text-muted` on `--surface-hover`, read 4.28:1 in dark; it now sits on
  `--surface-muted`, the empty states' pair, at 5.42:1, with a
  `--border-strong` edge, because that fill is 1.01:1 against the light
  page and the circle would vanish there. `--text-muted` on
  `--surface-hover` is the pair the settings avatar placeholder failed on
  too ([0169](0169-a-categorys-colour-is-drawn-through-the-chip-or-a-pipe-that-knows-its-surface-and-the-axe-pass-sweeps-both-themes-below-the-fold.md)).
- **The whole-branch review found five more pairs no table scored.**
  `--text-muted` on `--surface-hover` (4.28:1 in dark) was still painted at
  rest on the review card's chips and under every hover, so the dark token
  moved from gray-400 to `#a3a9b5` (4.60:1). Indigo text on
  `--surface-hover`, on its own tint or on `--surface-active` (2.81 to
  4.25:1 in dark: the wizard's step under way, About's feedback category, a
  hovered row's place link, the review card's hovered note button, the
  list's hovered add-row button, the sidebar's current page) now reads in
  `--color-primary-text`, the export dialog's chosen format describes
  itself in `--text-secondary`, and the receipt, split and summary marks
  painted in `--text-disabled` (2.54:1 in light) read in `--text-muted`.
  Every pair on a declared surface is now a `PAIRS` row, the preview spec
  holds the two labels on the tint, and nothing paints `--text-disabled`.
- **The same review found a marker wider than its reason, and two shapes
  the gate could not read.** The camera's `brand` block also covered its
  scan-mode badges' white labels, 2.02 to 3.56:1 on their gradients, and the
  cloud badge wore Google's colours whichever provider it named. The badges
  now sit on the scored success and primary pairs, 4.57:1 at the lowest, and
  the block is gone. An arbitrary colour inside an `@apply`
  (`bg-[#123456]`, `text-[red]`) was read for palette names only, and a
  component's inline `styles:` for literals and palette names only; both are
  now read like any stylesheet value.

## Known gaps

- **Material's surfaces and the mixed surfaces are not scored.**
  `contrast:check` scores declared token values. It cannot read the
  `light-dark()` pairs that `mat.theme()` emits for the Material card, a
  dialog, a menu panel and a progress track. Nor can it read the six
  `color-mix()` surfaces. Pairs painted on any of them are held only by the
  rendered spec of the component that paints them, with the measured ratios
  written into the table rows' reasons. A new site on one of these surfaces
  has only the axe pass.
- **Severity is told by hue alone.** In light, a within-budget green
  (`#15803d`) and a warning amber (`#b45309`) have the same luminance, 1.00:1
  apart, and the dark pair is 1.03:1 apart. The dashboard's budget widget
  shows only its coloured percentage, at any width. Below 640 px the budget
  card's alert hides its words and shows only its glyph, the same `warning`
  glyph for both steps, so a critical budget looks exactly like a warning
  one there.
- **A chart bar's fill is held to nothing.** The edge carries the 3:1. The
  fill is `--color-income` or `--color-expense` at 80%, or at 35% for last
  year's bars, which share this year's opaque edge. So the two years are
  told apart by fill alpha, position and the legend, and no gate or spec
  measures the fills.
- **A token can be the wrong token.** `color: var(--text-muted)` on a tint
  where it fails AA passes `colors:check`, and `contrast:check` scores only
  the pairs its table lists. The fill-token sweep was a reading, and
  nothing repeats it. A `NOT_PAINTED` reason is prose that no script checks
  against the stylesheets.
