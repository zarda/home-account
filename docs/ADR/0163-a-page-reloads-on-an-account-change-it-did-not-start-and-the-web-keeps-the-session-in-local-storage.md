# 163. A page reloads on an account change it did not start, and the web keeps the session in local storage

**Status:** Accepted, implemented · **Date:** 2026-10-02 · **Issues:** #469

Reference documentation lives in [../auth.md](../auth.md).

Amends [0009](0009-shared-state-publishing-and-lifecycle.md): its premise
that "Firebase always passes through null on the way to a different user"
holds for a page's own sign-out and sign-in and not for another tab's, and
its contrast "sign-out is a router navigation, not a reload" now holds on the
web only for the page's own. Its null-edge resets stand, for the page's own
sign-out and for a session the SDK ends on a device. Amends
[0052](0052-a-profile-read-may-only-write-to-the-session-that-started-it.md)
twice: the listener gains one early return ahead of the guards 0052 wrote as
`if`s so that `isLoading` settles, and on the web a revoked token or another
tab's sign-out no longer arrives through the listener's null branch, because
the page reloads instead. Leaves
[0089](0089-the-auth-listener-dies-with-the-injector-that-registered-it.md)
standing: the listener still dies with the injector that registered it, and
the baseline and the latch this record adds live on the service beside it.

SDK line numbers below are in the copy the app runs, `@angular/fire`'s nested
`@firebase/auth` 1.10.8, `dist/esm2017/index-35c79a8a.js`.

## Context

Every tab of an origin shares one stored session, and the SDK in each tab
watches it. When another tab signs in, signs out or moves to another account,
`_onStorageEvent` (:2695-2716) hands that change to this tab's
`onAuthStateChanged` listener like a change of its own: straight from one
account to the next when the other tab moved that way, with no signed-out
step between.

0009 built every per-account reset on that missing step. Each root service
clears its cache when `userId()` goes null, and only then, on the premise
that a different account always arrives through null. So after a direct move
from A to B nothing reset:

- `currentUser` stayed on A until B's profile read resolved, then moved to B
  with every cache still holding A's data;
- the listeners a page holds itself never reset at all: the transactions
  page's categories (`transactions.component.ts:281`) and the filters' saved
  searches and goals (`transaction-filters.component.ts:167` and `:170`).
  Firestore refused them under B's token, three `[GlobalErrorHandler]`
  errors and the generic *Error* snackbar with them, while the list went on
  showing A's rows;
- a write names its uid when it is issued, so a form opened under A and saved
  once the profile had moved was written into B's account;
- with a second tab open, the moved tab could also end on a fallback profile
  ("[Auth] Profile retry failed…"), its read racing the other tab's sign-in.

A sign-out or a sign-in from another tab left the page standing as well. The
route guards run only on a navigation, and nothing navigates on a session
change but the header's own sign-out (`header.component.ts:155`), the guards
themselves (`auth.guard.ts:43` and `:73`) and the app lock
(`app-lock.component.ts:171`).

And the real two-tab switch mostly does not arrive as A→B. The second tab has
to sign out before `/login` will open, because `publicGuard` keeps a
signed-in session off it, and a first tab in the foreground hears that
sign-out before the next sign-in. A fix for the direct move alone would have
left the issue's own two-tab check failing.

## Decision

**Once its listener has delivered the first state, a page reloads on any
account change it did not start: another account, a sign-out from elsewhere,
or a sign-in from elsewhere. Its own sign-in, sign-out and deletion never
reload it, nor does the first state or the same account arriving again, and
it reloads at most once. A device never reloads. On the web the session is
kept in local storage, so another tab's change reaches the page on the same
channel as the refusals that change causes.**

### Three transitions

- **A→B** reloads onto the address the page was on, now as B.
- **A→null** reloads, and `authGuard` places the page on `/login`.
- **null→B** reloads, and `publicGuard` places it on the dashboard (`/`
  redirects there, `app.routes.ts:23`).

The listener's first statement asks `reloadsForForeignChange`
(`auth.service.ts:342-358`) and returns when it answers yes. It compares the
incoming uid with the last uid the listener was handed, a private
`deliveredUid` that is undefined until the first delivery, the convention the
SDK's own `lastNotifiedUid` follows. The same uid is never a change. The
listener can be handed it twice only through the registration's first emit
(:3083-3090), which reads `currentUser` a microtask late and skips the
`lastNotifiedUid` check (:3066) that keeps a token refresh away from the
listener, so it can repeat a change that landed before it.

