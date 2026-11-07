# 187. Repeated controls name their item, the upload area has one button and numbers photos among photos, resting text is a token, sentences end in the reader's stop, and a spec that expects nothing fails

**Status:** Accepted, implemented · **Date:** 2026-11-05 · **Issues:** #531,
#532, #533, #534, #536, #537

Reference documentation lives in [../accessibility.md](../accessibility.md),
[../i18n.md](../i18n.md), [../testing.md](../testing.md),
[../emulator-blind-spots.md](../emulator-blind-spots.md),
[../receipt-import.md](../receipt-import.md),
[../import-fields.md](../import-fields.md),
[../share-import.md](../share-import.md), [../recurring.md](../recurring.md),
[../translation-lens.md](../translation-lens.md),
[../onboarding.md](../onboarding.md), [../ui-overflow.md](../ui-overflow.md),
[../performance.md](../performance.md) and [../e2e.md](../e2e.md).

Closes seven gaps of
[0186](0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md),
one of [0099](0099-the-review-step-edits-what-it-shows.md) and one of
[0140](0140-the-tab-strips-scroll-natively-and-a-layout-holds-at-the-scale-and-the-width-that-broke-it.md).

The seven are bullets of 0186's *The upload area, the review card and their
gates*: the per-item controls the sixth rule of `icon-labels:check` froze,
with the goal card's pair it could not see; the two toggles its eighth rule
froze; Sign out with no name below 480px; `joinSentences`'s Latin stop in ja
and tc; the two places no axe pass swept; the mixed pick's badges and arrows,
which counted every file; and the eleven resting fades. 0099's is that same
stop, recorded when it reached the review card's and the form's tooltips. Of
0186's *Neither of those two classes is a gate*, the fade half goes: a
resting fade fails `opacity:check`. A control's only name taken out under a
media query is still read by no gate. 0140's is *The reveal can scroll the
page*: a tab strip brought its tab into view with `scrollIntoView`, which
moves every scroller round the strip as well. The second browser run found
the strip's landing tab cut by a late count, and the reveal that now follows
it writes the strip's own `scrollLeft` and nothing else (*Run 2, on 5
November 2026*).

Amends
[0186](0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md),
[0088](0088-the-smoke-harness-owns-the-noise-it-makes.md) and
[0100](0100-a-receipt-dated-before-today-is-a-question-the-reviewer-answers.md).
Their rules stand: a button in the upload area names its file by its place,
the number its badge shows, and its name; a spec file that needs
AngularFire's silence calls the helper for itself, at module scope; and a
receipt dated before today is a question the reviewer answers. What changes
in 0186 is what the place counts. A photo is numbered among the photos alone,
so after a CSV the first photo's remove button reads *Remove photo 1
(image.jpg)* where it read *Remove file 2 (image.jpg)*; a file that is not a
photo is numbered among the files that are not, so two CSVs of one name stay
apart. What changes in 0088 is who needs the helper. It names the smoke files
that import `@angular/fire`; a unit spec that reaches a zone-wrapped call
outside any injector needs it too, and ten do, nine of them new (*A spec that
expects nothing fails…*, item 5). What changes in 0100 is the tooltip its
question chip's Keep half shared with the date button's flag. The flag still
shows the reason alone. Keep shows the button's whole name, so a screen
reader hears the reason once (*Run 2, on 5 November 2026*), and that name now
opens with the question the chip shows and then gives the reason, so a
speech-input user can say the words on the chip (*Run 3, on 6 November
2026*).

Applies [0008](0008-universal-receipt-language-support.md),
[0036](0036-a-user-facing-string-lives-in-the-catalog.md),
[0123](0123-the-unit-sweep-is-silent-on-a-normal-path.md),
[0144](0144-a-blanked-template-is-paired-with-a-describe-that-renders-it.md),
[0145](0145-a-class-found-by-reading-becomes-a-gate.md),
[0151](0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)
and [0171](0171-second-copies-fold-into-one-copy-of-each-helper.md). The stop
that joins two sentences is the reader's catalog's, and the check that guards
the join reads two marks, never a word (0008). So are the quotation marks a
name puts round a description, `common.quotedName`, which only tc writes, so
tc quotes a description and never the stand-in for a missing one.
Thirty-seven new keys land in en, ja and tc, each catalog in its own idiom;
six are reworded in place, five of them to take their item, and nine more in
tc alone, which drop their own quotation marks; ten retire with their last
reader (0036). A passing run says only what it means: a spec that sets no
expectation fails rather than passing with a line in the log, and neither the
advisory nor the icon's 404 prints (0123). The new names are pinned in
describes that render the real templates (0144). Six classes become gate
rules: a ternary between two bare keys and a control its parent stamps once
per item, in the sixth rule; a sentence joined in code with a literal stop,
and a translated slot filled with a raw description, in `i18n:check`; a
resting fade, in the new `opacity:check`; and a list tracked by a photo's
preview, in the lint rule that already banned tracking by a file's name
(0145). The upload area takes the transaction row's shape, a frame that
answers a pointer around the one button the keyboard reaches, with the ring
drawn on the frame; and both accessibility freezes end empty (0151). One copy
each (0171): the catalog walk, which the service and the specs' translator
share; the stylesheets' visually hidden clip, for Sign out, the wizard's step
labels, the stat card, the transaction list's select header and the
onboarding dialog's step sentence; the frame's ring, for the upload area, the
transaction row and the filter panel's two text boxes; a transaction's
display name, its quoted form, and the test for one with no description, for
every control and dialog that names one; the test for focus fallen to the
page, which the household and transactions pages and the dialog options
share; and, in the import area, the sentence join and the focus helper,
which the filter panel reaches too.

Every control repeated once per item now names its item: the 28 per-item
controls the sixth rule had frozen, the two pin buttons it could not read,
and the goal card's Edit and Delete, which no rule saw. The budget form's
alert slider and the AI page's Auto sync switch are named by the words beside
them, and Settings' Sign out keeps its name at phone width. The empty upload
area is one control, Browse, which the hint describes; a click anywhere else
on the empty zone still opens the picker, once, and a key pressed on Browse
opens it once. In a pick that mixes photos and a CSV, a photo is numbered,
moved and named among the photos, and a file that is not a photo keeps its
place. The eleven resting fades rest in `--text-muted`. Two sentences join in
the reader's own stop, a `。` in ja and tc. A spec that sets no expectation
fails, the two smoke cases that set none expect what they wait for,
`test:dates` prints no AngularFire advisory, and Karma serves the app's
icons; the fonts stay unserved, by decision.

The first browser run met five defects older than this wave, and each is fixed
here with a spec: the transaction filters' toggle was named only by its badge's
count and never said whether the filters were open; keyboard focus fell to
the page when a move landed a photo at either end of the list; the budget
dialog's start date label ran under its calendar button at 375px; and two
hints were wider than their boxes, the review card's split amount and the
filter panel's Tags field, whose hint the transaction form's Tags field
shared and, measured, could not fit either. Its sweep also found a mixed
pick's photo previews headed a level too deep. Reading met four more: the
transaction form tracked its queued photos by their preview, so one picture
picked twice gave two rows one key; the Data page's backup upload area asked
its input twice for every press or click and let Space scroll the page; and
the transaction list's dialogs, and the receipt viewer's subtitle, named a
transaction with no description by its empty text. A sweep added here met a
glyph: the one on the upload area's refusal banner read 3.04:1 on the banner
in light, under the 4.5:1 the suite holds a glyph to. And two older specs are
fixed: the budget form's printed an error on every run, and the transaction
list's share cases waited for the code they load by counting ticks.

The second browser run, driven with those fixes in, met eight more older than
this wave, and each is fixed here with a spec that failed first: no dialog
had the dialog role; every dialog drawn with the shared header was named by
its title and *Close*; the budget dialog's start date label still ran under
its calendar button in a desktop's dialog at Extra large text; a tab strip
opened on a `?tab=` link cut its tab once the Budgets count arrived; the
filter panel's search suggestions scrolled 4px sideways; focus fell to the
page after a file's remove, after Clear all and as the save-search box
closed, and the box opened without it; and the keep-date and currency-offer
buttons were described by the reason their names had just read. It met two
this branch made: an untitled transaction's delete and stop-sharing confirms
quoted the list's stand-in, *"an untitled transaction"*, as if it were the
transaction's name, and now read sentences of their own; and the Pass of
journey 116, which this branch wrote, asked for a request the app rightly
does not make.

The third browser run, driven with the second run's fixes in, met four more
older than this wave, and each is fixed here with a spec that failed first:
the household overview's goal button named a shared row with no description
by its spaces, or by nothing; while the save-search box was open two buttons
were named *Save search*, and the one that opens it said nothing of its
state; the keep-date and currency-offer buttons' names did not open with the
words their chips show; and focus fell to the page once a dialog a menu's
entry had opened was closed. It met one this branch made: in tc, a name that
quotes a description quoted the stand-in for a missing one,
*查看「未命名的交易」的備註*, and reading found the receipt manager's and the
review card's names and announcements doing the same, some of them older
than this wave. A reading of the whole branch then found five more, each
fixed with a spec or a self-test case red before its fix: a held Enter
pressed the control a hand-off had just moved focus to; the note and share
dialogs kept an untitled transaction's name in the language they opened in;
`icon-labels:check` and `opacity:check` each missed shapes they meant to
read; and a name filled from a transaction's raw description, the class this
record had fixed by reading, had no gate.

The fourth browser run, driven with those fixes in, read each of them it
could reach, and each held. It met one fault this branch made, fixed here
with a spec that failed first: with the save-search box open, the ring its
pill now draws crossed the tops of the filter grid's floated labels, because
the row sat flush on the grid. It could judge neither a held key nor the tab
strip's late-label reveal, and it met two faults older than this wave that
this record leaves open: the receipt manager's thumbnails read alike, and
the dashboard's five live reads have no error path (Known gaps).

## Context

Every reading below was taken on 26.11.181 (`133179db`), before any change
here.

### Controls with no name, or one name for every copy (#531)

`icon-labels:check` carried two freezes. The eighth rule's, `UNNAMED_FROZEN`,
held two rows. The budget form's alert-threshold slider carried its
`aria-labelledby` on the `mat-slider` host, which forwards nothing to its
thumb, so the range input's name was empty and axe's `label` rule flagged
`.mdc-slider__input` in en, ja and tc. The AI page's Auto sync switch had its
words in a sibling span it never referenced; its button was labelled by
Material's own empty `<label>`, and its name was empty too. axe's
`button-name` passed on it all the same, with or without a name: its
explicit-label check takes Material's empty label as one.

Settings' Sign out had no name at 480px and below. Its label, the button's
only name, was taken out with `display: none` under
`@media (max-width: 480px)`, and its icon is hidden from assistive
technology, so the name was empty and axe's `button-name` fired in en, ja and
tc, in both schemes.

The sixth rule's freeze, `ITEMLESS_FROZEN`, held 27 rows: 28 controls in
eleven templates that took their whole name from one key with no parameters
inside a repeat, so every copy read alike. Nine were on the review card: the
not-a-duplicate button, the description, amount, split amount, place name and
new tag fields, the notes, and the buttons that remove a suggested location
and dismiss a suggested currency. Nine were receipt-image controls: the
camera's *Move up*, *Move down* and *Remove*; the receipt manager's *Remove
all images*, *Convert to note* and *Remove image*; and the transaction form's
*Remove*, *Convert to note* and *Remove image*. The other ten were the
feedback delete on About, the delete in the search history and in the search
dialog, a goal item's delete, the recurring list's *Track as recurring* and
*Show transactions*, the transaction filters' two *Remove search* buttons,
and the transaction list's *View note* and *View receipt*.

The rule read a repeat only inside the control's own template, and its header
listed what that left unseen: a ternary between two bare keys, and a control
repeated only by its parent's repeat. The goal card's *Edit* and *Delete*
were the second, `common.edit` and `common.delete` on every goal, stamped
once per goal by the goals page's `@for` and neither guarded nor frozen. The
search history's and the search dialog's pin buttons were the first: each
chose between `aiSearch.historyPin` and `aiSearch.historyUnpin`, which name
no search. The rule kept to its own template because the cross-template
reading the fourth rule uses errs toward repeated, and would freeze controls
that render once (*The eighth rule reads every thumb, and the sixth reads a
card its parent repeats*).

### The empty upload area was a button around a button (#532)

With nothing picked, the dropzone's `.dropzone` was itself the control:
`role="button"`, `tabindex="0"`, the title as its `aria-label`, and click,
Enter and Space handlers that opened the file picker. The Browse button sat
inside it, with a click of its own that stopped propagation. axe reported
`nested-interactive` on `.dropzone` in the light and the dark scheme, and the
keyboard met two tab stops that did the same thing, the zone and then Browse.

Enter on Browse asked the picker twice. The keydown bubbled to the zone's
Enter handler, which opened it, and then the button's own activation ran its
click, which opened it again. Space was answered by the zone, whose handler
cancelled the key, so Browse's own press never came. The hidden input sat
inside the zone too, and the click that opens a picker bubbled back out
through the zone's click handler, which asked again: a click on the zone
asked the input twice, and so did a click on Browse. The browser's
click-in-progress flag made each second request a no-op, but the request was
made.

No axe pass swept the empty upload step. Of the review step's body only the
review card was swept; the notices, the warning and the hints around it were
read by no pass.

### Eleven resting fades (#533)

Of the 24 stylesheet `opacity` declarations between 0 and 1, eleven faded
resting text. Seven were on the goal card, at 0.7 to 0.8: its date, with the
14px calendar glyph inside it, the target, the linked breakdown, the status,
the items count, an item's amount and the note. Three were on the forecast,
its note, its bucket note and the rate caption under its summary, and one was
the Goals tab's hint, all four at 0.75. The other thirteen sit in keyframes,
under a disabled state or in a drag state.

None was measured. `contrast:check` scores token pairs at full strength and
says it cannot see opacity. The smoke walkthrough's axe pass audited
`/reports` on its first tab and `/budgets` on its Budgets and Recurring tabs,
so it swept neither the forecast nor the Goals tab, and no spec measured a
faded line. Measured once on these stylesheets, before the fix, every faded
line still cleared 4.5:1 on its surface in all four palettes. What the fade
did was take the line out of the high-contrast theme's reach: that theme
strengthens the `--text-*` tokens, and a line faded to 70% stays at 70% of
whatever colour it is given. The goal card's own done items already rested in
`--text-muted` rather than an opacity, for that reason.

### Two sentences joined with a Latin stop in ja and tc (#534)

`joinSentences(lead, next)` in `import-review.utils.ts` strips the lead's own
stop, `.` or `。`, and joined the two halves with a literal `". "` in every
locale. Its doc comment defended that: the join separates two statements, and
a Latin stop is what makes a reader pause whatever language it speaks. ja and
tc end a sentence in `。` with no space after it, so the join read as English
punctuation inside Japanese or Chinese. It had three readers: the review
card's accessible names for five controls (the currency chip, the offered
currency's accept button, the date chip, the keep-date button and the type
toggle); the transaction form's verify-field text, one string that is both
the flag's tooltip and its name; and the import wizard's notice for a confirm
round, a snackbar that is read as well as announced.

Read through the ja catalog, a receipt row dated another day named its
keep-date button `…別の日を選んでください. …のままにする`; the form's verify
tooltip on a doubted date read
`…AIの読み取り確信度は40%です. このレシートの日付は…`; and a round whose
photos did not attach said
`2件の取引をインポートしました. 取引は保存されましたが、…`. Only the
dropzone's alert joined in the reader's stop, through
`common.sentenceSeparator` (`". "` in en, `"。"` in ja and tc), and it did so
with a `.join()` of its own, apart from `joinSentences`. 0099 recorded the
stop as a gap of the review card's and the form's tooltips, and 0186 again,
for all three readers.

### Photos counted among every file (#536)

In a pick that mixed photos and a CSV, the upload area numbered, moved and
named each photo by its index in the whole list. The badge read `i + 1`, the
up arrow was disabled only on the list's first row and the down arrow only on
its last, the names took `i + 1` as their place, and `moveFileUp` and
`moveFileDown` swapped a row with its neighbour, whatever that was. Every row
took a drag, the CSV's included. The order matters: the hint asks for the
photos top to bottom of the receipt, and Process sends them in list order.

So with a CSV first the photos read 2 and 3, and the first photo's up arrow
was live and swapped it above the CSV. With two photos before a CSV, the
second photo's down arrow swapped it below the CSV. With a photo, a CSV and a
photo, the second photo's up arrow swapped it with the CSV and left the
photos in their order: `[a.png, rows.csv, b.png]` became
`[a.png, b.png, rows.csv]`, and Process sent `a.png` then `b.png`. The names
followed the index: after a CSV, the first photo's up arrow was *Move file 2
(image.jpg) up*.

### Test runs printed what nobody read (#537)

Jasmine fails a spec that sets no expectation only when told to, and nothing
in the test target told it. Two smoke cases set none.
`firestore.service.smoke.spec.ts`'s *surfaces a rules denial as a
subscription error* waited for one error and never read it, so any error
passed. `dashboard-layout.smoke.spec.ts`'s *opens the recurring rules for a
rule the server does not list in the fortnight* waited for the router to
reach `/budgets?tab=recurring` and expected nothing; its wait throws on a
timeout, so a bill link sent anywhere else failed as a timeout, never as a
wrong URL. A full `npm run smoke` passed 916 cases and printed four *has no
expectations* lines, two for each.

`test:dates` printed AngularFire's one-time advisory, *Calling Firebase APIs
outside of an Injection context may destabilize your application…*, twice in
each zone: one event, which the progress reporter prints twice.
`recurring.service.spec.ts` and `household-plans.service.spec.ts` reach
`deleteField()` outside any injector, and each printed it when run alone.
`test:ci` printed none only because `firestore.service.spec.ts` silences the
whole bundle at module scope, and `test:dates` does not load that spec.

