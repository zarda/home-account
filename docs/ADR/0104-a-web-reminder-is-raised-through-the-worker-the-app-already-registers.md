# 104. A web reminder is raised through the worker the app already registers

**Status:** Accepted, implemented · **Date:** 2026-09-08 · **Issues:** #375

Reference documentation lives in [../reminders.md](../reminders.md) and
[../share-import.md](../share-import.md).

Extends [0092](0092-a-reminder-fires-once-and-the-record-of-it-lives-on-the-device.md),
whose delivery half this changes and whose scheduling half it leaves alone:
0092's rejection of *a service worker for web scheduling* was about an install
prompt and a cache lifecycle, and it stands. It gives the worker of
[0019](0019-share-intake-lands-through-a-stash.md) a second job, on the terms
that record set — one POST handled, everything else passed through, no
caching and no `sync`.

## Context

`showWebNotification` constructed a `Notification` directly. On Android Chrome
and on Firefox for Android that constructor throws
`TypeError: Illegal constructor` — the platform raises notifications only
through `ServiceWorkerRegistration.showNotification()` — so the seam's `catch`
returned `false`, and `deliverWeb` read that `false` as "permission refused for
the whole page" and **returned** out of the batch before `markDelivered`.
Nothing was raised, nothing was recorded, and every sweep retried the same
failure. Every Android user takes this path: there is no Android Capacitor
target (`@capacitor/ios` only, no `android/`), so the installed-PWA route is
the web route.

The permission half worked there. `Notification.requestPermission()` exists on
Android; only the constructor is missing. So the switch asked, was granted,
stored the opt-in, and delivered nothing, with no sign anywhere that it had.

The worker the fix needs was already there. `public/share-target-sw.js` is
registered at scope `/` on every non-native session and calls
`clients.claim()`, so `registration.showNotification()` was reachable on every
page a sweep runs on. A second worker is not an option: a `register()` at the
same scope replaces the first, and the share target would go with it.

0092's known gap and [../reminders.md](../reminders.md)'s were both stated in
terms of the closed tab — no service worker, so a closed tab raises nothing —
and neither named Android. The gap they described was real and is still open;
the bug was a different one hiding under the same sentence.

## Decision

**A web reminder is raised through the registered worker first and through
the page constructor only where no registration exists; the permission is read
once per batch, after the sent-log read; and one refused call skips one
reminder.**

### The registration first, on every platform

`showWebNotification` asks `navigator.serviceWorker.getRegistration()` and
calls the registration's `showNotification(title, { body, tag })`; it
constructs a `Notification` only when that resolves to nothing. The
registration is tried everywhere, not only where the constructor is known to
fail: Android's refusal is a `TypeError` raised at construction, which no
feature test can see coming, so probing ahead of time would throw on exactly
the platforms this exists to protect. One path also means one click behaviour,
which is *The worker's click handler* below.

### `getRegistration()`, never `.ready`

`navigator.serviceWorker.ready` never resolves where registration failed, and
a sweep must not hang waiting for a worker that is never coming.
`getRegistration()` answers with the registration or with nothing, and nothing
is the constructor's turn.

### The permission gate sits after `wasDelivered`

`deliverWeb` reads `webPermission()` once per batch — a refusal is for the
page, not the message — and tests it **after** `wasDelivered` has read the
sent log. `readSentLog` is where stale keys are pruned, and a device whose
permission is refused must still prune, or it keeps every key it ever
recorded; the spec that pins it (*prunes on a sweep that delivers nothing*)
sets the permission refused and asserts the log was pruned, and a once-per-batch
early return would have failed it. `webPermission()` answers `'unsupported'`
where the `Notification` global itself is absent (the iOS WKWebView), and
nothing outside it, the seam and `requestPermission()`'s web branch may name
`Notification`.

### A refusal is that call's alone

`continue`, not `return`: a call the browser refuses skips that reminder, the
batch goes on, and the key is not marked, so the next sweep tries again.
`deliverWeb` is `async` for this — the seam has to be awaited to know whether
the notification displayed — and `deliver` awaits it, so `sweep()` still
resolves only after web delivery has finished.

### The worker's click handler

`notificationclick` closes the notification, focuses the first window client
and, when `focus()` rejects, falls through to `clients.openWindow('/')`. `/`
is where the Upcoming card is, and the reminder already names the bill. No
`notificationclose`, no `data`, no deep link.

### Nothing is scheduled

`showTrigger` ships in no browser, so an `at`-bearing reminder is still
skipped on the web: the far-off bill reminders and the recap nudge have
nowhere to be scheduled. 0092's scheduling half stands as written.

### The alternatives that were rejected

- **The copy route** — describing the gap in the docs and in the switch's
  wording. A documented gap for a bug on every Android user is not a
  document, it is a refusal.
- **A dedicated notification worker.** A second registration at scope `/`
  replaces the share target, and a registration at a narrower scope does not
  control the pages the sweep runs on.
- **Activating ngsw.** 0019's reasons, unchanged: adopting an offline strategy
  and a second copy of the app's assets in order to raise a notification.