Once it has asked, the page writes nothing more: no `firebaseUser`, no profile
read for the incoming account and no `lastLoginAt` bump aimed at it, and every
later delivery is refused the same way. The signals stay as they stood,
naming the account the page is leaving, or nobody, until it unloads.

### The page's own changes

`ownAccountChange` (`:374-381`) counts this page's SDK calls that move its
account while they are in flight, around the SDK call alone: the popup
sign-in (`:440`), the device's credential sign-in (`:459`), the sign-out
(`:533`) and the account's deletion (`:587`). A change the listener is handed
while one is out is the page's own.

That rests on an ordering in the SDK. Each of those calls hands its change to
the listeners before its own promise settles: `_updateCurrentUser` queues
`directlySetCurrentUser` and then `notifyAuthListeners` (:2861-2874),
`signOut` returns it (:2876-2889), the credential sign-ins await it, and a
deletion ends in a sign-out. So the marker is always up when the listener
asks. A sign-in or sign-out that fails never reaches the listener. A deletion
the SDK refuses because the session is no longer valid signs the session out
first and only then rejects (`_logoutIfInvalidated`, :1327-1341, reached from
`UserImpl.delete` at :1837), and that sign-out is still under the marker. The
decrement sits in a `finally`, so the marker comes down either way, and it is
a count rather than a flag, so the header's and the settings page's sign-outs
(`header.component.ts:154`, `settings.component.ts:79`) cannot lower it for
each other.

`reauthenticate` is not wrapped. It cannot move the session to another
account, since the SDK asserts the uid (:5785), and a session it finds no
longer valid is ended by the SDK: a sign-out the page did not start.

### One early return, and 0052's `if`s

0052 wrote the listener's guards as `if`s so that `isLoading` always settles,
because the route guards poll it for ten seconds before deciding anything.
The reload check is now the one early return, and it keeps that promise. A
first delivery never takes it, since there is nothing yet to compare with,
and the first delivery's own callback is the one that settles `isLoading`, on
its `if`-guarded tail, even when a change overtakes its profile read. The
unit spec pins that case: the first read still out, another account arriving,
the reload asked for once and no second read started, and `isLoading` false
once the first read lands, its answer refused by 0052's guard because the SDK
has moved on. Any later callback that returns early belongs to a page that is
already reloading.

### Why the baseline and the counter are not 0052's epoch

0052 rejected a generation counter because it would refuse a read that
resolves after a sign-out and a sign-in to the same account. Neither field
here guards a read or a write. `deliveredUid` and `ownChangesInFlight` only
classify the transition the listener is handed; the profile reads keep
0052's `stillSignedInAs`, asked of the SDK and compared by uid.

The baseline is not the `firebaseUser` signal, which specs write by hand and
which stops moving once a reload has been asked for. Nor is it `isLoading`,
which stays true across the first callback's read and which the analytics
smoke settles by hand.

### A device never reloads

`PAGE_RELOAD` is null on a device: the platform gate `WIDGET_SNAPSHOT_PLUGIN`
keeps (`widget-snapshot.plugin.ts:29-35`), the other way round. A native app
has one document and no other tabs, so the only account change it does not
start itself is the SDK ending a session, on a disabled account or a revoked
or expired token (`_logoutIfInvalidated`). A reload there would cost the one
thing the departing page still has to do: `ReminderService` cancels a
departing account's OS-booked bill reminders only when it sees `userId` leave
in the page (`reminder.service.ts:141-154`), and a reloaded page starts with
no account to cancel for. On a device that sign-out runs the null branch, as
it always has.

### Why a token

The reload is `PAGE_RELOAD`, a root `InjectionToken` whose factory
(`page-reload.ts`) takes the platform check and the location as parameters,
as `householdInviteCallableFactory` takes its injector. It is not a private
method a spec spies on, because a real reload inside Karma aborts the whole
run ("Some of your tests did a full page reload!",
`karma/static/context.js:219`), and the listener fires whenever the SDK calls
back, in three suites and in one spec's child injector, not when a spec
chooses. A provider is in place before the service that holds it is built,
it is type-checked, and a rename cannot quietly undo it the way it undoes a
spy named by a string.

### The web keeps the session in local storage

This half was decided after the first browser run of the rule. With the
reload in place and the session still in IndexedDB, `getAuth()`'s first
choice, a sign-out from the other tab reloaded the first one onto `/login` as
it should, but its departing page first logged three `[GlobalErrorHandler]`
refusals (goals, categories and saved searches, each a `'list'` refusal),
which raise the *Error* snackbar. Timestamped, they arrived about 550 ms
*before* the reload began. Firestore's multi-tab cache
(`persistentMultipleTabManager`) tells every tab of the origin that its
queries were refused through local-storage events, as it happens;
the SDK's IndexedDB persistence raises no event and is polled every 800 ms
(:8172, :8378), less often in a background tab. So the refusals reached the
page before the news that it was leaving the account. A swap between two
accounts was clean in the same run; the sign-out was not.