Karma's test target published `public/` alone, so the fonts the styles name
and the icon the About page shows were not found. `test:ci` printed 26
`WARN [web-server]: 404` lines: seven for the fonts (`material-icons.woff2`
twice, PT Sans's 400 and 700 twice each and its 400 italic once) and nineteen
for the About page's launcher icon, `/assets/icons/icon-128x128.png`.
`test:dates` printed three, all fonts. The About spec's *shows the real
launcher icon in the app info card* passed over the broken image, since it
read the `src` and not the picture.

## Decision

The first two subsections hold for every case the record adds: a spec that
expects nothing fails, and a test run says only what it means (#537); and one
shared helper does each job a spec repeats. Then two sentences join in the
reader's own stop (#534), and resting text is a token, with a gate that fails
a resting fade (#533). Every control has a name of its own, and the eighth
and sixth rules of `icon-labels:check` read what they missed (#531). The
upload area has one button (#532), photos are numbered among photos (#536),
and the emulator proofs follow both into the emulators.

### A spec that expects nothing fails, and a test run says only what it means

A passing run's output is a reading, as
[0123](0123-the-unit-sweep-is-silent-on-a-normal-path.md) holds for the unit
sweep. A spec that checks nothing can no longer pass, and each line #537
found in a green run's output is either gone or named.

1. **A spec that sets no expectation fails.** `src/test-main.ts` calls
   `jasmine.getEnv().configure({ failSpecWithNoExpectations: true })`, and
   `angular.json` names it as the test target's `main`. The builder loads a
   test main as its `test_main` entry, after jasmine-core and before any spec
   file. karma-jasmine's start then merges its own configuration over this
   one without naming the flag, so the flag holds for every Karma run:
   `test:ci`, `test:dates`, the smoke runs and a run narrowed with
   `--include`. A polyfill or a `karmaConfig` would not do (What was
   rejected). `src/app/core/services/testing/harness.spec.ts` reads the flag
   back as `true`; it failed before the main existed. The behaviour was
   proved once with an empty case in a unit file and another in a smoke file.
   Each failed with *Spec has no expectations*, and both were removed. No
   other spec turned red: the two smoke cases below were the only ones that
   set nothing.
2. **The test main copies the builder's test-bed init.** A named `main`
   replaces the init the builder otherwise generates, the
   `angular:test-bed-init` module in
   `node_modules/@angular/build/src/builders/karma/application_builder.js`,
   and the file's first line names that file. So `test-main.ts` holds a copy
   of it. A `TestModule` provides `provideZoneChangeDetection()`, the arm the
   builder takes while `zone.js` is in the test polyfills.
   `getTestBed().initTestEnvironment([BrowserTestingModule, TestModule],
   platformBrowserTesting(), …)` passes `errorOnUnknownElements` and
   `errorOnUnknownProperties` as `true`, and no `teardown` option. The
   builder's `import '@angular/localize/init'` is left out, since the test
   polyfills load it already. `tsconfig.app.json` excludes the file, which
   uses jasmine's global.
   - `harness.spec.ts` pins the three settings the copy passes. A template
     that uses an element nothing imports throws NG0304 as the component is
     created; a binding to a property its element does not have throws NG0303
     at the first change detection; and the zone is a real `NgZone`, inside
     whose `run` `NgZone.isInAngularZone()` is true, which the zoneless
     default's `NoopNgZone` is not. Each pin turned red with its line taken
     out of the copy.
   - The copy must be re-read against the builder on every Angular CLI
     upgrade, and the file's header says so. Nothing holds it to the
     builder's init itself (Known gaps).
3. **Coverage leaves the test main out.** The test options carry
   `"codeCoverageExclude": ["src/test-main.ts"]` beside `main`. Under
   `--code-coverage` the builder instruments a test main as it does any
   source file. This one, the first instrumented file directly under `src/`,
   moved the report from `coverage/home-account/app/…` to
   `coverage/home-account/src/app/…` and added four statements to the
   denominator, 23,451 against 23,447. Excluded, the report is written where
   testing.md says it is, and it counts what it counted before.
4. **The two smoke cases expect what they wait for.**
   - `firestore.service.smoke.spec.ts`'s *surfaces a rules denial as a
     subscription error* waits for the one error, then expects its `code` to
     be `permission-denied`. Pointed at a document path, whose error is
     `invalid-argument`, it now fails with *Expected 'invalid-argument' to be
     'permission-denied'*. The wait alone counted any error.
   - `dashboard-layout.smoke.spec.ts`'s *opens the recurring rules for a rule
     the server does not list in the fortnight* waits for the router to leave
     `/dashboard`, then expects `router.url` to be `/budgets?tab=recurring`.
     Waiting for that URL itself, as #537 asked, would throw first. The
     spec's `waitForDom` throws *Timed out waiting for* its label when its
     predicate never holds, so a link to the wrong place would fail as a
     timeout before any expectation ran, and never say where it went.
   - Its sibling, *opens the recurring rules while Upcoming is hidden*,
     waited for the URL itself too, and now waits and expects the same way.
     With the link sent to the Goals tab, both fail with *Expected
     '/budgets?tab=goals' to be '/budgets?tab=recurring'*, where the sibling
     timed out. It also looked for the hidden Upcoming card once the
     dashboard was left; that look is gone, with a comment in its place,
     since no look of that shape could tell (Things that only became apparent
     while building).
5. **The unit specs that print AngularFire's advisory silence it.**
   AngularFire prints a one-time advisory, *Calling Firebase APIs outside of
   an Injection context may destabilize…*, the first time a zone-wrapped call
   runs outside any injector. `silenceFirebaseWarnings()` is now called at
   module scope by the ten unit specs that reach such a call, each file for
   itself, as [0088](0088-the-smoke-harness-owns-the-noise-it-makes.md) has
   every caller do:
   - `firestore.service.spec.ts`, which already called it, for
     `aggregateFieldEqual()`, `doc()`, `sum()`, `writeBatch()` and its
     `afterAll`'s `deleteApp()`;
   - eight that reach `deleteField()`, in the spec, in the service under test
     or in both: `auth.service.spec.ts`, `goal.service.spec.ts`,
     `household.service.spec.ts`, `household-plans.service.spec.ts`,
     `provider-key.service.spec.ts`, `recurring.service.spec.ts`,
     `search-answer-history.service.spec.ts` and
     `transaction.service.spec.ts`;
   - `data-management.component.spec.ts`, whose component calls
     `terminate()`.

   Each of the nine new callers printed the advisory when run alone. The
   whole unit suite run without the ten prints none, so the list is whole.
   `test:dates` runs two of them, recurring and household-plans, without
   `firestore.service.spec.ts`. It printed the advisory in both zones and
   prints none now. Module scope runs when the bundle loads, so `test:ci`
   already ran silenced through `firestore.service.spec.ts`, and its floor
   does not move. This amends 0088's list of callers, which named only the
   smoke files; the helper's header now names the ten. The header no longer
   says that no other smoke spec asserts on `console.warn`, which was false.
   It says what holds: no spec asserts that either AngularFire line prints.
6. **Karma serves the app's icons, and not its fonts, by decision.** The test
   target's assets gain `src/assets/icons`, served at `/assets/icons` beside
   `public/`. The About page's case *shows the real launcher icon in the app
   info card* now decodes the image and expects it to have a width. It failed
   before the entry, on the 404 for `icon-128x128.png`, which a `test:ci` run
   had logged nineteen times. `src/assets/fonts` stays unserved (What was
   rejected). So a `test:ci` run still logs seven font 404s:
   `material-icons.woff2`, `pt-sans-latin-400-normal.woff2` and
   `pt-sans-latin-700-normal.woff2` twice each, and
   `pt-sans-latin-400-italic.woff2` once. Those seven are the noise floor's
   404s ([../testing.md](../testing.md)): the floor counts them in a row of
   their own and names each by its text, and any other 404 is a finding. A
   broken image source added to a rendered template, tried once and removed,
   printed a 404 the floor does not list on a run that stayed green: the
   floor, not a spec, is what catches a missing asset.

### One shared helper per job

Each job the new cases needed already had a copy in some spec, or would have
had a second one. Each now has one helper
([0171](0171-second-copies-fold-into-one-copy-of-each-helper.md)). The spec
helpers live in `src/app/core/services/testing/` and reach specs through its
`index.ts`, except the review card's own, which sits beside it. Items 1 and
10 to 12 are the app's: the catalog walk, a stylesheet's mixins, a focus
request and a transaction's name. Item 13, a spec helper again, came with the
second browser run's tab strip fix, and items 14 to 16 with the third run's
fixes and the reading of the whole branch: an app helper that says whether
focus has fallen to the page, and two spec helpers, a key as the browser
delivers it and a menu entry pressed as a person presses it.

1. **`translateFrom` is the catalog walk, for the service and the specs
   alike.** `TranslationService.t`'s walk, plural choice and interpolation
   move unchanged into `translateFrom(catalog, key, params, intlLocale)`, a
   module function in `translation.service.ts`, and `t` delegates to it. The
   locale comes as a function, so `currentLocale()` is still read only to
   pick a plural member. `getIntlLocale`'s map is exported as `INTL_LOCALES`.
   The service's own cases pass unchanged, which is the proof of the move.
2. **`catalogTranslator`, `catalogTranslationStub` and `CATALOGS`**
   (`catalog-translator.ts`). `CATALOGS` holds en, ja and tc, imported.
   `catalogTranslator(locale)` reads a catalog through `translateFrom`, with
   the locale's own plural rules, and gives a missing key back as the key, as
   the app does; with `strict: true` it throws instead.
   `catalogTranslationStub(locale)` is the translation stub with those words
   and `currentLocale` set to match, for a spec that reads or measures text.
   They fold in five copies of the walk:
   - `person-name.utils.spec.ts`'s own translator, which keeps its throw on a
     missing key through `strict`;
   - `header.overflow.spec.ts`'s lookup;
   - `household-plan-dialog.testing.ts`'s `englishTranslationStub`, deleted,
     with its eight callers in the household goal, budget and contribution
     dialog specs moved over;
   - the `english()` walks in `data-management.component.spec.ts` and
     `ai-settings-page.overflow.spec.ts`.

   Where those copies dropped params or gave a plural back as its key, the
   folded cases now get what the app renders. No interpolator is written for
   the specs (What was rejected). A spec that checks a key's raw leaf still
   reads the JSON itself, since the translator picks one member of a plural
   and gives an empty leaf back as `''`, not as a miss.
3. **`echoTranslation` and `echoKey`** (`translation-stub.ts`).
   `echoTranslation` gives a key back as itself, with its params as
   `key:JSON(params)`, and `echoKey` gives the key alone. Both answer
   `common.sentenceSeparator` with en.json's own `". "`, since a separator is
   punctuation, not words (What was rejected), and `createTranslationStub`'s
   default `t` is now `echoTranslation`. `common.quotedName` is punctuation
   too: given a name, `echoTranslation` answers it with en's own, the name
   bare, so a quoted name reads as the name inside the label that carries
   it; with no name, and through `echoKey`, the key echoes. The wizard's, the
   form's and the review card's hand-rolled echoes, and the review card's
   overflow stand-ins, call these now.
4. **`accessibleName` and `accessibleDescription`** (`axe.ts`). A name is
   read by axe's own computation, `axe.commons.text.accessibleText`, the one
   its rules use: a `display:none` label gives none, a label clipped out of
   sight keeps its words, and `aria-labelledby` and `aria-label` win over the
   content. A description is the text of the nodes `aria-describedby` names,
   in its order, each read by the same computation in its labelled-by
   context, so a hidden one still counts. With no such node it is
   `aria-description`, or `''`, and a `title` is not read. Each read builds
   axe's tree for itself and tears it down after. While a pass is still in
   flight it refuses, rather than tear the pass's tree down under it. A spec
   that checks a control's name reads it as axe does, not off its
   `textContent`.
5. **`tokenValue`, `paintedVerdict`, `expectPainted`, `PALETTES` and
   `inPalette`** (`painted-contrast.ts`).
   - `tokenValue(token, property)` is what `property: var(token)` computes to
     under the palette on `<html>`, read once motion has settled.
   - `paintedVerdict(node, token)` reads, without asserting, whether a node
     is painted in the token, and its ratio on what is painted behind it.
     `expectPainted(node, token, label, floor = 4.5)` asserts on that
     verdict. So the verdict's own case checks it both ways: a node in its
     token above the floor passes, and a node in another token, or a pair
     below the floor, fails.
   - `PALETTES` lists the four palettes, each theme with and without high
     contrast. `inPalette(classes, fn)` runs `fn` under one and puts the
     three palette classes back as they were. It is async-safe: when `fn`
     returns a promise, the classes go back once it settles, resolved or
     rejected, through the restore `withTheme` uses, so a read after an
     `await` still sees the palette it asked for. It first put them back as
     soon as the callback returned, so an awaited axe pass inside it would
     have read the palette it had left. Both move out of
     `theme-aliases.spec.ts`, which imports them now.

   The wizard's and the dropzone's local `tokenValue` and `expectPainted`
   fold onto these. Sixteen other specs keep a local `expectPainted`, each
   beside a local `tokenValue`, and seven more a local `tokenValue` alone.
   One of the seven, in `goal-progress-card.component.spec.ts`, shadows the
   shared import inside its bar case. They are left for later (Known gaps).
6. **`withEveryCardShown(root, pass)`**
   (`transaction-preview-table.testing.ts`, beside the review card and not in
   the index). It lets the review list out to its full height for the pass,
   checks that every card then sits inside the container, and puts the list's
   cap back. The container clips what overflows it, and axe takes a clipped
   card as off screen: at the list's `70dvh` cap in Karma's short frame about
   two cards show, and a pass over the rest would read clean unscored. It
   moves out of the review card's spec, and the wizard's review-step sweep
   shares it. It throws when there is no review list under `root`, where the
   code it replaces read a null.
7. **`standOnThePage(host)` and `expectEachContrastScored(parts)`**
   (`axe.ts`). Karma's frame is 413px tall, and `styles.scss` holds body to
   the frame's height, so a long fixture runs on below body's box. Text down
   there with no fill of its own is left `incomplete` by axe
   (`elmPartiallyObscured`), neither passed nor failed, and a pass over it
   reads clean without having measured it. `standOnThePage` paints the
   fixture's host in `--surface-background`, as body is painted, and the axe
   module's list of limits gains *Body's box* beside the fold and the scheme.
   - `expectEachContrastScored` runs axe once over every part it is handed
     (an element and a label) and expects, for each part, a node of
     `color-contrast`'s passes inside that part's element, naming why axe
     left the rule incomplete there when it did; `contrastUnscored` gives
     the parts with no pass of their own, and `expectContrastScored(el,
     label)` is the one-part case. A pass over a whole step proves little:
     `axeOptions()` keeps one pass node per rule, so over the upload step the
     hidden file input's pass holds the rule whether the words were measured
     or not.
   - It runs the `color-contrast` rule alone, with the shared pass's other
     options, its rules map among them, since axe reads a running rule's
     check options from it, and keeps every passed and incomplete node with
     its element, so each is read back to its part. With every wcag2a and
     wcag2aa rule run per part, the wizard's sweep of some fifteen parts
     outlasted Jasmine's five seconds on a loaded full run. With the one
     rule run per part, the photos-picked sweep's twenty parts did the same
     under `test:ci`'s coverage, and the case it left running broke the next
     and stalled the browser, so a sweep is one run. The other rules cannot
     change this one's verdicts. `axe.spec.ts` pins the cut, the one run for
     several parts, a part whose own words were not drawn reported beside
     one that passed, and the fill on words placed below body's box.
   - Both leave the wizard's spec, whose copies they replace. Two more copies
     of the scoped pass, in `about.component.spec.ts` and the review card's
     spec, still assert it by hand.
8. **`placeholderWidthPx(input)` and `contentWidthPx(input, clip?)`**
   (`placeholder-width.ts`). A placeholder sits on its input's one line and
   cannot wrap, and the input's `scrollWidth` does not count it. So
   `placeholderWidthPx` lays the placeholder out in a hidden probe beside the
   input, in the input's font, and gives its width. It moves out of the
   transaction filters' spec, where the Tags hint's case wrote it, once the
   review card's split hint needed the same probe, and the transaction form's
   Tags case reads it too. `contentWidthPx` gives the room the hint is drawn
   in, the input's content box inside its borders and padding, or up to
   `clip`'s right edge where that comes first: a chip list's input runs past
   its field's infix, and the infix is what cuts the hint. The review card's,
   the filters' and the transaction form's specs each worked that room out
   for themselves, and share it now with the budget dialog's hint case.
9. **`rulesUnder`, `expectOneRule`, `withInlineStyle` and `underRule`**
   (`style-rules.ts`). Karma's window is 756px wide, so a phone rule never
   applies there as layout. A case reads the rule from the stylesheets and
   lays its declarations on the nodes it styles.
   - `rulesUnder(media, selector)` finds the rules under a media query whose
     selector matches, by a pattern or by a test of the caller's own.
   - `expectOneRule` fails unless there is one rule, however many copies the
     CSSOM holds.
   - `withInlineStyle` lays a style on nodes while a callback runs, and puts
     each node's own back after, whether the callback passed, failed or
     threw.
   - `underRule` lays a found rule through it, and fails the case when the
     rule or its nodes are missing.

   They fold the phone-rule harness that the settings spec had copied from
   the wizard's spec. The dropzone's spec uses them too. The budget dialog's
   spec did until the second browser run: its period row now wraps on the
   room it has rather than on a phone rule, and the spec reads that layout
   live, at each width and text size (*Run 2, on 5 November 2026*).
10. **The `a11y` mixins** (`src/theme/_a11y.scss`), reached by `@use 'a11y'`
    through the `src/theme` include path.
    - `visually-hidden` clips text in place and keeps it in the accessibility
      tree (*Every control has a name of its own*, item 3). Settings' Sign
      out label uses it below 480px, and four clips written by hand fold onto
      it: the wizard's step labels, whose compiled CSS is byte for byte what
      it was; the stat card's `.delta-sr`, which gains only the mixin's
      `min-width: 0`; and two Tailwind `sr-only` spans, the transaction
      list's select column header, now `.select-header-label`, and the
      onboarding dialog's step sentence, now `.step-sentence`. No `sr-only`
      is left under `src/`, so the mixin's header, which calls it the app's
      one way to take text off the screen, holds, and docs/onboarding.md
      names the mixin where it named `sr-only`. A pin in each of the list's
      and the onboarding dialog's specs reads the mixin's `clip-path`, a box
      of 1px or less, and the words still in the header's name or the status
      text; Tailwind's `clip: rect(…)` left `clip-path` at `none`, and
      `display: none` empties the name.
    - `frame-ring($frame, $control, $offset)` draws a frame's ring while a
      control inside it matches `:focus-visible` (a button from the
      keyboard, a text box on a click as well), and clears that control's own;
      any other control in the frame keeps its own focus. Its callers are the
      upload area's zone round Browse, the transaction row, whose compiled
      CSS is byte for byte what it was (*The upload area has one button*,
      item 4), and the filter panel's search and save-search pills round
      their text boxes (*Run 3, on 6 November 2026*).
11. **`focusWhenRendered(context, ...selectors)`**
    (`src/app/features/ai/import/import-focus.ts`). It focuses the first of
    the selectors found under the host once the next render has settled,
    wherever focus is by then, and returns at once for a destroyed component.
    The review card's private copy and the upload area's line-for-line second
    one fold onto it, so the review card's 15 calls and the upload area's
    photo move and file remove share one (*Photos are numbered among photos*,
    items 6 and 8). The filter panel is its third caller, for Clear all, a
    suggestion applied from the keyboard and the save-search box (*Run 2, on
    5 November 2026*), and the context it takes is documented as what a
    component needs, where it said an import component. Since the reading
    of the whole branch it also drops the repeats of Enter and Space held
    down across the hand-off, until a keyup or a fresh keydown of either,
    so a held Enter presses once and never the control focus lands on
    (*What reading found*; *Things that only became apparent while
    building*). `household-focus.ts`'s helper of the same name stays apart,
    as do four private copies (Known gaps).
12. **`transactionDisplayName(description, t)`,
    `quotedTransactionName(description, t)` and `isUntitled(description)`**
    (`src/app/core/utils/transaction-display.utils.ts`). A transaction as a
    control names it: its description trimmed, or `transactions.untitledRow`
    (*an untitled transaction*) when nothing is left. `isUntitled` is that
    test on its own, a description empty once trimmed, and the display name
    reads it. The transaction list's row checkboxes and menu triggers, the
    note and share dialogs the list's rows open, each reading it in its own
    template, the receipt viewer's subtitle, the transaction row's own
    button and the household overview's goal button all read the display
    name, so no control or dialog writes the rule a second time.
    `quotedTransactionName` is the display name for a key only some
    catalogs quote: a description in the reader's own quotation marks,
    `common.quotedName`, bare in en and ja and in 「」 in tc, and the
    stand-in bare, since in quotes it would read as the transaction's name.
    The list's note and receipt buttons and the receipt-image manager's
    controls read it, and their keys hold no marks of their own (*Run 3, on
    6 November 2026*). A sentence that every catalog quotes reads
    `isUntitled` instead: in quotes, the catalog's words for an untitled
    transaction read as its name, so the list's delete and stop-sharing
    confirms ask about *this untitled transaction*, and a split part's
    delete about *this untitled part*, unquoted, in sentences of their own
    (*Run 2, on 5 November 2026*).
13. **`afterTwoFrames()`** (`frames.ts`). Some work lands in a frame's
    rendering steps after that frame's animation callbacks: a
    `ResizeObserver`'s report, delivered once the frame's layout is done, and
    a render hook's focus fix-up. A single `requestAnimationFrame` callback
    runs ahead of both and finds neither; the second frame's callback runs
    after the first frame has finished, and finds its work delivered. The
    household plans' and the household budget dialog's specs each wrote it
    inline, and call it now, as the tab strip's late-label cases and the
    budgets page's late-count case do.
14. **`focusDropped()`** (`src/app/core/utils/focus.utils.ts`). Whether
    focus has fallen to the document, as it does when the element holding it
    is removed: `document.activeElement` is null or `<body>`. It lived in
    `household-focus.ts`; the dialog options' menu rule needed it too, and
    the options are in the initial bundle where the household page is lazy,
    so it moved to the core and `household-focus.ts` imports it. The
    transaction list's and the transactions page's inline copies of the same
    test fold onto it. The receipt viewer's and the note lens's private
    focus helpers keep a wider test of their own, focus dropped or still
    inside their host (Known gaps).
15. **`pressKey(target, key, { repeat })`** (`key-press.ts`). A key as the
    browser delivers it to a focused control: a keydown that bubbles and can
    be cancelled, then the button's own click for the press its keypress or
    keyup makes, unless the keydown was cancelled, since a synthetic keydown
    presses nothing. `repeat` is a held key's auto-repeat: a repeated Enter
    presses as the first did, and a repeated Space presses nothing by
    itself, since it arms the button it reaches and the keyup that ends the
    hold presses that button. It stops at the keydown, so a case that lets
    the key go sends its own keyup. The upload area's, the filter panel's and
    the review card's held-key cases read it.
16. **`pressMenuEntry(fixture, trigger, entry)` and `closeEveryDialog()`**
    (`menu-dialog.ts`). `pressMenuEntry` chooses an entry from the menu a
    trigger opens, as a press does, and gives back the dialog the entry
    opened once its menu has left the page. A synthetic click moves no
    focus, so it focuses the trigger and then the entry before it clicks
    each, and it ticks after the entry's click and checks that focus is
    inside the dialog, which is what keeps a focus-return case from passing
    whatever the app does (*Things that only became apparent while
    building*). It finds the dialog by what `MatDialog.openDialogs` gained,
    so a host keeps no reference of its own. `closeEveryDialog` closes what
    is left and waits until each has gone. The dialog options' spec and the
    transaction list's share them.

### Two sentences join in the reader's own stop

`joinSentences` gave up a lead's own stop and then added a Latin `". "` in
every language (#534). The join now takes its stop from the catalog, through
the caller's own translator.

1. **The join reads the catalog's stop.** `joinSentences(t, lead, next)` in
   `import-review.utils.ts` takes the caller's translator, as
   `fieldDoubtSentence(t, …)` beside it does, and joins with
   `t('common.sentenceSeparator')`: `". "` in en, and `。` alone in ja and
   tc, which put no space after a sentence. The key is
   [0186](0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)'s;
   this record adds none for the join. The strip stays (`/\s*[.。]?\s*$/`): a
   lead that ends in `.` or `。`, with any space round it, gives its stop up
   before the join adds one, so a ja lead that ends in 。 is joined by one
   。, not two. A lead written with no stop takes the join's all the same,
   the second half keeps whatever ending it was written with, and an empty
   half adds nothing. A lead that asks keeps its own mark (`/[?？]\s*$/`),
   and the join adds only what the reader's stop leaves after its own: a
   space in en, *…keep it? This receipt…*, and nothing in ja and tc,
   *…このままにしますか？このレシート…*. The review card's keep-date and
   offer buttons open their names with their chips' questions (*Run 3, on 6
   November 2026*). The stop is the language the page is in when the line
   is written.
2. **Every caller passes a translator that reads the service when it is
   called.**
   - The review card (`transaction-preview-table.component.ts`) holds a
     private arrow field, `t = (key, params?) =>
     this.translationService.t(key, params)`, and passes it at its five
     joins: `typeToggleLabel`, `currencyChipLabel`, `currencyOfferLabel`,
     `dateChipLabel` and `keepDateLabel`. An arrow, not a bind made once: a
     spec that spies on the service's `t` after the card is built still
     reaches every sentence the card joins.
   - The transaction form passes
     `this.translationService.t.bind(this.translationService)`: inline in
     `typeButtonLabel`, and in `verifyFieldTooltip` as one local `t` that
     also writes the doubt (`fieldDoubtSentence`) and the not-today sentence.
     One bind, not two, because the form is in the initial bundle. The bind
     is made per call, so a spy set before the call is honoured.
   - The import wizard's notice for a confirm round (`raiseRoundNotice`)
     reduces its parts with `joinSentences((k, p) => this.t(k, p), lead,
     next)`. Its `t` is a private prototype method; passed bare, it would
     lose `this` and throw on the first separator. Neither the compiler nor
     the lint, which is not type-aware, flags an unbound method, so the
     wrapper is written out, and every round-notice case runs through it.
   - The dropzone's alert (`errorMessage` in `file-dropzone.component.ts`),
     which 0186 joined by passing the separator to `.join()`, folds onto the
     helper
     ([0171](0171-second-copies-fold-into-one-copy-of-each-helper.md)): it
     reduces its refusals with `joinSentences((k, p) =>
     this.translationService.t(k, p), lead, next)`. The import area has one
     way to join two sentences. None of the four refusal sentences ends in a
     stop of its own in any catalog, so none is given up.
3. **The notice's duration is still counted in the joined text.**
   `countSentences` splits at a full-width stop wherever it stands and at a
   Latin stop only before whitespace or the end (`SENTENCE_END`), so a ja
   notice joined by 。 counts its sentences as the en one does. An info
   notice of two sentences stays up 5000 ms: the tone's 3000 and
   `ROUND_NOTICE_MS_PER_EXTRA_SENTENCE`, 2000, for the second. The count is
   of sentences, not parts: in en and ja `import.importPhotosFailed` holds
   two, so a notice of the round's outcome and that part stays up 7000 ms.
4. **The echo stubs answer the separator with en's stop** (*One shared helper
   per job*, item 3), so the existing `". "` expectations read as en and
   stand as written. One review-card case had pinned the defect, a ja
   sentence followed by `. `; it now expects 。.
   - What guards the join in ja is a case through the ja catalog
     (`catalogTranslator('ja')`): the review card's date chip on a row dated
     another day, the form's verify text on a doubted scanned date on
     another day, and the wizard's two-part notice. Each holds 。 and no
     `". "`. The keep-date button beside the chip opens with the chip's
     question, so its case holds ？ with nothing after it. The dropzone's
     alert of two refused files is held to the stub's 。, beside a case that
     reads each catalog's separator. The type toggle, the currency chip and
     the form's type segments share the helper and have no ja case of their
     own. The offer's ja and tc cases build the name they expect through
     `joinSentences`, and hold only that nothing follows its question's
     mark; `joinSentences`' own question case reads tc through its catalog.
5. **A sentence joined in code with a literal stop fails `i18n:check`**
   ([0145](0145-a-class-found-by-reading-becomes-a-gate.md)).
   [0099](0099-the-review-step-edits-what-it-shows.md) recorded the class as
   a gap, and 0186 recorded it again after fixing it in the dropzone's alert;
   it is now a check.
   - `findSentenceStopJoins(source)` in `scripts/check-i18n.mjs` reads every
     non-spec `.ts` under `src/app` through the script's `lexTs`, so comments
     and regex literals never count. Three shapes fail: a template literal
     whose text between two `${…}` substitutions is a stop
     (`${lead}. ${next}`); a stop literal between two parts of a `+`
     concatenation, `+=` on its left included, and a template's leading or
     trailing stop run into a `+`; and a stop literal as the whole argument
     of `.join()`.
   - A stop is `.` followed by whitespace, or `。` with or without spaces
     round it, read after the escapes `\n`, `\r`, `\t` and `\u3002` (or
     `\u{3002}`). A `.` with no space after it never counts: it is a
     decimal point, a path, a key, a version or an extension, and en would
     show the missing space itself. Counting it too flagged 11 sites in the
     tree when the check landed: paths, timestamps, a decimal, keys and a
     `join('.')`, and no sentence.
   - `joinSentences` needs no exemption. Its body holds no literal stop, and
     the `[.。]` of its strip sits in a regex literal. Its body as it stood
     before #534 is a must-hit self-test case, and so is the dropzone's old
     `.join('. ')`.
   - It stands beside the comma-join check and, like it, has no number. A hit
     names its file and line and sends the reader to `joinSentences`. The run
     prints *Checked 365 TypeScript files for two sentences joined in code
     with a literal stop.* and finds none; the success line gains *no code
     joins two sentences with a literal stop*. The self-test grew with it
     from 153 cases to 188: 18 must-hit, 16 must-not-hit and one reporting
     case. The raw-description check took it further (The gates).
   - It cannot see a stop in markup, a stop written with its words
     (`'Saved. ' + name`), a stop that reaches the join by another road (a
     constant, a conditional, a helper of another name, `.concat`, or a lead
     and its next part written in two statements), a Latin stop with no
     space, or the full-width `．` and the other sentence ends.

### Resting text is a token, and a resting fade is a gate

Eleven lines on the goal card, the forecast and the Goals tab marked
themselves secondary with `opacity`, which nothing measured and the
high-contrast theme could not reach (#533). Each now rests in `--text-muted`
at full strength, and a new gate keeps a fade off resting text.

1. **Every fade rests in `--text-muted`.**
   - The goal card (`goal-progress-card.component.scss`): `.goal-date`, whose
     14px `event` glyph takes its colour, `.target`, `.linked-breakdown`,
     `.status`, `.items-count`, `.item-amount` and `.goal-note`.
   - The forecast (`forecast.component.scss`): `.forecast-note`,
     `.forecast-bucket-note` and `.rate-caption`.
   - The Goals tab (`goals.component.scss`): `.goals-hint`.

   Each was the colour of the text around it at 0.7, 0.75 or 0.8; each is now
   `color: var(--text-muted)` with no opacity. `.status.reached-note`, which
   undid its parent's fade with `opacity: 1`, now undoes its colour with
   `color: inherit`: reaching the goal is the card's news, so it reads in the
   card's own colour. `.item-amount` sits inside a `mat-checkbox` but is
   written in the card's template, so the card's encapsulated rule reaches
   it; it was painted Material's label colour before.
2. **What the lines paint.** Measured on the rendered pages in light, dark,
   and each under high contrast, the muted lines paint 6.82, 7.27, 9.30 and
   13.86 to 1 on the card's surface (`#f4f2fc` in light, `#1a1b22` in dark),
   and the Goals hint 6.93, 7.94, 9.45 and 15.13 on the page (`#f5f5f5`,
   `#121212`). Each figure is the WCAG ratio of the palette's `--text-muted`
   on that surface. High contrast now reaches these lines: its muted token is
   `#374151` in light and `#e5e7eb` in dark, against `#4b5563` and `#a3a9b5`.
3. **The specs are the measure.** In each component's real-template describe,
   one case runs over `PALETTES`, the four palettes, and holds every line to
   a computed opacity of `'1'`, a colour equal to
   `tokenValue('--text-muted')`, and a painted ratio of at least 4.5:1
   (`expectPainted`).
   - On the goal card it reads the seven lines and the glyph, which is held
     to 4.5:1, not the 3:1 a graphic needs. In each palette it reads the card
     as painted `--mat-sys-surface-container-low`, and it reads high
     contrast's muted token as differing from the plain one, in light and in
     dark. A pin holds the reached note to its parent's colour, unfaded, at
     AA.
   - The forecast's case folds the axis, so the bucket note is shown.
   - The Goals hint is read on the page: `standOnThePage` paints the host
     `--surface-background`.

   On the old stylesheets the cases failed on the opacity and the colour, not
   the ratio, since every faded line cleared 4.5:1 (Context). The change
   gives the lines a measure and the high-contrast theme's reach; it raises
   no line that failed.
4. **`contrast:check` gains no pair** (What was rejected). Its header lists
   opacity among what it cannot see, and now points to `opacity:check`.
5. **A resting fade fails `opacity:check`** (`scripts/check-opacity.mjs`),
   beyond the issue and by 0145's rule: a resting fade is readable from one
   file. It takes `check-motion.mjs`'s shape: an `ALLOWED` table, a
   self-test, and its helpers copied in, so the script runs on its own.
   - **What fails.** A stylesheet `opacity` between 0 and 1, written as a
     number or a percentage (`0.7`, `.7`, `70%`, with or without
     `!important`); and a Tailwind `opacity-NN` below 100, an arbitrary
     `opacity-[…]` or the arbitrary property `[opacity:…]`, in an `.html`
     template, an inline `template:` literal or a stylesheet's `@apply`.
     `opacity: 0` and `opacity: 1` pass: hidden and full strength are how a
     reveal starts and ends. `:hover` and `@media` exempt nothing, and
     `hover:opacity-80` fails as `:hover` does. `text-opacity-*` and
     `bg-opacity-*` are alpha inside a colour, another utility.
   - **Only a state that ends is exempt.** A declaration in a `@keyframes`
     frame no fill mode holds, prefixed or not, where a pulse is motion and
     the reduced-motion switches end it; under `:disabled` or `[disabled]`,
     on the disabled element or inside it, where a control owes no contrast
     (WCAG 1.4.3) and the fade is what tells it from a live one; and in
     CDK's four moving drag states, `.cdk-drag-preview`,
     `.cdk-drag-placeholder`, `.cdk-drag-animating` and `.cdk-drag-dragging`.
     `.cdk-drag-handle`, `.cdk-drag-disabled` and a bare `.cdk-drag` sit on
     an item at rest and exempt nothing. A state named inside `:not(…)` or
     `:has(…)` is not the subject's own: `&:hover:not(:disabled)` is the live
     control under the pointer, and fails. A utility is exempt only under a
     `disabled:` or `group-disabled:` variant, anywhere in its chain.
   - **A held keyframe does not end.** The `to` frame, or `from` in reverse
     (`reverse` or `alternate-reverse`), of an animation a rule runs with a
     `forwards` or `both` fill fails like a resting fade: the element rests
     on it, and the reduced-motion switches cut the run short and leave the
     fill mode, so the frame holds from the first paint. A rule's
     `animation-fill-mode` and `animation-direction` longhands join each
     animation that rule names, so a shorthand fill with a direction
     longhand, and a shorthand direction with a fill longhand, both count.
     Quoted names count, as do `-webkit-` forms and keywords in any case. A
     `from` frame that `both` holds only through a delay passes.
   - **A sibling is not inside the disabled control.** A compound joined to
     the next by `+` or `~` is a sibling, so `.a:disabled + .hint` and
     `.a:disabled ~ .hint` fail, as `.row:has(:disabled) .hint` and
     `peer-disabled:opacity-60` do, while `button:disabled .label` and
     `button:disabled > .icon` pass. A label beside its control
     (`input:disabled + label`) fails like a hint, since the gate cannot tell
     the two apart; it takes `--text-disabled`, not a fade or an `ALLOWED`
     row.
   - **How it reads a stylesheet.** Comments are blanked with their offsets
     kept, and an unquoted `url(…)` is blanked first, so its `//` cannot open
     a comment that swallows the rest of the file. The stylesheet is cut into
     statements as `check-colors.mjs`'s `statements()` cuts it, and each
     block's prelude is kept with its parent, so a declaration is read with
     every selector above it. A line scan, the way `check-motion.mjs` reads,
     sees the `opacity` line and never the `&:disabled` or
     `&.cdk-drag-placeholder` above it, which is where the exempt states
     nearly always are. The levels resolve as Sass resolves them, `&`
     standing for the level above and a selector with no `&` sitting under
     it, and a declaration is exempt only when every selector they resolve
     to, each list cut at its top-level commas, is in a state that ends:
     `.a:disabled, .b` still fades `.b`, `.a:disabled { & + .hint {…} }`
     fades the hint, and a disabled control's own label, inside it, passes
     with it. The arms of an `:is(…)` or `:where(…)` count as a list the same
     way, nested ones too, so `.a:is(:disabled, :hover)` still fades
     `.a:hover`. `@media`, `@supports` and `@include` pass through.
   - **What it reads.** Every `.scss`, `.css` and `.html` under `src`, and in
     every non-spec `.ts` that declares a `@Component`, every `template:` and
     `styles:` string, quoted or in backticks, a second component's
     included: each `template:` as a template, and each `styles:` string, on
     its own or in an array, as a stylesheet. A `template:` in a comment is
     not read. `${…}` is blanked in a `styles:` string only; a template
     string keeps its substitutions, so a class picked inside one is read.
     HTML comments are blanked. A static `style="opacity: …"` attribute is
     not read, since the template reader reads class names, not
     declarations; the tree holds none.
   - **`ALLOWED` and its ratchet.** One row:
     `src/app/features/auth/login/login.component.html`, one hit, the sign-in
     card's tagline at `opacity-80` over the translucent glass card. Its
     colour is chosen for the fade, `--text-secondary` rather than
     `--text-muted`, and `login.component.spec.ts` measures it through the
     fade at every stop of the gradient behind the card, in both themes. A
     row must match its file's count exactly: a new hit fails, and so does a
     file whose count dropped, reached zero or no longer exists, so a repair
     edits the table in the same commit. `allowedRowValid` refuses a row
     whose count is not a positive whole number or whose reason is empty.
   - **What it cannot see**, as its header lists: a `[style.opacity]` or
     `[ngStyle]` binding, and an opacity set from TypeScript
     (`element.style.opacity`, a class added through `classList` or a host
     binding, an animation's `style({ opacity })`); `filter: opacity()` and
     alpha inside a colour (`rgb(… / 60%)`, a `color-mix()` with
     `transparent`, a utility's `/60`); an opacity that is not a literal
     (`var(--x)`, a Sass variable, a `calc()`), here, in `opacity-[…]` and
     in `[opacity:…]`; `fill-opacity`, `stroke-opacity` and the other SVG
     paint opacities; whether the faded element holds any text; a keyframe
     declared in another file, which means a global `@keyframes`, in
     `src/styles.scss` or a component with `ViewEncapsulation.None`, run
     from another stylesheet, or one a Sass partial or mixin brings in, since
     Angular scopes a component's keyframes to it under the emulated
     encapsulation every component here keeps, and `styles.scss` and the
     partials declare none; a fill mode or a direction set in a rule that
     does not itself name the animation; a paused animation, which rests on
     its first frame; an `alternate` or `alternate-reverse` run held after
     an even number of iterations; the order and comma position of a rule's
     animation declarations, since its longhands join every animation it
     names, so a later `animation-direction: normal`, a shorthand written
     after a direction longhand, or a `normal, reverse` list beside two
     animations moves the held frame unseen; a `template:` that is not a
     string literal, such as one read from a constant, and the strings of a
     concatenation after its first; and a spec's host template.
   - **The figures.** The self-test has 150 cases. Over the tree the run
     reads 105 stylesheets (99 files and six inline `styles:`) and 104
     templates (97 files and seven inline), with the one fade recorded and
     none beside it. Of the 24 fractional `opacity` declarations the
     stylesheets held on 26.11.181, the 13 left are all exempt: four
     keyframe frames, three disabled controls and six drag states, and all
     13 stay exempt under the widened reads.

### Every control has a name of its own

#531 had three shapes. Two Material controls handed the control a screen
reader lands on no name. A button lost its only name at phone width. And 28
controls in eleven templates, stamped once per item, gave every copy the same
name, so neither the buttons nor the rows they act on could be told apart by
ear. Each now has a name of its own. Every name is pinned in a describe that
renders the real template
([0144](0144-a-blanked-template-is-paired-with-a-describe-that-renders-it.md)),
read by axe's own name computation (`accessibleName`), and in en, ja and tc
against the catalog's words, but for the review card's nine. Their describe
reads them through the echo stub, as a key and its parameters, and through
tc's catalog alone, where a description's quotation marks differ (item 4);
only the split field's name is also read in en, ja and tc.

1. **The alert slider is named on its thumb.** `mat-slider` takes no name
   input and forwards nothing to its thumbs, so the `aria-labelledby` the
   budget form wrote on the host named nothing, and the range input a screen
   reader lands on had no name. The label's words now sit in a
   `<span id="threshold-label">` of their own inside the styled line, with
   the `: ` and the value's `<strong>` beside it, and the
   `<input matSliderThumb>` carries `aria-labelledby="threshold-label"`. The
   name is *Alert when spending reaches* (`budget.alertWhenReaches`) and
   holds no figure: the thumb sets its own `aria-valuetext` from the value,
   and no template binding competes with it. The whole line would have named
   the thumb with the value inside, which the thumb then says again. axe's
   `label` rule had flagged the range input in every language and scheme;
   over the form it now finds nothing.
2. **The Auto sync switch is named by the words beside it.** The AI page's
   label was a sibling span the toggle never referenced, so the
   `role="switch"` button inside the `mat-slide-toggle` was named by
   Material's own empty label. The span carries `id="auto-sync-label"` and
   the toggle `aria-labelledby="auto-sync-label"`, which Material hands to
   the button inside, as the dashboard layout settings' card toggles already
   do. Its name is *Auto-sync when online* (`aiPage.autoSync`). axe alone
   cannot tell this switch from an unnamed one (Context), and
   `aria-toggle-field-name` never reaches a `<button>`, so the spec reads the
   name first, and removes Material's empty `<label for>` before its axe
   pass, which then reads only the button's own names.
3. **Sign out keeps its name below 480px.** On a narrow card Settings shows
   Sign out as its icon alone. It took the label, the button's only name, out
   with `display: none`, which takes text out of every name it is part of. A
   new `src/theme/_a11y.scss` holds `@mixin visually-hidden`: an absolutely
   positioned 1px box with `min-width: 0`, `overflow: hidden`,
   `clip-path: inset(50%)` and `white-space: nowrap`, which clips the text in
   place and leaves it in the accessibility tree. Its insets stay auto, so
   the box sits where the text stood, inside the button. A stylesheet reaches
   it with `@use 'a11y'` through the existing `includePaths`, as it reaches
   the breakpoints, and the clips written by hand elsewhere fold onto it
   (*One shared helper per job*, item 10). Under the rule axe finds no
   `button-name` on Sign out in either scheme.
4. **A review card's nine controls name their row.** Each passes `{
   description: announceDescription(row) }`, now protected so the template
   can read it: the row's description, or `import.untitledRow` (*an untitled
   row*) when it is blank, the words the card's announcements and its row
   checkbox already use.
   - The fields: `import.descriptionFieldLabel` (*Description of
     {description}*), `import.amountFieldLabel` (*Amount of {description}*),
     `import.splitAmountLabel` (*Amount to split off {description}*),
     `import.placeName` (*Place name for {description}*),
     `import.newTagLabel` (*New tag for {description}*) and
     `import.notesLabel` (*Notes for {description}*).
   - The buttons: `import.notADuplicate` (*Not a duplicate — import
     {description}*), `import.removeLocation` (*Remove the suggested location
     from {description}*) and `import.dismissCurrencySuggestion` (*Dismiss
     the currency suggestion for {description}*).
   - Four keys are reworded in place, since nothing else read their bare
     words. Five are new. The description and amount fields take keys in
     `import`, beside the card's other names, and `common.description` and
     `common.amount`, which those two fields alone read, leave all three
     catalogs. The split, tag and notes fields keep their bare words as a
     placeholder or as Add notes' text.
   - The overrule's tooltip reads the same key with the same parameters, so
     the two cannot drift, and *Not a duplicate* still leads in every
     catalog: `import.recheckFailed` tells the reader to press the button by
     those words.
   - The fields commit on Enter or blur, never per keystroke, so a
     description being typed does not rename the field it is typed into;
     `editing` is a per-row map, so two rows open at once each carry their
     own names.
   - ja puts the row before の, *{description}の金額*, and tc before 的.
     `announceDescription` hands a description through `common.quotedName`,
     so tc reads it in 「」, *「Coffee Shop」的金額*, and the stand-in bare,
     *未命名的項目的金額*; the card's checkbox, its remove question and its
     announcements read it the same way, and none of their keys holds marks
     of its own (*Run 3, on 6 November 2026*).
5. **A receipt image's controls name the image by its number, and the
   transaction where the list holds several.** They read new
   `receiptImages.*` keys by `i + 1`, the number each thumbnail's alt already
   says (`receiptImages.imageNumber`, *Receipt image {index} of {total}*).
   - The camera: `receiptImages.moveImageUp` (*Move image {index} up*),
     `receiptImages.moveImageDown` (*Move image {index} down*) and
     `receiptImages.removeImageNumber` (*Remove image {index}*).
   - The receipt manager lists the images of many transactions, so it names
     the transaction too: `receiptImages.removeAllImagesOf` (*Remove all
     images of {description}*), `receiptImages.convertImageOf` (*Convert
     image {index} of {description} to a note*) and
     `receiptImages.removeImageOf` (*Remove image {index} of {description}*).
   - The transaction form shows the photos queued for this save and the ones
     already stored at once in edit mode, so it says which:
     `receiptImages.removeNewImage` (*Remove new image {index}*),
     `receiptImages.convertStoredImage` (*Convert stored image {index} to a
     note*) and `receiptImages.removeStoredImage` (*Remove stored image
     {index}*).
   - ja counts images with 枚目, *{index}枚目の画像を削除*. tc counts with
     第…張 and keeps two verbs apart: an image not yet saved is taken off,
     *移除第 {index} 張圖片*, and a stored one is deleted, *刪除第 {index}
     張已儲存的圖片*.
   - A blank description must not leave a name ending in *of*, so the
     manager's names read `quotedTransactionName` (*One shared helper per
     job*, item 12), which gives *an untitled transaction* when nothing is
     left, and in tc puts a description, never the stand-in, in 「」.
   - The tooltips keep their short words; the name carries the item.
6. **The other per-item controls name their item by what its row shows.**
   - About's feedback list: `about.feedback.deleteLabel`, reworded in place,
     *Delete feedback {position} ({category})*, the entry's place and its
     category's words, since two entries can share a category.
   - The saved answers, in the search history and in the search dialog:
     `aiSearch.historyDeleteLabel`, *Delete {query} ({date})*, the question
     and the date the row shows, since one question can be saved on two days.
   - The goal form's items: `goal.deleteItemLabel`, *Delete item {position}*,
     by place, since the item's name is a field being typed.
   - The recurring groups: `insights.convertToRuleFor`, *Track {name} as
     recurring*, and `insights.showTransactionsFor`, *Show transactions for
     {name}*, by the group's label.
   - The filter panel's suggestions: `transactions.removeSavedSearch`,
     *Remove saved search {name}*, by its label or else its query, and
     `transactions.removeRecentSearch`, *Remove recent search {query}*.
   - The transaction list's note and receipt buttons:
     `transactions.viewNoteFor`, *View note for {description}*, and
     `transactions.viewReceiptFor`, *View receipt for {description}*, through
     `quotedTransactionName`, as the manager's are.
   - ja quotes a question, a search or a group's label in 「」 and puts the
     verb last, *「{query}」（{date}）を削除*; tc quotes it too and puts the
     verb first, *刪除「{query}」（{date}）*.
7. **The two pin buttons read one key.** The search history's and the search
   dialog's pin buttons flipped their name between two bare keys, *Pin this
   answer* and *Unpin this answer*, while `aria-pressed` said the same. They
   read `aiSearch.historyPinLabel`, *Pin {query} ({date})*, and
   `aria-pressed` alone says whether the answer is pinned: a toggle button
   keeps its name while its state changes.
8. **The goal card's Edit and Delete name their goal.** They read
   `goal.editNamed`, *Edit {name}*, and `goal.deleteNamed`, *Delete {name}*,
   with the name the card's header shows, as a household plan's Edit already
   does (`household.plans.edit`). ja reads *「{name}」を編集* and tc
   *編輯「{name}」*. No rule saw the pair: the goals page stamps one card per
   goal, and nothing repeats inside the card's own template.

The names add 27 keys to each catalog, `common.quotedName` among them,
reword five in place, and nine more in tc alone, whose quotation marks round
a description now come from `common.quotedName`; and they retire five whose
last readers they replace: `common.description`, `common.amount`,
`transactions.removeSearch`, `aiSearch.historyPin` and
`aiSearch.historyUnpin`. Every other key a control stopped reading keeps a
reader elsewhere, a tooltip, a placeholder, a menu or the app at large, and
stays.

### The eighth rule reads every thumb, and the sixth reads a card its parent repeats

Both freezes `icon-labels:check` keeps for these rules are empty.
`UNNAMED_FROZEN` lost the slider's and the switch's rows, and
`ITEMLESS_FROZEN` lost the 28 controls 0186 froze, so a new hit of either
rule fails, as
[0151](0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)
keeps an emptied freeze empty.

The eighth rule read a slider only when its host carried a name, and then
asked each thumb to carry one too; a slider named nowhere was not read. So
moving the budget form's name from the host to the thumb would have taken the
slider out of the rule's sight, not proved it named. It reads every thumb
now, whatever the host carries: each `matSliderThumb`, `matSliderStartThumb`
or `matSliderEndThumb` input carries `aria-label` or `aria-labelledby` with a
value, as a literal, an interpolation or a binding (`[aria-label]`,
`[aria-labelledby]`, `[attr.aria-label]`, `[attr.aria-labelledby]`). With the
thumb's `aria-labelledby` taken out of the budget form, the run fails at the
slider with *`<mat-slider>` with a thumb named by nothing*. The run reads
*Checked 19 checkbox, slide toggle and radio button tag(s) and 1 slider(s)
across 103 template(s): 0 hand their control no name, 0 frozen by name.*

The sixth rule read "once per item" inside a template only, which is why the
goal card's pair was neither guarded nor frozen (0186's gap). It reads it two
ways now, as the fourth rule reads a menu trigger: inside the template, an
`@for` block or an element under a repeating structural directive; across
templates, a component another template stamps that way.
`scanItemlessAcross(templates)` is the run's own path. It asks
`repeatedTemplates` which components are stamped once per item, then scans
each template with its component's verdict (`scanItemlessLabels(source,
componentRepeated)`), so every control in a repeated component counts. Two
self-tests drive a parent and its card through that one path; the ones that
call each half on its own still pass with the verdict dropped between them.

The fourth rule's reading errs toward "repeated", and here that would flag
controls rendered once. The dashboard stamps its cards through `@for (card of
arrangedCards(); track card)` and `@switch (card)`, so each `@case` renders
for the one card that matches it, and the insights card's Refresh is one
button on the page; read as the fourth rule reads it,
`ai-summary.component.html:16` would fail. So an `@case` under an `@switch`
whose subject is the nearest `@for`'s own item lifts that repeat, in the
template and across it. The lift is an option of the template walk,
`casesApart`, that only the sixth rule passes: the fourth rule, the tooltip
rule, the id rule and the toggle rule read as before.

- **What two or more of the switch's cases reach still repeats**, whether a
  component's selector or a control under one bare key, and whether a case
  writes it or reaches it through a component it stamps, at any depth: every
  card that reaches one of those cases renders a copy. The card menu,
  `app-dashboard-card-menu`, is written into all five cards and stays
  repeated, and so does the empty state, which four of them stamp. One
  helper, `heldApartAcross(templates)`, keeps that tally per switch and per
  selector or key. It reads what each template reaches to a fixed point, so
  components that stamp each other, or one that stamps itself, reach the
  same whichever of them a switch's cases read first. The first tally
  counted only what a case wrote; a reading of the whole branch found the
  rest (*What reading found*).
- **An `@default`, an `@switch` on something the item holds (`c.kind`) and an
  outer `@for` around the switch still repeat.** Every other item lands in
  the default, many items can share what an item holds, and the outer repeat
  stamps the whole switch once per row.
- **Over the tree, before the goal card's fix, it found that card's two
  controls and nothing else.** The cross-template set is 14 templates, where
  the fourth rule's is 19: the five dashboard cards, each lifted by its
  `@case`, leave it, and the empty state, which four of them stamp, stays.

A name that picks between two bare keys with a ternary gives every copy one
of two names, neither of which says which item it acts on. The pin buttons
had that shape, and the rule did not see it. `bareKeyOf(expression)` now
reads such a ternary as bare in three spellings, bound or as a literal that
is one interpolation: `(cond ? 'a' : 'b') | translate`,
`cond ? ('a' | translate) : ('b' | translate)` and
`cond ? ('a' | translate) : 'b' | translate`, whose last branch Angular
reads as a pipe and which the reading of the whole branch found. It reports
the two keys together. A ternary with parameters on either branch, or on the
pipe after it, has a slot and passes. Of the ternary names in the tree, only
the two pin buttons' had that shape; the others have a `null` branch or a
nested ternary.

The run reads *Checked the controls stamped once per item across 103
template(s): 0 take their name from a key with no parameters, 0 frozen by
name; 14 template(s) belong to a component another template stamps once per
item.* A hit's fix hint names a binding the tree holds, the upload area's
`'import.movePhotoUpLabel' | translate: { position: photoNumber(file), name:
file.name }` (`ITEMLESS_MODEL`), and a self-test case fails if that binding
leaves the upload area's template. The self-test went from 164 cases to 200.
What the sixth rule still cannot see is under Known gaps.

The lint ban 0186 put on a list keyed by a file's name now also bans a key
read from a photo's bytes. The transaction form keyed its queued photos by
each one's preview, a data URL made from the picture, so two picks of one
picture shared a key. Angular warned NG0955 at the strip's next change, and a
remove pressed on the first row destroyed the second row's element and handed
the first to the second entry, so the element left on screen, with focus and
a reader's place, was the one the user asked to remove. It was found by
reading while the form's image controls were named, and is older than this
record. The strip tracks each queued entry itself now (`track pending`),
since an entry is made once per pick and never copied. The selector in
`eslint.config.js`, and `TEMPLATE_TRACK_BY_NAME_SELECTOR` in
`check-lint-guards.mjs`, read
`ForLoopBlock[trackBy.source=/\.(name|preview)\s*$/]`. Five self-test
fixtures hold it: `track p.preview` fails, whether a `; let i = $index` or a
trailing space follows it, and `preview.url`, `p.previewId` and the item
itself pass. The wizard's tiles, which track an object URL made once per
file, are untouched. The `lint-guards:check` self-test grows from 90 cases
to 95.

### The upload area has one button

The empty upload area was a `role="button"` wrapped round its own Browse
button (#532). It now takes the transaction row's shape
([0151](0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)):
a frame that is no control, with one native button inside it.

1. **The zone is no control.** In `file-dropzone.component.html` the
   `.dropzone` loses its role, its tab stop, its `aria-label` and its click,
   Enter and Space handlers; its classes stay. As a button it made Browse,
   the hint and the file types its presentational children, axe's
   `nested-interactive`; it gave the keyboard two stops that did one thing;
   and its handlers opened the picker twice on Enter and kept Space from
   Browse (Context).
2. **The host answers a pointer click, and only on the empty zone.**
   `FileDropzoneComponent` binds `(click)` on its host to `onZoneClick`,
   which asks the hidden input once, through the `fileInput` view child, when
   three guards pass. Nothing is picked: once the rows are listed, a stray
   click on them must not reopen the picker, and adding more is the work of
   **Add more files**. The click landed inside this host's `.dropzone`: the
   refusal banner beside the zone, still inside the frame a file is dropped
   on, is read rather than pressed, and opens nothing. And the click came
   from no button, link or input inside the zone. The listener sits on the
   host, as the row's does, because a template click on an element with no
   tab stop fails the template lint's `interactive-supports-focus`.

   The input guard is the one a reader would not look for. The hidden input
   sits inside the zone, and the picker is the input's own click, which
   bubbles back out through the zone to the host that asked for it, so
   without the guard every request asks twice, as the old zone's did. The
   button guard keeps Browse's own click from asking again on its way out, so
   Browse and **Add more files** each call `fileInput.click()` without
   stopping the event. Only a control inside the zone counts: a zone rendered
   inside a link of the page's own still opens on a click on its title.
3. **Browse is the one keyboard route, described by the hint.** A native
   button turns Enter or Space into exactly one click, so one press opens the
   picker once, and Tab meets one stop on the empty zone. Browse keeps its
   own words for its name, *Browse Files*, and its `aria-describedby` names
   the hint, *Supports CSV, PDF, images, and JSON backups*. The hint's id is
   `hintId`, `dropzone-hint-<n>` from a module-level counter, as the receipt
   viewer's hint id is, so Browse never resolves to another zone's hint.
   `browse()`, `getFileIndex` and `imageFilesCount` go: nothing read them
   after the change.

   The title, which also named the zone, is only a heading now, and an `h2`.
   Inside a button it was no heading; once the zone lost its role it was an
   `h3` straight under the page's `h1`, and axe's best-practice
   `heading-order`, outside the suite's `wcag2a`/`wcag2aa` pass, fired on the
   empty step. A pin holds the `h2` to the 18px, the weight of 600, the 27px
   line and the zero margins it was drawn with as an `h3`.
4. **The ring goes round the zone.** The zone is never `:focus-visible`
   itself, so the ring `styles.scss` draws would go round Browse alone, while
   what a keyboard user is choosing is the whole zone. A mixin in
   `src/theme/_a11y.scss`, `frame-ring($frame, $control, $offset)`, draws
   `.dropzone:has(.browse-btn:focus-visible)` 2px solid `--color-primary` at
   a 2px offset outside the zone, and 3px under high contrast, which it
   states itself because `styles.scss` widens a ring by matching
   `:focus-visible`, and the frame never matches. Browse's own ring is
   cleared, so one ring shows. The transaction row's ring, the same rules at
   a −2px offset, now comes from the same mixin
   ([0171](0171-second-copies-fold-into-one-copy-of-each-helper.md)), and so
   do the filter panel's search and save-search pills', at −2px round their
   text boxes, where the save-search row's Save and Cancel keep their own
   focus (*Run 3, on 6 November 2026*). The mixin's contract reads that way:
   the frame is ringed while a control inside it matches `:focus-visible`,
   which a text box does on a click as well as from the keyboard, and any
   other control in the frame keeps its own. The 3px ring and its 2px offset
   are the 5px of room the wizard leaves round its step, and that room's
   comment in `import-wizard.component.scss` now names the ring drawn round
   the zone while Browse has keyboard focus.
5. **The Data page's backup upload area asks once, and Space no longer
   scrolls the page.** The same bubbling was found by reading on `/data`,
   older than this record: the hidden input sat inside `.import-dropzone`, so
   every press or click asked it twice, and Space's keydown, left
   uncancelled, scrolled the page under the area. The input now sits just
   before the area, inside the same `@if`, and generates no box, so the
   layout is unchanged; Space's keydown is cancelled before the area asks.
   The area stays one `role="button"` with a tab stop: nothing inside it is a
   control, so it nests none, and the shape the wizard's zone gave up is
   right for it. Two cases in the Data page's spec hold one request per press
   or click and the cancelled Space.
6. **The refusal banner's glyph takes the message's colour.** The upload
   step's sweep with photos picked, once it stood on the page's fill, found
   the banner's glyph in `--color-error`, #ef4444 in light, at 3.04:1 as
   painted on the banner's 10% error tint. Karma serves no icon font, so axe
   scores the ligature as text and holds it to 4.5:1, as
   [0186](0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)
   found. The glyph now takes `--color-error-text`, the message's own step,
   as the review notices' glyphs take `--color-warning-text`: #b91c1c in
   light at 5.24:1, and #fecaca in dark at 11.41:1, where #f87171 read
   5.97:1. That is a visible change, a darker red in light and a pale pink in
   dark. `contrast:check`'s row for `--color-error-text` on `--surface-card`
   now names the glyph with the message, and its 3:1 row for `--color-error`
   no longer lists it; nor does the accessibility reference's table of glyph
   pairs.
7. **The two steps no pass looked at are swept.** In
   `import-wizard.component.spec.ts`, the empty upload step finds nothing
   under axe in either scheme; before the change it found
   `nested-interactive` on `.dropzone`.
   - Its title, hint, file types and Browse are then scored each by its own
     nodes (`expectEachContrastScored`), since a pass over the whole step holds
     `color-contrast` from the hidden file input alone. Each pass is pointed
     at words: Browse's at its label, `.browse-btn .mdc-button__label`, since
     the button projects its glyph outside that span, and each of the four
     file types with every element inside it hidden, its glyph among them,
     and a count that holds each type to having one, so its pass can come
     only from its own text. With those words hidden, passes over the whole
     `.file-types` and `.browse-btn` still held the rule on their glyphs
     alone; the passes over the words fail.
   - A case runs axe's `heading-order` alone over the wizard, on the empty
     step and with photos picked, and finds the order kept
     (`expectHeadingsInOrder`); with the `h3`s it failed on both, in both
     schemes.
   - The sweep of the upload step with photos picked, whose one contrast
     check the hidden input answered, scores each word-holder in its own pass
     too.

   The review step's sweep lands on the step with both notices, the duplicate
   warning and both hints on it. `landReviewStep()` sets one photo; a receipt
   row whose date was assumed, a row with no description and a deselected
   duplicate with its exact check; an answer cut short; and a PDF read 15
   pages of 40, with one other PDF read in part. It renders once, so the
   stepper's `[completed]` inputs read that state, and only then selects step
   2: the stepper is linear and refuses the move before. The case checks that
   the index is 2, since a refused move leaves the step hidden and a pass
   over it finds nothing. In each scheme, with the review list let out to its
   full height (`withEveryCardShown`), the step finds nothing, and each
   paragraph of each notice and hint is scored in its own pass and read as
   painted in `--text-secondary` at AA. The pass is per paragraph, not per
   notice, because a notice's glyph holds the rule by itself. The header, the
   warning's title and Back are scored the same way; Continue, held disabled
   here, is one axe leaves out, as WCAG 1.4.3 does. The review step found
   nothing. Both sweeps stand on the page's fill (`standOnThePage`).

### Photos are numbered among photos

In a pick that mixes photos and a CSV, the photo badges, the move arrows and
the buttons' names counted every file (#536). Photos are now numbered among
photos, in place: files keep the order they were picked in, a photo's move or
drop steps past a row that is no photo, and such a row never moves.

1. **Each file has a number among its own kind.** `places`, a `computed` on
   `FileDropzoneComponent`, makes one pass over the list and builds two maps
   keyed by the `File`, as the previews are: the photos' and the other
   files', each counted from 1 in list order. `photoNumber(file)` and
   `otherNumber(file)` read them, each 0 for a file of the other kind, and
   `photoCount()` counts the photos. A photo's number is its badge, its place
   in the order the photos are sent in, and the number its buttons' names
   carry. The badges, the arrows and the drag handles stand once two photos
   are listed: `hasMultipleImages` is `photoCount() > 1`. One test says what
   a photo is, `isImageFile`, which reads `looksLikeImageFile`, for the
   numbers, the moves, the drop, the template's guards and the wizard alike.
2. **The arrows step past a row that is no photo.** `moveFileUp(file, e)` and
   `moveFileDown(file, e)` take the file, not a list index. `swapWithPhoto`
   walks from the file's row in the arrow's direction past every row that is
   no photo, swaps the two photos' rows, and does nothing at an end. Up is
   disabled at photo 1 and down at the last photo. In `[a, csv, b]`, b's up
   arrow gives `[b, csv, a]`, the CSV in its row; before the change it gave
   `[a, b, csv]`.
3. **A row that is no photo is never dragged, and a drop is remapped.**
   `[cdkDragDisabled]` holds every row but a photo among two or more. CDK
   still slides aside every row the dragged photo passes, a CSV's too, and no
   sort predicate can hold one in place (What was rejected). So `onFileDrop`
   lets CDK's `moveItemInArray` sort a copy, reads the photos off it in their
   new order, and writes them back into the photos' own rows. Every other
   file keeps its row, and a CSV the drag slid aside snaps back on the drop.
   Photo 2 dropped at the top of `[a, csv, b]` gives `[b, csv, a]`; a photo
   dropped on the CSV's own slot passes no other photo and leaves the list as
   it was.
4. **A button's name carries the badge's number.**
   [0186](0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)
   named each row's buttons by the file's place in the list and its name; a
   photo's place is now its number among the photos. The arrows read
   `import.movePhotoUpLabel` (*Move photo {position} ({name}) up*) and
   `import.movePhotoDownLabel`, and a photo's remove
   `import.removePhotoLabel` (*Remove photo {position} ({name})*). ja and tc
   count a photo as 枚目 and 張, where a file is 番目 and 個. Any other
   file's remove keeps `import.removeFileLabel` (*Remove file {position}
   ({name})*), numbered among the files that are not photos, so
   `[rows.csv, image.jpg, rows.csv]` reads *Remove file 1*, *Remove photo 1*
   and *Remove file 2*. `import.moveFileUpLabel` and
   `import.moveFileDownLabel` leave all three catalogs: only a photo moves. A
   screen reader now hears the number a sighted reader sees.
5. **The number is read directly, not through `@let`.** Each of the six
   places a row needs its photo's number — the badge, both arrows'
   `[disabled]` and the three names' `position` — reads `photoNumber(file)`,
   a lookup in the map `places` already holds. A `@let` would be the app's
   first, and Angular's let instructions would land in the shared core chunk,
   which is initial although the dropzone is lazy: that chunk grew by 304 B,
   and the initial total stood at 2,415,068 B, 68 B over the 2.415 MB
   warning. With the direct reads it measured 2,414,843 B.
6. **Focus stays with a photo a move lands at either end.** A move that left
   a photo at the top or the bottom dropped keyboard focus to the page, since
   the pressed arrow is disabled there and a disabled button gives up focus;
   the first browser run found it, older than this record. Rows now carry
   `data-row` with their index, and the arrows `data-move="up"` and
   `data-move="down"`, as the dashboard's layout panel's arrows do.
   `swapWithPhoto` asks for focus on the moved photo's row at its new index:
   on the arrow pressed while the photo can still go that way, else on its
   other arrow, else on its remove. It asks after every swap, since a swap
   can also drop focus from an arrow that stays enabled. A drag moves no
   focus; it is a pointer gesture.

   The request goes through `focusWhenRendered` (*One shared helper per job*,
   item 11), which moves focus wherever it is by then. `household-focus.ts`'s
   helper of the same name moves focus only when it has fallen to the
   document or sits on the control the swap was chosen in, and would leave it
   on an arrow a move has just disabled (Things that only became apparent
   while building).
7. **The wizard sends the photos in badge order.** `processFiles` in
   `import-wizard.component.ts` filters the selection with
   `looksLikeImageFile`, in list order, and hands those photos to the reader,
   and the zone emits its whole list on every move and drop, so the wizard
   needs no change of its own. The wizard's spec drops
   `[a.png, ledger.csv, b.png]` on the real zone, presses b's up arrow, and
   reads `[b.png, a.png]` as the photos Process hands
   `importFromMultipleImages`; before the change they were `[a.png, b.png]`.
8. **A removed file hands focus to its neighbour.** The remove pressed goes
   with its row, and a focused button taken out of the page drops focus to
   `<body>`; the last file's remove takes the whole list with it. The second
   browser run found it with a click and with Enter, and it is older than
   this record. `removeFile` finds the row after the removed one, else the
   row before it, while both are still listed, and asks `focusWhenRendered`
   for that row's remove by its new place; once nothing is left it asks for
   Browse, which comes back with the empty zone. The review card's
   `takeRowOff` hands a removed row's focus on the same way. A click moves
   focus too, as a click on an arrow does, so on WebKit, where a tap
   focuses no button, a tap's remove puts focus, and Material's focus state
   layer, on the next remove. Nothing is announced: the remove that takes
   focus reads the file now in that place.

### The emulator proofs

Two smoke cases in `import-wizard.smoke.spec.ts` follow the upload area into
the emulators, and the walkthrough in `app.smoke.spec.ts` sweeps three places
no pass had looked at. Each new case and sweep is a pin, written after its
fix and seen red under a named change.

- **A CSV dropped on the empty upload area is imported.** `dropOnTheZone`
  dispatches a bubbling `DragEvent('drop')` carrying a `DataTransfer` on
  `app-file-dropzone .dropzone`: the zone is no control of its own, and the
  drag listeners sit on the frame around it. With no provider configured, the
  CSV's two rows are read, reviewed and confirmed, and `getDocs` finds both
  stored with their descriptions, amounts and type. With the frame's `(drop)`
  binding removed, nothing is selected: the host answers a click and never a
  drop.
- **A mixed pick stores its photos in badge order.** `[a.jpg, csv, b.jpg]` is
  dropped, each photo with bytes of its own (`ff d8 61 d9` and
  `ff d8 62 d9`), and the badges read 1 and 2. b's up arrow, checked to carry
  `import.movePhotoUpLabel`, is clicked, and the rows read `[b, csv, a]`.
  Karma serves no catalog, so the name reads as the bare key on both sides of
  that check, whatever position and name it is filled with; the dropzone's
  spec holds the number and the name. The receipt reader is stubbed to answer
  the two photos as two receipts dated today, so neither asks about its date,
  and `importFromMultipleImages` is spied through: it is called once, with
  `[b, a]` by name, since Jasmine's equality finds two Files equal whatever
  they hold. On Import three rows land, and each receipt keeps one photo. The
  bytes `getBytes` reads back from the Storage emulator at
  `users/<uid>/receipts/<id>` are b's for receipt 1, read from photo 1, and a's
  for receipt 2; the CSV's row holds no `receiptUrls`. `ReceiptQuotaService` is
  stubbed, since its check reads Remote Config, which has no emulator. With the
  move swapping by list index, b trades rows with the CSV, the photos are read
  as `[a, b]`, and each receipt stores the other's bytes.
- **The forecast's words.** After the forecast case on `/reports`,
  `app-forecast .forecast-header` and `.forecast-summary` are audited in
  view, once per scheme.
- **The Goals tab.** A goal is written through the client, so the rules check
  its shape: a target date, linked money beside its contributions, two items
  with one done, and a note. `/budgets?tab=goals` then has its page pass, and
  the goal card's `.goal-header`, `.goal-progress` (the target, the linked
  breakdown and the status), `.goal-items` and `.goal-note` are audited in
  view. The goal is deleted in a `finally`, so the pages after it read what
  they read before. The tab is opened from the dashboard, after its Upcoming
  sweep, not straight after the Recurring tab: `BudgetsComponent` reads
  `?tab=` once, as it is built, and the router reuses the page from
  `/budgets?tab=recurring`, so a second visit stayed on Recurring.
- **The empty upload area.** `/import/file`, which has no guard, has its page
  pass with nothing picked, and then `app-file-dropzone .dropzone-content` is
  audited in view. The zone itself cannot be: an in-view pass throws unless
  the whole node lies in the band axe can score, from under the 64px header
  to the frame's 413px bottom, and the zone, once centred, spans 356px, 28 to
  384px, 7px more than that band. The zone's padding makes the difference,
  and its contents hold every word and Browse.

With a 0.4 fade on the words of each swept part, every new in-view audit
failed in both schemes, and the page passes missed the goal card's status,
items and note and the zone's hint, all below Karma's fold. With the resting
fades that #533 took out of the goal card and the forecast put back, the
sweeps pass: those fades painted above AA. The sweeps hold an AA floor on the
parts that had them; `opacity:check` and the painted unit cases hold the
muted token. The walkthrough's header now lists the Goals tab, the Forecast
tab's header and summary, and `/import/file` among the routes it reaches, and
leaves `/lock`, `/ai`, `/search-history` and `/import/history` unvisited.

## The gates

Each class this record fixes that one file can show becomes a gate, or widens
one ([0145](0145-a-class-found-by-reading-becomes-a-gate.md)), but six. Five
are Known gaps: a button whose only text sits inside an `@if`, two sibling
controls under one bare key, a control inside a dialog's title, a hidden file
input inside the element whose click asks it, and a hand-off made outside
`import-focus.ts`, which passes a held key on. The sixth, an `outline: none`
with nothing in its place, has a gate that was put off (What was rejected).
The freezes those gates keep are empty, `icon-labels:check`'s two and
`i18n:check`'s `RAW_DESCRIPTIONS_FROZEN`, and `opacity:check`'s `ALLOWED`
holds one row, the sign-in card's tagline, with its count and its reason,
which is the one way
[0151](0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)
lets a finding join a list (*Resting text is a token, and a resting fade is
a gate*, item 5). Each script runs its self-test before its run. Run as they
stand now over 26.11.181's own tree, `icon-labels:check`, `opacity:check`
and `i18n:check` each find exactly the defects this record fixes there,
beside `i18n:check`'s report that one of its guarded rows names a line that
tree does not hold yet; over this record's tree, none beyond
`opacity:check`'s one recorded row.

**A spec that sets no expectation fails**, in every Karma run (*A spec that
expects nothing fails, and a test run says only what it means*, item 1). No
script and no CI step changes: `ci.yml`'s *Unit tests*, *Date specs (non-UTC
zones)*, *Smoke test (Firebase emulators)* and *Smoke date specs (non-UTC
zones)* steps carry it as they are. Such a case printed *has no expectations*
as a warning and passed; it fails now with *Spec has no expectations*. On
26.11.181 two smoke cases printed that warning, the rules denial and the bill
link, and no unit case did.

**`icon-labels:check`'s sixth rule reads a component another template repeats
and a ternary between two bare keys, and its eighth reads every slider's
thumbs** (*The eighth rule reads every thumb, and the sixth reads a card its
parent repeats*), and both its freezes are empty. Over 26.11.181's tree the
widened sixth rule finds 32 controls, the 28 it had frozen, the goal card's
two and the two pin buttons, and the eighth finds the slider and the switch.
Since the reading of the whole branch the sixth also follows a held-apart
case into the components it stamps, at any depth, and reads a ternary whose
last branch is piped bare. Neither finds a control in either tree, though
the first keeps the empty state, which four cards stamp, in the
cross-template set. A new hit fails the build, and joins a list only as a
row with its count and its reason. It runs in `ci.yml`'s *Check icon labels*
step, as before.

**`opacity:check` fails a resting fade** (*Resting text is a token, and a
resting fade is a gate*, item 5). `package.json`'s `opacity:check` runs the
self-test, then the run, and `ci.yml`'s `ci` job runs it as *Check resting
opacity*, after *Check reduced motion* and before *Check colour contrast*.
`contrast:check`'s header and the README's Scripts table point to it. Over
26.11.181's tree it finds the eleven fades of #533 and nothing else. Since
the reading of the whole branch it also fails a fade beside a disabled
control, and the frame an animation's fill mode holds, and reads every
inline template and stylesheet of a file and the arbitrary `[opacity:…]`
utility; what it finds over both trees is unchanged.
[0186](0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)
kept fades out of the gates because scoring one needs the colour painted
behind it, which `contrast:check`'s table does not hold. This gate scores no
fade: it refuses one, and one file shows that.

**`i18n:check` fails two sentences joined in code with a literal stop** (*Two
sentences join in the reader's own stop*, item 5). Over 26.11.181's tree it
finds one join, `joinSentences`' own Latin stop in `import-review.utils.ts`;
[0099](0099-the-review-step-edits-what-it-shows.md) and 0186 each recorded
the class as a gap. `npm run i18n:check` chains the self-test before the run,
and `ci.yml` runs it in the *Check translation keys* step, as before.

**`i18n:check` fails a translated slot filled with a raw description**, the
class this record fixed by reading and the third run met again on the
household overview (*What reading found*). A description can be blank, and a
name or a sentence that quotes one then has nothing where the item goes. A
slot whose value is a description read straight off a value
(`view.transaction.description`, `transaction().description`,
`row?.description`) fails, in a translate pipe's parameters and in a `t(`
call's object, in an `.html` file, an inline `template:` string or a `.ts`
file's code, comments masked. The slot reads `transactionDisplayName` for a
transaction, or the review card's `announceDescription` for an import row.
Over 26.11.181's tree it finds six: the household overview's goal button, the
transaction list's two menu triggers, its row checkbox and its delete
confirm, and the transaction row's own button, each fixed here.
`GUARDED_DESCRIPTIONS` allows six slots on the review card, each by its file
and its line's text, with a count and the reason it cannot be blank where it
is read, `announceDescription`'s own quoted branch among them;
`RAW_DESCRIPTIONS_FROZEN` is empty. The run prints *Checked 437 files for a
translated slot filled with a raw description (6 rows allow 6 guarded slots,
0 frozen by name).*, and the success line gains *no translated slot is
filled with a raw description where it can be blank*. It has no number, and
runs in the same step. The self-test, 188 cases when the literal-stop rule
landed, is 201 with this one. What it cannot see is under Known gaps.

**A catalog quotes a description only where its caller never hands it a
stand-in**, in `translation-keys.spec.ts`, which runs with the unit suite. A
key whose own quotation marks sit round `{{description}}` quotes whatever its
caller hands the slot, and most callers hand the catalog's words for an
untitled item when the description is blank. A case per catalog, *quotes a
description in {locale} only where its caller never hands it a stand-in*,
fails any such key not in `QUOTES_A_REAL_DESCRIPTION`, which lists seven,
each with why its caller never hands it one: the four confirms, which read
`isUntitled`, and the review card's split, merge and remove triggers. A
second case, *lists only keys some catalog still quotes a description in*,
fails an entry no catalog needs. Before the third run's fix the tc case
named 23 keys, and the en and ja cases passed (*Run 3, on 6 November 2026*).

**The track ban covers `.preview`** (*The eighth rule reads every thumb, and
the sixth reads a card its parent repeats*). The template selector in
`eslint.config.js`'s `no-restricted-syntax` widens from `\.name\s*$` to
`\.(name|preview)\s*$`. At the change the only other key read from a file's
content was the wizard's `preview.url`, an object URL made once per file,
which passes. `lint-guards:check` holds the same selector as a plain string,
so a drift between the two fails. `npm run lint` and `lint-guards:check` run
in `ci.yml`'s *Lint* and *Check lint guards* steps, as before.

## What was rejected

- **A polyfill, or a `karmaConfig`, for the strict flag.** The builder
  splices the test polyfills in at the head of Karma's file list, ahead of
  jasmine-core, so a polyfill runs before `jasmine.getEnv()` exists. A
  `karmaConfig` could pass the flag through `client.jasmine`, which
  karma-jasmine's start hands to `configure`. But naming one replaces the
  builder's built-in configuration whole, its plugins, coverage reporter,
  reporters and launchers, with a file the repo would then own, and
  testing.md's *there is no `karma.conf.js`* would stop being true. A test
  `main` loads after jasmine-core and before the specs, and karma-jasmine's
  start merges a configuration that does not name the flag.
- **Serving the fonts to Karma.** The test target publishes
  `src/assets/icons` now, so the About page's icon loads and its 404 is gone.
  The faces in `src/assets/fonts` stay unserved, by decision. Every spec
  measures in the machine's fallback face: a width spec pins Verdana so that
  a Mac measures as the CI runner's DejaVu Sans does (testing.md, *Karma
  serves no fonts*), and axe reads an icon's ligature as 16 to 18px text and
  holds it to 4.5:1, the bar the upload area's refusal glyph was raised to
  here. Serving PT Sans and the icon font would move each of those
  measurements at once, in a change about log lines. The font 404s stay in
  the output, and any other 404 is a finding.
- **A test-side interpolator.** `catalogTranslator` could have walked the
  JSON and filled `{{…}}` itself, as the specs that read real words each did.
  That is another copy of the service's walk, its plural rules and its
  interpolation
  ([0171](0171-second-copies-fold-into-one-copy-of-each-helper.md)), and a
  spec reading it could pass where the app renders something else.
  `translateFrom` is `TranslationService.t`'s own walk, extracted with its
  existing cases passing unchanged, and the service and the specs both call
  it.
- **An echoed separator key in the stubs.** Echoing
  `common.sentenceSeparator` as its key glues the sentences round it into one
  token: the review card's overflow specs read
  `import.verifyTypecommon.sentenceSeparatorcommon.expense` where they
  matched `import.verifyType. `. The wizard counts a round notice's sentences
  to keep it on screen 2000 ms longer for each past the first, and an echoed
  join reads as one sentence, so a two-part success notice would drop from
  5000 ms to 3000 in every spec while it lasts 5000 on screen. A separator is
  punctuation, not words. The stubs answer that one key with en's own `". "`,
  and the ja catalog cases, beside one that reads each catalog's separator,
  are what guard the join (*Two sentences join in the reader's own stop*,
  item 4).
- **`[attr.aria-label]` on a toggle.** `mat-slide-toggle` renders its switch
  as a `role="switch"` button inside itself and hands that button its
  `aria-label` and `aria-labelledby` inputs; its own host bindings write
  `null` to the host's `aria-label` and `aria-labelledby`.
  `[attr.aria-label]` writes on the host, not on the button a screen reader
  lands on, so the switch would stay unnamed. The Auto sync switch takes the
  literal `aria-labelledby="auto-sync-label"` input, as the dashboard layout
  settings' toggles take theirs, and the eighth rule counts no
  `[attr.aria-label]` as a toggle's name. A slider thumb is a native input,
  so there the binding does name it.
- **Keeping the zone as the button and dropping Browse.** It would end the
  nested control too. But a button's content is presentational to assistive
  technology, so the zone's title, hint and file types would reach a screen
  reader only through the zone's one name; the zone would keep its own Enter
  and Space handlers where a native button turns either key into one click;
  and the page would lose the button it shows. The zone takes 0151's row
  shape instead: the frame answers a pointer through the host, and Browse is
  the keyboard's and the screen reader's route, described by the hint.
- **`cdkDropListSortPredicate`.** CDK's sort moves every sibling between a
  dragged row's old place and its new one (`moveItemInArray` over its
  siblings), and the predicate only answers whether one index may be the
  target, so no predicate can keep a CSV where it is while a photo crosses
  it. The drop is remapped instead: the photos are read off in the order
  CDK's move gives them and written back into the photo slots. The cost is
  that a CSV slides while a photo is dragged across it, and snaps back on the
  drop.
- **The wizard's `import.*` keys in the camera.** A capture shows the reader
  no file name: the camera's strip numbers its thumbnails, each with
  `receiptImages.imageNumber` as its alt (*Receipt image 2 of 3*). The
  wizard's keys name a file by its name and its place among the photos, and
  the camera belongs to the transactions feature, which would then borrow the
  import area's words. The camera, the receipt manager and the transaction
  form take `receiptImages.*` keys, numbered as their thumbnails' alts are.
- **A new `contrast:check` pair.** #533 asked for any new pair to join it.
  The script scores the tokens `styles.scss` declares. The goal card and the
  forecast are `mat-card`s, which paint Material's
  `--mat-sys-surface-container-low` (`#f4f2fc` in light, `#1a1b22` in dark),
  a token `mat.theme()` generates and the table cannot hold; its
  `--surface-card` rows score white in light, which neither card paints. The
  Goals hint's pair, `--text-muted` on `--surface-background`, is a row
  already, scored as captions on the page. The painted cases are the measure:
  each line, in four palettes, on the surface Chrome paints.
- **Word tables.** Nothing here reads a word, in any language
  ([0008](0008-universal-receipt-language-support.md)). The join takes the
  reader's stop from the catalog's `common.sentenceSeparator`, not from a
  table of locales and their stops. The literal-stop rule and the wizard's
  sentence count read punctuation. The sixth rule fails a key's shape, one
  with no parameters, not a list of words such as *Edit* and *Delete*. And
  each name is filled from what the reader sees on its item: a description, a
  query, a name or a number.
- **Material's delayed focus trap.** Spread whole, Material's dialog defaults
  would also have brought back its `delayFocusTrap`, which holds the trap
  until the 150ms entrance ends. The app's partial options left the key
  undefined, and every dialog has trapped focus at its first render since
  they were written, in July 2026. In those 150ms the trigger keeps focus
  and the page behind is not yet hidden from assistive technology, so a key
  typed straight after the press that opened a dialog, the first letter
  typed into the command palette its shortcut opens or a second Enter on the
  trigger, would reach the page behind the backdrop. `provideAppDialogs()`
  keeps the immediate trap by name, and a pin holds focus inside a dialog
  before its entrance ends. The window was reasoned from Material's code,
  not measured.
- **A container query, or a media query in rem, for the budget row.** The
  iOS app's WebView goes back to iOS 15, which has no container queries, and
  would keep the two fields side by side whatever their room, as the upload
  area's own query records for its rows. A media query's rem is the
  browser's initial font size, not the root's, so it never sees the text
  size Settings sets; and the app marks that size with a variable on
  `<html>`, not a class, and a class would read the size rather than the
  room. A flex basis in both units reads the room itself.
- **Dropping the quotes from the four confirm keys.** Unquoted,
  `transactions.deleteConfirmMessage`, `transactions.deleteSplitPartMessage`
  and the two stop-sharing messages would read the stand-in naturally, but a
  real description would then read as part of the sentence, and the app's
  other confirms that name what they delete quote it: a budget's, a goal's,
  a category's and a recurring rule's. A titled transaction keeps its quotes,
  and an untitled one has sentences of its own.
- **Opening the save-search box empty.** It would show the box's
  placeholder, *Name this search...*, and not the name Enter alone saves it
  under, the query. The box keeps the query as its suggested name and opens
  with it selected, so a typed name replaces it.
- **Dropping 「」 from tc's names.** It needs no code and no key, but every
  titled tc name would lose its quotes, *查看Hardware store的備註*, and a
  description that begins with a word of the sentence would run into it,
  *從從台北到台中移除建議的地點*: the reason the confirms keep theirs. Every
  titled reading stays as it was; only the stand-in loses its marks.
- **An untitled sibling key for each name.** Twenty-three keys in each of
  the three catalogs, 69 entries, 46 of them en and ja copies of the titled
  sentence with the stand-in written in, and a branch at each caller, nine in
  templates. The confirms needed sentences of their own because en and ja
  quote there too; here only tc's marks differ, and one key of punctuation
  carries them.
- **Routing the review card's split, merge and remove triggers through
  `announceDescription`.** Their tc keys still quote `{{description}}`
  themselves, and a blank row never reaches them: its split and remove are
  named `import.splitRow` and `common.remove`, and merge is not offered for
  one. They follow the rule as they stand, and the catalog case lists them
  with that reason.
- **Restoring focus past a menu at each door.** A `restoreFocus` naming the
  trigger, or a helper called beside each `open()`, would touch 13 call
  sites in eight files, some reached through outputs and a root service that
  doors outside a menu use too, and the next door would forget it; no source
  gate can tell an `open()` reached from a menu. A default `restoreFocus`
  is one value for every dialog, and a selector resolved against the whole
  page at close restores nothing when it matches nothing. The container's
  config is Material's private state, which the repo reaches nowhere.
  Opening a menu's dialog after the menu has closed would reorder every
  handler and reopen the window the immediate focus trap closes. The rule
  reads public API alone: `MatDialog.afterOpened`, `afterClosed` and the
  `aria-controls` the menu's trigger carries while it is open.
- **`aria-controls` on Save search.** No template under `src/app` carries
  one, the filter toggle beside it takes none, the row it would name is off
  the page while the box is closed, and `icon-labels:check`'s seventh rule
  reads only a literal reference, so a bound one would go unchecked.
- **A gate on an `outline: none` with nothing in its place.** A textual
  pairing, the selector also given a `:focus-visible` rule or a
  `frame-ring` include, proves a rule is written, not that it paints: a
  selector that outranks it would pass. The tree holds three sites, all
  paired: the review card's `.notes-input`, beside its own `:focus-visible`
  rule, and the filter panel's two boxes, through `frame-ring`. A case that
  reads the stylesheet's rules holds the filter panel's two; none holds the
  review card's (Known gaps). It is cheap, and may come later as its own
  change, with a self-test.

## Consequences

- **A reader** sees the goal card's seven resting lines and its glyph, the
  forecast's three and the Goals tab's hint at full strength in
  `--text-muted`, which high contrast now strengthens where a fade dimmed
  whatever it strengthened. A reached goal's note reads in the card's own
  colour. In a pick that mixes photos and a CSV the badges count the photos
  alone, and a photo's arrow or drop steps past a CSV, which stays where it
  was picked. The upload area's refusal glyph takes its message's colour, a
  darker red in light and a pale pink in dark. The budget dialog stacks its
  period and its start date wherever their row cannot hold the start date's
  label beside its calendar button, on a phone, in a window under about
  505px and in a desktop's dialog at Large and Extra large text, so the
  label is whole, short of a 320px phone at Extra large (Known gaps); the
  review card's split field's hint reads *Split amount*;
  and the Tags hint, in the filter panel and in the transaction form, reads
  *Enter to add*. The filter panel's search suggestions no longer scroll
  sideways. A tab strip opened on a `?tab=` link keeps its tab whole when a
  count widens a label after it opens, or the strip narrows, and a reveal
  never moves the page round the strip. The keep-date and currency-offer
  buttons' tooltips show their whole names, which open with the words their
  chips show.
- **A keyboard user** meets one stop on the empty upload area, Browse, where
  there were two that did the same thing, and Enter or Space opens the picker
  once. The ring is drawn round the zone while Browse has keyboard focus, 2px
  and 3px under high contrast, so it sits in the room the wizard's padding
  leaves for it. A photo moved to either end of the list keeps focus on its
  row: on the arrow pressed while the photo can still go that way, on its
  other arrow once it cannot. Removing a file leaves focus on the remove of
  the file that takes its place, the one before it for the last file, and
  on Browse once none is left. The Data page's backup upload area opens the
  picker once per press or click, and Space no longer scrolls the page. In
  the filter panel Clear all leaves focus on the filter toggle, and a
  suggestion applied from the keyboard leaves it in the search box. Save
  search moves focus into its box with the suggested name selected, so a
  typed name replaces it; Enter, Save, Cancel, Escape or a second press on
  Save search close the box and hand focus back to Save search, or to the
  search box once an emptied query has taken Save search away. Each of the
  filter panel's text boxes draws the ring just inside its pill while it
  holds focus, reaching 1px past the pill under high contrast, and whichever
  pill sits last over the filter grid ends 12px above it, so the ring stays
  clear of the grid's floated labels (*Run 4, on 6 November 2026*).
  In the upload area, the filter panel and the review card, a held
  Enter on a control that hands focus on presses it once: no repeat presses
  the control the hand-off has just moved focus to, so it neither empties
  the upload list nor reopens the save-search box. Closing a dialog a
  menu's entry opened, by Cancel, Escape or the backdrop, leaves focus on
  the menu's button, where it fell to the page before.
- **A speech-input user** reaches the review card's keep-date and
  currency-offer buttons by the words their chips show: each name opens
  with the chip's question, then its reason, in en, ja and tc. While the
  save-search box is open a voice command for *Save search* closes it
  unsaved, as the disclosure pattern makes it do, and the box's own button
  is *Save*.
- **A screen-reader user** hears each per-item control name its item. The
  review card's fields and buttons carry the row's description (*Notes for
  Coffee*), and an untitled row reads *an untitled row*. The camera's, the
  receipt manager's and the transaction form's image controls carry the
  image's number, as its thumbnail's alt does, the manager's with the
  transaction's description (*Remove image 2 of Lunch*), and the form's say
  *new* or *stored*, since both strips show in edit mode. Feedback, saved
  answers, goal items, recurring groups, saved and recent searches and the
  list's note and receipt buttons name theirs, and the goal card's pair says
  *Edit {name}* and *Delete {name}*. A transaction with no description is *an
  untitled transaction* on its row's controls, in its note and share dialogs,
  in the receipt viewer and on the household overview's goal button, and its
  delete and stop-sharing confirms ask about *this untitled transaction*, or
  *this untitled part* for a split part, unquoted. In tc a name quotes a
  description in 「」 and reads the stand-in bare. Save search says whether
  its box is open, and the box's own button reads *Save*. Every dialog is a
  `dialog` with Material's `aria-modal="false"`, since Material hides the page
  behind it from assistive technology with `aria-hidden` instead. Each is named
  by its title alone: the 19 drawn with the shared header no longer end their
  names in *Close*. The keep-date and currency-offer buttons are described by
  nothing, so their reason is heard once. A photo is named by its number among
  the photos (*Move photo 1 (image.jpg) up*), and a CSV's remove by its number
  among the other files (*Remove file 1 (statement.csv)*). The alert slider's
  range input and the Auto sync switch read their labels' words, Sign out keeps
  its name at 480px and below, and the empty upload area is no longer a button
  around a button: Browse is the control, described by the hint, and the zone's
  title is a heading one level under the page's. The transactions filter toggle
  says *Filters*, or *Filters, 2 active*, and whether the panel is open.
- **A ja or tc reader** reads two sentences joined in 。, with no Latin `. `
  after a Japanese or Chinese sentence: the review card's date chip, the
  form's verify tooltip, the wizard's round notice and the dropzone's alert,
  all through `joinSentences(t, lead, next)`. The keep-date button's name
  opens with the chip's question, so its question and reason meet at ？
  with nothing after it. Each new name is written in its catalog's own idiom
  (ja `「{{name}}」を編集`, tc `編輯「{{name}}」`), and the Tags hint reads
  `Enter で追加` and `按 Enter 新增`, which fit both its fields.
- **The next person who adds a per-item control** gives its name a slot for
  the item, a key with parameters filled from what the reader sees on it. A
  bare key, or a ternary between two, fails the sixth rule whether the
  control repeats in its own template or in a component another template
  repeats, and no freeze takes it in without a count and a reason. A toggle
  takes the `aria-label` or `aria-labelledby` input, and a slider names each
  thumb. A name that carries a transaction reads `transactionDisplayName`,
  or `quotedTransactionName` where only some catalogs quote it: a raw
  `.description` in a translated slot fails `i18n:check`, and a key that
  quotes `{{description}}` itself fails the catalog spec unless its caller
  never hands it a stand-in. Its pin reads the name through
  `accessibleName`, in en, ja and tc through `catalogTranslator`.
- **The next person who opens a dialog** passes only what differs for it.
  The root's options are Material's own with three keys changed, and a
  second provider of the token fails `app.config.spec.ts`. A dialog's title
  holds words and at most an `aria-hidden` glyph: whatever sits inside
  `mat-dialog-title` becomes part of the dialog's name, and only the shared
  header's spec holds that (Known gaps). A dialog a menu's entry opens needs
  nothing at the door: the root's rule gives focus back to the menu's
  trigger once it has gone.
- **The next person whose handler takes away the control it was pressed
  from** hands focus on, through `focusWhenRendered`, to the control that
  takes its place, and holds it in a case that renders the real template,
  as the upload area's removes and the filter panel's closes are held. The
  helper also drops a held key's repeats where focus lands; a hand-off made
  any other way has its new control pressed by every repeat of a held
  Enter. No gate reads a rendered focus loss or a held key (Known gaps).
- **The next person who adds a fade** rests the line in a token at full
  strength instead. `opacity:check` passes a fade only in a keyframe no fill
  mode holds, on or inside a disabled control, or in a drag; any other
  needs an `ALLOWED` row that matches its file's count, with its reason, and
  a label beside a disabled control takes `--text-disabled`.
- **The next person who writes an empty `it()`**, or a case whose only check
  is a wait, sees it fail in every Karma run, unit, date and smoke alike. A
  case that waits for an outcome waits for something every outcome reaches,
  then expects the one it wants, as the two bill-link cases do.
- **The next Angular CLI upgrade re-reads `src/test-main.ts`.** Naming a test
  `main` replaces the test-bed init the Karma builder generates, so a change
  the CLI makes there, a new option or a different arm with or without
  `zone.js`, reaches no spec until the copy follows it. The file's header
  asks for that re-read, and its coverage exclusion stays beside it. The
  harness pins catch a setting the copy loses, not one the builder adds
  (Known gaps).
- **Test runs say less.** `test:dates` prints no AngularFire
  injection-context advisory: the ten unit specs that reach a zone-wrapped
  AngularFire call use the silence helper of
  [0088](0088-the-smoke-harness-owns-the-noise-it-makes.md), whose caller
  list is amended to name them. `test:ci` logs no 404 for the About page's
  icon, where it logged nineteen, and the budget form's spec no longer prints
  its failed save's error. The font 404s stay, by decision.
- **The initial bundle grows.** The names the camera, the transaction form
  and the search dialog build are in initial chunks, and so are
  `translation.service.ts` and `import-review.utils.ts`, which hold the
  catalog walk and the sentence join, and the receipt viewer, which the form
  reaches, with its display name. The initial bundle read 2,415,396 bytes
  before the second browser run's fixes, 908 more than `26.11.181`'s
  2,414,488 and 396 over the 2.415 MB warning, so the warning moves to
  2.416 MB in both deployable configurations, the whole kilobyte above the
  figure. Of the 908, 171 are the stylesheet's, a Tailwind utility no code
  of this work asked for (Known gaps), and 78 are a chunk of its own for the
  display name, which four chunks import. The second run's fixes add 343
  more, for 2,415,739, 261 under the warning, which does not move: most of
  it is the shared dialog header's row, 270, the dialog options in a file of
  their own, 180 there against 153 out of `app.config.ts`, and `isUntitled`,
  49. The stylesheet is unchanged by them. The third run's fixes and the
  reading of the whole branch add 519 more, for 2,416,258, 258 over the
  warning, so it moves to 2.417 MB in both, 742 bytes above the figure.
  Input by input, against the 2,415,739-byte build, the dialog options' menu
  rule took 278, the focus test it reads 136, `quotedTransactionName` 95 and
  the question rule in `joinSentences` 82, and the inputs sum to 602 more
  where the files on disk took 519. The stylesheet is unchanged by them too.
  [../performance.md](../performance.md) holds the figures input by input.
- **The version is 26.11.182**, in `package.json` and its lockfile.
- **Where it ships.** Every change ships with the web deploy and reaches the
  iOS app's web layer with its next build. No Swift, rules or functions code
  changed.

## What the browser runs found

### Run 1, on 3 and 4 November 2026

The first run drove the branch with every change for the six issues in and
none of the fixes below. It ran against the local emulators (auth, Firestore
and Storage, project `demo-home-account`) and the app served from the
emulator configuration, `npm run start:emulators`, on port 4300, signed in as
a seeded account. It read the page at 1024×768, and by emulation at 1280 and
375px, in en, ja and tc, light and dark, and under high contrast. No vendor
was contacted and no key typed or stored.

- **The regressions held under the new names** ([../e2e.md](../e2e.md)).
  Journey 79 step 5: at 375px the card 273px wide and its content 189; one
  Tab from the step header lands on Browse, which is `:focus-visible`, while
  the ring is drawn on the zone, ring 4 with room of 8, 5, 149 and 5, and
  ring 5 under high contrast; the zone has no role, no tab stop and no
  `aria-label`. Journey 87 step 4: the mid-run photo's row is removed by its
  new name, *Remove photo 1 (e2e-87-midrun.png)*. The press was made from the
  console in the same step that took the page offline, so that step is
  diagnostic-grade: the app's reachability check, which runs when the page
  becomes visible, had put it back online before a pointer press landed.
  Journey 88 step 6: the 11 MB file refused in an `alert` brought into view,
  outside a zone that has no role now, its glyph painted `#b91c1c`. Journey
  100, all five steps, in en and ja. Journey 109 steps 1 to 3 and 6 to 7:
  *Remove photo 1 (e2e-109-shared.png)* beside *Remove file 1
  (e2e-109-statement.csv)*, the CSV numbered among the files that are no
  photo; two photos called `image.jpg` named *Move photo 1 (image.jpg) up*
  through *Remove photo 2 (image.jpg)*, in ja
  `1枚目の写真（image.jpg）を上へ移動` and in tc
  `移除第 2 張照片（image.jpg）`; at 375px both rows a grid with a 129px name
  column, at 1280 both on one line.
- **Journey 111 held: the upload area's one control.** Tab from the step
  header lands on Browse, described by the hint, *Supports CSV, PDF, images,
  and JSON backups*, and the ring goes round the zone and not round Browse.
  With the picker counted and never opened, Enter and Space on Browse each
  ask once and Space scrolls nothing; a click on the title, on each of the
  four file-type chips, on the zone's padding or on Browse asks once; a click
  outside the zone asks nothing. A CSV dropped on the zone lists one row,
  *Remove file 1 (e2e-111.csv)*, and a click on the list asks nothing. Under
  high contrast the ring is 3px, with at least 8px of room; in ja Browse is
  *ファイルを選択* with the hint in Japanese.
- **Journey 112 held: photos numbered among photos.** A CSV, then two photos:
  badges 1 and 2, the CSV row with no badge, no arrows and no handle; a real
  drag of photo 2 by its handle above the CSV swapped the photos and left the
  CSV first. A pick of a photo, a CSV and a photo: the badges 1 and 2 either
  side of the CSV, and a real click on *Move photo 2 (e2e-112-b.png) up*
  swapped the photos past it, the CSV unmoved. The names in ja and tc carry
  the same numbers.
- **Journey 113 held: a goal card at rest.** Every line the card used to
  fade, and the date's glyph, reads opacity 1 and the palette's
  `--text-muted`, painted at the four ratios *Resting text is a token, and a
  resting fade is a gate* gives, on the card and, for the Goals hint, on the
  page. The pair reads *Edit e2e-113-goal* and *Delete e2e-113-goal*,
  *「e2e-113-goal」を編集* and *編輯「e2e-113-goal」*.
- **Journey 114 held: the forecast's notes.** The note and the rate caption
  over 30 days, then the bucket note at 90 days over this year, *Each point
  covers 7 days, ending on the date shown.*, each at the card's four ratios;
  the chart's ticks followed the muted token in each palette.
- **Journey 115 held: names that tell items apart.** The budget dialog's
  range input resolves *Alert when spending reaches*, with the value left to
  Material's `aria-valuetext`; the AI page's switch reads *Auto-sync when
  online*; Settings at 375px keeps *Sign Out* in a 1px clipped label. After a
  two-row import every review-card field names its row, *Description of
  e2e-115 coffee beans* through *Notes for e2e-115 bus pass*; a re-import's
  buttons read *Not a duplicate — import e2e-115 coffee beans*; the searches'
  removes read *Remove saved search e2e-115 saved bus* and *Remove recent
  search e2e-115 coffee*; the list reads *View note for e2e-115 noted lunch*
  and *View receipt for e2e-115 noted lunch*; the goal form reads *Delete
  item 1* and *Delete item 2*.
- **Journey 116 held: the reader's stop**, diagnostic-grade, with Gemini
  answering from the page ([../e2e.md](../e2e.md)). In ja, a receipt dated
  another day: the keep-date button's and the date chip's names join their
  sentences with 。, with no `. ` and no `。。`; the form scan's verify
  tooltip on a doubted date reads the same way. The keep-date button's name
  now opens with the chip's question, so its two halves meet at ？ with
  nothing after it (*Run 3, on 6 November 2026*).
- **The sweep**, at 1280 and 375px in three languages and both schemes, over
  the empty upload step, a mixed pick, the review card with every field open,
  Settings, the budget dialog, the AI page, the Goals tab, the forecast, the
  filters' search suggestions and the receipt image manager, found, apart
  from the defects below, nothing scrolling sideways, no word broken across
  lines and no control overlapping another. Every per-item control read its
  item's name in all three languages. Axe found no violation, and a
  painted-contrast walk of the dark pass found no text under its bar. Axe's
  best-practice `heading-order`, outside the suite's gate, fired on the empty
  upload step and on a mixed pick: the zone's title, a heading once the zone
  lost its role (*The upload area has one button*, item 3), and the photo
  previews' heading, below.

The console could not be read over the whole sweep. In the development build
AngularFire's injection-context warnings fill it, and the earlier messages
were gone before they were read. The sweep and both dialogs were driven again
with a hook on `console.error`, `onerror` and `unhandledrejection`, and it
caught none.

It met five defects, all older than this wave, and each is fixed here with a
spec red before its fix.

- **The transaction filter toggle was named only by its badge.**
  `button.filter-toggle` carried no `aria-label`, no title and no
  `aria-expanded`; its content was the hidden `tune` glyph and the badge's
  count, so with two filters set its name was *2*, and with none it had no
  name. `icon-labels:check` counted the badge's text as a name. It is now
  named by what it opens and how many filters are set:
  `transactions.filtersToggle`, *Filters*, or with filters set
  `transactions.filtersToggleActive`, *Filters, 2 active* (ja
  *フィルター（2件を適用中）*, tc *篩選條件（已套用 2 項）*); `aria-expanded`
  follows `expanded()`, and the badge, whose number the name already carries,
  is hidden from it. It takes no `aria-controls`, since the panel it opens is
  absent while it is collapsed. The describe *the filter toggle (real
  template)* in `transaction-filters.component.spec.ts` reads the name with
  `accessibleName` in en, ja and tc before and after a real click sets two
  filters, and `aria-expanded` before and after each of two clicks. Before
  the fix it read `''`, `2` and no `aria-expanded`.
- **Focus dropped to the page after a move landed a photo at either end.**
  Enter on *Move photo 1 (e2e-112-b.png) down* moved the photo last, and the
  pressed arrow, disabled at the last photo, gave focus up to `<body>`; a
  click on photo 2's up arrow did the same. With two photos every move ends
  at an end, so a keyboard user lost their place on every move. Focus now
  goes back to the moved photo's row (*Photos are numbered among photos*,
  item 6). The describe *focus after a photo moves* in
  `file-dropzone.component.spec.ts` held five cases; four were red before
  the fix, and the fifth, a photo that can still go down, is a pin, red when
  the other arrow is asked for first. A sixth, *moves a photo one place for
  an Enter held down on its arrow*, came with the reading of the whole
  branch, red before its fix (*What reading found*).
- **The budget dialog's start date label ran under its calendar button at
  375px.** The period and the start date stood side by side at every width.
  At 375px the floating label's box was 122px for 152px of *Start Date
  (Optional)*, cut to *Start Date (Op*, and it ran 32px under the datepicker
  toggle, which paints over it; in ja *開始日（任意）* ran 25px under, and in
  tc *開始日期（選填）* was cut and ran 32px under. At 1024 and 1280 it fits
  at the default text size. The row became `.period-row`, which `bp.mobile`
  stacked: `flex-direction: column; gap: 0`. The describe *the period and
  the start date (real template)* in `budget-form.component.spec.ts` found
  that one phone rule, laid it on the row it styles through `underRule`, and
  read at 375px in en, ja and tc the fields stacked and each as wide as the
  row, the label whole and 0px of it under the button; before the fix it
  read the browser's figures, 32, 25.48 and 32px under. A pin kept the two
  side by side in a desktop's 480px dialog. The second run found the label
  under the button again at 1024 and 1280 at Extra large text, which a rule
  on the window cannot see, and the row now wraps on its own room instead
  (*Run 2, on 5 November 2026*).
- **The review card's split hint was cut.** The split field is a 7em box,
  112px, and its placeholder *Amount for the new row* took 166px, painted
  *Amount for the r*; ja and tc fit. The hint is shorter now and the box is
  unchanged: `import.splitAmount` reads *Split amount*, ja *分割する金額* and
  tc *分出的金額*, the last two each its catalog's name for the field with
  the row left out. The name, `import.splitAmountLabel`, *Amount to split off
  …*, carries the full words. The describe *the split field's hint* in
  `transaction-preview-table.component.spec.ts` measures the hint on one line
  in each language against the input's content box, in a phone's 311px table
  and a 1280px window's 864px; in the specs' pinned face the old en hint read
  195.8px in 112, the new one 103.1. The ja and tc cases are pins, red when
  the box is narrowed to 4.5em. The measure is `placeholderWidthPx` in a new
  `core/services/testing/placeholder-width.ts`, which the filters' spec now
  shares.
- **The filters' Tags hint was wider than its input.** *Add a tag and press
  Enter* measured 175px, and *タグを入力して Enter を押してください* 285px,
  against a 150px input; the hint shows only while the field has focus or
  holds a tag, so this was measured and not painted. The filter panel now reads
  a shorter hint, `transactions.tagsPlaceholderShort`: *Enter to add*, *Enter
  で追加*, *按 Enter 新增*. The describe *the Tags field's hint* in
  `transaction-filters.component.spec.ts` measures each language's hint against
  the room the field's infix leaves its input, in the phone's 312px grid, a
  1280px window's 944px and the narrowest grid that keeps two columns, 324px in
  the pinned face with 134px of room. Before the fix en's 222.5px was cut in
  the last two, ja's 305.1px in all three, and tc's 150.5px in the narrowest
  alone, which the browser's measure, taken against the 150px input, could not
  see. The new hints read 101 to 107px in every grid.

The transaction form's Tags field read the same long hint,
`transactions.tagsPlaceholder`, and once measured it did not fit either. On a
375px phone the form's dialog pane is 356.25px, 95vw of the 500px it opens
at, since that cap, set on the pane, outranks Material's own of 100vw less
32px; the content's 16px a side leaves the field 324.25px, and its chip input
a content box of 284.25px. In the specs' pinned face ja's *タグを入力して
Enter を押してください* took 305.08px and was cut; en's 222.5px and tc's
150.5px fit. The form now reads `transactions.tagsPlaceholderShort` too, and
`transactions.tagsPlaceholder` leaves all three catalogs with no reader left.
The describe *the Tags field's hint* in `transaction-form.component.spec.ts`
gives the field its phone width and holds each language's hint, read through
`placeholderWidthPx`, to the input's content box; before the fix ja's case
was red.

The photo previews' heading skipped a level too, and that is older than this
wave: the zone was a button only while empty, so on 26.11.181 a mixed pick's
previews were headed by an `h3` straight under the page's `h1`. The heading
is an `h2` now, and the stylesheet's `.image-previews h3` rule is
`.image-previews h2`, so it is drawn as before: the pin that holds the zone's
title holds it to its 14px, its weight of 500, its 21px line and its 12px
bottom margin. The wizard's *heading-order* case with photos picked failed on
the `h3` in both schemes.

### Run 2, on 5 November 2026

The second run drove the branch with the first run's fixes and the fixes
reading found in, and none of the fixes below, in the first run's venue: the
local emulators (auth, Firestore and Storage, project `demo-home-account`)
and the app from `npm run start:emulators` on port 4300, signed in as a
seeded account. It read the page at 1024×768, and by emulation at 1280 and
375px, in en, ja and tc, light and dark, and under high contrast. No vendor
was contacted. It drove the regressions and journeys 111 to 116 as
[../e2e.md](../e2e.md) reads them, and read each of the first run's defects
again where that run met it.

- **What the first run read held.** Journeys 79 step 5, 87 step 4, 88 step
  6, 100 and 109 read as the first run read them, and so did the two
  readings 88 step 6's evaluation lacked, the zone with no role and the
  glyph in `rgb(185, 28, 28)`. Journeys 111 to 115 held word for word, and
  116 held but for one line of its Pass (below). Journey 112 step 3 and the
  re-measure after it were the first browser readings of the move fix: a
  real Enter or Space that landed a photo at an end left focus on that
  photo's other arrow, `:focus-visible`, never on `<body>`. Journeys 113
  and 114 read all 22 painted ratios the first run read, to the hundredth.
  Journey 115 step 9, new since the first run, read the filter toggle as
  *Filters, 2 active* with `aria-expanded` `false`, `true` after a click,
  and *Filters* after Clear all.
- **The first run's five defects are fixed where it met them**, in en, ja
  and tc. At 375px the budget dialog's two fields stack, 308px each, the
  start date's label whole and 100px clear of its calendar button in en;
  the split hint, *Split amount*, is 88.1px in its 112px box; and with the
  filter panel's Tags field focused, *Enter to add* painted whole inside its
  outline, which the first run could not paint.
- **The sweep**, at 1280 and 375px in en and ja over the empty upload step,
  Settings, the AI page, the Goals tab and the forecast, found nothing
  scrolling sideways, and nothing cut but the Goals tab below. Sign out at
  375px keeps *Sign Out* in its 1px clip. A hook on `console.error`,
  `onerror` and `unhandledrejection`, installed on every load the
  re-measures scripted, caught nothing.

It met seven defects and recorded three things outside its defect rule, two
that lost a keyboard user's place and one that had a screen reader say a
sentence twice. Each is fixed here, a journey's Pass in
[../e2e.md](../e2e.md) and the rest with a spec that failed first. Two are
this branch's own: that Pass, in a journey the branch wrote, and an untitled
transaction's confirms. The other eight are older than this wave.

- **Journey 116 step 3's Pass asked for a request the app does not make.**
  The answer the step pushes names a category, *Restaurants*, so the import
  files the row under it at the extraction's grade, 0.8, and asks the
  categoriser nothing: the request log read `[['vision',1,true,false]]`
  where the Pass wanted a second, categorising request. The first run met
  that Pass only because the answer it pushed named no category. The app is
  right here; the Pass now reads the one request and says why.
- **The search suggestions scrolled 4px sideways.** With the filter panel
  open over an empty, focused search box, `.search-suggestions` read a scroll
  width of 690 against a client width of 686, and drew an 8px scrollbar
  under the last row; the first run's shot shows the same bar, which its
  sweep read past. Each row's remove is a 40px icon button flush with the
  panel's end, and Material
  centres its 48px touch target on it, 4px past the button on every side.
  The target counts toward its container's overflow, so it scrolled the
  panel, reached over the row's apply and into the rows above and below. The
  remove now sets `--mat-icon-button-touch-target-size: 40px`, as the
  household plans' and overview's icon buttons do, so its target is its own
  box. The case *keeps each 40px suggestion remove and its touch target on
  its own row, and the panel never scrolls sideways* in
  `transaction-filters.component.spec.ts` reads two saved rows and a recent
  one, the face pinned, in a 712px host, the panel a 1024px window gives,
  and a 336px one, a phone's. Before the fix the panel read 690 against 686
  and 314 against 310, and each target sat 4px past its row on every side.
- **The budget dialog's start date label still ran under its calendar
  button at Extra large text.** The first run's fix stacked the period and
  the start date in a window under 600px and left them side by side above
  it, at any text size. At 1024 and 1280 with Settings' text size at Extra
  large, 1.3, each field was 198px: en's *Start Date (Optional)* took 198px
  of a 174px box and ran 31.6px under the button, painted *Start Date
  (Opti*; tc's ran 29.2px under, painted *開始日期（選填*; ja's ended 7.6px
  into the button's box, and its focused hint, *デフォルトを使用*, took 166px
  of a 138px input. At the default size all three fit. The window rule is
  gone: `.period-row` takes `flex-wrap: wrap; row-gap: 0`, and each field
  `flex: 1 1 calc(9.5rem + 56px); min-width: 0`, the label's 9.5em in rem,
  since it grows with the text, and the field's chrome in px, 16px before
  the label and the 40px button after it. Two halves and the 1rem gap come
  to 432px, the 480px dialog's row exactly, so at the default size the two
  stay side by side there, and they stack wherever the row is narrower: on a
  phone, in a window under about 505px, and in the 480px dialog at Large
  and Extra large. The describe *the period and the start date (real
  template)* in `budget-form.component.spec.ts` reads the live layout, the
  text size set on the root as Settings sets it: stacked in a phone's 356px
  dialog, and in the 480px dialog at 1.15 and 1.3, in en, ja and tc;
  stacked in a 560px host at 1.3 in en, which holds the basis to the text;
  and, pinned in en, ja and tc, side by side in the 480px dialog at the
  default size. Ten were red before the fix, the phone's three among them, since Karma's
  756px window never met the window rule; at 1.3 en's label read 235px in
  174 and 32px under the button, ja's 7.7px under with its hint 171.6px in
  138.4, and tc's 29.1px under.
- **No dialog had the dialog role.** With each dialog the run opened,
  `[role=dialog],[role=alertdialog]` matched nothing, and
  `mat-dialog-container` carried no `role` and no `aria-modal`.
  `MatDialog.open` spreads the app's `MAT_DIALOG_DEFAULT_OPTIONS` where it
  would otherwise spread `new MatDialogConfig()`, not over it, and the app's
  options named only the width, the max width, and `autoFocus` and
  `restoreFocus` at Material's own values, so every other key was
  undefined: `role`, `ariaModal` and `delayFocusTrap` among them. Axe takes
  a container with no role for no dialog, so no sweep saw it. The options
  now come from `provideAppDialogs()` in
  `src/app/core/config/dialog.config.ts`: Material's defaults, spread from
  `new MatDialogConfig()`, with three changed, the width, the max width and
  `delayFocusTrap: false`, which keeps the immediate focus trap the app has
  had since July 2026 on purpose (What was rejected). `dialog.config.spec.ts`
  holds the options to Material's but those three, and a dialog opened under
  them to `role="dialog"`, `aria-modal="false"` and its title's name.
  `app.config.spec.ts` holds the app to one provider of the token, equal to
  `provideAppDialogs()`'s, since the root keeps the last provider and a
  second, partial one would drop the role again. The cases that read the
  role were red before the fix, the app's options with *Expected undefined
  to be 'dialog'* and the opened dialog's container with *Expected null to
  be 'dialog'*; two pins, the per-open width under the kept max width and
  focus inside a dialog before its entrance ends, held on the old options
  too. The only other Material defaults token the app provides, the
  household plan dialogs' `MAT_FORM_FIELD_DEFAULT_OPTIONS`, is read key by
  key with Material's fallbacks, so it drops nothing.
- **Every dialog drawn with the shared header was named with *Close*.**
  Material names a dialog by its `mat-dialog-title`, through the container's
  `aria-labelledby`, and `app-dialog-header` put its close button inside
  that `h2`, so the note dialog was named *Note Close*, the receipt viewer
  *Receipt Close* and the share dialog *Share with households Close*, and
  the heading read the same words. All 19 dialogs that use the header read
  so. The header's row is now a `div`, the `h2` holds the title and its
  `aria-hidden` glyph alone, and the close button stands beside it.
  Material's 0-wide, 40px strut moves from the title to the row, and the
  title is a bare flex box, as the row was, that may shrink, so its words
  sit where they sat and a long title wraps. A probe of 192 cases, en and
  ja, text sizes 1 and 1.3, 480 and 343px, short, mid and long titles, with
  and without a glyph, left to right and right to left, read the same rects
  before the change and after. A short title stays midway between the start
  padding and the close button, where the strut set it; that centring was
  kept, not chosen. The title's `min-width: 0` is kept from the old row and
  no case holds it. `dialog-header.component.spec.ts` opens a dialog drawn
  with the header and titled as the note dialog, the receipt viewer and the
  share dialog are, and reads its name in en, ja and tc, red before the fix
  with *Note Close*, *メモ 閉じる* and *備註 關閉*; two pins hold the row, a short
  title midway on a 40px line and a long one wrapped with the close button
  kept in the row.
- **A tab strip opened on a `?tab=` link cut its tab once a count arrived.**
  On a fresh load of `/budgets?tab=goals` at 375px in en, the strip read a
  scroll width of 368, a client width of 303 and a `scrollLeft` of 25.5 of
  65, and the selected Goals tab, at 281 to 375 against the strip's 32 to
  335, painted as *G*. The landing reveal ran once, at the first render,
  before the Budgets tab's 20px count badge arrived with the first snapshot
  and pushed Goals on; nothing revealed it again. Run again from the
  console, the reveal gave 65.5 and Goals whole. The directive now watches
  the label row and the strip with one `ResizeObserver`, and reveals the
  last-revealed tab again when either changes size, unless the reader has
  moved the strip since: each reveal records the offset it left, and a
  different one at the next report is the reader's, a browser's clamp
  counted as the directive's own. A strip with no box is skipped. A reveal
  writes the strip's `scrollLeft` alone, where `scrollIntoView` moved every
  scroller round it, the page's `.main-container` included: that is 0140's
  *The reveal can scroll the page*. `tab-strip-scroll.directive.spec.ts`
  gains nine cases in *when the labels change after the strip opens*: six
  were red before the fix, a label before the landing tab widening, the
  strip narrowing, the strip widening past its labels and narrowing again, a
  label widening while the strip has no box, a tab the reader picked and the
  observer let go on destroy; three pins hold the reader's scroll, the tab
  the keys walked to and the page still. In `budgets.overflow.spec.ts`, *keeps
  the tab a ?tab= link names in view when the Budgets count arrives after
  the strip opened* reads Goals in view on landing, then after the count;
  before the fix it read `the "Goals" tab: end edge vs the scroller's, after
  the Budgets count arrived: Expected 358.65625 to be less than or equal
  328.` Both read two frames on, through `afterTwoFrames` (*One shared
  helper per job*, item 13).
- **An untitled transaction's confirms quoted the list's stand-in.** Handed
  the list's display name (*What reading found*), the four confirms that
  quote a description read it as the transaction's own: *Are you sure you
  want to delete "an untitled transaction"? This action cannot be undone.*,
  *They'll no longer see "an untitled transaction", and none of their goals
  will count it.*, ja *「名前のない取引」を削除してもよろしいですか？…* and tc
  *確定要刪除「未命名的交易」嗎？…*. This branch brought it. The list's delete
  confirm, a split part's and both stop-sharing confirms now test
  `isUntitled(description)`, and for an untitled transaction read sentences
  of their own that quote nothing: `transactions.deleteUntitledMessage`,
  *Are you sure you want to delete this untitled transaction? This action
  cannot be undone.*; `transactions.deleteUntitledSplitPartMessage`,
  *Delete this untitled part of a split purchase? Its other parts stay.*,
  which calls the part untitled, since a part's description is its own and
  can be blanked after the split; `transactions.share.stopUntitledMessage`,
  *They'll no longer see this untitled transaction, …*; and
  `transactions.share.stopUntitledMessageOffline`, *You're offline: they'll
  keep seeing this untitled transaction until your device reconnects. …*.
  ja reads *この名前のない取引…* and tc
  *這筆未命名的交易…*. The note and share dialogs and the receipt viewer still
  name it *an untitled transaction*, as the list does. In
  `transaction-list.component.spec.ts` a description of `''` and of `'   '`
  holds the untitled confirms to the new words in en, ja and tc with no
  quotation mark left in them, every one red before the fix, and pins hold a
  titled row's confirms to its description, quoted and trimmed;
  `transaction-display.utils.spec.ts` holds `isUntitled` to the display
  name's own test.

The three it recorded outside its defect rule:

- **Focus dropped to the page after a remove.** A real click on *Remove
  photo 1 (e2e-87-midrun.png)* or *Remove file 1 (e2e-109-statement.csv)*, a
  real Enter on *Remove photo 2 (e2e-r2-b.png)*, and a click on the only
  file's remove in journey 111 each left focus on `<body>`. Focus now goes to
  the neighbour's remove, or to Browse (*Photos are numbered among photos*,
  item 8). The describe *focus after a row is removed* in
  `file-dropzone.component.spec.ts` held three cases, Enter on a row between
  two, a click on the last row and Enter on the only file, each red before
  the fix with focus on `<body>`. Two more came with the reading of the
  whole branch: *removes one file for an Enter held down on a remove*, red
  before its fix, and *removes the next file on a fresh Enter once the held
  one is let go (pin)*.
- **Focus dropped to the page in the filter panel, and the save-search box
  opened without it.** After a real click on Clear all, which goes once
  nothing is left to clear, and after Enter in the save-search box, which
  closes it, focus was on `<body>`; reading found the same after the box's
  Save and Cancel, and after a suggestion applied from the keyboard. The box
  opened with the query as its name and focus left on Save search, so a
  typed name ran on from the end of the query. Clear all now hands focus to
  the filter toggle, which stays, heads the panel and reads *Filters*, and
  not to the search box, whose focus would open the recent searches; the
  page scrolls to the toggle after a pointer's Clear all at the foot of a
  tall panel on a phone, since `preventScroll` would leave keyboard focus off
  screen. A suggestion applied from the keyboard leaves focus in the search
  box. Save search moves focus into its box with the suggested name
  selected, so a typed name replaces it and Enter alone keeps it; that
  departs from the disclosure pattern, where focus stays on the button, so
  that a screen reader hears the box appear. Save search took no
  `aria-expanded` then; the third run found it sharing its name with the
  box's own button, and it carries one now (*Run 3, on 6 November 2026*).
  Enter, Save, Cancel and Escape close the box, an Escape that ends an IME
  composition excepted, and every close hands focus back to Save search, or
  to the search box once an emptied query has taken Save search away, where
  focus opens the suggestions as it always does under an empty query. The Enter
  that saves is cancelled, since its keypress would press Save search, which
  holds focus by then, and the box's own check kept a held Enter's repeat from
  saving again; the repeats still pressed Save search, which opened the box a
  close had just shut, and they now press nothing once focus has moved (*What
  reading found*). A held Enter on the filter toggle itself still opens and
  closes the panel on every repeat, as any toggle does. A second press on Save
  search closes the box as Cancel does: a WebKit tap, in Safari and the iOS
  app, focuses nothing, and focus would still be in the box the press takes
  away. Each hand-off goes through `focusWhenRendered` (*One shared helper per
  job*, item 11). The describe *focus after Clear all, a suggestion or the
  save-search box takes the pressed control away (real template)* in
  `transaction-filters.component.spec.ts`, with its nested *the save-search
  box, as it opens*, holds each, and every case was red before its fix but the
  pins. One holds that the panel clearing itself on load, to show every
  transaction, moves no focus; three came with the reading of the whole branch
  and hold that the guard against a held key lets go: a fresh Enter on the
  toggle closes the panel, and a held key repeats again, once the Enter held on
  Clear all is let go, and a key held in the box after a tap opened it repeats.
  *saves nothing on the repeat of an Enter held down from Save search* now
  holds the helper's guard, the box's own being gone.
- **The keep-date and currency-offer buttons were described by their own
  reason.** The keep-date button's name joined the date's reason and *Keep
  {date}*, and its tooltip was the reason alone. The CDK describes a control
  by its tooltip unless the two are the same words, so it pointed
  `aria-describedby` at a sentence the name had just read: a screen reader
  heard the reason twice, and the tooltip showed only part of the name. The
  currency offer did the same with *Read off the receipt*. Both tooltips now
  read the whole name, `keepDateLabel(row)` and `currencyOfferLabel(row)`,
  so neither button is described; the form's date flag, whose tooltip was
  already its name, never was. In `transaction-preview-table.component.spec.ts`
  *shows the keep button's whole name as its tooltip, so a screen reader
  reads its reason once* and its twin for the offered currency, in en and
  ja, and *a tooltip a reader reaches on the card*, which holds every
  tooltip a reader can reach on the card to its control's whole name with no
  description, were each red before the fix; the last listed the assumed
  keep, the doubted keep and the offer. The third run found that neither
  name opened with the words its chip shows, and both do now (*Run 3, on 6
  November 2026*).

### Run 3, on 6 November 2026

The third run drove the branch with the second run's fixes in, and none of
the fixes below, in the first two runs' venue: the local emulators (auth,
Firestore and Storage, project `demo-home-account`) and the app from `npm run
start:emulators` on port 4300, signed in as a seeded account. It read the
page at 1024×768, and by emulation at 1280, 540, 500 and 375px, in en, ja and
tc. No vendor was contacted. It read each of the second run's defects again
where that run met it.

- **The second run's fixes held.** Every dialog the run opened one click
  away was a `dialog` with `aria-modal="false"`, named by its title alone,
  with no button inside the title, and the page behind it `aria-hidden`;
  the untitled confirms read their own sentences in en, ja and tc, with no
  quotation mark, and the note dialog, the share dialog and the receipt
  viewer named the row *an untitled transaction*. The budget
  dialog's period and start date stood side by side only at the default
  text size in the 480px dialog, and stacked at 500px and at Large and Extra
  large at 1024 and 1280, the label whole each time; at the default size the
  label's box ended on the calendar button's, 688.1 against 688, its words
  7.9px clear of the glyph, which the run read as clear. The search
  suggestions read a scroll width equal to their client width, 686 at 1024
  and 309 at 375, and each remove's touch target was its own 40px box. Every
  focus step in the filter panel landed where the second run's fix sends it,
  each on the first read after the key or the click. In the upload area,
  focus went after each remove to the remove of the row now in that place,
  else the row before, else Browse, by keys and by clicks, and the picker
  was never asked; after a key Browse was `:focus-visible` and the zone drew
  its 2px ring, and after a click it drew none. The keep-date and offer
  tooltips read their buttons' whole names, drawn whole above them, and
  neither button was described.
- **The tab strip could not be judged.** The browser view the run drove was
  hidden, and a hidden view delivers no `ResizeObserver` report, which the
  late-label reveal waits for ([../e2e.md](../e2e.md), *In a hidden pane*).
  The directive's unit cases hold it.

It met five defects, and each is fixed here with a spec that failed first.
The first is this branch's own, though part of it is older; the other four
are older than this wave.

- **tc quoted the stand-in as an untitled transaction's name.** On
  `/transactions` in tc, a row whose description was `''` or `'   '` named
  its note and receipt buttons *查看「未命名的交易」的備註* and
  *查看「未命名的交易」的收據*: tc's keys put 「」 round `{{description}}`,
  and the list fills the slot with the display name, so the catalog's words
  for a missing description read as the row's own. Its menu trigger, whose
  key quotes nothing, read *未命名的交易的更多操作*, and en and ja quote none
  of these names. Reading found the same in 21 more tc keys: the receipt
  manager's three names and the review card's nine, which came with this
  wave, and the card's checkbox, its remove question and its seven
  announcements, which are older. The quotation marks are the catalog's now,
  punctuation as `common.sentenceSeparator` is: `common.quotedName` is
  `{{name}}` in en and ja and `「{{name}}」` in tc, and the 23 tc keys hold no
  marks of their own. A real description reaches them through it, and the
  stand-in bare: through `quotedTransactionName` for the list's note and
  receipt buttons and the manager's names (*One shared helper per job*, item
  12), and through `announceDescription` on the card, so a blank row reads
  *未命名的項目的金額* and a titled one *「Coffee Shop」的金額*. The four
  confirms keep their marks and their untitled sentences, and the card's
  split, merge and remove triggers keep theirs, since a blank row never
  reaches them (What was rejected). For both blank descriptions in tc, cases
  in `transaction-list.component.spec.ts`,
  `receipt-image-manager.component.spec.ts` and
  `transaction-preview-table.component.spec.ts` hold every one of these
  names, the card's checkbox, its remove question and its seven
  announcements to the stand-in with no quotation mark round it, each red
  before the fix, as *查看「未命名的交易」的備註*, *刪除「未命名的交易」的所有圖片*,
  *不是重複項目 — 匯入「未命名的項目」* and *勾選「未命名的項目」*; pins hold a
  titled row's to its description in 「」. `translation-stub.spec.ts` holds
  the echo stubs' answer for `common.quotedName`, and a case per catalog in
  `translation-keys.spec.ts` fails a key that quotes `{{description}}` while
  its caller can hand it a stand-in; on tc it named the 23 keys before the
  fix (The gates).
- **The household overview's goal button named an untitled row by its
  spaces.** On `/household` in en, a shared row of the reader's own whose
  description was `'   '` named its goal button *Count toward a goal:* and
  the three spaces; a titled row read *Count toward a goal: Cinema tickets*.
  The binding filled `household.overview.countToward` with the raw
  description, and is older than this wave. The row takes no press of its
  own, so this button is its only control, and its name the only thing that
  says which row it counts. The template now calls
  `transactionName(view.transaction)`, which reads `transactionDisplayName`,
  so the name is *Count toward a goal: an untitled transaction*, and every
  control that names a transaction reads the display name (*One shared
  helper per job*, item 12). The row's blank description cell is the
  transaction row's own, blank on every list, and stays: the stand-in is a
  name, not text a row shows. In `household-overview.component.spec.ts`,
  *names a row whose description is "" / "   " as an untitled transaction*
  in en, ja and tc, six cases, the language switched with the page open in
  ja and tc, were red before the fix with *Count toward a goal:*, *目標に計上：*
  and *計入目標：*. A translated slot filled with a raw description now fails
  `i18n:check` (The gates).
- **Two buttons were named *Save search* while the save-search box was
  open.** The bookmark that opens the box and the box's own check button
  both read `transactions.saveSearch`, in every language, and the bookmark
  said nothing of the box: it took neither `aria-expanded` nor
  `aria-pressed`, and its second press closes the box unsaved, where the
  check button saves. Since the second run's fix every close hands focus
  back to the bookmark, so the two are met often. Both bindings are older
  than this wave. Save search keeps its name and now carries
  `aria-expanded`, as a disclosure button does and as the filter toggle
  above it does; the Custom menu's trigger and the date fields' calendar
  buttons in the same panel carry it too while they move focus into what
  they open. The box's own button reads `common.save`, *Save*. The two text
  boxes, which drew no focus ring, a gap recorded after the second run, draw
  it inside their pills through `frame-ring`, at −2px, 3px under high
  contrast (*One shared helper per job*, item 10). In
  `transaction-filters.component.spec.ts`, the describe *Save search and the
  box it opens, told apart*, nested in the focus describe, reads
  `aria-expanded` through a press, a second press and the Enter that saves,
  and the three names apart in en, ja and tc; *the two text boxes' ring (real
  template)* reads each pill's ring from the stylesheets and each box's own
  cleared. Each case was red before its fix: `aria-expanded` read `null`,
  the box's button *Save search*, and neither pill had a rule.
- **The keep-date and currency-offer buttons were not named by the words
  they show.** On the review step in en and ja, a date question's keep half
  showed *Dated Oct 31, 2026 — keep it?* and was named by the date's reason
  and then *Keep Oct 31, 2026*; the offer showed *Looks like South Korea —
  use KRW?* and was named *Use KRW for this row. Read off the receipt*. A
  speech-input user saying the words on the chip reached neither (WCAG
  2.5.3). The names are older than this wave. Each now opens with its chip's
  words and then gives the reason the chip does not show: `keepDateLabel`
  joins `dateChipText` and `dateTooltip`, and `currencyOfferLabel` joins
  `currencyOfferText` and the reason. The tooltip is still the whole name,
  and nothing describes the button. `joinSentences` keeps a question's own
  mark (*Two sentences join in the reader's own stop*, item 1), and
  `import.keepDate` and `import.acceptCurrencySuggestion` retire with their
  last reader. The transaction form's own offer was named by its text and
  its reason all along. In `transaction-preview-table.component.spec.ts`,
  *opens the keep and offer names with the chip's words, then its reason,
  in* en, ja and tc, over an assumed date, a receipt dated another day, a
  doubted date, an offer read off the receipt and one from the session, was
  red before the fix in every locale, and so were the two question cases of
  `joinSentences` in `import-review.utils.spec.ts`, whose old join read
  *keep it?. This receipt* and *このままにしますか？。このレシート*. The amended
  case in `transaction-preview-table.component.spec.ts`, *drops the reason's
  own stop before the join adds one, and adds none after a question*, gains
  a check of the date chip's name, new, and holding on the old code, since
  the chip's join is unchanged.
- **Focus fell to the page after a dialog a menu's entry opened was
  cancelled.** On `/transactions`, Cancel on the Delete confirm a row's menu
  opened left focus on `<body>`, and the next Tab started from the end of
  the page. A dialog gives focus back to whatever held it as it opened, and
  an entry's click runs before its menu closes, so the dialog records the
  entry, which leaves the page with its menu.
  [0149](0149-the-review-step-says-what-it-changed.md) recorded the lesson
  and fixed the two doors it met one at a time; every other menu that opens
  a dialog dropped focus the same way: the row menus' note, receipt, share,
  stop-sharing, Edit and Delete, the + menus' Add transaction and Scan
  receipt, and the category, recurring and budget menus' Edit and Delete. It
  is older than this wave. `provideAppDialogs()` now carries a rule beside
  its options, `returnFocusPastTheMenu`: as a dialog opens it finds the menu
  panel holding focus and the trigger whose `aria-controls` names that
  panel, and once the dialog has closed it focuses that trigger if focus has
  fallen to the page (`focusDropped`, *One shared helper per job*, item
  14). Focus a dialog was told to return elsewhere stays there. The return
  carries the close's own origin, since the container has just set it: an
  Escape gives keyboard focus, a click on the backdrop mouse focus. As the
  container's own restore does elsewhere, it can scroll the page to a row an
  Edit has re-sorted. The review card's currency chip keeps the trigger it
  names, the one the rule would find, and the transaction form's currency
  select, which opens no menu, keeps its own; the command palette opened
  from the shortcuts hint, no menu either, still returns focus past the hint
  by a selector of its own. In `dialog.config.spec.ts`,
  *hands focus back to the menu's trigger once a dialog its entry opened has
  gone*, and in `transaction-list.component.spec.ts`, *hands focus back to
  the row's menu trigger when its Delete confirm is cancelled* through the
  desktop actions menu and the phone's trailing menu, each on the second of
  two rows, were red before the fix with focus on `<body>`. Two pins hold
  that focus a dialog was told to return elsewhere stays there, and that a
  dialog no menu opened leaves focus on the document for the page's own
  recovery. The cases press the entry through `pressMenuEntry` (*One shared
  helper per job*, item 16).

The three it recorded outside its defect rule, none of them a defect:

- **A console 404 for each test row deleted.** The rows the run wrote past
  the rules carried a made-up receipt, so the app's delete asked Storage to
  remove an object that never existed. The app takes *object not found* as
  success; Chrome logs the response, and page code cannot stop that. The
  app's own data meets the same line only for a slot whose object is
  already gone, a removed image's or a rolled-back upload's, which
  `deleteReceiptSlots` counts as deleted.
- **A keyboard-focused icon button is marked only by Material's state
  layer.** Save search, focused from the keyboard and `:focus-visible`,
  showed a 12% tint and no outline. That holds for Material's icon buttons
  across the app (Known gaps).
- **The Smart Search dialog has no close button in its header**, only
  *Close* in its footer. It draws a title of its own, and is named by it
  alone.

### Run 4, on 6 November 2026

The fourth run drove the branch with the third run's fixes and the fixes the
reading of the whole branch made in, and without the fix below, in the
earlier runs' venue: the local emulators (auth, Firestore and Storage,
project `demo-home-account`) and the app from `npm run start:emulators` on
port 4300, signed in as a seeded account. It read the page at 1024×768, and
by emulation at 375px, in en, ja and tc, light and dark, and under high
contrast. No vendor was contacted. It read each of the third run's defects,
and the reading's fixes it could drive, again where they were met.

- **The third run's fixes, and the reading's, held.** On `/transactions`
  in tc, a row whose description was `''` or `'   '` named its note and
  receipt buttons *查看未命名的交易的備註* and *查看未命名的交易的收據*, and a
  titled row kept its 「」, *查看「e2e-r4 noted lunch」的備註*; the receipt
  manager's convert and remove buttons read the same way,
  *刪除未命名的交易的第 1 張圖片* beside
  *刪除「e2e-r4 noted lunch」的第 1 張圖片*, and en and ja read as the third
  run read them. On `/household` a shared row of `'   '` named its goal
  button *Count toward a goal: an untitled transaction*,
  *目標に計上：名前のない取引* and *計入目標：未命名的交易*, and the name
  followed a switch of language made with the page open. The note
  dialog's subtitle followed a switch from en to ja made with the dialog
  open, to *名前のない取引*, and the share dialog's one from en to ja and on
  to tc, to *未命名的交易*. Each dialog a row's menu opened, the Delete and
  Stop sharing confirms and the note, share and receipt dialogs, once
  cancelled or closed by Escape, by Enter on Cancel or Close, or by clicks,
  left focus on that row's menu button, never on `<body>` or on another
  row's, `:focus-visible` after keys and not after clicks. Save search read
  `aria-expanded` `false`, `true` and `false` as its box opened and closed,
  by keys alone, and the box's buttons read *Save* and *Cancel*,
  *保存* and *キャンセル*, *儲存* and *取消*. Both pills drew their ring while
  their box had focus, 2px at −2px and 3px under high contrast, in light and
  dark, `rgb(63, 81, 181)` on the pill's `rgb(243, 244, 246)` at 6.24:1 and
  `rgb(121, 134, 203)` on `rgb(45, 45, 45)` at 3.99:1, and neither box drew
  its own. On the review step in ja and en the keep-date and offer names
  opened with their chips' words, *日付は 2026年10月31日 です —
  このままにしますか？* and *Looks like South Korea — use KRW?*, then gave the
  reason with no stop after the question's own mark, and tc's read the same
  way. Each tooltip a real hover opened equalled its button's name, drawn
  whole, and neither button was described. The journey's row offers no
  currency, so an offer was set on the card's row in the page for the
  reading, and nothing was written. In the upload area one Enter on the last
  remove left focus on Browse, `:focus-visible`, with the zone's 2px ring at
  2px, and one Enter on a photo's arrow moved it one place and kept focus on
  its row; the picker was never asked.
- **A held key could not be judged.** The browser view the run drove sends
  each key as a press of its own, `repeat` `false` on every keydown, and has
  no way to hold one, so no auto-repeat reached the page. A burst of such
  presses also outran the hidden view's render: three on the first remove
  removed two files, the third landing on a button not yet re-rendered, and
  two on the arrow that takes a photo to the end of the list moved it once.
  Neither is the guard, since no event carried `repeat`. A synthetic keydown
  marked `repeat`, dispatched as a probe, was cancelled while the guard
  stood after each hand-off, and a keyup let the guard go; an untrusted key
  presses no button, so the probe shows only that the guard is in the served
  build. The held-key cases hold it (*What reading found*).
- **The tab strip could not be judged.** The view was hidden again, and a
  hidden view delivers no `ResizeObserver` report, which the late-label
  reveal waits for ([../e2e.md](../e2e.md), *In a hidden pane*). The
  directive's unit cases hold it (Known gaps).

It met one defect this branch made, and it is fixed here with a spec that
failed first.

- **The open save-search box's ring crossed the filter grid's floated
  labels.** On `/transactions` at 1024, with the save-search box open and
  focused, `.save-search-row` ran from y 305 to 353 and sat flush on
  `.filter-grid`, whose top was 353: the row had no bottom margin, where the
  search pill has 12px. The grid's outlined fields float a filled field's
  label onto their top border, half of it above the grid's own box, so the
  labels' tops stood at 350.2 for *Type* in en and from 349.5 to 350.0 in
  ja. The ring the third run's fix gave the pill, 2px inside the row, filled
  351 to 353, and 3px under high contrast 351 to 354, so it ran through the
  top 1 to 3.5px of each label, in light and dark. The row's fill already
  reached those tops on `main`, where the box drew no ring. The filter panel
  now gives the search pill and the save-search row one `margin-bottom` of
  12px, so whichever pill sits last over the grid leaves it that room; with
  the box open the gap between the two pills stays 12px. In
  `transaction-filters.component.spec.ts`, *the two text boxes' ring (real
  template)* gains two cases, each reading the labels' boxes with the
  runner's face pinned and counting the widest ring's reach past its pill,
  read from the stylesheet: 3px at −2px is 1px. The first, *ends the open
  save-search pill, its ring included, above the filter grid's floated
  labels*, was red before the fix with `Expected 267 to be less than or
  equal 259.25.` for the Type and Category labels: the row ended on the
  grid's top at 266, the floated labels' boxes started 6.75px above it, and
  the ring reached 1px past the row. The second, *ends the search pill, its
  ring included, above the filter grid's floated labels (pin)*, holds the
  closed box's search pill, which had its 12px all along.

It met two defects older than this wave, and this record fixes neither.

- **The receipt manager's thumbnails read alike.** On `/data`, with three
  transactions of one image each, every thumbnail button was named
  *Receipt image 1 of 1*, in tc *第 1 張收據圖片（共 1 張）*: the button has no
  name of its own and takes its image's alt, `receiptImages.imageNumber`,
  while the convert and remove buttons in the same tile name their
  transaction. It is already a Known gap.
- **Deleting the site's data under a signed-in dashboard logged five
  errors.** The run's teardown deleted the origin's IndexedDB on `/dashboard`
  while the app ran. Firestore terminated on the delete, and five
  `[GlobalErrorHandler] FirebaseError: Firestore shutting down` errors
  followed, where `RowSharingService` caught the same error and warned. The
  dashboard's five live reads have no error path (Known gaps).

Outside its defect rule it met only what this record already holds: a
keyboard-focused icon button, Save search and a photo's arrow, marked by
Material's state layer alone, and focus on `<body>` once a confirmed Delete
had taken its row away (Known gaps). Its test rows carried a receipt it had
put in the Storage emulator at the app's own path, so the app's delete found
each object and the third run's console 404s did not recur.

## What reading found

Reading the tree, and running the specs the fixes above touched, met two more
defects older than this wave, beside the transaction form's queue and the
Data page's upload area (*The eighth rule reads every thumb, and the sixth
reads a card its parent repeats*; *The upload area has one button*, item 5),
and two faults in older specs. Each defect is fixed here with a spec red
before its fix.

- **An untitled transaction's dialogs read its empty description.** The list
  named a transaction with no description *an untitled transaction* on its
  controls, but handed the dialogs its rows open the raw text: the delete
  confirm asked *Are you sure you want to delete ""?*, a split part's *Delete
  this part of ""?*, the note and share dialogs took `''`, and so did both
  stop-sharing confirms, online and offline. Each took the list's own
  `transactionName`, the display name its buttons read, and cases in
  `transaction-list.component.spec.ts` held a description of `''` and of
  `'   '` to the catalog's words in each dialog; all six were red before the
  fix. The note and share dialogs no longer take it: the name they were
  handed kept the language they opened in, and each reads the rule itself
  now (below), so the list's cases for those two hold the description as
  stored. In the four confirms, which quote a description, the stand-in then
  read as the transaction's name, *delete "an untitled transaction"?*; the
  second browser run found it, and those confirms now read sentences of
  their own for an untitled transaction (*Run 2, on 5 November 2026*).
- **The receipt viewer's subtitle was empty for the same transaction.** Other
  doors open the viewer with the whole transaction, so it is handed no name;
  it reads the same rule itself now, through a template call, so the subtitle
  follows a language switch while the viewer is open. The describe *its
  subtitle, read in the catalog's words* in
  `receipt-viewer-dialog.component.spec.ts` holds both blank descriptions to
  *an untitled transaction*, red before the fix, and pins a titled one to its
  description.
- **The budget form's spec printed an error on every run.** Its case *should
  reset isSubmitting on error* rejects the save, and the form logs
  `[BudgetForm] Save failed:` with the error, against
  [0123](0123-the-unit-sweep-is-silent-on-a-normal-path.md)'s silence. The
  case now spies on `console.error` and expects that line, so a run prints
  nothing, and a changed prefix fails it.
- **The transaction list's share cases waited for the sharing code by
  counting ticks.** Share with… and Stop sharing load `LedgerShareService` on
  demand, and the cases' settles waited five zero-delay ticks, or ten 10ms
  ones in select mode; one failed once on a loaded machine. A file-level
  `recordSharingLoads()` now spies on the loader and waits for every load it
  recorded, bounded at 2,000ms by an expectation rather than a timeout. With
  each load slowed outside Angular's zone, the old waits turned 20 cases red
  and the new ones none.

A reading of the whole branch, after the third run, found five more: three
faults in this branch's own code and gates, one in a hand-off that is partly
older, and the class above left without a gate. Each is fixed here with a
spec or a self-test case red before its fix.

- **A held Enter pressed the control a hand-off had just moved focus to.**
  Chrome and WebKit press a focused button on the keypress after each Enter
  keydown, a held key's repeats included, and a click carries no mark of the
  repeat it came from. So every hand-off this record added passed a held
  Enter on: Clear all's repeats pressed the filter toggle, which closed and
  opened the panel; each of the save-search box's three closes, and a second
  press on Save search, handed focus to Save search, which the next repeat
  pressed to open the box again; a remove walked down the list to Browse and
  the picker, which the record kept as a Known gap; and a photo's arrow sent
  it to one end and back. The second-press loop is older in another form: on
  `main` a held Enter on Save search opened and closed the box on every
  repeat. The review card's editor triggers had an older loop of their own,
  a held Enter opening the editor and closing it again. `focusWhenRendered`
  now drops the repeats of Enter and Space held across the hand-off, until a
  keyup or a fresh keydown of either, and stops them ahead of every other
  listener, so the save-search box's own check for a repeat goes (*One shared
  helper per job*, item 11). In `transaction-filters.component.spec.ts` the
  nested describe *an Enter held down through the hand-off* holds Clear all
  and the three closes, and *the save-search box, as it opens* the second
  press; in `file-dropzone.component.spec.ts` *moves a photo one place for an
  Enter held down on its arrow* and *removes one file for an Enter held down
  on a remove*; and in `transaction-preview-table.component.spec.ts` *opens
  the editor once for an Enter held down on its trigger, and keeps it open*.
  Each was red at the first repeat before the fix, eight in all. Four pins
  hold that the guard lets go: a fresh Enter on the toggle, or on the next
  remove, presses once the held one is let go, a held key repeats again
  after that release, and a key held in the save-search box repeats after a
  tap opened it. The review card's row removes and Add notes were read, not
  driven, to loop the same way, and the same helper closes them. Each case
  presses its key through `pressKey` (*One shared helper per job*, item
  15).
- **The note and share dialogs kept an untitled transaction's name in the
  language they opened in.** The list handed each dialog the display name
  already translated, so a switch of language made while the dialog was
  open moved its header and buttons and left the name. Each dialog is now
  handed the description as stored and reads the display name in its own
  template, as the receipt viewer does. In `note-dialog.component.spec.ts`
  and `share-dialog.component.spec.ts` both blank descriptions read *an
  untitled transaction*, red before the fix, and a pin in each, for both
  blank descriptions, reads *名前のない取引* after a switch to ja with the
  dialog still open; it fails when the name is stored once as the dialog
  opens. The list's note and share cases now hold what the list hands each
  dialog to the description as stored.
- **`icon-labels:check`'s sixth rule missed two shapes it meant to read.** Its
  held-apart tally counted only what a switch's cases wrote, so a bare key a
  case reached through a component it stamps, at one level or more, was
  counted as rendered once; the empty state, which four dashboard cards
  stamp, dropped out of the cross-template set with the cards. And
  `bareKeyOf` read two spellings of a ternary between bare keys but not a
  third, `c ? ('a' | translate) : 'b' | translate`, whose last branch
  Angular reads as a pipe. Neither hid a defect in the tree: the empty state
  names no control under a bare key, and no template writes the third
  spelling. The tally now follows a case into what it stamps, at any depth,
  and the third spelling is read (*The eighth rule reads every thumb, and
  the sixth reads a card its parent repeats*). It reads what each template
  reaches to a fixed point, so components that stamp each other reach the
  same whichever a switch's cases read first. The rule's fix hint
  had named the upload area's old binding, `i + 1` and all, which #536
  replaced, and now names one the tree holds. Each is a self-test case, red
  before its fix.
- **`opacity:check` let three fades through.** It exempted a declaration
  whose selector held a state that ends anywhere in its chain, so
  `.a:disabled + .hint`, a hint beside a disabled control, passed, and so did
  a sibling of a drag preview; it read only a file's first inline
  `template:`, and only in backticks; and it passed every keyframe, so the
  `to` frame of an animation held `forwards` rested faded. It also missed
  the arbitrary `[opacity:…]` utility. None was in the tree. A sibling of a
  disabled control fails now, every inline template and stylesheet of a
  file is read, and a held frame fails (*Resting text is a token, and a
  resting fade is a gate*, item 5). Each is a self-test case, red before
  its fix, and the header names what the reads still cannot see.
- **A name filled from a transaction's raw description passed every gate.**
  This record fixed the class by reading, in the list's dialogs and the
  receipt viewer above, and the third run met it again on the household
  overview. One file shows it, so by
  [0145](0145-a-class-found-by-reading-becomes-a-gate.md)'s rule it is a
  gate now: `i18n:check` fails a translated slot filled with a raw
  `.description` (The gates).

## Departures from the issues

- #537 asked the bill-link case to expect `/budgets?tab=recurring` after its
  wait. The wait itself was for that URL, and `waitForDom` throws on a
  timeout, so a wrong destination would never have reached the expectation.
  The case waits for the router to leave `/dashboard` and then expects the
  URL, and its sibling does the same.
- #537 named two unit specs for the silence helper,
  `recurring.service.spec.ts` and `household-plans.service.spec.ts`. Run
  alone, seven more print the advisory, so with `firestore.service.spec.ts`,
  which already called it, ten unit specs do, and the amendment of
  [0088](0088-the-smoke-harness-owns-the-noise-it-makes.md) names all ten.
- #537 offered a `karmaConfig` or a file the test target loads first for the
  strict flag. It is set in a test `main`, which loads after jasmine-core; a
  file loaded first runs before jasmine exists.
- #533 asked that `contrast:check` pass with any new pair scored. It gains
  none (What was rejected); the painted spec cases are the measure.
- #532 asked for `color-contrast` among the passes of an axe pass over the
  empty upload step and over the review step. A pass over a whole step keeps
  one pass node per rule, and over the upload step that node is the hidden
  file input, so the step's pass holds the rule whether or not its words were
  scored. The step-wide passes assert no violation; contrast is read back to
  each part, through `expectEachContrastScored`: the empty zone's
  title, hint, file types and Browse, each by its words; with photos picked,
  each word-holder; and on the review step the header, each notice and hint,
  the duplicate warning and Back.
- #536 asked that a photo's names carry its badge's number. They carry it
  under keys of their own, `import.movePhotoUpLabel`,
  `import.movePhotoDownLabel` and `import.removePhotoLabel`, and
  `import.moveFileUpLabel` and `import.moveFileDownLabel` retire. A row that
  is no photo keeps `import.removeFileLabel`, numbered among the files that
  are no photo rather than named by its name alone, so two CSVs of one name
  stay apart. That amends
  [0186](0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)'s
  place-and-name rule.
- #536's row reads `photoNumber(file)` six times rather than once through a
  `@let`, which would have put the initial bundle 68 bytes over its warning
  (*Photos are numbered among photos*, item 5).
- #531 listed 28 frozen controls and the goal card. The search history's and
  the search dialog's pin buttons, found by reading, chose between two bare
  keys with a ternary, which the sixth rule could not see. They read
  `aiSearch.historyPinLabel`, *Pin {{query}} ({{date}})*, with `aria-pressed`
  kept; `aiSearch.historyPin` and `aiSearch.historyUnpin` retire, and the
  sixth rule reads a ternary of two bare keys as bare.
- #531 asked for Sign out's name. The clip it takes is the app's one: the
  wizard's step labels, the stat card and two Tailwind `sr-only` spans fold
  onto it too.
- Three gates no issue asked for, and a catalog case, by
  [0145](0145-a-class-found-by-reading-becomes-a-gate.md)'s rule:
  `opacity:check`, since a resting fade is read from one file; the
  `i18n:check` rule that fails two sentences joined in code with a literal
  stop, the class 0099 and 0186 each recorded and the dropzone's alert
  brought back; the `i18n:check` rule that fails a translated slot filled
  with a raw description; and the case in `translation-keys.spec.ts` that
  fails a key quoting a description its caller can hand a stand-in.
- The refusal banner's glyph changes colour, which no issue asked (*The
  upload area has one button*, item 6).
