# Dates and numbers in the chosen language

Translating the strings is half of a language. The other half is the values
beside them — 19 Aug 2026 against 2026年8月19日, `1,234.6` against `1.234,6`.
This page is how the app formats those, and where it deliberately does not.

The reasoning and the rejected alternatives are in
[ADR 0058](ADR/0058-a-formatted-date-follows-the-chosen-language.md), and
for the date pickers and amounts in
[ADR 0182](ADR/0182-a-control-reads-in-the-accounts-language-and-date-format-and-nothing-re-provides-materials-adapter-or-words.md).
Word translation is [i18n.md](i18n.md); date *arithmetic* — boundaries,
windows, zones — is [dates.md](dates.md) and is a separate concern from
rendering.

## One chokepoint

`LocaleFormatService` (`src/app/core/services/locale-format.service.ts`) is
the only place a user-facing date, number or file size is formatted. It
resolves the active language to a BCP 47 tag through
`TranslationService.getIntlLocale()` (`en` → `en-US`, `ja` → `ja-JP`,
`tc` → `zh-Hant-TW`) and owns the `Intl` formatters.

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
an amount needs its currency code and that currency's decimal rules. It
formats in the active language too, and a template reaches it through
`localeCurrency` ([below](#in-templates)).

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

### File sizes take Intl's units, and the catalog's word for a byte

`formatFileSize` writes whole bytes below 1024, then kB, MB and GB to one
decimal place, each step 1024 of the one before. It steps on the figure as it
will be written, so 1,048,525 bytes reads `1 MB` rather than `1,024 kB`. From
a kilobyte up the unit is `Intl`'s own short form: `10 MB` in all three
languages, `kB` in `en` and `tc`, `KB` in `ja`. Below that the figure goes
through the catalog's `common.fileSizeBytes` (*{size} B*, *{size} バイト*,
*{size} 位元組*), because CLDR writes the byte in English for `zh-Hant` at
every width, and its short `en` form does not agree in number (*281 byte*).
An absent or non-finite size is the empty string, as with `formatNumber`.

The upload area's rows, the limit its refusal names and Import History's
size chip all read it. The upload area used to write *281 Bytes* and *KB* in
every language, and Import History kept a copy of its own that wrote *KB*
and *B*; both fold onto this one
([ADR 0171](ADR/0171-second-copies-fold-into-one-copy-of-each-helper.md),
[ADR 0186](ADR/0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)).

The space between figure and unit is whatever the runtime's ICU writes.
Today's Node and Chrome write a plain space, so the specs' `10 MB` and
journey 88's read U+0020; an ICU that wrote U+00A0 there would fail them
loudly rather than pass a different string.

## In templates

Use `localeDate`, `localeNumber` and `localeCurrency`. Angular's `date`,
`number` and `currency` are gone from this codebase, and adding one back
reintroduces the bug: each formats against the `LOCALE_ID` of the bootstrap,
not the language the account chose. The `.html` block of `eslint.config.js`
bans all three (`BindingPipe[name="date"]`, `"number"` and `"currency"`), on
a `.html` file and on an inline `template:` alike, and `lint-guards:check`
holds the ban to the files it governs.

```html
{{ transaction.date | localeDate }}
{{ dup.transaction.date | localeDate:'short' }}
{{ category.percentage | localeNumber:'1.1-1' }}%
{{ category.total | localeCurrency:baseCurrency() }}
```

`localeCurrency` takes the currency code as its argument, because an amount
has no default currency, and returns `CurrencyService.formatCurrency`'s
string, after `snapDisplayZero` turns a figure that rounds to zero at the
currency's decimals into an unsigned zero (a sign on a zero is a wrong
figure): the symbol and separators of the reader's language and the
currency's own decimals, so a yen amount has no `.00` and tc writes the
dollar as `US$`. A `null` or `undefined` amount renders as the empty string.
It replaced the 27 `| currency` sites in the reports, the data hub and the
duplicate warning
([ADR 0182](ADR/0182-a-control-reads-in-the-accounts-language-and-date-format-and-nothing-re-provides-materials-adapter-or-words.md)).
A component that formats an amount pulls `CurrencyService` into its spec,
whose real constructor fetches the live rates, so a spec that renders one
provides a double carrying `formatCurrency`.

All three pipes are **impure with a per-instance memo**, exactly like
[`TranslatePipe`](../src/app/shared/pipes/translate.pipe.ts). The locale is
not a pipe input, so a pure pipe would render the boot locale and never
re-run on a language switch; the memo makes the impurity cost an equality
check per cycle instead of an `Intl` call. `LocaleDatePipe` keys its memo on
the *instant* rather than the object, because Timestamps are rebuilt on every
snapshot and Dates are mutable. `LocaleCurrencyPipe` keys its memo on the
amount, the code and the language.

## Why LOCALE_ID is not enough, and still provided

`LOCALE_ID` is resolved **once at bootstrap**, from the browser's language,
before the account's own language has arrived. It can never follow a language
switch made in the running app, which is why the pipes above and the date
adapter below exist.

