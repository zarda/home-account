# The PWA layer

`PwaService` (`core/services/pwa.service.ts`, root) is the app's one view of
the browser around it: whether the connection actually carries traffic,
whether the app is running installed, whether the device is iOS, and the
browser's install prompt. It reads nothing the service worker posts and asks
the worker for nothing. This document owns the service. The worker itself,
and the share target it exists for, are in [share-import.md](share-import.md);
what reminders raise through it is in [reminders.md](reminders.md).

Why the surface is only what something calls is in
[ADR 0112](ADR/0112-pwaservice-keeps-only-the-surface-something-calls.md).
Why the install prompt is held, never suppressed, and offered from About is
in
[ADR 0168](ADR/0168-the-palette-lists-the-shortcuts-and-the-header-opens-it-and-about-offers-to-install-the-app.md),
which amends it. Why there is no background sync, and no Angular service
worker, is in
[ADR 0170](ADR/0170-the-animations-runtime-the-unregistered-worker-and-nine-dead-items-come-out.md),
which amends it again.

## The surface

| Member | What it answers | Read by |
|---|---|---|
| `isOnline` | Whether the connection carries traffic, not only whether the device has a network interface | Every caller that queues, defers or refuses work offline: the offline queue, the camera capture, the import and AI services, the households, the exchange-rate retry and more |
| `refreshOnlineStatus()` | Probes now, and resolves to the answer | The service itself, on `online`, on a return to the tab and on its own retry; a caller about to do something expensive may await it first |
| `isStandalone` | Whether the app is running installed | The camera capture, About |
| `isIOS` | Whether the device is an iPhone, iPod or iPad, iPadOS included | The camera capture, About |
| `canPromptInstall` | Whether the browser has handed over an install prompt not yet spent | About |
| `promptInstall()` | Raises that prompt, once | About |

A member joins this table when something calls it, and leaves when nothing
does (ADR 0112). The `createSpyObj('PwaService', …)` stubs in the specs name
only these.

## Reachability

`navigator.onLine` only says the device has a network interface. Behind a
hotel portal, or on a connection throttled to nothing, it stays true, so
`isOnline` confirms it with a probe.

- **The probe** is a `HEAD` request for `favicon.ico?_probe={timestamp}`,
  with `cache: 'no-store'` and `redirect: 'manual'`, given 4 seconds. Any
  real answer counts as reachable, whatever its status; an opaque redirect
  (a portal sending the browser to its sign-in page), a refusal or the
  timeout counts as unreachable. No service worker answers a `HEAD` from a
  cache, and the timestamp gets past the transparent proxies hotel networks
  run, which ignore `no-store`.
- **Going online is believed at once and then confirmed.** The `online`
  event sets `isOnline` true and starts a probe, so a probe that cannot
  work in some environment can never hold the app offline past the next
  reconnect.
- **The probe can only demote.** When `navigator.onLine` is false there is
  nothing to verify, and no probe runs.
- **Returning to the tab re-probes** (`visibilitychange` to visible), since a
  portal starts or stops swallowing traffic while the app is in the
  background and no event says so.
- **One probe at a time.** Callers asking together share one request.
- **While the probe alone says offline**, it retries on a backoff from 5 to
  60 seconds, and stops once anything says online. No timer runs while the
  connection is healthy.

## Running installed

`isStandalone` is decided once, when the service is built:

1. **The native app** is installed by definition. Its WKWebView fails every
   check below, so it is named first.
2. **`(display-mode: standalone)`** matches an installed web app launched in
   a window of its own, as the manifest's `display` asks.
3. **`navigator.standalone === true`** is iOS Safari's own flag for a Home
   Screen app.
4. **A referrer containing `android-app://`** is an Android app hosting the
   site.

`appinstalled` is the one moment it changes without a reload: the browser
says the app was just installed, and `isStandalone` turns true.

## iOS

`isIOS` is true when the user agent names an iPhone, iPod or iPad, or names
a Macintosh while `navigator.maxTouchPoints > 1`. The second arm is iPadOS
Safari, which asks for the desktop site and so reads as a Mac. No Mac
reports touch points.

The camera capture shows its Home Screen hint for `isIOS() &&
!isStandalone()`, and About lists the Home Screen steps for `isIOS()`
(below).

## The install prompt

