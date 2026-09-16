const CACHE = 'oillog-v13';
// './' is the app shell: the server picks mobile or desktop from the
// User-Agent, so whatever gets cached here is already the right layout for
// this device. The pages are never cached at their /pages/*.html path,
// because a document opened from there resolves its relative css/js links
// against /pages/ instead of the web root.
const SHELL = './';
const ASSETS = [
  './',
  './css/app-base.css?v=11',
  './css/app-mobile.css?v=11',
  './css/app-desktop.css?v=11',
  './js/app.js?v=11',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Cache each asset on its own: a single bad URL must never abort the whole
// update (addAll() would reject the install and strand users on an old build).
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING' || (e.data && e.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

// Pages and code must always be revalidated against the server: that is what
// makes a new deploy appear on the next load instead of being served stale.
function isAppShell(req, url) {
  if (req.mode === 'navigate') return true;
  const p = url.pathname;
  return p === '/' || p.endsWith('.html') || p.endsWith('.css') ||
         p.endsWith('.js') || p.endsWith('.json');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // API calls and third-party CDNs are never intercepted.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // ── App shell + code: NETWORK FIRST (falls back to cache when offline) ──
  if (isAppShell(req, url)) {
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        // Offline: exact URL first, then './' (which the install step cached
        // using this device's User-Agent, so it is the right layout), then the
        // mobile shell as a last resort.
        .catch(() =>
          caches.match(req)
            .then(hit => hit || caches.match('./'))
            .then(hit => hit || caches.match(SHELL))
        )
    );
    return;
  }

  // ── Icons & other static files: cache first, filled in the background ──
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }))
  );
});
