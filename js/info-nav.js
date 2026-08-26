// Generic sub-tab switcher for the Info screen's segmented control (Step
// 13, Kontakte / Notizen / Rezepte) — same shape as the Übersicht/Daten/
// Ziele .segmented controls elsewhere, split into its own tiny module (like
// settings-nav.js/back-nav.js) since none of Contacts/Notes/Recipes should
// have to know about its sibling tabs.
const infoTabBtns = document.querySelectorAll('.seg-btn[data-info-tab]');
const infoTabPanels = document.querySelectorAll('.info-tab[data-info-tab-panel]');

infoTabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    infoTabBtns.forEach((b) => b.classList.toggle('active', b === btn));
    infoTabPanels.forEach((p) => p.classList.toggle('hidden', p.dataset.infoTabPanel !== btn.dataset.infoTab));
  });
});

// Tapping the Info nav icon (even while already on it) always returns to
// the first tab (Kontakte), same "acts like a home button" convention as
// Übersicht's own sub-tabs.
window.addEventListener('erdkeller:navreset', (e) => {
  if (e.detail.tab !== 'info') return;
  infoTabBtns.forEach((b) => b.classList.toggle('active', b.dataset.infoTab === 'contacts'));
  infoTabPanels.forEach((p) => p.classList.toggle('hidden', p.dataset.infoTabPanel !== 'contacts'));
});
