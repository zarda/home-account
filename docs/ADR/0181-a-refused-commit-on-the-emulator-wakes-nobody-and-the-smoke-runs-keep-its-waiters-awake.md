# 181. A refused commit on the emulator wakes nobody, and the smoke runs keep its waiters awake

**Status:** Accepted, implemented · **Date:** 2026-10-17 · **Issues:** #492

Reference documentation lives in
[../emulator-blind-spots.md](../emulator-blind-spots.md),
[../testing.md](../testing.md) and [../deploy.md](../deploy.md).

This record takes #492. A household plans smoke case failed on CI about one
round in twelve with a commit refused 2 s after the one before it, and a merge
it failed on deployed nothing. The record names what held the lock, puts the
fix in the smoke lanes rather than in any case, and says what the emulator's
log can and cannot tell.

Amends
[0156](0156-a-dissolve-that-finds-its-household-already-gone-finishes-instead-of-failing.md).
Its dissolve stands. What changes is its claim that a failed run's emulator
log, "which keeps every refused operation with its time and its rules trace",
explains a rare smoke failure. The log keeps every refusal and no operation
that succeeded, so it can show that a commit waited, never what it waited
for.

## Context

`resolves a budget, a goal and a contribution each delivered twice` sends
each plan's create twice, as the transaction runner does when an answer is
lost. It failed twice in 25 runs of the zoned smoke lane on commits that hold
it, 2 of 49 zone runs:
- **The Dependabot run 37876871937, Tokyo.** It met the 2 s wait twice: the
  budget's first delivery came back `ABORTED: Transaction lock timeout`, and
  the contribution was later refused.
- **Main run 38146087687, New York.** PR #491's merge. The contribution's
  first delivery was refused on `Service call error. Function: [get]` of its
  goal, 2.03 s after the goal's resend.

Main's failure skipped both deploy jobs until the failed job was re-run a day
later.

Three things were known before any experiment:
- **The emulator's own log had more refusals than the client sent.** It
  recorded three refused writes of the goal where the client sent one
  resend, and two of the budget in the Dependabot run.
- **Nothing ran during the wait.** The second inside each wait has no new
  connection at all, against 150 to 250 a second around it.
- **Reading the jar** (`cloud-firestore-emulator-v1.22.0.jar`, `javap -c -p`)
  showed four facts:
  - The lock wait is `CloudFirestoreV1.LOCK_ACQUIRE_TIMEOUT`, two seconds,
    with no flag or property to change it.
  - A refused commit is closed before its refusal is answered, but
    `EmulatorTransactionManager.close()` neither releases the commit's locks
    nor wakes the commits queued on them.
  - Only a later lock request, which looks through every queue, does that.
  - Listener opens take no locks at all; they read a snapshot.

## Decision

### The holder, named on a GitHub runner

A soak of the zoned lane, a scratch branch never merged, ran it in rounds on
GitHub's runners, each round in a fresh emulator. The traced rounds recorded
five things:
- a thread dump and a heap dump of the emulator, fired by the client when a
  commit had been pending 300 ms;
- JFR, attached to the emulator's JVM alone by `jcmd`;
- the emulator's `/requests` feed;
- Chrome's net log;
- a trace of every Firestore call both members made.

The failing traced round (run 38868270819) shows this order:
1. The goal's resend was refused, and the client had the refusal at
   13.503.
2. **Chrome had sent that resend twice**: the net log has one restart, after
   `net_error -100` on a reused connection. The emulator ran the second copy
   at 13.5246, 28 ms after the client had its answer.
3. In the same millisecond the contribution's commit began. Its rules asked
   to read the goal, which the stale copy held.
4. The copy was refused at 13.534 and closed, waking nobody.
5. Nothing else took a lock, so at 15.546 the contribution's lookup gave up
   and the contribution was refused.

The thread dump, taken 0.3 s into the wait, has exactly one parked commit,
in `ReactiveLockManager.acquireLocks` under a rules `get()`, and no thread
inside any other commit. The lock's holder was a closed transaction.

So:
- **The holder** is a copy of a resend that Chrome made and the emulator ran
  after the client had moved on.
- **The fault** is the emulator's wake-up.

A local run of the harness had shown the same thing in a passing round, with
the goal step itself taking 2 s.

### The fix is in the smoke lanes, not in a case

