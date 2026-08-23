const dataTabBtns = document.querySelectorAll('.seg-btn[data-data-tab]');
const dataTabPanels = document.querySelectorAll('.data-tab[data-data-tab-panel]');

dataTabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    dataTabBtns.forEach((b) => b.classList.toggle('active', b === btn));
    dataTabPanels.forEach((p) => p.classList.toggle('hidden', p.dataset.dataTabPanel !== btn.dataset.dataTab));
  });
});
