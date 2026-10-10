# 170. The animations runtime, the unregistered worker and nine dead items come out

**Status:** Accepted, implemented · **Date:** 2026-10-10 · **Issues:** #437

Reference documentation lives in [../performance.md](../performance.md),
[../pwa.md](../pwa.md), [../share-import.md](../share-import.md),
[../receipt-import.md](../receipt-import.md) and
[../import-fields.md](../import-fields.md).

Applies [0048](0048-a-dead-capability-is-removed-not-guarded.md), one
removal per commit.

Amends [0112](0112-pwaservice-keeps-only-the-surface-something-calls.md).
Its rule stands and is applied twice more: `registerBackgroundSync` leaves
the surface, and the `message` listener goes with it. Its decision that the
package, the build option and `ngsw-config.json` stay does not.

Closes gaps of [0009](0009-shared-state-publishing-and-lifecycle.md),
[0036](0036-a-user-facing-string-lives-in-the-catalog.md),
[0045](0045-a-confidence-grade-names-its-source.md),
[0051](0051-an-uncategorized-row-is-graded-where-it-is-coerced.md),
[0059](0059-one-mapper-builds-every-imported-transaction.md),
[0105](0105-the-cache-size-card-is-removed-and-the-dead-worker-with-it.md),
[0111](0111-the-position-overlap-pass-is-removed.md),
[0112](0112-pwaservice-keeps-only-the-surface-something-calls.md),
[0113](0113-the-wizards-picker-takes-a-backup-and-grades-the-category-it-defaulted.md),
[0115](0115-a-failed-row-is-named-by-its-id.md),
[0116](0116-the-merged-count-has-one-producer.md) and
[0124](0124-the-camera-door-names-its-step-and-a-status-nobody-could-see-is-deleted.md).
The table under *Decision* names the gap each item ends.

Corrects a gap of
[0023](0023-the-initial-bundle-carries-only-the-entry-route.md), without
editing it: an installed PWA never fetched every lazy chunk at install,
because the worker whose prefetch the gap described was never registered.
In [../performance.md](../performance.md), the same gap and the one that said
there was no bundle-analysis script are removed.

## Context

#437 listed what the build and the models carried that nothing read, in the
shape of #390 and #389, and asked for it to go the 0048 way: one commit per
removal, nothing left behind a guard.

- **P1, the animations runtime.** `app.config.ts` registered
  `provideAnimations()`, and nothing in `src/app` used `@angular/animations`:
  no `trigger(`, no `animate(`, no `[@` binding, no `animate.enter` or
  `animate.leave`. Material 22.1 and the CDK decide whether to animate from
  `ANIMATION_MODULE_TYPE`, a token in `@angular/core`, and never from the
  animations package. An unset token counts as enabled, so the provider
  bought production nothing. npm marks the package deprecated. Its real
  weight was in the specs: 112 of them, 100 unit and 12 smoke, turned motion
  off through `NoopAnimationsModule` or `provideNoopAnimations()`, both from
  `@angular/platform-browser/animations`, which imports
  `@angular/animations/browser`. All 112 would stop compiling with the
  package gone.
- **P2, the unregistered worker.** The `production` configuration built an
  Angular service worker from `ngsw-config.json`, and nothing called
  `provideServiceWorker`. 0105 and 0112 recorded it and left it standing:
  the build option needs the package, and the config's spec pinned that no
  cache group would route analytics. `docs/performance.md` counted the
  worker's prefetch of every lazy chunk as a cost, of a worker that never
  installed.
- **P3, the dead home route**, `src/app/features/home/`.
- **P4, dead code and fields.** Eleven claims, of which eight held: see the
  table. Three did not, and *Verified, not changed* says why. Reading for the
  first removal found a ninth item the issue had not listed,
  `getByCategory`.
- **P5, no bundle attribution.** Attributing a regression meant reading the
  build's rounded chunk table and grepping `dist/`.

One part of P4 was not dead in the same way. 0097 had kept the
`SYNC_OFFLINE_QUEUE` branch because a listener waited on the other end, and
0105 found that nothing would ever post to it: the share-target worker has no
`sync` handler, by 0019's design. 0105 named the condition for removing it:
that the drain on reconnect is judged enough.

## Decision

**What nothing reads goes, one removal per commit. The one fact that was
dropped silently, a PDF read only in part, gets a reader instead. And
`npm run build:analyze` attributes the initial bundle by module.**

### The items

Each commit is cited by its subject.

