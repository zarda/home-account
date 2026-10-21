# 182. A control reads in the account's language and date format, and nothing re-provides Material's adapter or words

**Status:** Accepted, implemented · **Date:** 2026-10-22 · **Issues:** #500

Reference documentation lives in
[../locale-formatting.md](../locale-formatting.md), [../dates.md](../dates.md),
[../i18n.md](../i18n.md), [../testing.md](../testing.md),
[../household.md](../household.md), [../recurring.md](../recurring.md),
[../ui-overflow.md](../ui-overflow.md),
[../accessibility.md](../accessibility.md),
[../shortcuts.md](../shortcuts.md) and
[../performance.md](../performance.md).

This record takes the five parts of #500, which the branch for #495 and
#497 found and left alone: a datepicker that formats, reads and labels
itself in the browser's language at boot rather than the account's; a
missing name that read *User* in every language; a method on the recurring
list that nothing read; three specs that listened for an uncaught rejection
where zone.js never sends one; and the bottom bar's dashboard label, which
wrapped in Japanese. Reading the datepicker found three more readers of the
same class, the stepper's hidden words, the sort header's description and
the built-in currency pipe, and they are fixed here too, each held by a
gate or a pin. The second browser run found two words translated once and
kept, which a language switch never reached; they are fixed here as well,
each held by a spec that switches the catalog.

Amends
[0058](0058-a-formatted-date-follows-the-chosen-language.md). Its
chokepoint, its named styles, its impure pipes and its `dateFormat`
preference stand. What changes is who reads the preference and what
`LOCALE_ID` still feeds. 0058 provided `LOCALE_ID` so that the datepicker,
through `provideNativeDateAdapter()`, painted its first frame in the right
language. The pickers now read an adapter of the app's own, which takes the
reader's language and stored format itself and follows both, so `LOCALE_ID`
feeds only Angular's registered locale data and that adapter's starting
locale for the moment before it follows. And the preference, which 0058
applied to printed dates, now also decides what a picker shows and reads.

Amends
[0128](0128-a-material-module-a-template-never-uses-fails-the-build.md).
Its provider-only skip held one module, `MatNativeDateModule`, which no
component imports now and a lint rule bans, so the skip went with it
([0048](0048-a-dead-capability-is-removed-not-guarded.md)).

Amends [0145](0145-a-class-found-by-reading-becomes-a-gate.md), which
rejected a ban on `| currency` beside `| date` and `| number` because the
pipe had nothing to replace it with. `LocaleCurrencyPipe`, over
`CurrencyService.formatCurrency`, is that replacement, and the ban now
stands with the other two.

It closes two gaps of 0180 and two gaps of 0140.

- **0180's *A datepicker reads in the browser's language, not the
  account's*.** Every picker now shows and reads the account's date format
  in its language, names its months and weekdays in it, and takes its
  toggle's name and its calendar's labels from the catalog. A change of
  either re-renders with no reload.
- **0180's *The `'User'` name fallbacks stay English*.** A sign-in that
  names nobody stores an empty name, every display reads a catalog word,
  and `i18n:check`'s fifth scan knows `User`.
- **0140's *Tailwind's `truncate` utility passes the truncation gate*.**
  The first browser run met it still cutting names on the dashboard's
  Budget Progress card. The card's names and amounts now wrap, and
  `truncation:check` reads Tailwind's `truncate`, `text-ellipsis` and
  `overflow-ellipsis` as an `@apply` token, a template class and a host
  `class`.
- **0140's *`check-truncation.mjs` has no self-test*.** It has one, 49
  cases, chained ahead of the scan.

Applies [0055](0055-the-active-route-is-announced-not-only-coloured.md):
the bottom bar's dashboard link is named by the short word it shows. Extends
[0138](0138-a-plugin-call-nothing-implements-is-the-developers-failure-not-the-users.md),
which found that a `window` listener never hears a ZoneAwarePromise
rejection, to the specs: a lint rule keeps a spec from listening there.

## Context

**The datepicker took the browser's language once.** `app.config.ts`
provided `LOCALE_ID` from `appLocaleIdFactory`, read once after
`TranslationService.init()` had loaded the browser's catalog; the account's
language arrives later, through `AuthService`'s preferences effect.
`MAT_DATE_LOCALE` defaults to `inject(LOCALE_ID)`, nothing called
`DateAdapter.setLocale`, and no `MatDatepickerIntl` was provided. On a
Japanese account in an `en-US` browser the adapter read `en-US` against a
page `lang` of `ja`: every picker showed `10/1/2026`, named its months and
weekdays in English, and called its toggle *Open calendar*.

**A root provider could not have fixed it.** Seven of the ten picker
components imported `MatNativeDateModule`, and all ten imported
`MatDatepickerModule`. A routed page or a dialog builds its standalone
injector from its import graph, so those modules' own `DateAdapter`,
`MAT_DATE_FORMATS` and `MatDatepickerIntl` shadowed anything the root
provided: `/transactions` reached `TransactionFiltersComponent`'s own
adapter through `TransactionsComponent`. The three household dialogs, which
imported only `MatDatepickerModule`, got the root adapter and their own
English labels.

