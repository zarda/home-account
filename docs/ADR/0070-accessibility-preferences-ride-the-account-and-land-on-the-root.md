# 70. Accessibility preferences ride the account, and land on the root

**Status:** Accepted, implemented · **Date:** 2026-08-27 · **Issues:** #81

Follows the carrier pattern `ThemeService` established: a signal, an effect,
and a mark on `documentElement`. Reference documentation lives in
[../accessibility.md](../accessibility.md) under *Accessibility settings*.

## Context

#81 asked for three things the app had never offered — a text scale, a
higher-contrast palette, and a motion switch — and named `ThemeService` as the
model. Two of the three had no implementation at all. The third half-existed
and is the interesting part.

`styles.scss` already carried a `prefers-reduced-motion: reduce` block that
collapses every animation and transition to `0.01ms`. Beside it,
`core/layout/motion.ts` exported `prefersReducedMotion()` and
`tabAnimationDuration()`, read by the Budgets and Reports tab strips. Its own
header said why it existed:

> Angular Material component animations run through the Web Animations API and
> are driven by explicit `animationDuration` inputs, which CSS can't reach.

Both halves read the OS media query directly. That is fine for an OS
preference and useless for an in-app one: a media query cannot be turned on
from JavaScript, so an account that asks for less motion inside the app would
have been honoured by neither the CSS block nor the two tab strips. The same
hole runs one layer deeper — Chart.js animates a canvas off the main thread,
where no stylesheet reaches at all, and nothing was disabling it.

So the decision is not "add three settings". It is: where do the settings
live, what do they touch, and what has to be re-plumbed because CSS cannot
reach it.

## Decision

**The three preferences are account fields with tolerant resolvers, and the
service carries them to exactly one CSS variable, two classes on `<html>`, and
one signal for the animations CSS cannot see.**

### Three optional fields, three total resolvers

`UserPreferences` gains `fontScale?: number`, `highContrast?: boolean`,
`reducedMotion?: boolean`. None is required, and nothing reads them directly.
`effectiveFontScale`, `highContrastEnabled` and `reducedMotionRequested` in
`user.model.ts` are total functions over `UserPreferences | null | undefined`,
each returning its default for absent input, and `effectiveFontScale`
additionally for a value outside `FONT_SCALES` (`[1, 1.15, 1.3]`). That is
`effectiveAppLockTimeoutMinutes`' shape, which is `effectiveRagLevel`'s shape:
a stored preference is data another build may have written, and a resolver
that trusts it is a resolver that renders at scale 4.

### The account, not the device

A person who needs 30% larger text needs it on the phone and on the laptop.
The account already carries `theme` and `language` for exactly that reason,
and these three sit beside them, written through `updateUserPreferences` with
dotted field paths so only the touched key is sent.

Rejected: **`localStorage`.** It is where the sidebar's collapse preference
lives, and that is the right home for it — a docked sidebar is a property of
the screen in front of you. A contrast requirement is a property of the person,
and storing it per device means a new device silently reverts to a palette they
cannot read, on the surface where they would least be able to fix it.

### Absence resets, which is why the resolvers are total

`AuthService`'s preferences effect calls `accessibilityService.init(prefs)`
**unconditionally** — unlike the language and theme branches beside it, which
are guarded on the key being present. An account switch inside one session
whose new preferences carry none of these keys must reset the previous
account's font scale, not inherit it, and the resolvers returning their
defaults for absent input is what makes that a one-line call rather than three
branches. The guarded shape would have been the bug: signing out of an account
with high contrast on and into one without it would have left the second
account reading a palette it never chose.

### One variable, two classes

- `--app-font-scale` is written to `documentElement.style`, and `styles.scss`
  reads it: `html { font-size: calc(100% * var(--app-font-scale, 1)); }`. At
  the default scale the property is **removed** rather than set to `1`, so the
  CSS fallback stays in control and the inline style disappears entirely.
- `.high-contrast` and `.reduced-motion` are toggled on `documentElement`,
  which is where `.light-theme` / `.dark-theme` already live.

Rejected: **a class per font step.** A class sets a size; the variable
multiplies whatever the root already is. The type scale is expressed in `rem`
and icons in `em` precisely so a non-16px effective root carries every one of
them along with it — and a browser font size the user set for themselves is
part of that root. A class-per-step overrides that choice instead of composing
with it, and adding a fourth step would mean a fourth class, a fourth
stylesheet block, and a lookup table mapping the stored number onto it.

