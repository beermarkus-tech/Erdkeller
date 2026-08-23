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
