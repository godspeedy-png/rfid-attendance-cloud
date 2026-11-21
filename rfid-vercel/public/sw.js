// Minimal service worker: it makes the site installable.
// It deliberately caches NOTHING, so student data and photos are never stored by it.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
