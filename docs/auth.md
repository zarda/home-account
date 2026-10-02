# The session, and what may be written on its behalf

Firebase owns the session; this app owns a profile document that hangs off it.
Those are two different things with two different lifetimes, and most of what
is subtle here comes from the gap between them — a Firebase session can be
valid while the profile read fails, and a profile read can come back after the
session it belonged to has ended.

The decision behind the identity rule below is
[ADR 0052](ADR/0052-a-profile-read-may-only-write-to-the-session-that-started-it.md).
The one behind reloading a page on an account change it did not start, and
behind where the web keeps the session, is
[ADR 0163](ADR/0163-a-page-reloads-on-an-account-change-it-did-not-start-and-the-web-keeps-the-session-in-local-storage.md).

## Three signals, three different claims

`AuthService` publishes the session as signals, and they do not all mean the
same thing or change at the same time.

| Signal | Means | Written by |
|---|---|---|
| `firebaseUser` | the session the auth-state listener last installed; once the page has asked to reload, it stops moving | the listener, and only the listener |
| `currentUser` | the profile the app is running on — stored, or an in-memory fallback | the listener, the retry effect, and the profile writers |
| `profileDegraded` | that profile is the fallback, not the stored document | the listener and the retry effect |

`isAuthenticated` is `!!currentUser()`, and it is what the guards read.
`userId` comes from the same place, and it is what every account-scoped
service keys its caches on. Both are therefore downstream of `currentUser`
rather than of the Firebase session — which is exactly why writing the wrong
thing into `currentUser` is not a cosmetic bug.

**None of these is the live session.** The SDK's own `auth.currentUser` is,
and it leads all three: it is nulled before `firebaseSignOut` resolves and
before the listener is notified. That ordering is the whole basis of the
identity rule below.

## The listener

