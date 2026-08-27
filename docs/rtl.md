# Layout direction

Every locale the app ships is left-to-right, and none of the work below is
visible today. It exists so that adding a right-to-left catalog is a data
change rather than a rewrite, and so that the physical-direction CSS still in
the tree can only shrink between now and then.

The reasoning and the rejected alternatives are in
[ADR 0071](ADR/0071-direction-comes-from-the-locale-and-physical-css-is-frozen.md).

The short version: **the language declares its direction, one service moves
the whole app to it, and `npm run direction:check` freezes the physical CSS
that has not been converted yet.**

## Where direction comes from

`Language.dir` — a field on each entry in `TranslationService.languages`, not a
derivation:

```ts
{ code: 'en', name: 'English', nativeName: 'English', dir: 'ltr' },
{ code: 'tc', name: 'Traditional Chinese', nativeName: '繁體中文', dir: 'ltr' },
{ code: 'ja', name: 'Japanese', nativeName: '日本語', dir: 'ltr' }
```

`setLocale()` writes it immediately after `documentElement.lang`, and only
after the catalog has resolved — a load that failed never reaches either line,
so the document can never declare one locale's language with another's
direction.

```ts
document.documentElement.lang = locale === 'tc' ? 'zh-Hant' : locale;
this.directionality.setDirection(this.currentLanguage().dir);
```

`index.html` ships `dir="ltr"`, so the first paint has a direction before any
catalog loads.

## Why the attribute is not enough

CDK's `Directionality` reads `body.dir || documentElement.dir` **exactly once,
in its constructor**, and never looks at the attribute again. Every Material
menu, tooltip, drawer, slider and overlay injects it to decide which way it
opens. Setting `<html dir>` alone therefore reaches the stylesheets and nothing
else: already-constructed components keep positioning themselves the way they
were born.

`AppDirectionality` (`core/services/app-directionality.ts`) subclasses it, and
`app.config.ts` aliases the CDK token to the app's instance:

```ts
{ provide: Directionality, useExisting: AppDirectionality }
```

so every `inject(Directionality)` inside Material and the CDK resolves to it.
`setDirection(dir)` moves three things in one motion:

| What it writes | Who reads it |
|---|---|
| `documentElement.dir` | the stylesheets, and any component constructed later |
| `valueSignal` | components that read the signal |
| `change` (an `EventEmitter`) | components that subscribed at construction |

Asking for the direction already in force is a complete no-op — no attribute
write, no emission — so the repeated call on every locale switch between two
same-direction languages costs nothing, and subscribers only ever see real
flips.

This relies on `valueSignal` being writable public API (CDK 22). If a future
major hides it, the fallback recorded in ADR 0071 is to stop subclassing and
implement the contract wholesale — `value`, `valueSignal`, `change`,
`ngOnDestroy` — behind the same alias. The alias is what keeps that a
one-class change.

## The direction gate

`npm run direction:check` (`scripts/check-direction.mjs`, a CI step) runs a
self-test of its own scanners and then compares the physical direction in
`src/**/*.{scss,html}` against a frozen per-file baseline.

Today: **107 hits in 35 files.** Every number in that map is a debt, and the
only legal edits are downward.

### What counts as a hit

| Where | Patterns |
|---|---|
| Stylesheets | `left:` / `right:`, `margin|padding|border-left|right`, `text-align: left|right`, `float: left|right`, `translateX(` |
| Stylesheets, on `@apply` lines | the utility patterns below as well |
| Templates | `ml-`/`mr-`/`pl-`/`pr-` + digit, `text-left`/`text-right`, `left-`/`right-` + digit, `rounded-tl|tr|bl|br|l|r`, `border-l`/`border-r` |

When it fails it names the file, the line, the text, and the logical spelling
to reach for (`margin-left:` → `margin-inline-start`, `-mr-1` → `me-*`,
`rounded-tl-` → `rounded-ss-*`).

### The baseline is per file, and stale in both directions is a failure

- **Above** the baseline — new physical CSS in a file that already had some.
- **Not listed at all**, with hits — new physical CSS in a file that was clean.
- **Below** the baseline, or an entry for a file that is now clean or gone —
  the ratchet has stopped ratcheting. The slack is exactly where the next
  regression would land and pass, so this fails too.

That last one is the rule that matters day to day: **converting a file means
editing the baseline in the same commit.** A conversion slice is a two-file
change — the stylesheet and the map.

### The two flags

```
node scripts/check-direction.mjs --print-baseline
```

prints the map for the current tree, sorted and copy-pasteable. That is how the
frozen map was generated and how it should be regenerated after a slice; the
hit and file totals go to stderr so a redirect captures only the map.

```
node scripts/check-direction.mjs --self-test
```

runs the scanners over embedded must-hit and must-not-hit fixtures. It is
chained ahead of the live scan by the npm script, and there is no `.spec.ts` —
the self-test *is* the spec, as with the other gate scripts. Its must-not-hit
half is the interesting one: `border-radius` is not `border-r`, `flex-start` is
not a start utility, `me-2`/`ms-2`/`ps-5` are the logical utilities we are
converting *to*, and `margin-inline-end` and `text-align: end` are the finished
product. A pattern that flagged those would make the gate unusable and get
itself deleted.

