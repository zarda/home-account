# 165. The period pickers are bounded, unavailable totals offer Retry, and three smaller papercuts close

**Status:** Accepted, implemented · **Date:** 2026-10-08 · **Issues:** #440

Reference documentation lives in [../period-totals.md](../period-totals.md),
[../forecast.md](../forecast.md), [../share-import.md](../share-import.md),
[../weekly-recap.md](../weekly-recap.md),
[../accessibility.md](../accessibility.md),
[../translation-lens.md](../translation-lens.md),
[../receipt-import.md](../receipt-import.md),
[../import-fields.md](../import-fields.md) and
[../one-shot-reads.md](../one-shot-reads.md).

Closes one *Known gap* in each of seven records:
[0054](0054-a-forecast-tick-spans-a-fixed-duration.md)'s year picker with
no `min` or `max`;
[0055](0055-the-active-route-is-announced-not-only-coloured.md)'s two
navigation landmarks that a landmark list cannot tell apart;
[0061](0061-a-period-total-is-swept-exact-or-shown-absent.md)'s
`unavailable` totals with no inline retry;
[0082](0082-one-shot-query-params-leave-the-url-once-consumed.md)'s
`?source=share` left on the import wizard's URL;
[0095](0095-a-translation-is-a-lens-never-a-write.md)'s disabled Translate
outside the tab order;
[0096](0096-the-weekly-recap-is-composed-on-open-and-nudged-ahead.md)'s
zero bills due in the income colour; and
[0099](0099-the-review-step-edits-what-it-shows.md)'s Change button that
opens a dialog without saying so. Closes the landmark gap in
[../accessibility.md](../accessibility.md) too. Leaves the gap in
[0039](0039-a-share-arrives-typed-and-the-stash-answers-to-its-owner.md)
standing: a worker pinned at an older stash version still loses the share
it was handed, but the wizard now says so.

## Context

Each of those records shipped its decision and wrote down a small defect it
had left behind. Each fix was a line or two, and no issue tracked any of
them. #440 collected five. At `c47d6f26`:

- **P1.** The period selector's hidden month and year inputs bound no
  `[min]` or `[max]`, so a period could open centuries away. 0054 bounded
  the forecast chart's points, not the picker, and its ladder stops holding
  its ceiling past about two hundred years.
- **P2.** An `unavailable` period total rendered *Totals unavailable* and
  nothing to press, on desktop and on the phone, while `over-cap` had its
  *Calculate totals* button. Only a filter change or a mutation tried again.
- **P3.** The import wizard read `?source=share` from the route snapshot
  and left it on the URL. A reload or Back entered the share path again,
  against a stash already drained. The wizard never read the `&error=1` the
  share-target worker adds when it cannot stash a POST, so a lost share
  opened an empty wizard and nothing said why.
- **P4.** The weekly recap's bills line bound
  `billsDueNet() >= 0 ? 'income' : 'expense'`, so an empty week's `0` was
  income green.
- **P5.** The sidebar's `<nav>` and the bottom nav's carried no name. Each
  was announced only as *navigation*, so a landmark list could not tell
  them apart. The import review's date question opened the date picker
  from its Change button with no `aria-haspopup`, though the date button
  beside the row had one. The note lens's Translate was natively `disabled`
  while no provider was configured, so it left the tab order, and the hint
  saying why was reached only by reading on past it. The receipt viewer
  held its Translate and its Retry the same way.

## Decision

**Each gap is fixed where its record left it. The month and year pickers
run from the month of the account's oldest row, never later than the
current month, to 31 December next year. An unavailable total offers Retry.
The wizard takes the share flags off its URL and says when a share was
lost. A net that rounds to zero is neutral. The two navigation landmarks
are named, the Change button announces its dialog, and a lens's held
buttons stay in the tab order.**

### P1: the pickers stop at the account's history and at next year

`pickerBounds(earliest, now)` in `transaction-date.utils.ts` gives both
hidden datepicker inputs their `[min]` and `[max]`:

- the max is `yearWindow(now.getFullYear() + 1).end`, the last millisecond
  of 31 December next year;
- the min is the first day of the oldest row's month, built from local
  parts;
