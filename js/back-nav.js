// Wires the hardware/gesture back button (Android) to the app's own
// internal "go back" actions instead of leaving it to exit the app or do
// nothing — in a PWA the back button/gesture is a plain browser popstate,
// and with no history entry to consume there's nothing for the browser
// to intercept in the first place.
//
// Priority, checked on every back press: (1) unwind whichever of the four
// nested states is deepest — Settings sub-panel, Stock guided flow,
// Checklisten edit mode, crisis reference overlay (only one is ever
// meaningfully "on top", since they live on different screens); (2) if
// nothing's nested but a different bottom-nav tab is active, switch to
// Dashboard — the floor; (3) if already at the floor (Dashboard, nothing
// nested), absorb the press and do nothing further. The app is never
// supposed to actually exit via back while signed in, so a sentinel
// history entry is kept pushed at all times: consumed by popstate, then
// immediately re-pushed after handling it, so there's always another one
// waiting for the next press.

const crisisReferenceEl = document.getElementById('crisis-reference');
const crisisReferenceCloseBtn = document.getElementById('crisis-reference-close');
const noteEditModalEl = document.getElementById('note-edit-modal');
const noteEditBackBtn = document.getElementById('note-edit-back-btn');
const noteViewModalEl = document.getElementById('note-view-modal');
const noteViewCloseBtn = document.getElementById('note-view-close-btn');
const recipeEditModalEl = document.getElementById('recipe-edit-modal');
const recipeEditBackBtn = document.getElementById('recipe-edit-back-btn');
const recipeViewModalEl = document.getElementById('recipe-view-modal');
const recipeViewCloseBtn = document.getElementById('recipe-view-close-btn');
const checklistsEditToggleBtn = document.getElementById('checklists-edit-toggle');
const checkinFlowEl = document.getElementById('stock-flow');
const checkinBackBtn = document.getElementById('checkin-back-btn');
const checkoutFlowEl = document.getElementById('stock-flow-checkout');
const checkoutBackBtn = document.getElementById('checkout-back-btn');
const appEl = document.getElementById('app');
const dashboardNavBtn = document.querySelector('.nav-btn[data-tab="dashboard"]');

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

function appVisible() {
  return !appEl.classList.contains('hidden');
}

let armed = false;

function ensureArmed() {
  if (armed || !appVisible()) return;
  history.pushState({ erdkellerBack: true }, '');
  armed = true;
}

window.addEventListener('popstate', () => {
  armed = false;
  if (crisisReferenceEl.classList.contains('show')) {
    crisisReferenceCloseBtn.click();
  } else if (noteEditModalEl.classList.contains('show')) {
    // Notizen's edit screen (Build 103) autosaves on close (js/notes.js's
    // closeEditScreen) rather than on a Speichern tap — routing the
    // hardware/gesture back button through its own back button, same as
    // every other nested state below, is what makes that flush actually
    // run instead of the press silently falling through to "switch to
    // Dashboard" and leaving the last edit stranded unsaved behind it.
    noteEditBackBtn.click();
  } else if (noteViewModalEl.classList.contains('show')) {
    noteViewCloseBtn.click();
  } else if (recipeEditModalEl.classList.contains('show')) {
    // Rezepte's edit screen (js/recipes.js) autosaves the same way Notizen's
    // does — same reasoning as the noteEditModalEl branch above.
    recipeEditBackBtn.click();
  } else if (recipeViewModalEl.classList.contains('show')) {
    recipeViewCloseBtn.click();
  } else if (checklistsEditNested()) {
    checklistsEditToggleBtn.click();
  } else if (settingsNested()) {
    document.querySelector('.settings-panel:not(.hidden) [data-back]')?.click();
  } else if (checkinNested()) {
    checkinBackBtn.click();
  } else if (checkoutNested()) {
    checkoutBackBtn.click();
  } else if (!screenActive('dashboard')) {
    dashboardNavBtn?.click();
  }
  // Already at the floor (Dashboard, nothing nested) — nothing left to
  // do, the press is simply absorbed.
  ensureArmed();
});

// Re-arms reactively on any relevant class change (a nested state opening
// or closing, a tab switching, signing in) rather than requiring every
// module that touches one of those to remember to call something here.
new MutationObserver(() => ensureArmed())
  .observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });

ensureArmed();
