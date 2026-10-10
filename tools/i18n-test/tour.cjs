// Click tour for run.cjs. Steps run in order in one page and each leaves the
// app in a state worth snapshotting. Selectors are ids / data-* / classes,
// never visible text, so the same tour runs in every language.
const vis = (page, sel) => page.locator(sel).filter({ visible: true });
const c = (sel, n = 0) => async (page) => vis(page, sel).nth(n).click({ timeout: 2000 });
const seq = (...fns) => async (page) => { for (const f of fns) { await f(page); await page.clock.runFor(400); } };
const nav = (tab) => c(`.sidebar .nav-btn[data-tab="${tab}"]`);
const fill = (sel, value) => async (page) => vis(page, sel).first().fill(value, { timeout: 2000 });
const press = (key) => async (page) => page.keyboard.press(key);
// Modals close on a tap on the dimmed overlay itself (e.target === overlay);
// dispatched directly because some sheets cover the whole viewport.
const closeModal = async (page) => {
  await page.evaluate(() => {
    [...document.querySelectorAll('.modal-overlay.show')].reverse()
      .forEach((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  });
};

module.exports = [
  // --- Übersicht ---------------------------------------------------------
  { name: 'dashboard: boot', run: async () => {} },
  { name: 'dashboard: unit g/P/T', run: c('#dash-unit-toggle [data-unit="kgpd"]') },
  { name: 'dashboard: unit kcal', run: c('#dash-unit-toggle [data-unit="kcal"]') },
  { name: 'dashboard: unit kcal/P/T', run: c('#dash-unit-toggle [data-unit="kcalpd"]') },
  { name: 'dashboard: expand category', run: seq(c('#dash-unit-toggle [data-unit="kg"]'), c('.dash-cat-card .dash-cat-head', 0)) },
  { name: 'dashboard: MHD 1 Monat', run: c('[data-dash-tab="mhd"]') },
  { name: 'dashboard: MHD erreicht', run: c('#alerts-horizon-toggle [data-horizon="reached"]') },
  { name: 'dashboard: MHD 12 Monate', run: c('#alerts-horizon-toggle [data-horizon="12"]') },
  { name: 'dashboard: Einkaufsliste', run: c('[data-dash-tab="shopping"]') },
  { name: 'dashboard: checklist warning → checklists', run: seq(c('[data-dash-tab="stock"]'), c('#dash-checklist-warning')) },

  // --- Checklisten ---------------------------------------------------------
  { name: 'checklists: Wartung alle', run: seq(nav('checklists'), c('#maintenance-filter-toggle [data-filter="all"]')) },
  { name: 'checklists: list filter chip', run: c('#maintenance-live-list-filters .filter-chip', 1) },
  { name: 'checklists: freq filter chip', run: seq(c('#maintenance-live-list-filters .filter-chip', 0), c('#maintenance-live-freq-filters .filter-chip', 1)) },
  { name: 'checklists: tick item', run: seq(c('#maintenance-live-freq-filters .filter-chip', 0), c('#maintenance-list .checklist-item-check', 0)) },
  { name: 'checklists: edit mode lists', run: c('#checklists-edit-toggle') },
  { name: 'checklists: edit mode items', run: c('[data-maintenance-edit-tab="items"]') },
  { name: 'checklists: new item', run: c('#add-maintenance-item-btn') },
  { name: 'checklists: new list', run: seq(c('[data-maintenance-edit-tab="lists"]'), c('#add-maintenance-list-btn')) },
  { name: 'checklists: leave edit', run: c('#checklists-edit-toggle') },
  { name: 'checklists: Krise', run: c('[data-checklists-tab="crisis"]') },
  { name: 'checklists: crisis reference', run: c('#crisis-list .crisis-card', 0) },
  { name: 'checklists: crisis edit', run: seq(c('#crisis-reference-close'), c('#checklists-edit-toggle')) },
  { name: 'checklists: crisis new type', run: c('#add-crisis-type-btn') },
  { name: 'checklists: crisis leave edit', run: seq(c('#checklists-edit-toggle'), c('[data-checklists-tab="maintenance"]')) },

  // --- Bestand: Einlagern ------------------------------------------------------
  { name: 'stock: home', run: nav('stock') },
  { name: 'checkin: types', run: c('#start-checkin-btn') },
  { name: 'checkin: search', run: fill('#global-product-search', 'Spa') },
  { name: 'checkin: categories', run: seq(fill('#global-product-search', ''), c('#type-grid .tile', 0)) },
  { name: 'checkin: subcategories', run: c('.flow-step.active .tile', 0) },
  { name: 'checkin: products', run: c('.flow-step.active .tile', 0) },
  { name: 'checkin: new product form', run: c('.flow-step.active .stock-product-row.add-new') },
  { name: 'checkin: back', run: c('#checkin-back-btn') },
  { name: 'checkin: detail form', run: c('.flow-step.active .stock-product-row:not(.add-new)', 0) },
  { name: 'checkin: date picker', run: c('#bestbefore-display') },
  { name: 'checkin: confirm', run: seq(closeModal, c('#checkin-confirm-btn')) },
  { name: 'checkin: undo', run: c('#undo-btn') },
  { name: 'checkin: back home', run: seq(nav('stock')) },

  // --- Bestand: Entnehmen ---------------------------------------------------
  { name: 'checkout: types', run: c('#start-checkout-btn') },
  { name: 'checkout: categories', run: c('#stock-flow-checkout .flow-step.active .tile', 0) },
  { name: 'checkout: subcategories', run: c('#stock-flow-checkout .flow-step.active .tile', 0) },
  { name: 'checkout: batches', run: c('#stock-flow-checkout .flow-step.active .tile', 0) },
  { name: 'checkout: detail', run: c('#stock-flow-checkout .flow-step.active .stock-product-row', 0) },
  { name: 'checkout: confirm', run: c('#checkout-confirm-btn') },
  { name: 'checkout: undo', run: c('#checkout-undo-btn') },

  // --- Diktieren ------------------------------------------------------------
  { name: 'dictate: open', run: seq(nav('stock'), c('#start-dictate-btn')) },
  { name: 'dictate: close', run: c('#dictate-close-btn') },

  // --- Info -----------------------------------------------------------------
  { name: 'info: contacts', run: nav('info') },
  { name: 'info: contact detail', run: c('[data-info-tab-panel="contacts"] .stock-product-row', 1) },
  { name: 'info: contact edit', run: c('#contact-edit-btn') },
  { name: 'info: notes', run: seq(closeModal, c('[data-info-tab="notes"]')) },
  { name: 'info: note view', run: c('.note-card', 0) },
  { name: 'info: note edit', run: c('#note-view-edit-btn') },
  { name: 'info: notes list mode', run: seq(closeModal, closeModal, c('#notes-view-toggle [data-view="list"]')) },
  { name: 'info: recipes', run: c('[data-info-tab="recipes"]') },
  { name: 'info: recipe tag filter', run: c('[data-info-tab-panel="recipes"] .filter-chip', 1) },
  { name: 'info: recipe view', run: seq(c('[data-info-tab-panel="recipes"] .filter-chip', 0), c('.recipe-card', 0)) },
  { name: 'info: recipe edit', run: c('#recipe-view-edit-btn') },
  { name: 'info: recipe edit closed', run: seq(closeModal, closeModal) },

  // --- Admin ----------------------------------------------------------------
  { name: 'settings: menu', run: nav('settings') },
  { name: 'settings: taxonomy', run: c('.settings-card[data-target="data"]') },
  { name: 'settings: taxonomy expanded', run: c('#expand-all-btn') },
  { name: 'settings: storage', run: c('[data-data-tab="storage"]') },
  { name: 'settings: year colors', run: c('[data-data-tab="colors"]') },
  { name: 'settings: stock table', run: seq(nav('settings'), c('.settings-card[data-target="stocktable"]')) },
  { name: 'settings: stock table edit row', run: c('#settings-panel-stocktable .stock-product-row', 1) },
  { name: 'settings: stock table filters', run: seq(closeModal, c('#table-filters-panel .filter-chip', 0)) },
  { name: 'settings: stock table select', run: seq(c('#table-filters-reset-btn'), c('#table-select-mode-btn'), c('#settings-panel-stocktable .stock-product-row', 1)) },
  { name: 'settings: log', run: seq(nav('settings'), c('.settings-card[data-target="log"]')) },
  { name: 'settings: log clear (dismissed)', run: c('#log-clear-btn') },
  { name: 'settings: people', run: seq(nav('settings'), c('.settings-card[data-target="people"]')) },
  { name: 'settings: notifications', run: seq(nav('settings'), c('.settings-card[data-target="notifications"]')) },
  { name: 'settings: verbindung', run: c('[data-reminders-tab="verbindung"]') },
  { name: 'settings: planning', run: seq(nav('settings'), c('.settings-card[data-target="planning"]')) },
  { name: 'settings: targets categories', run: seq(nav('settings'), c('.settings-card[data-target="targets"]')) },
  { name: 'settings: targets food', run: c('[data-ziele-tab="food"]') },
  { name: 'settings: targets food picker', run: c('#add-product-target-btn') },
  { name: 'settings: targets nonfood', run: seq(closeModal, c('[data-ziele-tab="nonfood"]')) },
  { name: 'settings: targets nonfood edit', run: c('[data-ziele-tab-panel="nonfood"] .stock-product-row', 0) },
  { name: 'settings: export', run: seq(closeModal, nav('settings'), c('.settings-card[data-target="export"]')) },
  { name: 'settings: import', run: c('[data-backup-tab="import"]') },
  { name: 'settings: pdf', run: c('[data-backup-tab="pdf"]') },
];
