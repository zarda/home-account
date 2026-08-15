# 47. Feedback is a stored record first and a mail second

**Status:** Accepted, implemented · **Date:** 2026-08-15 · **Issues:** #302

Reference documentation lives in [../feedback.md](../feedback.md).

## Context

The app had no way for a user to tell the developer anything short of
finding the repository, and the requirement was two-sided: submissions must
be kept, and they must reach the operator's inbox without the operator
polling a console. Everything stored here is `users/{uid}/…` behind
owner-only rules, and until now the repo had no server-side code at all —
`account-deletion.service.ts` states the stance plainly: "There is no
backend to fall back on."

Mail cannot be sent honestly from a client. A `mailto:` link leaves the app,
requires a configured mail client, and queues nothing offline; client-held
SMTP or API credentials would hand every user the operator's sending
identity. So the second requirement forces the first server-side code, and
the decision is about where the boundary sits.

## Decision

**The record is the source of truth; the mail is a derivative.** The client
writes a validated, immutable record to `users/{uid}/feedback` — closed
field set, category enum, 2000-character cap, `update: if false` — and its
involvement ends at that write. A single Cloud Functions v2 trigger
(`onDocumentCreated`, the repo's first backend code) composes a plain-text
mail from the record and sends it over SMTP, with the five settings
(host/port/user/pass/recipient) in Firebase secrets. Entries are immutable
for the `securityEvents` reason plus one of their own: a rewrite would make
the stored record diverge from the mail already sent.

What the mail says is a pure module (`compose-feedback-email.ts`, no
imports, unit-tested); how it is sent is a seam (`mailer.ts`, the only
nodemailer import) — the 0025/0043 shape applied to a new transport. The
trigger logs failures and never rethrows: the record is already safe, and a
retry would only hammer a broken SMTP config. The submitter's account email
is resolved from Auth at mail time and never stored in the record.

Rejected:

- **`mailto:` from the client** — leaves the app, depends on a configured
  mail client, no offline queue, no stored record.
- **The Trigger Email extension** — it sends from a client-writable outbox
  collection, which widens the write surface (rules would have to pin the
  recipient in a second place), splits the truth between the record and the
  outbox doc, and leaves the compose step nowhere a unit test can pin.
- **Retry-on-failure** — the write already preserved the feedback; a rare
  duplicate mail (at-least-once delivery, id in the subject) is cheaper
  than a retry queue.
- **Model-based content moderation** — the writers are authenticated
  account holders, the recipient is pinned server-side, the body renders as
  plain text, and the reader is one person. A classifier would add a
  server-side LLM key and per-message cost to defend a mailbox, and a false
  positive silently discards real feedback. If volume abuse ever appears,
  the proportionate guards are deterministic and in this order: a per-user
  rate limit, then digest batching.

## Consequences

- The repo now has a deployable server-side unit: `functions/` with its own
  lockfile, compiled and tested in CI ahead of the Angular pipeline, and a
  deploy step (`firebase deploy --only firestore:rules,functions`) in the
  operator runbook. The client bundle is untouched by it.
- The stored kind plugs into every registry a kind must: the deletion
  cascade (`feedback` between `secrets` and `securityEvents`), the data
  hub catalogue, the rules carve-out, and the About page as its door
  (0029). It is deliberately absent from the backup file: restoring
  delivered messages would re-fire the trigger and re-send every one.
- `maxInstances: 1` and the trigger's region (`asia-east1`, beside the
  Firestore location) bound cost and latency.

## Things that only became apparent while building

- The deployed-rules window inverts the usual failure: until the new rules
  deploy, feedback creates do not fail — they **succeed unvalidated and
  rewritable** through the users/{uid} catch-all, and the emulator cannot
  show it. The compose module types its inputs `unknown` and renders
  defensively for exactly the documents that window can produce.
- `node --test <directory>` discovered nothing and reported the directory
  itself as one passing test; the test script globs `lib/*.test.js`
  explicitly so only test files ever execute (the trigger's module-level
  `initializeApp()` must not run under the test runner).

## Known gaps

- No emulator-based end-to-end functions test in CI; the compose seam is
  unit-tested and the manual Ethereal recipe lives in the reference doc.
- Volume abuse is accepted at this scale; the escalation ladder is recorded
  above and in the issue.