- Defects older than these issues are fixed here: the five run 1 met, with
  the transaction form's Tags hint beside the last of them and the photo
  previews' heading its sweep found; the eight run 2 met, the dialogs' missing
  role, the shared header's *Close* in every dialog's name, the budget
  dialog's start date at Extra large text, a tab strip's landing tab cut by a
  late count, the search suggestions' sideways scroll, focus lost after a
  file's remove and in the filter panel, and the keep-date and currency-offer
  tooltips that described their buttons by their own reason; the four run 3
  met, the household overview's goal button, the two buttons named *Save
  search*, the keep-date and offer names that did not open with their chips'
  words, and focus lost once a menu's dialog closed, with the older half of
  tc's quoted stand-in, on the review card; the review card's held-Enter
  loop, which the reading of the whole branch found; the Data page's upload
  area; the refusal banner's glyph; the transaction form's queue, which gave
  two picks of one picture one row; and an untitled transaction's dialogs
  and receipt viewer. So are two faults in older specs, the budget form's
  logged error and the share cases' wait. With the queue, the template
  lint's ban on a `@for` tracked by `.name` widens to `.preview`. The
  standing rule is that a UI defect met while testing is fixed in the wave
  that met it.

## Things that only became apparent while building

- **`:is()` and `:where()` failed open in `opacity:check`.** A `:disabled`
  inside an `:is(…)` exempted the whole compound, so
  `.a:is(:disabled, :hover)` passed with its hover fade. The arms now count
  as a selector list, nested ones too.
