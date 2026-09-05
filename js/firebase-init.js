import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, CACHE_SIZE_UNLIMITED,
  disableNetwork, enableNetwork,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";
import { firebaseConfig } from './firebase-config.js?v=181';

// Step 16b (SPEC.md Section 13.5) — Funkstille/Sync are deliberately
// per-device localStorage flags (js/verbindung.js owns writing them), not
// Firestore fields: they must be readable synchronously, before Firestore
// is even reachable, which is exactly why they can't live there. This
// file needs its own read-only copy rather than importing js/verbindung.js
// — that module's own <script> tag runs much later in index.html, well
// after this file has already executed (many earlier modules import it),
// so importing from it here would be backwards. Same duplicate-small-
// helpers convention as everywhere else in this codebase.
function verbindungOffline() {
  try {
    if (localStorage.getItem('erdkeller-funkstille') === '1') return true;
    return localStorage.getItem('erdkeller-sync-enabled') === '0';
  } catch (err) {
    return false;
  }
}

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
// Applied immediately, before any screen loads (SPEC.md Section 13.5) —
// if this device has Funkstille or Sync turned off, the network should
// never even be attempted, not briefly enabled and then disabled once the
// connectivity probe below eventually runs.
if (verbindungOffline()) disableNetwork(db).catch(() => {});
// Build 169 — deliberately NOT getAuth(app). getAuth() on the browser
// platform passes browserPopupRedirectResolver into initializeAuth() up
// front, which on any device _isMobileBrowser() (i.e. Android and iOS,
// confirmed both our test phone and tablet) makes Auth proactively load a
// gapi iframe from apis.google.com/js/api.js as part of its OWN init
// (auth_impl.ts: `if (this._popupRedirectResolver?._shouldInitProactively)
// await this._popupRedirectResolver._initialize(this)`), and separately
// makes initializeCurrentUser() call getRedirectResult() internally on
// every single boot — regardless of whether the app itself ever calls it.
// That is why Build 168 removing our own getRedirectResult() call changed
// nothing: the SDK was making an equivalent call anyway.
//
// That iframe load has a 30s timeout (60s on a second attempt after the
// first fails), and Delay.get()'s 5s "offline" shortcut only applies when
// navigator.onLine is false — which this device reports as true in
// airplane mode. So on mobile, every offline boot paid up to ~60s before
// onAuthStateChanged could fire even once, because registerStateListener()
// gates every auth callback behind this same _initializationPromise. And
// because Firestore's own credentials provider (FirebaseAuthCredentialsProvider)
// waits on Auth's listener before it will decide it's offline, the app's
// getDocs() calls stayed stuck trying the server the whole time too — this
// single SDK default explains both the auth stall AND the empty-data stall
// observed in the field.
//
// Fix: initializeAuth() with no popupRedirectResolver. Auth then resolves
// from IndexedDB/localStorage persistence alone, with no network call at
// all, exactly as fast offline as on. The resolver is loaded on demand
// instead, passed explicitly into signInWithPopup/signInWithRedirect/
// getRedirectResult in js/auth.js — meaning apis.google.com is only ever
// touched when someone actually taps "Anmelden", which needs network
// anyway. Documented as supported: https://firebase.google.com/docs/reference/js/auth.dependencies
// Build 170 — even with no popupRedirectResolver above, Auth's init still
// unconditionally calls _reloadWithoutSaving(user) on every boot with a
// cached session (reloadAndSetCurrentUserOrClear in the SDK's
// auth_impl.ts) — a real fetch to identitytoolkit.googleapis.com to
// re-fetch the account (and to securetoken.googleapis.com first, if the
// stored ID token is stale), BEFORE the first onAuthStateChanged fires.
// This is a separate, non-optional code path from the gapi iframe fixed
// above, and it explains why Build 169 cut the offline stall from
// ~52-90s to ~26s rather than to near-zero: it hit the exact same root
// cause — Firebase's internal Delay(30000, 60000) timeout for this
// request only takes its 5s "offline" shortcut when navigator.onLine is
// false, which this device does not reliably report.
//
// Worse, this one call gates more than Auth: Firestore's local
// persistence is keyed by uid, so it structurally cannot serve ANY
// cached document — even ones already on disk — until it knows which
// user's partition to read, which it only learns from Auth's first
// credential callback. That's why DATA, not just the login screen, sat
// empty for the same ~26-30s: never a Firestore problem, always
// downstream of this one Auth network call.
//
// There is no public Auth option to skip it, so: race it against our own
// signal instead of Firebase's. _performFetchWithErrorHandling (in the
// SDK's api/index.ts) already races the real fetch against its own
// internal timeout and explicitly re-labels ANY resulting exception that
// isn't already a FirebaseError — an AbortError included — as
// 'auth/network-request-failed', which is precisely the code
// reloadAndSetCurrentUserOrClear treats as "keep the cached user, don't
// sign out" rather than "clear it". So capping the fetch ourselves is
// safe by the SDK's own design, not a hack around it: we're just
// resolving that race faster than Firebase's own 30-60s branch would.
//
// Scoped tightly on purpose: only Auth's two REST hosts, only until the
// FIRST onAuthStateChanged fires (covers exactly the boot-time reload
// this exists for), restored immediately after — so a later interactive
// sign-in or a background token refresh is never subject to this cap and
// can never fail just because a real connection was momentarily slow.
const AUTH_FETCH_HOSTS = ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com'];
const AUTH_FETCH_CAP_MS = 2000;
const nativeFetch = window.fetch.bind(window);
let capAuthFetch = true;
window.fetch = (input, init) => {
  if (!capAuthFetch) return nativeFetch(input, init);
  let host = '';
  try { host = new URL(typeof input === 'string' ? input : input.url, location.href).hostname; } catch (e) { /* ignore */ }
  if (!AUTH_FETCH_HOSTS.includes(host)) return nativeFetch(input, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_FETCH_CAP_MS);
  return nativeFetch(input, { ...(init || {}), signal: controller.signal }).finally(() => clearTimeout(timer));
};

export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
});

const stopAuthFetchCap = onAuthStateChanged(auth, () => {
  capAuthFetch = false;
  window.fetch = nativeFetch;
  stopAuthFetchCap();
});
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
// transition the OS detected), so it's safe to trust for re-enabling —
// UNLESS this device has deliberately been put into Funkstille/Sync-off
// (Section 13.5): a real network transition must never override that, or
// the household's own "verifiably talk to nothing" switch would flip back
// on by itself the moment a real connection reappeared.
window.addEventListener('online', () => {
  if (!verbindungOffline()) enableNetwork(db).catch(() => {});
});
