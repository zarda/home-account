# The session, and what may be written on its behalf

Firebase owns the session; this app owns a profile document that hangs off it.
Those are two different things with two different lifetimes, and most of what
is subtle here comes from the gap between them — a Firebase session can be
valid while the profile read fails, and a profile read can come back after the
session it belonged to has ended.

The decision behind the identity rule below is
[ADR 0052](ADR/0052-a-profile-read-may-only-write-to-the-session-that-started-it.md).

## Three signals, three different claims

`AuthService` publishes the session as signals, and they do not all mean the
same thing or change at the same time.

| Signal | Means | Written by |
|---|---|---|
| `firebaseUser` | the auth-state listener's most recent view of the session | the listener, and only the listener |
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

`setupAuthStateListener` registers one `onAuthStateChanged` callback and takes
three branches. With a user, it reads the profile document and installs it,
clearing `profileDegraded`. If that read throws, it installs a fallback
profile built from the Firebase user and raises `profileDegraded` with a
notification. With no user, it clears both. Every branch ends by settling
`isLoading`, which `waitForAuthLoading` in the route guards waits on for up to
ten seconds.

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

## The retry

`setupProfileRetryEffect` re-reads the profile when connectivity returns.
It is event-driven rather than counted: `PwaService` already probes
reachability, and a failed re-read is harmless because the session simply
stays on the fallback until the next flip.

`profileRetryInFlight` is a plain boolean rather than a signal, deliberately —
as a signal it would become a dependency of the effect that sets it.

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
full ten seconds.

## Sign-out

`signOut()` awaits `firebaseSignOut` and clears `currentUser`. It does **not**
clear `firebaseUser` or `profileDegraded` — the listener's null branch owns
those, so that one transition has one owner. This follows the convention
[ADR 0039](ADR/0039-a-share-arrives-typed-and-the-stash-answers-to-its-owner.md)
records: per-account
state is cleared from the service that owns it, on the null edge, not from
`signOut()`.

It also means tightening `signOut()` would not have been a fix. Sign-out is
not the only way a session ends — a revoked token and another tab's sign-out
both arrive through the listener — and none of them help a read that is
already in flight.

## What this does not cover

The guard protects `AuthService`'s own writes. Every other account-scoped
service is protected transitively, by being keyed on `userId()`, which no
longer takes a value from a dead session — except where a service does its own
post-await write, as `ProviderKeyService` does and checks for itself.

After a cross-session bail the retry's mutex is released with nothing left to
re-arm the effect, so a new session that degrades while the old read is still
in flight waits for the next connectivity flip. That is strictly better than
the cross-account write it replaced, and it is not free of a wait.

## When you write another write that crosses an await

Two questions.

**Does it touch `currentUser`, `profileDegraded`, or a document keyed by uid?**
Then capture the uid before the await and check `this.auth.currentUser?.uid`
against it before writing. Bail silently — no throw, no log, no notification;
the session that would have seen the message is gone.

**Does the bail leave a flag half-set?** Signals that only make sense together
have to be written together. `profileDegraded` without a fallback profile, or
a fallback profile without `profileDegraded`, is a state with no way out.