**The native adapter reads typed text with `Date.parse`.** A typed
`2026-08-19` is UTC midnight, the 18th west of Greenwich; `19/08/2026` is
Invalid; `08/09/2026` is 9 August whoever types it; `Aug 19 2026` is a
date; `8/19` is 2001; and `2` is 1 February 2001. Following a date format
needs a strict reader that knows the format's field order.

**Three more readers of the class.** The built-in `| currency` pipe formats
against `LOCALE_ID` at 27 sites, in the reports, the data hub and the
duplicate warning. The import wizard's stepper tells a screen reader
*Completed*, *Editable* and *Optional* (`MatStepperIntl`'s English
literals). And the transaction list's three sortable headers describe their
action as *Sort*.

**An unreadable date said nothing, or the wrong thing.** Four typable
picker fields (the budget form, the goal form, the recurring start and end)
showed nothing for text that names no day, and three (the transaction
form, the household contribution date, the household budget start)
answered it with their *required* sentence. A strict reader reaches that
state more often than `Date.parse` did, and the recurring dialog crashed on
a cleared start date (`recurring-form-dialog.component.ts:188`).

**Names.** There were three sites, not the issue's two. The dashboard's
greeting (`dashboard.component.ts:186`) and the settings card
(`settings.component.ts:43`) displayed `'User'`, and `auth.service.ts:60`
**stored** it on a new profile whose sign-in named nobody, from where it
reached the header and every household the account joined. The header
printed the stored name with no fallback at all, so an empty one was a
blank line. And the greeting joined `common.welcome` to the name with an
ASCII `, ` in every language: `おかえりなさい, Ada`.

**A method nothing read.** `RecurringListComponent.categoryName`
(`recurring-list.component.ts:93-97`) never had a reader, and never had a
spec.

**Three specs listened where zone.js sends nothing.** Under zone.js no
`window` listener hears a ZoneAwarePromise rejection: zone.js re-dispatches
it as a `PromiseRejectionEvent` built without its `promise`, the
constructor throws, and an empty catch swallows the throw. Three specs
listened there. `widget-snapshot.service.spec.ts` and
`dashboard-layout.service.spec.ts` still bit through their `console.error`
spies. `household.component.spec.ts`'s tidy runs from a component effect,
inside NgZone, where the rejection goes to `NgZone.onError`, so neither its
window listener nor its console spy could see a dropped `catch`.

**The bottom bar's longest Japanese label.** On a 375 px phone
ダッシュボード wrapped onto two lines at `appFitText`'s 12 px floor.

## Decision

### Pickers import Material's standalone pieces, and a lint rule bans the modules

The ten components import `MatDatepicker`, `MatDatepickerInput` and, the
eight that show a toggle, `MatDatepickerToggle`, which provide nothing. The
seven drop `MatNativeDateModule`. Nothing then re-provides the adapter, the
formats or the labels, so the root's providers reach every routed page and
dialog.
Every spec that renders one of the seven provides an adapter itself:
`provideNativeDateAdapter()`, or the test helper below when it asserts date
text. The parents that render a picker through their templates were found
by grepping every template for each selector, and `test:ci` with
`npm run build` was the complete list: JIT ignores an unknown element, and
`NG8113` rejects an unused standalone import.

`@typescript-eslint/no-restricted-imports` bans `MatDatepickerModule` from
`@angular/material/datepicker`, and `MatNativeDateModule` and
`NativeDateModule` from `@angular/material/core`, by `importNames`, so the
rest of both entry points stays importable. The paths are restated in all
three blocks that set the rule, because flat config replaces a rule's
options wholesale, and specs are covered: the transaction form's spec had
re-imported both modules. `check-lint-guards.mjs` keys a path with its
names (`name#A,B`), so a name dropped from a list is a diff rather than a
quietly narrower ban. `check-material-imports.mjs` lost its
`MatDatepickerModule` row and its provider-only skip in the same commit
(0048).

### One adapter, and a strict reader in the format's field order

**The reader.** `parseTypedDate(text, order)` in `transaction-date.utils.ts`,
the only module that parses a date, is the one reader of a date a person
typed. It NFKC-normalises the text, so full-width digits and separators
read as ASCII, and drops one trailing `日`. A strict `YYYY-MM-DD` goes
through `parseDayKey`, local midnight, in every order, because ISO is not
an order a format chooses. Anything else must be exactly three numeric
fields split on whitespace or one of `/ . - 年 月 ・ ー 。`, the last
three being what a Japanese keyboard types for `/`, for `-` and for `.` in
kana mode, which NFKC does not map (it folds a half-width `｡` into `。`).
A leading four-digit field is the year and the other two are month then
day; otherwise the order says where the fields sit, and a two-digit year
is `2000 + YY`. A one- or three-digit year, a fourth field, a word and a
day that does not exist are refused:
`localDateFromParts` builds the date and refuses one whose parts do not
survive the round trip. There is no `Date.parse` fallback.

