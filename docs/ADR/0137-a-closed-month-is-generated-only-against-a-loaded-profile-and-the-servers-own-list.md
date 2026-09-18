# 137. A closed month is generated only against a loaded profile and the server's own list

**Status:** Accepted, implemented · **Date:** 2026-09-17 · **Issues:** #426

Reference documentation lives in [../insights.md](../insights.md) and
[../one-shot-reads.md](../one-shot-reads.md).

## Context

`generateClosedMonths` used to gate on exactly two things: a signed-in
`userId` and `pwa.isOnline()`. Neither one asks whether the profile behind
that uid is real.

A boot whose profile read fails does not sign the session out — it installs
an in-memory fallback profile and lowers `isLoading` so the app can still be
used, and raises `profileDegraded` while the retry effect works in the
background to swap the real profile in (see [docs/auth.md](../auth.md)). The
route guard sees a loaded, authenticated session and admits `/dashboard`.
`ngOnInit` fires generation immediately, before the retry has had a chance to
run, and every read under `users/{uid}/insightSnapshots` is refused by the
rules until the real profile lands. That gate was worth closing, and this
record does — but it was not the whole story, and simulator evidence showed
it directly: with the gate in place, a cold start on an already-loaded
profile still logged the same denial.

The actual cause was in what "missing" meant. `generateClosedMonths` decided
which closed months to write by reading `firstValueFrom(this.watch())` — the
service's own listener, once. Under the persistent local cache that listener
resolves cache-first: its first emission on a device that has not opened
Reports in a while is whatever this session last cached, which can lag
behind a month another device has already written. A lagging emission reads
as "this month doesn't exist yet," `buildAndWrite` reissues it at
`revision: 1`, and the rules refuse it outright — an `insightSnapshots`
update must carry a strictly higher `revision` than what is already stored
(`firestore.rules`, the collection's own match block). A fresh install hits
this on its very first generation: the cache holds nothing, every closed
month looks missing, and the account's already-written months turn the
write into a flat `permission-denied`. This is exactly the class of mistake
[docs/one-shot-reads.md](../one-shot-reads.md) exists to name — a
correctness-bearing read taken from a listener's first emission rather than
enumerated fresh.

## Decision

**Two independent fixes, because the two causes are independent.**

### The loading and degraded gate

`generateClosedMonths` now also returns early while `authService.isLoading()`
or `authService.profileDegraded()` is true. A session still loading, or
running on the fallback profile, cannot read its own snapshots yet — nothing
it wrote would survive contact with the rules — so generation defers rather
than failing loudly and being retried by nothing. This mirrors a precedent
already in the codebase: the home-screen widget's own publish effect already
gated on `authService.isLoading()` before this branch existed, for the same
reason — a cold start with no user yet must not be read as "the account has
nothing," only as "not yet."

A degraded session that recovers while the dashboard is still open is not
re-triggered by this gate on its own; the next section explains why that is
an acceptable trade rather than a second bug.

### The missing-month check reads the server, not the cache

`generateClosedMonths` now asks `FirestoreService.getCollectionFromServer`
for the account's stored month keys before deciding what to write, instead
of taking that answer from `watch()`'s listener. A month either has a
document on the server or it does not, and that answer decides a write that
cannot be undone by a later correction — the same standard every other
entry in [docs/one-shot-reads.md](../one-shot-reads.md) already holds
correctness-bearing reads to. It costs one query for the whole generation
run, the same shape as the recurring-rules read already sitting beside it.
Offline, the read simply rejects into the method's existing catch — no new
loss, since the connectivity gate already keeps generation from running
offline at all, and a connection dropping mid-run just defers the whole
backfill to the next online open.

The listener itself is untouched and still does real work: the Insights tab
opens its own subscription to render the stored list and correct it live as
snapshots change, and it never persists anything from what it reads. Only
the write path — deciding what does not yet exist — moved off it.

## What was rejected

- **Trusting the listener's first emission after a short delay or a retry
  count.** Nothing bounds how far a device's cache can lag another device's
  writes, so no fixed wait is safe; the only answer that is actually correct
  is the server's own list.
- **Re-triggering generation the moment a degraded session recovers.** That
  would need the dashboard to observe the retry effect resolving while it is
  open, which nothing currently does; deferring to the next open was judged
  an acceptable cost against the complexity of wiring a new observer for a
  case that self-heals on its own.

## Consequences

- `insight-snapshot.service.ts`: `generateClosedMonths` reads
  `authService.isLoading()` and `authService.profileDegraded()` before
  anything else, and `writeMissingMonths` takes its existing-months set as a
  parameter computed from a server read instead of computing it internally
  from `snapshotState()`. `insight-snapshot.service.spec.ts` grew to cover
  both: the two new gate branches, and the missing-month decision now being
  asked of the server double rather than the cache double.
- `docs/one-shot-reads.md` gained its own section and table row for this
  read, cited rather than duplicated here.
- No `firestore.rules` change — the revision guard that refused the bad
  write was already correct; this decision stops the client from producing
  a write that guard was always going to refuse.

## Departures from the issues

None. Tracker #426's second part asked for generation to stop failing on a
cold start, and both causes behind that failure are closed.

## Things that only became apparent while building

- **The first fix looked complete and was not.** The loading/degraded gate
  is real and worth keeping — a session on the fallback profile has no
  business writing anything — but a simulator run with that gate already in
  place still reproduced the denial on an account whose profile had
  finished loading normally, which is what pointed at the listener's first
  emission as the actual source rather than a boot-timing race.
- **A browser and a simulator told two different stories from the same
  account**, because they did not share the same local cache: the browser,
  with no stale entries for these months, generated nothing and logged
  nothing, while the simulator's cache reproduced the failure on demand —
  the clearest evidence available that the defect lived in what the cache
  had seen, not in the account's actual data.

## Known gaps

- **A degraded session that recovers while the dashboard is open still
  defers to the next open.** The retry effect swapping in the real profile
  does not itself re-trigger generation; nothing currently observes it doing
  so.
- **One more round trip per open.** The server read this decision adds runs
  every time generation is attempted, even on an account with nothing left
  to backfill.
