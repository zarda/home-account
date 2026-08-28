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
  not carry all eight destinations. The gate tests for the anchor, not the
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

## Known gaps

- **Only navigation has been audited.** Tab strips, segmented controls and the
  period selector express selection visually and have not been.
- **No landmark structure beyond `nav`.** The two navigation surfaces are
  indistinguishable to a user listing landmarks.
- **No automated accessibility check in CI.** Everything above is pinned by
  hand-written specs; nothing sweeps for the next instance of the same class —
  the one exception is direction, which `npm run direction:check` does gate.
- **Nothing measures a contrast ratio.** The high-contrast palette moves tokens
  further along a ramp by judgement; no gate checks the result against WCAG,
  and the surfaces and brand colours it leaves alone are unaudited.
- **Nothing sweeps for the next animation CSS cannot reach.** Chart.js and the
  Material tab strips were found by reading the code; a new WAAPI duration or
  canvas animation will honour neither kill-switch and no gate will say so.
- **RTL layout is groundwork only** (#86). Direction follows the locale and the
  physical CSS that remains is frozen per file, but no right-to-left locale
  ships and 107 hits are still unconverted — see [rtl.md](rtl.md).