- **TestBed sets its strict modes only when a module is configured.** It
  applies `errorOnUnknownElements` and `errorOnUnknownProperties` in
  `configureTestingModule`, and a reset puts back the mode the previous
  configure saved, the non-throwing default when none did. So a harness pin
  that creates a component without configuring a module reads whatever mode
  the last reset left: the default in a run of its own, and the strict one
  only when an earlier spec configured twice. Such a pin is red or depends on
  the order the specs run in, and is no pin either way. The two throwing
  pins configure theirs, as every real spec does. The property check runs in
  the first update pass, not at creation, so that pin throws at
  `detectChanges`.
- **A hidden card cannot be looked for after a bill link.** Once the router
  has left `/dashboard` the dashboard and its cards are gone, and before it
  leaves, its first load holds every card back, so the sibling bill-link
  case's look for the hidden Upcoming card passed whether or not the
  preference hid it. An observer of the whole navigation saw no card either
  way, and saw it only with the first load forced off.
- **Chrome drops a button's activation when its keydown is cancelled.** It
  presses a button on Space's keyup, and on Enter's keypress, only if the
  keydown was not cancelled. The old zone cancelled Space's keydown and
  opened the picker itself, so Space never reached Browse, and Space's red
  case is the cancelled key, not a count of two.
- **Chrome can keep focus on a button a move disables.** Chrome Headless left
  focus on the down arrow a move had just disabled, where the first browser
  run saw it fall to `<body>`; either way it sat on no enabled control.
  `household-focus.ts`'s helper moves focus only off the document or the
  control it was asked from, so it would have left it there, which is why the
  upload area's helper moves it wherever it is.
