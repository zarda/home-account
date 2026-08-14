# Share-sheet import

Sharing a receipt image, PDF, or CSV from another app lands it in the import
wizard, ready for the normal review flow. There are two pipelines — one per
platform — and both end at the same place: the wizard's file intake, exactly
as if the file had been dropped on the dropzone
(see [ADR 0019](ADR/0019-share-intake-lands-through-a-stash.md)).

## Web (installed PWA)

1. `public/manifest.json` declares a `share_target`: a `POST` of
   `multipart/form-data` to `/share-target`, accepting the dropzone's types
   (png/jpeg/webp, PDF, CSV).
2. **`public/share-target-sw.js` catches that POST.** Firebase Hosting
   rewrites apply only to GET/HEAD, so without a service worker the share
   would 404 before the app loads. This is the first — and only — service
   worker the app registers, and it is deliberately minimal:
   - It handles nothing but `POST /share-target`. Every other fetch passes
     through untouched; there is no caching and no offline shell. The Angular
     `ngsw` build artifacts remain unactivated and `src/service-worker.ts`
     remains dead code.
   - It has no `sync` handler. Registering any worker makes
     `PwaService.registerBackgroundSync()` start succeeding (the offline
     queue calls it), and a sync event with no handler is inert on purpose.
3. The worker stashes the files into IndexedDB (`homeaccount-share-intake` /
   `pending` — schema duplicated in `ShareStashStore`, which the worker
   cannot import; the two must ship together, since a worker pinned at an
   older version than the database cannot open it) and answers with a `303`
   redirect to `/import/file?source=share`. Each row is stamped with the
   signed-in account, read from the `session` store the app publishes on
   every auth change; with nobody signed in the row is written ownerless.
4. The wizard, arriving with `?source=share`, drains the stash through
   `ShareIntakeService.consumeAll()` and hands the files to its normal
   intake. Files that are oversized (>10 MB), empty, or of an unaccepted
   type are dropped at this gate.

## Who a stashed share belongs to

The stash is one device-global database, so every read is scoped to the
session (ADR 0039, mirroring the offline queue's #164 fix): a row stamped
with another account's uid is invisible — it stays put for its owner — and
`consume()` deletes exactly the rows it returned. **An ownerless share is
claimable by the next session to sign in only while it is fresher than 30
minutes** (`SHARE_CLAIM_WINDOW_MS`); past that it is deleted unconsumed.
Ownerless rows are a fact of both pipelines, not an error: the service
worker and the iOS extension cannot see auth state, so a share made while
signed out (web) and every iOS share arrives without an owner. The window
keeps the ordinary share-then-sign-in flow working while bounding what a
shared device can disclose.

A share can arrive while nobody is signed in — the wizard route is
auth-guarded, so `ShareIntakeService` also watches the session: whenever a
user signs in (or the app starts signed in) with a visible stash, it
navigates to the wizard. Within the claim window nothing is lost in
between; the account-deletion cascade's `shareStash` step erases the whole
stash, both pipelines, as device-scoped cleanup.

## iOS (Share Extension)

WKWebView has no service workers, so iOS gets a native pipeline:

1. The **ShareExtension** target (`ios/App/ShareExtension/`) appears in the
   system share sheet for images and files (up to 10). It copies each
   accepted attachment into the App Group container
   (`group.com.homeaccount.app/SharedImports/`) as a `<uuid>.payload` blob
   plus a `<uuid>.json` sidecar (`{name, mimeType, payload, receivedAt}`),
   shows "Saved — open Home Account", and dismisses. The MIME type is the
   **delivered file's concrete type** — the matched accepted type is
   abstract (`public.image` declares no MIME at all), which is how every
   shared photo once arrived as `application/octet-stream`. `.jpeg` leads
   the accepted types so the provider transcodes what it can: an iPhone
   camera HEIC arrives as JPEG.
   The host app is **not** auto-opened: the responder-chain `openURL`
   workaround is private-API-adjacent and an App Review risk, so the
   handoff is passive.
2. **`ShareIntakePlugin`** (`ios/App/App/Plugins/ShareIntakePlugin.swift`,
   registered manually in `MainViewController.capacitorDidLoad` like every
   app-target plugin) counts the folder and emits `pendingSharesChanged`
   on every app activation — the first moment a share made in another app
   can be noticed. Consumption is two-step: `consumePendingShares` hands
   the files over **without deleting**, and the web layer names what it is
   done with to `completePendingShares` — so a share nobody may claim yet
   is not destroyed on the way past, and a failed handoff re-offers the
   same files next activation instead of losing them.
3. `ShareIntakeService` listens, navigates to the wizard, and
   `consumeAll()` decodes the base64 payloads back into `File`s — claiming
   only shares inside the 30-minute window above (iOS shares are always
   ownerless; the extension runs in another process and cannot see the
   session). Same gate, same review flow.

The App Group id, folder name, and sidecar shape are duplicated between the
two Swift files — the extension and the app share no code. Change them
together.

## Verifying changes

The stash store, the intake service, and the wizard handoff are unit-tested
(`share-stash.store.spec.ts` runs against the browser's real IndexedDB).
**The service worker's POST path itself has no automated test** — Karma
cannot install a share target — so after touching it, verify by hand:

1. `npm run build:prod`, serve `dist/home-account/browser` over HTTPS or
   localhost, and install the PWA in Chrome.
2. Share an image to "Home Account" from another app (or use Chrome's
   share-target testing in devtools).
3. The browser opens `/import/file?source=share` and the wizard lists the
   file.

For iOS: build in Xcode, share a photo from Photos to Home Account, open
the app, and the wizard should offer the file. **After any local Xcode
build, revert `ios/App/App/Info.plist`** — a build phase injects the
gitignored Google client id into it.

## Known gaps

- No automated coverage for the worker's POST handling (kept minimal for
  exactly that reason) or for the extension (CI never builds iOS).
- Android native share intents are out of scope; the installed PWA's
  `share_target` covers Android Chrome.
- The extension accepts what the share sheet offers as images/files; the
  10 MB/type gate is applied at consumption, not in the extension. A raw
  HEIC shared from the Files app (no JPEG representation requested) is
  stashed as `image/heic`, rejected at that gate, and completed — only
  Photos-style shares transcode.
- The worker and the stash schema are version-locked: a stale cached
  worker still pinned at v1 cannot open the v2 database, and that share is
  lost with the `error=1` redirect. The window lasts until the browser
  re-fetches the worker, roughly one navigation.
