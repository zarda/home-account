# Performance

What the browser downloads and parses before the first screen appears, and
what keeps it from growing back
(see [ADR 0023](ADR/0023-the-initial-bundle-carries-only-the-entry-route.md)).

## What ships eagerly

`index.html` loads `polyfills` and `main`. `main` carries the Angular
runtime, Firebase, Material, the app shell (`MainLayoutComponent`, header,
sidebar), the login page, the guards, and everything rooted services reach
at module scope.

Every page under the shell — dashboard, transactions, budgets, reports,
settings, about — is a `loadComponent` entry in `app.routes.ts`, so opening
one downloads that page and not the other five. `login` and the layout
itself stay eager: the layout renders the outlet the others load into, and
login is where an unauthenticated visitor lands.

No service worker caches or prefetches the app. The only service worker,
`public/share-target-sw.js`, answers the share-target POST and raises
reminders' notifications, and every other request goes to the network
([share-import.md](share-import.md)). The Angular service worker the
production build used to emit was never registered, so its prefetch of every
lazy chunk, which this page once counted as a cost, never ran, and it is gone
([ADR 0170](ADR/0170-the-animations-runtime-the-unregistered-worker-and-nine-dead-items-come-out.md)).
A returning visitor's lazy chunks come from the network or from the HTTP
cache under Hosting's default headers.

## The heavy dependencies, and where each one loads

| Dependency | Size | Loaded by |
|---|---|---|
| `jspdf` + `jspdf-autotable` | ~388 kB | `ExportService.exportToPDF` |
| `pdfjs-dist` | ~434 kB | `pdf-raster.utils.ts` |
| `html2canvas` | ~203 kB | jspdf, on its own |
| `openai`, `@anthropic-ai/sdk`, `@google/generative-ai` | — | `OpenAIService`, `ClaudeService` and `GeminiService`, each through its own `loadSdk`; on a build that ships a Gemini key, `GeminiService`'s constructor starts Gemini's fetch at start-up, for an arm the first bring-up supersedes ([ADR 0179](ADR/0179-a-provider-arm-applies-only-if-nothing-superseded-it.md)) |

The rule is the same in every case: a dependency that serves one screen or
one button is imported inside the function that needs it, never at module
scope. `ExportService` is the cautionary example — it is
`providedIn: 'root'` and is injected from three places, so a module-scope
`import 'jspdf'` reached the initial bundle no matter which route was open.

## Chart.js pieces

`CHART_REGISTERABLES` in `core/config/chart.config.ts` lists exactly the
controllers, elements, scales and plugins the app draws. The default
registry also carries polar area, radar, bubble and scatter, which this app
has never rendered.

A chart type added later must add its pieces to that list. Most omissions
fail loudly — an unregistered controller or scale throws on render — but
`Filler` does not: the shaded areas under the spending-analysis lines just
stop being drawn. `chart.config.spec.ts` names it for that reason, and
`spending-analysis.component.spec.ts` renders a real chart and checks the
filler attached.

Specs and smoke tests provide `provideAppCharts()` rather than their own
registry. A spec that registered the full set would pass against pieces
production does not ship.

## What a component declares

A Material module in a component's `imports: [...]` that its template never
uses is dead weight nothing could see. It puts that module's directives into
the component's template scope and its providers into the component's
injector, and it makes a claim about the template — *this one renders
chips* — that the next edit can falsify silently. Twenty such entries stood
across eighteen components before anything looked.

Nothing already in the repo could look. ESLint counts the symbol as used the
moment it appears inside the array; Angular's own `unusedStandaloneImports`
diagnostic is blind to NgModules by construction — it raises `NG8113` only
for a standalone directive, component or pipe, so no `Mat*Module` ever
reaches it.

Two gates cover the two halves.

**`npm run material:check`** (`scripts/check-material-imports.mjs`, a CI step
after *Check direction*) holds two rules. The first parses each
`@Component`'s `imports:` array and the template it declares, and fails when
a listed Material module contributes no selector that template uses. The
second is about one select's empty option (below). What the first proves is
bounded on purpose:

- A table maps **28 Material modules** to their full transitively-exported
  selector sets, spelled as the installed `@angular/material` spells them.
  `--self-test` asserts every string in it against the selectors the
  installed package actually declares, plus the three re-export edges it
  leans on (List → Divider, Input → FormField, Select → Option); its 64
  cases cover the second rule's fixtures too, so it prints
  `check-material-imports self-test: 64 passed`. A Material upgrade that
  renames a selector fails the self-test, where the fix is the table — not
  the app, where the fix would look like deleting a live import.
- Matching is lenient in every direction but one: an attribute selector
  matches on its attribute alone, bare and bound spellings both count, and
  commented-out markup counts as a use. Every leniency can only miss a dead
  entry, never invent one, so a clean run is a floor rather than a proof.
