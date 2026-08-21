# Account deletion

Settings → Data Management → Danger Zone → **Delete Account** permanently
erases the signed-in account: every Firestore subcollection without exception,
the receipt objects in Storage, the device-local state keyed by the
account, the user document, and finally the Firebase Auth user. There is no backend — the
whole erasure is a client-side cascade run by `AccountDeletionService`
(`src/app/core/services/account-deletion.service.ts`), because the security
rules grant only the owner and the project deploys no Cloud Functions
(see [ADR 0018](ADR/0018-account-deletion-is-a-client-side-cascade.md)).

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
- **Device-local state while signed in.** Both stores resolve the current
  uid; after sign-out they cannot find their rows. Failures here report but
  do not block — an orphaned local record is junk on one device, not
  retained account data.
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

Both are enforcement-tested in `firestore-rules.smoke.spec.ts`, and the
whole cascade end-to-end in `account-deletion.smoke.spec.ts` (`npm run
smoke`).

## Known gaps

- The offered backup covers transactions, categories, budgets, recurring
  rules, goals, and insight snapshots — not saved searches, search
  answers, category memory, import history, or the security log. Erasure
  is complete; the export is not.
- The web reauthentication popup can be blocked by aggressive popup
  settings; the failure mode is safe (nothing deleted) and retrying from
  the same click usually passes.
- The Firestore persistent cache clear is best-effort; if it fails, the
  deleted account's rows linger in this device's IndexedDB until the
  browser evicts them, unreachable without the deleted credentials.