| Part | What came out | Commit | Known gap it ends |
|---|---|---|---|
| P1 | `provideAnimations()` and `@angular/animations` | `test: a provider turns motion off without the animations package`, `test: specs turn motion off without the animations package`, `chore: the deprecated animations runtime comes out` | — |
| P2 | The `serviceWorker` build option, `ngsw-config.json`, its spec, and `@angular/service-worker` | `chore: the production build stops emitting a service worker nobody registers` | 0112's third, the worker nobody registers |
| P4a | `TransactionService.getMonthlyTotals` and the private `groupByCategory` it alone called | `refactor: monthly totals nobody calls come out` | 0009's |
| P4a | `TransactionService.getByCategory` | `refactor: the category getter nobody calls comes out` | — |
| P4b | `reports.transactionsLabel`, in en, ja and tc | `chore: an unreferenced report label leaves the catalogs` | 0036's three unreferenced keys, and 0124's one left |
| P4c | The background-sync seam | `refactor: the background-sync seam nothing answers comes out` | 0105's second |
| P4d | `positionInImage` | `refactor: receipts stop asking for a position nothing reads` | 0111's third |
| P4e | The unread warnings; the page cap's gets a reader | `fix(import): a PDF read only in part says so in the review step` | 0045's, 0051's and 0113's unread warning |
| P4f | `ImportError.row` | `refactor: an import error stops recording a row number nothing shows` | 0115's second |
| P4g | `originalText` | `refactor: an imported row stops carrying text nothing reads` | 0059's third |
| P4h | `deduplicationMethod` and `imageIds` | `refactor: multi-image metadata keeps only the image count` | 0116's second |
| P5 | Nothing came out: `build:analyze` came in | `build: an analyze script attributes the initial bundle by module` | — |

**P1.** The specs moved first, so the package could go without a compile
error. `provideNoMotion()`, in `core/services/testing/no-motion.ts`, provides
`ANIMATION_MODULE_TYPE` as `'NoopAnimations'`, which is the value Material and
the CDK read. `MATERIAL_ANIMATIONS` alone would not do: the CDK overlay reads
only the core token, so its panes would still animate. Its own spec opens and
closes a `MatDialog` and dismisses a `MatSnackBar` under it and finds nothing
left to wait for. The sweep replaced 170 provider forms across the 112 files
with `provideNoMotion()`. Then `provideAnimations()` and the package went.
`build-configurations.spec.ts` pins the package absent from `dependencies`,
and `app.config.spec.ts` pins that the flattened providers hold no
`ANIMATION_MODULE_TYPE`. That walk reads the internal `ɵproviders` of an
`EnvironmentProviders`, so a sanity case first proves it finds `HttpClient`
inside `provideHttpClient()`.

**P2.** The build option, the config, its spec and the package went
together, since none had a use without the others. The deleted spec's two
live assertions moved. `share-target-sw.spec.ts` now sends the real worker a
`GET` and a `POST` to each of four analytics hosts and asserts it answers
none of them. `build-configurations.spec.ts` asserts that an asset entry
copies `pdf.worker.min.mjs` to `assets/` and that `PDF_WORKER_SRC` names that
path. It also asserts that no configuration sets `serviceWorker` and that the
package is absent. The production build emits no `ngsw-worker.js` and no
`ngsw.json`.

**P4a.** `getMonthlyTotals` had no caller outside its specs. It was built on
`getByDateRange`, so it published the shared `transactions` signal, which is
0009's gap. The `MonthlyTotal` type stays: the export and the providers use it.
`getByCategory` was a one-line `getTransactions({ categoryId })` with no
caller either, and it went in a commit of its own. Each name also left the
listener alternation that `eslint.config.js` and
`scripts/check-lint-guards.mjs` keep in step
([0139](0139-a-transaction-read-acted-on-once-names-its-source-and-a-listeners-first-value-is-banned.md)).

**P4b.** `reports.transactionsLabel` had no call site in any locale. 0036
listed it as one of three keys with none; 0124 gave a second its call site,
0126 deleted the third, and this was the last.

**P4c.** The seam was five pieces, and all of them went:

- `PwaService`'s `message` listener on `navigator.serviceWorker`;
- its `SYNC_OFFLINE_QUEUE` case, which re-dispatched the message as a window
  `sync-offline-queue` event;
- `registerBackgroundSync`, which registered a `sync` tag that no worker
  answers;
- the offline queue's window listener for that event;
- the queue's call to `registerBackgroundSync` from `queueImage`.