It is provided regardless, from a factory reading the active locale, with `ja`
and `zh-Hant` locale data registered at module scope in `app.config.ts`.
Two things still read it: Angular's registered locale data, and the app's
date adapter, whose starting locale it is (through `MAT_DATE_LOCALE`'s
default) for the moment between the adapter's construction and its first
look at the reader, which happens in the same constructor. Without
registered data anything reading it for those locales throws "Missing locale
data" instead of degrading. No picker, pipe or template reads it after that:
the built-in pipes that did are banned, and the native date adapter, which
took its locale from it for the life of the app, is no longer provided
([ADR 0182](ADR/0182-a-control-reads-in-the-accounts-language-and-date-format-and-nothing-re-provides-materials-adapter-or-words.md)).

## The dateFormat preference

`DateFormatService.formatDate()` reads the account's stored `dateFormat`,
through `DateFormatService.preference()`, a `computed` that is the one place
the `auto` default is written:

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

The three fixed patterns live in one table, `FIXED_FORMATS`, each with the
order its fields are written in and the writer that prints it, so what
`formatDate` prints is what `parseDate` reads back and the Settings examples
are the same writers. A stored value is looked up with `Object.hasOwn`,
since it is a string from the account document. The date pickers read the
same preference (below), so an input shows a date the way the row it edits
does.

## What a datepicker shows and reads

Every date picker in the app reads one adapter, `AppDateAdapter`
(`core/services/app-date-adapter.ts`), provided once at the root by
`provideAppDatepicker()` (`core/config/datepicker.config.ts`) with the
formats that route an input's text through it and the calendar's labels.
No component brings its own: the pickers import Material's standalone
`MatDatepicker`, `MatDatepickerInput` and `MatDatepickerToggle`, and a lint
rule bans `MatDatepickerModule`, `MatNativeDateModule` and
`NativeDateModule`, any of which would re-provide an adapter or English
labels in the injector of the page that imports it.

**What it shows.** An input's text is `DateFormatService.formatDate`: the
language's own short form under `auto` (`10/1/2026` in en, `2026/10/1` in ja
and tc), or the stored pattern, zero-padded, in every language
(`10/01/2026` under `MM/DD/YYYY` on a Japanese account). The calendar's
month and weekday names, its period and its cells' accessible names are
Material's own Intl formats in the reader's language, so a ja or tc day cell
reads `19日`. The toggle's name and the calendar's buttons and labels
(*Open calendar*, *Previous month*, *Choose month and year*, *Previous 24
years* and the rest) come from the `datepicker.*` keys through
`AppDatepickerIntl`.

**What it reads.** Typed text goes through `DateFormatService.parseDate`,
which hands `parseTypedDate` ([dates.md](dates.md#keys)) the order the
reader writes a date in:

| Stored format | Order a typed date is read in |
|---|---|
| `auto` | the language's own short form: `mdy` in en, `ymd` in ja and tc, read off `Intl` by `LocaleFormatService.fieldOrder()` |
| `MM/DD/YYYY` | `mdy` |
| `DD/MM/YYYY` | `dmy` |
| `YYYY-MM-DD` | `ymd` |

Full-width digits and separators read as ASCII, and `年`, `月`, a Japanese
keyboard's own `・`, `ー` and `。` (what it types for `/`, for `-` and for `.`
in kana mode, which NFKC does not map) and a trailing `日` read as separators,
so `２０２６年８月１９日`, `２０２６・８・１９` and `２０２６。８。１９`
are dates. A `YYYY-MM-DD` date is that local day in every order, a leading
four-digit year is always the year, followed by the month and the day, and a
two-digit year is `20YY`. Text that names no day, `8/19` with no year,
`Aug 19 2026`, `2026-02-31`, is an Invalid Date, which raises Material's
`matDatepickerParse` error, and every form a date can be typed into, bar
the transaction filters, says so in one sentence, `datepicker.dateInvalid`
(*Enter a valid date.*), ahead of any *required* message. (The period
selector's and the import review's pickers have hidden inputs and take a
date only from the calendar.) An emptied field is no date and no error. A
value handed to an input as a date-only string is read as its local day.

**When the reader changes.** The adapter takes the reader's language and
format when the first picker builds it and follows both from then on: a
switch of either re-renders every input and the labels with no reload.
Material re-renders inputs on the adapter's `localeChanges`, which it sends
on a change of format alone too, and an open calendar on the labels'
`changes`, which they send only after relabelling. What still lags:

- an open calendar's visually hidden *Close calendar* button and its
  comparison label keep the language it opened in until it is reopened,
  because Material reads them once;
- a field that holds unreadable text through a switch is cleared and keeps
  its parse error until the next keystroke (a blur only reformats it), and
  the recurring dialog's **Save** stays disabled until then;
- the transaction filters' compact From and To have no room for a sentence,
  so unreadable text there shows the error outline only.

A spec provides the app's adapter through `provideAppDatepickerForTests`,
never by hand ([testing.md](testing.md#shared-stubs)).

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