- **A swap can drop focus from a button that stays enabled.** Angular's
  `@for` swaps two neighbouring rows by taking the lower one out and putting
  it back above the other. Photo 3 moved up is that lower row, so its up
  arrow lost focus though it stayed enabled.
- **Material's dialog stylesheet loads only with a real dialog.** Outside
  one, `<mat-dialog-content>` is inline and its padding never reached the row
  inside it, so the budget form's case measured a 356px row where the dialog
  gives 308. The case lays the content out as a block, as the dialog's
  stylesheet does.
- **A document's capture listener cannot cancel a keydown here.** zone.js
  runs every capture listener of one event on one target from a single
  native listener, registered with the options of the first, and CDK's
  `InputModalityDetector` registers the document's keydown as passive before
  any control renders. So the held-key guard's `preventDefault` did nothing
  at document capture, in the app as in Karma: with the guard there, every
  held-key case stayed red. It listens on the window, in the capture phase,
  ahead of the document's. CDK's modality detector then never sees a dropped
  repeat, which is harmless, since the fresh keydown that began the hold set
  keyboard modality. The guard ends only on a keyup or a fresh keydown of
  Enter or Space, so a modifier tapped mid-hold leaves it standing, and one
  guard stands per window, the next hand-off replacing the last.
- **A focus-return case passes whatever the app does unless the dialog's
  trap runs.** A synthetic click moves no focus, and zone-mode
  `detectChanges` runs no render hook, so the dialog's focus trap never ran:
  focus stayed on the trigger the menu's close had focused, the container
  skipped its restore, and a case read focus on the trigger with or without
  the fix. `pressMenuEntry` ticks after the entry's click and checks that
  focus is inside the dialog before it hands the dialog back (*One shared
  helper per job*, item 16).

