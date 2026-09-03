import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, CACHE_SIZE_UNLIMITED,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";
import { firebaseConfig } from './firebase-config.js?v=164';

// TEMPORARY (Build 161) — offline diagnostic probe, see the inline script in
// index.html. Reaching this line proves the gstatic Firebase SDK imports
// above actually resolved, which is the thing most likely to fail offline
// while the service worker is still a passthrough. Remove with the rest.
if (window.__ekDiag) window.__ekDiag.firebaseInit = true;

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
