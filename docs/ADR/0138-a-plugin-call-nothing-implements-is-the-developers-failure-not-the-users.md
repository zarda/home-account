# 138. A plugin call nothing implements is the developer's failure, not the user's

**Status:** Accepted, implemented · **Date:** 2026-09-17 · **Issues:** #426

Reference documentation lives in [../analytics.md](../analytics.md).

## Context

A cold start on the simulator raised a bare "Error" snackbar from
`GlobalErrorHandler`, with nothing else on screen to say what had failed.
The handler's own `console.error` printed the rejection it caught, but the
native console bridge serializes an error through `JSON.stringify`, which
only carries a thrown object's *enumerable* fields — for a
`CapacitorException` that is `{ code: 'UNIMPLEMENTED' }` and nothing else, no
message, no stack. Reasoning about the log alone went nowhere. A `window`
`unhandledrejection` listener, the obvious next instrument, never fired
either: Zone.js's patched promises route a rejection to `NgZone.onError`
instead of ever dispatching the DOM event a plain listener depends on, so
the standard way to catch this from outside Angular does not see it inside
Angular at all.

Instrumenting the handler itself — printing the caught value's `code`,
`message` and `stack` as plain strings rather than letting the console
bridge decide what survives — is what actually named the source on a
signed, simulator-run cold start: `"FirebaseAnalytics.then()" is not
implemented on ios`, thrown from inside
`src/app/core/services/analytics-transport.ts`.

`NativeAnalyticsTransport.load()` cached its loaded plugin as
`this.plugin ??= import('@capacitor-firebase/analytics').then(m =>
m.FirebaseAnalytics)` — a promise that *resolves with* the plugin object
Capacitor's `registerPlugin()` hands back. That object is a `Proxy` whose
catch-all `get` trap answers any property it does not recognise — `then`
included — with a callable wrapper for a same-named native method. Promise
adoption reads `.then` off whatever a promise resolves to, so the runtime
read that `then` through the trap, got back a *native method call* instead
of the real `Promise.prototype.then`, and called it. That dispatch rejected
`UNIMPLEMENTED`, unhandled, because nothing was awaiting *that* call — and
the outer promise the transport had cached never settled either, because
the wrapper it got back in `then`'s place never invokes the resolve or
reject it would have been given. Every native call through this transport —
`setEnabled`, `logEvent`, `logScreenView` — had been hanging since the
transport was written for the consent gate; the `UNIMPLEMENTED` rejection is
only the visible half of a defect that had no visible half until it started
throwing on a call the app happened to make at boot.

## Decision

**The transport keeps its plugin in a box that has no `then` of its own, and
the global handler stops treating an unimplemented plugin call as something
the user needs to see.**

### The box, and the injectable loader

`this.plugin` is now typed `Promise<{ plugin: NativeAnalyticsPlugin }>`, and
every caller destructures `const { plugin } = await this.load()`. A plain
object has no `then`, so nothing about promise adoption ever reaches the
Proxy's trap, and the promise this class caches settles the moment its own
`.then` callback returns — which is all it ever needed to do.

The module import itself moved behind a constructor-injected loader,
`() => Promise<{ FirebaseAnalytics: unknown }>`, defaulting to the same
dynamic `import('@capacitor-firebase/analytics')` the transport always used.
The default keeps the plugin out of the web bundle exactly as before; the
seam exists only so a spec can substitute a fake proxy and reproduce the
original hang deliberately, without needing a real device to prove the fix
holds.

### The handler rule

`GlobalErrorHandler` now checks the unwrapped error for `code ===
'UNIMPLEMENTED'` before its throttle bookkeeping, and returns — logging
still happens, but no snackbar is raised. A method `registerPlugin()`'s
proxy answers with "not implemented on this platform" is a wiring mistake on
the app's side of the bridge, not something the user did or can act on; a
bare "Error" toast on a cold start gives them nothing to do about it and
nothing it means; the developer needs the log line, and only the log line.

**Consequence for every other plugin call.** Because the global handler no
longer raises anything for this class of failure, a plugin call whose
outcome the user genuinely needs to see must catch that outcome locally and
report it itself — the global handler is now a place this specific failure
goes to be silent, not a backstop for it. The app's own analytics call
sites already swallow their own errors, so this did not change their
behaviour; it is stated here as the rule the next plugin call site has to
know.

## What was rejected

- **A `window` `unhandledrejection` listener as the diagnostic path.**
  Confirmed not to work before the real instrument was tried: Zone.js's
  `ZoneAwarePromise` routes a rejection to `NgZone.onError`, never to the
  DOM event a plain listener depends on, so this approach could not have
  found the source no matter how long it ran.
- **Fixing only the throw, and leaving the handler to show whatever a
  plugin raises.** The box closes this one hang, but any other
  `UNIMPLEMENTED` call — present or future — would still raise the same
  unhelpful snackbar without the handler rule; both were adopted together.

## Consequences

- `analytics-transport.ts`: the plugin cache is a box, `load()` returns the
  box, and the constructor's loader parameter is new. The single production
  call site building the transport is unchanged — the default argument
  covers it. `analytics-transport.spec.ts` grew to prove the box carries no
  `then` on any path and that a fake proxy reproducing the original shape
  can no longer hang it.
- `global-error-handler.ts` gained `isUnimplementedPluginCall` and the early
  return; `global-error-handler.spec.ts` grew to cover it.
- Verified on the simulator: a cold start with every fix in place logs no
  `UNIMPLEMENTED` line and raises no "Error" snackbar, and
  `FirebaseAnalytics.setEnabled`, `setCurrentScreen` and `logEvent` were all
  observed reaching the native bridge for the first time — native analytics
  on iOS has been sending only since this change, not since the consent
  gate that was believed to have shipped it.
- [docs/analytics.md](../analytics.md) states the box rule in its
  native-transport section, and that native analytics on iOS sends only
  from this point forward.

## Departures from the issues

None. Tracker #426's third part asked for the source of the bare "Error"
snackbar; it was found, and it was not the candidate originally suspected —
see Things that only became apparent while building.

## Things that only became apparent while building

- **The share listener was the leading suspect, and was not involved.**
  Before instrumenting the handler directly, the share-intake service's own
  boot-time listener registration looked like the likeliest source, since it
  runs unconditionally at startup with no handler in its own chain. It was
  never near the actual defect — the source was in a different service
  entirely, and only printing the caught error's own fields, rather than
  reasoning about where an unhandled rejection at boot was likely to come
  from, actually found it.
- **The hang was older than the symptom.** The thenable line dates from the
  commit that first wired Firebase Analytics behind the consent gate; every
  native analytics call on iOS had been silently hanging since that day.
  Nothing made it visible until this branch's own boot sequence happened to
  call a native method early enough, and clearly enough, for the rejection
  to reach the handler.

## Known gaps

- **Other developer-class codes still raise the snackbar.** Only
  `UNIMPLEMENTED` is silenced; a different plugin failure mode with no
  established meaning to the user would still show the generic error today.
