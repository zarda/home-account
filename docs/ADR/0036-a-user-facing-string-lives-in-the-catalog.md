# 36. A user-facing string lives in the catalog, and only English declines

**Status:** Accepted, implemented · **Date:** 2026-08-12 · **Issues:** #260, #272, #273

Reference documentation lives in [../i18n.md](../i18n.md).

## Context

Three ways a string reached the user without passing through the translation
catalog, all shipped through one blindness: the checker read lines, not
arguments.

`check-i18n.mjs` matched `t('key'` with a per-line regex, so a call whose
`t(` ended one line and whose key started the next was invisible — not even
counted as skipped. Every one of the three split calls in the repo has a
ternary as its first argument, which means the miss was structural: no regex
over lines, or even over the whole file, reads `t(\n cond ? 'a' : 'b')`. One
of the three referenced keys no locale defines (`transactions.expense`), and
`t()` returns the key on a miss, so the smart-search confirmation chip
rendered a developer key in every locale (#260) — and the component's own
spec asserted that output, because its echo stub made a wrong key
indistinguishable from a right one. ADR 0032's lesson, replayed in the i18n
checker: a sweep is only as wide as its greps.

The catalog itself could not express number agreement. Every counted English
string was written in the unconditional plural — "1 matching transactions",
and the screen-reader announcement "1 transactions shown" — because a leaf
could only be a string (#272). Japanese and Traditional Chinese need no
agreement, which is why the files looked fine on review: the only broken
locale was the one nobody thinks of as a translation.

And nine `aria-label` attributes in the shell were hardcoded English, next to
tooltips that were already translated — the sighted user saw the right text
and the screen-reader user did not. The category form dialog was hardcoded
English throughout, while the keys it needed sat unused in all three locales
(#273). No gate had an opinion on English that never became a key.

## Decision

**The checker parses arguments, not lines.** `t(` calls are read with a
balanced-argument walk over the whole file: track paren depth and quote state
to the first top-level comma or the balanced close, and take every quoted
literal in that first argument as a candidate key. A literal counts only when
it is dot-namespaced — the ternary's comparison literal (`'expense'`) is not
a key, and every real key is. A first argument with no key-shaped literal is
dynamic: counted in the summary, never failed. The parser is nontrivial, so
`--self-test` pins twenty known shapes and `i18n:check` runs it first, the
way `prompts:check` already does. Rejected: comment-stripping before the scan
— naive stripping corrupts `'https://…'` literals and produces false
negatives, where the current behavior (a commented-out call still counts as a
reference) only ever errs toward requiring keys that exist.

**Plural members live only in English.** A catalog leaf may be an object
whose keys are CLDR cardinal categories with string values — `{ "one": …,
"other": … }` — and `t()` selects a member with `Intl.PluralRules` for the
active locale, falling back to `other`, interpolating as ever. A plural entry
reached without a numeric `count` returns the key, the same loud miss as any
other non-string leaf. ja and tc have no number agreement, so their entries
stay plain strings: parity across locales is asserted on the bare leaf path,
and a per-locale shape check derives each locale's permitted member set from
`Intl.PluralRules(...).resolvedOptions().pluralCategories` — CLDR itself says
en declines and ja/tc do not. Rejected: mirroring `{other}` objects into
ja/tc (pure churn for zero rendering difference, and a standing burden on
every future counted string); an ICU/i18n library (the need is one selector
method, not a dependency). Twenty-three keys were converted — each checked
for a reachable count of 1 and a noun that agrees — with `{{count}}` kept in
the `one` member so "1 transaction shown" falls out of interpolation.

**An aria-label is bound or it is rejected.** The checker's third scan fails
any literal `aria-label="…"` under `src/app` templates; the bound forms pass
(`[attr.aria-label]="'…' | translate"` — the convention, `[aria-label]`
property bindings, and interpolations). The nine offenders were converted,
three of them to `common.*` keys that identical controls elsewhere already
bound. The UI-audit harness selected the user-menu button by its English
label text; it now selects by a `user-menu-button` class, the same shape as
the hamburger's existing `menu-button`. Rejected: `data-testid` — the repo
has none, and the class precedent already exists.

## Consequences

- The literal-key count rose from 741 to 753: the balanced parser now sees
  the split `import.verify*` calls, and the dynamic count rose from 38 to 99
  because dynamic `t()` calls in TypeScript are now counted at all — the old
  scan only ever counted dynamic pipes.
- English count-strings decline: "1 matching transaction", and the
  transactions announcer says "1 transaction shown" to a screen reader.
  ja and tc render byte-identically to before.
- The CLDR member names — zero, one, two, few, many, other — are reserved
  words in the catalog: a namespace whose keys are all category names with
  string values would be read as a plural leaf. None exists, and the parity
  spec's shape check would name it the moment it appeared.
- The category dialog is translated end to end, including the two
  `role="radiogroup"` names and the preview fallback.

## Departures from the issues

- #272 asked the parity spec to fail "when a plural member is present in
  en.json but absent from tc.json or ja.json". By design ja and tc carry no
  members at all; the enforced contract is bare-path parity plus the
  per-locale CLDR shape check, which is stricter where it matters (en cannot
  drop `one`; ja/tc cannot grow members that would never be selected).

## Known gaps

- Three defined keys have no call site (`reports.transactionsLabel`,
  `import.processingMultipleImages`, `import.multiImageSuccess`) and stayed
  plain strings; nine more count keys are unreachable at 1 (guarded `> 1`, a
  compile-time constant, or a ≥2 detector floor) and also stayed plain. If a
  guard changes, the key converts then.
- The submit button's ternary pipe — `(isEdit ? 'a.b' : 'c.d') | translate`
  — is counted as one dynamic pipe usage; the pipe scan stays line-based and
  literal-adjacent. Both keys exist and the dialog spec pins the rendering.
- A commented-out `t('some.key')` still counts as a reference, so deleting a
  key can demand deleting a comment. Deliberate: the alternative was false
  negatives.
