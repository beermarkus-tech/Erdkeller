// Offline support (SPEC.md Section 13, dev plan Step 16.1). Without this,
// offline loading depends entirely on Chrome's own HTTP cache, which evicts
// per-resource and unpredictably — observed in the field as a lottery on
// every cold start: sometimes the whole app, sometimes a partial module
// graph, sometimes stuck on the login screen, and consistently worse on the
// lower-memory phone than on the tablet. A service worker cache is the only
// way to make offline deterministic.
//
// DESIGN NOTES — this is the second attempt. Build 158 shipped a caching
// service worker that broke Google sign-in in production and was reverted
// in Build 159. The differences that matter:
//
//   1. NAVIGATION IS NETWORK-FIRST, not cache-first. Build 158 served a
//      cached index.html for every navigation regardless of the requested
//      URL, which is the prime suspect for that breakage. Network-first
//      means that while online this behaves EXACTLY as if no service worker
//      existed — it cannot break the sign-in flow — while still falling
//      back to the cached shell when the network is genuinely gone.
//   2. An explicit allowlist decides what may be served from cache. Anything
//      not on it is returned untouched, never intercepted.
//   3. apis.google.com is explicitly never touched. Firebase Auth loads its
//      popup/redirect helper (a gapi iframe) from there — confirmed in Build
//      161/162 diagnostics as load-bearing for the auth flow.
//   4. Install is resilient: one bad URL degrades that single entry rather
//      than failing the whole installation atomically (cache.addAll would).
const VERSION = 'erdkeller-v16';
const PRECACHE = `erdkeller-precache-${VERSION}`;
// Build 171 — deliberately NOT suffixed with VERSION like PRECACHE. This
// holds opportunistically-cached cross-origin CDN responses (Google
// Fonts, cdnjs, gstatic Firebase SDK chunks) that don't change with our
// own app builds. Tying it to VERSION meant activate's cleanup below
// deleted and force-re-fetched ALL of it on every single deploy — so the
// very first offline load after any build had no cached fallback for the
// render-blocking Google Fonts <link rel="stylesheet"> in index.html's
// <head>, and that fetch has no timeout of its own. Confirmed in the
// field as a ~30s "carrot" splash (Chrome's native PWA splash, up until
// first paint) even AFTER Build 170 got Auth itself down to well under a
// second — a completely different stall hiding behind the same
// navigator.onLine-lies problem. Keeping this name stable means the CDN
// cache now survives every future deploy; see the fetch timeout below
// for the one case this can't cover (a genuinely first-ever offline load
// on a brand-new device).
const RUNTIME_CACHE = 'erdkeller-runtime';

// The app shell, at the exact versioned URLs the app requests. The ?v=
// literals here are swept by the same version bump as every other file, so
// this list stays in sync automatically.
const SHELL_URL = 'index.html?v=180';
const PRECACHE_URLS = [
  SHELL_URL,
  'css/styles.css?v=180',
  'manifest.json?v=180',
  // Icons are referenced versioned from index.html/manifest.json but bare
  // from the push handler below, so both forms are cached.
  'icons/icon-192.png?v=180',
  'icons/icon-512.png?v=180',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/badge-96.png',
  // Every file in js/. 29 are <script> tags in index.html; five more
  // (firebase-init, firebase-config, push, stock-log, format-batch) are
  // reachable only via ESM import and are the easiest to forget, since
  // nothing in index.html names them.
  'js/account-menu.js?v=180',
  'js/admin-log.js?v=180',
  'js/app-shell.js?v=180',
  'js/app.js?v=180',
  'js/auth.js?v=180',
  'js/back-nav.js?v=180',
  'js/backup-tabs.js?v=180',
  'js/backup.js?v=180',
  'js/checklists.js?v=180',
  'js/contacts.js?v=180',
  'js/dashboard.js?v=180',
  'js/data-tabs.js?v=180',
  'js/dictate.js?v=180',
  'js/firebase-config.js?v=180',
  'js/firebase-init.js?v=180',
  'js/format-batch.js?v=180',
  'js/info-nav.js?v=180',
  'js/notes.js?v=180',
  'js/notifications.js?v=180',
  'js/pdf-export.js?v=180',
  'js/people.js?v=180',
  'js/planning.js?v=180',
  'js/push.js?v=180',
  'js/recipes.js?v=180',
  'js/refresh-button.js?v=180',
  'js/reminders-tabs.js?v=180',
  'js/settings-nav.js?v=180',
  'js/stock-checkin.js?v=180',
  'js/stock-checkout.js?v=180',
  'js/stock-log.js?v=180',
  'js/stock-table.js?v=180',
  'js/storage-locations.js?v=180',
  'js/targets.js?v=180',
  'js/taxonomy.js?v=180',
  'js/verbindung.js?v=180',
  'js/year-colors.js?v=180',
];

