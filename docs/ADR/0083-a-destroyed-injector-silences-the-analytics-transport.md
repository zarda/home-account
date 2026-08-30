# 83. A destroyed injector silences the analytics transport

**Status:** Accepted, implemented · **Date:** 2026-08-30 · **Issues:** #345

## Context

A full local test sweep produces roughly 424 `NG0205` warnings — Angular's
own "inject() must be called from an injection context" — all traced to one
straddling `await`. `WebAnalyticsTransport.resolve()` calls `isSupported()`,
a real IndexedDB round trip, and awaits it before doing anything else. Under
Karma's `destroyAfterEach`, the TestBed injector that created the transport
is routinely torn down while that await is still pending; when it settles,
`resolve()` resumes by re-entering DI — `runInInjectionContext`,
`injector.get(Analytics, null)` — against an injector that no longer exists,
and both calls throw. Every caller of `resolve()` already wraps its own
`run()` call in a `catch` that funnels the failure into `console.warn`, so
nothing crashes and no test fails. It just warns, hundreds of times, about a
real defect the harness happened to survive.

The transport has no timers to cancel and no listeners to unsubscribe when
its owner goes away. What it does have is one `await` that outlives
everything else — `resolve()`'s call to `isSupported()` — and settling that
promise is the one event this class still has to answer to after the object
that created it may no longer exist.

**Why CI never saw this.** `resolve()` returns early, before the risky
await, whenever `analyticsIsConfigured()` is false — and CI writes the
measurement id as `ci-stub`, which fails that check on every run. A green CI
proves the transport is well-behaved on an id shaped like `ci-stub`; it says
nothing about the path a keyed measurement id takes, which is the only path
that ever reaches the await this record is about. Nothing prior to this
change had a spec that seamed around the config check to reach that path on
purpose, so nothing had ever pinned the bug or its fix — this record's spec
file is the transport's first.

## Decision

**The transport disposes itself when its own injector is destroyed, and
checks that before ever touching the injector again.** A `disposed` flag,
false by construction, is set two ways: by a `DestroyRef.onDestroy` callback
registered in the constructor, and — for the case where the injector is
*already* destroyed by the time the transport is built, so `onDestroy` would
never fire — by a `try`/`catch` around the `injector.get(DestroyRef)` call
itself, which marks disposed immediately when that get throws.

Every point that could re-enter DI or touch the SDK now checks the flag
first:

- **`resolve()`'s own entry**, beside its existing `!enabled` check.
- **The re-check straight after the `isSupported()` await** — widened from
  the toggle-off re-check that was already there for the same reason
  ("Re-check: the await above is exactly where a toggle-off, or the
  injector's own teardown, can land").
- **`setEnabled`'s synchronous disable branch**, which calls `run()` on
  `this.analytics` directly, without going through `resolve()` at all.
- **Both post-`resolve()` conditionals**, in `setEnabled`'s enable branch and
  in `logEvent`, belt-and-braces alongside the checks already inside
  `resolve()` itself — so "`run()` is never entered once disposed" is true at
  every call site that could reach it, not provable only by tracing back
  through `resolve()`.

`run()`'s own signature is untouched; disposal is a reason never to call it,
not a change to what it does.

### Two seams exist only so the spec can drive them

`isConfigured()` and `checkSupported()` are now `protected` wrappers around
`analyticsIsConfigured()` and `this.run(() => isSupported())` respectively.
Neither changes behaviour in the app — the spec subclasses
`WebAnalyticsTransport` to override both, so it can claim a real measurement
id without touching `environment.ts`, and control exactly when
`isSupported()` settles without a real IndexedDB call. Without them, a
regression spec would either need a keyed environment to reach the risky
path at all, or would need to fake enough of `@angular/fire` to be worth
doubting. The pattern matches `AnalyticsService`'s own `createTransport()`
seam in its spec — a protected method that exists only so test code can
substitute a value no constructor argument was worth adding for.

## Consequences

- **The claim that the unit suite is "structurally incapable of reaching
  Google" needed narrowing** ([../analytics.md](../analytics.md)). It was
  true for the reason the doc gave — CI's stub id fails the config check —
  but read as though nothing could ever reach the SDK from a test, which was
  never true of a keyed local run and is precisely the path this record is
  about. The doc now says what actually stops that path, and names the
  `NG0205` failure mode that used to sit one straddling await away from not
  being stopped cleanly.

## Things that only became apparent while building

- **The bug had two guards already, and neither covered the case that
  mattered.** `!this.enabled` was checked at entry and after the await, for
  a toggle turned off mid-resolve. Nothing was checked for the injector
  simply not existing anymore — a state a toggle can never produce and a
  test's own teardown produces routinely.

## Known gaps

- **Acceptance — zero `NG0205` warnings across a full sweep — is measurable
  only on a machine whose gitignored environment carries a real `G-…`
  measurement id.** CI's `ci-stub` never reaches the code path this record
  guards, so a green CI after this change proves the same thing it proved
  before: that the stub id keeps `resolve()` from running at all.
