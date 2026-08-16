# 50. A spec that claims a zone runs under it

**Status:** Accepted, implemented · **Date:** 2026-08-16 · **Issues:** #280

Closes a known gap of [0032](0032-a-sweep-is-only-as-wide-as-its-greps.md).
Reference documentation lives in [../dates.md](../dates.md).

## Context

Two smoke specs said, in their own comments, that the emulator suite is run
under a shifted timezone, and gave that as the reason their assertions can be
trusted: `transaction.service.smoke.spec.ts` claimed a run under
`TZ=America/New_York`, `period-window.smoke.spec.ts` one under
`TZ=Asia/Tokyo`. CI ran `npm run smoke` once, with no `TZ`, on a runner at
UTC — the one offset at which a local bound and a UTC bound are the same
instant, so nothing those files assert about zones could fail there.

What they assert is precisely what a zone moves: rows seeded on the first and
last millisecond of a month, a date-only receipt date surviving parse →
`Timestamp` → range query, the forecast horizon closing on the last charted
day. The unit suite got exactly this treatment — `test:dates` runs under both
shifted zones, with a CI comment explaining the offset-0 blindness — and the
wiring stopped at the unit tests. [0032](0032-a-sweep-is-only-as-wide-as-its-greps.md)
recorded the gap; #276 had already named the shape: a guard that documents
itself as enforced, and is not.

## Decision

**The claim is made true rather than deleted.** A targeted alias,
`test:smoke:dates`, names the smoke specs whose assertions a zone can
actually move — `period-window`, `transaction.service`,
`recurring.service` — and `smoke:dates` runs it under `TZ=America/New_York`
and then `TZ=Asia/Tokyo` inside a single `firebase emulators:exec`, so the
emulators boot once and Karma runs twice. CI runs that as its own step beside
the unqualified smoke run, and the two spec comments now describe the
arrangement that exists.

The include list plays the same role for the emulator suite that the
`test:dates` list plays for the unit suite: it is the maintained statement of
which specs carry zone-dependent bounds. Sequential Karma runs inside one
exec share nothing — each signs in a fresh anonymous uid and deletes its own
rows, and Karma binds forward off a busy port.

### The alternatives that were rejected

**Running the whole smoke suite under each zone.** Three files carry every
zone-movable assertion; the other twenty-eight use dates as fixtures, where a
zone shifts seed and expectation together. Two more full runs would be mostly
emulator boot and spec volume for no additional signal.

**`TZ=x npm run smoke && TZ=y npm run smoke`.** Boots the emulators once per
zone for the same coverage; most of the smoke step's minute is that boot.

**Deleting the two comments.** Leaves the bounds asserted at one offset with
nobody expecting better. The comments were right about what the specs need;
the workflow was what was missing.

## Consequences

- Reverting the forecast horizon to millisecond arithmetic fails the new step
  naming the horizon spec; reverting the day-key parse to `new Date(...)`
  fails it under the negative offset with the exact July regression the
  transaction spec's comment describes. Both reverts were exercised while
  wiring the step.
- A future zone-sensitive smoke spec must be added to `test:smoke:dates` or
  it runs at one offset; dates.md says so where the list is documented.
- CI grows one step costing roughly an emulator boot plus seconds of Karma.

## Known gaps

- **The list is judgement, not detection.** Nothing flags a new smoke spec
  whose assertions a zone can move; the enumeration is maintained by the same
  reading 0032's audit greps rely on. `insight-snapshot` and `nl-search`
  build month bounds from local parts and are deliberately not listed: their
  seeds and their bounds come from the same local parts and shift together,
  so no assertion in them can fail under a zone.
