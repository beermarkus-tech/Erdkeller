// Step 0: registration only. Offline caching strategy (incl. the guaranteed
// crisis-checklist pre-cache from SPEC.md Section 12) lands in Step 16.
const VERSION = 'erdkeller-v0';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
