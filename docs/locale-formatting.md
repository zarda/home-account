# Dates and numbers in the chosen language

Translating the strings is half of a language. The other half is the values
beside them — 19 Aug 2026 against 2026年8月19日, `1,234.6` against `1.234,6`.
This page is how the app formats those, and where it deliberately does not.

The reasoning and the rejected alternatives are in
[ADR 0058](ADR/0058-a-formatted-date-follows-the-chosen-language.md). Word
translation is [i18n.md](i18n.md); date *arithmetic* — boundaries, windows,
zones — is [dates.md](dates.md) and is a separate concern from rendering.

## One chokepoint

`LocaleFormatService` (`src/app/core/services/locale-format.service.ts`) is
the only place a user-facing date or number is formatted. It resolves the
active language to a BCP 47 tag through `TranslationService.getIntlLocale()`
(`en` → `en-US`, `ja` → `ja-JP`, `tc` → `zh-Hant-TW`) and owns the `Intl`
formatters.

Formatters are memoized per locale **and** option set. They are reached from
impure pipes that run on every change-detection cycle, and constructing an
`Intl.DateTimeFormat` is expensive relative to formatting with one.

### Dates take a named style, never a pattern

`short`, `medium`, `long` — a closed set, deliberately. `MMM d, yyyy` hard-
codes English field order and an English separator, which is the defect this
service exists to remove; a name lets `Intl` order the fields the locale's own
way. `formatDate` accepts a `Date`, a Firestore `Timestamp`, or a string or
number one of those round-tripped through, and renders an absent or
unparseable value as the empty string — a binding is not the place to surface
bad data as "Invalid Date".

### Numbers keep Angular's digitsInfo

`'1.0-2'` still means "at least one integer digit, zero to two fraction
digits". The vocabulary was kept because every call site already speaks it and
the meaning is exact; only the rendering moved. A malformed string is ignored
rather than thrown on.

Currency is **not** here — `CurrencyService.formatCurrency` owns it, because
an amount needs its currency code and that currency's decimal rules.

A chart's figures go through the same method from inside the Chart.js
callbacks: a tooltip uses `formatNumber(value, '1.2-2')` and an axis tick
`formatNumber(Number(value))`. The callbacks read the language when they run,
not when the options are built, so a chart redrawn after a language switch
follows it.

### Times take the locale's own clock

`formatTime` renders the hour and minute in the active language's convention
(`9:05 PM` in `en`, `21:05` in `ja`) and does not pad the hour, because
padding is a choice the locale makes for itself. Same input and empty-string
contract as `formatDate`. The two rows that show a day and a time put them
together differently. `import-history` joins `formatDate(date, 'short')` and
`formatTime(date)` itself, with a space. The security activity list passes
its relative day and the time through the translated `settings.activityAt`
pattern (*{date} at {time}* in `en`), so each language orders and joins them
its own way. Both used to call `toLocaleTimeString` with a two-digit hour,
from two different locale sources
([ADR 0171](ADR/0171-second-copies-fold-into-one-copy-of-each-helper.md)).

## In templates

Use `localeDate` and `localeNumber`. Angular's `date` and `number` are gone
from this codebase, and adding one back reintroduces the bug.

```html
{{ transaction.date | localeDate }}
{{ dup.transaction.date | localeDate:'short' }}
{{ category.percentage | localeNumber:'1.1-1' }}%
```

Both pipes are **impure with a per-instance memo**, exactly like
[`TranslatePipe`](../src/app/shared/pipes/translate.pipe.ts). The locale is
not a pipe input, so a pure pipe would render the boot locale and never
re-run on a language switch; the memo makes the impurity cost an equality
check per cycle instead of an `Intl` call. `LocaleDatePipe` keys its memo on
the *instant* rather than the object, because Timestamps are rebuilt on every
snapshot and Dates are mutable.

## Why LOCALE_ID is not enough, and still provided

`LOCALE_ID` is resolved **once at bootstrap**. It can never follow a language
switch made in the running app, which is why the pipes above exist.

It is provided regardless, from a factory reading the active locale, with `ja`
and `zh-Hant` locale data registered at module scope in `app.config.ts`.
Angular's own machinery reads it — the Material datepicker through
`provideNativeDateAdapter()` — and without registered data anything reading it
for those locales throws "Missing locale data" instead of degrading. The
provider makes first paint correct; the pipes make the switch correct.

## The dateFormat preference

`DateFormatService.formatDate()` reads the account's stored `dateFormat`:

| Value | Renders |
|---|---|
| `auto` | the active language's own short form (the default for new accounts) |
| `MM/DD/YYYY` | `01/15/2024` |
| `DD/MM/YYYY` | `15/01/2024` |
| `YYYY-MM-DD` | `2024-01-15` |

**An account that stored one of the three patterns keeps it.** A stored
`MM/DD/YYYY` cannot be told apart from a deliberate choice, because it was
also the value every account was created with before `auto` existed, so
overriding it would silently undo a real setting. Existing users opt in from
Settings, where Automatic is listed first with a worked example rendered in
their own language.

## What deliberately stays in English

Two formatters are machine-facing and must not follow the UI language:

- **`signFor`** (`receipt-text-parser.ts`) builds currency symbols to match
  against OCR text. Localizing it breaks matching.
- **`formatReceiptItemLines`** (`receipt-consolidation.ts`) builds text that
  is **persisted** onto a transaction note. Its format must not depend on
  whichever language happened to be active when the receipt was imported.
  Its `toLocaleString('en', …)` is pinned on purpose, and the line carries a
  comment pointing here. It is the one `toLocaleString(` left outside this
  service.

The distinction to apply: formatting that is *rendered* follows the reader;
formatting that is *stored or matched against* does not.

## When you add another one

Reach for `LocaleFormatService`, or the two pipes in a template. If you find
yourself writing `toLocaleDateString()`, `toLocaleTimeString()`,
`toLocaleString()` or a `new Intl.…` in feature code, the question is which
of the two kinds above it is. Rendered values belong here. Stored or matched
values belong pinned, with a comment saying so — the three sites that called
`toLocale*` with no argument at all were following the *browser's* locale,
which is neither.