- What it skips is **counted and named in the output**: any module not in
  the table. A live run prints `Checked 343 Mat*Module entries across 103
  components (0 with no template).`, `Skipped 0 entries outside the
  table.`, `No unparsed files.` and the findings. It had a second skip, for
  provider-only modules, which held one, `MatNativeDateModule`; no component
  imports it now, and the skip went with it. A file whose
  `@Component(` count exceeds the decorators the parser could read is listed
  as unparsed and fails the run: a component the gate cannot see is reported,
  never silently skipped.

**Adding a module to the table** is what you do the first time the app uses
a Material module it has not used before: add its name with the selector set
the package exports for it, and run `npm run material:check` — the self-test
fails on a misspelling immediately. Until it is in the table, its entries are
skipped and counted rather than checked, and the run says so by name.

**A select that offers a null or undefined option can select it.** Material
reads an option whose value is `null` or `undefined` as a reset option unless
the select sets `canSelectNullableOptions`, so a field whose model holds
either showed empty, with its label sitting unfloated inside it, whatever the
option was labelled: *Same day as the start date*, *Off*, *None*, *All*. The
browser run for #490 met it on four selects whose empty option holds `null`,
the recurring dialog's day and reminder and the transaction form's budget
period and goal,
and the second rule followed
([ADR 0178](ADR/0178-a-schedule-is-held-to-its-ranges-and-a-refusal-says-what-was-written.md),
under the class rule of
[ADR 0145](ADR/0145-a-class-found-by-reading-becomes-a-gate.md)). The five
*All* options in the transaction filters, bound to `undefined`, showed empty
for the same reason; once the owner chose *All* for an unset filter, they took
the attribute and the rule widened to them
([ADR 0180](ADR/0180-a-saved-key-joins-the-wait-and-a-reader-sees-their-own-language.md)).
In any template under `src/app`, a `<mat-select>` whose body holds a
`<mat-option` bound `[value]="null"` or `[value]="undefined"` must carry
`canSelectNullableOptions` on its opening tag; only a literal `false` there
fails, and a bound expression is trusted. The body runs to the select's own
`</mat-select>`, matched exactly, so a `<mat-select-trigger>` ahead of the
options does not end it, and HTML comments are masked first. A live run
prints `Checked 41 mat-select elements across 96 templates (8 offer a null or
undefined option).` It cannot see an option whose null comes from data (the
reminder select's, which the dialog's real-template spec covers), an option
bound to an expression that is undefined without naming it, such as
`[value]="void 0"`, which no template writes today, or an inline
`template:`.

**`unusedStandaloneImports: "error"`** in `tsconfig.json`'s
`angularCompilerOptions` covers the half Angular can see. It was measured at
zero before being raised — and probed, since a silent zero is not evidence a
check ran: a deliberately unused `RouterLink` raised `NG8113`, and the build
was clean again once it was removed. `"error"` rather than the default
warning breaks the **dev** build as well as CI, by design; a warning in an
`ng serve` scrollback is exactly the state the NgModule half had been in all
along. `tsconfig.spec.json` extends the root config, so spec test hosts are
held to it too.

The reasoning, and what each gate deliberately cannot see, is in
[ADR 0128](ADR/0128-a-material-module-a-template-never-uses-fails-the-build.md).

**The date modules are banned outright.** A module's providers land in the
injector of the component that imports it, and for Material's date modules
that was the harm, not dead weight: `MatDatepickerModule` provides its own
calendar labels, `MatNativeDateModule` the native date adapter and its
formats, and `NativeDateModule` the adapter alone, and a routed page or a
dialog that imports one shadows the app's single adapter and labels, so its
pickers fall back to the browser's language and English. The pickers import
the standalone `MatDatepicker`, `MatDatepickerInput` and
`MatDatepickerToggle`, which provide nothing, and
`@typescript-eslint/no-restricted-imports` bans the three module names, by
`importNames`, in every file under `src/app`, specs included.
`lint-guards:check` keys each path with its names, so a name dropped from
the list is a diff. What it cannot see is a component that lists
`provideNativeDateAdapter()`, or a `DateAdapter` provider, in its own
`providers`
([ADR 0182](ADR/0182-a-control-reads-in-the-accounts-language-and-date-format-and-nothing-re-provides-materials-adapter-or-words.md)).

