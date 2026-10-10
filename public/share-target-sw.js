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
// at the same scope would replace this one instead of adding to it.
//
// A worker-raised notification has no default click behaviour, so the click
// handler below supplies one. ReminderService puts the in-app path the tap
// should open in the notification's `data.route`; the handler admits it only
// through the copy of safeAppRoute below and falls back to `/` for anything
// else, including a notification raised before routes were carried. An open
// tab is focused and handed the route in a `{type: 'notification-route',
// route}` message, because a worker cannot drive the app's router and
// navigating the tab itself would reload the app; the page's
// NotificationTapService (src/app/core/services/notification-tap.service.ts)
// opens it, and the type is a literal on both sides. With no open tab, or
// when focus() is refused, a new one opens at the route instead. No
// `notificationclose`.
//
// Every other request passes through untouched: no caching, no offline
// shell, and no `sync` handler — the offline queue drains on a reconnect or
// the manual Sync Now, never on a worker wake-up. The only message this
// worker posts to a page is the notification route above.
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
const NOTIFICATION_ROUTE_MESSAGE = 'notification-route';

// A copy of safeAppRoute in src/app/core/utils/notification-route.utils.ts,
// which a worker cannot import; src/app/share-target-sw.spec.ts holds the two
// to the same answers. `//host` is protocol-relative, a URL parser reads `\`
// as `/`, and it drops tabs and newlines before parsing, so `/\t/host` would
// open `//host`; every other control character is refused with them.
const CONTROL_CHARACTER = /\p{Cc}/u;

function safeAppRoute(candidate) {
  if (typeof candidate !== 'string') return null;
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return null;
  if (candidate.includes('\\')) return null;
  if (CONTROL_CHARACTER.test(candidate)) return null;
  return candidate;
}

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
  const data = event.notification.data;
  const route = safeAppRoute(data && data.route) || '/';
  event.waitUntil(focusOrOpen(route));
});

async function focusOrOpen(route) {
  // matchAll({ type: 'window' }) returns only WindowClients, and every one
  // exposes focus() — there is nothing to filter on, so this is
  // windowClients[0].
  const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const target = windowClients[0];
  if (target) {
    try {
      await target.focus();
      target.postMessage({ type: NOTIFICATION_ROUTE_MESSAGE, route });
      return;
    } catch {
      // focus() rejects when the click's user activation isn't attributed to
      // it (Chrome: InvalidAccessError) — fall through instead of leaving
      // event.waitUntil() holding a rejected promise and no window opening.
    }
  }
  return self.clients.openWindow(route);
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
