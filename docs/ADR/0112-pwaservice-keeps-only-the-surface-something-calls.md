# 112. PwaService keeps only the surface something calls

**Status:** Accepted, implemented · **Date:** 2026-09-10 · **Issues:** #390

No reference document owns the service. What the app's PWA support actually
is — an offline queue and a share-target worker — is in
[../../README.md](../../README.md) and
[../share-import.md](../share-import.md).

Applies [0048](0048-a-dead-capability-is-removed-not-guarded.md) and
[0105](0105-the-cache-size-card-is-removed-and-the-dead-worker-with-it.md),
and closes 0105's known gap — "the install and update surface is still
half-present" — which that record named and deliberately left standing.

## Context

0105 took the cache-size card, its signal, its three post methods and
`src/service-worker.ts` out of the tree, and listed by name what it was not
touching: `isInstallable`, `updateAvailable`, `serviceWorkerReady`,
`showIOSInstallInstructions`, `promptInstall`, `applyUpdate`, and the
`SwUpdate`/`checkForUpdates` path.

Every one of them was dead in the same way. The three signals were written
only by the listeners and subscriptions the constructor registers, and read
only by a spec.
`promptInstall` replayed a `deferredInstallPrompt` the service had captured;
`showIOSInstallInstructions` returned a boolean nothing rendered; `applyUpdate`
and `checkForUpdates` drove `SwUpdate`, whose `isEnabled` is false in every
build because nothing calls `provideServiceWorker` — the Angular worker's
artifacts are built by the `production` configuration and never registered.
Fourteen `createSpyObj('PwaService', …)` stubs across the suites named a
surface no component consumed.

One member was worse than dead. The `beforeinstallprompt` listener called
`event.preventDefault()` and stashed the event — the standard way to defer the
browser's own install prompt so an app can raise it later from its own
button. There is no such button. So the app suppressed Chrome's install UI on
every visit and offered nothing in its place: the one member of this surface
with an observable effect, and the effect was to remove a capability the
browser was providing for free.

## Decision

**The service's public surface is `isOnline`, `isStandalone`, `isIOS`,
`refreshOnlineStatus` and `registerBackgroundSync`, and nothing else.**

Everything named in 0105's gap goes, plus the `SwUpdate`, `ApplicationRef` and
rxjs imports, the exported `PwaInstallPrompt` interface, the
`versionUpdates`/`unrecoverable` subscriptions, the constructor's
`try`/`inject` around `SwUpdate`, the `_isInstallable`, `_updateAvailable` and
`_serviceWorkerReady` signals with their computeds, `deferredInstallPrompt`,
and the `inject` import itself once no call site was left for it.

### `beforeinstallprompt` is not listened to, so the browser's own prompt returns

The listener is removed whole — no `preventDefault` left behind under a
comment. Where a browser has install UI of its own it now shows it, which is
the correct behaviour for an app with no install affordance to substitute.
This is the one behaviour change in the removal, and the spec case that pins
it (*ignores beforeinstallprompt*) asserts `preventDefault` is **not** called:
the RED run failed while the listener still called it.

### `appinstalled` keeps its standalone half

`window.addEventListener('appinstalled', …)` stays and still sets
`_isStandalone`. It is the one moment standalone flips without a reload, and
the camera capture reads `isStandalone()`. Nothing reads an install *state*,
and no listener claims `beforeinstallprompt` — the comment on that listener
says what is, not what used to pair with it.

### The package, the build option and `ngsw-config.json` stay

`@angular/service-worker` stays a dependency, `angular.json`'s `production`
configuration keeps `"serviceWorker": "ngsw-config.json"`, and the config file
itself is untouched — all three for 0105's reasons, unchanged: the build
option needs the package, and `ngsw-config.json`'s spec pins that no cache
group would route analytics, a property that is free while nothing registers
that worker and worth keeping free.

### The alternatives that were rejected

- **Building an install prompt** and wiring `promptInstall` to it. No product
  decision asks for one, and 0019's order applies here as much as to a worker:
  a job first, then the code for it. Meanwhile the browser's own prompt is a
  better install affordance than a button nobody has designed.
- **Dropping `@angular/service-worker`.** The `production` build option
  references `ngsw-config.json` and fails without the package; removing it is
  a build-configuration decision, not a dead-code one.
- **Keeping `SwUpdate` behind a guard** — "when a worker is registered". 0105
  rejected the same guard for the cache-size row and for the same reason: a
  registered worker does exist (the share target), so the guard would have
  been true and the path still dead.
- **Keeping the fourteen spy stubs' member lists as they were.** They name
  only live members now, which is what makes a stub a description of the
  service rather than of its history.

## Consequences

- **The browser offers its own install prompt again**, where it has one.
  README's *Installable* bullet says so, and iOS keeps its manual Add to Home
  Screen — Safari has no `beforeinstallprompt` at all, so nothing there
  changed either way.
- **Nothing in the app knows whether an update is waiting.** No `SwUpdate`
  subscription, no `updateAvailable`, no reload prompt — which is what was
  already true, since `isEnabled` was never true.
- **All fourteen `createSpyObj('PwaService', …)` stubs needed no edit**: none
  of them named a removed member, which is its own evidence about how much of
  this surface anything used.
- **`SYNC_OFFLINE_QUEUE` is still the one message with a listener and no
  sender**, exactly as 0105 left it. This removal does not touch the message
  handler.
- **No documentation outside ADRs 0092 and 0105 named a removed member**, and
  those two are history and stand as written.

## Things that only became apparent while building

- **The `preventDefault` was the whole defect, and it is not what #390 was
  about.** The issue is a dead-surface removal; the listener was on the list
  as one more unused member, and only reading what it did showed that it was
  actively taking something away. The spec case is the one part of this
  removal that pins a behaviour rather than an absence.
- **The `inject` import went too, and no list of members had named it.** Its
  only use was the constructor's guarded `inject(SwUpdate)`; a removal list
  built from members misses the imports that existed only to serve them.
- **The `appinstalled` comment narrated the removal before it was fixed.** It
  said the install half it used to pair with was gone — a comment about the
  diff rather than about the code. It now states what is: standalone flips
  there without a reload, the camera capture reads it, nothing reads an
  install state, and no listener claims `beforeinstallprompt`.

## Known gaps

- **There is no in-app install affordance**, on any platform. The browser's
  prompt is the whole of it on Chromium; a Firefox or a desktop Safari user
  gets nothing at all.
- **iOS keeps its manual Add to Home Screen.** Safari offers no install event
  and no prompt to defer, so an iOS user still has to know the Share-sheet
  route — which README documents and the app itself never mentions, since
  `showIOSInstallInstructions` was the member that would have and it was never
  rendered.
- **The `production` build still emits an Angular service worker nobody
  registers.** 0105's consequence, unchanged: artifacts are built and shipped
  to hosting, and `provideServiceWorker` is called nowhere.