High contrast is deliberately **not a second theme**. It moves legibility
tokens only — `--border-primary`, `--border-secondary`, `--text-secondary`,
`--text-muted`, `--text-disabled` — each further along the ramp its theme
already uses, plus a 3px focus ring. Surfaces and brand colours are untouched.
A `.dark-theme.high-contrast` block continues the dark-neutral ramp rather than
inventing stops, so the two multiply instead of fighting.

### Reduced motion ORs, and reaches past CSS through one signal

`AccessibilityService.reducedMotion()` is `computed(() => storedPreference ||
systemPreference)`, the system half fed by a `matchMedia` listener. Everything
downstream reads that one signal:

- **CSS** gets `.reduced-motion`, whose declarations are the same kill-switch
  as the `prefers-reduced-motion` media query. The block is duplicated rather
  than shared because a media query cannot be switched on from script; the
  media query keeps honouring the OS with no JavaScript at all, and the class
  adds the in-app override on top.
- **WAAPI** gets `AccessibilityService.tabAnimationDuration` — a computed
  resolving to `'0ms'` or `'200ms'`, bound to the Budgets and Reports strips'
  `[animationDuration]`.
- **Canvas** gets `ChartThemeService.animation()`, which returns `false`
  instead of `{ duration: 400 }`.

`core/layout/motion.ts` is **deleted**, not adapted. Its two functions read the
media query at call time, so the in-app override could never have reached them,
and a helper that answers the OS question next to a service that answers the
real one is the ambiguity that produces the next half-honoured setting. Its
callers now read the signal, which also makes them reactive: a toggle in
Settings re-renders the tab strip instead of waiting for the next construction.

Rejected: **overriding the media query itself.** There is no way to; that is
the whole reason this record exists. The near neighbours are worse — writing
`prefers-reduced-motion` into a `<meta>`, or dropping the media query and
driving both cases from the class, which would make the OS preference depend
on the app having booted and on the account having loaded.

## Consequences

- **No Firestore rules change.** `userUpdateValid` checks that the post-merge
  document still presents `preferences` as a map; it does not enumerate fields.
  A rules smoke assertion pins that the dotted update of all three is accepted,
  so the absence of a rules change is asserted rather than assumed.
- The `settings_change` analytics event's `setting` parameter gains
  `font_scale`, `high_contrast` and `reduced_motion`, and the registry and
  `../analytics.md` list a second call site for it.
- Anything that later needs to know whether motion should be reduced injects
  `AccessibilityService`. There is no free function to reach for any more.
- Font scale reaches the native shells too, since it multiplies the root the
  WebView renders at.

## Things that only became apparent while building

- **The settings control cannot read the service for all three.**
  `AccessibilityService.reducedMotion()` is the *resolved* value, and a toggle
  bound to it would show "on" — unturnable off — for a user whose OS asks for
  reduced motion, while writing `false` to an account preference that was
  already false. The control reads `reducedMotionRequested(currentUser()
  ?.preferences)` instead, and font scale and high contrast keep reading the
  service's signals, where resolved and stored are the same value. The
  asymmetry looks like an oversight in the component and is the point of it.
- **Removing the variable is not the same as setting it to 1.** They render
  identically, and only one of them leaves the CSS fallback answering. The
  distinction matters the moment the fallback becomes anything other than `1`.
- **`effect()` is what writes the DOM**, not the setters. The setters move a
  signal; three effects in the constructor apply. That is what makes `init()`
  and a settings toggle indistinguishable downstream, and it is why an account
  arriving with `highContrast: true` needs no separate application path.

## Known gaps

- **No per-device override.** The preference is the account's, everywhere. A
  shared account on a shared screen has one answer.
- **High contrast does not touch surfaces or brand colours**, so a
  low-contrast brand button stays low-contrast. It raises edges and secondary
  text; it is not a WCAG audit, and nothing measures a ratio.
- **The `forced-colors` work is separate** and older
  ([0055](0055-the-active-route-is-announced-not-only-coloured.md)). A user in
  forced-colors mode gets the system palette regardless of `.high-contrast`;
  the two are not tested together.
- **Nothing sweeps for the next unreachable animation.** Chart.js and the
  Material tab strips were found by reading; a new canvas or a new WAAPI
  duration will honour neither the class nor the media query, and no gate says
  so.
- **The scale list is three steps.** A fourth is a one-line change to
  `FONT_SCALES` plus a label key, and `fontScaleLabelKey`'s index-based
  branches are the thing that would need rewriting.
