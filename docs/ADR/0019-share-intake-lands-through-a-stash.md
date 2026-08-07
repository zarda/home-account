# 19. Share intake lands through a stash

**Status:** Accepted, implemented · **Date:** 2026-08-07 · **Issues:** #78

Reference documentation lives in [../share-import.md](../share-import.md).

## Context

Receipts shared from other apps had no way in — users had to open the app
and re-pick the file. The web manifest's `share_target` is the standard
answer, but a file-carrying share target must POST, Firebase Hosting
rewrites serve only GET/HEAD, and this app had **never registered a service
worker**: the ngsw artifacts are built and deliberately unactivated, and a
321-line hand-written worker sits dead in `src/service-worker.ts`. On iOS
there is no worker to register at all — WKWebView has no service-worker
support — and no extension target, no entitlements file, and no App Group
existed in the Xcode project.

## Decision

**A dedicated, minimal worker rather than activating what was lying
around.** `public/share-target-sw.js` handles exactly one thing — `POST
/share-target` — and passes every other fetch through. Activating the dead
`service-worker.ts` (a full caching layer) or wiring ngsw would have turned
"receive a share" into "adopt an offline strategy", changing every page
load to get one POST handled. Rejected likewise: a GET share target (cannot
carry files) and a Hosting function (no backend in this project).

**Files travel by stash, not by navigation state.** The worker writes the
files into its own IndexedDB database and redirects; the wizard reads them
back on arrival. A redirect cannot carry blobs, and `history.state` (how
camera capture hands results over) does not survive the browser opening a
fresh window for a share. The stash also buys the signed-out case for
free: the wizard route is auth-guarded, so `ShareIntakeService` waits for
a session and navigates when one exists — the stash persists in between.

**iOS hands off through the App Group, and the app is not auto-opened.**
The Share Extension writes payload+sidecar pairs into
`group.com.homeaccount.app/SharedImports/`; a Capacitor plugin drains the
folder and pings the web layer on every app activation. The
responder-chain `openURL` trick that would jump straight into the app is
private-API-adjacent and a known App Review hazard — a passive "Saved —
open Home Account" is the accepted trade.

**Both pipelines end at the wizard's ordinary intake.** Shared files get
the same review step, the same dropzone gate (type and 10 MB), and the
same `receipt_import` reporting as picked files. Rejected: feeding shares
straight into the offline queue, whose drain deliberately has no review
step (ADR 0015) — silent imports are for reconnects, not for a user
actively handing the app a file.

## Consequences

- Registering any worker makes `PwaService.registerBackgroundSync()`
  succeed for the first time. The worker has no `sync` handler on purpose;
  the events are inert.
- The worker cannot import TypeScript, so the stash schema lives twice
  (`share-target-sw.js`, `ShareStashStore`) with cross-pointing comments.
  Same for the App Group constants in the two Swift targets.
- The Xcode project gains its first extension target, its first
  entitlements files, and an App Group on both targets — added by hand in
  the pbxproj, following the same synthetic-id convention the app-target
  plugins already use.

## Known gaps

- The worker's POST path has no automated test (Karma cannot install a
  share target); it is kept minimal for exactly that reason and the manual
  procedure is documented. The consuming side is fully unit-tested.
- The extension is verified only by local builds — CI never builds iOS.
- Android native intents are out of scope; installed-PWA Chrome uses the
  web pipeline.
