// Range Log service worker
// Strategy: network-first for HTML so app updates propagate quickly.
// Bump APP_VERSION whenever the HTML changes to force a new SW install.
const APP_VERSION = '4.4';
const CACHE_NAME = `range-log-${APP_VERSION}`;

self.addEventListener('install', event => {
  // Do not skipWaiting automatically — let the client trigger it after user confirms
  // so we don't disrupt an in-progress session.
  self.skipWaiting = self.skipWaiting; // no-op reference
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // Clean up old caches
      const keys = await caches.keys();
      await Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isHTML = req.mode === 'navigate' || req.destination === 'document' ||
                 (isSameOrigin && (url.pathname === '/' || url.pathname.endsWith('.html')));

  if (isHTML) {
    // Network-first for HTML so we always try to get the latest
    event.respondWith(
      (async () => {
        try {
          const netResp = await fetch(req, { cache: 'no-cache' });
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, netResp.clone());
          return netResp;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          // Last resort: serve cached index
          const cache = await caches.open(CACHE_NAME);
          const keys = await cache.keys();
          for (const k of keys) {
            if (k.url.endsWith('.html') || new URL(k.url).pathname === '/') {
              return cache.match(k);
            }
          }
          throw new Error('offline and no cache');
        }
      })()
    );
    return;
  }

  // For fonts and other assets: cache-first with network fallback
  if (isSameOrigin || url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com')) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(resp => {
          if (resp.ok) {
            const respClone = resp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, respClone));
          }
          return resp;
        }).catch(() => cached);
      })
    );
  }
});
