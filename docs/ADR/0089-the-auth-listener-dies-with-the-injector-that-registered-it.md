# 89. The auth listener dies with the injector that registered it

**Status:** Accepted, implemented · **Date:** 2026-08-31 · **Issues:** #355

## Context

[0088](0088-the-smoke-harness-owns-the-noise-it-makes.md) cleared the smoke
run's noise and left one thing behind on purpose, in its own words: "the root
cause is in production code, and was deliberately left there".
`AuthService.setupAuthStateListener` registers `onAuthStateChanged` inside
`runInInjectionContext(this.injector, …)` and throws away the unsubscribe
function it hands back. `@angular/fire` binds the callback to the injector
active at the call, so the listener outlives that injector and every later auth
transition is delivered into a dead one — `NG0205`, thrown inside
`@firebase/util`'s `ObserverProxy`, which catches it and calls `console.error`.
Nothing fails; the log fills.

The app builds one root-scoped `AuthService` whose injector dies with the page,
so this is invisible in production. A suite builds one per spec. 0088 could
only reach the symptom from the test side, and did: `teardown: {
destroyAfterEach: false }` on the one `describe` — `degraded recovery` in
`auth.service.smoke.spec.ts` — that both outlives an injector and moves the
auth state afterwards. That works by cancelling the teardown, which means the
block stopped exercising the very lifecycle the rest of the suite runs under,
and the next spec anywhere to create an `AuthService` and then move the auth
state would reproduce the whole thing again.

## Decision

**The service keeps the unsubscribe function and releases the listener when
its own injector is destroyed.** Two lines, inside the
`runInInjectionContext` block that already exists:

```ts
const unsubscribe = onAuthStateChanged(this.auth, async (firebaseUser) => { … });
inject(DestroyRef).onDestroy(() => unsubscribe());
```

The callback body is untouched. `DestroyRef` comes from `inject` rather than
[0083](0083-a-destroyed-injector-silences-the-analytics-transport.md)'s
`injector.get(DestroyRef)` wrapped in a `try`/`catch`: this code already runs
inside the injector's own context, and the injector cannot already be destroyed
at the moment it is constructing the service that asks — which is exactly the
case 0083's `catch` exists for, its transport being built from outside.

**The proof is the removal of 0088's workaround.** The `teardown: {
destroyAfterEach: false }` line and its explanatory comment are gone, so the
`degraded recovery` block runs under the default teardown again — its injectors
are destroyed after each spec, and the listener registered in one no longer
survives to hear the next one sign out and back in.

Rejected: **keeping the teardown opt-out as belt and braces.** It would have
kept a block permanently exempt from the lifecycle every other block runs
under, and hidden a regression of this fix the moment it was reintroduced. The
opt-out was a symptom mask, and masks are removed when the cause is.

Rejected: **disposing from `ngOnDestroy`.** `AuthService` is not a component
and root-provided services get no such hook; `DestroyRef` is the injector-level
equivalent and already the house pattern from 0083.

## Consequences

- The unit spec gains `auth-state listener disposal`, which builds the service
  in a child of the TestBed environment injector — the pattern
  `analytics-transport.spec.ts` uses, so destroying it cannot reach the root
  injector the rest of the file depends on — and asserts one registration, no
  unsubscribe before the destroy, exactly one after it.
- `auth.service.spec.ts`'s `Auth` double now returns an unsubscribe function
  from `onAuthStateChanged`, as the real SDK does. A spy left returning
  `undefined` stands for an `Auth` that cannot be unsubscribed at all, which is
  not a thing the SDK can hand anyone.

## Things that only became apparent while building

- **The single-file smoke run does not reproduce it.** Running
  `auth.service.smoke.spec.ts` alone with the opt-out removed and the fix
  absent logged zero `NG0205`s; the full `npm run smoke` in the same state
  logged the eight 0088 measured. The reproduction depends on spec ordering
  within the block; jasmine-core 5.9.0 defaults to random spec order and the
  repo sets no karma/jasmine order config, so specs shuffle every run. The
  full sweep reproduced the leak only when the shuffle put the retry spec
  first — roughly a coin flip. The unit spec is the standing regression net.
- **0088's unexplained multiplicity stays unexplained, and stops mattering.**
  Two transitions producing four thrown errors was left as a footnote there. It
  is moot now that the count is zero, and this record did not chase it.

## Known gaps

- **Nothing pins the disposal at the emulator level.** The smoke evidence is
  the absence of eight log lines, not an assertion, and log-line counts are not
  something the suite fails on. A spec that registered a listener, destroyed
  its injector, moved the auth state and asserted the service's signals never
  moved would pin it directly; it was not worth a new emulator block for a
  service the unit spec can already build and destroy honestly.