**The order.** `LocaleFormatService.fieldOrder()` reads the order off the
same `short` style `formatDate` prints, through `formatToParts`, memoised
per locale: `mdy` in en-US, `ymd` in ja-JP and zh-Hant-TW. A picker is then
read in the order it prints, with no second table of locales beside Intl's.
`DateFormatService` gains `preference`, a `computed` over the stored
format with `auto` as its one default, which replaced the private
`getDateFormat`; one `FIXED_FORMATS` table that holds each fixed pattern's
order and its writer, so what `formatDate` prints is what `parseDate` reads
back (looked up with `Object.hasOwn`, since the key is a stored string);
`fieldOrder()`; and `parseDate(text)`. The profile select seeds from
`preference()` and draws its worked examples with the table's writers
([0171](0171-second-copies-fold-into-one-copy-of-each-helper.md)).

**The adapter.** `AppDateAdapter` (`core/services/app-date-adapter.ts`)
extends `NativeDateAdapter` and is provided in root.
- `format(date, display)` answers the frozen object `APP_DATE_INPUT`,
  compared by identity, with `DateFormatService.formatDate(date)`. Every
  other display format, the calendar's period and its cells' accessible
  names, stays Material's Intl in the adapter's locale. An object rather
  than an option bag, so no format a caller passes can equal it.
- `parse(value)` hands a number to Material, answers empty or blank text
  with `null` (a cleared field is no error), and reads anything else with
  `DateFormatService.parseDate`, or answers an **Invalid Date**: a `null`
  counts as valid, and the input would never raise `matDatepickerParse`.
- `deserialize(value)` reads a date-only ISO string through `parseDayKey`,
  and one of that shape that names no day is Invalid, rather than
  `new Date`'s UTC reading, which rolls `2026-02-31` into March. Anything
  else is Material's.
- `toIso8601(date)` is `dayKey(date)`, so an input's `min` and `max`
  attributes come from the local day.
- **It follows the reader itself.** Its constructor takes the reader's
  language and stored format at once, so the first paint is right, and a
  root effect over `LocaleFormatService.locale` and `preference()` calls
  `setLocale` whenever either moves, guarded by the last pair it followed.
  `setLocale` is Material's only signal to re-render every input, and the
  adapter sends it on a change of format alone too. The adapter is built by
  the first picker, so nothing resolves `LOCALE_ID` early and no
  initializer is added.

`APP_DATE_FORMATS` routes an input's text through `APP_DATE_INPUT` both
ways and keeps Material's display formats for everything else.
`provideAppDatepicker()` (`core/config/datepicker.config.ts`) provides
`DateAdapter` as the root `AppDateAdapter`, `MAT_DATE_FORMATS` and
`MatDatepickerIntl` as the root `AppDatepickerIntl`, and replaced
`provideNativeDateAdapter()` in `appConfig`.

A spec never writes that wiring by hand (0171).
`provideAppDatepickerForTests({ dateFormat, locale, t })`
(`core/services/testing/`) hands a spec the app's providers over signals it
owns, with an `AuthService` stub whose user is a premium account, so a real
`AnalyticsService` stays quiet, and a `TranslationService` stub whose
`getIntlLocale` is the real method run against the spec's signal. A spec
that asserts real catalog text through the adapter or the labels uses the
production `provideAppDatepicker()` with an `AuthService` stub and the real
`TranslationService` over `provideHttpClientTesting()`.

### The calendar's labels, relabelled before the calendar redraws

`AppDatepickerIntl` (`core/services/app-datepicker-intl.ts`) extends
`MatDatepickerIntl` in root. Its labels are **assigned** in `relabel()`:
Material declares them as class fields, which would shadow a getter on a
subclass, and TypeScript refuses one (TS2611). It relabels at construction,
from the catalog the app loaded before any page rendered, and on every
`localeChanges` of the adapter, and only then sends `changes`. That order is
the point. An open calendar's header redraws on the intl's `changes`, not
on the adapter's `localeChanges`, and formats its period through the
adapter, so by the time it is told to redraw both the words and the locale
are new. `formatYearRange` and `formatYearRangeLabel` read
`datepicker.yearRange` and `datepicker.yearRangeLabel`, and the year pages'
buttons take Material's own `yearsPerPage` (24). The keys are
`datepicker.*`, English as Material's defaults; the ranges follow
`household.plans.window`. `calendarLabel`, `startDateLabel` and
`endDateLabel` keep Material's English: nothing in 22.1.4 reads them, and
two are deprecated. The day cells read `19日` in ja and tc, Material's Intl
default once the adapter speaks the language; that is left as it is.

### Material's other words, and the currency pipe

