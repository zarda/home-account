# Account deletion

Settings → Data Management → Danger Zone → **Delete Account** permanently
erases the signed-in account: its household membership and the invites to
and from it, every Firestore subcollection a client may delete, the receipt
objects in Storage, the device-local state keyed by the account, the user
document, and finally the Firebase Auth user. There is no backend — the
erasure is a client-side cascade run by `AccountDeletionService`
(`src/app/core/services/account-deletion.service.ts`), because the security
rules grant only the owner, and neither the feedback mail sender nor the
household invite callable runs a step of it
(see [ADR 0018](ADR/0018-account-deletion-is-a-client-side-cascade.md)).
The household step is
[ADR 0152](ADR/0152-a-household-is-a-membership-and-a-member-reads-the-others-records-without-owning-them.md)'s.

One Firestore document is outside the cascade's reach:
`users/{uid}/quota/receiptImages`, which the rules let no client write. The
storage-triggered receipt-quota recount erases it instead, when a receipt
object's delete reaches it after the user document is gone
([receipt-quota.md](receipt-quota.md)). Nothing guarantees that one does
(see *Known gaps*).

## The flow, from the user's side

1. **Backup offer.** Confirm runs the full JSON backup export; only the
   explicit "Continue without backup" button skips it. Dismissing the dialog
   aborts, and cancelling the save picker aborts — data is never deleted
   unexported by accident.
2. **Consequences warning** listing what will be erased.
3. **Typed confirmation.** The literal token `DELETE` must be typed; the
   token is not localized (it is a speed bump, not copy).
4. **Reauthentication.** Firebase demands a recent login before an account
   can delete itself, so the cascade re-runs the Google sign-in — a popup on
   the web, the native plugin flow on iOS — *before* anything is touched.
   A closed popup, a blocked popup, or signing in as a different Google
   account aborts with nothing deleted.
5. On success the app clears the persistent Firestore cache best-effort and
   hard-reloads to the login page. On a partial failure it names the failed
   steps and stays signed in so the run can be retried; every sweep is
   idempotent.

## What is deleted, and by what

| Step | Data | Owning method |
|------|------|---------------|
| appLock | Device PIN record + attempt state | `AppLockService.clearCredential()` |
| offlineQueue | Queued receipt images + sync log (IndexedDB) | `OfflineQueueService.clearAll()` |
| shareStash | Files shared into the app, still awaiting import (IndexedDB on web, the App Group container on iOS) | `ShareIntakeService.clearAll()` |
| reminders | The log of which reminders this device has already raised (`localStorage`) | `clearReminderDeviceState(uid)` |
| weeklyRecap | The recap week this device dismissed, and the narrative cached for it (`localStorage`) | `clearWeeklyRecapDeviceState(uid)` |
| household | The household membership — an owner's household is dissolved, a member leaves, a pointer left by an ended one is cleared — and every invite addressed to or sent by the account, swept again just before the auth user | `HouseholdService.deleteAll()` |
| transactions | `users/{uid}/transactions` **and every receipt object in Storage** (swept per row) | `TransactionService.deleteAllTransactions()` |
| categories | `users/{uid}/categories` | `CategoryService.deleteAll()` |
| budgets | `users/{uid}/budgets` | `BudgetService.deleteAll()` |
| recurring | `users/{uid}/recurring` | `RecurringService.deleteAll()` |
| goals | `users/{uid}/goals` | `GoalService.deleteAll()` |
| savedSearches | `users/{uid}/savedSearches` | `SearchHistoryService.deleteAll()` |
| searchAnswers | `users/{uid}/searchAnswers` | `SearchAnswerHistoryService.deleteAll()` |
| categoryMemory | `users/{uid}/categoryMemory` | `CategoryMemoryService.deleteAll()` |
| tagMemory | `users/{uid}/tagMemory` | `TagMemoryService.deleteAll()` |
| imports | `users/{uid}/imports` | `ImportHistoryService.clearImportHistory()` |
| insightSnapshots | `users/{uid}/insightSnapshots` | `InsightSnapshotService.deleteAll()` |
| secrets | `users/{uid}/secrets/providers` (AI keys) | `ProviderKeyService.deleteAll()` |
| feedback | `users/{uid}/feedback` (sent feedback) | `FeedbackService.deleteAll()` |
| securityEvents | `users/{uid}/securityEvents` (sign-in log) | `SecurityLogService.deleteAll(uid)` |
| userDoc | The `users/{uid}` document itself | `FirestoreService.deleteDocument` |
| authUser | The Firebase Auth account and session | `AuthService.deleteFirebaseUser()` |

