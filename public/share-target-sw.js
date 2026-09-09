// Share-target intake worker.
//
// Its first job is to catch the POST the manifest's share_target sends,
// stash the shared files into IndexedDB, and bounce the browser to the
// import wizard. Firebase Hosting rewrites do not apply to POST, so without
// this worker the share would 404 before the app ever loads.
//
// Its second job is raising the app's reminders. Android Chrome and Firefox
// refuse `new Notification()` with a `TypeError` at construction — only a
// registration's `showNotification()` reaches the user there — and this
// worker is already registered at scope `/` on every non-native session, so
// ReminderService reuses it rather than opening a second one; a `register()`
// at the same scope would replace this one instead of adding to it. The
// click handler below is what a page-raised notification's default click
// behaviour used to be, restated here because a worker-raised one gets none:
// focus an open tab, or open one at `/`, where the Upcoming card is. No
// `notificationclose`, no `data`, no deep link — the reminder already names
// the bill.
//
// Every other request passes through untouched: no caching, no offline
// shell, and deliberately no `sync` handler — registering any worker makes
// PwaService.registerBackgroundSync() start succeeding, and a sync event
// with no handler here is inert by design.
//
// The DB name, store names, version, and row shape are duplicated in
// src/app/core/services/share-stash.store.ts, which a worker cannot
// import. Change them together — a worker pinned at an older version than
// the database cannot open it, and that share is lost with error=1.

const SHARE_STASH_DB = 'homeaccount-share-intake';
const SHARE_STASH_STORE = 'pending';
const SHARE_STASH_SESSION_STORE = 'session';
const SHARE_STASH_VERSION = 2;
const SHARE_TARGET_PATH = '/share-target';
const WIZARD_URL = '/import/file?source=share';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== SHARE_TARGET_PATH) {
    return; // passthrough: the network serves everything else
  }
  event.respondWith(handleShare(event.request));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(focusOrOpen());
});

async function focusOrOpen() {
  // matchAll({ type: 'window' }) returns only WindowClients, and every one
  // exposes focus() — there is nothing to filter on, so this is
  // windowClients[0].
  const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const target = windowClients[0];
  if (target) {
    try {
      return await target.focus();
    } catch {
      // focus() rejects when the click's user activation isn't attributed to
      // it (Chrome: InvalidAccessError) — fall through instead of leaving
      // event.waitUntil() holding a rejected promise and no window opening.
    }
  }
  return self.clients.openWindow('/');
}

async function handleShare(request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files').filter((entry) => entry instanceof File);
    await stashFiles(files);
    return Response.redirect(WIZARD_URL, 303);
  } catch {
    return Response.redirect(WIZARD_URL + '&error=1', 303);
  }
}

function openStash() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(SHARE_STASH_DB, SHARE_STASH_VERSION);
    open.onupgradeneeded = (event) => {
      const db = open.result;
      if (!db.objectStoreNames.contains(SHARE_STASH_STORE)) {
        db.createObjectStore(SHARE_STASH_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SHARE_STASH_SESSION_STORE)) {
        db.createObjectStore(SHARE_STASH_SESSION_STORE, { keyPath: 'id' });
      }
      if (event.oldVersion > 0 && event.oldVersion < 2) {
        // Pre-ownership rows carry no owner and cannot be attributed;
        // whichever side opens v2 first drops them, same as the app does.
        open.transaction.objectStore(SHARE_STASH_STORE).clear();
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function stashFiles(files) {
  if (files.length === 0) return;
  const db = await openStash();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction([SHARE_STASH_STORE, SHARE_STASH_SESSION_STORE], 'readwrite');
      // The app publishes the signed-in account into the session store; the
      // worker cannot see auth state, so it stamps whatever it finds and
      // omits the owner when nobody is signed in — those rows live under
      // the store's claim window instead.
      const sessionGet = tx.objectStore(SHARE_STASH_SESSION_STORE).get('current');
      sessionGet.onsuccess = () => {
        const owner = sessionGet.result && sessionGet.result.userId;
        const store = tx.objectStore(SHARE_STASH_STORE);
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i];
          const row = {
            id: 'share-' + Date.now() + '-' + i,
            name: file.name,
            type: file.type,
            blob: file,
            receivedAt: Date.now()
          };
          if (owner) row.userId = owner;
          store.put(row);
        }
      };
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
