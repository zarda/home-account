# 161. A deleted membership or household is swept by server triggers, as a backstop

**Status:** Accepted, implemented · **Date:** 2026-09-28 · **Issues:** #71, #465

Reference documentation lives in [../household.md](../household.md).

Narrowly revisits the rejection of *merging on the server* in
[0154](0154-the-household-view-is-a-read-only-aggregate-on-its-own-page-and-the-road-to-shared-writes-is-written-down.md):
a function now acts on a household's documents, to delete what is left of
them and never to build anything a member reads. Keeps
[0155](0155-journeys-that-need-two-accounts-run-against-the-emulators.md)'s
decision to leave the functions emulator out of `npm run smoke`. Backs the
endings of
[0158](0158-an-account-holds-up-to-ten-memberships-each-named-by-an-index-it-owns.md)
over the copies of
[0157](0157-a-transaction-is-private-until-its-owner-shares-it-and-a-household-sees-a-faithful-copy.md)
and the plans of
[0160](0160-a-households-budgets-and-goals-are-its-own-counted-from-shared-copies-and-members-contributions.md);
the client paths of
[0159](0159-a-copy-follows-its-row-in-a-commit-of-its-own-and-a-sweep-repairs-what-the-follow-ups-miss.md)
are complete without it. Rides the functions workspace of
[0047](0047-feedback-is-a-stored-record-first-and-a-mail-second.md), in the
invite callable's layout of
[0153](0153-an-invite-is-an-owners-callable-lookup-by-email-capped-and-its-answers-are-plain.md).

## Context

A household's copies and plans are written by clients, and every ending
takes them out from a client too.

- **A leave** deletes the member document, then the leaving member's app
  deletes its own copies, takes the household's key off its rows, and deletes
  its index entry last.
- **A removal** deletes the member document, then the owner's app deletes the
  removed member's copies, ten to a commit, asking the server before each
  commit whether the member is back.
- **A dissolve** deletes the invites, the other members' documents and the
  household's plans, then the household with the owner's member document,
  then the owner's own copies. Every other member's copies are left to that
  member's app, which takes them out the next time it tidies its
  memberships.

Each of those can be cut off: the page closed, the connection dropped, the
device lost. The endings are ordered so that a run cut off can be found and
finished: the membership ends before its copies are purged, and the index
entry that names it goes last (I5 in 0158), so the next run of the same
client picks it up. Two things no client run is sure to finish:

- **The removal read window.** After the owner deletes a member document,
  the removed member's copies are still of the live generation. The ledger's
  list rule asks whether the reader is a live member and whether the copy is
  of the live generation, never whether its author still is a member, so any
  live member's own query lists them until they are deleted. The page shows
  only live members' copies, and the owner's purge follows at once, so the
  window is seconds. Cut the purge off, and it stays open until the owner's
  page opens again and judges the stranger's copies, or the removed member's
  own app notices and takes them out. Firestore list rules cannot close it:
  that would take a lookup of each result's author, and a list is judged on
  its query.
- **Storage under a dissolved household.** Once the household is gone, every
  copy under it is unreadable to everyone but its author, since every member
  read asks for the live household first. What is stored stays until each
  author's app tidies, and an author who never opens the app again leaves it
  stored for good.

0154 had rejected a function merging the members' records into one
aggregate: it would read every member's rows on every change, store a second
copy of them, and lag behind the listeners the page already had. That
argument is about building what members read. A function that only deletes,
once, after a delete, meets none of it.

## Decision

**Two Firestore delete triggers sweep what a deleted member document or a
deleted household leaves in the household's collections, each held to the
deleted document's generation. They are backstops: nothing waits on them, no
write path calls them, and the app's own endings stay complete without
them.**

### What each deletes

- **`onHouseholdMemberDeleted`**, on `households/{householdId}/members/{uid}`:
  that member's copies of the generation it left, the ledger where
  `gen == since` and `memberUid == uid`, in the order of the `(gen,
  memberUid)` composite the owner's purge lists them by. Nothing else: the
  member's rows are its own, and taking the household's key off them is its
  app's job; its index entry is its own; and the household's plans, its
  contributions to them included, are the household's.
