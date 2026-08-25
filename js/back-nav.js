// Wires the hardware/gesture back button (Android) to the app's own
// internal "go back" actions instead of leaving it to just exit the app
// or do nothing — in a PWA the back button/gesture is a plain browser
// popstate, and with no history entry to consume there's nothing for the
// browser to intercept in the first place.
//
// One sentinel history entry represents "there's an internal back action
// available right now." Entering any of the app's four nested states
// pushes one; popstate consumes it and performs whichever of those states
// is deepest, in priority order — only one is ever meaningfully "on top"
// since they live on different screens. Leaving a nested state any other
// way (an on-screen back/close/Fertig button, switching tabs away from a
// screen left mid-flow) collapses the same entry via history.back(), so
// the sentinel never goes stale — the next real hardware back either
// keeps unwinding a still-nested state or, once there's nothing left,
// exits normally like any other screen.
//
// Deliberately scoped to nested/modal states only (Settings sub-panels,
// the check-in/check-out guided flow, Checklisten edit mode, the crisis
// reference overlay) — not bottom-nav tab switches. Switching tabs is
// peer navigation, not depth, and unwinding it on back isn't how Android
// bottom-nav apps normally behave.

const crisisReferenceEl = document.getElementById('crisis-reference');
const crisisReferenceCloseBtn = document.getElementById('crisis-reference-close');
const checklistsEditToggleBtn = document.getElementById('checklists-edit-toggle');
const checkinFlowEl = document.getElementById('stock-flow');
const checkinBackBtn = document.getElementById('checkin-back-btn');
const checkoutFlowEl = document.getElementById('stock-flow-checkout');
const checkoutBackBtn = document.getElementById('checkout-back-btn');

// Switching to a *different* bottom-nav tab doesn't reset a screen's own
// internal state (each screen only resets on erdkeller:navreset for its
// own tab — see e.g. stock-checkin.js's handler) — so a flow left mid-
// step, or a Settings panel left open, still looks "not hidden" even
// while the user is elsewhere entirely. Requiring the parent screen to
// still be .active avoids treating that as nested when it isn't visible.
function screenActive(name) {
  return !!document.querySelector(`.screen[data-screen="${name}"].active`);
}

function checkinNested() {
  return screenActive('stock') && !checkinFlowEl.classList.contains('hidden') && !checkinBackBtn.classList.contains('hidden');
}

function checkoutNested() {
  return screenActive('stock') && !checkoutFlowEl.classList.contains('hidden') && !checkoutBackBtn.classList.contains('hidden');
}

function settingsNested() {
  return screenActive('settings') && !!document.querySelector('.settings-panel:not(.hidden)');
}

function checklistsEditNested() {
  return screenActive('checklists') && checklistsEditToggleBtn.classList.contains('editing');
}

function isNested() {
  // The crisis reference is a full-screen fixed overlay covering
  // everything regardless of which screen is "active" beneath it, so it
  // doesn't need the same active-screen guard as the other three.
  return crisisReferenceEl.classList.contains('show')
    || checklistsEditNested()
    || settingsNested()
    || checkinNested()
    || checkoutNested();
}

let armed = false;

// Keeps the sentinel entry in sync with whether we're actually nested
// right now — not just arming, but also collapsing it via history.back()
// when a nested state closes through anything *other* than a hardware
// back press (tapping a screen's own on-screen back/close/Fertig button,
// or switching bottom-nav tabs away from a screen left mid-flow). Without
// this, a leftover sentinel from a state the user left another way would
// sit unconsumed — the next real hardware back would silently swallow
// one press for nothing before a second press actually did anything.
function syncArmed() {
  const nested = isNested();
  if (nested && !armed) {
    history.pushState({ erdkellerBack: true }, '');
    armed = true;
  } else if (!nested && armed) {
    armed = false;
    history.back();
  }
}

window.addEventListener('popstate', () => {
  armed = false;
  if (crisisReferenceEl.classList.contains('show')) {
    crisisReferenceCloseBtn.click();
  } else if (checklistsEditNested()) {
    checklistsEditToggleBtn.click();
  } else if (settingsNested()) {
    document.querySelector('.settings-panel:not(.hidden) [data-back]')?.click();
  } else if (checkinNested()) {
    checkinBackBtn.click();
  } else if (checkoutNested()) {
    checkoutBackBtn.click();
  }
  syncArmed();
});

// Reactive: rather than every module that opens/closes a nested state
// remembering to call something here, watch for the class changes that
// already mark each one (`.show`, `.editing`, a panel losing `.hidden`,
// a flow's back button appearing, a tab's `.active` moving) and sync from
// that alone.
new MutationObserver(() => syncArmed())
  .observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });

syncArmed();
