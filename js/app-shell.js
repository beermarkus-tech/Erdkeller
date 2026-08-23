const TAB_LABELS = {
  dashboard: 'Übersicht',
  stock: 'Bestand',
  checklists: 'Checklisten',
  info: 'Info',
  settings: 'Einstellungen',
};

const navButtons = document.querySelectorAll('.nav-btn[data-tab]');
const screens = document.querySelectorAll('.screen[data-screen]');
const topbarSubtitle = document.getElementById('topbar-subtitle');
const tabletHeader = document.getElementById('tablet-header');

let activeTab = 'dashboard';

function setActiveTab(tab) {
  activeTab = tab;
  navButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  screens.forEach((screen) => screen.classList.toggle('active', screen.dataset.screen === tab));
  topbarSubtitle.textContent = TAB_LABELS[tab] || '';
  tabletHeader.textContent = TAB_LABELS[tab] || '';
}

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
});

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