`npm run smoke` and `npm run smoke:dates` run their tests through
`scripts/emulator-ticker.mjs`.
- **What it does:** it writes `_emulatorTicker/tick` as the emulator's owner
  every `EMULATOR_TICK_MS` (200 by default; 0 turns it off).
- **Why that is enough:** an owner write skips the rules but takes locks like
  any commit, and its lock request looks through every queue. A stranded
  commit waits one interval at most.
- **What it touches:** nothing a case reads. The document is alone in its
  collection.
- **What it cannot do:** fail a run. A failed tick is counted and printed,
  and the run's result is the tests'.
- **Its own check:** both scripts run its `--self-test` first, against a fake
  emulator.

### A case that fails without it

`keeps no commit waiting out the emulator lock wait behind a refused commit on
its goal` makes the race on purpose:
- **The holder:** the peer commits twenty contributions the rules admit and a
  change of the goal's currency they refuse, so the goal stays locked while
  the twenty are judged.
- **The waiter:** the owner's contribution, sent beside it, queues on the
  goal.
- **The check:** the contribution must resolve in under 1.5 s, against the
  emulator's 2 s and a commit's usual tens of milliseconds.

With the ticker off, it is refused after about 2.05 s every time. It ran red
in three runs out of three, and green with the ticker.

### The twice-delivered case pins what each delivery came to