`appAuthFactory` (`app.config.ts:149`) therefore initialises the web's Auth
with `[browserLocalPersistence, indexedDBLocalPersistence]` and passes
`browserPopupRedirectResolver` by hand, since `initializeAuth` adds none
where `getAuth()` did. The device keeps local storage alone, as it always
has: IndexedDB under the `capacitor://` scheme leaves `onAuthStateChanged`
hanging. Another tab's change now arrives by a storage event, on Firestore's
own channel, with no poll to wait for. Measured in the same run
with the change: a sign-out from the other tab left no departing error,
twice; a swap left none; and a sign-in from elsewhere reloaded the
signed-out page.

IndexedDB stays second in the list because the SDK looks in every store it is
given for a session to carry across (`PersistenceUserManager.create`,
:2106-2177): one it finds in IndexedDB is written to local storage and its
IndexedDB key removed, both stores allowing it. So the deploy signs nobody
out. `app.config.smoke.spec.ts` shows both halves against the emulator.

## What was rejected

- **Resetting every holder on an A→B change.** Every root service and every
  page's own listeners would each need its own handling, and the next one
  would be missed by construction. A reset on a signed-in value also reopens
  the race 0009 avoided: it can land after a fresh load's first snapshot and
  blank it with nothing left to re-emit.
- **`router.navigate`.** Root singletons survive it, which is 0009's own
  observation about sign-out.
- **`location.assign('/login')`.** It loses the address for A→B and
  null→B, and the guards already place a reloaded page.
- **A BroadcastChannel announcing the page's own changes.** The SDK already
  carries every change between tabs, and a writer that does not announce
  its change, another version of the app or the e2e protocol's session
  record, would be missed.
- **`isLoading` or `firebaseUser()` as the baseline**, for the reasons above.
- **Reloading on the page's own changes too.** `LoginComponent` navigates
  once `signInWithGoogle` resolves (`login.component.ts:41`), and a first
  sign-in's language heal runs on the same path; a reload would cut both
  short.
- **Terminating Firestore before reloading.** It is asynchronous, so it
  widens the window it would be meant to close, and Firestore has already
  begun its own user switch by then: it hears the new token through the
  id-token notification, which the SDK sends before the auth-state one
  (`notifyAuthListeners`, :3059-3070).
- **Reporting nothing once the reload has been asked for**, in
  `GlobalErrorHandler`. The first browser run found every departing refusal
  arriving before the request, so this would have caught none of them. It is
  held back for any that ever arrive after it.
- **Local storage alone.** Nothing would carry the session every web user
  holds in IndexedDB today, so the deploy would sign all of them out; with
  that list the smoke's carry-over case fails, the account signed out.

## Consequences

- **A real second-tab switch reloads the first tab twice**: to `/login` on
  the other tab's sign-out, then onto B's dashboard on its sign-in. Only a
  direct A→B, such as a session record written over another, keeps the
  address.
- **The e2e protocol swaps an account by writing its session record into
  local storage.** That reloads every other page on the origin at once. The
  browser never raises a storage event in the page that wrote the change, so
  the run reloads that one itself. A first sign-in on a clean origin can
  still write the IndexedDB record and navigate, since the SDK carries it
  across. The protocol's rule to swap from `/household`, and its warning
  about three refusals on `/transactions`, are retired
  ([../e2e.md](../e2e.md)).
- **Unsaved form state is lost** on a change another tab makes, where before
  it would have been saved into the account that took over.
- **On the web, a session the SDK ends itself reloads to `/login`**: a
  disabled account, or a revoked or expired token, including one found while
  reauthenticating. Account deletion reauthenticates before it deletes
  anything, so nothing has been deleted when that happens.
- **The offline queue** reclaims a row a reload interrupted mid-sync
  (`offline-queue.service.ts:241-270`), and an upload in flight is abandoned
  with the page.
- **sessionStorage survives the reload.** The insight and summary caches kept
  there are keyed by a fingerprint of the rows they were computed from, so an
  entry made for one account cannot answer another's.
- **The SDK carries an IndexedDB session into local storage** on the first
  load of this build, and the session lives there from then on.
- **Every TestBed that builds the real `AuthService` provides a
  `PAGE_RELOAD` double**: three suites today, and a fourth must too
  ([../testing.md](../testing.md)).

## Departures from the issue

