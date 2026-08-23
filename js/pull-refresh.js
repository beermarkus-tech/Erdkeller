// Custom pull-to-refresh — the native browser gesture relies on the
// overscroll bounce effect, which SPEC.md Section 2 has us disable app-wide
// for a more native feel, so it doesn't fire on its own. This reimplements
// it with Pointer Events (works with touch, unlike a mouse-only approach)
// and broadcasts erdkeller:refresh for whichever screen module is active to
// react to — mirrors the erdkeller:signedin/signedout pattern in auth.js.
const THRESHOLD = 70;
const MAX_PULL = 110;

const indicator = document.createElement('div');
indicator.className = 'pull-refresh-indicator';
indicator.textContent = '↓';
document.body.appendChild(indicator);

let startY = null;
let pulling = false;
let refreshing = false;

function atTop() {
  return (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
}

function ignoreTarget(target) {
  return !!(target.closest && target.closest('input, textarea, select, button, .drag-handle'));
}

function setPull(px) {
  indicator.style.transform = `translateX(-50%) translateY(${px - 40}px)`;
}

function reset() {
  indicator.classList.remove('visible', 'ready', 'spinning');
  indicator.textContent = '↓';
  setPull(0);
}

async function triggerRefresh() {
  refreshing = true;
  indicator.classList.add('visible', 'spinning');
  indicator.classList.remove('ready');
  indicator.textContent = '⟳';
  indicator.style.transform = 'translateX(-50%) translateY(20px)';
  window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  // No promise tracking of listeners — just hold the spinner briefly so the
  // gesture feels acknowledged before resetting.
  await new Promise((resolve) => setTimeout(resolve, 600));
  refreshing = false;
  reset();
}

document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (refreshing || !atTop() || ignoreTarget(e.target)) return;
  startY = e.clientY;
  pulling = true;
}, { passive: true });

document.addEventListener('pointermove', (e) => {
  if (!pulling || startY === null) return;
  const delta = e.clientY - startY;
  if (delta <= 0 || !atTop()) {
    pulling = delta <= 0; // still tracking if they haven't pulled down yet
    indicator.classList.remove('visible', 'ready');
    setPull(0);
    return;
  }
  const pull = Math.min(delta, MAX_PULL);
  indicator.classList.add('visible');
  indicator.classList.toggle('ready', pull >= THRESHOLD);
  indicator.textContent = pull >= THRESHOLD ? '↑' : '↓';
  setPull(pull);
}, { passive: true });

document.addEventListener('pointerup', (e) => {
  if (!pulling || startY === null) return;
  const delta = e.clientY - startY;
  pulling = false;
  startY = null;
  if (delta >= THRESHOLD && atTop()) triggerRefresh();
  else reset();
});

document.addEventListener('pointercancel', () => {
  pulling = false;
  startY = null;
  reset();
});
