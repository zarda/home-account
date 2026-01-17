/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

const _CACHE_NAME = 'homeaccount-v1'; // Reserved for future use
void _CACHE_NAME;
const STATIC_CACHE_NAME = 'homeaccount-static-v1';
const DYNAMIC_CACHE_NAME = 'homeaccount-dynamic-v1';
const MODEL_CACHE_NAME = 'homeaccount-models-v1';

// Static assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/styles.css',
  '/assets/icons/icon-192x192.png',
  '/assets/icons/icon-512x512.png',
];

// API endpoints that should use network-first strategy
const API_ROUTES = [
  '/api/',
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
];

// ML Model files to cache for offline use
const MODEL_ROUTES = [
  '/models/',
  'cdn.jsdelivr.net/npm/tesseract',
  'unpkg.com/tesseract',
];

// Install event - cache static assets
self.addEventListener('install', (event: ExtendableEvent) => {
  console.log('[ServiceWorker] Installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Caching static assets');
      return cache.addAll(STATIC_ASSETS).catch((error) => {
        console.warn('[ServiceWorker] Failed to cache some static assets:', error);
        // Don't fail installation if some assets fail
        return Promise.resolve();
      });
    })
  );
  
  // Skip waiting to activate immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event: ExtendableEvent) => {
  console.log('[ServiceWorker] Activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => {
            // Delete old versions of our caches
            return name.startsWith('homeaccount-') && 
                   name !== STATIC_CACHE_NAME && 
                   name !== DYNAMIC_CACHE_NAME &&
                   name !== MODEL_CACHE_NAME;
          })
          .map((name) => {
            console.log('[ServiceWorker] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  
  // Take control of all pages immediately
  self.clients.claim();
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', (event: FetchEvent) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome-extension and other non-http(s) schemes
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Determine caching strategy based on request type
  if (isApiRoute(url)) {
    // Network-first for API calls
    event.respondWith(networkFirst(request, DYNAMIC_CACHE_NAME));
  } else if (isModelRoute(url)) {
    // Cache-first for ML models (they're large and rarely change)
    event.respondWith(cacheFirst(request, MODEL_CACHE_NAME));
  } else if (isStaticAsset(url)) {
    // Stale-while-revalidate for static assets
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE_NAME));
  } else {
    // Default: network-first with cache fallback
    event.respondWith(networkFirst(request, DYNAMIC_CACHE_NAME));
  }
});

// Cache-first strategy (for ML models)
async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    console.log('[ServiceWorker] Cache hit:', request.url);
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.error('[ServiceWorker] Network error:', error);
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// Network-first strategy (for API calls)
async function networkFirst(request: Request, cacheName: string): Promise<Response> {
  try {
    const networkResponse = await fetch(request);
    
    // Cache successful responses
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch {
    console.log('[ServiceWorker] Network failed, trying cache:', request.url);
    
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      const offlineResponse = await caches.match('/index.html');
      if (offlineResponse) {
        return offlineResponse;
      }
    }
    
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// Stale-while-revalidate strategy (for static assets)
async function staleWhileRevalidate(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  // Start network request in background
  const networkPromise = fetch(request).then((networkResponse) => {
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(() => null);
  
  // Return cached response immediately if available
  if (cachedResponse) {
    return cachedResponse;
  }
  
  // Otherwise wait for network
  const networkResponse = await networkPromise;
  if (networkResponse) {
    return networkResponse;
  }
  
  return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

// Helper functions to determine request type
function isApiRoute(url: URL): boolean {
  return API_ROUTES.some((route) => url.href.includes(route));
}

function isModelRoute(url: URL): boolean {
  return MODEL_ROUTES.some((route) => url.href.includes(route));
}

function isStaticAsset(url: URL): boolean {
  const staticExtensions = ['.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff', '.woff2'];
  return staticExtensions.some((ext) => url.pathname.endsWith(ext));
}

// Handle messages from the main thread
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const { type, payload } = event.data || {};
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'CACHE_MODELS':
      // Pre-cache ML models when user opts in
      if (payload?.modelUrls) {
        event.waitUntil(cacheModels(payload.modelUrls));
      }
      break;
      
    case 'CLEAR_MODEL_CACHE':
      event.waitUntil(caches.delete(MODEL_CACHE_NAME));
      break;
      
    case 'GET_CACHE_SIZE':
      event.waitUntil(getCacheSize().then((size) => {
        event.source?.postMessage({ type: 'CACHE_SIZE', payload: size });
      }));
      break;
  }
});

// Cache ML models for offline use
async function cacheModels(modelUrls: string[]): Promise<void> {
  const cache = await caches.open(MODEL_CACHE_NAME);
  
  for (const url of modelUrls) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        await cache.put(url, response);
        console.log('[ServiceWorker] Cached model:', url);
      }
    } catch (error) {
      console.warn('[ServiceWorker] Failed to cache model:', url, error);
    }
  }
}

// Calculate total cache size
async function getCacheSize(): Promise<{ total: number; models: number; static: number; dynamic: number }> {
  const sizes = {
    total: 0,
    models: 0,
    static: 0,
    dynamic: 0,
  };
  
  const cacheConfigs = [
    { name: MODEL_CACHE_NAME, key: 'models' as const },
    { name: STATIC_CACHE_NAME, key: 'static' as const },
    { name: DYNAMIC_CACHE_NAME, key: 'dynamic' as const },
  ];
  
  for (const config of cacheConfigs) {
    try {
      const cache = await caches.open(config.name);
      const keys = await cache.keys();
      
      for (const request of keys) {
        const response = await cache.match(request);
        if (response) {
          const blob = await response.blob();
          sizes[config.key] += blob.size;
          sizes.total += blob.size;
        }
      }
    } catch (error) {
      console.warn('[ServiceWorker] Error calculating cache size:', error);
    }
  }
  
  return sizes;
}

// Background sync for offline queue (when supported)
// Note: 'sync' event is not in standard TypeScript types yet
self.addEventListener('sync', ((event: Event & { tag?: string; waitUntil?: (promise: Promise<void>) => void }) => {
  if (event.tag === 'sync-offline-queue' && event.waitUntil) {
    event.waitUntil(syncOfflineQueue());
  }
}) as EventListener);

async function syncOfflineQueue(): Promise<void> {
  // This will be implemented in the offline-queue service
  // The service worker just triggers the sync
  const clients = await self.clients.matchAll();
  for (const client of clients) {
    client.postMessage({ type: 'SYNC_OFFLINE_QUEUE' });
  }
}

// Periodic background sync for model updates (when supported)
// Note: 'periodicsync' event is not in standard TypeScript types yet
self.addEventListener('periodicsync', ((event: Event & { tag?: string; waitUntil?: (promise: Promise<void>) => void }) => {
  if (event.tag === 'update-models' && event.waitUntil) {
    event.waitUntil(updateModels());
  }
}) as EventListener);

async function updateModels(): Promise<void> {
  // Check for model updates
  const clients = await self.clients.matchAll();
  for (const client of clients) {
    client.postMessage({ type: 'CHECK_MODEL_UPDATES' });
  }
}

export {};
