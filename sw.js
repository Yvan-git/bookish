/**
 * Service worker — offline shell + cache of the app resources.
 *
 * It lives at the root of the project so that its scope covers both
 * /app/ (the PWA) and /shared/ (the shared Excel & chart libraries).
 * Catalogue API traffic is never cached: it is the point of the app, and
 * stale metadata would be worse than an offline error.
 */
const VERSION = 'bookish-v3';
const SHELL = [
  './',
  './app/index.html',
  './app/manifest.webmanifest',
  './app/css/app.css',
  './app/js/app.js',
  './app/js/util.js',
  './app/js/store.js',
  './app/js/strings.js',
  './app/js/apis.js',
  './app/js/scanner.js',
  './app/js/drive.js',
  './app/js/sync.js',
  './app/js/stats.js',
  './app/js/views/shared.js',
  './app/js/views/scan.js',
  './app/js/views/library.js',
  './app/js/views/stats.js',
  './app/js/views/settings.js',
  './shared/xlsx.js',
  './shared/charts.js',
  './app/vendor/jsQR.js',
  './app/icons/icon-192.png',
  './app/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // catalogue APIs: never cached

  // Network-first for the shell (updates flow immediately), cache fallback offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => undefined);
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('./app/index.html'))),
  );
});
