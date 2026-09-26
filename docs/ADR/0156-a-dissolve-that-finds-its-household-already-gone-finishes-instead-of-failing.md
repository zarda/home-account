# 156. A dissolve that finds its household already gone finishes instead of failing

**Status:** Accepted, implemented · **Date:** 2026-09-26 · **Issues:** #71

Reference documentation lives in [../household.md](../household.md).

Extends [0152](0152-a-household-is-a-membership-and-a-member-reads-the-others-records-without-owning-them.md),
whose dissolve ends in one commit that deletes the household with the
owner's member document and clears the owner's pointer.

## Context

PR #462 merged as `c0115fb3`, and the pipeline on `main` failed in the smoke
step, so neither deploy ran: hosting, the rules and the invite callable all
stayed as they were. One spec failed, *dissolves without leaving a
household, member or invite document behind*, and it had passed on the
pull request's own run over the same tree. The emulator refused the
dissolve's final commit, and its reason was `Null value error. for 'delete'`
on the household's delete rule: `resource` was null. The household was
already gone when that commit was judged.

Nothing in the spec or anywhere else deletes that household, and the case
calls `dissolve()` once. What fits every line of the log is the same final
commit arriving twice, the first delivery landing and the second judged
against what the first left. Two roads lead there:

- **The SDK sends it again.** The Firestore client runs a transaction by
  committing blind writes, and its transaction runner starts over after
  `aborted`, `failed-precondition`, `already-exists` or any code it does not
  treat as permanent — `unavailable`, `deadline-exceeded`, `internal`,
  `unknown`. A commit that lands and whose answer is lost comes back as one
  of those, and is sent again. That is how a user on a poor connection meets
  it. In the failed run it was not the SDK: the SDK logs every failed RPC,
  and the log has one failure for that commit, the refusal. The resend came
  from below it, the browser or the emulator.
- **Another dissolve got there first.** Two tabs of one owner, or a second
  press before the first answer: one dissolve removes the household, and
  the other, at whatever step it has reached, meets a household that is
  gone.

Every other write a dissolve makes already survives a second delivery. The
owner's invites are deleted one by one when a batch is refused
(`deleteInvites`); a member document deletes again under the owner's
removal or the "household is gone" clause; a pointer already cleared is not
touched. The final commit was the one that failed. Its failure also dropped
the flag that keeps the owner's own listener from reading its member
document's deletion as a loss, so a page could say *You're no longer in that
household* about the household it had just dissolved.

## Decision

**When a step of a dissolve is refused and the household reads as gone, the
dissolve clears what is left of the owner's membership and stands.**

- The service holds its "ending this membership" flag across the whole
  dissolve, from the first invite delete to the last commit, and drops it
  only when the dissolve fails. `leave`, `clearStalePointer` and erasure's
  own ending of a membership hold it the same way (`endingMembership`).
- A refusal at any step is answered with one read of the household, made
  inside a transaction that is abandoned before it commits
  (`householdGone`). A plain get will not do: the page dissolving holds a
  listener on the household, and a get is answered from what that
  listener last heard, which after a refused commit can still be the
  household the commit found gone. A transaction's read always goes to the
  server and is judged by the rules as they stand.
- A household the owner can still read means the refusal stands, and the
  dissolve fails as before. A household the read is refused for is gone —
  the get rule refuses one that is gone rather than answering it empty —
  so the dissolve commits the owner's member document delete and the
  pointer clear, which the rules allow once the household is gone
  (`!existsAfter(household)` on the member, `formerMembershipGone` on the
  pointer), and resolves.
- A read that goes unanswered proves nothing gone, so the refusal stands.
  A failure that is not a refusal — the connection dropping mid-dissolve —
  is never taken for a dissolve already done.

Erasure inherits it: `deleteAll` dissolves through the same path.

## What was rejected

- **Letting the rules delete a household that is not there.** Allowing
  `delete` when `resource == null`, as the profile's own delete does for a
  retried erasure, would make the final commit pass a second time. It would
  also answer "allowed" for a missing household and "refused" for someone
  else's live one to anyone who names an id, which the household's `get`
  rule is written not to do.
- **Retrying the spec.** The spec reported an ordering the product can
  meet. The first sighting, before #462 merged, kept no message, and was
  answered with a console filter (`testing/firestore-transport-noise.ts`).
  The spec fails on the rejected dissolve itself, not on a console line, so
  a filter over console errors could not reach it, and the failure came
  back on `main`.
- **A guard against a second press.** The page already disables every
  household action while one is pending. The service cannot see two tabs or
  the SDK's resend, and the answer has to hold for those.

## Consequences

- Two smoke cases reproduce the failure without luck:
  `household.service.smoke.spec.ts` delivers **every** commit of a dissolve
  twice (each lands, then goes again) and dissolves twice at once. Both
  fail with CI's exact refusal before this change and pass after it; the
  household smoke files ran five times in a row, 370 of 370 each.
- The unit spec names the paths: the final commit refused with the
  household gone while a plain get would still answer it live (and the
  listener hearing the deletion meanwhile), the members read refused, the
  household still live, the household read unanswered, and a dissolve cut
  off by the connection. The smoke cases cannot choose the order in which
  a listener hears the deletion and a refused commit's answer arrives;
  the unit case is what pins the server read.
- A failed run now uploads the Firestore emulator's log, which keeps every
  refused operation with its time and its rules trace. This failure was
  diagnosed from the pipeline's console alone.
- The owner can meet one more case in production: a dissolve answered as
  done although this page's last commit was refused. The household, the
  owner's member document and pointer are gone either way; the other
  members' documents were deleted before the final commit, or by the
  dissolve that got there first.

## Known gaps

The same second delivery reaches two other household writes, which still
report failure after they succeeded. Neither changed here:

- **`create()`.** Its commit reads nothing, so a second delivery meets the
  household and the owner's member document it created and is judged as an
  update: a fresh `createdAt`, `since` and `joinedAt` break the update
  rules, and `create()` answers with the generic error while the page
  shows the household it made.
- **`accept()`.** Sent again after its first delivery consumed the invite,
  its transaction reads the invite again, is refused, and says the invite
  is gone although the account has joined.

Both leave the data as intended; each answers with an error the next
listener event contradicts.