The queue drains on the browser's `online` event and on **Sync Now**, which
is the condition 0105 set. `PwaService` now reads no message from the worker
at all. The one message the worker posts, `notification-route`, belongs to
`NotificationTapService`. Every `registerBackgroundSync` spy entry left the
doubles, the seven in the wizard's smoke included. The specs now assert
that `PwaService` registers no listener on the worker's container and has no
background-sync method. They also assert that `queueImage` never touches
`SyncManager`, that a `sync-offline-queue` window event drains nothing, and
that `online` still drains.

**P4d.** `positionInImage` was required on `ImagePositionMetadata`. Both item
prompts, `multiImageReceipts` and `receiptItems`, asked the model for it, and
six places wrote or copied it, Gemini's reader defaulting it to `'middle'`.
Nothing decided anything from it. The "overlap pass" `receiptItems`' comment
said it fed was removed by 0111. It is gone from the types, the two prompts
and the six writes, and `prompt-registry.spec.ts` pins that neither prompt
names it. `check-prompts.mjs`' exemption for `receiptItems` no longer calls it
position-aware.

**P4e.** `ImportResult.warnings` had six types, and the wizard read one,
`parse_error`.

- `duplicate` and `low_confidence` were pushed by two result builders and
  repeated what each row already shows: the duplicate banner, and the
  category chip's grade.
- `missing_data` and `currency_mismatch` were never pushed.
- `info` carried one English sentence, *Only the first N of M pages were
  read*, which `importFromPDF` raised for a PDF longer than `MAX_PDF_PAGES`
  (15) and no template read. That was a real fact, dropped silently.

`ImportWarning` is now a union of
`{ type: 'parse_error'; message }` and
`{ type: 'pages_truncated'; read; total }`. Its optional `row` and
`transactionId` went too. `importFromPDF` pushes the figures rather than a
sentence (0036). `reviewNoticesFrom`, in `import-review.utils.ts`, maps a
batch's warnings once. It returns whether an answer was cut off, and the
first truncated PDF's figures with a count of any others. `processFiles()`
gathers every result's warnings and maps them once. A result handed over by
the camera dialog or the transaction form is mapped on its own. The review
step shows a `role="status"` notice with a decorative icon
(`aria-hidden="true"`, 0146): *Only the first {read} of {total} pages of the
PDF were read*. When more than one PDF was cut, a second line follows:
*Other PDFs also read only in part: {others}*.

**P4f.** The confirm loop wrote each failed row's position in the submitted
subset. Since 0115 the wizard re-offers failed rows by their
`transactionId`, and nothing displayed the number. The field and the write
went. A record stored before keeps its `row`, harmlessly: the rules check
only that `errors` is a list.

