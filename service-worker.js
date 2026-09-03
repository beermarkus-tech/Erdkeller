// EMERGENCY REVERT (Build 159): the Build 158 caching service worker broke
// sign-in in production — the household got stuck at the login screen and
// could not get past it. Reverted immediately to the safe passthrough
// behavior rather than debugging live against a broken app. Root cause not
// yet confirmed; offline caching will be re-approached more carefully,
// likely without blanket-intercepting every navigation request, once this
// is understood. See SPEC.md Section 13 / dev plan Step 16.1.
const VERSION = 'erdkeller-v3-revert';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
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
