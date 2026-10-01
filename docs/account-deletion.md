# Account deletion

Settings → Data Management → Danger Zone → **Delete Account** permanently
erases the signed-in account: every household membership it holds, the rows
it shared into those households, the goal contributions it recorded in those
it is still in, and the invites to and from it, every Firestore
subcollection a client may delete, the receipt objects in Storage,
the device-local state keyed by the account, the user document, and finally
the Firebase Auth user. The erasure is a client-side cascade run by
`AccountDeletionService` (`src/app/core/services/account-deletion.service.ts`),
because the security rules grant only the owner, and no server code runs a
step of it (see [ADR 0018](ADR/0018-account-deletion-is-a-client-side-cascade.md)).
Neither the feedback mail sender nor the household invite callable takes
part. The two household clean-up triggers fire on the member and household
deletes the cascade makes and sweep what those leave behind, but only as a
backstop: the cascade is complete without them
([ADR 0161](ADR/0161-a-deleted-membership-or-household-is-swept-by-server-triggers-as-a-backstop.md)).
The household step follows
[ADR 0158](ADR/0158-an-account-holds-up-to-ten-memberships-each-named-by-an-index-it-owns.md),
which lists memberships in an index the account owns, and
[ADR 0157](ADR/0157-a-transaction-is-private-until-its-owner-shares-it-and-a-household-sees-a-faithful-copy.md),
under which a household sees only the copies of the rows shared into it.

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
   unexported by accident. The offer names what the backup cannot carry:
   the stored keys, the sign-in history and the feedback sent, and neither
   which households the transactions are shared with nor anything that
   belongs to a household (its shared transactions, budgets, goals and
   contributions), so restored transactions come back private.
2. **Consequences warning** listing what will be erased, the household's
   share of it included: the memberships and the transactions shared into
   them, an owned household dissolved for every member, and the
   contributions recorded on the goals of a household the account is still
   in. It also says what stays with a household the account does not own:
   the budgets and goals it made there, and the contributions it recorded
   in a household it has left or been removed from.
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
| household | Every entry in the membership index (`users/{uid}/households`, up to ten live) — a live household the account owns is dissolved for every member, a live membership has the account's own contributions to that household's goals deleted and is then left, and what is left of an ended one is closed; each ending takes the account's copies out of that household's ledger and its key off the account's rows before the entry goes — then every invite addressed to or sent by the account, this device's household selection (`household.selected.{uid}`), and its ledger journal and sweep stamps (`ledger.journal.{uid}`, `ledger.sweep.{uid}.*`). Swept again just before the auth user | `HouseholdService.deleteAll()` |
| transactions | `users/{uid}/transactions` **and every receipt object in Storage** (swept per row), then the account's copies in every household its index still lists, ended memberships included | `TransactionService.deleteAllTransactions()`, then `LedgerShareService.purgeOwn` per household |
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
- **The household first of the cloud steps.** The other members read only
  the copies of the rows this account shared, never its own records. Every
  membership the index lists is ended, and its copies taken out, before any
  of the account's records goes, so when the household step succeeds no
  household keeps a member whose records are half erased. Each ending runs
  in one order: in a live membership of a household the account does not
  own, its contributions go first, since only a member can list them; then
  the membership ends (the member document goes, or the household with
  it), then the account's copies are purged and the key stripped from its
  rows, and the index entry goes last, since it is how a retry finds the
  household again and the rules let it go only once the membership is
  over. A household step that fails part-way leaves every
  membership it ended ended, and every entry it did not reach, or did not
  finish, in the index. Every later step still runs after a failed household
  step, so a membership it did not reach stays live while the account's
  rows are erased; the transactions step's purge (below) still takes their
  copies out, and the member document and its index entry wait for the
  retry. The index is a subcollection and outlives the user document, whose
  delete nothing about a membership holds back, so the retry starts from
  it; the auth user stays, as it does for any failed cloud step.
- **The copies purged twice.** `deleteAllTransactions` ends by taking the
  account's copies out of every household the index still lists, ended
  memberships included. After a clean household step the index is empty and
  this finds nothing; after a failed one, it takes out the copies of rows
  that no longer exist. When that purge fails, or the index cannot be read,
  the step rejects (`CopiesNotPurgedError`, carrying how many rows it
  deleted) although every row is already gone, so `transactions` is
  reported failed and the auth user stays; the retry finds no rows and
  purges again. The Data page's *Delete all transactions* runs the same
  wipe and says in that case that the rows were deleted but some households
  still show them ([household.md](household.md#sharing)).
- **The invites swept twice.** The invite callable finds an invitee through
  the auth user, which outlives every other step, so an invite can arrive
  after the household step. `deleteAll` runs again, reported under
  `household`, just before the auth user is deleted — only when no cloud step
  failed, and with every membership already ended it has only invites left
  to find.
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
- The user document: its delete is the owner's alone. A profile names no
  household — memberships are listed in the index, and the rules let a
  `householdId` left from the design of ADR 0152 (PRs #462 and #463) only be
  removed — so nothing about a membership holds the profile's delete back,
  and deleting the profile and creating it again sheds nothing: the index,
  and the member documents it is tied to, stay. An index entry may be
  deleted only once its membership is over, which is why the household step
  ends each membership before its entry goes.

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
  catch it with, and only its inviter or a dissolve of that household
  removes it: neither household clean-up trigger reads the invites.
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
- In a household the account joined and did not own, the budgets and goals
  it made (by `createdBy`) stay: they are the household's, shown and counted
  as before, and once the account is gone only the owner can delete them.
  The goal contributions it recorded (by `memberUid`, with their amount and
  date) are deleted while the membership is still live, before the
  household step leaves it: every goal of the generation, active or not,
  has its contributions listed from the server, and the account's own go
  ten a commit. A failure there stops
  the household step before that membership ends, so the retry finds the
  rest. Contributions in a household the account left, or was removed from,
  before the erasure stay: an ex-member can list neither them nor the goals
  they sit under, and the leave and remove confirmations say they stay with
  their goals, left out of the goals' totals and lists unless the member
  rejoins. They are shown and counted by nobody while
  the account is not a member, though every live member's device still
  downloads them with the goal's contributions; they go when their goal is
  deleted, and all of these go when the household is dissolved (by the
  owner's dissolve, with `onHouseholdDissolved` sweeping whatever that
  leaves)
  ([ADR 0160](ADR/0160-a-households-budgets-and-goals-are-its-own-counted-from-shared-copies-and-members-contributions.md)).
- Other members' devices can keep the account's copies in their persistent
  Firestore caches after the copies are deleted, until their household view
  next hears from the server or the cache evicts them. The server returns
  none of them once they are gone.
- The Firestore persistent cache clear is best-effort; if it fails, the
  deleted account's rows linger in this device's IndexedDB until the
  browser evicts them, unreachable without the deleted credentials.