- **Keeping the seam synchronous** and firing `showNotification` without
  awaiting it. The key would be marked delivered on a promise that then
  rejects, and that reminder would be silent forever.

## Consequences

- **Desktop notifications go through the worker too.** A registration-raised
  notification is persistent: it outlives the page, is listed by the
  registration's `getNotifications()` until closed, and reaches the operating
  system's notification centre, where a page notification died with its tab.
- **The constructor fallback has no click behaviour at all.**
  `notificationclick` fires only for a registration-raised notification, and
  nothing sets an `onclick` on the constructed one. Preferring the registration
  is what gives the notification a click behaviour in the first place.
- **Two seams, `webPermission()` and `showWebNotification()`, are what the
  test stand-ins override.** The unit and smoke stand-ins substitute both; a
  third subclass substitutes the permission alone of the two and drives the
  real seam over a spied `getRegistration`, so the registration path, the
  constructor fallback, a rejecting registration and a throwing constructor
  are each pinned against production code.
- **The smoke suite proves the web path against the emulator:** the due bill
  through the seam, its key recorded, `schedule` never called, nothing booked
  ahead.
- **The worker's header states its two jobs.** Still no caching, no offline
  shell, no `sync` handler.
- **The driven journey raises one through the real registration by script**,
  from the reminder service's own seam, and never touches the switch
  ([../e2e.md](../e2e.md), journey 14).

## Things that only became apparent while building

- **`focusOrOpen`'s predicate was always true.** The first cut found a client
  with `'focus' in client` over a `{ type: 'window' }` `matchAll()`, whose
  every result is a `WindowClient` — so it was `clients[0]` wearing a filter.
  Worse, a rejected `focus()` — Chrome's `InvalidAccessError` when the click's
  user activation is not attributed to it — propagated out with nothing
  catching it, leaving `event.waitUntil()` holding a rejection and no window
  opening. The rejection now falls through to `openWindow('/')`, and the local
  is named `windowClients` so nothing shadows the worker global `clients`.
- **`.ready` would have failed only by timing out.** A `.ready`-based seam
  fails the spec on Jasmine's five-second timeout, which reads as flake. One
  case starts the call unawaited, turns the microtask queue twice and asserts
  `getRegistration` was already called: a forbidden implementation now fails
  in milliseconds with a message that names it.
- **The async conversion opened an interleave window that did not exist
  before.** Between `wasDelivered` and `markDelivered` there is now an await,
  and two passes run concurrently — the budget-alert effect and the bill
  sweep — so both can read a key as undelivered and raise it. Bounded to a
  duplicate notification with the same `tag`, which browsers replace rather
  than stack, and `deliverNative` has always had the same shape.
- **The seam's own comment claimed a click behaviour the fallback does not
  have.** It said the worker's `notificationclick` reaches both paths; the
  worker's header said the true, narrower thing, and the two contradicted each
  other until they were read side by side.
- **"Android and Firefox" read as desktop Firefox**, which raises the
  constructor without incident. It is Android Chrome and Firefox — both
  mobile.
- **The once-per-batch read was claimed by a case that could not tell.** A
  read counter over two due bills now asserts exactly one read.
- **The pane the journey was first driven in refuses notification
  permission.** So the OS half of journey 14 was recorded as skipped, and what
  a denied profile can still prove is the diagnostic half: the registration
  received the call with the sweep's own arguments, the constructor was never
  touched, and the seam resolved `false` on the platform's own refusal.

## Known gaps

- **Still only while the page is open.** The closed-tab half of 0092's gap
  stands: nothing wakes the worker, and a scheduled web reminder has nowhere
  to be scheduled.
- **A tap opens `/`, not the bill.** The reminder names it; the Upcoming card
  is on `/`; there is no deep link.
- **Android itself is proven on the same API in desktop Chromium.** The seam
  spec and the driven journey exercise `registration.showNotification` where
  the constructor also works; the device where it does not is a check on the
  deployed site after the merge, not something a pane reaches.
- **The constructor fallback's click is silent.** Where no registration exists
  the notification is raised and does nothing when tapped. No web session
  lacks the registration today — the share-target worker is registered on
  every boot — so the fallback is for a registration that failed.
- **A registration whose worker is still installing reads as a refusal.**
  `showWebNotification` prefers whatever `getRegistration()` returns, and on
  a device's first visit with reminders already on, the boot sweep can reach
  `registration.showNotification` while the share-target worker is still
  installing (`registration.active === null`): the call rejects, the seam
  reports `false`, the key is not marked, and the bill is raised by the next
  sweep — the next `visibilitychange` five minutes on, or the next boot. A
  first visit only: every later visit has an active registration, and the
  boot sweep waits on the account document while `install` → `skipWaiting`
  → `claim` takes milliseconds. A one-sweep delay where the old code
  delivered nothing, ever.
- **The OS notification was not seen on the first driven run**, for the
  reason above; a browser profile that grants is what the shot needs.
