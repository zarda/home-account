# In-app feedback

Users send feedback to the developer from the About page: a category
(bug / idea / other) and a message. Each submission is a Firestore record
first and a mail second — the record is the source of truth, the mail is a
derivative delivery. The decision record is
[ADR 0047](ADR/0047-feedback-is-a-stored-record-first-and-a-mail-second.md);
the issue is #302.

## The stored record

`users/{uid}/feedback`, written through `FeedbackService.add()`
(`src/app/core/services/feedback.service.ts`). Each entry carries exactly:

| Field | Value |
|---|---|
| `userId` | the owner, pinned by rules |
| `category` | `bug` \| `idea` \| `other` |
| `message` | trimmed, 1–2000 characters |
| `appVersion` | `package.json` version at submit time (what About shows) |
| `platform` | `Capacitor.getPlatform()`: `web` \| `ios` \| `android` |
| `locale` | the UI locale at submit time |
| `createdAt` / `updatedAt` | the `FirestoreService.addDocument` stamps |

The closed field set is enforced by `firestore.rules` (`feedbackCreateValid`),
so the record can never smuggle anything more — deliberately nothing the
client did not already know about itself. The account email the operator
replies to is resolved server-side at mail time and is never stored.

**Entries are immutable once written** (`allow update: if false`), for the
`securityEvents` reason plus one of their own: the operator is mailed a copy
on create, and a rewrite would make the stored record diverge from the mail
already sent. Owner delete stays allowed — account deletion has to empty the
list, and a rule cannot tell the two deletes apart.

## The door

The About page is the kind's door (ADR 0029): the card sends, and the list
beneath it shows the user's own entries live (`watchOwn`, newest first,
capped at 20 displayed). The data hub counts the collection through the
`STORED_DATA_KINDS` entry, and account deletion erases it through the
`feedback` cascade step (between `secrets` and `securityEvents`).

Deliberately not in the backup file: feedback entries are messages already
delivered, not account data worth migrating, and restoring them would re-fire
the mail trigger and re-send every one.

## The mail pipeline

The repo's first server-side code, a single Cloud Functions v2 trigger in
`functions/`:

```
client write → users/{uid}/feedback → onDocumentCreated (asia-east1)
  → compose-feedback-email.ts (pure)  → mailer.ts (nodemailer/SMTP) → inbox
```

- `functions/src/compose-feedback-email.ts` — what the mail says. No imports,
  no I/O, unit-tested. Inputs are typed `unknown` on purpose: an entry
  written before the rules deploy turned validation on can be shaped
  arbitrarily, and the mail renders something useful rather than throwing.
  The message renders verbatim as plain text (never HTML), the subject is
  sanitised to a single line, and the feedback id in the subject makes an
  at-least-once duplicate recognisable.
- `functions/src/mailer.ts` — how it is sent; the only file importing
  nodemailer.
- `functions/src/index.ts` — wiring only: resolves the submitter's account
  email from Auth (best-effort; a deleted or anonymous user renders as
  "unknown"), composes, sends. `maxInstances: 1` bounds cost.

**The app's contract ends at the Firestore write.** Nothing client-side
calls, waits on, or observes this function; a mail failure loses nothing —
the entry stays readable in the console. That is also why the trigger logs
failures and never rethrows: a rethrow would only hammer a broken SMTP
config with retries while the record it exists to deliver is already safe.

Abuse posture: only a signed-in user can write, only into their own
subcollection, closed field set, 2000-character cap, recipient pinned in a
secret, plain-text mail. The residual gap is volume from one hostile
account; the proportionate guards, if ever needed, are a per-user rate limit
and then digest batching — a model-based content filter was rejected in
ADR 0047.

## Operator runbook

One-time setup, in order:

1. Upgrade the `home-accounter` project to the Blaze plan (console →
   Settings → Usage and billing) — required for Cloud Functions and Secret
   Manager.
2. Store the five secrets (Gmail wants an app password, not the account
   password):

   ```
   firebase functions:secrets:set FEEDBACK_SMTP_HOST
   firebase functions:secrets:set FEEDBACK_SMTP_PORT
   firebase functions:secrets:set FEEDBACK_SMTP_USER
   firebase functions:secrets:set FEEDBACK_SMTP_PASS
   firebase functions:secrets:set FEEDBACK_EMAIL_TO
   ```

3. Deploy rules and functions together, with or before the app release:

   ```
   firebase deploy --only firestore:rules,functions
   ```

   Until the rules deploy, feedback creates **succeed unvalidated and
   rewritable** through the live catch-all — the deploy is what turns on
   validation and immutability, and the emulator cannot reveal that it has
   not happened (see [emulator-blind-spots.md](emulator-blind-spots.md)).
   If the deploy complains about the functions SDK version, update
   `firebase-tools` first.

4. Send one production feedback entry and confirm the mail arrives; check
   Functions → Logs for delivery failures.

Where to read feedback: the mail inbox, or Firestore console →
`users/{uid}/feedback` (a collection-group query on `feedback` lists every
user's entries).

## Testing, and the known gap

- `npm --prefix functions test` — the compose seam, via `node --test` (runs
  in CI ahead of the Angular pipeline).
- `npm run smoke` — the rules cases (create/immutability/carve-out) and the
  deletion sweep. The smoke suite runs `--only auth,storage,firestore`, so
  the functions emulator never starts and no trigger fires there.
- **Known gap:** no emulator-based end-to-end functions test in CI — secrets
  plumbing for a mail sink is not worth it at this scale. The manual local
  recipe: put the five values in `functions/.secret.local` (gitignored),
  point them at an [Ethereal](https://ethereal.email) test account, build
  the workspace, then `firebase emulators:start --only auth,firestore,functions`
  and write a feedback doc; the mail lands in the Ethereal mailbox.
