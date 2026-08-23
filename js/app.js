if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((err) => {
      console.error('Service worker registration failed:', err);
    });
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
