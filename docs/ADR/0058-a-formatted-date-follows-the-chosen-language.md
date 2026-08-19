# 58. A formatted date follows the chosen language

**Status:** Accepted, implemented · **Date:** 2026-08-19 · **Issues:** #84

Extends the catalog rule in
[0036](0036-a-user-facing-string-lives-in-the-catalog.md) from words to the
values beside them. Reference documentation lives in
[../locale-formatting.md](../locale-formatting.md).

## Context

Choosing 日本語 translated every string in the app and nothing else. Dates and
numbers kept rendering in American conventions, because the app formatted them
three different ways and only one of them knew what language was selected.

**Angular's pipes.** `LOCALE_ID` was never provided, so it stayed at its
`en-US` default and every `| date` and `| number` binding — fourteen of them,
plus one in an inline template — rendered US month names, US field order and
US grouping regardless of language.

**Bare `toLocale*` calls.** `export.service.ts`, `import-history.component.ts`
and the forecast axis called `toLocaleDateString()` and `toLocaleString()`
with no locale argument. Those follow the **browser's** locale, which is not
the app's: a device set to English with the app set to Japanese got English
here and Japanese two lines up.

**Sites that were already right.** The reports, the forecast label, the export
dialog and the security activity list already passed
`translationService.getIntlLocale()`. So a single screen could carry two
conventions at once, and which one you got depended on which developer wrote
that line.

`DateFormatService.formatDate()` sat outside all three: it consulted only the
`dateFormat` preference — `MM/DD/YYYY`, `DD/MM/YYYY`, `YYYY-MM-DD` — and no
locale at all, with `MM/DD/YYYY` as the default every account was created
with.

Two claims in #84's body did not survive contact with the code, and are worth
recording because the issue is the evidence a future reader will start from:
`getIntlLocale()` already existed on `TranslationService`, and no
`dates`/`months` catalog namespace needed expanding — `Intl` supplies month
and day names for all three locales.

## Decision

**One service formats every user-facing date and number, against the chosen
language.** `LocaleFormatService` owns the `Intl` formatters, memoized per
locale and option set.

**Named date styles, not pattern strings.** The service takes `short`,
`medium` or `long` rather than `MMM d, yyyy`. A pattern hard-codes English
field order and an English separator, which is the defect being removed; a
name lets `Intl` order the fields the way the locale does. Numbers keep
Angular's `digitsInfo` vocabulary — `'1.0-2'` — because every call site
already speaks it and the meaning is exact; only the rendering moves.

**Custom impure pipes replace the built-ins.** `LOCALE_ID` is resolved once at
bootstrap, so a provider alone cannot satisfy "switching language updates
formatting without reload" — the built-in pipes would keep rendering the boot
locale for the rest of the session. `LocaleDatePipe` and `LocaleNumberPipe`
read the locale signal instead, and are impure with a per-instance memo, which
is the arrangement `TranslatePipe` already documents and for the same reasons.

**`LOCALE_ID` is provided anyway**, with `ja` and `zh-Hant` locale data
registered. Not redundancy for its own sake: Angular's own machinery reads it
— the Material datepicker through `provideNativeDateAdapter()` — and without
registered data anything reading it for those locales throws "Missing locale
data" rather than degrading. It makes first paint correct; the pipes make the
switch correct.

**The `dateFormat` preference gains `auto`, and existing choices are kept.**
`auto` follows the language and is the default for new accounts. An account
that stored one of the three patterns keeps it and must opt in.

This is the judgment call in this record. A stored `'MM/DD/YYYY'` cannot be
told apart from a deliberate choice, because it was also the value every
account got by default. Overriding it would silently undo a setting some users
made on purpose. The cost is that existing accounts see no improvement until
they visit Settings, which is the lesser harm: the setting is theirs, and the
option is now visible with a worked example rendered in their own language.

**Machine-facing formatting stays out.** `signFor` in `receipt-text-parser`
builds currency symbols to match against OCR text, and `formatReceiptItemLines`
builds text that is **persisted** onto a transaction note. Both are pinned to
`'en'` deliberately: localizing the first breaks matching, and localizing the
second would make a stored note depend on whichever language was active when
it was written.

### The alternatives that were rejected

**`LOCALE_ID` alone, accepting a reload on language change.** Much smaller,
and it fails the acceptance criterion outright. The language switcher already
re-renders every string live; having dates alone lag until a reload is a worse
inconsistency than the one being fixed.

**Teaching the pipes Angular's pattern strings.** It would have left the
templates untouched. Rejected because it preserves the assumption that a
pattern can be locale-neutral, which is what produced `MMM d, yyyy` in the
first place.

**Retiring the `dateFormat` preference entirely.** The cleanest end state, and
it silently discards a choice some users made. If the automatic default proves
right for everyone, removing the fixed patterns later is a small change; the
reverse is not.

**Routing `formatRelativeDate`'s trailing branch through the service.** It
already passes `getIntlLocale()` and is already correct. Adding a fourth date
style for a single call site is churn.

## Consequences

- 15 bindings across 13 components move to `localeDate` / `localeNumber`;
  `DatePipe` and `DecimalPipe` are dropped from the components that only had
  them for those bindings.
- New accounts get `dateFormat: 'auto'`. `DEFAULT_USER_PREFERENCES` changes,
  and no migration touches existing accounts.
- Settings shows Automatic first, with an example rendered in the active
  language rather than a fixed pattern string.
- `LocaleFormatService.locale` guards its `getIntlLocale` read the way
  `TranslatePipe` guards its signal reads. Without it, every spec stubbing
  `TranslationService` with `t()` alone fails the moment a shared template
  formats anything — fourteen did.
- `date-format.service.spec.ts` and `locale-format.service.spec.ts` join the
  zoned `test:dates` run.

## Things that only became apparent while building

- The HTML sweep missed a binding. One component keeps its template inline in
  the `.ts` file, so grepping `*.html` found fourteen of fifteen. The build
  caught it only because the unused `DatePipe` import was left behind.
- Asserting formatted output against hardcoded strings is a trap. The exact
  glyphs shift between ICU versions, so the specs assert agreement with `Intl`
  for the active locale, plus the fact that two locales genuinely differ.
- Guarding the locale read turned fourteen failing specs into none, and it is
  the same guard, for the same reason, that `TranslatePipe` already carries.
  That pattern is now load-bearing in two places and should be assumed
  necessary for anything a shared template reaches.

## Known gaps

- Existing accounts keep their stored pattern, so the defect is still visible
  to every current user until they change the setting. That is the deliberate
  trade above, not an oversight.
- Times are still formatted ad hoc. `import-history` passes the service's
  locale to `toLocaleTimeString` rather than going through a style, because
  the service has no time vocabulary yet. A second time-formatting site would
  be the moment to add one.
- Nothing prevents a new `| date` or `| number` binding from being added. The
  i18n checker enforces catalog keys and aria-labels; an equivalent ban on the
  built-in pipes would close this, and does not exist.
