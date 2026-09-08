# 105. The cache-size card is removed, and the dead worker with it

**Status:** Accepted, implemented · **Date:** 2026-09-08 · **Issues:** #377

No reference document owns this. The one worker the app registers is
described in [../share-import.md](../share-import.md), and it is not the one
removed here.

Applies [0048](0048-a-dead-capability-is-removed-not-guarded.md) and
[0097](0097-the-model-update-signal-is-removed-not-wired.md) to the last slice
of `src/service-worker.ts`: 0097 cut the `CHECK_MODEL_UPDATES` pair out of
that file and recorded the rule this record reuses, and this is the rest of
the file.

## Context

The AI settings page's Storage card rendered *Total Cache* as
`formatBytes(cacheSize())`, beside a Platform row that is live. `cacheSize`
read `PwaService.cacheSize()`, a signal only a `CACHE_SIZE` service-worker
message ever wrote, and the only thing that would post one was
`src/service-worker.ts` — a file nothing registers and nothing builds.
`angular.json` has no entry for it; it was type-checked through the `tsconfig`
globs and linted, and that is all it ever was. So the row read *0 Bytes* on
every device, for as long as it existed.

Around it sat the rest of the plumbing: `getCacheSize`, `clearModelCache` and
`cacheModels` on `PwaService`, which posted `GET_CACHE_SIZE`,
`CLEAR_MODEL_CACHE` and `CACHE_MODELS` to a controller that never existed and
had no callers of their own; and `formatBytes`, whose one caller was the row.
README's platform table said *Offline: Service Worker* and its tech-stack table
*PWA: Service Worker, IndexedDB* — a caching worker the app has never run.

0097 had already cut the `CHECK_MODEL_UPDATES` pair out of the same file and
stated the rule: a path that is neither wired nor deleted is half-present, and
half-present is the bug — it reads like a working feature to anyone who greps
for it. The card was that rule's other face: a working *figure* that described
nothing.

## Decision

**The row, the signal, the three post methods, `formatBytes` and the file go;
`SYNC_OFFLINE_QUEUE` stays.**

### The whole plumbing, not the row

Removing the row alone would have left a signal nobody reads, three methods
nobody calls and a message type with a case and no sender — 0048's half-present
shape, one layer down. `CacheSize`, `_cacheSize`, `cacheSize`, the `CACHE_SIZE`
case, the three methods and `formatBytes` go together, and `aiPage.totalCache`
leaves all three catalogs. The Platform row stays: it is live, from
`AiStrategyService`.

### The file whole

After the removal its remaining messages — `SKIP_WAITING`, `CACHE_MODELS`,
`CLEAR_MODEL_CACHE`, `GET_CACHE_SIZE` — have no sender, and its `sync` handler
never ran: the only registered worker has no `sync` handler by design (0019).
Nothing names the file outside prose — not `angular.json`, `tsconfig*.json`,
`firebase.json`, `ngsw-config.json` or any script — and the mentions in 0019
and 0097 are history and stand as written. The only `service-worker` strings
left under `src/` are the two `@angular/service-worker` package imports.

### `SYNC_OFFLINE_QUEUE` stays, for 0097's reason

`OfflineQueueService` listens for the `sync-offline-queue` window event that
case re-dispatches, so something is on the other end — the distinction 0097
turned on. It is now the one message with a listener and no sender: the deleted
file's `sync` handler was the only thing that ever posted it.
`registerBackgroundSync('sync-offline-queue')` still registers the tag a
worker's `sync` handler would answer, so the listener waits on a producer that
has been declared and not built.

### The alternatives that were rejected

- **`navigator.storage.estimate()` in the row.** A real number with nothing to
  act on: it counts the offline queue's IndexedDB and Firestore's persistence,
  not any model cache — none exists since #19 (0097) — and no control on the
  page changes it.
- **Keeping the file as a template.** A template is what it had been for its
  whole life, and it was cited in an issue as evidence the capability existed.
  0019's order holds: a job first, then a worker.
- **Wiring the card to the share-target worker.** That worker caches nothing;
  there is no size to report.
- **Guarding the row** behind "when a worker is registered". A registered
  worker exists — the share target — so the guard would have shown the row and
  its zero.

## Consequences

- **README's Offline and PWA rows describe what runs:** the offline queue in
  IndexedDB, and the share-target worker — share intake and, since
  [0104](0104-a-web-reminder-is-raised-through-the-worker-the-app-already-registers.md),
  reminder notifications. No caching worker on any platform.
- **README's *PWA Support* prose and receipt-import.md's drain sentence
  describe what runs** — an offline queue, no offline shell, no sync event.
- **`ngsw-config.json` is untouched.** The `production` configuration still
  builds the Angular worker's artifacts and nothing calls
  `provideServiceWorker`; its spec pins that no cache group would route
  analytics, a property that is free while nothing registers that worker and
  worth keeping free.
- **The rest of `PwaService`'s never-true surface is left for a record of its
  own:** `isInstallable`, `updateAvailable`, `serviceWorkerReady`,
  `showIOSInstallInstructions`, `promptInstall`, `applyUpdate` and the
  `SwUpdate`/`checkForUpdates` path, none consumed, and `swUpdate.isEnabled`
  always false with no ngsw registered.
- **What a future worker would need:** a job first — a caching strategy the
  app has decided it wants, with a consumer for its messages — and then a file,
  written against listeners that already exist. The reverse order produced
  this record and 0097's.
- **The Storage card is one row.** A card with one live row is thin, and it
  stays because the row is true.

## Things that only became apparent while building

- **The spec case for the removed message passes against unmodified code, and
  it is kept anyway.** *ignores CACHE_SIZE messages* asserts the handler
  neither throws nor dispatches a window event. 0097's sibling case genuinely
  inverted a prior assertion — that branch had dispatched an event — while the
  old `CACHE_SIZE` branch only set a private signal, so the handler's
  observable behaviour is identical before and after, and the case passed
  31/31 on the unmodified service. It stays, knowingly: it documents at the
  switch that `CACHE_SIZE` is an unhandled type now, which is the shape this
  record describes, and the real RED for the removal was the compiler's — the
  service's own spec imported `CacheSize` and named every deleted member.
- **`.storage-icon` decorates three cards**, not one: the category-memory
  card, the tag-memory card and the Storage card. A selector on the icon would
  have asserted against the first of them in silence; the spec finds the
  Storage card by its title text.
- **`grep -rn totalCache src/` is not empty after the removal.** The one hit
  is the spec's own negative assertion that the key is no longer rendered.
- **`aiPage.totalCache` had one use and three catalog entries**, and
  `i18n:check` does not flag an orphaned key; the removal was checked by grep.

## Known gaps

- **The install and update surface is still half-present**, as above.
- **`SYNC_OFFLINE_QUEUE` waits on a producer nobody has scheduled.** If the
  drain on reconnect is judged enough, the case and `registerBackgroundSync`
  are the next 0048 removal.