Storage receipts are reachable only through the transactions that carry them
(`StorageService` has no list operation by design), which is why the
transaction sweep owns the Storage cleanup.

## Ordering, and why it is this order

- **Reauthentication first.** Discovering a stale session after the data is
  gone would strand a dead but undeletable account.
- **Device-local state while signed in.** Every one of those steps resolves
  the current uid; after sign-out they cannot find their rows. Failures here
  report but do not block — an orphaned local record is junk on one device,
  not retained account data. The two `localStorage` steps go through pure
  exported helpers rather than their services: injecting `ReminderService` or
  `WeeklyRecapService` would drag their sweep effects, the notifications
  plugin and the budget and recurring graphs into an erasure whose whole job
  there is removing one key.
- **The household first of the cloud steps.** While a membership is live,
  the other members still read this account's transactions, categories,
  budgets and goals, so it ends before anything else is erased. The rules
  refuse the user document's delete while its `householdId` names a live
  membership, so a household step that fails before its leave or dissolve
  commits keeps the profile, the pointer and the auth user for the retry. One
  that fails after that commit, while sweeping invites, leaves the membership
  already ended and does not hold the profile back.
- **The invites swept twice.** The invite callable finds an invitee through
  the auth user, which outlives every other step, so an invite can arrive
  after the household step. `deleteAll` runs again, reported under
  `household`, just before the auth user is deleted — only when no cloud step
  failed, and with the profile gone it has only invites left to find.
- **`securityEvents` last of the subcollections.** While earlier steps can
  still fail, the sign-in log is the record worth keeping.
- **The user document after every subcollection**, since deleting it does
  not delete them.
- **The auth user only after a fully clean cloud run.** Deleting it earlier
  signs the session out and strands whatever remains behind owner-only
  rules. Until this step succeeds the account still exists and can retry.

## Partial failure

`deleteAccount()` returns a `DeletionReport { ok, failed[] }` rather than
throwing: every step runs even after one fails, failures are collected with
their step names, and the settings page surfaces them. Because each sweep
enumerates the live collection, re-running the flow finishes whatever a
broken run left behind.

## Rules changes that made this possible

- `securityEvents`: updates stay forbidden; **deletes by the owner are now
  allowed**. A rule cannot tell "delete my account" apart from "delete one
  event", and a credential thief could already delete the whole account.
- `secrets`: the combined `write` grant validated `request.resource`, which
  a delete never carries, so deletes were silently denied. Split into
  `create, update` (validated) and `delete` (owner).
- The user document: beside the owner check, its delete requires the
  membership its `householdId` names to be gone — the same condition a change
  of the pointer takes — so deleting the profile and creating it again cannot
  shed a live membership. A profile that is already gone may still be
  deleted, so a retried run succeeds.

All three are enforcement-tested in `firestore-rules.smoke.spec.ts`, and the
whole cascade end-to-end in `account-deletion.smoke.spec.ts` (`npm run
smoke`).

## Known gaps

- The offered backup covers eleven of the fourteen stored kinds the cascade
  erases. The three it cannot carry are the stored provider keys, the
  feedback already sent, and the sign-in history — each excluded for a
  reason the deletion dialog states, and each read from the same list a
  spec checks against the cascade
  ([ADR 0143](ADR/0143-the-backup-carries-what-erasure-takes-except-what-it-must-not.md),
  [backup-restore.md](backup-restore.md)). Erasure is still more complete
  than the export, by decision now rather than by omission.
- The web reauthentication popup can be blocked by aggressive popup
  settings; the failure mode is safe (nothing deleted) and retrying from
  the same click usually passes.
- An invite written to the account after the second invite sweep and before
  the auth user is deleted stays behind: the cascade has nothing left to
  catch it with, and only its inviter, a dissolve of that household, or a
  server-side clean-up removes it.
- The receipt quota document, `users/{uid}/quota/receiptImages`, is erased
  only by a recount that runs after the user document is gone, so it stays
  behind, under a user document that no longer exists, in two cases: the
  account deleted its last receipt before it was erased, so the erasure
  deletes no object and triggers no recount; or every recount lands before
  the user document step — they run in the function's own time — and the
  last writes a count of zero.
- The invite callable's counter document for the account,
  `inviteQuotas/{uid}` — two counts and the times their windows opened — is
  not erased: no client may read or delete it, and it holds nothing but those
  four fields ([household.md](household.md)).
- The Firestore persistent cache clear is best-effort; if it fails, the
  deleted account's rows linger in this device's IndexedDB until the
  browser evicts them, unreachable without the deleted credentials.