Chromium browsers fire `beforeinstallprompt` when the app meets their
install criteria. The manifest is `public/manifest.json` (`display:
standalone`, `start_url: /`).

- **The event is held, never `preventDefault()`ed.** `preventDefault` would
  hide the browser's own install UI on every visit, and the app offers the
  prompt in one place only. In the native app the listener is not attached.
- **`canPromptInstall`** is true while an event is held.
- **`promptInstall()`** lets the event go before it prompts, because an event
  prompts once and the browser sends a new one when it is willing to ask
  again. It calls `prompt()` before any await, because `prompt()` needs the
  click's user activation. It never rejects: a refused prompt is logged with
  `console.warn` and the event is still spent.
- **`appinstalled`** clears the held event along with marking the app
  standalone.

### The About card

`AboutComponent.installOffer` picks one state, in this order:

| When | The card |
|---|---|
| The native app, or `isStandalone()` | None |
| `canPromptInstall()` | *Install the app*, `about.install.promptDescription`, and an **Install** button that raises the held prompt |
| `isIOS()` | *Install the app*, `about.install.iosDescription`, and three steps in order: Share (in Safari's toolbar or under the ⋯ menu), Add to Home Screen, Add. No button |
| Otherwise | None: Firefox, desktop Safari, and a Chromium browser that has not handed one over |

The native app is named as well as `isStandalone()`, though the service
already reports it standalone, because a store build must never carry a web
install offer. The card sits between the welcome card and the feedback card
and is styled by the welcome card's classes; its list keeps its numbers,
which Tailwind's preflight would otherwise strip.

**Install** moves focus to the feedback card's button and then raises the
prompt. `promptInstall()` spends the event in the click's own task, so the
card, and the button with focus, leave on the next render; moving focus
first keeps a keyboard user where Tab would have taken them, and does not
spend the user activation `prompt()` needs.

## No background sync, and no messages from the worker

The service registers no `message` listener on `navigator.serviceWorker`.
The worker's one message, `notification-route`, belongs to
`NotificationTapService` ([reminders.md](reminders.md#where-a-tap-lands)).

There is no background sync. The share-target worker has no `sync` handler
([share-import.md](share-import.md)), so the `sync-offline-queue` tag the
service used to register was never answered, and the `SYNC_OFFLINE_QUEUE`
message it used to re-dispatch as a window event was never posted. Both
went (ADR 0170). The offline queue drains on the browser's `online` event
and on **Sync Now** on the AI settings page
([receipt-import.md](receipt-import.md#offline-capture-and-the-queue)).

## Verifying it

- `pwa.service.spec.ts`: the online state and the reachability probe,
  standalone and the native app, the worker's channel ("registers no message
  listener on the service worker container", "has no background-sync
  registration"), the install prompt ("captures beforeinstallprompt without
  preventDefault, so the browser keeps its own install UI", "prompts once,
  then has nothing left to offer", "never offers it on native"), and iPadOS
  ("counts a Mac user agent with touch points as iOS: an iPad", with a Mac
  without them as the pin).
- `about.component.spec.ts`, describe `install card`, renders the real
  template: each state, the card leaving once the prompt is spent, the focus
  hand-off, and an axe pass over both visible states in both schemes.
- In the browser, the card was driven with a dispatched
  `beforeinstallprompt` carrying a stubbed `prompt()`: one prompt, the card
  gone, focus on the feedback button.

## Known gaps

- **Whether Chrome raises its dialog for a held event was not seen.** The
  browser the run used is embedded and has no install UI, so only the wiring
  was proved.
- **Firefox and desktop Safari get no card.** Neither hands over a prompt,
  and neither is iOS.
- **The iOS steps name Safari.** Another browser on iOS also reports an
  iPhone or iPad and gets the same steps.
- **The iOS branch is proven by unit specs only.** The browser run cannot
  present an iOS user agent with touch points.
- **A prompt fired before the service exists is missed.** The listener is
  attached when the service is first built, during app initialisation.
  Chrome fires `beforeinstallprompt` after the page loads, so this is
  unlikely.
- **Nothing probes at startup.** `isOnline` starts as `navigator.onLine`, and
  the first probe runs on an `online` event or a return to the tab, so a
  launch behind a portal reads online until then.
- **In the native app the probe only confirms.** It fetches a path relative
  to the page, which the app's bundled web server answers whatever the radio
  is doing, so there `isOnline` follows `navigator.onLine`.