**P4g.** `originalText` was the merchant and the details joined, written at
categorization and typed on `CategorizedImportTransaction`. Nothing read it
(0059's gap).

**P4h.** `MultiImageMetadata` carried `deduplicationMethod`, the literal
`'ai'` whatever ran, and `imageIds`, `image_0` to `image_n` off the file
index. Only a spec and a smoke fixture read either (0116's gap). It is
`{ totalImages }` now.

**P5.** `npm run build:analyze` runs the production build with
`--stats-json` and reads the metafile it writes. It prints the ten inputs
that put the most bytes into each initial output, then the initial total in
exact bytes, JavaScript and stylesheet apart. "Initial" is the builder's own
rule, mirrored: the `main`, `polyfills` and `styles` entries and their
static-import closure. A dynamic import is lazy however large it is. Its
`--self-test` runs in CI, and the real run is local, because it needs a
production build.

### P3: already gone

The dead home route went in `50315919` (*chore: the unreferenced home
component comes out*), on main since PR #458, four days after #437 was
filed. `grep -rn HomeComponent src` prints nothing, and no commit here
touches it.

### Verified, not changed

Three of P4's claims were wrong.

- **P4i: `totalsByCurrency` is written unconditionally beside conditional
  neighbours.** It is load-bearing. `ImportHistoryComponent.totalLines`
  reads it per currency, and reads its presence to tell a record written
  since [0119](0119-a-batchs-totals-are-per-currency.md) from a legacy one,
  whose single raw sum it renders instead. So it is written even when empty.
  The write gained a one-line comment saying so (*docs: say why an import
  always records its per-currency totals*), and nothing else changed.
- **P4j: `sumByCurrency` takes no absolute value.** Its rows are unsigned by
  construction. Every door builds a row's amount through `importAmount`,
  which takes the absolute value and rounds it
  ([0117](0117-every-doors-figure-is-whole-in-its-currency.md)), before the
  row reaches the card or the write. 0119 recorded the same reading. An
  `abs` there would guard a shape no door produces, and
  [0038](0038-a-dead-guard-reads-exactly-like-a-live-one.md) is against that.
- **P4k: a stale comment in `import-review.utils.ts` names a
  `convertParsedReceipt` that no longer exists.** It exists, as
  `AIStrategyService.convertParsedReceipt`. It writes `notes: ''` for a
  receipt with neither details nor items, which is what the comment says.

### The alternatives that were rejected

- **Registering ngsw on purpose**, the issue's other branch for P2.
  `provideServiceWorker` registers at scope `/`, where
  `ShareIntakeService` already registers `share-target-sw.js`. A second
  registration at the same scope replaces the first. The share target would
  then 404, because Hosting's rewrites never answer a `POST`. A reminder
  would be raised through ngsw's registration instead
  ([0104](0104-a-web-reminder-is-raised-through-the-worker-the-app-already-registers.md)),
  and its tap would no longer reach the handler that opens its route
  ([0167](0167-a-notification-carries-its-route-and-a-tap-lands-on-it-and-the-recap-nudge-needs-a-week-with-news.md)).
  Folding both jobs into ngsw would mean adopting an offline strategy to
  keep a share target, which 0019 rejected, and it would make the prefetch
  cost real. An offline caching worker is a feature, with its own issue.
- **Keeping the animations package for the specs.** A deprecated runtime
  dependency kept only so the specs could switch it off, when the token
  Material and the CDK read can be set directly.
- **`MATERIAL_ANIMATIONS` as the specs' switch.** It reaches Material and
  not the CDK overlay.
- **Keeping the background-sync seam for a future `sync` handler.** That is
  0019's order reversed: a job first, then the code for it. The drain on
  `online` and **Sync Now** is the job, and it is done.
- **Rendering every warning type.** `duplicate` and `low_confidence` would
  have said again, for the whole batch, what each card already says, as one
  more sentence to translate.
- **Converting the page cap's English sentence in place.** A sentence built
  in the service is English in every language. The figures let the step say
  it in the reader's.

## Consequences

- **The initial bundle.** At the branch's base it was 2,471,499 bytes
  (JavaScript 2,440,608, stylesheet 30,891), against a 2.472 MB warning.
  - With the animations runtime gone it was 2,406,960 bytes, JavaScript
    2,376,069: 64,539 bytes less. Both `maximumWarning` values, `production`
    and `production-local`, went from 2.472 MB to 2.408 MB. That is the
    saving rounded down to the whole kilobyte, in Angular's 1000-byte unit,
    and it left 1,040 bytes of headroom.
  - After the removals, and the rest of the branch's code up to that point,
    it was 2,405,885 bytes in 55 initial files (JavaScript 2,374,994): 1,075
    bytes net under the earlier figure. Both warnings went to 2.407 MB.
  - The final build is 2,406,611 bytes in 58 initial files (JavaScript
    2,375,720), so the net saving since the animations runtime's removal is
    349 bytes, less than the kilobyte the warning was lowered by when the drop
    was 1,075. Two chunks are pure split points of modules the initial graph
    already held, cut out once the lazy import history imported them:
    `import-review.utils.ts`, 4,445 bytes (+347), for `importFailureKey`, and
    `ai-error.utils.ts`, 3,078 bytes (+189), for the classifier's own
    sentences. The last increment is not a split: the offline queue card's
    recount on an account change, in an initial service, which cost 192 bytes
    (2,406,419 to 2,406,611).
  - The warning stays at 2.407 MB, with 389 bytes of headroom, which is now
    less than the 501 bytes the main branch had at `8a6e2c9a`. A version
    string of the same length adds nothing of its own: 26.10.171 to 26.10.172
    moved the total 2 bytes down, through chunk file names.
  - `maximumError` stays at 2.7 MB in both. `build-configurations.spec.ts`
    pins the two configurations' budgets equal.
  - [../performance.md](../performance.md) records both moves and what bought
    the space.
- **Production motion does not change.** Material and the CDK animate with
  CSS and read the token, which is now unset in production. Under
  `prefers-reduced-motion` Material turns its own animations off, as it did
  before. Journey 87 opened a menu, a dialog, a datepicker and a select in
  the emulator venue's build, with no provider, and each animated.
- **Production serves no Angular worker after the next deploy.** The
  deployed `ngsw-worker.js` falls to the SPA rewrite. No browser ever
  registered it, so nothing is left installed. `/share-target-sw.js` is still
  the only registration.
- **A part-read PDF says so on the review step**, in the reader's language.
  Stored history records are unchanged, since warnings were never
  persisted.
- **`PwaService`'s surface** is `isOnline`, `refreshOnlineStatus()`,
  `isStandalone`, `isIOS`, `canPromptInstall` and `promptInstall()`.
- **No rules, indexes or functions change.**

## Departures from the issue and the plan

- **A ninth item.** `getByCategory` was not in #437. It was as dead as
  `getMonthlyTotals`, and it went in its own commit.
- **The listener alternation lost both names.** The plan named the
  `eslint.config.js` and `check-lint-guards.mjs` edit for `getMonthlyTotals`
  only. `getByCategory` left them as well, since a name in the alternation
  that the service no longer declares is a stale entry in a census
  `lint-guards:check` re-derives from the source.
- **The bare greps are not empty.** The plan expected
  `grep -rn "@angular/animations" src` to print nothing after P1. It prints
  one line: the pin in `build-configurations.spec.ts` that asserts the
  package absent, which has to name it. The seam's grep likewise prints
  `pwa.service.spec.ts`'s absence case beside the foreign-message example in
  `notification-tap.service.spec.ts`.
- **The en wording of the second truncation line.** The plan's
  *{others} more PDFs were also read only in part* reads *1 more PDFs* in the
  common case of two cut PDFs. `t()` picks a plural form only from a
  parameter named `count`, and the parameter is `others`, as the plan kept
  `count` out. The en line is
  *Other PDFs also read only in part: {others}*, which holds for any number.
  ja and tc have no plural to agree with and kept the plan's sense.
- **The notices are mapped in `processFiles()`'s `finally`, not after its
  loop.** On the normal path that is the same moment. When a later file
  throws after the photos' rows landed, those rows are still offered for
  review, and mapped after the loop they would have lost the cut-off notice
  they came with. Pinned by "keeps the cut-off notice on the photos' rows when
  a later file fails".
- **`originalText`'s spec kept half of itself.** The case that built the
  field held the only assertion that comma-separated details become
  newline-separated notes. That half is its own case now.

## Things that only became apparent while building

- **0105's condition was already met.** It asked whether the drain on
  reconnect was judged enough. The queue already drained on `online` and on
  **Sync Now**, and the sync tag had never been answered, so nothing had to
  be built before the seam could go.
- **The page cap's warning was the one live fact among the unread ones.**
  Every other unread warning repeated something a row shows. The page cap
  said something no row can, how much of the document was never read, and it
  was dropped as silently as the rest.
- **The browser run met two defects outside #437's list, both fixed on this
  branch.** The import dropzone's refusal banner had no role, so a refused
  file was silent to a screen reader. It is now `role="alert"`, and it sits
  below the zone, outside its `role="button"` (*fix(ui): the dropzone
  announces a file it refuses*). The import history printed each stored
  error's text, in English, in every language. It now reads a failed
  attempt by the app's own sentence where it stored one and by its class
  otherwise, and a failed row by its reason, through catalog keys
  (*fix(ui): import history shows its errors in the reader's language*). A
  drain that failed online for want of a provider therefore says to add a
  key, as the wizard and the camera do, not to check the connection. See
  [../accessibility.md](../accessibility.md) and
  [../receipt-import.md](../receipt-import.md).

## Known gaps

- **Production motion parity is proved only in the browser.** No spec boots
  the real `appConfig`. Journey 87 could not emulate reduced motion in its
  pane, so the reduced-motion half rests on Material's own media query and on
  `motion:check`.
- **The page-cap notice is proved by unit specs and the wizard's smoke.**
  The emulator venue has no provider key, so no PDF longer than fifteen pages
  was read in the browser. Journey 87 saw the notice only through an
  injected signal.
- **Only the first part-read PDF is named by its figures.** A warning
  carries no file name, so the second line counts the others rather than
  naming them.
- **A whole-import failure still shows its stored English in the import
  history.** `failImport` writes `{ message }` with no class and no row, so
  the history has nothing to translate it from and falls back to the stored
  text. Giving that path a class of its own is a follow-up.
- **`build:analyze` runs locally only.** CI runs its self-test, and nothing in
  CI measures the bundle beyond the budget.
