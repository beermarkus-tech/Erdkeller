const settingsMain = document.getElementById('settings-main');
const panels = document.querySelectorAll('.settings-panel');

function showSettingsMain() {
  panels.forEach((p) => p.classList.add('hidden'));
  settingsMain.classList.remove('hidden');
}

document.querySelectorAll('.settings-card[data-target]').forEach((card) => {
  card.addEventListener('click', () => {
    settingsMain.classList.add('hidden');
    panels.forEach((p) => p.classList.add('hidden'));
    document.getElementById('settings-panel-' + card.dataset.target).classList.remove('hidden');
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
