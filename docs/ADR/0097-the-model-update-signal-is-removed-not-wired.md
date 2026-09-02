# 97. The model-update signal is removed, not wired

**Status:** Accepted, implemented · **Date:** 2026-09-02 · **Issues:** #19

## Context

`PwaService.handleServiceWorkerMessage` carried a `CHECK_MODEL_UPDATES` branch
that re-dispatched a `check-model-updates` window event, with a comment
promising it "will be handled by model-loader service". There is no such
service and there is no listener: the event was dispatched into an empty room.

The other half of the pair sat in `src/service-worker.ts` — a `periodicsync`
handler for the tag `update-models`, which posted that message to every
client. That file is a three-hundred-line worker
[ADR 0019](0019-share-intake-lands-through-a-stash.md) records as dead: it is
never registered, and the only worker the app does register is the minimal
share target, which handles one POST and passes every other fetch through.

So the signal had no producer that runs and no consumer that listens. #19
asked which of the two to build.

## Decision

**Remove both ends.** The `CHECK_MODEL_UPDATES` case in `PwaService` and the
`periodicsync` handler and its `updateModels` helper in `service-worker.ts`
are deleted. [ADR 0048](0048-a-dead-capability-is-removed-not-guarded.md) is
the standing rule and this is the same shape: a path that is neither wired up
nor deleted is half-present, and half-present is the bug — it reads like a
working feature to anyone who greps for it, and it is the kind of thing a
future change wires into rather than questions.

The thing the signal was for is not built and is not scheduled. The on-device
model tier #23 proposes is an open issue with no committed design, and the
cached model assets a refresh path would service do not exist either.

**The `SYNC_OFFLINE_QUEUE` branch stays.** It is the same shape — a service
worker message re-dispatched as a window event — and it is not the same
situation: `OfflineQueueService` listens for `sync-offline-queue` and drains
the queue when it arrives. The distinction the removal turns on is whether
anything is on the other end, not whether the mechanism looks speculative.

Rejected: **guarding or documenting the branch instead.** A comment saying
"unused" is what the original comment already effectively said, and it had
survived long enough to be cited in an issue as evidence the capability
existed.

Rejected: **building the consumer now.** A refresh path with nothing to
refresh is a second dead capability, and it would fix the shape of #23's
answer before #23 has one.

## Consequences

- `PwaService` still ignores unknown message types, so a worker that posted
  `CHECK_MODEL_UPDATES` today would be silently ignored rather than throwing.
  Its spec asserts exactly that, in place of the old assertion that the event
  was re-dispatched.
- **What #23 would need in order to reintroduce this: the consumer first.** A
  service that owns cached model assets, knows their versions, and can decide
  that one is stale. The signal is the last part to add, and it should be
  added against a listener that already exists — the reverse order is what
  produced this record.
