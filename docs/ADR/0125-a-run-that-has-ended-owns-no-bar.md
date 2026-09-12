# 125. A run that has ended owns no bar

**Status:** Accepted, implemented · **Date:** 2026-09-12 · **Issues:** #419

Reference documentation lives in [../receipt-import.md](../receipt-import.md).

Closes the fourth of the known gaps
[0118](0118-the-processing-step-names-its-step-and-the-write-owns-its-signals.md)
filed — every extraction door leaving its bar at 100 — and applies
[0114](0114-the-confirm-step-reads-the-writes-progress-from-the-service.md)'s
rule that the service owns the figures the wizard renders, to the end of a
run rather than the middle of one. It also removes the field
[0065](0065-an-attempt-is-recorded-where-it-runs.md) recorded as written
everywhere and read nowhere.

## Context

0118's fourth gap, in its own words: "Each of the six clears `isProcessing`
in its `finally` and never puts `processingProgress` back … Invisible for
the same reason the write's was: the bar renders under `isProcessing()` and
each door's first act is to set a low percentage, inside the same
synchronous block. A uniform rule would be better than six coincidences."

The coincidence is thinner than six repetitions of one habit. `AIImportService`
publishes one `processingProgress`, and the wizard renders it in two places
behind two different gates: the processing step's bar under
`@if (isProcessing())`, and the confirm step's bar under
`@if (isImporting())`. Neither gate protects the other. A door that ends at
100 leaves a figure standing that the *other* renderer can pick up, and the
only thing between the two is that `confirmImport` happens to zero the bar
at its head — which 0118 put there, for the confirm step's own half of this
gap.

Separately, `processingSource`. 0065 recorded it exactly: the record's
diagnostics are "read where `processingSource` never was: that field is
still written throughout the service, but nothing outside a spec has ever
read it back." `ImportResult.diagnostics` had taken the job over; the field
stayed, written from eight places, asserted by one spec, and read by
nothing.

## Decision

**The tail of a run is one method every door calls; the head stays with the
door.**

```ts
private endRun(): void {
  this.isProcessing.set(false);
  this.processingStep.set(null);
  this.processingProgress.set(0);
}
```

All six `finally` blocks call it, and nothing else clears them at the end of
a run. The three writes are one synchronous block, so nothing can render between
the flag going false and the bar going with it — the same property 0118
relied on at the head of `confirmImport`, applied to the end of every
extraction.

### The head is not centralised, and that is the decision

A `beginRun(step, floor)` was the obvious companion and was rejected. Its
step argument would be `reading` at all six call sites and would stay that
way: every door's first act is reading, and a parameter with one value
forever is a parameter that only makes the call sites longer. The floors
genuinely differ — 10, 10, 5, 10, 10 and 20 — and each is chosen for the
shape of the door above it: `importFromMultipleImages` starts at 5 because
it has a per-file rung to climb before extraction, and `importFromJSON`
starts at 20 because it has only two steps to spend the bar on.

More to the point, there is no shared moment at the head to centralise
into. Each door already sets its floor in the same synchronous block as
`isProcessing.set(true)`, and each reaches its own first `await`
differently. That co-location is what made the stale 100 invisible in the
first place; a helper would have moved it without improving it.

`confirmImport` is untouched. Its head reset is 0118's, and the reason 0118
gave for not moving it to a `finally` still holds: `finally` runs before the
method's trailing read-back of the completed record, while `isImporting` —
the only gate on that section — stays true until the read-back resolves, so
a reset there shows the bar reach 100 and then sit visibly empty on screen.

`importFromImage` has two `set(100)` sites, one on the strategy branch's
early return and one on the legacy fallback. Both are harmless under a tail
rule, which is the argument for a tail rule: it does not require anyone to
have audited the heads.

### `processingSource` is deleted

The declaration, the eight writes and the one spec assertion that was its
only reader.
[0048](0048-a-dead-capability-is-removed-not-guarded.md)'s rule, on a field
0065 had already measured as dead.

### What was rejected

- **A `beginRun(step, floor)` to match `endRun`.** Above: one step value
  forever, floors chosen per door, and no shared moment to own.
- **Deleting the `set(100)` calls instead.** The full bar is a door's last
  true statement about itself while its flag is still raised. What was
  wrong was that the statement outlived the flag, not that it was made.
- **Zeroing the bar in the wizard, where the gates are.** Two renderers
  would then need two resets kept in agreement, and the figure belongs to
  the service — 0114 settled that.
- **Keeping `processingSource` behind a reader.** There was nothing to read
  it for that `ImportResult.diagnostics` does not already answer.

## Consequences

- **`processingProgress` is zero exactly when no run is in flight**, under
  either gate, rather than by the coincidence of what the next run's first
  statement happens to be.
- **`ImportResult.diagnostics` is the single account of how a door ran.**
  There is no second, unread one.
- **Both doors under test end at the floor and finish at zero.** The CSV
  and JSON specs record every `processingProgress.set` argument and assert
  that the sequence begins at the door's floor and ends at 0, leaving the
  middle unpinned so a percentage can be retuned without a spec edit.

## Things that only became apparent while building

- **Two renderers behind two unrelated gates is what makes this a rule.**
  Read as six doors each forgetting the same line, the defect looks
  cosmetic and self-correcting. Read as one signal with two consumers whose
  gates do not imply each other, the correctness of the current screen
  depends on the next run's first statement — and that is not a property to
  leave to repetition.
- **A head helper looks symmetric and is not.** `endRun` exists because six
  doors share an *ending*: no arguments, three signals, identical every
  time. A `beginRun` would take a step that is `reading` at all six sites
  and a floor that takes three different values across them — a helper
  parameterised by the very thing it was meant to unify.

## Known gaps

- **Two of the six doors have a spec for the tail.** The CSV and JSON doors
  are pinned; the image, statement-image, multi-image and PDF doors share
  `endRun` by construction and nothing asserts it for them.
- **The step's reset is proved at the method, not per door.** `endRun`
  clears `processingStep` and the exhaustive step sequences
  ([0126](0126-a-step-no-door-can-paint-comes-off-the-type.md)) end in
  `null` on two doors; the other four inherit it.
- **Nothing gates a seventh door.** A new extraction entry point that
  writes its own `finally` rather than calling `endRun` would reintroduce
  exactly this, and no script or spec would say so.