## Exemptions

Comments are blanked before scanning, with byte offsets preserved, so prose
*about* direction is not a violation. The converted stylesheets explain at
length what used to be there, and those notes are the reason the next person
does not put it back.

**Safe-area insets.** A line mentioning `env(safe-area-inset-` or `var(--safe-`
is exempt. The notch insets are physical by specification; there is no logical
spelling to convert them to.

**The `/* direction:physical` marker.** A comment containing that token exempts
from the marker line through the closing brace of the **immediately following
balanced brace block** — the block it annotates, nested braces included. It
exempts nothing else:

```scss
/* direction:physical — drawer slide; mirrored variant lands with the first RTL locale */
@keyframes slideIn {
  from { transform: translateX(-100%); }
  to   { transform: translateX(0); }
}

.after { margin-left: 8px; }   /* still a hit */
```

Annotate the **block**, not a bare declaration. A marker with nothing but
declarations after it — the enclosing block closes first, or the file ends —
covers only its own line, which is a comment and never had hits, so the gate
still fires. That is the safe direction on purpose.

The marker is read from the **raw** text, before comments are masked. Masking
would blank the marker along with everything else.

Its one live use is the drawer keyframes in
`shared/layout/main-layout/main-layout.component.scss`.

## What the gate deliberately cannot see

- Physical direction expressed some other way: a `flex-direction: row` that
  assumes a reading order, a `::before` placed by a magic number, a
  right-aligned column built from `justify-content: flex-end`. Judgement calls,
  not greps.
- Inline `style="margin-left: 4px"` in a template. Templates are scanned with
  the utility patterns only; an inline style is a lint problem first.
- Styles arriving through Angular Material's own stylesheets.
- `!ml-2` written with a leading important marker, which the lookbehind steps
  over rather than risk mangling other `!` forms.

## Still to do before an RTL locale renders correctly

The conversion is the large item — 107 hits, 35 files — but it is not the only
one. These are known, in scope for a first RTL locale, and out of scope for the
groundwork:

| | Where | What is wrong under `rtl` |
|---|---|---|
| **Swipe-to-reveal** | `shared/directives/swipe-reveal.directive.ts` | The sign convention is fixed: a leftward fling opens, a rightward one closes, and the drawer is parked off-canvas by the caller's own stylesheet. Under RTL the gesture and the drawer both need mirroring, and the fling thresholds are signed. |
| **Directional icons** | 14 sites | `arrow_back`, `arrow_forward`, `chevron_right` — a back arrow that points left is wrong in an RTL page. Material's font has no automatic mirroring; either a `[dir="rtl"]` transform or a per-site swap. |
| **Chart.js** | `core/config/chart.config.ts`, `core/services/chart-theme.service.ts` | Chart.js has its own `options.rtl` and `options.plugins.*.rtl` / `textDirection`; none is set. A canvas does not inherit the page's direction. |
| **Drawer keyframes** | `main-layout.component.scss` | Behind the `direction:physical` marker. Needs a mirrored variant behind `[dir="rtl"]`, at which point the marker goes. |

## Adding an RTL locale

1. **`Language` entry.** Add the code to `SupportedLocale`, then an entry in
   `TranslationService.languages` with `dir: 'rtl'`. Nothing else needs to
   learn about the direction.
2. **`getIntlLocale()`.** Add a BCP 47 mapping (`'ar' → 'ar-EG'` and so on).
   Dates, numbers and currency all resolve through it — see
   [locale-formatting.md](locale-formatting.md).
3. **Catalog file.** `src/assets/i18n/<code>.json`, full parity with `en.json`.
   See [i18n.md](i18n.md).
4. **Expect these pins to fire**, and fix each deliberately rather than by
   loosening it:
   - `translation.service.spec.ts` asserts `languages.length` is 3 and pins the
     exact code list. It also asserts `setDirection` was called with `'ltr'`;
     the RTL locale needs its own case asserting `'rtl'`, which is the first
     test in the tree that would actually exercise a flip.
   - `translation-keys.spec.ts` derives each locale's permitted plural members
     from `Intl.PluralRules`. Its `LOCALES` array and `INTL_LOCALES` map both
     need the new entry — and note that **"only English declines" stops being
     true**: Arabic has six cardinal categories, so an Arabic catalog would be
     the first non-English one allowed to carry plural members, and
     `i18n.md`'s rule needs rewriting rather than the spec relaxing.
   - `scripts/check-i18n.mjs`'s `LOCALES` constant.
5. **Then the real work**: the four rows above, and the 107 remaining hits.
   Force `dir="rtl"` on `<html>` in a running dev server first — it is the
   cheapest way to see which of them actually matter.

## What is tested

- `app-directionality.spec.ts` fakes both `DIR_DOCUMENT` (what the CDK
  constructor reads) and `DOCUMENT` (what the subclass writes), so a spec can
  move direction without flipping the direction of the page Karma is running
  in. It records every attribute write, which is how a no-op call is told apart
  from one that rewrites the same value.
- `translation.service.spec.ts` spies on `setDirection` and asserts the locale
  switch makes the call — the seam an RTL locale would ride.
- `npm run direction:check`, in CI, for everything else.
