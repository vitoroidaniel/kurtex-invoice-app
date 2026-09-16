const CACHE = 'oillog-v6';
const ASSETS = [
  './',
  './pages/app-mobile.html?v=6',
  './pages/app-desktop.html?v=6',
  './css/app-base.css?v=6',
  './css/app-mobile.css?v=6',
  './css/app-desktop.css?v=6',
  './js/app.js?v=6',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  // NOTE: no self.skipWaiting() here on purpose — the new worker stays in
  // "waiting" state until the user taps Refresh on the update banner, so
  // an update never yanks the app out from under someone mid-entry.
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING' || (e.data && e.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => cached))
  );
});