Three more template bans, in the `.html` block of `eslint.config.js`, keep
the boot locale out of what a template formats: Angular's `date`, `number`
and `currency` pipes, each replaced by an impure pipe that follows the
reader ([locale-formatting.md](locale-formatting.md#in-templates)).

## Change detection

Every component declares `ChangeDetectionStrategy.OnPush`, enforced by
`@angular-eslint/prefer-on-push-component-change-detection`
(see [ADR 0024](ADR/0024-every-component-checks-with-onpush.md)).

Two rules follow from it:

- **View state written after an `await` must be a signal.** A plain field
  assigned in a promise callback will not repaint the view. Fields written
  only from event handlers or `ngOnChanges` are fine — both already mark the
  view dirty.
- **`markForCheck()` is for third-party imperative APIs only**, and gets a
  comment naming the API. The two current uses are Material's datepicker,
  which caches `dateClass` results outside anything Angular tracks.

Note what this did *not* buy. Profiling one dashboard period toggle before
and after showed 117 versus 122 template updates — noise. The app was
already signal-driven with no `async` pipes and event coalescing on, so
Angular's signal-based view marking was doing the work already. OnPush is
here as an invariant that survives growth and non-signal state, not as a
measured speedup. ADR 0024 has the full table.

Unit specs cannot see a stale view: `fixture.detectChanges()` checks a view
whether or not anything marked it dirty. The route smoke drives the period
toggle on real routed UI instead.

## The budget

`angular.json` carries an `initial` budget in both the `production` and
`production-local` configurations — the same numbers in both, because
`build:ios` uses the second one and they would otherwise drift;
`build-configurations.spec.ts` pins that they are equal.

| | Warning | Error |
|---|---|---|
| Initial bundle | 2.411 MB | 2.7 MB |

Against 2,410,644 bytes (JavaScript 2,379,448, stylesheet 31,196, in 62
initial files), measured by `npm run build:analyze` from a clean production
build on 2026-10-27.

The warning went up, to 2.411 MB, when the work of #464
([ADR 0185](ADR/0185-a-refund-is-asked-about-at-every-door-and-a-category-follows-its-rows-side-there-and-back.md):
the cloud readers asked whether the money came back, a category that follows
its row's side in the form and on the review card, the parser's misses, and the
type grade reaching the import's record and the analytics) put the initial
bundle 3,644 bytes over the 2.407 MB it stood at; it moved to the whole
kilobyte above the figure and no more, which leaves 356 bytes of headroom
(2,411,000 less 2,410,644). That work grew the initial JavaScript by 3,729
bytes and left the stylesheet alone. No chunk was cut or added: the 62 initial
files are the base's 62. All of it lands in initial chunks, but not all of it is
code the first screen runs.

The base was not the figure this page recorded. `f2b3d2c4`, the merge of #509,
built at 2,406,915 bytes where this page said 2,406,497, so 418 bytes had gone
in unrecorded. They are #509's
([ADR 0184](ADR/0184-the-lock-fails-closed-while-the-profile-is-unknown.md)),
which moved the figure without a re-measure: a build of the merge before it,
`4da72b6c`, reads 2,406,497 to the byte. Measured per input from the
build's own stats, `app-lock.service.ts` took 506 bytes (4,163 to 4,669), the
lock a profile that could not be read keeps and the stand-down that waits for
the profile to settle. Six inputs around it came to 24 less between them
(`app-lock.utils.ts` 9, `biometric-auth.service.ts` 8, `pin-hash.utils.ts` 6 and
three moves of one byte), which is the minifier renaming around the changed
module. The inputs came to 482 more and the output total to 418, a difference of
64 bytes between the two measures that is not attributed. The figure was 85
bytes under the 2.407 MB warning there, so the warning did not move for it.

This work's growth, measured the same way against the stats of that base
(summed over the initial outputs and matched by input path, since the output
names and their hashes change between builds):
`transaction-form.component.ts` took 2,185 bytes, initial because
`quick-add.service.ts` imports the form, 56 of them its stylesheet, which the
component carries (7,473 to 7,529). The type flag takes the checked segment's
icon, where it sat beside the toggle, and each segment's name leads with the
flag's sentence; a type change says aloud when it clears the category and keeps
that category to give back on the way back; the scan's reading, which the type
change drops from the form, is held for the save to report as `receipt_confirm`;
and the flags on the amount and the date take focus from the keyboard.
`receipt.prompts.ts` took 478 (13,892 to 14,370): the receipt prompts ask
whether the money came back, in the same words for the three providers, and put
`type` in the skeleton of the envelope they ask for. `import-review.utils.ts`
took 441 (5,354 to 5,795): `readerFlaggedType`, `answerTypeFlag` and
`countTypeAnswers`, which keep the side a reader flagged through a flip and
count the answers, and the category a flip or a merge holds to its row's side.
`receipt-extraction.utils.ts` took 433 (1,696 to 2,129): `readTransactionType`,
which reads income only when a model says exactly that, `modelTypeGrade` with
the grade it gives an income, and `extractedFieldConfidence`, now the one place
a row's amount and date grades are built. That helper is why two services came
out smaller: `ai-import.service.ts` 301 less (28,708 to 28,407) and
`ai-strategy.service.ts` 161 less (11,465 to 11,304) each built the object by
hand, twice in the first and once in the second, and each gained something
besides, the type counts the import's record carries in the first and the type
the receipt mapper passes on in the second, which it had filed as an expense.
The report took 592 bytes between three inputs: `analytics-events.json` 289
(1,991 to 2,280), the `receipt_confirm` entry and its four parameters;
`receipt-attempt.service.ts` 227, `buildReceiptConfirmPayload`, the payload the
camera, the wizard and the form all build; and `analytics.service.ts` 76,
`trackReceiptConfirm`. `receipt-consolidation.ts` took 155, the type grade a
consolidated receipt's row carries on every multi-photo path;
`category.service.ts` 115, `categoriesOrDefaults`, the catalogue a receipt read
before the account's categories load is filed against, which
`cloud-llm-provider.base.ts` and
`offline-queue-processor.service.ts` (12) now ask for; `receipt-text-parser.ts`
103, a minus glued to a CJK label, a parenthesis or an equals sign marking a
refund's total; `cloud-llm-provider.base.ts` 83 and `native-receipt.service.ts`
77, the strict reading of a model's type answer, the refund a cloud reader finds
on one photo filed as income and asked about, and a negative on a total the
model did not read flagging its purchase; `gemini.service.ts` 14, the same
strict reading and the direction of its one-row summary. `import-history.model.ts`
took 47 (12 to 59), `gradeNeedsVerification`, the one rule that says whether a
grade sends its field to review, which the form and `import-dto.utils.ts` (10
less) read where each compared the threshold; the model's other additions are
types and cost nothing, as do `ai-types.ts`, `llm-provider.interface.ts` and the
signature of `import-history.service.ts`, which did not move.
`duplicate-detection.service.ts` took 23: an exact match needs the same type, so
a purchase and its refund on one day are two transactions. One input gave some
back with no code of its own: `camera-capture.component.ts` came to 118 less
(24,026 to 23,908) because its stylesheet lost the `min-width` the dialog's
content kept from 768px up, wider than the content box the dialog gives it;
the stylesheet's own output is 67 bytes smaller (4,433 to 4,366). Fifty-four
other inputs moved by 1 to 35 bytes, 6 more between them, and none was edited:
the largest, in the Firebase Analytics SDK's file, is the minifier renaming
around the changed modules. The edits to the import wizard, the preview table
(its marks, its merges, the category re-filed when the account's categories
arrive) and Import History's tiles are in lazy chunks. The translation catalogs
are fetched at runtime and are in no chunk. Summed over the 62 initial outputs
the inputs come to 2,880,184 bytes (2,876,010 at the base), 4,174 more, against
2,410,644 (2,406,915) on disk and 3,729 more, a difference of 445 bytes between
the two measures that is not attributed.

The `anyComponentStyle` budget stays at 12 kB for the warning and 16 kB for the
error. The two largest component stylesheets are the import wizard's (10,798
bytes) and the preview table's (10,736), and neither one's scss was edited, so
they sit 1,202 and 1,264 bytes under the warning.

The warning came down to 2.407 MB after the work of #500 and #441 (a date picker,
an amount and a name that read in the account's language and date format, and
a tap on the home-screen widget;
[ADR 0182](ADR/0182-a-control-reads-in-the-accounts-language-and-date-format-and-nothing-re-provides-materials-adapter-or-words.md)
and
[ADR 0183](ADR/0183-the-widget-reaches-the-lock-screen-opens-the-dashboard-names-itself-in-the-devices-language-and-follows-the-accounts-language-currency-and-hidden-cards.md))
took the initial bundle 4,959 bytes under the 2,411,435 it stood at, to
2,406,476. All of it is JavaScript, from 2,380,239 to 2,375,280; the stylesheet
did not move. The figure had been over the 2.412 MB warning along the way, at 2,412,862
bytes with the adapter in and at 2,414,244 with the calendar's labels, and the
work still put code in the initial files. Measured per input from the build's
own stats, against a rebuild of the work's base, `563c3eeb` (2,411,435 bytes in
60 files there, the recorded figure to the byte), `src/app` grew by 6,070 bytes
and the libraries gave back 13,242.

