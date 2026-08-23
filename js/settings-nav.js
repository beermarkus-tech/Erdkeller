const settingsMain = document.getElementById('settings-main');
const panels = document.querySelectorAll('.settings-panel');

document.querySelectorAll('.settings-card[data-target]').forEach((card) => {
  card.addEventListener('click', () => {
    settingsMain.classList.add('hidden');
    panels.forEach((p) => p.classList.add('hidden'));
    document.getElementById('settings-panel-' + card.dataset.target).classList.remove('hidden');
  });
});

document.querySelectorAll('.settings-panel [data-back]').forEach((btn) => {
  btn.addEventListener('click', () => {
    panels.forEach((p) => p.classList.add('hidden'));
    settingsMain.classList.remove('hidden');
  });
});
