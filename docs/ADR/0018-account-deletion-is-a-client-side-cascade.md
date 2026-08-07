# 18. Account deletion is a client-side cascade

**Status:** Accepted, implemented · **Date:** 2026-08-07 · **Issues:** #73

Reference documentation lives in [../account-deletion.md](../account-deletion.md).

## Context

There was no way to delete an account — an App Store Guideline 5.1.1(v)
requirement and a GDPR right-to-erasure gap. The data spans a dozen
`users/{uid}` subcollections, receipt objects in Storage addressable only
through their transactions, device-local stores keyed by uid, and the
Firebase Auth user itself. Deleting a Firestore document does not delete its
subcollections, so every one must be emptied explicitly.

The project deploys no Cloud Functions, and the security rules grant reads
and writes to the owner alone. Two rules actively blocked erasure: the
sign-in log was append-only (`update, delete: if false`), and the provider
key document's combined `write` grant validated `request.resource`, which a
delete never carries — so key deletes were silently denied and nothing had
ever noticed.

## Decision

**The cascade runs on the client, as the signed-in owner.** One service
(`AccountDeletionService`) reauthenticates first, clears device-local state
while the uid still resolves, empties every subcollection best-effort with
failures collected rather than thrown, deletes the user document, and
deletes the auth user only after a fully clean cloud run — deleting it
earlier would sign the session out and strand the remainder behind
owner-only rules. Rejected: building Cloud Functions infrastructure for a
server-side purge (a whole deployment surface for one operation, in a
project that has none), and leaving the blocked collections orphaned
(erasure that retains the sign-in log is not erasure).

**The sign-in log becomes erasable, never rewritable.** `update` stays
forbidden; `delete` is granted to the owner. A rule cannot distinguish
"delete my account" from "delete one event", and the deterrent the old rule
bought was already void against an attacker holding the credentials — they
could delete the whole account. What the log still guarantees is that no
entry can be *changed*.

**The secrets rule splits into `create, update` + `delete`.** The
validation stays on the writes that carry `request.resource`; deletes get
their own owner grant. This was a discovered defect, not a relaxation — the
old rule denied deletes by accident of shape.

**Every sweep enumerates the collection, never the in-memory signal.** The
signal only holds what a subscription happened to deliver; on a fresh
session that is nothing. `CategoryMemoryService.clear()` had exactly this
bug — the emulator smoke test caught it deleting zero rows — and the
cascade now uses a collection-enumerating `deleteAll()` there like
everywhere else.

## Things that only became apparent while building

- Reauthentication has to be a separate, first step: Firebase rejects
  `deleteUser` without a recent login, and learning that mid-cascade would
  leave a half-erased account whose owner has lost nothing but patience.
- An emptied account is unreadable once the auth user is gone, so the smoke
  test asserts the emptied state while the session lives and exercises the
  real `deleteUser` afterwards.
- The native session has the same asymmetry `signOut()` has: `deleteUser`
  removes the web SDK account, and the Capacitor plugin session must be
  signed out separately.

## Known gaps

- The pre-deletion backup export covers six sections, not every
  subcollection — recorded in the reference doc. Extending the backup
  schema further was kept out of scope here.
- The reauthentication popup is subject to popup blockers on the web; the
  failure mode is safe (abort before any deletion).
- No automated coverage for the two interactive reauthentication flows
  (Google popup, native plugin); anonymous emulator users cannot run them.