- **`onHouseholdDissolved`**, on `households/{householdId}`: everything of
  the deleted household's `createdAt` generation, in this order — the ledger,
  the budgets, each goal's contributions, the goals, and the member documents
  last (`since == createdAt`). Each member document it deletes sets off the
  member trigger, which then finds that member's copies already gone.
  Contributions are found under every goal id the collection lists
  (`listDocuments`), a goal already deleted included: a goal's delete never
  reaches its contributions, and a sweep cut off between the two leaves them
  under an id no query of goals returns.

Both write only Firestore, and neither writes anything under `users/`.

### Held to one generation

A household id can be formed again (0152), so documents of several
generations can sit under one path. Every sweep filters on the generation the
deleted document names: a member document's `since`, a household's
`createdAt`. Nothing of another generation is reached, which a recursive
delete of the household's path could not promise. The generation must be a
real Timestamp, handed to the query untouched so it compares exactly; a
deleted document without one is logged and skipped.

### Safe to run twice, or cut off anywhere

- **Every sweep lists what is left and deletes that**, a page of 500 at a
  time, one batch per page, until a page comes back short. A second delivery
  of the same event lists nothing and succeeds, and a delete of a document
  already gone is no error, so the trigger and a client purge can run over
  the same copies at once.
- **The member-back guard.** A member removed and invited back joins the same
  generation, since an invite admits to the household's `createdAt`, and its
  copies from then on are as live as anyone's. Before each page is deleted,
  the member trigger reads the member document; one holding the same
  generation again ends the sweep, and what is left stays.
- **The runaway guard.** Each page is listed after the last page's delete
  answered, so a path listed again means the deletes are not landing, and
  the sweep fails rather than loop. The member-back guard is read first: a
  returning member sharing a swept row again writes a copy at the same path,
  and that is a member back, not a failure.
- **Only what a retry can outlast is retried.** Both triggers run with
  `retry: true`. A failure whose gRPC status is CANCELLED, UNKNOWN,
  DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED, ABORTED, INTERNAL or UNAVAILABLE is
  rethrown, so the event is delivered again and the sweep resumes from what
  is left. Any other failure — a refusal, a missing index, a bad argument —
  would answer every retry alike, so it is logged with its error and the
  event let go.

### Where and how they run

The global options put every function in `asia-east1`, beside the database
as the repository records its location, with `maxInstances: 1`; neither
trigger overrides either. One instance serves requests concurrently, and two
sweeps at once each delete only what they listed. Neither binds a secret.
The deploy places each Eventarc trigger in the database's own location, read
from the live database, so its location cannot disagree with the database's
whatever the region of the function.

### What they are not

- **Not on any write path.** No client calls, awaits or observes them; a
  leave, a removal, a dissolve and an erasure finish on the client whether a
  trigger runs or not.
- **Not a merge.** They read only to find what to delete.
- **Not in the smoke suite.** 0155 left the functions emulator out of `npm
  run smoke`, and that stands: the smoke suite starts only the Auth, Storage
  and Firestore emulators. The triggers are proved by `node:test` over fakes
  and by the driven journeys, which run the functions emulator.

## What was rejected

- **A recursive delete of the household's path.** It would take a re-formed
  household's documents of another generation with it.
- **A server-side mirror of every row write**, 0159's road C: a function on
  every row write of every account, writing past the rules. 0159 records
  why the follow-up commit won; these triggers are what was grafted from
  that road, its cleanup and nothing more.
- **Leaving it to the clients alone.** An author who never returns keeps
  copies stored under a dissolved household for good, and a removal cut off
  keeps its read window open until the owner's page next hears one of those
  copies from the server, or the removed member's app notices the ending.
- **A `BulkWriter`.** It retries on its own and reports failures document
  by document; one batch per commit either lands or rejects, as one error
  the handler can classify.
- **Retrying every failure.** A permanent failure would be delivered again
  for the whole retry window, to the same answer.
- **The functions emulator in `npm run smoke`**, as 0155 decided.

## Consequences

- Two more functions in `asia-east1`, deployed with the invite callable by
  the `deploy-functions` job whenever a merge changes `functions/`. Every
  member-document delete and every household delete now runs one.