**The stepper.** `AppStepperIntl` (`core/services/app-material-intl.ts`)
assigns `completedLabel`, `editableLabel` and `optionalLabel` from
`stepper.*` and relabels from a root effect on `translationsVersion`, which
also sees a catalog that arrives under an unchanged locale, then sends
`changes`. It needs no ordering beyond that. The import wizard provides it
in its own `providers` through `APP_STEPPER_INTL_PROVIDER` (see
*Departures from the plan*). In that wizard a finished step that is not the
selected one is in the **edit** state (`[editable]="!isImporting()"` on all
four steps), so a reader hears `editableLabel`; *Completed* is heard only
while the import is being written and the steps are sealed.

**The sort headers.** The three columns bind
`[sortActionDescription]="'transactions.sortBy' | translate"`. A rule
appended to the `.html` block's `no-restricted-syntax` fails an element
that carries `mat-sort-header`, plain or bound, without a **bound**
`sortActionDescription`: a static one is one language for every reader.

**The pin.** `material-intl.spec.ts` resolves `MatDatepickerIntl` from
`provideAppDatepicker()` and `MatStepperIntl` from
`APP_STEPPER_INTL_PROVIDER`, over the real `TranslationService` with the ja
catalog flushed, never `appConfig.providers`, whose initializers start
Firebase. Every own string field must differ from a new Material intl's,
bar the three unread datepicker labels. `app.config.spec.ts` asserts that
`appConfig` carries `MatDatepickerIntl` and does not carry
`MatStepperIntl`.

**The currency pipe.** `LocaleCurrencyPipe`
(`shared/pipes/locale-currency.pipe.ts`), impure and memoised on the value,
the code and `currentLocale` like `LocaleNumberPipe`, returns
`CurrencyService.formatCurrency(value, code)`, once `snapDisplayZero` has
turned a figure that rounds to zero into an unsigned zero: the account's
language for the symbol and separators, and the currency's own decimals, so a
yen amount drops `.00`. Every `| currency` site, whatever its arguments, became
`| localeCurrency:<its code>`, and `BindingPipe[name="currency"]` joined the
`date` and `number` bans. The fallout in the specs was providers, not
strings: six of the eleven components did not inject `CurrencyService`
before (the five reports components already did, for their conversions
and currency info), the real one fetches the live rates on construction,
and `createTranslationStub` has no `getIntlLocale`. Every spec that renders a
swapped template provides a `CurrencyService` double carrying
`formatCurrency`, merged into an existing double where there was one.

### An unreadable date says so

One key, `datepicker.dateInvalid` (*Enter a valid date.*), says it in seven
forms, and the parse error takes precedence over *required*: the
transaction form, the household contribution and the household budget's
start answer unreadable text with it rather than their *required*
sentence, and the budget form, the goal form and the recurring dialog's
start and end gained a `mat-error` for it. The household dialogs moved from
`household.planForm.dateInvalid` to it in the same commit, and that key is
gone (0171). The recurring dialog no longer crashes on a cleared start
date: its preview names no day while the field is empty or half typed, and
Save stays disabled while the start is empty or the end holds text that
names no day, because the end's model is the `null` that means "no end
date" and a save would drop the stored one. The transaction filters'
compact From and To keep the error outline only (*Known gaps*).

### A person with no name, and the two gates

`core/utils/person-name.utils.ts` is one helper for the account and for
household members. `givenName` trims, and answers `''` for a missing or
blank name. `accountDisplayName` is the given name or
`common.unnamedAccount` (*No name set*, 名前未設定, 未設定名稱).
`memberDisplayName` is the given name or `household.unnamedMember`, with an
inline form for mid-sentence (*A member*, *a member*), which folds the two
member fallbacks that existed. `welcomeGreeting` puts the name's first
word, split on any white space so the ideographic space splits too, into
`common.welcomeNamed` (*Welcome back, {{name}}*, おかえりなさい、{{name}}さん,
歡迎回來，{{name}}), or reads `common.welcome` when there is no name. The
header names the account through it and its avatar's `alt` reads
`settings.profilePhotoAlt`; the settings card, the dashboard's greeting,
the member chip and the member removal read it too; and
`HouseholdService` writes a member's name through `givenName`.

A sign-in that names nobody stores `''` (`firebaseUser.displayName ?? ''`;
the rules require the key on create). Profiles that already store `'User'`
are left alone: no migration, since the word is a name like any other.

Two gates hold it. `i18n:check`'s fifth scan adds `User` to the words it
fails as a whole string literal, case-sensitive, so a chat message's
`role: 'user'` stays out. And a template check with no number fails a
translated interpolation followed by `,` or `、` and then another
interpolation: that comma sits in the template where no language can move
it. A label joined to its value by a colon is accepted by decision; the
about page, the profile example, the import errors and the budget alert
write it in ja and tc. The dashboard's greeting was the only site.

### The rejection detector follows the zone it runs in

