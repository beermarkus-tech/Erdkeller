// Dedicated Erinnerungen/Verbindung sub-tab switcher for the merged
// Settings card (Build 180) — same shape as js/backup-tabs.js, its own
// tiny module rather than a shared one (house convention) since a shared
// data-*-tab attribute name would cross-contaminate whichever other
// screen's own sub-tabs happen to reuse the same generic .seg-btn class.
const remindersTabBtns = document.querySelectorAll('.seg-btn[data-reminders-tab]');
const remindersTabPanels = document.querySelectorAll('.reminders-tab[data-reminders-tab-panel]');

remindersTabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    remindersTabBtns.forEach((b) => b.classList.toggle('active', b === btn));
    remindersTabPanels.forEach((p) => p.classList.toggle('hidden', p.dataset.remindersTabPanel !== btn.dataset.remindersTab));
  });
});
