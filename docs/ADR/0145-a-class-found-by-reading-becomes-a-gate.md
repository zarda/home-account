# 145. A class found by reading becomes a gate

**Status:** Accepted, implemented · **Date:** 2026-09-21 · **Issues:** #435

Reference documentation lives in [../accessibility.md](../accessibility.md).

## Context

[0032](0032-a-sweep-is-only-as-wide-as-its-greps.md) is the record that a
sweep is only as wide as its greps, and the repo's answer has been consistent
ever since: a defect class found by reading one file becomes a `*:check`
script in CI, in a fixed shape — a block comment that states the defect and
what it deliberately cannot see, no dependencies, a hand-rolled walk, and a
`--self-test` whose must-not-hit half is the load-bearing half.

Eleven such scripts existed. Nine classes named in the ADRs and the reference
docs were still reviewer greps, sitting in a documentation file under a
heading that said, in so many words, that nothing ran them:

> **Nothing runs the audit greps.** They are reviewer instructions. There is
> no `dates:check` script beside `check-i18n.mjs` and friends […] Two sweeps'
> worth of stragglers (#248, #266, #267) is what that costs.

Two of the nine were accessibility classes that no script could express at
all, because they are properties of a rendered page rather than of source
text: whether the app has any accessibility violations, and whether a colour
pair clears WCAG AA. `docs/accessibility.md` said so under *Known gaps* —
"No automated accessibility check in CI", "Nothing measures a contrast ratio"
— and had said so for two months.

## Decision

**Every one of the nine becomes a gate, in the shape the class actually
has.** Five new scripts (`check-dates.mjs`, `check-motion.mjs`,
`check-contrast.mjs`, and — from the wave's other half —
`check-icon-labels.mjs`), two extensions to existing scripts
(`check-grid-tracks.mjs`, `check-i18n.mjs`), two ESLint rules, one spec, and
one pass riding the smoke suite.

**Where the class is syntactic, it is a lint rule, not a script.** Three are:

- `no-console: ["error", { allow: ["warn", "error"] }]` — which is
  [0123](0123-the-unit-sweep-is-silent-on-a-normal-path.md)'s decision
  expressed as a gate. 0123 removed eleven narrating lines and kept every
  `console.warn` that precedes a real fallback; the rule's allow-list is that
  distinction, so the 109 warnings it kept stay legal and the sixteen
  remaining `console.log`s had to go.
- `no-restricted-syntax` with `BindingPipe[name="date"]` and `[name="number"]`
  in the `**/*.html` block, closing
  [0058](0058-a-formatted-date-follows-the-chosen-language.md)'s stated gap.
- `no-restricted-syntax` on `ImportExpression`, closing the hole
  `check-lint-guards.mjs` names in its own *cannot see* list.

**Where the class is about a list rather than a pattern, it is a spec.**
`nav-items.spec.ts` now checks both palette lists against `app.routes.ts` in
both directions. A script would have had to parse a TypeScript routing
configuration; the spec imports it.

**The accessibility pass rides the smoke walkthrough rather than being its own
job.** `app.smoke.spec.ts` already navigates seven routes through the real
router against the emulators, and already carries an accessibility assertion
inside its `expectPage()` funnel for exactly this reason. `axe-core` is called
from the same funnel, so every route the walkthrough visits is swept, at no
new TestBed cost and with no new CI step.

Three constraints bound what that pass can honestly assert, and each is
written into `core/services/testing/axe.ts` beside the option it explains:

- **i18n is not served under Karma**, so `| translate` renders raw keys. Rules
  that check a name is *present* behave; rules that judge its *content* would
  be reading catalog keys.
- **The fixture owns a route, not a page.** Karma's own `debug.html` supplies
  the document, its heading and its landmarks, so eight page-level rules are
  disabled by name and the scan is scoped to `harness.routeNativeElement`.
  Otherwise the run audits Karma.
- **`wcag22aa` is dropped.** `target-size` in an 800×600 headless window on a
  mobile-first layout reports the viewport, not the markup.

`color-contrast` stays **on**: `src/styles.scss` is in the test target and
component styles compile, so it is genuinely measurable there.

**A contrast gate scores a committed pairing table, not every token against
every surface.** The naming carries three different roles — the base token is
a *fill*, `-light` a *tinted background*, `-text` the AA-corrected
*foreground* — so a mechanical "every token as a foreground on the card"
scoring fails 14 of 20 in light mode and is almost all false positives. The
table is the audit, and the self-test asserts that every `--color-*` declared
in `:root` appears in it or in a named not-painted list, so a new token cannot
arrive unaudited.

**What a gate finds and cannot fix is frozen with a floor, not left
unmentioned.** Both new accessibility gates found real defects on surfaces
this work had no business rewriting. Each is recorded by name, with its sites
and its reason, in a list the gate reads: a violation not on the list fails,
and a frozen row that starts passing is reported and asked to be promoted. A
ratchet that only ratchets one way is the same idea `check-direction.mjs`
already uses for physical CSS.

## What was rejected

**Banning `| currency` with `| date` and `| number`.** The other two are at
zero live sites, so their ban is free. `| currency` has 27, and unlike dates
and numbers it has no replacement: `locale-number.pipe.ts` refuses currency on
purpose, because an amount needs its code and its minor-unit rules and the
pipe has no business guessing them. `CurrencyService.formatCurrency` owns
that, which is why this is not 0058's defect. `monthly-comparison.component.html`
is the densest site and the concrete reason.

**A `forced-colors` rule that every component must satisfy.** `styles.scss`
already carries a global `prefers-reduced-motion` kill-switch over `*` and
`AccessibilityService` drives a second, and only two components declare
`forced-colors` at all. A gate demanding more would have asserted nothing.
The narrow true rule is what shipped: the two kill-switches exist, and no
component re-declares a duration that outruns them.

**A `LoggerService` for the sixteen `console.log` sites.** None of them
reported a failure; each narrated a path the code had just taken. Removing
them is what 0123 decided, and routing narration through an abstraction would
have preserved it.

**Fixing what the accessibility gates found.** Eight classes, each a
production change to a surface with its own specs and its own ADR — the
transaction row's activation model, the brand palette, the login error banner.
Freezing them names them; fixing them here would have made this an
accessibility wave wearing a gate's commit message.

**A second CI job for axe.** It would need its own emulator boot to have
anything to look at.

## Consequences

- Fifteen `*:check` scripts, all in one shape, all self-testing ahead of their
  live scan.
- `README.md`'s scripts table lists every step `ci.yml` runs, in order, and
  two rows now name the command CI *actually* runs rather than the npm script
  that would do more (`prod-env:check` and the index wait run their
  `--self-test` halves only in that job, and the table says why).
- **Five real contrast failures were fixed**, four of them found by the gate
  rather than by the issue: `--text-muted` on two surfaces in light (4.39 and
  4.43), and the income, expense and warning chips in dark (4.09, 3.00, 4.10).
  The text tokens were lightened rather than the fills darkened — the dark
  fills already sit close to the `#1e1e1e` card, and darkening them makes the
  chip disappear. Expense needed both halves to move.
- **Eight further failures are named and frozen**, four from axe and four from
  the contrast table, each with its sites.
- `docs/dates.md` and `docs/accessibility.md` lose three *Known gaps* that had
  stood for months, and gain smaller, truer ones in their place.

## Departures from the issue

**#435's `| date` acceptance line stands as written, and the mechanism was
verified before it was designed for.** The plan carried a fallback in case
`no-restricted-syntax` could not reach the angular-eslint template AST. It
can: the template parser returns `visitorKeys` and tags its nodes with `type`,
so ESLint's core selector engine traverses it like an ESTree tree — including
inside an inline `.ts` template, through `processInlineTemplates`. The
fallback was not needed.

**P8 targets an import that does not exist.** There is no
`import('firebase/analytics')` anywhere in `src/`. The only dynamic analytics
import is `import('@capacitor-firebase/analytics')` in
`NativeAnalyticsTransport`, which is a legitimate call site in the
analytics-owning population. The ban covers the specifier family and exempts
that file, and because flat config replaces a rule's options wholesale, the
exemption block restates both `firstValueFrom` selectors in full — otherwise
adding this ban would have silently killed the one from
[0139](0139-a-transaction-read-acted-on-once-names-its-source-and-a-listeners-first-value-is-banned.md).

**P9 was half shipped already.** `check-grid-tracks.mjs` and `grid:check`
existed and covered the nested `minmax()`. What remained was the bare-`1fr`
half, still a shell grep in the docs, and it is now a second pattern in the
same script.

**P3's contrast line is restated.** "Every `--color-*` pair meets WCAG AA in
all three modes" cannot be met as written: the two high-contrast blocks
declare zero `--color-*` tokens, so a third of the claim is vacuous, and the
pairs are not derivable from the names. What ships is a committed table scored
across four rendered modes, every row meeting its threshold or carrying a
recorded floor.

**P4 is narrowed**, for the reason in What was rejected.

**Two `PROPER_NOUNS` the plan missed** — *OpenAI (ChatGPT)* and *PNG, JPG* —
and one stale reference: `camera-capture.component.ts:352` already falls back
to a catalog key and needed nothing.

## Things that only became apparent while building

**The contrast parser's first version scored the dark palette with the light
one.** `styles.scss` declares `.dark-theme { color-scheme: dark; }` about two
hundred lines before the real dark token block, so taking the first matching
selector reads an empty palette, falls through to `:root`, and reports every
dark pair as passing. That is the single case the self-test exists for, and
it is the load-bearing one: a contrast gate that silently scores the wrong
palette is worse than no gate, because it reads as an audit.

**Lightening a text token was not always enough.** `--color-expense-text` at
its next step still measured 4.38 against its tint; the tint had to move too.
A pair is a pair.

**The axe fixture needed a lint rule disabled to exist.** The known-violation
component is an `<img>` with no `alt`, which
`@angular-eslint/template/alt-text` refuses — the rule whose class axe is
there to catch. The disable comment is the fixture's whole point.

**Freezing by node count would have raced the emulator.** Two of the frozen
axe sites are loading spinners that are on screen only while a page is still
fetching. The freeze is by rule id per route, so a spinner that has already
resolved does not turn a passing run red.

**A `git diff` before committing does not protect a shared path.**
`git commit --only <path>` commits the working tree's version of that path,
whoever wrote it. One commit here carries another lane's catalog edits for
that reason.

## Known gaps

- **Eight accessibility defects are named and not fixed.** Four axe classes —
  `aria-progressbar-name` on five routes (the cheapest of them: a translated
  label on each spinner and progress bar), `color-contrast` on
  `.stat-label-suffix` and `.row-date` in **light** mode, and
  `nested-interactive` on the transaction row — and four contrast pairs, listed
  in `docs/accessibility.md`.
- **The contrast gate structurally cannot see a rendered element's colour.**
  It scores declared token pairs; the two `color-contrast` findings above are
  elements inheriting a colour or wearing a utility class, which is exactly
  the class axe catches and this script cannot.
- **The axe pass covers seven routes.** `/ai`, `/search-history`,
  `/import/file` and `/import/history` are not in the walkthrough, so nothing
  sweeps them.
- **It is a phone-and-tablet audit.** Karma's window is 756 px, so no rule
  sees a desktop layout.
- **The visible-English rule needs a proper-noun allowlist**, which is a list
  somebody maintains. A brand name added to a template without a row fails the
  gate, which is the safe direction but is still friction.
- **The date gate reads production code only.** Specs match its first two
  shapes freely and on purpose, so a date defect written into a spec's
  expectation is invisible to it.