// Cross-origin hosts whose responses may be cached. The Firebase SDK's ESM
// entrypoints import further gstatic chunks at runtime that are not
// enumerable from this repo, so those can only be picked up opportunistically
// as they are actually fetched — a static precache list cannot cover them.
const CACHEABLE_HOSTS = [
  'www.gstatic.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE)
      // Deliberately not cache.addAll: that rejects the whole install if any
      // single URL fails, which would leave the app with no cache at all
      // because of one typo or one 404.
      .then((cache) => Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url))))
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

  // Writes and anything non-GET always go straight to the network.
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  // Navigation: NETWORK-FIRST. Online this is indistinguishable from having
  // no service worker at all, which is what makes it safe for the sign-in
  // flow; the cached shell is only ever used when the network actually fails.
  //
  // Bounded with an explicit AbortController timeout rather than a bare
  // fetch() — observed in the field: a real device with WLAN AND airplane
  // mode both fully off (confirmed via screenshot, not just navigator.onLine
  // which is separately known to misreport on this device) took ~30 SECONDS
  // to reach the .catch() below and fall back to the cached shell — a blank,
  // unbranded screen for half a minute before anything of ours even started
  // running. That is the browser's own network stack being slow to conclude
  // "unreachable," not anything about our code; AbortController forcibly
  // cancels the attempt rather than waiting for it to fail naturally, and
  // 2.5s is generous enough that no real connection, even a slow one, would
  // ever hit it.
  if (request.mode === 'navigate') {
    if (!sameOrigin) return;
    event.respondWith((async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      try {
        const response = await fetch(request, { signal: controller.signal });
        clearTimeout(timer);
        return response;
      } catch (err) {
        clearTimeout(timer);
        const cached = await caches.match(SHELL_URL);
        return cached || Response.error();
      }
    })());
    return;
  }

  // Everything else is cache-first, but ONLY for an explicit allowlist:
  // this origin's own static files, and the CDN hosts above. Any other
  // request — notably apis.google.com, accounts.google.com, and every
  // *.googleapis.com / firebaseapp.com / cloudfunctions.net endpoint the
  // Firebase SDK talks to — is returned untouched so the SDK's own network
  // and offline handling is never interfered with.
  const cacheable = sameOrigin || CACHEABLE_HOSTS.includes(url.hostname);
  if (!cacheable) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      // Bounded for the same reason as the navigation handler above: a
      // cold cache entry must not hang on this device's real network stack
      // for ~30s just because navigator.onLine is lying. A render-blocking
      // resource (e.g. the Google Fonts stylesheet in index.html's <head>)
      // would otherwise stall first paint for that whole time; failing
      // fast lets the page render with fallback fonts instead.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      return fetch(request, { signal: controller.signal }).then((response) => {
        // Only cache real successes. Opaque cross-origin responses (status 0)
        // are stored too, since that is the only form a no-cors CDN response
        // takes and it still replays correctly offline.
        if (response && (response.ok || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(sameOrigin ? PRECACHE : RUNTIME_CACHE)
            .then((cache) => cache.put(request, copy))
            .catch(() => { /* cache write failures must never break the fetch */ });
        }
        return response;
      }).finally(() => clearTimeout(timer));
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
