# 71. Direction comes from the locale, and physical CSS is frozen

**Status:** Accepted, implemented · **Date:** 2026-08-27 · **Issues:** #86

The locale itself is
[0036](0036-a-user-facing-string-lives-in-the-catalog.md)'s catalog and
[0058](0058-a-formatted-date-follows-the-chosen-language.md)'s formatters;
direction is the third thing that travels with a language. The gate follows
[0035](0035-what-the-emulator-cannot-see-is-checked-from-the-files.md)'s
practice of checking from the files what nothing at runtime will check.
Reference documentation lives in [../rtl.md](../rtl.md).

## Context

#86 is explicitly enablement: "no RTL locale yet", value **Low**. It asks for
three things.

Two of them are small and were done as asked — a `dir` field on `Language`, and
`documentElement.dir` written in `setLocale()`.

The third is "convert layout SCSS to logical properties", and it is not small.
The tree carries **107 physical-direction hits across 35 files** —
`margin-left`, `text-align: right`, `pl-4`, `translateX(-100%)` and their
relatives — spread across nearly every feature stylesheet. Converting them is a
mechanical edit with no test that can see it: with no RTL locale shipped,
nothing renders differently before and after, so a wrong offset in one of 35
files ships silently.

And there is a fourth problem #86 does not name. Writing `<html dir="rtl">`
mirrors CSS and nothing else. CDK's `Directionality` — which every Material
menu, tooltip, drawer, slider and overlay injects to decide which way it opens
— reads `body.dir || documentElement.dir` **exactly once, in its constructor**,
and never observes the attribute again. A locale switch would flip the
stylesheets and leave every already-constructed component positioning itself
the old way, which is worse than not supporting RTL: it is supporting it
visibly halfway.

## Decision

**The language declares its direction, one service moves both the attribute
and the components in one motion, and the physical CSS that remains is frozen
per file by a gate.**

### `dir` is data on the language, not a derivation

`Language` gains `dir: Direction`, set on all three entries (`ltr`, today,
every one). Carrying it rather than deriving it from the code means adding a
right-to-left catalog is a data change in one array, and the direction can
never disagree with the language the document declares — the two are written
from the same object, in adjacent statements.

Rejected: **deriving direction from the locale code**, either by an
`Intl.Locale(...).textInfo` lookup or a hard-coded list of RTL languages. Both
put the answer somewhere other than the entry that already says everything
else about the language, and the `textInfo` route is a runtime feature probe
for a fact that is known at authoring time.

### `AppDirectionality` is the CDK's `Directionality`

`AppDirectionality extends Directionality`, and `app.config.ts` aliases the
CDK token to it — `{ provide: Directionality, useExisting: AppDirectionality }`
— so every `inject(Directionality)` inside Material and the CDK resolves to the
app's instance. `setDirection(dir)` moves three things together: the
`documentElement.dir` attribute (the stylesheets), `valueSignal` (the
components that read it), and the `change` emitter (the components that
subscribe). Asking for the direction already in force is a complete no-op — no
attribute write, no emission — so the repeated `setDirection` on every switch
between two same-direction languages costs nothing and subscribers only ever
see real flips.

The call sits **beside** the `lang` write in `TranslationService.setLocale()`,
after the catalog has resolved. A load that failed never reaches either line,
so the document can never declare one locale's language with another's
direction. `index.html` ships `dir="ltr"` so the first paint has one.

**This relies on `valueSignal` being writable public API on `Directionality`
(CDK 22.)** That reliance is recorded here rather than discovered during an
upgrade. If a future major hides it, the fallback is to stop subclassing and
implement the contract wholesale — `value`, `valueSignal`, `change`,
`ngOnDestroy` — behind the same alias provider, which is the only part of it
Material and the CDK actually depend on. The alias is what makes that a
one-class change.

Rejected: **`BidiModule`, or the `dir` attribute alone.** `BidiModule` exports
the `dir` directive for scoping a *subtree*; neither it nor the attribute
re-reads for an already-built component, which is the entire failure being
fixed. Also rejected: **destroying and rebuilding the shell on a locale
switch**, which would throw away scroll position, open dialogs and in-flight
forms to avoid subclassing one service.

### The remaining physical CSS is frozen per file, and the ratchet fails stale in both directions

`scripts/check-direction.mjs` (`npm run direction:check`, a CI step) scans
`src/**/*.{scss,html}` for physical-direction declarations and Tailwind
utilities and compares the per-file counts against a frozen `BASELINE`. It
self-tests its own scanners first.

- **Per file, not a global total.** A single number lets a new `margin-left` in
  one component hide behind a conversion in another, and tells a reviewer
  nothing about where the debt is. A per-file map is self-locating, and its
  diff reads as progress: the entry drops, then the entry goes.
