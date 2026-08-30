# 88. The smoke harness owns the noise it makes

**Status:** Accepted, implemented · **Date:** 2026-08-31 · **Issues:** #355

## Context

With the analytics transport's disposal guard shipped
([0083](0083-a-destroyed-injector-silences-the-analytics-transport.md)) the
unit sweep is pristine, and `npm run smoke` was not. A full emulator run
logged two residual noise classes, both originating inside `@angular/fire`
rather than in app code: a steady drip of `Firebase API called outside
injection context: <fn>` warnings, and eight `NG0205: Injector has already
been destroyed` log lines carrying no app frames at all — four thrown
errors, each printed twice (Karma logs an `ERROR:` line and a bare `Error:`
line per event). Nothing failed, and nothing had failed for a long time.

**Both classes come from the same wrapper.** Every `@angular/fire` export is
zone-wrapped so it can hop in and out of `NgZone`; the wrapper binds any
function argument to the `EnvironmentInjector` that was active *at the call*.
When no Angular injector is active — the normal case for a raw SDK call in a
`beforeAll`, an `afterAll`, or at module scope, which is how every smoke file
stands up its emulator connections — the wrapper falls back to calling the SDK
directly, and logs first.

**The house bar is that test output is pristine**, and eight red `ERROR`
lines are precisely the scroll a real warning hides behind. That bar is the
whole reason this was worth doing: nothing here was broken.

## Decision

**The suite silences the advisory noise at the logging layer, and the one
block that leaks a listener holds its module open.** Two independent
mechanisms, because the two classes turned out to share a wrapper and nothing
else.

### The warnings: silence the level, burn the advisory, restore the console

