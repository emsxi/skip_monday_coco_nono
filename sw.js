const CACHE_NAME = 'skip-monday-v6';
const ASSETS = [
  './',
  './index.html',
  './admin.html',
  './manifest.json',
  './data.json',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  './images/coco.svg',
  './images/nono.svg'
];

// Install: cache all assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache first, then network
self.addEventListener('fetch', event => {
  // Skip non-GET and cross-origin requests
  if (event.request.method !== 'GET') return;
  
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Don't cache non-ok or opaque responses for cross-origin
        if (!response || response.status !== 200) return response;
        // Cache same-origin responses
        if (new URL(event.request.url).origin === location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback
        return caches.match('./index.html');
      });
    })
  );
});