- **Widened from A→B to all three transitions**, by the user's decision. The
  issue's criterion that A→null→B triggers nothing now holds for the page's
  own sign-out and sign-in, the A→null→B a tab makes itself, which the unit
  spec pins; a sign-out from elsewhere reloads once, at the null.
- **0009's text is not rewritten.** The issue asked that 0009 no longer claim
  Firebase always passes through null, and that the index record the
  amendment. A record is written as true at the time and not maintained
  ([README.md](README.md)), so 0009's status line, an *Amended by 0163*
  paragraph and this record retire the claim, and the index row says so.
  0052 gets the same.
- **A device is exempt**, for the reminders above.
- **The browser check injects session records** rather than signing in as B
  in a tab: a pane opens no popup, and the sign-in screen would pass through
  null on the way. Both tabs sit on `/transactions`, as the issue asks
  ([../e2e.md](../e2e.md), journey 80).
- **The session moved to local storage**, which the issue did not ask for.
  Without it, the issue's own criterion of no `GlobalErrorHandler` errors
  failed on the sign-out.

## Things that only became apparent while building

- **The reload alone did not quiet the departing page.** A sign-out from the
  other tab put its refusals on the page about 550 ms ahead of IndexedDB's
  poll, and only the storage-event persistence left none.
- **The smoke suite held a sign-in from elsewhere.** The case "signing back
  in leaves no stale degraded flag behind" signed back in with a raw
  `signInAnonymously` after the service's own sign-out, which the rule reads
  as a sign-in another tab made. It now runs inside `ownAccountChange`,
  standing for the popup sign-in Karma cannot complete.
- **The SDK notifies before it resolves**, and a smoke comment on sign-out
  said the opposite, that the SDK's state was null "before the listener has
  observed anything". It is rewritten, and every reload smoke case reads its
  spy the moment the SDK call resolves, with no wait, which pins the order.
- **The unit spec's Auth double reaches `signOut` and `deleteUser`**, so the
  page's own sign-out and deletion run through the real service in Karma. Its
  popup call runs there too, inside the marker, and rejects against the
  double before any window opens; the case records that failure inside the
  change the service hands the marker, so a popup call moved out of the
  marker fails it. No tier completes a popup sign-in: the smoke stands an
  anonymous one under the same marker in for it. Only the device's credential
  sign-in stays out of reach, behind the plugin's Proxy.
- **A refused deletion signs out first.** `UserImpl.delete` sends its request
  through `_logoutIfInvalidated`, which ends an invalid session before the
  rejection, so the marker had to cover a deletion that fails, not only one
  that succeeds.
- **A storage event never reaches the page that wrote the change.** The
  smoke stands another document on the origin in for the other tab, a
  same-origin frame whose own `localStorage.removeItem` is what the other
  tab's sign-out writes, and the e2e protocol reloads the writing page
  itself.

## Known gaps

- **Nothing orders a refusal after the reload request.** Firestore hears a
  new token one notification before AuthService, and on the web the two now
  hear another tab's change on one channel. With the session in local storage
  the browser run logged no departing error on the other tab's sign-out,
  twice, or on a swap, but it timed none of those steps and no code orders
  the two; suppressing reports once a reload is asked for is held back for the
  day it does not.
- **A phone's browser polls.** On iOS and Android the SDK reads local storage
  once a second instead of listening for the event (:7371, :7384), because a
  tab in the background can miss it, so a phone's tab can still hear another
  tab's change after the refusals it causes.
- **A tab still on the previous build** watches IndexedDB, hears the carried
  session's key go at its next poll, and shows nobody signed in until it
  reloads. Until every tab runs this build, a previous-build page that loads
  afresh can carry the session back into IndexedDB, where `getAuth()` looks
  first (:11085-11097), and remove the local-storage copy, which this build's
  tabs hear as a sign-out from elsewhere and reload for; every load keeps the
  account signed in. That back-and-forth is read from the SDK, not driven.
- **A change that lands while the page's own call is in flight counts as the
  page's own**: in practice another tab's change during this page's sign-in
  popup, on `/login`.
- **An account deleted elsewhere** reaches a page only at its next token
  refresh (:1757) or user reload (:1491), when `_logoutIfInvalidated` ends the
  session.
- **On a device, a session the SDK ends leaves the page mounted** on whatever
  it was showing, as it did before this record, for the reminders' sake.
- **A future `beforeunload` prompt** that cancels the reload would leave the
  page latched, refusing every later change. No such handler exists today.
- **The device's credential sign-in wrap** (`auth.service.ts:459`) is
  unreachable in Karma, behind the plugin's Proxy, beside the call sites
  [../testing.md](../testing.md) already exempts.