Karma runs in zone mode here, and the zone a rejection is reported in is
the zone the rejecting code ran in. An effect runs in the zone that was
current when `effect()` was called, whichever flush runs it: Angular stores
`Zone.current` on the effect node and flushes it under `zone.run`. So a
component's effect, created by `TestBed.createComponent` inside NgZone,
reports on `NgZone.onError` even when `TestBed.tick()` flushes it, and a
root service's effect, created by `TestBed.inject` in the spec body,
reports on `console.error` even under `fixture.detectChanges()`. Template
bindings and lifecycle hooks follow the flush; a template event runs in the
zone its listener was registered in; the spec body and its awaited
continuations report on `console.error`.

The household case subscribes `TestBed.inject(NgZone).onError`, records
`NgZone.isInAngularZone()` in a `callFake` that returns the rejection, and
expects `[true]` as its positive control, keeping its console spy. The two
service cases keep their console spies and lose their window listeners. A
case that cannot say which zone its code ran in subscribes both.

A spec-only `no-restricted-syntax` block bans the event names, as a string
literal (`'unhandledrejection'`, `'rejectionhandled'`) and as an `on…`
handler property. Its population in `check-lint-guards.mjs` replaced
`SYNTAX_EXEMPT_FILES` (0048). The message is scoped to ZoneAwarePromise:
`share-target-sw.spec.ts` evaluates the service worker natively, where
`window` does hear a rejection.

### The bottom bar's short label

`NavItem` gains an optional `shortLabelKey`, which only the dashboard's
entry carries: `nav.dashboardShort`, *Dashboard*, **ホーム**, 儀表板.
`BottomNavComponent` reads `t(item.shortLabelKey ?? item.labelKey)`, which
feeds both the visible label and the link's `aria-label`, so the name is
what is shown (0055). The sidebar and the command palette translate
`labelKey` themselves and keep ダッシュボード; the page title reads its own
`dashboard.title`. The active bold
stays: Hiragino's kana advance the same at every weight, so it costs
ダッシュボード no width, and in normal colour mode it is a cue that is not
colour. `check-i18n.mjs` counts `t(item.labelKey)` as
dynamic and skips it, so a catalog-presence pin in `nav-items.spec.ts`
covers every key in the list.

### A word is translated where it is shown

The second browser run found two words translated once and kept (below). A
word in the reader's language is translated where it is shown: in the
template, through the translate pipe, or by `t()` inside a `computed` that
the catalog drives. The Date Format select's Automatic option carries
`settings.dateFormatAuto` and the template translates it; the fixed patterns
keep the pattern as their label. `InsightChipsService` keeps what its
analysis found, each chip's category as an id, in a private signal, and its
public `chips` is a `computed` that names the category from `categories()`
and reads `translationsVersion()` explicitly, so a switch renames a chip
without analysing again or reading Firestore. `InsightChip` is unchanged.

Each fix has a spec that switches the catalog and reads the word again. No
gate holds the class (*What was rejected*).

### The method nothing read goes

`RecurringListComponent.categoryName` was deleted in one commit, with no
spec to go with it and nothing orphaned.

## What was rejected

