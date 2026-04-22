/**
 * Service worker for the Comda Academy PWA.
 */

const VERSION        = 'v1.0.0';
const SHELL_CACHE    = `academy-shell-${VERSION}`;
const DATA_CACHE     = `academy-data-${VERSION}`;
const IMAGE_CACHE    = `academy-images-${VERSION}`;
const CDN_CACHE      = `academy-cdn-${VERSION}`;

const MAX_IMAGE_ENTRIES = 2000;

const SHELL_FILES = [
  './',
  'index.html',
  'admin.html',
  'manifest.webmanifest',
  'assets/css/styles.css',
  'assets/js/app.js',
  'assets/js/admin.js',
  'assets/js/github-api.js',
  'assets/js/background.js',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL_FILES.map(async (url) => {
      try { await cache.add(url); } catch (e) { /* ignore */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    const KEEP = [SHELL_CACHE, DATA_CACHE, IMAGE_CACHE, CDN_CACHE];
    await Promise.all(names.map((n) => {
      if (KEEP.indexOf(n) === -1) {
        return caches.delete(n);
      }
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.origin === self.location.origin && url.pathname.indexOf('/data/presentations/') !== -1) {
    event.respondWith(cacheFirst(IMAGE_CACHE, req, MAX_IMAGE_ENTRIES));
    return;
  }

  if (url.origin === self.location.origin && (url.pathname.endsWith('/products.json') || url.pathname.endsWith('/auth.json'))) {
    event.respondWith(networkFirst(DATA_CACHE, req));
    return;
  }

  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(staleWhileRevalidate(CDN_CACHE, req));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(SHELL_CACHE, req));
    return;
  }
});

async function cacheFirst(cacheName, req, maxEntries) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) {
      cache.put(req, res.clone());
      trimCache(cacheName, maxEntries);
    }
    return res;
  } catch (e) {
    return hit || new Response('', { status: 504, statusText: 'offline' });
  }
}

async function networkFirst(cacheName, req) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw e;
  }
}

async function staleWhileRevalidate(cacheName, req) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const networkPromise = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => hit);
  return hit || networkPromise;
}

async function trimCache(cacheName, max) {
  if (!max) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  const excess = keys.length - max;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  if (e.data === 'clearImages') caches.delete(IMAGE_CACHE);
  if (e.data === 'clearAll') {
    e.waitUntil(
      caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))))
    );
  }
});