`app-datepicker-intl.ts` (1,483 bytes), `app-date-adapter.ts` (990) and
`datepicker.config.ts` (126) are new to the initial files, 2,599 bytes between
them: the calendar's words, the adapter that shows and reads a date in the
account's format and language, and the one provider function `app.config.ts`
now calls where it called `provideNativeDateAdapter()`, which is why they are
initial at all (`app.config.ts` itself took 19). The stepper's words are not
among them: the import wizard provides them, so Material's stepper stays in the
wizard's lazy chunk. A typed date took 1,434: `parseTypedDate` and its
patterns in `transaction-date.utils.ts` (586), the table of the three fixed
formats with the order each reads, the preference and `parseDate` in
`date-format.service.ts` (422), and `fieldOrder`, read once per locale from the
date formatter's own parts, in `locale-format.service.ts` (426). The
transaction form, initial because `quick-add.service.ts` imports it, took 322:
the message its date field shows for a typed text that does not parse, and the
three standalone picker directives it imports where it imported two modules.
The header's name took 623: `person-name.utils.ts` is a new module in the
initial files, 406 bytes, and `header.component.ts` took 217 for the name it
shows in the account's language. The widget took 382:
`widget-snapshot.service.ts` 254 (the cards a reader hid, left out of the
snapshot and named in it, the read of the translation catalog's version, and
the return when no one is signed in), `widget-snapshot.plugin.ts` 92 for the
token's `addListener`, which the adapter the factory hands out on a device now
forwards beside `write`, and `widget-snapshot.model.ts` 36, which became
initial. The tap's own code, `NotificationTapService`, stays in its lazy chunk.
The lock took 226: `app-lock.service.ts` 179 for `relockTarget`, which keeps the
target of a navigation still under way across a relock, and
`notification-route.utils.ts` 47 for `widgetRoute`. `app-lock.service.ts` now
imports `safeAppRoute` from that module beside `reminder.service.ts`, and the
module was cut out of the chunk that held it into an initial chunk of its own,
387 bytes and a file more, the cut described below for
`category-display.utils.ts`. The bottom bar took 97: `nav-items.ts` 47 and
`bottom-nav.component.ts` 50, for the shorter label a destination may read
there. Fifty-seven other `src/app` inputs moved by 1 to 93 bytes, 368 between
them, and only one of them, `auth.service.ts` (4 fewer), was edited:
`ai-search-dialog.component.ts` (+93), `login.component.ts` (+59) and
`command-palette.component.ts` (+57) head the list, which is the minifier
renaming around the changed modules.

