# 56. A permission the rules grant has a door in the UI

**Status:** Accepted, implemented · **Date:** 2026-08-17 · **Issues:** #306

Applies to the kind described in
[0047](0047-feedback-is-a-stored-record-first-and-a-mail-second.md), and
narrows the door rule in
[0029](0029-every-stored-kind-has-one-door.md) from "the kind has a door" to
"each permission on it does". Reference documentation lives in
[../feedback.md](../feedback.md).

## Context

`firestore.rules` has permitted an owner delete on `users/{uid}/feedback` since
the feature shipped:

```
      match /feedback/{feedbackId} {
        allow read: if isOwner(userId);
        allow create: if isOwner(userId) && feedbackCreateValid(userId);
        allow update: if false;
        allow delete: if isOwner(userId);
      }
```

The comment beside it explains why delete stays open: account deletion has to
empty the list, and a rule cannot tell that cascade apart from a one-off
delete. So the permission was granted for the cascade's sake and never
exposed to the person it belongs to.

The About page lists the user's own entries and the list only ever grew.
`FeedbackService` had `add()`, `watchOwn()` and the cascade-only
`deleteAll()` — nothing per-entry. The only cleanup available to a user was
deleting their entire account; the only other route was the operator removing
rows in the Firestore console. Six throwaway entries from the first
mail-delivery verification sat in the developer's own list as the live example.

This is a quiet failure mode. Nothing is broken, no error appears, and the
rules read as though the capability exists — which is precisely why it can sit
unnoticed. It is the mirror of [0038](0038-a-dead-guard-reads-exactly-like-a-live-one.md):
there a guard read as enforced and was not, here a permission reads as
available and is not reachable.

## Decision

**A permission the rules grant to the user is either reachable from the UI, or
the rule is closed.** A granted permission with no affordance is a gap, not a
neutral state, and the rules file is not a place to record intentions.

Where a permission exists only to serve machinery rather than the user — as
this one existed for the deletion cascade — that is worth writing down beside
the rule, but it does not settle the question. Here the same permission is
plainly useful to the person whose data it is, so it gets a door.

**The copy carries what the action does not do.** Deleting removes the stored
record; the operator was mailed a copy on create and it is not recalled. A
user reaching for delete may well be trying to unsend, so the confirm says so
rather than letting them infer it.

### The alternatives that were rejected

**Closing the delete rule instead.** Consistent, and the wrong direction: the
account-deletion cascade needs it, and taking away a capability the user has a
legitimate use for to resolve an inconsistency is a worse answer than
providing it.

**A "clear all feedback" control instead of per-row.** Cheaper, and it matches
`deleteAll()` which already exists. But the case that prompted this is a
handful of specific entries someone wants gone, and clear-all cannot express
that.

**A `requireText` token on the confirm.** The shared dialog offers one for
irreversible actions. Rejected here: the record is small and the mail has
already gone, so the bump would slow the user without protecting anything.

**Trusting the unit specs for the rules claim.** The fix's premise is that this
ships against the rules already in production. That is a statement about
deployed rules, and a mocked `FirestoreService` cannot evaluate it — hence a
smoke test against the real `firestore.rules`.

## Consequences

- Each row in the About list offers a delete; confirming removes the entry and
  the live `watchOwn` subscription takes the row away.
- The confirm states the sent mail is not recalled, and a spec fails if that
  message is dropped.
- `firestore.rules` and `functions/` are untouched, and nothing is deployed.
- `FeedbackService` now has both `delete(id)` and `deleteAll()`. They differ on
  a signed-out call on purpose: `deleteAll` resolves to zero, because for the
  cascade nothing to do is a normal outcome, while `delete` rejects, because a
  signed-out user action is a bug.
- The smoke suite gains a case that reads the rules rather than a mock, which
  also pins that update stays refused and that a second account cannot delete
  or plant an entry here.

## Things that only became apparent while building

- The rule's own comment was the evidence. It explains why delete is open, in
  terms of the cascade, and never asks whether the user should be able to reach
  it — the reasoning stopped at the machinery that needed the permission.
- Checking the neighbours was worth more than checking the delete. The delete
  working was never in real doubt; that opening it had not loosened update, or
  let another account write here, is what the smoke test is actually for.

## Known gaps

- No sweep exists for other permissions in the rules with no UI path. This was
  found by reading one file; the same class could sit elsewhere.
- A deleted entry is gone from the user's list and still in the operator's
  mailbox. That asymmetry is inherent to mailing a copy on create, and the copy
  says so rather than resolving it.