- the min never passes the first day of the current month.

When every row is dated ahead, the This Month and This Year toggles still
reach the current period, so the pickers offer it too. The same clamp keeps
the floor under the cap.

`TransactionService.getEarliestTransactionDateFromServer()` supplies the
floor. It is `getCollectionFromServer` over the account's transactions,
ordered by `date` ascending, with a limit of one. It is a server read
because a warm cache's oldest row is only the oldest of the windows this
session browsed, and a floor taken from it would disable every month before
them. Offline it rejects
([../one-shot-reads.md](../one-shot-reads.md)).

Three hosts read it once, on init, and pass it down as a `floor` input. The
dashboard and the reports pass it to `PeriodSelectorComponent`. The
transactions page passes it to `TransactionFiltersComponent`, whose own
month and year pickers had the same defect. Each host's `pickerFloor`
signal:

- holds the oldest row's date;
- is 1 January of the current year when the account has no rows;
- stays null when the read rejects, so the pickers get the cap and no
  floor, rather than a floor from a partial cache.

The household page binds no floor. Its period spans the members' records,
so no one account's oldest row bounds it, and it gets the cap alone.

### P2: Retry on unavailable totals

`PeriodTotalsService.retry()` recounts under the current filters, through
the same `recompute` a mutation's `refresh()` runs.

- It resolves false and reads nothing unless the status is `unavailable`.
- It keeps an over-cap consent already given, so Calculate, then a failed
  refresh, then Retry sweeps rather than asking again.
- It resolves true once its recount settles, whether ready, over-cap or
  unavailable again, and false when a newer reset, refresh or calculate
  has superseded it.

Both placements render Retry beside the note, labelled `common.retry`. On
desktop it is a `mat-button`. On the phone it is a button in the subtitle
line, drawn as a link like *Calculate totals*.

`TransactionsComponent.onRetryTotals()` then works in three steps:

1. It does nothing on false. It also does nothing when the page went while
   the recount was out, because a render hook registered on a destroyed
   injector throws NG0911.
2. It announces the settled line in `'replace'` mode, the contract the
   reset and Calculate already keep.
3. After the next render it moves focus to the totals line:
   `.period-totals-slot` on desktop, `.period-totals-line` on the phone,
   both `tabindex="-1"`. The pressed Retry leaves with the state it sat in,
   so focus would otherwise drop to the document. Focus moves only when it
   has dropped there, the rule `focusWhenRendered` in `household-focus.ts`
   keeps, so a viewer who moved on meanwhile stays where they went.

### P3: the wizard takes the share flags off its URL

On `?source=share`, `ImportWizardComponent.ngOnInit` reads `error` too:

1. With `error=1` it raises `import.shareLost` (*The shared files couldn't
   be received. Share them again to import them.*) through
   `NotificationService`.
2. It strips both params, navigating with `queryParamsHandling: 'merge'`
   and `replaceUrl: true`, the shape 0082 gave the transactions page.
3. It still drains the stash, since an earlier share may be waiting.

A rejected `consumeAll()` is caught and raises the same notice, unless the
`error=1` notice already went up. The files never reach the picker, so to
the user it is the same lost share. A visit without the flag neither
navigates nor notifies.

### P4: an empty week's bills are neither income nor expense

The recap's bills line and the Upcoming card's net footer each snap their
net with `snapDisplayZero` at the base currency's precision
(`billsDueDisplay`, `netDisplay`), and bind the snapped value to both
`[amount]` and `[type]`:

- above zero, the tone is income;
- below zero, the tone is expense;
- at zero, the tone is `neutral` and the figure is unsigned.

A net that rounds to zero at the currency's precision, under half its
smallest unit (JPY −0.4 say), snaps to that neutral zero rather than
painting a signed expense. JPY −0.6 keeps its value and shows as −¥1 in
the expense tone. The raw `billsDueNet` and `net` are unchanged.

### P5: named landmarks, an announced dialog, held buttons that stay reachable

- **Landmarks.** The sidebar's `nav` is named *Main* (`nav.landmarkMain`),
  through a `computed` over `TranslationService.t`, the way its links are
  labelled. The bottom nav's is *Quick access* (`nav.landmarkQuick`). Both
  names are short, because a screen reader says *navigation* after them.
