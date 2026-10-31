# Share-sheet import

Sharing a receipt image, PDF, or CSV from another app lands it on the import
wizard's upload area, with its row and its preview, ready for the normal
review flow; a shared file the app will not take is named there instead.
There are two pipelines — one per platform — and both end at the same place:
the dropzone's own list, through the dropzone's own gate, exactly as if the
file had been dropped on it
(see [ADR 0019](ADR/0019-share-intake-lands-through-a-stash.md) and
[ADR 0186](ADR/0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)).

## Web (installed PWA)

1. `public/manifest.json` declares a `share_target`: a `POST` of
   `multipart/form-data` to `/share-target`, accepting the dropzone's types
   (png/jpeg/webp, PDF, CSV).
2. **`public/share-target-sw.js` catches that POST.** Firebase Hosting
   rewrites apply only to GET/HEAD, so without a service worker the share
   would 404 before the app loads. This is the first — and only — service
   worker the app registers, and it has two jobs and no more:
   - It handles `POST /share-target`, and it raises the app's reminders:
     `ReminderService` calls this registration's `showNotification` once its
     worker is active, because Android Chrome and Firefox refuse the page's
     `Notification` constructor and a second worker registered at the same
     scope would replace this one
     ([ADR 0104](ADR/0104-a-web-reminder-is-raised-through-the-worker-the-app-already-registers.md)).
     Its `notificationclick` handler reads the route the reminder carries in
     `data.route`, admitting it only through a copy of the app's
     `safeAppRoute` and falling back to `/`. It focuses the first open tab
     and posts it `{ type: 'notification-route', route }`, which the page's
     `NotificationTapService` opens with the router; with no open tab, or
     when `focus()` is refused, it opens a new one at the route
     ([reminders.md](reminders.md#where-a-tap-lands),
     [ADR 0167](ADR/0167-a-notification-carries-its-route-and-a-tap-lands-on-it-and-the-recap-nudge-needs-a-week-with-news.md)).
     It never navigates an open tab itself, which would reload the app.
   - Every other fetch passes through untouched; there is no caching and no
     offline shell. The build emits no other worker. The Angular `ngsw` one
     was built for production and never registered, and registering it at
     `/` would have replaced this one, so it is gone
     ([ADR 0170](ADR/0170-the-animations-runtime-the-unregistered-worker-and-nine-dead-items-come-out.md)).
     So is the hand-written caching worker that once sat dead in `src/`
     ([ADR 0105](ADR/0105-the-cache-size-card-is-removed-and-the-dead-worker-with-it.md)).
   - It has no `sync` handler, and the app registers no sync tag. The
     offline queue drains on the browser's `online` event and on **Sync
     Now**, never on a worker wake-up
     ([receipt-import.md](receipt-import.md#offline-capture-and-the-queue)).
3. The worker stashes the files into IndexedDB (`homeaccount-share-intake` /
   `pending` — schema duplicated in `ShareStashStore`, which the worker
   cannot import; the two must ship together, since a worker pinned at an
   older version than the database cannot open it) and answers with a `303`
   redirect to `/import/file?source=share`. When it could not read the
   POST or stash its files, it adds `&error=1`. Each row is stamped with the
   signed-in account, read from the `session` store the app publishes on
   every auth change; with nobody signed in the row is written ownerless.
4. The wizard, arriving with `?source=share`, drains the stash through
   `ShareIntakeService.consumeAll()`, which clears it and hands back the
   files the share gate accepts and the ones it refuses, each with its
   reason. `shareRefusal` asks, in order: larger than
   `IMPORT_FILE_MAX_BYTES` (10 MB); a JSON backup, by its type or its
   extension; neither an accepted type nor an accepted extension; no bytes.
   Size before type is the dropzone's own order, so a file both gates
   refuse gets the reason the dropzone would give. A share past the claim
   window (below) is in neither list.
   - **The accepted files land on the upload area.** The dropzone's
     `adopt()` puts each through the same gate, row, preview and banner as
     its own pick, takes a file already listed, or repeated in the batch,
     once, and emits nothing. The wizard then writes its selection from the
     dropzone's whole list, so a later pick or remove keeps the shared file,
     and a file picked while the stash was read stays.
   - **Two files of one name each keep their own row and preview**, as two
     photos from an iPhone, both `image.jpg`, must. The dropzone keys its
     rows and previews by the file, and the wizard its tiles by the
     preview's URL, never by a name. `npm run lint` fails a template `@for`
     that tracks by `.name`, and `lint-guards:check` holds that rule with
     fixtures of its own
     ([ADR 0186](ADR/0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)).
   - **The refused are named in the dropzone's own alert**, one sentence a
     file, after any refusal the user's own pick left standing there:
     *{name} is larger than the 10 MB limit*, *{name} is a backup: pick it
     here to import it*, *{name} is not a supported file type* and *{name}
     is empty*. A backup has a sentence of its own, sending the reader to
     the upload area, which takes one: *not a supported file type* would
     give the wrong reason.
   - The wizard's dropzone reads the same constant, so a file is held to
     one ceiling whichever way it arrives. It bounds the original. A receipt
     photo's stored copy has its own 2 MB ceiling, `MAX_RECEIPT_BYTES`, met
     by compression on upload and mirrored in `storage.rules`
     ([ADR 0171](ADR/0171-second-copies-fold-into-one-copy-of-each-helper.md)).
5. **The wizard takes both flags off its URL as it reads them**, so a
   reload or Back does not enter the share path again. Its own
   `stripShareParams` navigates with `replaceUrl`, keeping every other
   param, in the shape
   [ADR 0082](ADR/0082-one-shot-query-params-leave-the-url-once-consumed.md)
   gave the transactions page. It listens to its query params rather than
   reading them once: on iOS a share made while the wizard is open
   navigates to the same route with new params, and the router reuses the
   wizard. Drains run one at a time, so a queued one reads the stash the one
   before it emptied, and a drain that throws is handed to the
   `ErrorHandler`, so the next share still drains.
   - With `error=1` it says the share was lost (`import.shareLost`: *The
     shared files couldn't be received. Share them again to import them.*)
     and still drains the stash, since an earlier share may be waiting.
   - A stash it cannot read raises the same notice, and a visit that has
     already said it does not say it twice
     ([ADR 0165](ADR/0165-the-period-pickers-are-bounded-unavailable-totals-offer-retry-and-three-smaller-papercuts-close.md)).
   - A file the gate refused is not a lost share: it arrived, and the
     upload area's alert names it. The lost-share notice is for a share
     that never did, and no snackbar repeats a refusal.
   - While a run is under way, an import is being written or the review
     holds rows, the wizard strips the flags and does not drain: a change
     of selection empties the rows, so a drain would reset the run. The
     share stays where it was staged — the web stash is not consumed, the
     iOS folder not completed — for a later drain (see Known gaps).
   - While the stash is read, **Process with AI** waits, as it does on a
     run: the guard above is read before the stash answers, so a run
     started then would read a selection the drain is about to change, and
     the drain would empty the rows the run had appended. The error card's
     **Try again** waits too: pressed then, it would clear the error and
     start nothing, and the card would claim nothing was found.
   - A share drained while a run's own card stands (an error, photos queued
     for later, nothing found) sends the stepper back to the upload step,
     where the file or its refusal is, so neither a card's **Done** nor the
     error card's **Go to settings** leaves the wizard over a share nobody
     saw.

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
   session) — and sorts them through the same gate. Same upload area, same
   refusals named in its alert, same review flow.

The App Group id, folder name, and sidecar shape are duplicated between the
two Swift files — the extension and the app share no code. Change them
together.

## Verifying changes

The stash store, the intake service, and the wizard handoff are unit-tested
(`share-stash.store.spec.ts` runs against the browser's real IndexedDB).
The handoff to the upload area is driven through the wizard's rendering
describe with the real dropzone (*a shared file, on the zone*, in
`import-wizard.component.spec.ts`). `import-wizard.smoke.spec.ts` drains a
real IndexedDB stash through the real router: one case puts a stashed share
on the dropzone and in the selection and names the ones the gate refused,
and the next drains a second share into the wizard already open, beside the
first. Journey 109 in [e2e.md](e2e.md) drives the same in a browser, from a
stash written in the worker's row shape.
The Swift half — the extension's sidecar writer, the App Group store behind
the plugin, and the OCR data-URL strip — is covered by
`npm run test:ios` (`ios/App/AppTests/ShareSeamsTests.swift`, run in the
iOS Simulator; local only, CI never builds iOS — see ADR 0040).
**The service worker's POST path is tested only in part.**
`share-target-sw.spec.ts` runs the real worker script against a fake `self`:
it pins that a share whose form cannot be read is sent to the wizard with
`error=1`, and that a request to an analytics host, by GET or POST, is left
to the network. The stash into IndexedDB and the redirect on a good share
are not covered — Karma cannot install a share target — so after touching
them, verify by hand:

1. `npm run build:prod`, serve `dist/home-account/browser` over HTTPS or
   localhost, and install the PWA in Chrome.
2. Share an image to "Home Account" from another app (or use Chrome's
   share-target testing in devtools).
3. The browser opens `/import/file?source=share`, the upload area lists the
   file with its row and preview, **Process with AI** is enabled, and the
   address settles on `/import/file`.
4. Share an empty CSV, and the upload area's alert says *{name} is empty*,
   with no row for it.

For iOS: build in Xcode, share a photo from Photos to Home Account, open
the app, and the upload area should list the file with its preview; share
a second photo with the wizard still open, switch back, and it should join
the list. **After any local Xcode build, revert `ios/App/App/Info.plist`**
— a build phase injects the gitignored Google client id into it.

## Known gaps

- The worker's POST handling is covered only where the share's form cannot
  be read (`error=1`) and where an analytics beacon is left to the network;
  the stash and the redirect on a good share are verified by hand (and kept
  minimal for exactly that reason). The extension's sidecar writer and the
  plugin's store are XCTested (`npm run test:ios`), but nothing enforces
  that suite — CI never builds iOS — and the provider loop ahead of the
  writer is still manual-only. No browser journey drives the POST or the
  iOS extension and plugin lane either: journey 109 writes the stash in the
  worker's row shape and drives everything after it.
- Android native share intents are out of scope; the installed PWA's
  `share_target` covers Android Chrome.
- The extension accepts what the share sheet offers as images/files; the
  size and type gate (`IMPORT_FILE_MAX_BYTES`, 10 MB) is applied at
  consumption, not in the extension. A raw HEIC shared from the Files app
  (no JPEG representation requested) is stashed as `image/heic`, refused at
  that gate for its type, named in the upload area's alert, and completed —
  only Photos-style shares transcode, and neither gate takes HEIC.
- The share gate is stricter than the dropzone. A backup is refused at the
  share door by design, and its sentence sends the reader to pick it in the
  upload area. A CSV typed `application/vnd.ms-excel` with no `.csv`
  extension is refused there too, for its type, though a pick would take
  it.
- A share that waits is not said. One the busy guard defers (step 5) is
  stripped from the URL with nothing said, and drains on the next
  navigation that carries the flag: a later share, the next load, whose
  sign-in effect counts the stash and sends it there, or on iOS the next
  activation. A plain visit to the upload step does not drain it. A share
  with no owner on it — every iOS share, and a web share made signed out —
  can outlive the 30-minute claim window while it waits, and is then
  dropped unread.
- A share drained while the wizard is leaving is consumed and not
  imported: the dropzone takes nothing once it is destroyed, and the stash
  is already cleared.
- The worker and the stash schema are version-locked: a stale cached
  worker still pinned at v1 cannot open the v2 database, and that share is
  lost. The worker redirects with `error=1`, and the wizard says the share
  was lost and asks for it again; the files themselves cannot be recovered.
  The window lasts until the browser re-fetches the worker, roughly one
  navigation.
- The lost-share notice can be dropped. This is read from the code, not
  driven. On a cold load, `ShareIntakeService`'s sign-in effect counts the
  stash and navigates to `/import/file?source=share` when it holds rows.
  That count can resolve after the wizard has drained the stash and
  stripped its URL. The flag no longer comes back: the late navigation
  reaches a wizard that listens to its query params, which strips the flag
  again and drains the emptied stash, one drain at a time
  ([ADR 0186](ADR/0186-a-date-stops-at-a-currency-sign-and-a-line-break-a-total-read-past-an-aside-or-under-a-count-is-flagged-and-a-shared-file-lands-in-the-upload-area.md)).
  But the same navigation passes no `queryParamsHandling`, so when it
  replaces the worker's redirect it drops `error=1`, and a share lost beside
  an earlier one still waiting brings no notice.
