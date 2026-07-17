// Momentum service worker: enables installation as a PWA and offline fallback.
// Network-first for everything so development and deploys stay fresh;
// cached copies are served only when the network is unavailable.
const CACHE = 'momentum-v2';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll([
      '/', '/css/style.css', '/js/api.js', '/js/ui.js', '/js/app.js',
      '/js/views/today.js', '/js/views/calendar.js', '/js/views/archive.js',
      '/js/views/goals.js', '/js/views/bulletin.js', '/js/views/presets.js',
      '/manifest.webmanifest', '/icons/icon.svg'
    ]).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then(hit => hit || caches.match('/')))
  );
});