- **A lint rule on a translation stored in a class field.** It would fail a
  `t()` call in a field initializer, the Automatic option's shape, and see
  nothing of a translation a service stores in a subscription or a signal
  `set`, the insight chips' shape, since whether such code runs once or on
  every switch is not a question of syntax. The class is left to review, to
  specs that switch the catalog, and to a live switch in the browser
  (journey 101's steps 4 and 6).
- **A root provider alone.** `provideAppDatepicker()` in `appConfig`
  without the import swap changes nothing on any page whose component
  imports a date module: its own providers shadow the root's.
- **Following the language and ignoring the stored format.** The lists,
  the rows and the forms print dates through `DateFormatService`, so an
  input that followed only the language would show a date one way while
  the row it edits shows it another, and would read `08/09/2026` against
  the order the account chose.
- **A lenient reader.** Falling back to `Date.parse` keeps every hole the
  strict reader exists to close: UTC midnight for an ISO day, the
  browser's order for a slashed one, and a date out of `Aug 19 2026` or
  `2`. A two-field date (`8/19`) is refused rather than given a year the
  reader did not type.
- **`null` for unreadable text.** Material counts `null` as valid, so the
  field would say nothing; an Invalid Date is what raises
  `matDatepickerParse`.
- **Getters on the intl subclass.** Material's class fields shadow them,
  and TypeScript refuses the declaration.
- **An app initializer that builds the adapter at bootstrap.** The adapter
  follows the reader from its first construction, and nothing needs it
  before the first picker; an initializer would resolve `LOCALE_ID` early
  and add work to every start.
- **`AppStepperIntl` at the root.** Provided in `appConfig`, it pulled the
  lazy wizard's stepper into the initial bundle, 36.65 kB
  ([0023](0023-the-initial-bundle-carries-only-the-entry-route.md)).
- **A static `sortActionDescription`.** One language for every reader; the
  rule accepts only a binding.
- **Teaching `localeNumber` currency.** It refuses currency on purpose: an
  amount needs its code and that currency's minor units, which
  `CurrencyService.formatCurrency` owns.
- **Translating a missing name at write time, or migrating stored
  `'User'`.** A stored word stays in the language of the moment it was
  written, on every screen and in every household. An empty name stores
  nothing a language owns; a stored `'User'` is a name the account has.
- **Gating a colon join too.** `label: value` reads correctly in ja and tc
  at every site that writes it.
- **Dropping the active bold, or lowering `appFitText`'s floor.** The bold
  costs Hiragino's kana no width, so dropping it keeps ダッシュボード at
  84 px; and below 12 px the type scale has no size, which is why the
  directive wraps there.
- **A `window` listener made to work.** zone.js decides where the
  rejection goes; a spec has to listen where it goes.
- **Folding argument-less `localeCompare` collation in here.** Two sites,
  a different mechanism, left for a follow-up.

## Consequences

- The ten picker components import Material's standalone pieces, and no
  component provides a date adapter, date formats or picker labels.
  `material:check` reads 343 `Mat*Module` entries across 103 components
  with no provider-only skip, and its self-test runs 64 cases.
- `provideAppDatepicker()` sits in `appConfig`, and the adapter, the
  datepicker intl and the formats are eager. `MatStepperIntl` is provided
  by the lazy import wizard alone.
- Fourteen `datepicker.*` keys, three `stepper.*` keys,
  `common.unnamedAccount`, `common.welcomeNamed` and `nav.dashboardShort`
  are new in all three catalogs; `household.planForm.dateInvalid` is gone.
- An account that stored `MM/DD/YYYY`, the default before `auto`, now sees
  its pickers month-first in every language too, as 0058 already chose for
  its printed dates: on a Japanese account the From field reads
  `10/01/2026` until the account picks Automatic, and then `2026/10/1`.
- The `.html` lint block bans the three built-in pipes and a sort header
  without a bound description; the `.ts` blocks ban the three date
  modules; the spec block bans a `window` rejection listener. `lint-guards:check` holds
  each of them for the files it governs.
- `i18n:check` reads `User` in scan 5 and runs the comma-join check.
- `app-date-adapter.spec.ts` joins the zoned `test:dates` run.
- Amounts in the reports, the data hub and the duplicate warning read in
  the reader's language: a yen amount has no `.00`, and tc writes the
  dollar as `US$`.

## What the browser runs found

The first run was in the emulator venue on 2026-10-21, on this branch's
code before this record's commit, with the account language set apart from
an `en-US` browser. Journeys 101 to 103 passed: the From field read
`10/01/2026` under `ja-JP` with its toggle カレンダーを開く, the open
calendar 2026年10月, 前の月, 日月火水木金土 and 前の24年; the format
switched to Automatic with no reload and the same adapter object; a
day-first account read `05/03/2026` as 5 March and `08/09/2026` as
8 September, both at local midnight; `Aug 19 2026` was refused; quick add
followed a live switch to tc with its dialog open; the household goal
answered `31/02/2026` with 請輸入有效的日期。; the bottom bar read ホーム on
one line at 375 px; the wizard's finished step said 編集可能 and the
sortable headers 並べ替え; a yen row read `￥1,000`; and an account with no
name read *No name set*, *Welcome back* and *A member*, with a stored
*User* left alone. The regressions held: 68's first step, 77 on this
branch's surfaces, 80, 83, 84, 85 bar its second step (below), 87 bar its
service-worker step, which the pane cannot judge, 88, 93 and 100. It found
three defects, all older than this wave. Each was fixed in a commit of its own
whose spec failed first, and each fix was re-checked in the same venue.

- **The dashboard kept a gap for two cards it was not showing.**
  `.dashboard-container` is a flex column with a 24 px gap, and the empty
  `app-budget-alert-banner` and `app-weekly-recap` hosts, holding only
  Angular's comment anchors, each took one: a 48 px blank band above the
  summary cards at every width. `fix(ui): the dashboard leaves no gap for a
  banner or recap it is not showing` hides an `:empty` child of the
  container, which ignores comment nodes. The re-check read one 24 px gap
  per visible card.
- **A bill link that fell back to the rules ended on the recap's
  sentence.** On a full load of `/dashboard?bill=<a rule past the
  fortnight>` with the weekly recap showing, the page landed on
  `/budgets?tab=recurring` but the live region ended on *Weekly recap: you
  spent …*. `showRecurringRules()` announced its reason before the
  navigation landed, and `AnnouncerService` queues: on a cold start the
  budgets chunk loads while the recap's week arrives, and the recap's
  sentence was placed after the reason. `fix(a11y): a bill link that falls
  back to the rules says why once the rules are open` announces once the
  navigation resolves true, and not when it is superseded or refused
  ([../dashboard.md](../dashboard.md)). The re-check's full load ended on
  the reason.
- **Budget Progress cut names and amounts.** At 1024 px the dashboard rail
  read *Food & Dini…*: `budget-progress.component.scss` applied Tailwind's
  `truncate` to the name and the amounts, which `check-truncation.mjs`
  could not see. `fix(ui): a budget's name and amounts wrap on the
  dashboard instead of being cut` lets them wrap. Its first re-check split
  *Subscription/s* and *Food &/Dining* mid-word under `overflow-wrap:
  anywhere`, so `.budget-info` became a wrapping flex row: a name stays
  whole, and *Monthly* drops below it. `test: fail the build on Tailwind's
  truncate utility, which the truncation check could not see` taught the
  gate the utility and gave it its self-test
  ([../ui-overflow.md](../ui-overflow.md)).

The device session for #441, on 2026-10-22 on an iOS 26.2 simulator, also
read #500 with the device in Japanese and the account in English and
`YYYY-MM-DD`: quick add showed `2026-10-22` and an English calendar, the
account's language rather than the device's, and answered text it could
not read with *Enter a valid date.* Typing a date on the Japanese keyboard
was not driven.

The second run, in the emulator venue on 2026-10-22 on the finished branch,
loaded each page with the account in Traditional Chinese, switched the
account to English through the page's own write path, the call the
Settings Language select makes, and read what was left in Chinese. Getters
and `computed`s read the catalog again and were clean. Two surfaces were not,
both older than this wave and both a word translated once and kept, where it
should have been read where it is shown. Each fix's spec failed first.

- **An insight chip kept its category's name.** On `/transactions` the
  chip read *New this month: 電費* on an English page. `InsightChipsService`
  named the category when the chips were found, in the Firestore
  subscription, while the template translated the sentence around it on
  every check; for the same reason a chip found before the categories
  arrived kept the name for an id the catalog lacks. `fix(i18n): the
  transaction insight chips name a category in the language now showing`
  names it where the chip is read.
- **Automatic kept the language the page opened in.** On `/settings`, with
  the format on Automatic, picking English turned Currency's select into
  *$ US Dollar (USD)*, while Date Format's still read *自動（跟隨語言）* above
  an English example. Its label was `t()` in a field initializer, run once
  when the page was built; Currency's options translate in the template,
  and Material's option re-reads its own text after every check, so that
  select's trigger followed. `fix(i18n): the date format's Automatic option
  follows a language change made on the Settings page` translates it in the
  template (*Decision*).

The run also corrected two reads in journeys 101 and 102: the calendar's
close button is named by its text, not an `aria-label`, and the import
wizard shows its review step only after **続ける** on the processing step
([../e2e.md](../e2e.md)).

## Departures from the issue

- **"36 uses" counted lines, not pickers.** The issue's figure is the
  number of template lines naming `datepicker`. The pickers are 17 inputs,
  17 `<mat-datepicker>` elements and 11 toggles across 10 components.
- **The bold was not the cause.** Part 5 named the active tab's label
  (bold). Hiragino's kana advance the same at every weight: ダッシュボード
  measures 84.00 px in Hiragino Sans either way, against at most 80 px of
  room. The owner's choice among the issue's three was a shorter label; the
  bold and the floor stay.
- **Part 4 was wider, and its worst case was household's.** The issue
  named `widget-snapshot.service.spec.ts`. Reading found three specs, and
  put back, each rejection showed which was blind. The two service cases
  failed only on their console spies while their window assertions
  passed. The household case failed on nothing: the error surfaced as
  Karma's *An error was thrown in afterAll*, and the run died at 77 of 102
  on a disconnect. Its case now listens on `NgZone.onError` with a
  positive control.
- **Part 2 had three sites**, one of which stored the word, and gained the
  comma-join check, which the issue did not ask for.
- **Part 3 had no spec to remove.** The acceptance asked for the method
  and its spec; there was only the method.
- **Part 1 is wider than the datepicker.** The stepper, the sort headers
  and the currency pipe are the same class, found by reading; the
  unreadable-date messages and the recurring dialog's cleared start date
  came with the strict reader.
- **The design question has two answers.** The issue asked whether the
  picker should follow the language or the `dateFormat` preference. Its
  fields' order and digits follow the preference, `auto` being the
  language's own short form; its words follow the language.

## Departures from the plan

- **`AppStepperIntl` is provided by the import wizard, not `appConfig`.**
  Provided at the root, as planned, it pulled the lazy wizard's stepper
  into the initial bundle, 36.65 kB, against
  [0023](0023-the-initial-bundle-carries-only-the-entry-route.md). The
  wizard lists `APP_STEPPER_INTL_PROVIDER`, and `app.config.spec.ts`
  asserts its absence from `appConfig`.
- **No smoke reads a sort description.** Karma's window is 756 px, below
  the table's 768 px breakpoint, so `/transactions` renders no sortable
  header there. The unit describe that renders the real template holds
  the binding, and the first browser run read it at 1024 px.
- **`datepicker.dateInvalid` keeps its period.** The plan's table printed
  the English without one; the household key it replaced had one in all
  three languages, and the plan said to keep that key's words.
- **Three readings the plan left open were decided by its specs.** A
  leading four-digit year reads month then day in every order. One
  separator per gap, so `2026//8/19` is refused. Month and day are not
  limited in length, so `8/019/2026` is 19 August under `mdy`.
- **The recurring dialog's end date holds Save too.** The plan named the
  start date; the end date's own parse error reached the same dropped
  value, so it disables Save as well.

## Things that only became apparent while building

- **A standalone component's import graph is an injector.** The planned
  fix was a root provider. A routed page or a dialog builds its injector
  from the modules its components import, so a module that provides
  something shadows the root's copy below that page, silently, and the
  shadowing reached every page with a picker.
- **Hiragino's kana advance the same at every weight.** A heavier face is
  wider in Latin text, which is what made the bold look guilty. In Hiragino
  Sans ダッシュボード measures 84.00 px at 12 px in either weight.
- **A flex item's `min-width: auto` let the dashboard tab take its
  neighbours' room.** `.nav-item` is `flex: 1` with an 88 px cap, and an
  automatic minimum is its content's min-content width, so a tab holding a
  label that does not break grows past its share of the bar up to that
  cap. The room ダッシュボード met was the cap less its two 4 px gutters,
  80 px, not the equal share the bar's width suggests, and it was still
  4 px short. ホーム's three kana fit with room to spare.
- **An open calendar redraws on the intl's `changes`, not on the adapter's
  `localeChanges`.** The inputs re-render on the adapter's signal, but an
  open calendar's header takes its period text and its labels only when
  the intl says `changes`, so the labels' class is what moves an open
  calendar into the new language, and has to say it after the adapter has
  moved.
- **A spec that writes the locale or the format after a picker rendered
  flushes with `fixture.detectChanges()`.** The picker built the adapter
  inside the Angular zone, so its effect belongs there; `TestBed.tick()`
  from the spec body enters the zone mid-tick and reports `NG0101`.
- **A spec that provides the app's adapter without an `AuthService` stub
  fails far from the cause.** The picker's optional `inject(DateAdapter)`
  is a directive inject, and Angular rethrows a nested not-found there:
  `NG0201` *No provider found for `Auth`*, through `DateFormatService` and
  `AuthService`. When something with an optional `inject(AuthService)`
  (`AnalyticsService`, in the transaction form, the filters and the budget
  form) was built first, it is `NG0200`, a circular dependency on
  `AuthService`, instead.
- **The real `CurrencyService` fetches on construction.** A spec that
  renders a template with the new pipe builds it, and a successful fetch
  leaves `home-account.exchangeRates` in storage for later specs. Every
  rendering spec provides a double.

## Known gaps

- **The filter dates say nothing for unreadable text.** The transaction
  filters' compact From and To have no subscript room in their grid, so
  unreadable text shows the error outline and no sentence, and a screen
  reader hears no reason.
- **An open calendar keeps two labels in the language it opened in.**
  Material reads `closeCalendarLabel` and `comparisonDateLabel` once, when
  the calendar opens, so its hidden close button and its comparison label
  change only when it is reopened.
- **A switch leaves a stale parse error.** When the language or the format
  changes while a field holds unreadable text, Material reformats the field
  from its model, which is empty, and marks the value valid without
  running the validators again, so the error stays until the next
  keystroke, and the recurring dialog's **Save** stays disabled until then.
  A blur only reformats the field and marks it touched.
- **Two sorts collate without a locale.** The transaction list's
  description sort and the category suggestion list call `localeCompare`
  with no locale, so their order follows the device.
- **Reminders keep the language they were booked in.** A bill reminder
  booked while the account was English says English after a switch, until
  it is booked again.
- **The English sort description reads as a fragment.** *Sort by* is
  announced alone after the column's name.
- **A stored `'User'` stays.** Accounts created before this record whose
  sign-in named nobody greet *Welcome back, User* until the name is
  changed.
- **The date-module rule cannot see a provider.** A component that lists
  `provideNativeDateAdapter()`, or a `DateAdapter` provider, in its own
  `providers` shadows the app's adapter as the modules did, and imports
  nothing the rule names.
- **Three datepicker labels stay English.** `calendarLabel`,
  `startDateLabel` and `endDateLabel` are unread in Material 22.1.4. A
  Material upgrade that reads them would show English; the pin names them
  as its only exceptions, so a reviewer of that upgrade sees them.
- **The gates read only their shapes.** The comma-join check passes a
  full-width `，`, a colon and a sentence assembled in code; scan 5 knows
  three words and not `Guest`, `Anonymous` or a lowercase `user`.
- **A typed date on a phone's Japanese keyboard was not driven.** The
  specs cover full-width digits and `年月日`; no browser run typed them,
  and the simulator run typed none.
- **Nothing finds a translation stored once.** A word translated in a
  field initializer, a constructor, `ngOnInit`, a subscription or a signal
  `set` keeps its language until its page is built again. The two the
  second run found are fixed; another would be found by a live switch
  (journey 101's steps 4 and 6) or a spec that switches the catalog. A
  select whose option labels are bound to such a word needs the template
  form: the key through the pipe, whose text Material's option re-reads
  after every check.

The filter dates, the open calendar's two labels, the two sorts, the
reminders and the sort description are a follow-up for the owner, #505.