`deliverTwice` records whether each delivery landed or was refused. The case
asserts that every create met a refusal and that no second delivery landed.
- **Why not stricter:** the case cannot assert that the first delivery
  landed. Chrome's own copy of a first delivery can land one copy and answer
  the client with the other's refusal. The service then recognises the copy
  that landed (0156's path) and never sends the second.
- **The real red:** dropping `'createdAt'` from `householdPlanUpdateValid`'s
  `hasAny` (`firestore.rules:1116`) lets the budget's and goal's second
  deliveries land.
- **What that red shows:** the case's id checks pass regardless. So the case
  now proves the service recognised a delivery that landed, not only that the
  documents exist.

### The proof

- **The reproducer carries it.** It fails every time without the ticker and
  passes with it. Both smoke lanes are green through the ticker: 874 cases,
  and 57 in each zone.
- **The soak records that nothing regressed** (run 38953562719). Each round
  ran CI's two smoke steps, the UTC lane and then the zoned one, on GitHub's
  runners.
  - **The fix:** 134 rounds, 50 of them in a row on one runner. The
    twice-delivered case never failed in its 396 runs (UTC 131, New York 133,
    Tokyo 132), and no kept emulator log has a lock timeout.
  - **The tree before it:** 96 rounds, with one failure of that signature
    (Tokyo, 2.029 s after the commit before).
- **Why the soak alone could not prove it:** even loaded, the base rate is
  about one round in a hundred: two failures in 192 control rounds over this
  run and the one before it. A proof at 5% would take about 1,600 rounds.
- **The SDK's own assertions** (`c050`, `ca9`;
  [emulator-blind-spots.md](../emulator-blind-spots.md#a-loaded-smoke-run-can-stop-one-firestore-client))
  stopped a client in 10 of 268 rounds with the ticker and 5 of 192 without
  it. That is within chance, and the ticker never touches a client's
  streams.

### The household smoke cases wait for the household they formed

The soak found a second, unrelated failure.
- **The symptom.** In one traced round, `deletes a goal holding more
  contributions than one commit takes` listed none of its thirteen
  contributions, with no lock wait and no gap.
- **What happened.** The thirteen were written, but into the household the
  previous case had formed.
- **The cause** (three investigators, a synthesis, three skeptics, all
  upheld):
  - Each account's client lives for the whole spec file, and its memory cache
    still lists the previous case's household after `forgetMemberships`
    deletes that index entry on the server. The membership itself stays live.
  - A page that has just connected first answers its index from that cache.
    `HouseholdService` falls back to the cached household (earliest joined
    live), with that household's cached members and plans.
  - `formWithPeer` waited on status, members and `plans.loading()` only, so it
    passed inside that window. The plans service, handed the household only
    while the wait polled, stayed on the earlier one.
- **The fix.** The household specs' waits name the household the case formed
  or joined: `household()?.id === householdId`, on every stack. The fix covers
  `household-plans`'s new `openOn`, `household-ledger`'s `formWithPeer`, and
  the nine waits in `household.service.smoke.spec.ts` that a read-only audit
  (a finder and a skeptic per wait) found exposed.
- **The real red.** `opens both pages on the household just formed, never on
  one an earlier formation left in the cache` takes both clients offline
  while the pages open, so only the cache can answer, then creates a goal.
  - Without the id in the wait, the goal lands in the earlier household, in
    two runs out of two.
  - With it, the goal lands in the household just formed.
- **Not reachable in production.** There an index entry is deleted only once
  its membership has ended, so a stale cached entry points at a household
  whose rules refuse the page. The page's effects also hand the plans every
  switch.

### What the log can say

The `firestore-debug-log` artifact keeps:
- the emulator's output;
- every failed operation with its rules trace;
- one line per new connection, at one-second resolution.

It keeps no operation that succeeded. firebase-tools passes
`-Dgoogle.cloud_firestore.debug_log_level=FINE`, but 1.22.0 has no such
property. `ci.yml`'s comment on the upload now says so.

### A failed `ci` job on main

[deploy.md](../deploy.md#when-the-ci-job-fails-on-main) now covers it:
- **Nothing ships:** neither deploy runs.
- **Re-run failed jobs** deploys the same commit unless a newer one changed
  what that job deploys.
- **A dispatch** with `deploy_web` (and `deploy_functions`) deploys `main`'s
  tip.

Either is a production deploy and the owner's call.

## What was rejected

- **Waiting until both members list each plan before the next create.** The
  issue proposed it if listener opens held the lock. They take no locks, and
  in the failing round every listener had answered 6 ms before the
  contribution was sent, so the wait would have been zero.
- **A retry, in CI or in the case.** It would pass a real refusal too.
- **A longer timeout.** The emulator's 2 s is compiled in, and lengthening a
  case's own bound would hide the wait rather than end it.
- **A ticker inside this case only.** The same stranding reaches every case
  that sends two commits close together, the household service's
  twice-delivered dissolve, create and accept among them.
- **An upstream report.** The owner declined one; the defect is described
  here and in emulator-blind-spots.md instead.

## Consequences

- **A smoke commit can no longer sleep 2 s behind a refused commit.** At most
  it waits one tick. A case that needs the stranding, like the reproducer,
  turns the ticker off.
- **Every smoke run sends five owner writes a second.** These writes appear
  in no rules feed and cost nothing measurable.
- **The next flake with a 2 s gap has a recipe:** count the refusals in the
  log against the client's sends, and if that does not settle it, soak with
  the traced arm, whose harness is described above and in emulator-blind-spots.md.

## Departures from the issue

- **The fix is not "wait for both members to list each plan".** The issue
  offered it only if listener opens held the lock. They take no locks, and
  the wait would have been zero.
- **The fix is in the smoke lanes, not in the case**, so the other
  twice-delivered cases are covered too.
- **"50 consecutive rounds" is one shard of 50 rounds on one runner,** beside
  84 more rounds of the fix and 96 of the tree before it. The deterministic
  reproducer is the proof that does not depend on the rate.

## Things that only became apparent while building

- **The outcome pin's first form was too strict.** It required the first
  delivery to land, and it failed in three of 134 rounds: Chrome's copy of a
  first delivery had landed while the client heard the other copy's refusal.
  That is the very duplicate behind #492, met by the service's own recovery.

- **One client's SDK never overlaps its own transactions' commits.** Commits
  from two `commitOnline` calls on one stack go out one after another. A
  reproducer that sent the holder and the waiter from one client never met
  on the server, and only the peer's client could hold the goal.
- **On idle runners the case failed one round in 120, about 0.8%,** where CI,
  which runs the lane after the unit suite and the UTC smoke, saw about 8%.
  A soak that does not load the runner measures a different rate.
- **The refused copies came from Chrome, not the SDK.** The SDK's debug log
  shows one `Commit` per delivery; the net log shows the extra POST.
- **The emulator answered `internal`, not a refusal,** for a commit of 201
  writes holding the goal. A non-refusal error leaves a transaction alive
  with its locks for up to 60 s, so the reproducer stays at twenty.

## Known gaps

- **The emulator's defect is unreported upstream** and remains in 1.22.0, the
  version the newest firebase-tools (15.34.0) still ships.
- **The soak harness is not kept.** The scratch branch that held it is
  deleted after the merge.
