# 178. A schedule is held to its ranges, and a refusal says what was written

**Status:** Accepted, implemented; amended by
[0180](0180-a-saved-key-joins-the-wait-and-a-reader-sees-their-own-language.md)
· **Date:** 2026-10-12 · **Issues:** #490

Reference documentation lives in [../recurring.md](../recurring.md),
[../backup-restore.md](../backup-restore.md),
[../receipt-import.md](../receipt-import.md),
[../smart-search.md](../smart-search.md) and
[../one-shot-reads.md](../one-shot-reads.md).

**Amended by
[0180](0180-a-saved-key-joins-the-wait-and-a-reader-sees-their-own-language.md).**
The ranges, the refusal's split on the record, the catalog read once per
call and the drain's wait for its providers stand. Three statements below
no longer hold as written:

- **Under *A stored rule out of range is repaired by its owner*,** the
  resume refusal's sentence. Under the same key it now reads *Cannot
  resume: this rule's schedule cannot advance. Edit the rule, check its
  interval and day, and save it first.*, because saving the repaired rule
  leaves it paused and a Resume still follows. ja and tc say the same.
- **Under *The drain waits for its providers*,** that the wait answers as
  soon as the bring-up it waited for is still the current one. When that
  bring-up's own key read failed while the device was online, the wait
  first reads the keys once more, in a bring-up of its own for the same
  attempt, and answers on that. A key saved on the AI settings page is
  also a bring-up the wait joins.
- **Under *What the browser runs found*,** that `material:check`'s
  self-test runs 60 cases. Its second rule now holds an option bound
  `[value]="undefined"` as it holds one bound to `null`, and the self-test
  runs 65.

This record takes the four parts of #490: a recurring rule's day, weekday
and month held to their ranges, an import refusal that says what was
written, a search that reads a cold category catalog, and a queue drain
that waits for its account's providers.

Amends
[0175](0175-a-whole-import-failure-reads-in-the-readers-language-and-a-drain-with-no-provider-says-so.md).
Its family reader, its two whole-import sentences and its `no_provider`
filing stand. What changes is what the drain waits for: the account's cloud
providers, brought up for the signed-in account and the current connection,
and no longer the key read alone. The processor stops reading the keys
itself.

It closes a gap of 0141 and a gap of 0175.

- **0141's *`INVALID_FREQUENCY_ERROR` now answers for more than an
  interval*** said the resume refusal told the reader to set an interval of
  at least 1, the wrong instruction for a day below 1 or a bad type. The
  sentence now says the schedule cannot advance, and asks the reader to
  check the interval and the day. It no longer misdirects; for a bad type
  it is still not specific (see *Known gaps*).
- **0175's *The wizard's toast still shows the English*** said the toast
  for a refused completion printed the thrown Firestore message. It now
  reads the refusal through `wholeImportFailureKey`, as Import History
  reads the record, and no path puts the thrown text on screen.

It narrows a gap of 0174 and a gap of 0176.

- **0174's *An out-of-range `dayOfMonth` or `monthOfYear` can still be
  stored*.** Neither the service nor the rules accept such a write any
  more, but a rule already stored that way is left as it is (see *Known
  gaps*).
- **0176's *A search made before the catalog's first snapshot still sees
  an empty list*** said nothing waited for the catalog. A search or a
  Refresh that finds the published list empty now reads the stored
  categories once and merges them over the built-ins, as the goal and
  budget catalogs already did. The gap also named the offline case, a
  first snapshot that waits until the SDK decides it is offline. Once the
  SDK publishes the built-ins alone, the list is no longer empty, the
  stored categories are not read, and that case remains (see *Known
  gaps*).

`adr-index:check` reads no narrowing
([0172](0172-a-closure-is-named-on-both-rows-and-the-adr-index-is-checked-against-the-records.md)),
so those relations are kept on both rows by hand.

## Context