- **The Change button.** The date question's Change button
  (`.date-check .extra-change`) carries `aria-haspopup="dialog"`, as the
  date button already did. The picker opens as a `touchUi` dialog.
- **Held buttons.** In both lenses, Translate and Retry are
  `[disabled]="!available()" disabledInteractive`. While no provider can
  answer, `aria-describedby` points them at the hint. Material then renders
  `aria-disabled="true"` and no native `disabled`, so the button stays in
  the tab order and is announced with its reason.
- **The hint.** Each lens's hint takes an id from a module sequence
  (`note-translation-hint-N`, `receipt-translation-hint-N`), so two lenses
  in one document never share an id. The hint also renders in the error
  branch now, so Retry has something to point at.
- **The handlers.** `translateNote()` and `translateReceipt()` return early
  while no provider can answer.

## What was rejected

- **A floor clamped only to the cap.** The first version of `pickerBounds`
  kept the floor at or under the cap's month. An account whose oldest row
  was dated ahead, in March next year say, then had both pickers refuse the
  current month and year, which the toggles still reach. Clamping to the
  current month keeps the current period on offer, and min ≤ max follows.
- **A floor from the cache.** `getCollection` would answer offline, but
  from whatever windows the session had browsed. The pickers would then
  refuse months that hold rows, with nothing on screen to say so. No floor
  is the honest offline answer.
- **0082's helper for the wizard.** The wizard strips its flags in a method
  of its own (`stripShareParams`), in 0082's shape. 0082 kept its helper on
  the transactions page because the two pages share no code, and that has
  not changed.
- **A silent catch on the drain.** Swallowing a `consumeAll()` rejection
  without a word repeats the defect P3 is about: a share that never arrives,
  in a wizard that says nothing.
- **Dropping `disabled` for a hand-set `aria-disabled`.** The button would
  lose Material's disabled styling (`mat-mdc-button-disabled`).
  `disabledInteractive` keeps the styling and leaves the native attribute
  off.

## Consequences

- **One more server read per visit** to the dashboard, the reports and the
  transactions page: a query for one row, made once per page instance.
- **An offline visit offers every year up to the cap**, as does a visit
  whose read fails. The household page always does. An empty account's
  pickers start at January of the current year.
- **A reload or Back no longer re-enters the share path.** The wizard's URL
  settles on `/import/file` once the flags are read.
- **New i18n keys** in en, ja and tc: `import.shareLost`, `nav.landmarkMain`
  and `nav.landmarkQuick`. Retry reuses `common.retry`.
- **No deploy.** No rules, index or function changes. The oldest-row query
  runs on Firestore's automatic single-field index on `date`, since
  `firestore.indexes.json` has no field overrides.

## Departures from the issue

- **P1 is wider than the year picker.** The month picker is bounded too,
  and so is a third host, the transaction filters. The floor is a month
  rather than a year, which is stricter than the issue asked. The clamp to
  the current month departs the other way: when every row is dated after
  the current month, the pickers still offer the current month and year.
  When the oldest row falls in a later year, that is a year the issue's
  floor would refuse. Otherwise the year view refuses every year before
  the oldest row's (`period-selector.component.spec.ts`,
  "disables the years before the floor and offers none past next year").
- **P2 does more than re-read.** The issue asked for a click that re-reads.
  Retry also announces the settled line, moves focus to it, and keeps an
  over-cap consent.
- **P3 also says when a share was lost.** The issue asked only for
  `replaceUrl` after the flag is consumed. The wizard also reads `error=1`,
  and a stash it cannot read raises the same notice once. The strip runs
  when the flag is read, before the drain settles.
- **P4 reaches the Upcoming card's footer**, which bound
  `net() >= 0 ? 'income' : 'expense'`, the same defect.
- **P5 holds the receipt viewer's Translate and Retry, and the note lens's
  Retry, the same way as the note lens's Translate.** The issue asked for
  the smoke shell spec to assert the attributes. `app.smoke.spec.ts`
  asserts the landmarks. The walkthrough never opens the import review or a
  lens, so the popup and the held buttons are asserted in their own smoke
  specs: `import-wizard.smoke.spec.ts`, `note-translation.smoke.spec.ts`
  and `receipt-viewer.smoke.spec.ts`.

