# 90. A render callback is registered only while the view can run it

**Status:** Accepted, implemented · **Date:** 2026-08-31

## Context

[0088](0088-the-smoke-harness-owns-the-noise-it-makes.md) cleaned the smoke
sweep and named what it was leaving behind: "Roughly one run in three logs an
unrelated `NG0911` from the transaction list". Four identical lines, near
"Executed 418 of 419", every one of them ending in the same frame:

```
ERROR: Error: NG0911: View has already been destroyed.
    at storeLViewOnDestroy (…/_pending_tasks-chunk.mjs:1825:11)
    at NodeInjectorDestroyRef.onDestroy (…/_pending_tasks-chunk.mjs:2265:5)
    at new AfterRenderSequence (…/_debug_node-chunk.mjs:4402:44)
    at afterEveryRenderImpl (…/_debug_node-chunk.mjs:4460:20)
    at afterNextRender (…/_debug_node-chunk.mjs:4441:10)
    at …/transaction-list.component.ts:408:7
    at new ZoneAwarePromise (…/zone.js:2226:23)
    at TransactionListComponent2.<anonymous> (…/transaction-list.component.ts:405:11)
    at next (<anonymous>)
    at fulfilled (…/chunk-4WQORTE7.js:120:24)
```

0088 read this as "an `afterNextRender` callback running after its component is
gone". The stack says otherwise, and the distinction is the whole fix.
`afterNextRender` never got as far as running anything: the throw is in
`NodeInjectorDestroyRef.onDestroy`, which `AfterRenderSequence` calls **in its
constructor** to arrange its own cleanup. **Registering** is what fails on a
dead injector. A callback registered while the view was alive is not a hazard
at all — Angular cancels it with the injector, silently.

That narrows the suspects to registrations reached after an `await` or an
effect hop, and `runAnchored` is exactly that shape. It measures an anchor row,
`await`s a page fetch, and only then registers the correction that re-measures
the row and shifts `scrollTop` by the drift. Between those two statements the
user can navigate away. The fetch resolves into a component that no longer
exists, the registration throws into the fetch's own promise chain, and the
rejection surfaces through `maybeFetch`'s untracked `void` call as a bare
console error. Nothing fails — the suite stayed at 419 of 419 through every
noisy run — which is why this outlived the wave that found it.

The component's other three `afterNextRender` sites are all safe, and for the
same reason rather than by luck: the constructor's edge-observer setup and
`scheduleFetchCheck` both register synchronously from a live component, and
`scrollToTarget` registers from an effect. None of them can be reached after
destruction on the fetch path.

This is the third destroyed-injector guard in the same line: [ADR
0083](0083-a-destroyed-injector-silences-the-analytics-transport.md) silenced
the analytics transport, [ADR
0089](0089-the-auth-listener-dies-with-the-injector-that-registered-it.md)
let the auth listener die with its injector, and this one guards the render
callback's registration the same way.

## Decision

**Each post-await registration checks that the view is still there first.** The
component already injects `DestroyRef`; the installed `@angular/core` (22.1.4)
declares `abstract get destroyed(): boolean` on it, undeprecated, so the guard
is a field read rather than the `onDestroy`-flag idiom used at :302:

```ts
const added = await fetch();
if (this.destroyRef.destroyed) return added;
```

The predicate is the throw's own condition, not a proxy for it:
`NodeInjectorDestroyRef.destroyed` is `isDestroyed(this._lView)`, and the
`storeLViewOnDestroy` that throws is guarded by that same check. There is no
window between asking and registering — both are synchronous.

`runAnchored` returns `added` rather than `0`. The page really did land in the
window; the guard skips a cosmetic scroll correction, and saying "nothing was
added" to make the caller's loop stop would be a lie told for a side effect.

`scrollToTarget` gets the same entry guard. Its effect cannot currently deliver
a target to a destroyed component — Angular does not run destroyed effects —
so this one is structural symmetry rather than a fix for observed noise, and is
recorded as such instead of being dressed up as the cause.

Rejected: **a try/catch around the registration.** It would have swallowed the
symptom while leaving the component asking a dead injector for work, and would
equally have swallowed a future NG0911 with a different cause.

Rejected: **guarding inside the `afterNextRender` callback.** The callback is
not the thing that runs; it is the registration that throws before any callback
exists.

Rejected: **`takeUntilDestroyed`-style plumbing or an AbortSignal on the
fetch.** The fetch is the window service's, shared with every other caller, and
cancelling it would change what the window holds. Only this component's scroll
correction is pointless after destruction.

## Consequences

- `transaction-list.component.spec.ts` gains `post-destroy render guards`,
  three specs that make a 1-in-3 race deterministic: a page fetch held open by
  a promise the spec resolves, `fixture.destroy()` while it is in flight, then
  the resolution. Against the unguarded component both new destruction specs
  fail with `NG0911` itself, not with a proxy assertion.
- The correction still runs when the view is alive — the third spec pins that,
  so a guard that always returned early would fail rather than pass quietly.

## Things that only became apparent while building

- **The spec had to prove it reached the hazard.** `runAnchored` skips the
  registration when no anchor row was measurable, which in a fixture is a
  plausible accident of layout — a spec that quietly took that branch would
  pass against the unguarded component and pin nothing. The spec asserts the
  anchor row exists and has a positive `bottom` before it destroys anything, so
  the precondition fails loudly instead of vacuously passing.
- **The guarded path keeps looping, and that is fine.** Returning `added`
  leaves `maybeFetch` free to run one more iteration against a destroyed
  component, reading the `topSentinel`/`bottomSentinel` signal-based
  `viewChild` queries on a dead view to do it. That was worth checking rather
  than assuming: on a destroyed `LView` those queries read back `undefined`,
  so `isNearEdge` is false for both edges and the loop hits its own `else`
  branch and breaks on that very next iteration. There is no second fetch,
  and `MAX_AUTO_FETCHES` never comes into it.
- **0088's one-in-three estimate held up in what survives.** Four full-sweep
  logs from before the fix carry the four lines; none of the full sweeps kept
  from after it do, including the five-run gate above. Not every sweep that
  ran was logged, so these are counts of the logs that survived, not of every
  run made.

## Known gaps

- **Five clean runs is evidence, not proof.** The gate was five consecutive
  full `npm run smoke` runs at zero `NG0911`, zero `NG0205` and zero
  injection-context lines, 419 of 419 each, plus a clean `npm run smoke:dates`.
  For a 1-in-3 intermittent that is strong, and the unit specs are the standing
  net that does fail. Log-line counts remain something no suite fails on.
- **One unrelated flake appeared during the gate and was not chased.** The
  first attempt at the gate ran three clean full sweeps, then died in
  `app.smoke.spec.ts`'s `beforeAll` on the next one — anonymous sign-in plus
  four emulator writes inside jasmine's default 5000 ms — and took the
  browser down with it. No `NG0911`, no test in that suite executed. That
  attempt was discarded rather than resumed; the restarted chain is the five
  consecutive runs above, and the flake did not recur across those eight
  runs. It is emulator cold-start contention, not this record's subject.
