// Share-target intake worker.
//
// Its ONLY job is to catch the POST the manifest's share_target sends,
// stash the shared files into IndexedDB, and bounce the browser to the
// import wizard. Firebase Hosting rewrites do not apply to POST, so without
// this worker the share would 404 before the app ever loads.
//
// Every other request passes through untouched: no caching, no offline
// shell, and deliberately no `sync` handler — registering any worker makes
// PwaService.registerBackgroundSync() start succeeding, and a sync event
// with no handler here is inert by design.
//
// The DB name, store name, version, and row shape are duplicated in
// src/app/core/services/share-stash.store.ts, which a worker cannot
// import. Change them together.

const SHARE_STASH_DB = 'homeaccount-share-intake';
const SHARE_STASH_STORE = 'pending';
const SHARE_STASH_VERSION = 1;
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
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(SHARE_STASH_STORE)) {
        open.result.createObjectStore(SHARE_STASH_STORE, { keyPath: 'id' });
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
      const tx = db.transaction(SHARE_STASH_STORE, 'readwrite');
      const store = tx.objectStore(SHARE_STASH_STORE);
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        store.put({
          id: 'share-' + Date.now() + '-' + i,
          name: file.name,
          type: file.type,
          blob: file,
          receivedAt: Date.now()
        });
      }
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