`setupAuthStateListener` registers one `onAuthStateChanged` callback. It
first asks whether it has been handed an account change this page did not
start ([below](#an-account-change-this-page-did-not-start)); if so, the page
reloads and the callback returns having written nothing. Otherwise it takes
three branches. With a user, it reads the profile document and installs it,
clearing `profileDegraded`. If that read throws, it installs a fallback
profile built from the Firebase user and raises `profileDegraded` with a
notification. With no user, it clears both. Every branch it runs ends by
settling `isLoading`, which `waitForAuthLoading` in the route guards waits on
for up to ten seconds. The one early return never strands the flag: a first
delivery never takes it, and the first delivery's own callback is the one
that settles `isLoading`, even when a change overtakes its profile read. The
listener is released when the injector that registered it is destroyed, as
[ADR 0089](ADR/0089-the-auth-listener-dies-with-the-injector-that-registered-it.md) records.

## An account change this page did not start

Every tab of an origin shares one stored session. When another tab signs in,
signs out or moves to another account, the SDK hands that change to this
page's listener like a change of its own, straight from one account to the
next when the other tab moved that way. Nothing on the page would follow it:
the per-account services reset only on the signed-out edge
([ADR 0009](ADR/0009-shared-state-publishing-and-lifecycle.md)), the
listeners a page holds itself never reset at all, and the guards only run on
a navigation. So **once the listener has delivered its first state, a page
reloads on any account change it did not start**:

| Change | Where the reloaded page lands |
|---|---|
| another account (A→B) | the address it was on, as B |
| a sign-out from elsewhere (A→null) | `/login`, through `authGuard` |
| a sign-in from elsewhere (null→B) | the dashboard, through `publicGuard` |

A real switch in another tab usually reloads this one twice, because the
other tab signs out before its sign-in screen will open: to `/login` at the
sign-out, then onto B's dashboard at the sign-in.

**What never reloads:** the page's own sign-in (the popup on the web, the
plugin's credential on a device), its own sign-out and its own account
deletion; the first state the listener is handed; and the same uid arriving
again, which only the registration's first emit can do, repeating a change
that landed before it.

**The baseline is private.** `reloadsForForeignChange` compares the incoming
uid with `deliveredUid`, the last uid the listener was handed, undefined until
the first delivery. Not with the `firebaseUser` signal, which specs write by
hand and which stops moving once a reload has been asked for, and not with
`isLoading`, which stays true across the first callback's read.

**The page's own changes are marked.** `ownAccountChange` counts the page's
SDK calls that move its account while they are in flight, around the SDK call
alone: `signInWithPopup`, `signInWithCredential`, `firebaseSignOut` and
`deleteUser`. Each of them hands its change to the listener before its own
promise settles, so the marker is up when the listener asks; one that fails
never reaches the listener, and a deletion the SDK refuses because the
session is no longer valid signs out first, still under the marker. A count
rather than a flag, so two sign-outs in flight cannot lower it for each
other. `reauthenticate` is not marked: it cannot move the session to another
account, and a session the SDK finds no longer valid there is ended by the
SDK, which reloads the page to `/login` before anything has been deleted. A
new SDK call that signs in, signs out or deletes the account goes through
`ownAccountChange`, or the page will reload on its own change.

**Once, and nothing after.** The page asks to reload at most once. From then
on every delivery is refused: no `firebaseUser` write, no profile read for the
incoming account, no `lastLoginAt` bump aimed at it. The signals stay as
they stood, naming the account the page is leaving, or nobody, until it
unloads.

**Never on a device.** `PAGE_RELOAD` (`core/services/page-reload.ts`) is null
there. A native app has no other tabs, so its only change from elsewhere is
the SDK ending a session, on a disabled account or a revoked or expired
token, and that runs the null branch as before, so `ReminderService` still
sees the account leave and cancels its OS-booked reminders.

**Specs provide the reload.** A real reload aborts a whole Karma run, so every
TestBed that builds the real `AuthService` provides a `PAGE_RELOAD` double
([testing.md](testing.md#a-real-reload-aborts-the-whole-run)).

### Where the web keeps the session

`appAuthFactory` (`app.config.ts`) keeps the web's session in local storage,
with IndexedDB second: `[browserLocalPersistence, indexedDBLocalPersistence]`,
and the popup resolver passed by hand, since `initializeAuth` adds none. The
order is about timing. Another tab's change reaches this one by a storage
event, the channel Firestore's multi-tab cache uses to report the refusals
that change causes, so the page hears it is leaving the account ahead of
them. IndexedDB raises no event and is polled every 800 ms, and with the
session there a sign-out from another tab put three `[GlobalErrorHandler]`
refusals, and the *Error* snackbar, on the departing page about 550 ms before
its reload; with local storage first the same sign-out logged none. IndexedDB
stays in the list because the SDK carries a session it finds there into local
storage and removes the IndexedDB key, so the first load of this build keeps
whoever was signed in. The device keeps local storage alone, as it always
has.

The browser check is [e2e.md](e2e.md)'s journey 80: two tabs of one origin
on `/transactions`, another tab's swap, sign-out and sign-in, and nothing
reported on the way out.

## The degraded profile

**A failed profile read is not "not signed in."** Nulling the user on a read
failure bounced a valid Firebase session to the login page with no message and
no retry, so the listener keeps the session and runs on an in-memory profile
instead: the same shape a new account would get, built from the Firebase user,
and **never written to Firestore**. The create path only ever runs after a
successful read reported the document absent, so a transient failure cannot
overwrite a real profile with defaults.

`profileDegraded` says the session is in that state, and `auth.profileLoadDegraded`
is the string the user sees.

Two readers wait on this rather than pressing ahead against the fallback.
The home-screen widget's publish effect gates on `isLoading` so a cold start
with no user yet never overwrites a signed-in account's last figures with a
signed-out state. Closed-month snapshot generation
([docs/insights.md](insights.md)) gates on both `isLoading` and
`profileDegraded`: a boot running on the fallback profile cannot read its
own snapshots, so it defers rather than writing something the rules will
only refuse — see
[ADR 0137](ADR/0137-a-closed-month-is-generated-only-against-a-loaded-profile-and-the-servers-own-list.md).

## The retry

`setupProfileRetryEffect` re-reads the profile when connectivity returns.
It is event-driven rather than counted: `PwaService` already probes
reachability, and a failed re-read is harmless because the session simply
stays on the fallback until the next flip.

`profileRetryInFlight` is a plain boolean rather than a signal, deliberately —
as a signal it would become a dependency of the effect that sets it.

`retryArm` beside it is the opposite choice for the opposite reason: a counter
the effect reads at the top, precisely so that bumping it re-runs the effect.
Exactly one event bumps it — a read whose answer was abandoned because the
session that started it had been replaced. Nothing else covers that case: the
in-flight flag is held for as long as the old read is out, so the effect
returns early for the new session, and dropping the flag re-runs nothing by
itself.

**A read that failed never bumps it.** Whatever refused it is usually still
refusing on the next pass, so re-arming on a failure would loop the effect
against something that is not going away. Waiting for the next connectivity
flip at least waits for something to change.

Both halves are pinned by unit fixtures rather than by the emulator suite:
holding a read open across a session swap is not expressible against a real
Firestore read without a timer, so the spec substitutes a promise it resolves
by hand and decides the ordering itself.

## The identity rule

> **A read may only write to the session that started it.**

Both the listener and the retry effect await a Firestore read and then write
signals. The session can end, or move to another account, while that read is
in flight — and with the persistent local cache it does not even fail: a
cached profile document resolves perfectly well after a sign-out. Writing that
answer back left the app holding a signed-in identity with no Firebase session
behind it: the shell rendered the departed user's name, `publicGuard` refused
to let them reach `/login`, and every Firestore call was denied by the rules.
The same write cleared `profileDegraded`, and with `firebaseUser` null the
retry could never fire again, so the session stayed wedged until reload.

So every write across an await names the session it started in, and abandons
silently if that session is gone. Two details are load-bearing:

**Ask the SDK, not the signals.** `this.auth.currentUser?.uid` — never
`firebaseUser()` or `userId()`. The signal is written from the listener, so in
the window that matters it still names the user who has just left and would
agree with exactly the case being refused. And `userId()` is worse: it derives
from `currentUser`, which is null while a fresh session is still loading its
first profile, so a guard keyed on it would abandon every legitimate sign-in.
This is where the rule differs from `ProviderKeyService`, which compares
`userId()` because it is a *consumer* of the identity rather than its owner.

**Compare uids, not objects.** A token refresh hands over a fresh
`FirebaseUser` for the same person; that is the session continuing, not a
switch away from it.

On a bail, `profileDegraded` is left exactly as it stands. Clearing it on
behalf of a session that has ended would hand the next sign-in to that account
a not-degraded flag over a fallback profile — and `firebaseUser === null` is
an absorbing state for the retry effect, so nothing would ever raise it again.
Stated positively: **`profileDegraded: true` is only ever written together
with a fallback profile for the live session.**

## The guarded sites

| Site | Compared against | On a bail |
|---|---|---|
| retry effect, before starting | the uid the signal named | no read is issued |
| retry effect, in `.then` | the uid the read started for | nothing written; degraded left alone |
| listener, after a successful read | the uid that callback was handed | nothing written; `isLoading` still settles |
| listener, after a failed read | the uid that callback was handed | nothing written, and **no toast** |
| `getOrCreateUser`, before `setDoc` | the uid being created | the profile is returned but not stored |

The last one is not about signals. Account deletion removes `users/{uid}` and
only then deletes the Firebase user, so a retry landing between the two finds
nothing and would recreate the profile that was being erased — and the signal
guards above would then hide it. An orphan document surviving account deletion
is worse than the ghost session they catch, because nothing on screen says it
happened.

The listener's two guards are written as `if`s rather than early returns on
purpose: `isLoading` must still settle, or the route guards poll for their
full ten seconds. The callback's one early return comes before either of
them, for an account change the page did not start, and a first delivery
never takes it ([above](#an-account-change-this-page-did-not-start)).

## Sign-out

`signOut()` awaits `firebaseSignOut`, inside the own-change marker so the
page does not reload for it, and clears `currentUser`. It does **not**
clear `firebaseUser` or `profileDegraded` — the listener's null branch owns
those, so that one transition has one owner. This follows the convention
[ADR 0039](ADR/0039-a-share-arrives-typed-and-the-stash-answers-to-its-owner.md)
records: per-account
state is cleared from the service that owns it, on the null edge, not from
`signOut()`.

It also means tightening `signOut()` would not have been a fix. Sign-out is
not the only way a session ends — a revoked token and another tab's sign-out
both arrive through the listener — and none of them help a read that is
already in flight. On the web neither runs the null branch any more: each is
an account change the page did not start, and the page reloads instead. On a
device a revoked token still runs it.

## What this does not cover

The guard protects `AuthService`'s own writes. Every other account-scoped
service is protected transitively, by being keyed on `userId()`, which no
longer takes a value from a dead session — except where a service does its own
post-await write, as `ProviderKeyService` does and checks for itself.

A cross-session bail is the case that now re-arms: the abandoned read bumps
the counter on its way out, so a session that degraded while its predecessor's
read was still in flight gets its own read straight away. What is left
uncovered is the plain failure. A retry whose read rejects arms nothing and
waits for the next connectivity flip — the deliberate price of not looping
against a failure that has not changed, and still a wait.

The reload on an account change the page did not start leaves these open
([ADR 0163](ADR/0163-a-page-reloads-on-an-account-change-it-did-not-start-and-the-web-keeps-the-session-in-local-storage.md)):

- **Nothing orders a departing page's refusals after its reload.** Firestore
  hears a new token one notification before `AuthService`; the browser run
  logged no departing error once the session moved to local storage, but no
  code guarantees the order.
- **A phone's browser polls.** On iOS and Android the SDK reads local storage
  once a second instead of listening for the event, so a phone's tab can
  still hear another tab's change after the refusals it causes.
- **A tab still on the previous build** watches IndexedDB, hears the carried
  session's key go, and shows nobody signed in until it reloads.
- **A change that lands during the page's own sign-in, sign-out or deletion**
  counts as the page's own.
- **An account deleted elsewhere** reaches a page only at its next token
  refresh, when the SDK ends the session.
- **On a device, a session the SDK ends leaves the page mounted**, as it
  always has, for the reminders' sake.
- **A `beforeunload` prompt** that cancelled the reload would leave the page
  refusing every later change. None exists today.

## When you write another write that crosses an await

Two questions.

**Does it touch `currentUser`, `profileDegraded`, or a document keyed by uid?**
Then capture the uid before the await and check `this.auth.currentUser?.uid`
against it before writing. Bail silently — no throw, no log, no notification;
the session that would have seen the message is gone.

**Does the bail leave a flag half-set?** Signals that only make sense together
have to be written together. `profileDegraded` without a fallback profile, or
a fallback profile without `profileDegraded`, is a state with no way out.