## Known gaps

### Names and their gates

- **Controls repeated per item whose name is their visible text.** The review
  card's *Add location*, *Add tag* and *Notes*, the goal card's *Contribute*
  and *View Transactions*, and the receipt image manager's thumbnails, whose
  alt is *Receipt image {{index}} of {{total}}* in every group, read alike on
  every copy. The sixth rule reads a bound name, not a control's own text, so
  it froze none of them, and #531 took up what it froze and the goal card's
  pair. Closing them needs a name with the item's slot on each, and a rule
  that reads a repeated control's text.
- **No gate reads a plain button's name.** The filter toggle had a name only
  while its badge rendered, inside an `@if`; `icon-labels:check` counted the
  badge's text and has no rule for a `<button>`'s own name. A button whose
  only text sits inside an `@if` is unnamed in one of its states, and nothing
  fails it. A rule that holds a button's name in every branch of its blocks
  would close it.
- **The sixth rule's remaining blind spots.** A selector or key that two
  switches on the same item each reach in one case is counted as rendered
  once, since the tally counts the cases of one switch; the form where one
  case writes a key and another reaches it through a component it stamps is
  read now. A label wrapped whole in parentheses, `(c ? ('a' | translate) :
  ('b' | translate))`, or a branch in doubled parentheses is not read, as
  `('a' | translate)` is not for one key. Tallying across switches on one
  item, and reading the wrapped spellings, would close them.
