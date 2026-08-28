// Dedicated Export/Import sub-tab switcher for Settings → Sicherung — a
// separate module from js/data-tabs.js (not a reuse of its selectors)
// because that module's data-data-tab/data-data-tab-panel wiring is
// global across the whole document, not scoped to one panel; sharing
// those attribute names here would cross-contaminate Daten's own
// Taxonomie/Lagerorte/Jahresfarben sub-tabs.
const backupTabBtns = document.querySelectorAll('.seg-btn[data-backup-tab]');
const backupTabPanels = document.querySelectorAll('.backup-tab[data-backup-tab-panel]');

backupTabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    backupTabBtns.forEach((b) => b.classList.toggle('active', b === btn));
    backupTabPanels.forEach((p) => p.classList.toggle('hidden', p.dataset.backupTabPanel !== btn.dataset.backupTab));
  });
});
