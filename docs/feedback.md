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
list, and a rule cannot tell the two deletes apart. That permission now has
a door in the UI as well; see [Removing an entry](#removing-an-entry).

## The door

The About page is the kind's door (ADR 0029): the card sends, and the list
beneath it shows the user's own entries live (`watchOwn`, newest first,
capped at 20 displayed). The data hub counts the collection through the
`STORED_DATA_KINDS` entry, and account deletion erases it through the
`feedback` cascade step (between `secrets` and `securityEvents`).

Deliberately not in the backup file: feedback entries are messages already
delivered, not account data worth migrating, and restoring them would re-fire
the mail trigger and re-send every one.

## Removing an entry

Each row in the list carries a delete, behind the shared confirm dialog
(`FeedbackService.delete(id)`). The list is live, so the row leaves on its
own once the document does — no local list surgery.

**The confirm says the mailed copy is not recalled**, and that wording is
load-bearing rather than boilerplate. The operator was sent the message on
create, the trigger is `onDocumentCreated` only, and a user reaching for
delete may well be trying to unsend. What the action removes is the stored
record and nothing else. A spec asserts the confirm carries that message, so
a later edit that softens it fails.

There is no typed-token speed bump (`requireText`): the record is small and
the mail has already gone, so the bump would protect nothing.

**This needed no rules change and no deploy** — the delete permission was
always there, and only the affordance was missing
(see [ADR 0056](ADR/0056-a-permission-the-rules-grant-has-a-door-in-the-ui.md)).
Because that is a claim about the rules already in production,
`feedback.service.smoke.spec.ts` checks it against the real `firestore.rules`
under the emulator rather than against a mock.

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

### Troubleshooting, from the first deploy

Everything below was hit in sequence on the first production deploy
(2026-08-16); none of it is hypothetical.

- **The first 2nd-gen deploy trips over its own provisioning.** Expect
  "Permission denied while using the Eventarc Service Agent" — the deploy
  itself creates the service agents, and their IAM grants take a few minutes
  to propagate; wait five minutes and retry. The same first run asks for an
  Artifact Registry cleanup policy (one day is right: every deploy builds a
  fresh image, and a single retained image stays inside the free tier) and
  needs the Secret Manager API enabled, whose console link is in the 403 it
  fails with.
- **`firebase functions:log` cannot read this function's logs.** A v2
  function logs under Cloud Run; read them in the Cloud console (Functions →
  `onFeedbackCreated` → Logs). Because the trigger swallows mail failures by
  design, the inbox and that log page are the only delivery signals — a
  stored record proves nothing about the mail.
- **Secret values reach nodemailer verbatim.** A Gmail app password is 16
  characters entered without the display spaces, and one stray character in
  any value fails as DNS (`ENOTFOUND`) or auth (535 BadCredentials).
  Length-check a stored value without printing it:
  `firebase functions:secrets:access FEEDBACK_SMTP_PASS | wc -c` — 17 is
  healthy (16 plus the newline the printer appends).
- **Verify SMTP credentials locally before storing them.** A throwaway
  script in `functions/` that requires nodemailer, prompts for
  host/port/user/password, strips spaces and calls `transport.verify()`
  turns the deploy-per-guess loop into seconds per attempt; store only a
  pair that has printed its AUTH OK.
- **Set, then deploy — and decline the convenience redeploy.** The function
  reads the secret versions pinned at its last full deploy, so a new version
  does nothing until `firebase deploy --only functions` runs after it. The
  `secrets:set` prompt offering to "re-deploy the functions and destroy the
  stale version" patches only that one secret's binding: on the first deploy
  it left the service pinned to a destroyed `FEEDBACK_SMTP_USER` version and
  new revisions refused to start. The repair — and the habit — is the full
  `firebase deploy --only functions`, which re-pins every secret to its
  latest live version.
- **A self-addressed mail skips the Inbox.** With `FEEDBACK_EMAIL_TO` equal
  to `FEEDBACK_SMTP_USER`, Gmail files the delivered mail under Sent and All
  Mail; search `[home-account] feedback:` before diagnosing a delivery
  failure. Pointing `FEEDBACK_EMAIL_TO` at a different mailbox, or a Gmail
  filter on that subject prefix, puts entries in an Inbox.
- **None of this belongs to app releases.** Only a change under `functions/`
  or a rotated secret needs a functions deploy; releases ship without one.
  Always scope deploys with `--only` — a bare `firebase deploy` drags the
  functions step into every release.

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
