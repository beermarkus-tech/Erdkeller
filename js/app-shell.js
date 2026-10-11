import { t } from './i18n.js?v=206';
// Looked up when shown, not at load, so they follow a language switch.
const TAB_LABEL_KEYS = {
  dashboard: 'nav.uebersicht',
  stock: 'nav.bestand',
  checklists: 'nav.checklisten',
  info: 'nav.info',
  settings: 'nav.admin',
};

const navButtons = document.querySelectorAll('.nav-btn[data-tab]');
const screens = document.querySelectorAll('.screen[data-screen]');
const topbarSubtitle = document.getElementById('topbar-subtitle');
const tabletHeader = document.getElementById('tablet-header');

let activeTab = 'dashboard';

// The header (topbar subtitle on phone, tablet-header on tablet) is shared
// by several modules: the tab label by default, a sub-panel's or flow's own
// name while one is open (settings-nav.js, stock-checkin.js,
// stock-checkout.js). Each passes a function rather than a string, so the
// header can be re-rendered in the new language on erdkeller:langchange.
let headerLabel = () => '';

export function setHeader(label) {
  headerLabel = typeof label === 'function' ? label : () => label;
  const text = headerLabel();
  topbarSubtitle.textContent = text;
  tabletHeader.textContent = text;
}

window.addEventListener('erdkeller:langchange', () => setHeader(headerLabel));

function setActiveTab(tab) {
  activeTab = tab;
  navButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  screens.forEach((screen) => screen.classList.toggle('active', screen.dataset.screen === tab));
  setHeader(() => (TAB_LABEL_KEYS[tab] ? t(TAB_LABEL_KEYS[tab]) : ''));
}

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    setActiveTab(btn.dataset.tab);
    // Fires on every click, including tapping the already-active icon —
    // each screen listens and resets its own internal view back to its
    // root (e.g. Bestand's two big buttons, Admin's card list), so the
    // 5 main icons behave like a "home" button for their section no
    // matter how deep you'd navigated within it.
    window.dispatchEvent(new CustomEvent('erdkeller:navreset', { detail: { tab: btn.dataset.tab } }));
  });
});

// Exposed for tap-through "return to origin" flows (js/stock-table.js'
// Bestandsliste back button) that need to switch back to a screen
// *without* dispatching erdkeller:navreset — that reset is what gives the
// nav icons their "go to root" behavior (e.g. it wipes the Dashboard's
// expanded-category state and forces its sub-tab back to "Bestand"),
// which is exactly what a "return to exactly where I was" flow must not
// trigger.
export function switchTabWithoutReset(tab) {
  setActiveTab(tab);
}

// Settings is admin-only — not shown to members at all (SPEC.md Section 3).
window.addEventListener('erdkeller:signedin', (e) => {
  const isAdmin = e.detail.role === 'admin';
  document.querySelectorAll('.admin-only').forEach((el) => el.classList.toggle('hidden', !isAdmin));
  if (!isAdmin && activeTab === 'settings') {
    setActiveTab('dashboard');
  }
});

setActiveTab('dashboard');

// Tablet-only: .tablet-header is itself sticky (top:0) inside <main>'s
// scroll region, so a nested sticky header (e.g. Settings → Daten's back
// row + tab bar) needs to stack *below* it rather than both sticking to
// the same top:0 and overlapping. Measuring the actual rendered height
// here (via a CSS variable) keeps the stacking correct even if the
// title's font size/margins ever change, instead of guessing a fixed px
// offset. offsetHeight is 0 on mobile (tablet-header is display:none
// there), which is harmless — nothing on mobile reads this variable.
function updateStickyOffset() {
  const marginBottom = parseFloat(getComputedStyle(tabletHeader).marginBottom) || 0;
  const height = tabletHeader.offsetHeight + marginBottom;
  document.documentElement.style.setProperty('--tablet-header-stack', height + 'px');
}

window.addEventListener('resize', updateStickyOffset);
updateStickyOffset();
