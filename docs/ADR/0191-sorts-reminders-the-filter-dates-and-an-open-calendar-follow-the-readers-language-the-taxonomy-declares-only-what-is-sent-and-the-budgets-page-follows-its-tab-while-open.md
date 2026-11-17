# 191. Sorts, reminders, the filter dates and an open calendar follow the reader's language, the taxonomy declares only what is sent, and the budgets page follows its tab while open

**Status:** Accepted, implemented · **Date:** 2026-11-17 · **Issues:** #505, #517, #446

Reference documentation lives in [../i18n.md](../i18n.md),
[../locale-formatting.md](../locale-formatting.md),
[../reminders.md](../reminders.md), [../weekly-recap.md](../weekly-recap.md),
[../accessibility.md](../accessibility.md), [../analytics.md](../analytics.md)
and [../e2e.md](../e2e.md).

Three small leftovers, each a place where the app said something it could not
stand behind. [0182](0182-a-control-reads-in-the-accounts-language-and-date-format-and-nothing-re-provides-materials-adapter-or-words.md)
moved the pickers, Material's words and the reports to the reader's language
and left five places out, filed as #505: two sorts that collated by the
device, reminders that kept the language they were booked in, filter dates
that refused text with an outline and no reason, an open calendar that kept
its close button's old words, and an English sort description that was a
fragment. The analytics taxonomy declared two values of `transaction_add` that
no sender produces (#517). And a budget alert's link did nothing on a budgets
page that was already open, the last cheap gap of #446, whose three parts
[0167](0167-a-notification-carries-its-route-and-a-tap-lands-on-it-and-the-recap-nudge-needs-a-week-with-news.md)
and [0168](0168-the-palette-lists-the-shortcuts-and-the-header-opens-it-and-about-offers-to-install-the-app.md)
had already built.

Closes four gaps of [0182](0182-a-control-reads-in-the-accounts-language-and-date-format-and-nothing-re-provides-materials-adapter-or-words.md):
the filter dates that say nothing for unreadable text, the two sorts that
collate without a locale, the reminders that keep the language they were
booked in, and the English sort description that reads as a fragment.

Closes a gap of [0167](0167-a-notification-carries-its-route-and-a-tap-lands-on-it-and-the-recap-nudge-needs-a-week-with-news.md):
the mounted budgets page that keeps its tab.

Narrows one more of 0182's: an open calendar now takes its close button's
words in the new language; its comparison label stays as it opened, and
nothing in the app reads it.

Amends [0185](0185-a-refund-is-asked-about-at-every-door-and-a-category-follows-its-rows-side-there-and-back.md),
which rejected a `transaction_add` from the wizard and left the two values
declared; they are removed. Amends 0182's date-module rule with a third check
of `material:check`.

Applies [0082](0082-one-shot-query-params-leave-the-url-once-consumed.md) and
[0145](0145-a-class-found-by-reading-becomes-a-gate.md).

## Context

**Collation.** `localeCompare` with no locale orders by the device's language.
The transaction list's description sort and the category chip's menu both
called it bare, so a list an account reads in Japanese on a phone set to
English was ordered as English orders it. `LocaleFormatService` already holds
the account's Intl locale and caches a formatter per locale; it had no
collator.

**Reminders.** A reminder is booked with the words of the moment
(`reminder.service.ts`), under a key that names the rule, the day and the lead
and not the language. The sent log spares a booked key from being scheduled
again, which is what stops a budget alert from being raised on every change
detection. So a reminder booked in English stayed English.

A cold start loads two catalogs: the device's language first, then the
account's, once the account document has been read. On a phone whose language
is not the account's, every start therefore looks like a change of language.

**Filter dates.** The filters' compact grid hides Material's subscript
(`.compact-field .mat-mdc-form-field-subscript-wrapper { display: none }`), so
a From or To holding text that is no date showed the error outline alone.

**An open calendar.** `MatDatepickerContent` copies `closeCalendarLabel` in its
constructor, and `MatCalendarBody` copies `comparisonDateLabel` as a field
initializer. Neither listens to `MatDatepickerIntl.changes`; the toggle and the
header do.

**The sort description.** `transactions.sortBy` is each sortable header's
`sortActionDescription`, read after the header's own name: *Date, Sort by*.

**The taxonomy.** `analytics:check` held events and parameter names to the
code and the doc, and said in its own header that it could not see values. The
doc and three comments said the compiler covered them. It does not: the
taxonomy is JSON, a JSON array is read as `string[]`, and a probe that
assigned an undeclared value to the wrapper's parameter compiled.

**The budgets tab.** The page read `?tab=` once, from the route snapshot, and
bound the strip one way. After a reader chose another tab the field still
held the tab the last link named.

## Decision

### One collator, the account's

`LocaleFormatService.compare(a, b)` orders two strings with an
`Intl.Collator` for the account's locale, cached per locale like the
formatters. Both sorts use it. It reads the locale signal, so the list's
computed re-sorts on a switch with no second click on the header. The other
bare `localeCompare` calls in the app compare ids and keys and are left.

### Reminders are re-booked against a recorded language

The device records, per account, the language its pending reminders were
booked in (`home-account.reminders.language.<uid>`, beside the sent log and
cleared with it). When the catalog in use becomes the account's own and
differs from the record, a sweep runs, and on a whole sweep the delivery books
again every reminder that still has a moment ahead of it. The id is the key's,
so the operating system replaces the pending one. Nothing is cancelled and
nothing forgotten.

- **Only what is ahead.** A bill due today and a budget alert have no
  `schedule.at`. They were raised when they were due and are not raised twice.
- **Only once the account's own catalog is the one loaded.** The comparison is
  between the record and the account's language, and it waits until the
  catalog in use is that language's. The device's language at start is no
  change.
- **A booking ahead records its own words.** One made before the account's
  catalog arrived records the device's language, which is what makes the next
  catalog load re-book it.
- **The record is written after the operating system takes the booking**, so a
  refusal leaves the old language on record and the next sweep tries again.
- **Native only.** The web raises a reminder while the page is open and books
  nothing ahead.

### The filter dates are described

Each input carries `aria-describedby` to an off-screen text of its own, which
reads `datepicker.dateInvalid` while the field is touched and holds a parse
error, and is empty otherwise. It is bound through `MatInput`'s own
`aria-describedby` input, which the form field merges with its other ids; the
attribute bound directly would be overwritten. The text appears when the
outline does, once the reader has left the field, and is polite.

### An open calendar is relabelled in place

`RelabelOpenCalendarDirective`, whose selector is `mat-datepicker`, listens to
`MatDatepickerIntl.changes` and, where its calendar is open, writes the new
`closeCalendarLabel` into the calendar's component and asks the picker to
redraw (`stateChanges`, which the content already redraws on). The open
calendar's component is read from `_componentRef`, private in Material's
types. A spec opens a calendar and looks for it there, so a Material upgrade
that moves it fails that spec.

A standalone directive matches only in a component that imports it, and a
host that forgets fails in silence. `material:check` gains a third rule: a
component whose template declares a `<mat-datepicker>` lists the directive in
its `imports`. Ten do.

### The sort description is a sentence

The key keeps its name and its three bindings: *Sort the list by this
column*, *この列で一覧を並べ替えます*, *依此欄排序清單*.

### The taxonomy declares only values a sender writes

`ai_import` and `mixed` are removed from `transaction_add`. The wizard's
confirm reports through `receipt_confirm` (0185), and a second event for the
same act would count it twice.

`analytics:check` gains `valueProblems`: every declared value must appear as a
quoted literal in a non-spec `.ts` file under `src/app`, comments blanked, the
service's own files and the taxonomy skipped. A parameter whose values are all
`true`/`false` or all digits is exempt, since the wrapper fills it from a
boolean or a number. It fails naming the event, the parameter and the value.

The comments and the doc now say what holds what: the compiler the event and
parameter names, the runtime check the values, the registry check that every
declared value is written somewhere.

### The budgets page follows a tab link while open

The page subscribes to the route's `queryParamMap`. A `tab` it names is
selected, on the field and on the strip itself, and then taken off the URL
with `replaceUrl` (0082), as the dashboard takes a reminder's `bill` and
`recap`. The strip reports its own changes back (`selectedIndexChange`).

Setting the strip directly is not belt and braces. The binding writes only a
value that differs from the last one it wrote, and the strip reports a chosen
tab a turn after it moves; a link arriving inside that turn found the field
unchanged and the binding wrote nothing.

## What was rejected

- **Closing and reopening the calendar.** It would rebuild the content with
  the new label. `open()` returns early for the length of the exit animation,
  so a synchronous close and open does nothing, and passes in a spec with
  motion off; done properly it loses the month the reader had moved to and
  announces the dialog again.
- **Skipping the first catalog load** to tell a change of language from a
  start. A phone in another language than its account's re-books on every
  start, and a switch made on another device is never seen.
- **Bypassing the sent log for every reminder** on a change of language. The
  budget effect already re-runs on a catalog load; the log is the only thing
  that keeps its alerts from being raised again.
- **A language in the reminder's key.** The id would change, so the old
  notification would have to be found and cancelled, and the log pruned.
- **A subscript for the filter dates.** There is no room in the grid, which is
  why it was hidden.
- **Reading the description while the reader types.** Every first keystroke of
  a date is text that is no date.
- **Looking for a value only in its sender's files.** `receipt_import`,
  `receipt_confirm` and `budget_exceeded_viewed` are handed values a helper or
  a model file wrote; every one would fail.
- **Narrowing the wrappers' types** so the compiler would hold the values.
  A JSON import cannot be read `as const`, and a second, typed copy of the
  taxonomy is what the JSON exists to avoid (the script reads it with
  `JSON.parse`).
- **Sending `transaction_add` from the wizard** with `ai_import` and `mixed`,
  as #517 offers. 0185 rejected it.
- **Leaving `tab` on the URL** and following it only when it changes. The
  router ignores a navigation to the URL it is on, so the second tap on one
  alert would do nothing.
- **Rebuilding #446.** PR #480 shipped its three parts; the issue stayed open
  on a `Refs`.

## Consequences

- The description sort and the chip's menu order as the account's language
  orders. An account in Traditional Chinese sees Han text before Latin and by
  stroke; one in Japanese sees it after, by reading.
- A bill reminder or the Monday nudge booked ahead reads the account's
  language after a switch, from the next time the app is open on that device.
- **One extra sweep** on a device whose pending reminders were booked by an
  earlier build, which kept no record: the first start books what is ahead
  again, in the same words.
- A screen reader hears *Enter a valid date.* on a filter date it leaves
  holding text that is no date.
- A calendar open across a change of language says *Close calendar* in the
  new one; it stays open, on its month.
- A sortable header is described by a sentence.
- GA4's `method` and `type` dimensions stop advertising two values that never
  arrive. A value declared for a sender nobody wrote now fails the check.
- A budget alert tapped on the budgets page switches to Budgets, twice if
  tapped twice. **`/budgets?tab=…` no longer stays in the address bar**, so a
  reload opens on the first tab, as a reload after a tab click always did.
- Ten components gain an import, and `material:check` a rule.

## What the browser runs found

### Run 1, on 17 November 2026

The same session as [0190](0190-a-review-sentence-names-where-its-grade-came-from-and-quotes-a-percentage-only-where-a-model-reported-one.md)'s:
emulators only, as Alex, at the pane's 1024px and read at 375px, in English,
Japanese and Traditional Chinese, served from this branch's checkout, the
bundle naming `demo-home-account` alone and the console holding the venue's
one 400. Journey 120 is that run. The pane was hidden. The sort header, the
filters' toggle, the From field's typing and its Tab, the calendar's toggle
and the Goals tab were real presses and keys; the language was switched
through the page's own write of the account's preference, since the calendar
is a modal and the account document is read once.

- With three imported rows, *apple*, *家賃* and *東京*, the description sort in
  Japanese put *apple* third of 67 and ended *家賃*, *東京*; switched to
  Traditional Chinese with the sort standing it began *東京*, *家賃* and put the
  Latin rows after, with no second click; English put them back.
- The header was described by *この列で一覧を並べ替えます*, *依此欄排序清單* and *Sort
  the list by this column*.
- *next tuesday* typed into From described nothing while the field had focus;
  after Tab the field carried the error outline and was described by *Enter a
  valid date.*, To by nothing, and nothing moved. At 375px the same, with no
  sideways scroll.
- With To's calendar open, a switch to Japanese renamed its close button
  *カレンダーを閉じる* and its header *2026年11月*, to Traditional Chinese
  *關閉日曆*, and back: one calendar throughout, the same button, still open.
- On `/budgets`, with Goals chosen, the message a notification tap sends the
  page (`notification-route`, `/budgets?tab=budgets`) selected Budgets and
  left the address `/budgets`; chosen and sent again, it did so again.

**Found:** nothing in the app. One reading looked like a defect and was the
venue's: at 375px a load of `/budgets?tab=goals` left Goals cut at the strip's
edge. Main's own page read the same. The strip's late-label follow is a
`ResizeObserver`, and a hidden pane paints no frame: a probe observer on the
same elements received no report at all, and `requestAnimationFrame` never
ran. A link followed while the page was open, which reveals the tab on the
selection and needs no frame, left Goals whole.

Three rows were imported for the sort, and the language switched and put back.
The run did not switch to the dark theme.

## Departures from the issues

- **#505's reminder check was not made on a simulator.** The acceptance asks
  for the notification centre. A simulator build signs in to the real account,
  and the check would switch that account's language; it is held by the unit
  cases and an emulator case that books from stored rules.
- **#505's calendar is relabelled, not "on `changes`" alone.** The issue
  proposes relabelling on `changes`; Material's content does not listen, so a
  directive does it.
- **Only the close label.** The issue names the comparison label too. The app
  declares no range picker, and nothing reads that label.
- **#517's check looks anywhere under `src/app`**, not at "a sender". The
  issue asks for a declared value no sender can produce; the check holds the
  weaker and decidable form, that some code writes it.
- **#446 is closed without a device run of the tap.** Its tap listener has
  unit cases; the browser run sent the worker's message to the page.
- **The `tab` parameter leaves the URL**, which no issue asks for.
- **A rule nobody asked for**: `material:check`'s third.

## Things that only became apparent while building

- The link to the budgets tab passed its spec and failed in the app's own
  smoke walk, where the link followed the click with no turn between. The
  strip had moved and had not yet said so.
- The budget effect was already re-running on every catalog load. Only the
  sent log kept it quiet, which ruled out the obvious fix.
- A first reminder booked under the device's catalog would have been recorded
  as the account's language and never corrected. Recording the words a
  booking was made in, whoever's they are, is what catches it.
- The compiler claim was in three comments and a doc, each citing the others.
- A calendar's close and reopen is a no-op for two hundred milliseconds, and
  silent about it.
- The transaction list renders as cards at the smoke harness's width, so its
  sort has no header there. The collation is held by the list's spec and the
  browser journey.
- A hidden pane paints no frame, so anything that waits on a
  `ResizeObserver` reads as broken there.

## Known gaps

### Reminders

- **A reminder due the same morning keeps the old language.** On its day a
  bill is produced with no `schedule.at`, so a 09:00 notification still
  pending when the language changes that morning is not booked again.
- **A switch made on another device arrives at the next start.** The account
  document is read once, at sign-in.
- **Nothing was read on a device.** The re-booking is proved against the
  plugin's stand-in, from stored rules in the emulator.
- **The web has nothing to re-book**, and a web reminder raised in the old
  language stays as it was shown.

### The calendar

- **The comparison label stays in the language the calendar opened in.**
  Nothing in the app reads it. A range picker would.
- **The directive reads a private field of Material's.** Its spec fails if the
  field moves; nothing fails if Material starts listening for itself and the
  directive becomes redundant, except the pin that a host without it keeps the
  old label.
- **A calendar created in code, or declared in a template another component
  projects, is not seen by the rule.** There is none.

### The taxonomy

- **A common word always passes.** `none`, `one` or `error` is written by
  some file whether or not the event's sender can produce it. Many
  declared values are written in exactly one file, so the check is thin and
  true.
- **Only `.ts` files are read**, the non-spec `testing/` helpers among them.
- **The doc's value cells are still not compared** with the taxonomy.
- **No type holds a value.** The runtime check is the only thing between a
  call site and an undeclared one.

### The rest

- **The filter dates' stale parse error across a switch** (0182) stands.
- **The sort is not walked by a smoke case** (above).
- **`/reports?tab=` keeps its parameter and is read once**, as the budgets
  page was. No notification links there.
- **#446's other gaps stand**: a web tap in the first idle window after load
  only focuses the tab, a week that gains news after the last sweep is not
  nudged, and no shortcut can be rebound.