- **No gate finds sibling controls that share one bare key as their whole
  name.** The sixth rule reads controls repeated per item, and a scan of
  one template for two controls under one key cannot tell controls shown
  together from branches of an `@if` that never show at once. Two such sets
  are in the tree: the transaction form's dismiss buttons for the currency
  offer and the location offer, both *Close* (`common.close`,
  `transaction-form.component.html:295` and `:494`), which can show
  together; and the AI page's three key removes, each *Remove*
  (`common.remove`, `ai-settings-page.component.html:88`, `:179` and
  `:259`), under fields all labelled `settings.apiKey`. A name that carries
  its offer, or its provider, would close each.
- **Split in tc and Merge into… in en are not named by the words they
  show.** The review card's split trigger shows *分割* in tc and is named
  *將「{description}」分成兩列*; the merge trigger shows *Merge into…* in en
  and is named *Merge {description} into another row*. A speech-input user
  saying the shown words may reach neither (WCAG 2.5.3). Axe's
  `label-content-name-mismatch` cannot gate this in Karma: it is
  experimental and off, and the `wcag2a` and `wcag2aa` pass never runs it;
  forced on, it would read an icon's ligature as visible text, since Karma
  serves no fonts, and would not leave out `aria-hidden` glyphs. A case that
  walks the card and holds each button's shown words, glyphs left out and
  punctuation folded, inside its name in en, ja and tc would close it.
