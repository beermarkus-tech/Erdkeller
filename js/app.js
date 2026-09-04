if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((err) => {
      console.error('Service worker registration failed:', err);
    });
  });
}

// Asks the browser not to evict this origin's storage (incl. Firestore's
// persistent cache, SPEC.md Section 13) under disk pressure — Chrome grants
// this by heuristic rather than prompting (home-screen install, engagement,
// granted notification permission all count in our favour). Best-effort:
// never blocks startup, and a false/rejected result just means the browser
// might still evict under real pressure, not that anything is broken now.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().then((granted) => {
    console.log('Persistent storage', granted ? 'granted' : 'not granted');
  }).catch((err) => {
    console.error('navigator.storage.persist() failed:', err);
  });
}

// Android sometimes launches an installed PWA in the wrong orientation for
// a moment before correcting to match how the device is actually held —
// visible as a portrait-then-landscape flash on a tablet. Nothing in our
// code controls that first OS-level paint, so instead: keep the page
// invisible for two frames plus a short delay (enough time for that
// correction to happen), then fade in already in the right orientation.
function revealApp() {
  document.body.classList.add('app-ready');
}
requestAnimationFrame(() => {
  requestAnimationFrame(() => setTimeout(revealApp, 150));
});