The libraries gave back more than that. `@angular/common`'s
`_common_module-chunk.mjs`, 11,605 bytes of the initial files in the base build,
holds 1,764: nine reports components imported Angular's `CurrencyPipe` for their
amounts, each reads `LocaleCurrencyPipe` now, which formats through
`CurrencyService`, and the pipe's code, which the base build held in an initial
chunk, is in no chunk of this one. That is 9,841 bytes, 9,802 with the
package's smaller moves. `@angular/core`'s `_debug_node-chunk.mjs` came to 2,554
bytes less (141,014 to 138,460); the stats name the input and not the symbols,
and which removal took them out is not isolated. Material and the CDK came to
755 bytes less between them (875 with these seven; the two packages' smaller
moves give back 120): `datepicker.mjs` 708 and Material's `core.mjs` 363
less, the two files that declare the dropped `MatDatepickerModule`,
`MatNativeDateModule` and `provideNativeDateAdapter()` (the adapter's own base
class, `NativeDateAdapter`, stays), and `_pseudo-checkbox-chunk.mjs` 421 and
`select.mjs` 248 less, against `_option-chunk.mjs` 410, the CDK's
`_selection-model-chunk.mjs` 249 and `list.mjs` 206 more, which no edit has been
traced to. The chunks around them changed shape. The datepicker chunk no longer
carries Material's `core.mjs`; `select.mjs`, the option chunk and the option
module share an output file of 38,410 bytes, where `select.mjs` had one of its
own and the option chunk another, and the pseudo-checkbox (an output file of
4,594 bytes) and the CDK's selection model (3,355), which the option chunk held,
came out into files of their own. With the 387-byte output file above, that is
the two initial files more (62 where there were 60). The per-input figures in
this account are the build stats' `bytesInOutput`. They compare one input across
the two builds, and they do not add up to the output total: summed over the 62
initial outputs they come to 2,875,511 bytes (2,882,683 in the base build),
against 2,406,476 (2,411,435) on disk, and the 387-byte file holds an input of
458. The inputs came to 7,172 bytes less between the builds and the output
total to 4,959 less, a difference of 2,213 bytes between the two measures that
is not attributed. After that measure, the bump to 26.10.178 took a byte off
(2,406,475), and the fixes of the whole-branch review brought the figure to
2,406,494, all of it JavaScript. `widget-snapshot.service.ts` took 16 bytes for
the month of the window the figures were summed over, which `monthKey` now
reads instead of the clock, and `transaction-date.utils.ts` took 4 for `・` and
`ー`, the Japanese keyboard's slash and hyphen, as separators. Four other
initial inputs moved by one or two bytes each, a byte less between them, which
is the minifier renaming around the changed modules. A last fix added `。`,
the same keyboard's full stop, as a separator: 3 bytes in
`transaction-date.utils.ts` against a build without it, to 2,406,497
(2,375,301 of JavaScript). The currency pipe's unsigned zero, the dashboard,
the household members page and the reports' best month are in lazy chunks.
The figure sits under the 2.407 MB warning.