- They are the project's first Firestore delete triggers and its first
  functions with `retry: true`, but not its first Firestore triggers:
  `onFeedbackCreated` has been a 2nd-gen Firestore trigger since its first
  deploy on 2026-08-16, which provisioned the Eventarc service agents and
  hit their propagation delay ([../feedback.md](../feedback.md),
  troubleshooting). The deploy tool adds project bindings only for a trigger
  service new to the project, so it adds none for these, and an event
  trigger needs no public invoker binding, which the callable does (0153).
  Creating two functions and their Eventarc triggers still takes longer than
  the updates the job usually makes; an Eventarc permission error on the way
  has feedback.md's answer: wait a few minutes and deploy again.
- The planner, the handler and the Admin deps follow the invite callable's
  split, and their `node:test` files hold 34 cases: generation scoping, the
  order of the sweeps, paging, both guards, a second delivery, transient and
  permanent failures, the batch size and the composite's field order. Three
  more, in `household-client-mirrors.test.ts`, hold the member sweep's
  filters to the app's `ledgerByMember` shape, the household sweep's to the
  fields the app's lists lead with, and the generation fields to the ones the
  app writes. They run in CI's first gate, `npm --prefix functions test`.
- The wiring is pinned too. `household-ledger-cleanup-events.ts` maps each
  delete event to the sweep's input (`deletedMember`, `deletedHousehold`),
  and its three cases hold each mapping, a missing snapshot included, which
  the sweep skips. `index-wiring.test.ts` loads `index.ts` and reads each
  export's endpoint as the deploy reads it: the document path, the
  document-deleted event type and `retry: true`. A mapper handed the other
  trigger's event does not compile (`deletedHousehold` refuses a `uid`
  parameter), and that test holds it so. Each export's one line handing
  its mapped event to the handler runs only in the journeys.
- Journeys 74 and 75 read the triggers' work in the functions emulator, whose
  log must name both as initialized; journey 75 plants a copy no client lists
  and sees the household trigger take it.
- Each run logs a line when it has something to say: a sweep that deleted
  anything, one stopped by a returning member, one interrupted and retried,
  one failed, and one skipped for want of a generation.

## Things that only became apparent while building

- **A goal deleted before its contributions** leaves them under an id no
  query of goals finds, which is why the household sweep lists the ids that
  still have documents under them rather than the goals that exist.
- **A removed member can come back into the same generation**, and a
  retried event can arrive after it has, so the member sweep needed its
  guard, and the guard had to come before the runaway check.
- **`retry: true` answers a permanent error with a day of retries**, so the
  handler had to sort the errors, and a bare rethrow was not enough.
- **In a dissolve each member-document delete fires the member trigger**, so
  the household sweep deletes the members last, after the copies they would
  otherwise each look for.
- **A member delete's parameters hold a household delete's.** Handing the
  member trigger's event to the household mapping compiled, and would have
  read every member delete as a household's with no `createdAt`, skipping
  each one. The household mapping refuses a `uid` so the swap cannot
  compile.

## Known gaps

- **The retry window is bounded.** Firebase stops retrying a 2nd-gen event
  function after 24 hours; a permanent failure is let go at once, and nothing
  on the server sweeps again later. What a failed trigger leaves stays for the
  client paths, or for the next delete that sets a trigger off.
- **A departed member's contributions stay with their goal** (0160), by
  the user's choice: the member trigger never reaches the plans. So those of
  an account that left or was removed from a household before it erased
  itself stay until
  their goal or the household goes: an ex-member's erasure can list neither
  them nor their goals.
- **Invites are not swept.** A household's pending invites live at the top
  level, and a dissolve's own client deletes them; one it missed admits
  nobody, since the joiner's `since` must equal a live household's
  `createdAt`.
- **A household deleted by hand dissolves it.** Deleting a household document
  in the console now sweeps its generation, member documents included; each
  member's index entry is cleared by that member's app when it next tidies.
- **The region is recorded, not read back.** The repository says the
  database is in `asia-east1`, and nothing checks the live one; a database
  elsewhere would cost each delivery a cross-region hop, not a failed
  deploy.
- **The read window is short, not closed.** It is seconds after a removal,
  and normally ends with the owner's purge or the trigger's delivery. If both
  fail (the purge cut off, and the trigger let go on a permanent error, out of
  its 24 hours of retries, or not deployed yet), it stays open until the
  owner's page hears one of those copies from the server, in the period or
  the budgets' window it reads, and purges them, or until the removed
  member's own app notices the ending and takes them out. Either may never
  happen.