- **Staleness fails in BOTH directions.** Above the baseline is new physical
  CSS. A file with hits that the baseline does not list at all is new physical
  CSS in a file that had none. **Below** the baseline — or an entry for a file
  that is now clean or gone — is a ratchet that has stopped ratcheting: the
  slack it leaves is exactly where the next regression would land and pass. So
  converting means editing the map in the same commit, which is the point.
- **Source text, not rendered styles.** A Karma assertion would have to
  instantiate every component to see component-scoped SCSS, and would still
  only cover the components somebody remembered to add.

`--print-baseline` regenerates the map; `--self-test` runs the scanners over a
must-hit and a must-not-hit fixture list and is chained ahead of the live scan.
As with the other gate scripts there is no `.spec.ts` — the self-test is the
spec.

Rejected: **a global count ratchet** (above). Rejected: **converting all 107
survivors now** — an untestable 35-file diff, at value Low, for a locale that
is not planned; the shell was converted because it is the frame every page sits
inside and the first place a forced `dir="rtl"` shows a mistake.

### What stays physical, and why

Two exemptions, both narrow.

- **Safe-area insets.** A line mentioning `env(safe-area-inset-` or
  `var(--safe-` is exempt. The notch insets are physical by specification;
  there is no logical spelling to convert them to.
- **A `/* direction:physical` marker** exempts from the marker line through the
  closing brace of the immediately following balanced brace block — the block
  it annotates, nested braces included, and nothing else. A marker with no
  block after it covers only its own line, which is a comment and never had
  hits, so the gate still fires. Its one live use is the drawer slide keyframes
  in `main-layout.component.scss`, where `translateX(-100%)` is genuinely
  physical until a mirrored variant lands with the first RTL locale.

Comments are blanked before scanning with offsets preserved, so prose *about*
direction is not a violation — the converted stylesheets explain at length what
used to be there, and those notes are the reason the next person does not put
it back. The marker is read from the raw text for exactly that reason.

### Out of scope, and listed rather than forgotten

Four things a first RTL locale needs that this record does not do:
`SwipeRevealDirective`'s leftward-opens sign convention, fourteen directional
icons (`arrow_back`, `chevron_right` and friends) that would need mirroring,
Chart.js's own `rtl` / `textDirection` options, and the drawer keyframes above.
The inventory lives in [../rtl.md](../rtl.md) with an
add-an-RTL-locale checklist, because a known gap in an ADR is read once and a
checklist in a reference doc is read by the person doing the work.

## Consequences

- A locale switch is a real flip: the attribute, every constructed CDK
  component, and every component that subscribes to `change`, in one call.
- `direction:check` is a CI step, so physical direction can only shrink. A
  conversion slice is now a two-file commit — the stylesheet and the baseline.
- Nothing in the app is slower or different in an LTR locale. Every shipped
  language is `ltr`; the whole of this is inert until a catalog says otherwise.
- `TranslationService` gains a dependency on `AppDirectionality`, so its specs
  spy on `setDirection` rather than let a locale switch flip the direction of
  the page Karma itself is running in.

## Things that only became apparent while building

- **The lookarounds carry the whole weight of the utility patterns.**
  `border-r` without one matches `border-radius` in nearly two hundred places;
  `rounded-l` without a trailing boundary matches every `rounded-lg`; and the
  logical utilities we are converting *to* — `ms-`, `me-`, `ps-`, `pe-` — sit
  one letter away from the physical ones. A pattern that flagged those would
  make the gate unusable and get itself deleted, which is why the self-test's
  must-not-hit half is the interesting half.
- **A template needs a different comment masker.** Running the SCSS masker over
  markup reads the `//` in an `href` as a line comment and blanks the rest of
  the attribute — losing every utility class after it. `<!-- -->` gets its own
  pass, and a self-test case pins that a URL does not blank its own line.
- **The marker has to annotate a block.** Annotating a bare declaration inside
  an open rule would need the marker to guess how far it reaches; making it
  cover "the next balanced block" means the safe failure — no block, no
  exemption — is also the natural one.
- **The CDK owns a separate document token.** `DIR_DOCUMENT` is what the
  constructor reads and `DOCUMENT` is what the subclass writes, and the specs
  have to fake both. The CDK split them precisely so a test can move direction
  without flipping the page geometry-based tests are measured against.

## Known gaps

- **No RTL locale ships**, so nothing exercises the flip end to end. The
  specs assert `setDirection('ltr')` is the call an RTL locale would ride, and
  a manual `dir="rtl"` on `<html>` is the only full check.
- **107 hits remain in 35 files.** The gate stops them growing; it does not
  shrink them.
- **The scan cannot see physical direction expressed some other way** — a
  `flex-direction: row` that assumes a reading order, a `::before` positioned
  by a magic number, a right-aligned column built from `justify-content:
  flex-end`. Those are judgement calls, not greps.
- **Inline `style="margin-left: 4px"` in a template is invisible to it.**
  Templates are scanned with the utility patterns only; an inline style is a
  lint problem before it is a direction problem.
- **Angular Material's own stylesheets are not policed here**, and they are a
  large share of what would need to mirror.