The warning went up again, to 2.411 MB, when the work of #495 and #497 put the
initial bundle 1,738 bytes over the 2.409 MB it stood at; it moved to the whole
kilobyte above the figure and no more. That work grew the initial JavaScript by
1,744 bytes (from 2,378,042) and left the stylesheet alone. All of it lands in
initial chunks, but not all of it is code the first screen runs. Measured per
input from the build's own stats, against a rebuild of the work's base,
`b8d400ac` (2,408,989 bytes there, five fewer than the 2,408,994 recorded when
the work began; nobody has explained the five): `ai-strategy.service.ts` took
939 bytes. A key saved in settings is now a bring-up of its own that a waiting
caller joins (`applyProviderKey`, and the attempt that comes up behind a save
still out for its account), the readiness wait reads the keys once more when
its bring-up's own read failed, and the bring-up answers with that outcome; the
setter nothing called went out. `cloud-llm-provider.service.ts` took 375: the
bring-up guard, the generation a bring-up takes on entry and a reset bumps with
its checks after each await, the outcome that names a failed key read, and the
clear a removed Gemini key, or a model switch with no stored key, now makes.
`gemini.service.ts` took 194, `cloud-llm-provider.base.ts` 130, and
`openai.service.ts` and `claude.service.ts` 110 each, for the arm guard that
stops a provider arm still loading its SDK from applying after a later
reinitialize or a clear (the arm counter and its two methods in the base, a
check after the SDK load and another in the failure branch of each service) and,
in Gemini, for the seam through which it now loads its SDK.
`provider-key.service.ts` took 127: the three checks that the signed-in account
is still the one a read or a write started for, before its keys or its failure
flag are touched. `export.service.ts` itself came to 6 bytes less, but its use
of `categoryNameOrUnknown` gave
`category-display.utils.ts` a second initial importer, so the module was cut out
of the entry chunk into an initial chunk of its own, 132 bytes and the sixtieth
initial file, and the cut costs the export and import lines around it: the
entry chunk fell 90 bytes while the new chunk took 132 and the exporter's
chunk, which it is imported into, 33. The prompt modules that share a chunk
with the providers, and the receipt parser and native receipt service beside
`ai-strategy.service.ts`, moved by one to thirteen bytes each, which is the
minifier renaming around the changed modules. Twelve chunks whose source did not
change moved by one byte each, the new content hashes leaving a chunk file name
they import with a ninth character, as a version bump does (below). The work's
edits to the AI settings page, the transaction filters, the dashboard chart, the
reports, the recurring tab, the import wizard's category suggestions and the
insight cards are in lazy chunks. After that measure (2,410,738 bytes), the four
fixes the work's first browser run made, and the bump to 26.10.177, brought the
figure to 2,410,890. The stylesheet took 156 bytes, the one rule that gives a
floated select label Material's own floated cap; four initial chunks came out
a byte smaller each, for the names their new content hashes import; the other
three fixes, Sync Now's double press, the data page's category catalog and the
compact filter field's resting label, are in lazy chunks. The bump alone moved
nothing: the figure was 2,410,890 before it and after. The second browser
run's fixes then brought it to 2,410,982. The stylesheet took 88 bytes more,
the one rule that lets a Material text-label button grow with a wrapped label
(its `min-height`, its block padding and its line height); the filter grid's
tracks, the preview's date and row, the desktop table's date and the button
rows of `/data` and `/ai` are in lazy chunks; and three initial chunks came
out four bytes heavier between them, for the names their new content hashes
import. The fixes of the whole-branch review then brought it to 2,411,095,
95 bytes over 2.411 MB, so the warning moved once more, to the whole
kilobyte above, 2.412 MB. The chunk that carries `ai-strategy.service.ts`
took 115 bytes: a counter the strategy's signed-out branch bumps on every
run, which a key save, and an attempt queued behind one, is tied to, so
neither brings anything up in a session after the one it started in, and
the outcome a refused save keeps from the bring-up it waited for. Two other
initial chunks came out a byte smaller each, for the names the minifier
gave. The stylesheet did not move, its button rule gaining only a comment;
the busy spinners of the budget dialog and the import wizard and the AI
page's refused clear are in lazy chunks. The review's second pass then
brought it to 2,411,435, 565 bytes under 2.412 MB. The same chunk took 336
bytes more: the hold a key save keeps on a wait, which the account's
leaving releases, and the account an attempt queued behind a save checks
besides the counter. The AI import service's chunk came out 4 bytes
heavier, though nothing in it changed; the AI page's refused typed save is
in a lazy chunk.

The warning before it had gone up, to 2.409 MB, when the work of #490 and #468
put the initial bundle 843 bytes over the 2.408 MB it stood at; it moved to the
whole kilobyte above the figure and no more. That work grew the initial
JavaScript by 1,004 bytes (from 2,376,948) and left the stylesheet alone. All of it lands in
initial chunks, but not all of it is code the first screen runs. Measured per input from the build's
own stats, against the same figures at `697c13ab`: `ai-strategy.service.ts`
took 424 bytes, the wait a queued scan makes for its account's providers to be
up (the memoised bring-up, and the loop that follows a newer one when the
account or the connection changes during the wait). `nl-search.service.ts`, in
the entry chunk because the header reaches the AI search dialog, took 268: a
search or a Refresh reads the category catalog once when the signal is still
empty, and threads that one list through the scope, the names and the roll-up.
`recurring.service.ts` took 206: a rule's day, weekday and month are held to
their ranges wherever the interval already was. `ai-import.service.ts` took
145: a refusal before the import's record opened is told apart from one after
it. `offline-queue-processor.service.ts` took 106: the drain asks the strategy
whether the providers are up, and puts the entry back without spending a retry
when they are not. `ai-models.ts` took 58, for the Claude Sonnet 5.5 entry; its
dated source lines are comments and cost nothing. The import wizard's handling
of both refusals, and the recurring dialog's repair of a day out of range, are
in lazy chunks. The other inputs moved by one to three bytes each, which is the
minifier renaming around the changed modules. The final build adds 152 bytes to
those figures. Sixty are JavaScript in the transaction form's chunk, which is
initial because `quick-add.service.ts` imports the form, where the commit
"fix(ui): a select's empty option shows its own label" lets the period and goal
selects show their *None* option. Sixty-one are stylesheet, from the home-screen
bottom bar's rules in `styles.scss`, which #494 merged into main while this work
was open. The commit "fix(ui): a category the catalog cannot name reads Unknown
in the reader's language", as first committed, came to 18 bytes less with the
renames around it as measured (2,408,965 to 2,408,947), and 17 less against
the 2,408,964 recorded before it; nobody has explained the one byte between the
two baselines. The answer card and the AI search dialog, both in the entry
chunk, shared one copy of the name rule where each had kept its own. The branch
review's fixes after it added 48 bytes of JavaScript, all of it in initial
chunks: the rule moved into core, into a module of its own in the entry chunk,
`core/utils/category-display.utils.ts`, reading `common.unknownCategory`, a
longer key than the one it read before, and the search counting its AI use
only after its catalog reads. The import wizard's and Import
History's fixes, and `CategoryHelperService` and the insight chips, which read
the moved rule, are in lazy chunks.