The branch that shipped 0174, 0175 and 0176 left four problems, each in one
of their Known gaps or met while building and reviewing it (#490). None lost
data already stored. Three were silent.

- **An out-of-range day or month was accepted, and the rule stalled.**
  `validateFrequency` in `RecurringService` and `frequencyValid` in
  `firestore.rules` checked only the interval. A monthly rule with
  `dayOfMonth: -60`, or a yearly one with `monthOfYear: -20`, passed both.
  Two mechanisms put the first step before the start. `dateAtClampedDay`
  clamps a day only from above, so a day below 1 lands in an earlier month.
  A month below 1 is not clamped at all: the yearly branch hands the Date
  constructor `monthOfYear - 1`, which normalises into an earlier year. Either
  way the claim's walk broke on the first step. 0174's lookup kept such a rule
  to one row. After that it posted nothing, and nobody was told.
  - The dialog could not produce such a value: its selects offer days 1 to
    31 and weekdays 0 to 6, and it never writes `monthOfYear`. But editing a
    rule already stored that way re-sent it. `populateFromRecurring` put
    `-60` into a select with no option for it, and a save handed it back.
  - The resume refusal, `settings.recurringResumeInvalidFrequency`, told the
    reader to set an interval of at least 1, which is wrong for every
    refusal but the interval's.
- **The wizard's refusal toast printed stored English, and Confirm stayed
  armed.** The confirm's catch interpolated `error.message` into
  `import.importFailed`, *Import failed: {{error}}*.
  - Only English printed the Firestore client's sentence. The ja and tc
    values had no `{{error}}` slot, allow-listed in
    `translation-keys.spec.ts`, so they showed a bare *Import failed* in
    their own language, with no reason and no warning.
  - The Import button sits on Confirm, the fourth step, not on Review. The
    `finally` re-armed it over the same selection, and the service writes
    rows with no id of their own, so a second press landed every row again.
  - The same catch also received two refusals from before anything was
    written: nobody signed in, and a history record the rules turned away.
    Import History holds no record of either.
  - Code review found the same duplicate hazard on the success path. The
    camera and form doors hand their review to the wizard in
    `history.state`, and the success and read-back navigations pushed a new
    entry, so Back rebuilt the review over rows that had already landed.
- **A search or a Refresh before the catalog arrived stored un-rolled
  groups.** `NlSearchService` read the category signal for the model's
  list, for a category scope and for the roll-up of a child into its
  parent. Nothing waited for the first snapshot, and on an account with no
  custom categories and a cache that never synced the query, that snapshot
  waits for the server. Goals and budgets fell back to a one-shot read when
  their signal was empty. Categories had no such fallback.
- **A keyed account's drain could spend a retry while its providers
  started.** The drain awaited only the key read. The providers come up in
  an effect that awaits the key read and then a dynamic import of the
  provider SDK, and `canUseCloud()` stays false until both are done. A drain
  that arrived in between threw `AI_CLOUD_UNAVAILABLE`, was filed
  *Connection problem*, and spent one of its three retries on a scan the app
  could have read a moment later.
  - A pending entry is dispatched again only by an `online` event or by
    **Sync Now**, so a wait that gave up early would strand it.
  - The owner was checked before the wait and not after it, so an account
    switch during the wait would write the receipt into the new account.

Three facts kept the fix small:

- **The restore needed no code.** It already turns a `createRecurring`
  refusal into a per-row skip, so a rule the service now refuses is skipped
  and named like an interval below 1.
- **The precedent for a cold catalog existed.** `goalCatalog` reads the
  goals through `exportAll()` when the signal is empty, and
  `CategoryService.exportAll()` already read the stored categories, from the
  server only, for the backup.
- **The strategy already keyed its bring-up.** The effect stored the
  account and connectivity it last initialised for, so a wait could join the
  same bring-up rather than start a second one.

## Decision

**A recurring rule's day, weekday and month are refused outside their
ranges by the service and by the rules, and a rule already stored outside
them is repaired by its owner in the dialog, never by the app. An import
refused before its record opened stays on Confirm and says nothing was
saved. One refused after it says what Import History will say, drops the
rows it submitted and leaves for Import History. A finished import replaces
the wizard in the browser's history. A search reads a cold catalog once per
call, and a Refresh reads it only when its answer needs it. The drain waits
for its account's providers and spends no retry when they are not up.**

Each commit is cited by its subject.

### The ranges

`test: the stalled-rule smoke writes its broken frequency past the rules`
comes first. The service smoke seeded its stalled rule through the client,
and the new rules would deny that write. The seed now writes a valid rule
through the client and then patches its `frequency` as the emulator's owner,
through a map encoder, `mapField`, added to `emulator-admin.ts`. The patch
masks `frequency` alone, so `updatedAt` stays at the seeded value 0174's
cases assert.

`fix: a recurring rule's day, weekday and month are held to their ranges`
changes `validateFrequency`. It refuses with `INVALID_FREQUENCY_ERROR`
unless the interval is a finite number of at least 1 and each of three keys
is either absent or a finite number in its range:

- `dayOfMonth`, 1 to 31;
- `monthOfYear`, 1 to 12;
- `dayOfWeek`, 0 to 6.

A present `null`, a string and `NaN` are refused with the rest, because
`Number.isFinite` does not coerce. Create, update, resume and the pointer
repair call it unchanged, and the restore reaches it through
`createRecurring`. The JSDoc names the ranges and which values stall.

Which values stall depends on the interval. The bounds refuse every one of
these, because each is a schedule nobody chose:

| Value | What the walk did with it |
|---|---|
| `dayOfMonth: 0` | The step lands on the last day of the month before its target. At interval 1 that is the start month's last day, where the walk stalls; at interval 2 or more it advances. |
| a negative `dayOfMonth` | A day of -k lands k days before the last day of the month before its target. At interval 1 the walk stalls: at once when that falls on or before the date it left (a day of -60), otherwise after one step (a day of -1 from 15 January lands on the 30th and stays there). At a larger interval a small negative day still advances, onto a day nobody chose, and a larger one stalls or advances depending on the interval (a day of -60 advances from interval 4). |
| `dayOfMonth: NaN` | The step is an Invalid Date, and the walk stalls at once. |
| `dayOfMonth` above 31 | The day clamps to the month's last, and the walk advances. |
| `monthOfYear` 0 or below | The step lands a year earlier than its target for a month from 0 to -11 (in month 12 + m), two years earlier for -12 to -23, and so on. Where the interval is longer than that many years, the walk advances every time, onto a month nobody chose and at a shorter step than its interval (a month of 0 at interval 2 posts every December, every year). Where it is not, the walk stalls: at once when the step falls on or before the date it left, otherwise after one step. |
| `monthOfYear` 13 or above | The month rolls into the next year, and the walk advances. |
| `dayOfWeek` outside 0 to 6 | The weekly step adds its 7 × interval days first, so the walk advances, onto a weekday nobody chose. |

In `recurring.service.spec.ts`, twelve out-of-range frequencies each go
through create, a restore-shaped create and update, and each is refused
before its write. The edges, 1 and 31, 1 and 12, 0 and 6, and a frequency
naming none of the three, are accepted. A pin holds that resume refuses a
stored `-60`, and a case that the pointer repair leaves one unrepaired and
says so. The restore smoke, *skips a rule whose day, month or weekday is out
of range and restores the rest*, skips three such rules by name around one
valid rule and finds none of the three stored.

`fix: the rules hold a rule's day, weekday and month to their ranges` adds
`boundedOrAbsent(f, k, lo, hi)`, an absent key or a number in the range, and
ANDs it three times into `frequencyValid`.

- **On create** the bounds hold.
- **On update they are checked only when the write touches `frequency`**,
  as the interval already was. So a rule already stored outside them keeps
  taking every update that leaves `frequency` alone: the claim, a pointer
  write, a rename, a pause. A rewrite of the frequency into range passes,
  and a rewrite to another bad value is denied.
- **`is number`, not `is int`**, for the interval floor's reason: nothing
  guarantees an older document's numbers were stored as integers. Neither
  side tests integrality, so a day of 15.5 passes both.

The rules smoke's *schedule bounds* runs nine out-of-range frequencies as a
create and as an update, and eight in-range ones the same way. Its nested
*on a rule stored outside them* seeds a `-60` rule past the rules, reads it
back, and holds that the claim's update and a rename pass, a rewrite into
range passes, and a rewrite to `-59` is denied.

### A stored rule out of range is repaired by its owner

`fix: a rule out of range opens repairable, and the resume refusal names the
schedule` changes the edit dialog and one catalog value.

- **A stored day that is not a whole number from 1 to 31 opens as unset.**
  The select then shows *Same day as the start date*, and the save, which
  already omits a `null` day, leaves the key out.
- **A stored weekday that is present and not a whole number from 0 to 6
  opens as the start date's weekday**, assigned once the start date is
  read. That is the day the weekly step lands on when no weekday is stored.
  A weekly rule that names no weekday keeps none.
- **`monthOfYear` needs nothing.** The form never loads or sends it, so
  any save through the dialog leaves it out.
- **Nothing is written for the owner.** The dialog shows the repaired value,
  and only the owner's Save writes it.
- **The resume refusal is reworded in place**, under the same key: *Cannot
  resume: this rule's schedule cannot advance. Edit the rule and check its
  interval and day.* ja and tc follow the catalog's voice, without their
  "1以上" and "至少 1".

The smoke case *a stalled rule repaired through an update walks again*
seeds a `-60` rule and updates it to a frequency with no day. The rules
accept the rewrite, the stored frequency has no `dayOfMonth`, and the
pointer is recomputed past now. A catch-up then posts nothing for it, and
once the pointer is patched back to its due date the next catch-up posts
that occurrence once.

The claim is not touched. A rule already stored out of range stays as it is
until its owner edits it (see *Known gaps*).

### The refusal splits on the record

`fix: an import refused before its record opened says nothing was written`
adds `IMPORT_NOT_STARTED` to `ai-import.service.ts`, beside
`IMPORT_READBACK_FAILED`. `confirmImport` throws it, with the original
refusal as `cause`, in the two places that come before the history record
opens: nobody signed in, and a `createPendingImport` that rejects. A
refusal after the record opened keeps its own identity and code, so 0175's
pins stand. The wizard smoke *an import the rules refuse before its record
opens says nothing was written* drives the real service against the
emulator's rules, and finds the sentinel, a `permission-denied` cause, no
record and no row.

`fix: the wizard reads a refused import in the reader's language and never
offers the same rows twice` changes the confirm's catch, after the
read-back branch.

- **Before the record opened**, the wizard raises `import.importFailed`
  through `raiseRoundNotice` and returns. The rows, the selection and the
  step stay as they were, so pressing Import again retries a write that
  never happened. The sentence has no slot in any language: *The import
  could not start, so nothing was saved. Check your connection and try
  again.*
- **After it opened**, three steps, in this order:
  1. the notice reads `wholeImportFailureKey({ message, code })`, with the
     code read through `errorCode`, so a rules refusal reads as
     `import.wholeFailedConnection`;
  2. the submitted rows are dropped, as the partial path keeps only its
     unsaved ones: a row the reviewer left unticked was never submitted and
     stays;
  3. the wizard navigates to `/import/history` with `replaceUrl`, not
     awaited, with a `catch` that swallows a failed chunk load, and only
     while the wizard is not destroyed.
- **The rows go before the navigation**, so even a navigation that never
  arrives leaves no armed Import over rows the write may already have
  taken. The partial path and this branch share one helper, `keepOnlyRows`
  ([0171](0171-second-copies-fold-into-one-copy-of-each-helper.md)).
- **`translation-keys.spec.ts`** drops the `import.importFailed` entry from
  its allow-list of optional slots, and gains *lists only optional slots
  that English interpolates*, so a stale entry fails
  ([0145](0145-a-class-found-by-reading-becomes-a-gate.md)).

The wizard smoke *an import whose completion the rules refuse reads in the
catalog, lands once, and leaves for its record* presses the real Import
button with `completeImport` refused. Each row lands once, the record is
failed with the code, the notice holds the connection sentence's key, the
navigation replaces the wizard, and the Import button is disabled.

`fix: a finished import leaves no way back into its review` gives the
success navigation and the read-back navigation one helper,
`leaveForTransactions`. Each notice is still raised first; the helper then
drops the submitted rows, replaces the wizard in history (`replaceUrl`) and
swallows a failed navigation, which it does not await, and navigates
nowhere when the wizard was destroyed while the write ran. A review the
camera or form door handed over in `history.state` is taken out of the
wizard's entry once Import is pressed, before the write, and the header's
back arrow is disabled while the write runs, so no exit leaves a way back
into rows that may have landed. A write that never started wrote nothing,
so its refusal puts the handoff back for a reload, unless an earlier round
of the wizard reached the record, when the handoff may hold rows that
landed, or the wizard was destroyed meanwhile and the entry is another
page's. A browser that refuses the history write, as WebKit does with a
`SecurityError` when the history is written too often, leaves the handoff
where it was, and the import goes on and unseals as usual. In the wizard
spec, *when it leaves for the transaction list* holds both exits' rows and
a navigation that fails to load, and *a review handed over in history*
holds the handoff taken out during the write on a success, a partial
import, a refused completion and a write that never started, put back
after that last one only, with a retry keeping its photos, nothing put
back after a refusal that follows a partial import, nothing put back into
an entry the reader left for, and the import going on when the browser
refuses the write.

### The catalog is read once per call

`fix: a search with a cold category catalog reads it once` adds
`categoryCatalog()` to `NlSearchService`: the published signal when it is
not empty, otherwise `mergeCategories(defaultCategories(), await
this.categoryService.exportAll())`.

- **`search()` resolves it once**, inside its `try` and before the model is
  asked, and hands that one list to `buildContext` and `computeAggregate`.
  A read that rejects lands in the existing catch, so the search falls back
  to keywords before the model is paid.
- **`replayAggregate` reads it only when the answer needs it**: a
  `topCategories` answer, a `categoryId` scope, or a `searchQuery`, which is
  matched against category names. Any other replay passes an empty list and
  reads nothing.
- **The list is threaded, not re-read.** `applyScope`, `categoryNamesMap`,
  `parentOf` and `rollUpToParent` take it as a parameter, so one answer never
  mixes two states of the catalog.
- **It is not written into the signal.** The listener owns that.
- **The length test reads any published list as warm.** A published list
  always holds the built-ins merged in, and signing out empties it. Signed
  out, `exportAll()` answers `[]`, so the list is the built-ins alone. But
  once the SDK decides it is offline, the listener can publish a first
  snapshot from a cache that never held the query: the built-ins alone.
  The test then takes that list as warm, and a stored custom child is not
  rolled up (see *Known gaps*).

The unit cases cover a built-in child and a stored custom child rolled up
from a cold signal, a scope narrowed to a parent, search text matched to a
category's name, a context that names a child under its parent, one read
for an aggregate search, and a failed read on each path. Pins hold that a
warm signal is never re-read and that a cold `sum` with no category and no
text reads nothing. The smoke *from a cold category catalog* rolls both
children up against the emulator with nothing subscribed, and asserts the
read opened no listener.

### The drain waits for its providers

`feat: the strategy says when the cloud providers are up for the account`
changes `AIStrategyService`.

- **One bring-up per attempt.** `bringUpFor(attempt)` starts
  `initializeCloudProviders()` when the attempt, the user id and the
  connectivity, differs from the one started last, and returns the bring-up
  for it either way. The effect and the wait both come through it, so
  whichever arrives first starts it and the other joins it.
- **`cloudProvidersReady()`** loops. With nobody signed in it answers
  `false`. Otherwise it takes the bring-up for the current attempt; if that
  is the one it has just waited for, it answers whether the device is
  online. If not, it waits for it, a failure swallowed, and looks again.
- **The loop compares bring-ups by identity**, not attempts by string. A
  connection that drops and returns during the wait leaves the same attempt
  string but has started a newer bring-up, and the wait follows it.
- **A bring-up that fails still answers**, with whatever came up.

`fix: a queued scan waits for its account's providers and spends no retry
while they start` changes `OfflineQueueProcessorService`. Where the drain
awaited `ProviderKeyService.resolve()`, it now awaits
`cloudProvidersReady()` and checks the owner again. When the answer is
`false`, or another account signed in during the wait, the entry goes back
to `pending` with no error, the owner check's own write, so `retryCount` is
untouched. The processor no longer injects `ProviderKeyService`.

"Not ready" is three things: nobody signed in, the owner changed, or the
device offline when the wait ends. A bring-up whose key read failed is
ready by this answer: the drain goes on and, if the cloud refuses, is filed
`network`, as 0175 records.

The strategy's *cloud provider readiness* cases hold the order, keys then
the SDK import, and that the wait starts the bring-up itself when it comes
first, joins a reconnect's, follows a newer one, answers `false` signed out
or offline, and still answers when the bring-up fails. The provider smoke
*says the providers are ready only once a stored key has armed Gemini*
holds the order over the real graph, with a key seeded and no vendor
contacted. The processor smoke *a drain whose providers are not up leaves
the scan pending, its retries unspent* finds the entry pending with no
retry spent, no error and no record.

### The reference docs

This record's commit, `docs: ADR 0178 and the references the schedule
bounds, the refusal and the cold catalog changed`, brings the reference
docs to the code:

- **`recurring.md`:** the frequency table, the resume refusals, *What makes
  a rule valid* with the stall table above, and the Known gaps;
- **`backup-restore.md`:** a refused rule among the skipped rows;
- **`receipt-import.md`:** the refusal's two branches, the finished
  import's history entry, a whole-import failure's card with no figures,
  the drain's provider wait, and the Known gaps;
- **`smart-search.md`:** the cold catalog, which offline Refreshes now
  fail, and the Known gaps;
- **`one-shot-reads.md`:** a section for the search's category catalog;
- **`performance.md` and `testing.md`:** `material:check`'s second rule
  (see *What the browser runs found*).

## What was rejected

- **Reading the catalog at the top of `buildContext` and of
  `computeAggregate`**, as the issue proposed. A cold aggregate search would
  read it twice, and one answer could interpret the question against one
  state of the catalog and roll its groups up against another.
- **Reading it on every replay.** An offline Refresh of a sum with no
  category and no text would then fail for a read it never uses.
- **A cached read for the cold catalog.** Offline, `getCollection` answers
  from the cache, and on a device that never synced the query the cache
  holds nothing, so the list would be the built-ins alone. A custom child
  would then go un-rolled into a stored answer, the defect being fixed. The
  server-only read the backup already uses fails instead, and the Refresh
  says so. That holds while the signal is empty: once the SDK reports
  offline, the listener's own first snapshot can hand the signal the same
  built-ins-alone list, and the read is never made (see *Known gaps*).
- **Writing the cold read into the signal.** The listener owns the signal,
  and a second writer would race its first snapshot.
- **A wider "not ready"**, one that also counted a failed key read. A
  pending entry is dispatched again only by `online` or **Sync Now**, so an
  entry held back while online would sit there, with no record, until
  something else woke the queue.
- **Comparing attempt strings to end the wait**, the first shape. A
  connection that dropped and returned during the wait matched the attempt
  it had waited for, and the wait answered from the older bring-up while the
  newer one was still loading.
- **One sentence for both refusals.** `wholeImportFailureKey`'s sentences
  say the record could not be finished and the rows may already be in the
  list. Before the record opens, nothing was written, and saying otherwise
  invites a check for rows that are not there.
- **Leaving the wizard on Confirm after the record opened**, with the rows
  unticked. The record that says what happened is on Import History, and a
  wizard holding rows that may have landed is the hazard.
- **Awaiting a navigation out of the wizard, or leaving it uncaught**, on
  any of its three exits: to Import History after a refused completion,
  and to the transactions list after a success or a failed read-back. A
  failed chunk load reaches the global handler, which replaces the honest
  notice with the generic error.
- **Repairing a stored out-of-range rule for its owner**, at load or in
  the claim. Picking a day on the owner's behalf is the invention
  [0014](0014-recurrence-guards-and-anchors.md) and
  [0141](0141-a-recurring-rule-in-a-bad-state-is-repaired-where-its-data-allows-and-refused-where-it-does-not.md)
  refused. The dialog shows its choice, and the owner saves it.
- **An integer test in either place.** The interval floor rejected `is
  int` because an older document's numbers need not be stored as integers,
  and the ranges follow it.

## Consequences

- **The rules change, and deploy with the merge**
  ([0077](0077-merges-deploy-what-they-changed.md)). The rules in
  production before it accept any day; the new ones refuse a write of an
  out-of-range frequency, and a restore already skips such a refusal per
  row. So the web and rules deploys can land in either order. Before the
  deploy, the owner's stored rules were read once through
  `RecurringService.exportAll()`, and that read was read-only: one rule,
  none out of range. A rule with no `nextOccurrence` is not listed by it.
  The session it ran in, served on port 4200 against production, booted on
  `/dashboard` before the deep link landed, so the dashboard's catch-up ran
  once against production with this branch's code. It posted nothing: the
  read found the one rule in range and none stamped in the fifteen minutes
  before it.
- **What a reader sees change:**
  - the resume refusal's sentence, and the import refusal's;
  - Import History, after a completion the rules refused, and the card of
    such a record, which shows no figures (see *What the browser runs
    found*);
  - Back, after a finished import, which no longer returns to the review,
    and the wizard's header back arrow, disabled while the import is
    written;
  - the dialog's day, and weekday, on a rule stored out of range;
  - a select's empty option, shown in its field (see *What the browser runs
    found*);
  - a category id the catalog cannot name, on the search's answer card, its
    dialog's chips and the insight chips, which reads *Unknown* in the
    reader's language (see *What the browser runs found*).
- **No record shape changes.** A refusal before the record opened leaves no
  record, as before. No catalog key is added; two values are reworded.
- **An entry handed back pending waits** for the next `online` event or
  **Sync Now**, as one handed back for another account always did.
- **An offline Refresh with a cold catalog fails** for a top-categories
  answer, a category scope or search text, with the refresh-failed notice
  and the stored answer untouched, while the signal is still empty. Once
  the SDK reports offline, the listener can publish the built-ins alone,
  and the Refresh answers from them (see *Known gaps*). Every other offline
  Refresh answers from the cache as before.
- **The initial bundle.** Measured per input against `697c13ab`:
  `ai-strategy.service.ts` took 424 bytes for the wait,
  `nl-search.service.ts` 268 for the catalog read, `recurring.service.ts`
  206 for the ranges, `ai-import.service.ts` 145 for the sentinel, and
  `offline-queue-processor.service.ts` 106 for the gate. The wizard and the
  recurring dialog are lazy. The select fix below took 60 more, because
  `quick-add.service.ts` imports the transaction form statically. The card
  fix below is in the lazy Import History page, and took none. The
  category-name fix below, as first committed, folded the answer card's and
  the search dialog's copies of the rule into one: 18 bytes less as
  measured, 17 against the recorded figure, the one byte between the two
  baselines unexplained. The branch review's fixes after it added 48, the
  rule's move into core and its longer key among them. With the work of
  #468, the warning moved to 2.409 MB, and the final figure sits 5 bytes
  under it.
  [../performance.md](../performance.md) records the measured figure.
- **The first browser run saw it** in the emulator venue on 2026-10-12, as
  journeys 93, 94 and 95, after journeys 87 (steps 4 and 5), 88 (step 2) and
  90 were re-run as regressions. The no-key drain still failed with one
  retry spent and read *No AI provider configured*, and the stalled-rule
  pass still held.
  - **Journey 93, a schedule.** A paused `-60` rule seeded past the rules
    refused to resume with the new sentence, in en and ja. The dialog opened
    its day as *Same day as the start date*, and Save stored a frequency
    with no day and a pointer on the next 5th. A hand-edited backup holding
    one such rule restored nothing, skipped one, and the rule was not
    stored.
  - **Journey 94, a refused import.** With the record's opening refused, the
    wizard said nothing was saved, stayed on Confirm with its three rows
    ticked, and wrote no record. With the completion refused, in ja, the
    notice read the connection sentence, the page was Import History, Back
    did not return to Confirm, the card read the same sentence, and each row
    was stored once. After a successful import, Back from the transactions
    list did not land in the wizard.
  - **Journey 95, a cold catalog.** With the catalog signal emptied from
    the console on `/search-history`, a Refresh read the stored categories
    once and stored `bills` with its child Electricity rolled in. The unit
    spec and the smoke own the cold window itself.
  - **A second run**, the same day, passed them all again and found two
    more defects (see *What the browser runs found*).
  - **A third run**, partial, on 2026-10-14, re-checked what changed after
    the second, the fixes for its two defects and the branch review's fixes
    after them, on the final tree. Every step it ran passed, and it found
    nothing more.

## What the browser runs found

The first two runs were in the emulator venue on 2026-10-12. The first
found the select's empty option. The second re-ran journeys 87 (steps 4 and
5), 88 (step 2) and 90 (steps 3 to 5) as regressions, then 93 to 96, and
every one passed; on the way it found two more defects: a refused
completion's card showing figures nothing had counted, and, in journey 95's
shot, a category the catalog could not name read in English on a Japanese
page. It ran before either was fixed and before the branch review's fixes,
so the tree it drove was not the final one. A third run, partial and in
the same venue, re-checked them on 2026-10-14 on the final tree: journey
95's steps 1 to 3 in Japanese, journey 94's steps 1 and 2, and journey 93's
edit, with the shots `95-cold-refresh-unknown-ja`,
`94-refused-after-rows-ja-r3` and `93-edit-day-unset-r3`. Each step passed:
the dialog's day read *Same day as the start date*, floated; both refusals
read as their journey says, and the refused completion's card showed no
figures; and the refreshed card named each group *不明*. It found no further
defect.

- **A select's empty option showed an empty field.** In the first run,
  journey 93 opened the repaired rule and found the *On day* field blank,
  its label sitting inside it, though *Same day as the start date* was the
  selected meaning. Material reads an option whose value is `null` as a
  reset option unless the select sets `canSelectNullableOptions`. Four
  selects had the defect: the recurring dialog's day and reminder, and the
  transaction form's budget period and goal.
  `fix(ui): a select's empty option shows its own label` sets the attribute
  on the four, and real-template specs read each field's text and its
  floated label. The defect is a shape a template can be read for, so it
  became a gate, as
  [0145](0145-a-class-found-by-reading-becomes-a-gate.md) asks of a class:
  `material:check`
  ([0128](0128-a-material-module-a-template-never-uses-fails-the-build.md))
  gains a second rule, that a `<mat-select>` whose body holds an option
  bound `[value]="null"` carries the attribute. Its close tag is matched
  exactly, so a `<mat-select-trigger>` ahead of the options does not cut the
  body short. The self-test runs 60 cases. The run re-checked the day, the
  reminder and the budget period afterwards, each showing its empty option
  with its label floated.
- **A whole-import failure's card showed figures nothing counted.** In the
  second run, journey 94's second step refused a completion, as the rules
  do, after both rows had landed, and the record's card on Import History
  read 0 transactions, +$0.00 and -$0.00 in its tiles, under its own
  sentence that the transactions may already be in the list. Only
  `completeImport` writes `successCount` and the totals; `failImport`
  stamps the status and the error, and the completion was the write
  refused, so the record held the zeros it was opened with.
  `fix(ui): a whole-import failure shows no figures it never counted` draws
  no tiles for a record filed that way: failed, with no class, and no error
  naming a row (`isWholeImportFailure`). A receipt attempt's failure, where
  nothing landed and 0 is true, and a failed record whose errors name rows,
  whose counts were taken, keep theirs. The component spec holds each side,
  and the import-history smoke *a stored whole-import failure shows no
  figures it never counted* reads a seeded record. The run re-checked both
  cards afterwards: `e2e-94b.csv` showed only its chips and its sentence,
  and `e2e-94c.csv`, completed in step 3, kept its tiles, 1 transaction and
  -$7.50. After the branch review the tiles also hide for a record left
  `pending` (`figuresUncounted`), whose counts were never written either:
  its completion was refused and the `failImport` after it was refused too
  or never answered, or the tab closed mid-write. A real-template case holds
  it: *shows no figures for a record left pending, whose counts were never
  written*.
- **A category the catalog could not name read in English.** In the second
  run, journey 95's shot, taken in Japanese over the emptied catalog
  signal, named every group of the refreshed answer *Other*, in English.
  The answer card, the search dialog's chips and the insight chips each
  fell back to a literal English *Other* for a category id the catalog
  could not name: displayed text in no reader's language
  ([0036](0036-a-user-facing-string-lives-in-the-catalog.md)).
  `fix(ui): a category the catalog cannot name reads Unknown in the
  reader's language` gives the three, as the branch review shaped it, one
  rule in core: `categoryDisplayName` and `categoryNameOrUnknown` in
  `core/utils/category-display.utils.ts`, which `CategoryHelperService` now
  delegates to as well. It reads the app's existing
  `common.unknownCategory`, *Unknown*, *不明* or *未知*, so the search
  surfaces name such an id as the transaction list does, and it cannot
  read as the real catch-all: `categories.other` reads *その他*, the same
  as `categoryNames.otherExpense`, the catch-all's own name. The util's
  spec holds a known id, an unknown one and a nameless one, and the
  card's, the dialog's and the insight chips' specs expect the key. The
  groups still fall back on that journey's emptied signal, by design, now
  in the reader's language.

## Departures from the issue

- **The catalog is read once per call, not at the top of each reader.** See
  *What was rejected*. A Refresh reads it only when its answer needs it.
- **"Not ready" is narrow.** The issue said a drain whose providers are not
  ready leaves the entry pending. Here that is nobody signed in, the owner
  changed, or the device offline when the wait ends. A bring-up whose key
  read failed proceeds, and its drain is filed as 0175 files it.
- **The toast's English was en-only.** The issue said a reader in ja or tc
  saw *Import failed: Missing or insufficient permissions.* The ja and tc
  values had no slot for the message, so they showed a bare *Import failed*
  in their own language, with no reason. 0175 was wrong the same way when it
  said the English showed in every language.
- **The refusal splits on the record.** The issue had every refusal read
  `wholeImportFailureKey` and leave for Import History. A refusal before the
  record opened has written nothing, so it stays on Confirm with a sentence
  that says so. The owner chose the split.
- **The step was Confirm, not Review.**
- **A finished import replaces the wizard in history too.** The issue named
  the refused completion only. Code review found the same hazard after a
  success and after a failed read-back. The branch review then found the
  handed-over review left in history by every other way out, the header's
  back arrow during the write, a partial import and a failed navigation, so
  it is now taken out once Import is pressed, and put back only when the
  write never started and no earlier round of the wizard reached the
  record.
- **The restore needed no change**, as *Context* says.

## Departures from the plan

- **The dialog's weekday choice.** The plan replaced any weekly weekday
  that is not a whole number from 0 to 6 with the start date's. An absent
  weekday is valid in both checks, and writing one into a rule on an
  unrelated edit would change its schedule, so only a weekday that is
  present and out of range is replaced. The dialog's tests are whole
  numbers, stricter than the service's, so a stored day of 15.5 opens as
  unset and the next save drops it.
- **The wait reads its state once per pass.** The plan computed the
  attempt, waited, and computed it again. The shipped loop takes the
  current bring-up at the top of each pass and ends when it is the one just
  waited for, which gives the same answers in fewer bytes and compares by
  identity.
- **The exits share helpers.** `keepOnlyRows` serves the partial path and
  the refused completion, and `leaveForTransactions` the success and the
  read-back. Each exit that navigates is skipped once the wizard is
  destroyed, so a reader who has moved on is not pulled back.
- **The drain smoke's failed-drain case reads the keys through the
  stubbed strategy.** The processor no longer reads them, so the smoke's
  readiness stub makes the read in the bring-up's place.

## Things that only became apparent while building

- **A repaired rule does not post on its next load.** `updateRecurring`
  re-anchors the pointer past now on any frequency change, so the
  occurrences missed while the rule was stalled are not owed (see *Known
  gaps*).
- **The pointer repair now refuses a rule it used to repair.** A weekday of
  9 advances, and the repair used to rewrite such a rule's unreadable
  pointer. It now leaves the pointer and warns that the frequency cannot
  advance or is out of range.
- **An uncaught navigation fails no spec.** A rejected navigation is only
  logged, so the case for a failed chunk load passed without the `catch`
  until it spied on `console.error`.
- **A smoke double hid a fallback.** The search smoke's history double had
  no `recordFilter`, so a search that interpreted to a filter threw inside
  `search()`'s `try`, and the existing *from cold signals* case had been
  returning the keyword fallback while passing. The double gained the
  method, and the new case asserts the result's kind.

## Known gaps

- **A rule already stored out of range is not repaired.** The claim checks
  no range. One that stalls stays inert under 0174's lookup, posting its
  stuck occurrence once; one that advances, a day above 31, a weekday
  outside 0 to 6, or a day or month below its range wherever the table
  under *The ranges* says it advances, keeps posting on the days it
  computes. Nothing tells the owner, and only an edit through the dialog
  puts it right. A write that skips the rules, through the Admin SDK or the
  console, can still store one.
- **A repair does not post what was missed.** Saving a corrected frequency
  moves the pointer to the first occurrence after now, so the occurrences
  that fell due while the rule was stalled are never posted.
- **The pointer repair and resume refuse an out-of-range rule that still
  advances.** A stored day of 32 or weekday of 9 is refused on resume, and
  its unreadable pointer is left unrepaired, where before both went ahead.
  The owner edits the rule first.
- **A bad type is told to check the interval and the day.** A stored
  `frequency.type` outside the four known kinds gets the same resume
  refusal. Its first half is true, but the type is the field to change.
- **The dialog drops a stored `monthOfYear`, in range or not.** It never
  loads the key, so any save rewrites the frequency without it, and a yearly
  rule then takes its month from its start date.
- **A failed key read still files *network*.** 0175's entry stands: a drain
  whose bring-up could not read the keys goes on, and a refusal from the
  cloud is filed as a connection problem, even on a device with no key. And
  the read is not tried again until the account or the connection changes,
  because the next drain joins the finished bring-up for the same attempt.
- **A key saved on the AI settings page is not waited for.** Saving one
  there brings its provider up through `ProviderKeyService.setKey` and then
  `CloudLLMProviderService.updateProviderApiKey`, outside the bring-up the
  drain waits for. A **Sync Now** pressed on the same page before that
  bring-up finishes joins the attempt's finished one, is told the providers
  are ready, and can still file the entry and spend a retry. The class
  predates this record; closing it is a follow-up. *Closed by*
  [0180](0180-a-saved-key-joins-the-wait-and-a-reader-sees-their-own-language.md):
  the page saves through the strategy, and the save is the bring-up a wait
  joins.
- **A drain killed during the wait spends a retry.** The entry is marked
  processing while it waits, and the wait has no time limit, as the key
  wait before it had none. A tab closed or an app swiped away then is
  swept back to pending at the next launch, at the cost of one retry.
- **The model call's window stays.** The owner is checked again after the
  wait, but an account change during `processReceipt` still lands the rows
  in the account signed in when they are written, as 0174 records.
- **A throw before the sentinel's wrapper reads as after the record.**
  `planReceiptAttachments` runs before the history record opens and outside
  the `IMPORT_NOT_STARTED` wrapper. Nothing reachable throws there today,
  but a throw would drop the rows and send the reader to a history with no
  record.
- **A partial import's reload drops the rows that failed.** The handoff
  is taken out of the wizard's entry for every outcome but a write that
  never started, so after a partial import the rows that failed stay on
  screen until a reload, which then offers nothing, and a refusal on a
  later round, after a partial import, puts nothing back. Writing the failed
  rows back as a smaller handoff would keep them across a reload, and is
  left for later. A refusal before the record opened puts the handoff back
  when no earlier round reached the record, and a browser that refuses the
  history write leaves it where it was, so on that rare path alone a reload
  can offer rows already written.
- **An option bound to `undefined` still shows an empty field.** The five
  *All* options in the transaction filters are bound `[value]="undefined"`,
  which Material reads as a reset option the same way. The gate's rule
  names `null` only, and whether an unset filter should read *All* is a
  product call left open. *Closed by*
  [0180](0180-a-saved-key-joins-the-wait-and-a-reader-sees-their-own-language.md):
  the owner chose *All*, the five selects set the attribute, and the rule
  names `undefined` too.
- **Offline, the catalog's length test can take the built-ins alone.**
  Once the SDK decides it is offline, the listener the search dialog and
  the history page open can publish a first snapshot from a cache that
  never held the catalog's query: the built-ins alone, which is not empty.
  `categoryCatalog()` then takes the signal as warm and never reads the
  stored categories, so a Refresh of a top-categories answer over a stored
  custom child stores that child un-rolled, over what the answer held. The
  server-only read fails a Refresh only before that snapshot. Treating a
  list with no stored row as cold would fail every offline Refresh of such
  an answer on an account with no custom categories, so the code is left as
  it is. This is the part of 0176's gap that remains, which is why this
  record narrows that gap rather than closing it.
- **No gate holds an English display fallback.** The class the category
  fix belongs to, a literal English word shown for a value the catalog
  cannot name, still has sites outside this record: a hard-coded
  `'Unknown'` for a category id the catalog lacks in the spending chart,
  the recurring list, the category suggestion, the category breakdown and
  the spending analysis, among others.
  [0145](0145-a-class-found-by-reading-becomes-a-gate.md) asks for a gate on
  a class found by reading, and
  [0151](0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)
  forbids a freeze that would let those sites stand, so the gate waits for
  a wave that fixes them. *Closed by*
  [0180](0180-a-saved-key-joins-the-wait-and-a-reader-sees-their-own-language.md):
  every displayed site reads the reader's word, and `i18n:check`'s fifth
  scan holds the class, with the words stored on a row kept by the owner's
  decision.
- **The model-facing fallbacks stay English.** `cloud-llm-provider.base.ts`,
  `rag-context.service.ts` and the search context's `nameOf` in
  `nl-search.service.ts` still name a category they cannot resolve *Other*.
  `nameOf` resolves a parent among active categories only, so a child of a
  deleted group, which stays active, reaches the model as, say, *Other /
  Electricity*. That is prompt context, not displayed text.
