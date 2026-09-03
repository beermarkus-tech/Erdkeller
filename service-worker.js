// Step 16 — offline boot. Two caches: PRECACHE holds every local file this
// app needs to start and run (exact ?v=N URLs, listed below, kept in sync
// with the version sweep on every build); RUNTIME_CACHE opportunistically
// caches cross-origin CDN responses (gstatic Firebase SDK, jsPDF, Google
// Fonts) the first time they're fetched online, since the Firebase SDK's
// own internal module graph pulls in further gstatic chunks that aren't
// enumerable from this repo — a static list can't cover it, only "cache
// whatever gstatic actually serves us" can.
//
// Firebase's own API traffic (Firestore/Auth/Functions/FCM) is explicitly
// passed straight through, never cached — Step 16.2's Firestore persistence
// is what makes THAT work offline, and this service worker must stay out
// of its way entirely.
const VERSION = 'erdkeller-v2';
const PRECACHE = `erdkeller-precache-${VERSION}`;
const RUNTIME_CACHE = `erdkeller-runtime-${VERSION}`;

const PRECACHE_URLS = [
  `index.html?v=158`,
  `css/styles.css?v=158`,
  `manifest.json?v=158`,
  // icons: cached under BOTH the versioned form (index.html/manifest.json
  // reference them with ?v=) and the unversioned form (the push handler
  // below references them bare) — see the matching note in the fetch
  // handler's icon-request branch.
  `icons/icon-192.png?v=158`,
  `icons/icon-512.png?v=158`,
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/badge-96.png',
  // Every file in js/ — 29 are <script> tags in index.html, five more
  // (firebase-init, firebase-config, push, stock-log, format-batch) are
  // only reachable via ESM `import`, and are exactly the ones easiest to
  // forget since nothing in index.html names them.
  `js/account-menu.js?v=158`,
  `js/admin-log.js?v=158`,
  `js/app-shell.js?v=158`,
  `js/app.js?v=158`,
  `js/auth.js?v=158`,
  `js/back-nav.js?v=158`,
  `js/backup-tabs.js?v=158`,
  `js/backup.js?v=158`,
  `js/checklists.js?v=158`,
  `js/contacts.js?v=158`,
  `js/dashboard.js?v=158`,
  `js/data-tabs.js?v=158`,
  `js/dictate.js?v=158`,
  `js/firebase-config.js?v=158`,
  `js/firebase-init.js?v=158`,
  `js/format-batch.js?v=158`,
  `js/info-nav.js?v=158`,
  `js/notes.js?v=158`,
  `js/notifications.js?v=158`,
  `js/pdf-export.js?v=158`,
  `js/people.js?v=158`,
  `js/planning.js?v=158`,
  `js/push.js?v=158`,
  `js/recipes.js?v=158`,
  `js/refresh-button.js?v=158`,
  `js/settings-nav.js?v=158`,
  `js/stock-checkin.js?v=158`,
  `js/stock-checkout.js?v=158`,
  `js/stock-log.js?v=158`,
  `js/stock-table.js?v=158`,
  `js/storage-locations.js?v=158`,
  `js/targets.js?v=158`,
  `js/taxonomy.js?v=158`,
  `js/year-colors.js?v=158`,
];

// Hosts whose responses are worth runtime-caching (cross-origin CDN assets,
// not API endpoints) — cached cache-first the first time they're actually
// fetched, since neither the Firebase SDK's internal chunk graph nor Google
// Fonts' woff2 URLs are knowable ahead of time from this repo.
const RUNTIME_CACHE_HOSTS = [
  'www.gstatic.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// Firebase's actual API traffic — must NEVER be intercepted or cached.
// Step 16.2's Firestore persistentLocalCache is what provides offline
// reads/writes; this service worker caching (or worse, serving a cached
// response for) any of these would fight the SDK's own offline handling.
const NEVER_CACHE_HOSTS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'fcmregistrations.googleapis.com',
  'firebaseinstallations.googleapis.com',
];

function isNeverCache(url) {
  return NEVER_CACHE_HOSTS.some((h) => url.hostname === h) || url.hostname.endsWith('.cloudfunctions.net');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== PRECACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // writes always go straight to the network

  const url = new URL(request.url);

  // Firebase API traffic: untouched passthrough, no cache involvement at all.
  if (isNeverCache(url)) return;

  // App-shell navigation (typing the URL, opening from the home screen icon,
  // a fresh tab) — serve the precached index.html so the app boots offline
  // even though manifest.json's start_url is index.html, not "./".
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(`index.html?v=158`)
        .then((cached) => cached || fetch(request))
        .catch(() => caches.match(`index.html?v=158`)),
    );
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  const runtimeCacheable = RUNTIME_CACHE_HOSTS.includes(url.hostname);

  if (!sameOrigin && !runtimeCacheable) return; // some other third-party request — leave alone

  // Cache-first for everything else: precached local assets, and
  // opportunistically-cached cross-origin CDN responses.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          const cacheName = sameOrigin ? PRECACHE : RUNTIME_CACHE;
          caches.open(cacheName).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => {
        // Local icon request with no ?v= match (see the dual-form entries
        // in PRECACHE_URLS above) — try the bare path as a last resort.
        if (sameOrigin && url.pathname.startsWith('/icons/')) {
          return caches.match(url.pathname.slice(1));
        }
        return undefined;
      });
    }),
  );
});

// Deliberately a PLAIN push handler, not the Firebase Messaging compat SDK
// (no `importScripts('firebase-messaging-sw.js')`) — see functions/index.js's
// own header comment on why sendReminders sends a data-only payload rather
// than a top-level `notification` payload: a `notification` payload would
// be auto-displayed by the FCM SW machinery AND by this handler, producing
// doubles. Reading `event.data.json()` directly works because the payload
// is data-only; there is nothing here that needs the Firebase SDK at all.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    payload = { title: 'Erdkeller', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'Erdkeller';
  const options = {
    body: payload.body || '',
    // icon-192 is the app's own opaque icon; badge-96 is a separate,
    // monochrome-with-alpha asset — Android derives the status-bar badge
    // shape from the alpha channel alone, so a badge without one renders
    // as a solid white blob (icon-192/512 are both opaque RGB, see
    // css/… no, see icons/ — they were never meant to serve as a badge).
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    // One tag per reminder frequency (not per send) — a repeat nudge for
    // the same frequency replaces its own previous notification instead
    // of stacking, while a weekly and a monthly reminder landing the same
    // morning stay as two separate notifications.
    tag: payload.freq ? `erdkeller-${payload.freq}` : 'erdkeller',
    data: payload,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Deep-links into Checklisten -> Wartung filtered to the reminder's own
// frequency — js/app.js reads this hash both at boot and on `hashchange`,
// so navigating an already-open client's URL re-triggers the same reader a
// fresh page load would use, no postMessage plumbing needed. Focuses an
// existing app window if one is open, or opens a new one otherwise, never
// both.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const freq = event.notification.data && event.notification.data.freq;
  const targetUrl = new URL(freq && freq !== 'test' ? `index.html#erinnerung=${freq}` : 'index.html', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      const existing = clientList.find((c) => 'focus' in c);
      if (existing) {
        if ('navigate' in existing) {
          try { await existing.navigate(targetUrl); } catch (err) { /* fall through to focus-only */ }
        }
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