The warning went back up, to 2.408 MB, when the work of #486, #487 and #488
put the initial bundle 647 bytes over the 2.407 MB it had been lowered to; it
moved to the whole kilobyte above the figure and no more. That work grew the
initial JavaScript by 1,036 bytes (from 2,375,720) and left the stylesheet
alone. All of it lands in initial chunks, but not all of it is code the first
screen runs. `recurring.service.ts` took 502 bytes: the per-rule salt, with the draw that gives a rule one and the
shape check on one a restore hands back, and the lookup a stalled rule makes,
before it posts, for the occurrence its walk is stuck on. `opaque-id.utils.ts`
took 139 (331 to 470): the 128-bit seed generator and its check, which
`recurring.service.ts` and the offline queue now both import instead of the
queue drawing its own. `ai-import.service.ts` shares its initial chunk with
`receipt-attempt.service.ts`, and the chunk took 428: a whole-import failure
now keeps the code it was refused with, and the attempt classifier reads
whether a provider is set (a key check and the two services it injects) before
it files a drain's cloud failure as a network one. `import-review.utils.ts`
took 236 (to 4,681): the reader of a failure's family and its two key tables.
Only the lazy import wizard and Import History call them; they are initial only
because the module's other exports have eager importers (`ai-import.service.ts`,
`duplicate-detection.service.ts`, `receipt-attachment.utils.ts`, the transaction
form). The chunk of `rag-context.service.ts` took 124: the cent-rounded, id-tied
category changes and the id-tied anomaly order of `spending-insight.utils.ts`.
One chunk is new. `errorCode` gained an eager importer, `ai-import.service.ts`,
beside the lazy ones it already had, so `firebase-error.utils.ts` is cut out of
the chunk that held it into an initial chunk of its own, 121 bytes, which also
carries `isRefused`, read only by the lazy household and ledger-share code, the
cut described below for `import-review.utils.ts` and `ai-error.utils.ts`. Two
removals gave some back. The queue drain reads each entry once now:
`offline-queue.service.ts` lost `getQueuedImage`, `getQueuedImageAsFile` and its
private seed draw for the one `queuedImageFile`, which took 315 bytes off the
chunk it shares with the `idb` wrapper, and the processor in the entry chunk
lost two of its three reads and a branch, 199 bytes net. The final build adds
192 bytes to those figures: 118 in the entry chunk, where the commit "fix(ui): the
search history and the search dialog load the category catalog" put the
catalog's subscription (the AI search dialog subscribes it, and the header
reaches the dialog), 72 more there, where the queue drain now waits for the
account's key read before it opens its attempt, so a drain with no key set is
filed as no provider after a cold offline start too, and one byte each in two
lazy-imported initial chunks, which the bump to 26.10.173 renamed through the
lengths of their content hashes, as the bump to 26.10.172 did (below).

The warning had come down from 2.472 MB to 2.408 MB when the
deprecated animations runtime went out: `provideAnimations()`, the
`@angular/platform-browser/animations` wrapper it pulled in and the
`@angular/animations` package behind it were 64,539 bytes of the initial
JavaScript, from 2,471,499 bytes before. The budget gave back 64 kB of that,
rounded down to the whole kilobyte, so the rest is headroom. Material and the
CDK animate with CSS and need none of it, and the specs turn motion off with
`provideNoMotion()` instead.

It came down once more, to 2.407 MB, when the removals of #437 took 1,075
bytes net off the 2,406,960 bytes the animations runtime's removal had left
([ADR 0170](ADR/0170-the-animations-runtime-the-unregistered-worker-and-nine-dead-items-come-out.md)).
The removals were larger than that and some of what came in beside them is
eager: out went the background-sync seam nothing answers (in `PwaService` and
the offline queue), the monthly totals and the category getter of
`TransactionService` that nothing called, and the position, row-number and
free-text fields the import carried and nothing read. In came the shared
category fold, which `cloud-llm-provider.base` now imports from
`transaction-aggregation.utils` (a 2,593-byte initial chunk of its own), and
the opaque row-id helper that `recurring.service` and the offline queue reach
at startup (331 bytes).

