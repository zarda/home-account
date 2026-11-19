# 197. A deleted transaction can be brought back for ten seconds, because the delete waits

**Status:** Accepted, implemented · **Date:** 2026-11-19 · **Issues:** #555

Reference documentation lives in [../accessibility.md](../accessibility.md),
[../household.md](../household.md), [../period-totals.md](../period-totals.md),
[../receipt-quota.md](../receipt-quota.md), [../splits.md](../splits.md),
[../i18n.md](../i18n.md), [../testing.md](../testing.md),
[../emulator-blind-spots.md](../emulator-blind-spots.md),
[../performance.md](../performance.md) and [../e2e.md](../e2e.md).

A transaction deleted from the list was gone the moment *Delete* was
confirmed. The confirmation dialog was the only guard, and a reader who
confirmed the wrong row had to enter it again by hand: the amount, the
category, the receipt photos, its goal link and its household share (#555).
This record makes the delete wait. The row leaves the screen at once, a
notice offers **Undo** for ten seconds, and only when that window ends does
`deleteTransaction` run. Undo shows the row again, because nothing was
touched.

A new decision. It keeps the confirm that
[0017](0017-the-row-stacks-and-actions-ride-behind-a-swipe.md) (*The row
stacks its lines, and actions ride behind a swipe*) sends the swipe's Delete
through. It answers yes to an undo where
[0108](0108-the-review-step-removes-a-row.md) (*The review step removes a
row*) answered no, on another surface and for reasons that do not carry over
(below). The hand-off of focus after a delete is
[0196](0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)'s;
this record makes it run as the confirm returns.

## Context

**What a delete touches.** `TransactionService.deleteTransaction` reads the
row and the paths of its household copies, then removes the row and its
copies in one commit. A row linked to a goal is removed in a transaction that
backs its amount out of the goal's `linkedAmount` in the same commit. It then
sweeps the row's receipt objects from Storage, tells the receipt quota the
images are gone, and recalculates the budget of an expense's category. The
receipt objects and the goal's counter cannot be put back by writing the row
again, and every member of a household sees the copies go.

**Nothing held a pending row.** There was no soft-delete flag and no
optimistic state. `NotificationService` showed transient notices with a
Close action and a tone's duration, and its own comment said a snack bar was
transient feedback only.

**The doors.** The list has three single-row doors, all through
`confirmDelete`: the desktop actions menu, the phone row's menu and the swipe
drawer. 0017 sends the swipe through the same confirm as the menus, so a
stray swipe asks before it deletes. The confirm read *Are you sure you want to
delete "{{description}}"? This action cannot be undone.*

**An earlier no.** 0108 gave the review step's Remove no undo. It would have
needed the row, its index, its editing state and its verdicts held somewhere
with a lifetime, and a second way for a row to reappear in the batch that the
duplicate pass and the attachment planner would both have had to learn; and
Deselect, one control over, already was the reversible answer. Neither reason
holds in the list. Nothing in the list is a reversible answer: the confirm is
the only guard, and what a mistake costs is everything the row carried. And
an undo here need not be a second way in. If the delete waits, the row never
leaves the store, the window that lists it or any household copy; the page
only stops showing it, and Undo takes one id out of one set. 0108's review
step is untouched: its Remove still has no undo.

## Decision

**A confirmed delete waits ten seconds before it is made. Undo inside that
time only shows the row again. The delete is made at once when the reader
leaves, hides the page, signs out or deletes another row.**

### The delete waits, and Undo only shows the row again

`PendingDeleteService` (`src/app/core/services/pending-delete.service.ts`, in
root) holds the delete. `defer(transaction)` opens the notice and starts the
window; it hides nothing itself and resolves with how the delete ended:
`'undone'`, `'deleted'`, `'failed'` or `'signed-out'`.

The window is `UNDO_WINDOW_MS`, ten seconds, on the service's own timer, not
on the notice's duration. It stands still while the notice is hovered or
holds focus, and runs out what was left once let go. The timer runs outside
Angular, so a waiting delete does not keep the app from reporting itself
stable for ten seconds; the delete itself runs inside.

When the window ends, `deleteTransaction` runs, unchanged. Undo only
dismisses the notice and settles `'undone'`: the receipts, the goal link, the
budgets and the household copies were never touched, and the other members of
a household see nothing until the delete is real. `transactions.restored` is
announced politely once the row is back.

### One delete waits at a time, and a flush takes it once

A second `defer` first makes the waiting delete real. A flush takes the
waiting delete synchronously, takes its notice down and only then deletes, so
two triggers arriving together delete once (twice would count the receipts
out of the quota twice), and an Undo pressed after a flush began finds nothing
to take back. Every handler a notice is given acts only while its own delete
is the one waiting, so a notice that leaves late, after the next one has
opened, cannot flush the next delete. A row already on its way gets no second
notice; its outcome is handed back again.

A notice that leaves the screen for any reason but its Undo makes its delete
real, since that Undo can no longer be reached. Material shows one snack bar
at a time, so another notice opening in its place is such a reason.

### The page hides the row until the delete is real and the window has let it go

The transactions page keeps the confirmed rows in `hidden`, a map from id to
whether the delete was carried out and the filters it was deleted under. The
list leaves those ids out; so does `PeriodTotalsService`, through an `exclude`
set the page writes from the same map, which refolds the swept rows at zero
reads. An id is let go only once its delete is done **and** the loaded window
no longer holds it, since a refresh can fail without a word, or when the page
goes.

The header count takes off the hidden rows the server count still holds.
`TransactionWindowService` now reads the count beside each page and sets it in
the same step as the page (`readTotalCount()`), so a row the window holds is
one the count holds. A row whose delete still waits is on the server whatever
the window holds, so under the filters it was deleted under it is taken off
the count even once a scroll has trimmed it from the window or a jump has
moved the window elsewhere.

### The delete is made real on leaving, on hiding and at every sign-out door

The page flushes in `ngOnDestroy` and on `visibilitychange` once the document
is hidden: a page left takes its Undo with it, and a hidden page may never be
shown again.

The three sign-out doors (the header's, the Settings page's after its own
confirm, and the lock screen's) await `flushBeforeSignOut()` before
`signOut()`. It makes the waiting delete real and waits for every running
delete to settle, for `SIGN_OUT_WAIT_MS`, five seconds, at most. The page
stays in use meanwhile, so a delete confirmed during the wait is made real
and waited for too, within the same five seconds, counted from the
sign-out: left waiting, it would meet nobody signed in once the sign-out
landed, and never run. A delete made offline settles only once the
connection returns, and a sign-out must never wait on that: on the lock
screen sign-out is the one way off the screen. The lock screen still clears
the credential first.

A flush deletes only for the account that asked. With nobody signed in, or
someone else, it settles `'signed-out'`, deletes nothing and says nothing.

### The notice carries one action and is heard once

`NotificationService`'s new `withAction` opens a neutral
notice (`snackbar-info`) with one action in place of Close and no Material
duration, and returns an `ActionNotice` bound to that notice alone:
`onAction`, `afterDismissed`, `onHold` (the pointer over it or focus inside
it) and `dismiss`, which never takes another notice down. The service's
comment now names this as the one exception to transient feedback only.

The snack bar's own live region is off for it (`politeness: 'off'`), and the
notice is announced once, politely, through the app's announcer. What is
heard is the caller's announcement: `PendingDeleteService` passes
`transactions.deletedWithUndo`, *Deleted {{description}}. {{action}} is
available for a few seconds.*, with the translated `common.undo` in
`{{action}}`, so the spoken text names the button in every language. What is
shown is `transactions.deleted`, *Deleted {{description}}*, beside **Undo**.

While the phone's bottom nav is shown, every notice opens above it:
`body.bottom-nav-shown .mat-mdc-snack-bar-container` takes
`margin-bottom: calc(64px + var(--safe-bottom) + 8px)`, so the Undo does not
sit where a thumb reaches for the tabs. The notice opens outside the shell,
so the shell marks the body: `MainLayoutComponent` sets `bottom-nav-shown`
while the bottom nav is shown and takes it away when the shell goes. The
rule was first keyed on `body:has(.bottom-nav-container.visible)`, which
iOS 15's WebView before 15.4 does not parse; it drops the whole rule there,
and the notice sat over the tabs.

### Focus goes on as the confirm returns, and comes back with the row

The page hides the row the moment the confirm returns, so the list's
hand-off (0196) runs then: focus that dropped goes to the menu button of the
row now in the deleted row's place, else of the row before it, else to the
empty state's button.

When Undo or a failed delete brings the row back, the page tells the list
(`deleteUndone`, `deleteFailed`). Both scroll to the row and offer
focus to its menu button through `focusWhenRendered` with `onlyIfDropped`,
and with `from` set to the snack bar when focus is inside one Material has
started to take down (`mat-exit` on its container): the Undo button keeps
focus while the notice plays its way out and then drops it. Focus in a
notice still up stays where it is: a failure arrives late, when the notice
up is the next row's, whose Undo the reader may be about to press. Focus the
reader has put anywhere else stays there too. On a phone while rows are
being chosen, the row shows its checkbox in place of its menu button, so the
checkbox is offered focus last. While another row's delete, confirmed
since, waits to hand focus on, that hand-off decides.

### A delete that fails brings the row back, named, once no Undo is up

A failed delete settles `'failed'`; the page shows the row again and the list
offers it focus. The service logs `[PendingDelete] Delete failed:` in place
of the page's own line, and opens the error notice itself,
`transactions.deleteFailed`, *Couldn't delete {{description}}*, wherever the
reader is by then. It opens it only once no Undo notice is up: a failure
arrives up to a window after its confirm, and an error notice opened over the
next row's notice would take that notice down and make the next delete real
with no Undo, under a notice the reader would take to be about that row. It
looks a microtask later, so the flush a `defer` starts just before opening
its own notice is not taken for the last notice going. A failure is told only
to the account that asked.

### The confirm stays, and no longer says the delete cannot be undone

The dialog is kept on all three doors; 0017 sends the swipe through it. Of
its four messages for a single row, the two that said *This action cannot be
undone.*, `transactions.deleteConfirmMessage` and
`transactions.deleteUntitledMessage`, lose it in English, Japanese and
Traditional Chinese, since it is no longer true; a split part's two never
said it.

### Only the list's three row doors

`PendingDeleteService` is the one caller of `deleteTransaction` in the app,
and the list's three single-row doors are the only way a delete reaches it.
A split purchase's part is one row there, and its delete waits the same way.
*Delete all* and account deletion keep their typed confirmation and get no
Undo.

## What was rejected

- **A restore.** Writing the row back on Undo would have to upload the
  receipts again and link the goal again, and the household's members would
  watch the row go and return. The service's own comment states it:
  `deleteTransaction` sweeps receipt objects, backs a goal link out and
  removes household copies, none of which writing the row again could put
  back.
- **Dropping the confirm now that Undo exists.** 0017 sends the swipe
  through it.
- **An inline *Deleted · Undo* row** in the list, in the deleted row's place.
  It was the alternative; it was not built.
- **Material's duration for the notice.** The window must stand still while
  the notice is hovered or focused and run out what was left, so the service
  runs it.
- **More than one waiting delete.** Material shows one notice at a time, and
  a notice that leaves for any reason but its Undo can no longer offer it.
- **Waiting for the delete at sign-out for as long as it takes.** Offline it
  never settles, and the lock screen's only exit is sign-out.
- **Opening the error notice the moment a delete fails**, as the page did. It
  could take the next row's Undo notice down and make that delete real.
- **The snack bar's own live region.** It would read the action's label out
  with the message, and the announcer would say it a second time.
- **A fixed spoken sentence, or the message and the action joined**, for the
  announcement. A `{{action}}` slot filled with the translated `common.undo`
  holds the button's word by construction.
- **Undo for *Delete all* and account deletion.** They already ask for typed
  confirmation.

## Consequences

- A confirmed delete leaves the list, the header count and the period totals
  at once. The document, its receipt objects, its goal link, its budget and
  its household copies stay as they were for ten seconds, longer while the
  notice is held.
- Another notice opening while Undo is up makes the waiting delete real.
- A deleted row's images count against the receipt quota until the delete is
  real, since the quota is recounted as the objects go.
- A delete that fails after the reader has left the page is still named in
  the error notice wherever the reader is, unless the account that asked is no
  longer the one signed in.
- A sign-out inside the window waits for the delete, and for any delete
  confirmed while it waits, five seconds at most in all.
- Every notice, not only Undo's, opens above the phone's bottom nav, on
  iOS 15's first WebViews as everywhere else.
- When the page was wired, `pending-delete.service.ts` measured 2,670 B of
  `main`, initial because the header injects it. The build's initial-bundle
  warning stood 175 B over before these commits and 3.96 kB over after them;
  these commits do not move it.
- Two stand-ins join the shared testing helpers in
  `src/app/core/services/testing/`: `FakeNotice`, and
  `provideNoPendingDelete()` for the TestBeds that render a sign-out door and
  are not about it.
- Bisecting: at the commit `feat: a deleted transaction can be brought back
  for ten seconds` the spec program has two type errors in
  `transactions.component.spec.ts`, whose stand-in list lacks
  `deleteUndone`; the next commit, `test: the deferred delete, its single
  flush, its tombstones and its three sign-out doors`, fixes them. The app
  builds at every commit.

What holds it, besides the cases of
`src/app/core/services/pending-delete.service.spec.ts` (among them `'deletes
once when two flush triggers land together'`, `'signs out after
SIGN_OUT_WAIT_MS at most, when the delete does not settle (offline)'`,
`'makes real a delete confirmed while it waits, and waits for that one
too'` and, per catalog, `'names the Undo and the row in what a screen reader
hears'`), the page's, the list's, the notice's, the shell's and the three
doors':

- The page announcing the restore a second time:
  `Expected 2 to be 1`.
- The notice's dismiss guard removed (`called 2 times`).
- The inset dropped from the bottom-nav rule:
  `Expected 341 to be less than or equal 315`.
- `src/app/features/transactions/delete-undo.smoke.spec.ts`, under the
  emulators, deletes a row of its own (shared into a household) from its menu
  by keyboard through the real confirm, finds focus on the row now in its
  place while the document and its household copy are still stored, brings
  the row and focus back with Undo, then deletes again and flushes: the row
  and its copy are gone. Its mutations each fail where expected:
  `UNDO_WINDOW_MS = 0` gives `the row, still stored while Undo is offered:
  Expected null not to be null.`; a restore that hands no focus gives
  `Timed out waiting for: focus back on the restored row's menu button; found
  focus on the document`; a delete that drops its copy paths gives
  `its household copy, gone with it:
  Expected Object({ … description: 'Corner Bakery' … }) to be null`; a page
  that never lets a hidden row go gives `Timed out waiting for: the hidden row
  let go, once the window no longer holds it; found hidden [<id>]`.

## What the browser runs found

### Run 1, on 19 November 2026

Emulators only (Auth, Firestore and Storage), as Alex, signed in through a
session record written into the page, served from this branch's checkout;
the bundle named `demo-home-account` alone. The pane emulated 1024 × 768 and
then 375 × 812 in the dark theme, and painted about four frames a second, so
every read followed a flush and finished animations. Keys were real presses,
and the swipe was the pane's own drag. The delete and Undo steps of journey
123 are this run. The audit of the touched screens on 18 November came
before Undo and has no finding about it.

- **The desktop menu, by keyboard.** The confirm read *Are you sure you want
  to delete "e2e two images"?*. The row left at once (15 to 14), and focus,
  `:focus-visible`, was on the menu button of the row now at its index. The
  notice, 344 × 48 at y 712 of 768, was announced once as *Deleted e2e two
  images. Undo is available for a few seconds.* with Material's live region
  off; the document was still stored (200 over REST). Enter on Undo brought
  the row back at its index, the count to 15 and focus to its menu button,
  and *Restored e2e two images* was announced.
- **The phone menu, at 375 px in dark.** The row left at once (13 to 12),
  the totals went from $2,550.98 to $2,538.98, and focus was on the menu
  button of the row now at its index. The notice, 359 × 48 at y 692–740,
  stood above the bottom nav, whose top was at 748; its text read 10.15:1 and
  its Undo 5.01:1 at 64 × 40. Undo brought the row, the totals and focus
  back, and *Restored Parking garage* was announced.
- **The swipe door, at 375 px.** The pane's drag (pointer events 234 to 84)
  opened the drawer, Edit and Delete 72 × 83 and named with the row. Delete
  and the confirm took the row away with focus on the `.row-menu-btn` of the
  row now at index 0; Undo brought it back at index 0 with focus, the drawer
  closed.
- **Waited out.** The three-image row, its middle image removed first through
  the receipt manager (`receiptUrls` `[url, '', url]`, `receiptCount` 2), was
  deleted and left alone: the document read 200 at 7.7 s, 8.9 s and 10.1 s
  and 404 at 11.3 s. Storage was asked to delete `…/receipts/<id>` and
  `…/receipts/<id>_2` only, nothing for slot 1, and no object was left.
- **Left inside the window.** A row read 200 before leaving, and 404 0.6 s
  after the delete once `/dashboard` was opened; one Storage delete, the
  notice gone, no error notice.
- **Signed out inside the window**, through the header. The document read 200
  while the notice was up; after Sign Out the app was on `/login` 0.4 s later
  and the document read 404. No console error.
- After a reload, the two rows deleted for real were gone and the row brought
  back was there.

**Found:** nothing in the delete and Undo steps. The five defects the run met
were elsewhere and are recorded in 0196 and
[0194](0194-one-painted-contrast-helper-and-one-focus-hand-off-a-card-is-scored-part-by-part-and-no-page-skips-a-heading-level.md).

## Departures from the issue

- **Sign-out waits five seconds at most.** The issue asks for the delete to be
  finished before sign-out; a delete made offline cannot be, and the lock
  screen's only exit is sign-out.
- **The error notice names the row and waits for the Undo notice to go.** The
  issue asks for the row to come back with the error notice, the one the page
  showed then: *Error* (`common.error`), naming no row, opened as the delete
  failed.
- **The confirm's wording changed**, which the issue does not ask.
- **The deletion itself is announced, with its Undo named**, and the snack
  bar's own live region is off. The issue asks for the restore to be
  announced, which it is.
- **Focus after Undo also moves when it is still in the leaving notice.** The
  issue asks for it when focus had dropped; the Undo button keeps focus until
  the notice has gone.
- **The window's server count now lands with its page.** The issue names the
  count, not how it is read.

## Things that only became apparent while building

- **The spoken notice did not name Undo.** With the snack bar's live region
  off, the announcer said the message alone, and a screen reader was never
  told an Undo was there. The announcement became its own key, with the
  action in a slot.
- **One row's failure could delete the next row with no Undo.** A failure
  lands up to a window after its confirm; opened then, its notice would
  replace the next row's, and a notice leaving for any reason but its Undo
  makes its delete real. Failures are now held until no Undo notice is up.
- **The count landed ahead of its page.** Read in parallel, a count could
  already lack a row the window still showed, and taking the hidden row off
  as well counted it out twice; a filter change during the window could count
  a waiting row out of a set that never held it. The count now lands with its
  page, and a hidden row is taken off while the window holds it, or while its
  delete waits under the filters it was deleted under.
- **The Undo button keeps focus as its notice leaves**, then drops it to the
  document. Hence `from`.
- **A notice up when a failure lands is the next row's.** By the time a
  failed delete brings its row back, the row's own notice has long gone.
  The list first took focus from any notice that held it, which moved a
  reader on the next row's Undo to the failed row and let that notice's
  paused window run on. Only a notice Material has started to take down
  (`mat-exit`) gives focus up now.
- **Choosing rows on a phone hides the menu button.** The row's checkbox
  stands in its place, so a row its Undo brought back while rows were being
  chosen offered focus to nothing, and focus left on the Undo notice fell to
  the document as the notice went.
- **The page stays in use while a sign-out waits.** A row deleted during the
  wait was still waiting when the sign-out landed, met nobody signed in and
  was never deleted, though the reader never pressed its Undo.
- **iOS 15's WebView before 15.4 drops a rule that holds `:has()`.** The
  notice's lift was first keyed on the bottom nav through `:has()`, so on
  those WebViews the notice sat over the tabs; the shell's class on the body
  replaced it.
- **An offline delete settles only when the connection returns**, which
  turned a plain await at the sign-out doors into the five-second cap.
- **The confirm's last sentence became false** the moment Undo existed.
- **A smoke case slower than the window cannot fail cleanly.** With its first
  15 s waits, a failing step let the Undo window run out, and Karma
  disconnected after 30 s; every wait from the delete on now throws after
  5 s, saying what holds focus or which rows show (only the list's first
  load keeps 15 s). The case's `afterEach` makes any waiting delete
  real before it deletes the case's app, since a timer firing into a deleted
  app would fail a later case. It waits as a sign-out does
  (`flushBeforeSignOut`), five seconds at most, since a delete made with no
  connection never settles and the app must still be deleted, and the hook
  has 20 s.
- **The case could not live in `src/app/app.smoke.spec.ts`.** Its two seeded
  rows share one `Timestamp.now()`, so no row can be dated between them, and
  the walkthrough deletes its shared app at its end. The case seeds its own
  rows a minute apart and opens the list with `?showAll=true`, so no month edge
  hides one. `PeriodTotalsService` is provided by the page, not in root, so
  the case reads it through the page's injector.

## Known gaps

### The window

- **Closing the tab, or swiping the app away, inside the window can keep the
  row.** The page flushes as it is hidden, the last moment a closing tab gives
  it, but the delete then has to read the row and its copies and commit before
  the page is gone, and nothing waits for it. Before Undo the same risk lasted
  one round trip after the confirm; it now lasts up to ten seconds more.
  Closing it would need the waiting id kept where the next start can find it
  and make the delete then.
- **A page suspended or killed after its hide-time flush can half-delete
  the row.** When the flush's commit is queued but the page goes before the
  steps after it, the queued write deletes the row and its household copies
  on the next start, while the steps that follow the commit never run: the
  row's receipt objects are left with nothing naming them, and its
  category budget's stored spent stays stale until it is next recalculated.
  Keeping what those steps need where the next start can find it, and
  running them then, would close it.
- **The ten-second limit itself** (WCAG 2.2.1). The window stands still while
  the notice is hovered or focused, but nothing lets a reader lengthen it or
  turn it off beforehand. A setting for its length, or none, would close it.
- **A dialog opened during the window covers the Undo**, and the window runs
  on under it. Holding the window while a dialog is open would close it.
- **How a keyboard reaches the Undo is not checked.** The smoke case focuses
  the notice's Undo by script before it presses Enter, and the run of 19
  November records only Enter pressed on it; no case or run reaches it by
  Tab from the list. A case that moves there by keyboard alone would close
  it.

### What still counts the row

- **The insight chips and other tabs count the row until the delete is
  real.** The chips above the list are computed from the current month's
  spending, not through the page's hidden set, and another tab of the app
  sees only the store. Feeding the chips the same set would close the first
  half; the second is the deferred delete's own premise.

### The header count

- **A filter change inside the window to a filter that matches the waiting
  row**, when the row lies beyond the first page, counts it one too high
  until the delete settles and a refresh lands.
- **A reset whose page fails keeps the previous count**, where before it
  showed the new filter's count above the error banner (a missing composite
  index fails only the page).

Both last until the next refresh. A count read with the knowledge of which
waiting rows its filters hold would close them.

### Offline and sign-out

- **A goal-linked row deleted offline comes back.** Its delete commits in a
  transaction with the goal's counter, and a transaction requires the
  network, so once the window ends it fails and the row returns with the
  error notice naming it. Before Undo it failed the same way, at the
  confirm. No spec or run drives it.
- **A sign-out with an offline delete waiting** ends the session after five
  seconds with the write still queued. Nothing follows that write past the
  sign-out.
- **A session that ends by another way than the three doors** (another tab's
  sign-out, a token the SDK revokes) gives the delete no door to wait at. A
  flush deletes only for the account that asked, and on the web such an end
  reloads the page
  ([0163](0163-a-page-reloads-on-an-account-change-it-did-not-start-and-the-web-keeps-the-session-in-local-storage.md));
  whether the delete is made first is not checked. A flush on the auth
  change, before the reload, would close it.