## Things that only became apparent while building

- **The oldest row can be dated ahead.** A floor taken from it would grey
  out the current period. The clamp to the current month came from review,
  not from the issue.
- **The transaction filters have month and year pickers of their own**,
  with no bounds. The issue named only the period selector.
- **The desktop had no totals line to land focus on.** Each state rendered
  straight into the actions row. A `.period-totals-slot` wrapper now holds
  every state but hidden, as the one flex item beside the add button.
- **The phone's inline links were too small to tap.** In the browser, the
  inline Retry measured 31 × 21 px. *Calculate totals* is a link of the
  same kind, and its box had been the text's since it shipped. Each now
  reaches the 40px floor through an `::after` overhang, without growing the
  line ([../ui-overflow.md](../ui-overflow.md)).
- **A failed drain was never caught.** The old intake discarded the promise
  with `void`, so a `consumeAll()` rejection went unhandled.
- **Material lets a `<button>`'s click through `disabledInteractive`.**
  Only an anchor's click is halted (`MatButtonBase._setupAsAnchor`,
  `@angular/material` 22.1.4). So each lens's handler refuses on its own,
  and the specs press the held button and assert that nothing is asked.
- **The note lens's Retry was never disabled at all.** Once the handler
  refused, a Retry pressed with the provider gone while a failure showed did
  nothing and said nothing. It is held now, as the receipt viewer's was.
- **A net under half a unit was signed.** The Upcoming footer painted
  JPY −0.4 as a signed expense, so the snap comes before the tone.

## Known gaps

- **The transaction filters' day picker is unbounded**, and its calendar
  pages to any year. Only the month and year pickers were bounded.
- **The floor is read once per page.** A row added on the transactions page
  with a date before the floor, through the form that opens over it, is out
  of reach of the filters' month and year pickers until the page is opened
  again.
- **The floor follows the oldest row wherever it is.** The transaction
  form's date takes any year. A row typed centuries back takes the floor
  with it, and past about two hundred years the forecast's top rung stops
  holding its ceiling again (0054).
- **Without a floor, the year picker is unbounded below.** Offline, or
  after a failed read of the oldest row, the pickers get the cap alone, and
  the year view pages back to any year. A period picked centuries back on
  the reports then reopens 0054's gap on the Forecast tab: past about two
  hundred years the top rung stops holding its ceiling. The floor is read
  once, on init, so it stays missing until the page is opened again
  online.
- **The cap is read when the floor lands.** `bounds` is a `computed` over
  `floor()` that reads the clock, so a page left open across New Year keeps
  last year's cap until it is opened again.
- **Calculate still drops focus.** Retry moves focus to the totals line.
  The Calculate button leaves with the over-cap state, and focus falls to
  the document. `onCalculateTotals` does not check that the page is still
  there either, so a sweep that lands after the page has gone still
  announces. It registers no render hook, so nothing throws.
- **The share flag can come back.** This is read from the code, not driven.
  On a cold load, `ShareIntakeService`'s sign-in effect counts the stash and
  navigates to `/import/file?source=share` when the stash holds rows. That
  count can resolve after the wizard has drained the stash and stripped the
  URL. The wizard is reused for a change of query params alone, so nothing
  strips the flag again, and the next reload drains an empty stash.
- **That navigation can drop the lost-share notice.** It passes no
  `queryParamsHandling`, so when it replaces the worker's redirect it drops
  `error=1`. A share lost beside an earlier one still waiting then brings no
  notice.
- **The landmark smoke reads keys, not words.** The walkthrough serves no
  i18n, so "no two share a name" proves two different keys, not two
  different strings. The catalogs are held by `i18n:check` and the unit
  specs.
- **The landmark smoke assumes a tablet-width frame.**
  `expectLandmarksNamed` opens the overlay drawer, which exists only below
  the desktop breakpoint. In a desktop-width Karma frame it would time out,
  failing rather than passing.