That lowering ran ahead of the final figure. It was set when the drop was
1,075 bytes, and the branch's later code took some of it back: the net saving
since the animations runtime's removal is 349 bytes (2,406,960 less
2,406,611), less than the kilobyte the warning was lowered by. Two of the
later additions are pure split points of modules the initial graph already
held. The import history, a lazy chunk, came to import `importFailureKey` from
`import-review.utils.ts` for its error lines, and `parseAIError` with its
codes from `ai-error.utils.ts` to read the classifier's own sentences. A
module with a second, lazy importer is cut out of the chunk that held it into
one of its own, and the cut costs the export and import lines around it.
`import-review.utils.ts` is now a shared initial chunk of 4,445 bytes (+347)
and `ai-error.utils.ts` one of 3,078 bytes (+189). The last addition is not a
split. The offline queue card's count is taken again whenever the signed-in
account changes, so `OfflineQueueService`, an initial service, gained an
effect on the account, a `catch` for the recount's read and the release of
its handle on destroy: +192 bytes (2,406,419 to 2,406,611), 100 of them the
effect and 92 the `catch` and the release.

The warning stands at 2.407 MB, the whole kilobyte above the final build's
2,406,497 bytes: 503 bytes of headroom (2,407,000 less 2,406,497), about the
501 bytes the main branch had under the 2.472 MB warning at `8a6e2c9a`
(2,471,499 bytes). `about.component.ts` and
`feedback.service.ts` import `package.json` whole, but a version string of the
same length adds nothing of its own. The bump from 26.10.171 to 26.10.172 moved
the total from 2,406,421 to 2,406,419 bytes all the same, and all of it in the
entry chunk: the new content hashes left two fewer of the chunk file names it
imports with a ninth character. So a bump can still move the figure by a byte
or two.

The warning had stood at 2.45 MB until household sharing (#465) put the
initial bundle 12.85 kB over it, and moved by that much and no more. It then
moved, from 2.47 MB to 2.472 MB, when the theme, dashboard and
notification work of #436, #440, #442, #446 and #461 put it 1,499 bytes
over. That work grew the initial JavaScript by 5.9 kB and shrank the
stylesheet by 0.9 kB: the theme aliases came in and the palette ramp and
every palette utility went out. The JavaScript is what the first screen now
reaches without a route change: the `categoryGlyph` pipe the eagerly loaded
transaction form uses, `AuthService`'s field-level preference writes and
the re-read every writer merges through, the routes reminders carry and
the arming of the tap service (from an idle task on the web, at once in
the iOS app; the service itself is a dynamic import), the weekly recap's fold that the reminder sweep's nudge gate runs
(`ReminderService` is built at startup), the `?` shortcut and the palette's
inline Shortcuts section, the header's palette button and its one-time
hint, and the install prompt `PwaService` now holds.

The earlier move's space is code the first screen reaches without a route
change:
`FirestoreService`'s batch commit and server aggregate, the Firestore SDK's
`arrayUnion`/`arrayRemove` in the shared chunk, the transaction service's
follow-up that carries a shared row's edit to its copies, and the
transaction form's *Shared with* chips, which QuickAdd loads eagerly. The
service that shares and sweeps is reached by dynamic import, and the ones that
fold household figures load with the household page's own route, so neither
is in it. To re-measure after a change that could move it:

```bash
rm -rf dist && npm run build:analyze
```

Read the `Initial total` line it prints last: the exact bytes, and the
JavaScript and the stylesheet apart. The build's own chunk table rounds each
file to 0.01 kB and the total to 0.01 MB, which is too coarse when the
headroom is under a kilobyte. A budget set from an incremental build is worse
than no budget, hence the `rm -rf`. If a deliberate change moves the number,
move the budget in the same commit and say what bought the space — a budget
quietly raised to fit the app stops being a gate, which is the state this one
was in before it was lowered.

## What fills the initial bundle

`npm run build:analyze` (`scripts/analyze-bundle.mjs`) runs the production
build with `--stats-json`, which makes the builder write
`dist/home-account/stats.json`, and then reads that file. For every initial
output, largest first, it prints the ten inputs that put the most bytes into
it, and then the initial total. So when the figure moves, the line that
moved names the module, where before it meant reading the chunk table and
grepping `dist/` for a symbol, as the `jsPDF` check in ADR 0023 did.

"Initial" is the builder's own rule, mirrored from `@angular/build`: an
output that carries an entry point and is named `main`, `polyfills` or
`styles`, plus everything those reach through static imports, transitively.
A dynamic import is lazy however large its target, and a lazy chunk carries
an entry point too, so the entry point alone decides nothing. The total sums
every initial output's bytes, the stylesheet included, which is the sum the
initial budget is measured against. A metafile the script no longer
understands fails the run rather than printing a total over the wrong files.

Its `--self-test` checks that rule against an inline metafile and runs in
CI. The real run needs a production build, so it is local only
([ADR 0170](ADR/0170-the-animations-runtime-the-unregistered-worker-and-nine-dead-items-come-out.md)).

## Known gaps

- Nothing measures the initial bundle in CI beyond the budget. The budget
  catches growth past a threshold, not a steady creep beneath it, and
  `build:analyze` runs only when someone runs it.