- **Axe cannot find an unnamed Material switch.** Its `button-name` accepts
  the empty label Material renders, so every axe sweep over a slide toggle
  passes it named or not. The eighth rule and the `accessibleName` cases are
  the guard. Axe reads a per-run option that turns that label check off, but
  its typings do not declare it, and the shared `runAxe` does not pass it;
  passing it there would close the gap for every sweep.
- **No gate reads what a dialog's title holds.** `aria-labelledby` takes
  every word under the element it names, so a control inside
  `mat-dialog-title` joins the dialog's name, as the shared header's close
  button did. The shared header is held by its spec. The three titles
  written by hand, the confirm dialog's, the currency code dialog's and the
  AI search dialog's, hold only their words and at most an `aria-hidden`
  glyph, and nothing holds them so. An `icon-labels:check` rule that fails a
  control inside `mat-dialog-title` would close it.
- **The confirm dialog is a `dialog`, not an `alertdialog`.** It asks before
  deletes and other changes, and its message is not wired as its
  description. It is opened from 28 places with no shared opener, and not
  every confirm is urgent, so neither was changed here.
- **Outside the review card no case compares a tooltip with its control's
  name.** The review card's sweep holds every tooltip a reader reaches there
  to its control's whole name. The receipt manager's image controls and the
  transaction form's stored-image controls keep short tooltips under the
  longer names item 5 of *Every control has a name of its own* gave them, so
  each is described by words its name has already said.
- **The filter panel's two text boxes are named by their placeholders
  alone.** The search box has no label of its own, and neither has the
  save-search box: their names are *Search transactions...* and *Name this
  search...*, which axe and Chromium take as a text box's name, so an
  `aria-label` in the same words would change no name, and one in other
  words would break the match between the name and the visible text. The
  save-search box opens holding the query as its suggested name, selected,
  so its placeholder, the only words that say what the box is for, shows
  only once the box is emptied. A visible label, a floating one in an
  outlined field say, would show the box's purpose, a layout change of its
  own. WebKit and VoiceOver may treat a placeholder differently once a box
  holds a value; no run has read them.
- **The quoting case reads keys, not callers.** The case in
  `translation-keys.spec.ts` fails a key that quotes `{{description}}`
  unless it is listed with why its caller never hands it a stand-in, which
  closes tc's quoted stand-in (*Run 3, on 6 November 2026*). What it cannot
  see: a sentence that en quotes too, which still needs `isUntitled` and a
  sentence of its own; a key quoted in every catalog and fed the quoted
  name, which would read doubled marks in tc; a slot other than
  `{{description}}`; and a new key that holds no marks and is handed the
  display name rather than the quoted one, which leaves tc's titled name
  unquoted.
- **The raw-description check reads only translated slots.** It misses a
  description that reaches the reader through no translate call, as dialog
  data or as text in markup; one passed through a variable, a shorthand
  slot (`{ description }`), `.trim()` or a helper of another name; a field
  of another name that can be blank; and whether a guarded row's guard
  still holds, since a row is matched on its line's text. The dialogs' and
  the receipt viewer's own specs hold the first.
- **The untitled wordings want a native read in ja and tc.** ja's
  *この名前のない取引* and its split part's *分割した買い物*, and tc's
  *這筆未命名的交易* and *分拆消費*, are built from words the catalogs already
  use, not read by a native reader, and so are tc's unquoted names for an
  untitled item, *查看未命名的交易的備註* and *已將未命名的項目的類別改為…*.
- **`transactions.deleteConfirm` has no reader**, on this branch or on
  `main`. It asks *Are you sure you want to delete this transaction?*, close
  to the new `transactions.deleteUntitledMessage`, and stays for a sweep
  that retires dead keys.

### The upload area

- **A CSV slides while a photo is dragged across it.** The drop is remapped
  after CDK's sort, so the CSV snaps back to its row only on the drop. A sort
  that skips rows that are no photo would close it; CDK's drop list offers
  none, and a list of photos apart from the other files would give up the
  order the files were picked in, which #536's answer keeps.
- **The receipt-or-statement chips stay unscored.** Axe leaves them
  `incomplete` for overlapping backgrounds, for a cause not found, and no
  painted case reads their labels.
- **The focus helpers are not yet one.** `household-focus.ts` and
  `import-focus.ts` each export a `focusWhenRendered`, the first moving focus
  only once it has dropped, and four components keep a private copy:
  `dashboard-layout-settings.component.ts:171` and
  `split-parts.component.ts:119` with one selector,
  `receipt-viewer-dialog.component.ts:246` and
  `note-translation.component.ts:184` with a `Signal<ElementRef>`. One shared
  helper with the household guard as an option would take all six. It touches
  about ten components, more than the focus defect asked for, and is
  [0171](0171-second-copies-fold-into-one-copy-of-each-helper.md)'s to
  finish. The test for focus fallen to the page is one now, `focusDropped`
  in `core/utils/focus.utils.ts`, which `household-focus.ts` imports and the
  transaction list and the transactions page read; the receipt viewer's and
  the note lens's copies still write their wider test, focus dropped or
  inside their host, inline. And only `import-focus.ts` drops a held key's
  repeats: every hand-off made outside it passes them on, `household-focus.ts`,
  the four private copies, and the focus calls made straight from a render
  hook in `dashboard-card-menu.component.ts`, `dashboard.component.ts`,
  `transactions.component.ts` and `transaction-list.component.ts`. The
  dashboard card menu, where a held Enter can reopen the menu and press its
  first entry again, and the dashboard layout's move arrows were read, not
  driven, to loop that way. No gate holds the class: it is 0171's fold to
  finish, and a lint rule against a `.focus()` inside `afterNextRender`
  outside the helper would freeze about ten sites.
- **A pick made through Browse drops focus to the page.** Browse goes with
  the empty zone once a pick lands, and nothing asks for focus after a pick,
  so a reader who picked from a focused Browse is left on `<body>`. It is
  older than this wave. The remove's hand-off ends on Browse, so a remove
  that empties the list still lands there.
- **A tap's remove moves focus on WebKit.** A tap focuses no button there,
  and a remove still hands focus to the next remove, so Material's focus
  state layer moves onto it, as a tap on an arrow already did. A held Enter
  no longer walks down the removes (*What reading found*).
- **No gate reads a hidden file input inside the element whose click asks
  it.** The empty upload area and the Data page's backup area each had that
  shape, so every request asked the input twice, and reading found both. One
  template shows it, and no rule in `icon-labels:check` or the template lint
  reads it. A rule that fails an `<input type="file" #ref>` whose ancestor's
  `(click)` reads `ref` would close it.

### Focus and the tab strip

- **No gate finds a control that takes itself away while focused.** A
  remove, a Clear all, a box's close: each handler that takes away the
  control holding focus needs a hand-off, and that is a rendered behaviour
  no source scan sees. Each instance fixed here is held by a case that
  renders the real template. The filter panel's suggestion removes are not:
  a remove pressed from the keyboard still drops focus once Firestore takes
  its row out, which it does after the press returns.
- **Focus can still fall past a menu.** The datepickers opened from a
  menu's entry, in the transaction filters' Custom menu and the period
  selector's, give focus back to the detached entry as a dialog did, since
  `MatDatepicker` records it the same way and the dialogs' rule does not
  reach them. A confirmed Delete returns focus to its row's menu button, and
  focus then falls to the page once the row leaves. And the rule cannot see
  a dialog closed before its menu has left the page, a submenu's entry, or
  `restoreFocus: false`; the app has none of the three.
- **A keyboard-focused icon button is marked only by Material's state
  layer.** Material's icon button sets `outline: none`, which wins over the
  app's `:focus-visible` ring, and the strong focus indicator Material
  offers is not turned on, so a focused icon button shows a 12% tint and no
  outline. The third run met it on Save search; it holds for every
  Material icon button in the app, and no case reads it.
- **No case reads the review card's notes ring.** `.notes-input` clears its
  outline and draws its own under `:focus-visible`, as it did before this
  wave, and no spec reads that rule, so a selector that outranks it passes
  every run. A case that reads the stylesheet's rules, as *the two text
  boxes' ring (real template)* does for the filter panel, would close it.
- **A tab strip misses two labels that change by equal and opposite
  amounts at once.** The label row's width is then unchanged, and so is the
  strip's, so no report comes and the revealed tab is not put back. The
  directive's comment states the limit; no case reads it.
- **No browser has read the late-label reveal or a held key.** The second
  run found the tab strip's cut tab, and the third and fourth drove a hidden
  view, which delivers no `ResizeObserver` report, so the reveal that now
  follows a late count is read in Karma alone, by the directive's cases and
  `budgets.overflow.spec.ts`. A held Enter is read in Karma alone too: the
  fourth run's keys arrived as separate presses, `repeat` `false` on each,
  and a synthetic repeat presses no button, so the held-key cases, through
  `pressKey`, are its only reading. A run in a shown view would read the
  first, and a key held down on a real keyboard the second.

### Contrast and the sweeps

- **Sixteen specs still define their own `expectPainted`, and 23 their own
  `tokenValue`**, beside the shared ones in `painted-contrast.ts`. New cases
  use the shared ones; folding the old would have spread this change over two
  dozen specs outside its issues. A fold onto the shared exports, spec by
  spec, closes it.
- **Two older cases read contrast from a pass over a whole card.** The About
  card's sweep and the review card's *scores the card's contrast rather than
  skipping it* expect `color-contrast` among the passes of one pass over the
  card or the whole table, which one node can hold.
  `expectEachContrastScored` over the parts' words closes them.
- **Other sweeps may stand below Karma's body.** Only the wizard's sweeps of
  the empty upload step, of photos picked and of the review step, its
  painted colours case, and the Goals hint's case call `standOnThePage`. The
  wizard's sweep of its step headers needs none, since the tab list sits at
  the top of the frame, and nor does the review card's, whose root paints
  `--surface-card`; any other sweep of a fixture taller than 413px with no
  fill of its own may leave its lower text unscored and read clean. An
  audit of the step-wide and page-wide axe cases closes it.
- **Heading order is held on the upload step alone.** Axe's `heading-order`
  is best practice, outside the `wcag2a`/`wcag2aa` pass every sweep runs, and
  only the wizard's two upload-step cases run it. No pass reads heading order
  across the app, so other headings, such as the weekly recap's `h3` title
  (`weekly-recap.component.html:7`) and the Data page's receipt-images `h3`
  (`data-management.component.html:87`), are unchecked. A `heading-order`
  pass over every page the walkthrough reaches would close it.
- **`opacity:check`'s `url()` mask has a narrow shape it misreads.** The
  unquoted-`url(` mask runs before comments are blanked, so in a comment
  holding an unquoted `url(` whose closing paren lies past the comment's `*/`
  on the same line, the `*/` is blanked with it, and a fade between the two
  is read as comment: `/* url(x */ .a { opacity: .5; } /* ) */` passes. The
  tree holds no such line. Masking the `url(` only outside comments closes
  it.
- **Two places the start date's label is not held.** The larger text sizes
  in the 480px dialog are read in Karma now (*Run 2, on 5 November 2026*),
  and two residues are left. At the default size there, en's *Start Date
  (Optional)* meets the calendar button's box, 152.1px against 152, which
  only a browser reads: Karma's Verdana sets en wider than PT Sans, so the
  pin reads en's layout alone, and ja's and tc's label and hint. And on a
  320px phone at Extra large the stacked field is 241.6px, so en's label
  stays about 12px under the button even stacked; that is the arithmetic of
  the field's room, and no run has read it.
- **Two other form rows stack on a window rule.** The transaction and
  recurring forms' `.amount-row` still stacks on a `max-width: 480px` window
  rule, which ignores the text size, and no run has read either at Extra
  large.
- **Other scrolling containers with icon buttons are unchecked for the
  touch target's overhang.** Material's 48px target reaches 4px past a 40px
  icon button and counts toward its container's overflow. The search
  suggestions, the household plans and the household overview hold theirs
  to the button; no sweep looks for another icon button flush with the end
  of a scroller.

### The dashboard's live reads

- **Five of the dashboard's live reads have no error path.**
  `DashboardComponent` subscribes to `getBudgets()`, `getGoals()` and
  `loadCategories()` with nothing to take an error, and to
  `getRecentTransactions(5)` and `getUpcomingSchedule(UPCOMING_WINDOW_DAYS)`
  with a `next` callback alone, and each service hands back the stream of
  `FirestoreService.subscribeToCollection`, which passes a listener's error
  on, with no `catchError`. So an error on any of the five reaches
  `GlobalErrorHandler`, which logs it and shows the generic *Error*
  snackbar. The fourth run raised one on all five at once: deleting the
  site's IndexedDB under a signed-in page makes Firestore terminate, which
  fails every live listener with *Firestore shutting down*, and five
  `[GlobalErrorHandler] FirebaseError: Firestore shutting down` errors
  followed. `RowSharingService`'s memberships stream catches the same error
  and warns, and `HouseholdService`'s listeners pass error callbacks of
  their own, as do the dashboard's period, previous-period and baseline
  reads. Only deleting the site's data while the app runs is known to raise
  it, and it is older than this wave. An error path on each of the five, as
  `RowSharingService`'s stream has, would close it; other pages' live reads
  were not read for the same shape.

### The test harness

- **The copied test init is held by its settings, not by the builder's.**
  `harness.spec.ts` pins what `src/test-main.ts` passes: an unknown element
  and an unknown property each throw, and change detection runs in a real
  `NgZone`. Nothing compares the copy with the builder's own init in
  `@angular/build`'s `application_builder.js`, so an upgrade that adds an
  option or a provider there leaves the copy without it, and no spec turns
  red. The file's header asks for a re-read on every upgrade; a node gate
  that reads the builder's init beside the copy and fails on a difference
  would close it.
- **The fonts stay unserved.** Karma still logs a 404 for each font file a
  run asks for. Serving them would change what every width spec and every axe
  glyph score measures, so they stay unserved by decision. Serving them and
  re-measuring those specs in one change would close it.
- **Specs open dialogs under Material's options, not the app's.** Only
  `dialog.config.spec.ts`, `dialog-header.component.spec.ts` and the
  transaction list's focus-return describe provide `provideAppDialogs()`;
  `app.config.spec.ts` reads the providers and opens no dialog. Every other
  dialog a spec opens runs Material's defaults, whose focus trap waits for
  the entrance where the app's does not, and without the rule that gives
  focus back past a menu, so a spec that reads focus inside or after a
  dialog reads Material's behaviour.
- **Two specs keep a copy of one quotation-mark pattern.** The transaction
  list's spec and the review card's each define `/["“”「」『』]/` for the
  cases that hold a stand-in unquoted. One export from
  `core/services/testing/` would take both
  ([0171](0171-second-copies-fold-into-one-copy-of-each-helper.md)).
- **A lone `test:dates` run is not silent.** With the advisory gone it still
  printed 25 WARN lines and one ERROR line in each zone, among them the
  household services' own `[HouseholdLedger]` and `[HouseholdPlans]`
  warnings, which break
  [0123](0123-the-unit-sweep-is-silent-on-a-normal-path.md)'s silence on a
  run of those specs alone, as they did before this wave. Spying on them in
  the cases that cause them closes it.
- **Tailwind reads the specs.** Its `content` is every `.html` and `.ts`
  under `src`, specs included, so a word in a spec that names a utility
  ships that utility. *ring*, standing alone in a comment of the dropzone's
  spec, put Tailwind's bare `ring` utility, 171 bytes that nothing in the
  app uses, into the initial stylesheet, and a spec comment that named the
  screen-reader utility by its class did the same for about 140 bytes until
  it was reworded. Specs bring about 1.8 kB of
  utilities in all, and some on purpose: `theme-aliases.spec.ts` reads each
  semantic alias's utility off the page. Leaving specs out of `content`, with
  a safelist for the utilities a spec reads, would close it.
