const settingsMain = document.getElementById('settings-main');
const panels = document.querySelectorAll('.settings-panel');
const topbarSubtitle = document.getElementById('topbar-subtitle');
const tabletHeader = document.getElementById('tablet-header');

// The header (topbar-subtitle/tablet-header) otherwise just shows the tab's
// own fixed label ("Admin", app-shell.js) no matter which sub-panel is
// open. Build 115: while inside a sub-panel, show that panel's own name
// instead — read straight off its card's sc-title so it can't drift out of
// sync with the card list — and restore "Admin" on the way back out.
const ADMIN_LABEL = 'Admin';

function setHeader(text) {
  topbarSubtitle.textContent = text;
  tabletHeader.textContent = text;
}

function showSettingsMain() {
  panels.forEach((p) => p.classList.add('hidden'));
  settingsMain.classList.remove('hidden');
  setHeader(ADMIN_LABEL);
}

document.querySelectorAll('.settings-card[data-target]').forEach((card) => {
  card.addEventListener('click', () => {
    settingsMain.classList.add('hidden');
    panels.forEach((p) => p.classList.add('hidden'));
    document.getElementById('settings-panel-' + card.dataset.target).classList.remove('hidden');
    const title = card.querySelector('.sc-title');
    if (title) setHeader(title.textContent);
  });
});

document.querySelectorAll('.settings-panel [data-back]').forEach((btn) => {
  btn.addEventListener('click', showSettingsMain);
});

// Tapping the Admin nav icon (even while already on it) always returns to
// the card list, regardless of which subsection was open.
window.addEventListener('erdkeller:navreset', (e) => {
  if (e.detail.tab === 'settings') showSettingsMain();
});