`src/app/core/services/testing/silence-firebase-warnings.ts` is called at
module scope by every smoke file that imports `@angular/fire`.
`setLogLevel(LogLevel.SILENT)` kills every per-call line — `SILENT` is the
enum's minimum, so the wrapper's `currentLogLevel >= logLevel` gate is false
unconditionally. The separate one-time advisory ("Calling Firebase APIs
outside of an Injection context may destabilize…") prints under `isDevMode()`
regardless of level and is gated on a module-level `alreadyWarned` flag that
never resets for the life of the loaded module — one bundle for the whole
Karma run — so the helper *burns* it on purpose: it installs a momentary
`console.warn` filter, makes one side-effect-free `getApps()` call to trip the
flag, and restores the original `console.warn` in a `finally`.

The helper is idempotent and every file calls it for itself, rather than
routing through some designated "first" file, so each smoke file stays
order-independent and correct when run alone under `--include`. Its own smoke
spec brackets the call — capturing `console.warn` *before* the helper runs and
asserting the identity afterwards — so "no lasting monkey-patch" is a test
rather than a comment in the file that does the patching.

Rejected: **wrapping the harness's setup calls in
`runInInjectionContext(TestBed.inject(EnvironmentInjector), …)`** — the
issue's own first suggestion. It is the same mechanism as the other half of
this record: the wrapper would capture a TestBed injector that per-test
teardown destroys, and any SDK callback resuming afterwards re-enters a dead
one. Silencing an advisory by manufacturing more injector-bound SDK calls
would have widened exactly the failure the advisory is about. Rejected:
**importing the SDK from the root `firebase/*` packages** to sidestep the
wrapper entirely: root `firebase` is 12.15.0 and `@angular/fire` carries its
own nested `^11.8.0`, so anything built through the root packages is a
different, incompatible instance from the one the rest of the suite gets.
Rejected: **accepting the pattern and documenting it as deliberate**, which
the issue explicitly allowed. Two thousand nine hundred and thirty-eight lines
is not a pattern anyone reads a note about.

### The NG0205s: one block, one line, and it cancels the teardown

All eight lines came from a single `describe` — `degraded recovery` in
`auth.service.smoke.spec.ts` — and the fix is one option on that block's
`TestBed.configureTestingModule`: `teardown: { destroyAfterEach: false }`.

The mechanism, since the stack is entirely library-internal:
`AuthService.setupAuthStateListener` registers `onAuthStateChanged` inside
`runInInjectionContext(this.injector, …)`, so `@angular/fire` binds the
callback to the spec's TestBed injector — and the service never keeps the
unsubscribe function, so the listener stays on the block's shared `auth` for
the rest of the run. The block's first spec therefore leaves a listener bound
to an injector the default teardown destroys the instant that spec ends; the
second spec signs out and signs back in, and each transition is delivered to
every registered observer, the dead one included. `assertNotDestroyed` throws
inside `@firebase/util`'s `ObserverProxy`, whose `try { fn(observer) } catch {
console.error(e) }` swallows it — which is why errors print and every spec
still passes. This is the only block in the suite that both outlives an
injector and moves the auth state afterwards.

`destroyAfterEach: false` works because it **cancels** the destruction rather
than deferring it: with teardown disabled, `resetTestingModule` skips
`tearDownTestingModule`, the module ref is never destroyed at all, and the
leaked listener always re-enters a live injector. Rejected: **a grace period
after `deleteApp` in the block's `afterAll`.** The injector that dies is not
the last one — it dies mid-file, and the offending delivery happens during the
next spec, long before any `afterAll` runs. Rejected: **awaiting quiescence in
the spec or a block-level `afterEach`.** Nothing is pending at teardown time;
the listener is permanently registered and fires later, on someone else's
action, so no amount of waiting before the injector dies changes what happens
after it. Scoped to the one block rather than the file, because the other four
blocks are correct under the default teardown and keeping injectors alive has
a real, if small, cost.

## Departures from the issue

- The issue proposed pinning the emitting suites by running the smoke files
  one at a time. The existing log was enough: Karma serves the bundles as a
  single `spec-*.js` pattern, so files run in bundle-name order, and three
  unique SDK-call fingerprints in the warning stream fixed all five inner
  `describe` blocks onto the run before any bisect was needed. The bisect that
  followed confirmed an answer already in hand, which made it a 35-second loop
  instead of a two-minute one.
- The issue's third step — "order the emulator stream teardown ahead of
  injector destruction in the affected suites" — was not what fixed it. There
  was one suite, and ordering was never the lever.

## Things that only became apparent while building

- **The warning count was off by two orders of magnitude.** The issue measured
  "~50"; the baseline carried 2938 per-call lines plus 2 advisory lines. The
  estimate had counted the *call sites* named in the issue — the setup
  quartet — not the calls. It changed nothing about the design (SILENT gates
  every per-call line regardless of how many there are), but it is why
  "accept and document" was never really on the table.
- **Every suspected shape was wrong.** The issue's reading — suite
  boundaries, `deleteApp`, the three files that already opt out of
  `destroyAfterEach` — described where the cluster *appeared*, not what caused
  it. The eight lines sat inside one file, between two specs of one block, in
  a file with no teardown opt-out at all. The cluster looked like a boundary
  because it sat at a `describe` boundary that happened to fall mid-file.
- **The library logs what it swallows, which is why this could last.** The
  throw happens inside `ObserverProxy.sendOne`'s catch-and-`console.error`, so
  a genuine lifecycle defect can sit in a suite indefinitely with every spec
  green and every run noisy.

## Known gaps

- **The root cause is in production code, and was deliberately left there.**
  `AuthService.setupAuthStateListener` (`auth.service.ts:183`) discards the
  unsubscribe function `onAuthStateChanged` returns. The app builds one
  long-lived instance, so it is harmless there; only tests build many. Any
  future spec that creates an `AuthService` and then moves the auth state in a
  *later* spec sharing the same `auth` reproduces this exactly. A follow-up
  candidate, not a fix smuggled into a test-noise change.
- **The multiplicity is unexplained.** Two auth transitions produce four
  logged errors where one dead observer should give two. Attribution is not in
  doubt — all four vanish under a change confined to that one block — but the
  extra pair was never pinned. Worth a footnote only if NG0205s return.
- **A different intermittent survives this record.** Roughly one run in three
  logs an unrelated `NG0911` from the transaction list, an `afterNextRender`
  callback running after its component is gone. It is a distinct noise class
  with a distinct cause, it is not covered by anything decided here, and it is
  a follow-up candidate.
- **Zero-and-zero was measured locally.** The criterion held across three
  consecutive full pairs of `npm run smoke` and `npm run smoke:dates`, with
  spec counts unchanged and no measurable wall-time cost. The fix is not
  timing-sensitive — it removes the teardown rather than winning a race
  against it — but CI's own runs are the standing arbiter, as they were for
  0083.
