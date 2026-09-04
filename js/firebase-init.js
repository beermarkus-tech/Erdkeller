import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, CACHE_SIZE_UNLIMITED,
  disableNetwork, enableNetwork,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";
import { firebaseConfig } from './firebase-config.js?v=168';

// TEMPORARY (Build 161) — offline diagnostic probe, see the inline script in
// index.html. Reaching this line proves the gstatic Firebase SDK imports
// above actually resolved, which is the thing most likely to fail offline
// while the service worker is still a passthrough. Remove with the rest.
if (window.__ekDiag) { window.__ekDiag.firebaseInit = true; window.__ekDiag.mark('firebaseInit'); }

export const app = initializeApp(firebaseConfig);
// SPEC.md Section 13 — Firestore's own persistent cache IS the app's local
// store (not a separate IndexedDB mirror, see SPEC 20.2.2 for why that was
// rejected). CACHE_SIZE_UNLIMITED disables the SDK's default LRU pruning,
// which is the one real reason the cache couldn't otherwise be trusted as
// a store of record — without this, Firestore silently evicts documents
// under its own schedule that the app has no visibility into.
// persistentMultipleTabManager stops an open browser tab and the installed
// PWA fighting over the same cache. Must be called before any other
// Firestore use — this module is the one singleton every screen imports,
// so that ordering is guaranteed by construction.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    cacheSizeBytes: CACHE_SIZE_UNLIMITED,
    tabManager: persistentMultipleTabManager(),
  }),
});
export const auth = getAuth(app);
// Only js/dictate.js's parseDictation call uses this — everything else in
// the app is Firestore-only, no other screen needs a Cloud Function.
export const functions = getFunctions(app);

// Real-connectivity probe. navigator.onLine is unreliable on at least one
// real test device — confirmed offline via screenshot (WLAN and Flugmodus
// both fully disabled) while it still reported `true`. Firestore has its
// own internal connectivity detection, separate from navigator.onLine, but
// observed in the field to take 30-50+ seconds to give up trying the real
// network and fall back to serving from its persistent local cache — an
// unacceptably long blank/empty-screens wait for a crisis app.
//
// So: fire one bounded, abortable fetch at boot. A same-origin request
// (not an external host) so the probe can't be slow/blocked for reasons
// unrelated to real connectivity, e.g. a third-party CDN having a bad
// moment while the network itself is fine. A cache-busting query param so
// it's a genuine network round-trip rather than a same-origin cache hit —
// the service worker only cache-matches its exact precached ?v=N URLs, so
// this one always falls through to fetch(). If it doesn't come back within
// 1.5s, disableNetwork() immediately — this is the same bounded-timeout
// pattern already used for the auth grace period in js/auth.js, applied
// here to stop Firestore's own slow detection rather than wait for it.
//
// Deliberately NOT gated behind navigator.onLine — the whole point is that
// signal can't be trusted. A false positive here (network's fine but this
// one probe was briefly slow) just means Firestore serves cache a little
// longer than ideal, which is a far smaller cost than the 30-50s blank
// screens this replaces; the `online` event listener below recovers from
// it as soon as the browser itself reports a real state transition.
(function probeConnectivity() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  fetch(`manifest.json?probe=${Date.now()}`, { signal: controller.signal, cache: 'no-store' })
    .then(() => clearTimeout(timer))
    .catch(() => {
      clearTimeout(timer);
      disableNetwork(db).catch(() => {});
    });
}());

// Recovery: an edge-triggered 'online' event is a much stronger signal than
// reading navigator.onLine's static value (it only fires on an actual
// transition the OS detected), so it's safe to trust for re-enabling.
window.addEventListener('online', () => { enableNetwork(db).catch(() => {}); });
