# 52. A profile read may only write to the session that started it

**Status:** Accepted, implemented · **Date:** 2026-08-17 · **Issues:** #264

See [0009](0009-shared-state-publishing-and-lifecycle.md) for the per-account
state lifecycle this sits underneath and
[0039](0039-a-share-arrives-typed-and-the-stash-answers-to-its-owner.md) for
the convention on where that state is cleared. Reference documentation lives
in [../auth.md](../auth.md).

## Context

A session that launches with a failed profile read runs on an in-memory
fallback profile until connectivity returns, when a retry effect re-reads the
document. The completion handler wrote the result unconditionally:

```ts
.then(user => {
  this.currentUser.set(user);
  this.profileDegraded.set(false);
})
```

Nothing re-checked that the session it started for still existed. Sign out
while that read is in flight and the answer lands afterwards — and with the
persistent local cache it does not even fail, because a cached profile
document resolves perfectly well without a token. The profile went back into
`currentUser`, and everything downstream believed it: `isAuthenticated` is
`!!currentUser()`, so the shell rendered the departed user's name and
`publicGuard` refused to let them reach `/login`, while every Firestore call
was denied by the rules. The same write cleared `profileDegraded`, and with
`firebaseUser` now null the retry could never fire again, so the session
stayed wedged in that state until the page was reloaded.

It is the hole underneath [0009](0009-shared-state-publishing-and-lifecycle.md).
Every account-scoped service clears its cache when `userId()` goes null; here
the retry re-publishes a non-null `userId()` *after* they all did, so the app
holds a signed-in identity over emptied caches. `ShareIntakeService` shows the
second-order shape: it watches `userId()` and navigates to the import wizard
whenever someone signs in, and a ghost write is indistinguishable from a
sign-in to that effect.

The codebase already treats this hazard as real one file away.
`ProviderKeyService` captures the account before its Firestore round trip and
re-checks before every write, under a comment about not letting a session
switch cross accounts. The service that owns the identity those checks are
written against had no equivalent.

## Decision

**Every write that crosses an await names the session it started in, and
abandons silently if that session is gone.** One predicate,
`stillSignedInAs(uid)`, applied at five sites: the retry effect's start and
its `.then`, the listener's success and failure branches, and the profile
create.

**The reference point is the SDK, not the signals** — `this.auth.currentUser?.uid`.
This is the part worth writing down, because mirroring `ProviderKeyService`
literally would have been wrong twice. `firebaseUser()` is written from the
auth-state listener, so in the window this exists to catch it still names the
user who has just left and would agree with exactly the case being refused;
`firebaseSignOut` clears `auth.currentUser` before its own promise resolves,
so the SDK is the only thing that knows in time. And `userId()` is worse still:
it derives from `currentUser`, which is null while a fresh session is loading
its first profile, so a guard keyed on it would abandon every legitimate
sign-in and no profile would ever be installed. `ProviderKeyService` compares
`userId()` correctly because it is a consumer of the identity; the owner
cannot.

**Compared by uid rather than object identity**, because a token refresh hands
the listener a fresh `FirebaseUser` for the same person, and that is the
session continuing.

**On a bail, `profileDegraded` is left exactly as it stands.** Clearing it for
a session that has ended hands the next sign-in to that account a not-degraded
flag over a fallback profile, and `firebaseUser === null` is an absorbing
state for the retry effect, so nothing would raise it again. The invariant
stated positively: `profileDegraded: true` is only ever written together with
a fallback profile for the live session.

**The listener's guards are `if`s, not early returns**, so `isLoading` still
settles — the route guards poll it for ten seconds before deciding anything.
Its failure branch is guarded too, and writes nothing at all on a bail: a
fallback profile there is the same ghost, and the `auth.profileLoadDegraded`
toast would tell someone who has just signed out that their profile could not
be loaded.

**The profile create is guarded as well**, which is not about signals.
`AccountDeletionService` removes `users/{uid}` and only then deletes the
Firebase user, so a retry landing between the two finds nothing and would
recreate the profile being erased — while the signal guards above quietly
suppressed the visible symptom. Without this the fix would trade a visible
ghost session for an invisible orphan document surviving account deletion,
which is the worse of the two.

### The alternatives that were rejected

**Clearing `firebaseUser` and `profileDegraded` in `signOut()`.** Legitimate
in itself — `AuthService` is the owning service, so
[0039](0039-a-share-arrives-typed-and-the-stash-answers-to-its-owner.md)'s
convention is not breached — but insufficient as the fix. Sign-out is not the
only way a session ends; a revoked token and another tab's sign-out arrive
only through the listener's null branch, and none of them help a read already
in flight. It would also give one transition two owners.

**A generation counter or session epoch.** The same guard with more state, and
strictly worse: it would reject a read that resolves after signing out and
back in as the *same* account, which is a legitimate write to the same
document and is what keeps that case recovering without a reload.

**Cancelling the read.** `getDoc` has no cancellation. The write is what can
be refused, not the read.

**Making `profileRetryInFlight` a signal** so the effect could re-evaluate.
Already rejected where it is declared: as a signal it becomes a dependency of
the effect that sets it.

**Nulling `currentUser` when the profile read fails.** The original behaviour,
rejected before this: it bounced a valid Firebase session to the login page
with no message and no retry. That rejection stands; this record narrows *who*
may be written, not whether the degraded session survives.

## Consequences

- A profile read that outlives its session is discarded. The user lands on
  `/login` and stays there.
- A degraded session that reconnects with no sign-out still recovers, and
  signing out mid-retry then back in to the same account produces a normal,
  non-degraded session with no reload.
- The listener's failure branch no longer raises a toast for a session that
  has ended.
- The gate on the retry's *start* also spares a round trip the rules would
  deny and a `lastLoginAt` bump aimed at an account nobody is signed into.

## Things that only became apparent while building

- The window this was thought to hinge on does not exist. `signOut()` clears
  only `currentUser`, so it looked as though the effect could still start
  afterwards on a stale `firebaseUser` — but `firebaseSignOut` nulls
  `auth.currentUser` and runs the listener's synchronous null branch before
  its promise resolves, so by then the effect can no longer arm. The defect is
  simply the retry's `.then` landing after the listener's null branch.
- That is also why the emulator-backed spec reconstructs the stale signal
  rather than racing for it, and why the exact interleavings live in the unit
  spec, where a deferred read gives an exact hold point.
- The retry's *success* path had no coverage anywhere. The existing degraded
  smoke block terminates its Firestore, so its retry can only ever reach
  `.catch` — the one branch this guard does not sit on.

## Known gaps

- After a cross-session bail the `profileRetryInFlight` mutex is released with
  nothing left to re-arm the effect, so a new session that degrades while the
  old read is still in flight waits for the next connectivity flip.
- The guard covers `AuthService`'s own writes. Other account-scoped services
  are protected transitively by being keyed on `userId()`, not by checks of
  their own — except `ProviderKeyService`, which has its own.
- The read is not cancelled, only its answer refused; a doomed round trip
  still completes when it was already in flight.
