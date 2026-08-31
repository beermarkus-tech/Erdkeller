import { db } from './firebase-init.js?v=147';
import { PALETTE } from './year-colors.js?v=147';
import { openAddFlow } from './stock-checkin.js?v=147';
import { switchTabWithoutReset } from './app-shell.js?v=147';
import {
  doc, getDoc, collection, getDocs, deleteDoc, updateDoc, setDoc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const stocktableCard = document.querySelector('.settings-card[data-target="stocktable"]');
const settingsPanelStocktable = document.getElementById('settings-panel-stocktable');

const selectModeBtn = document.getElementById('table-select-mode-btn');
const addBtn = document.getElementById('table-add-btn');
const searchInput = document.getElementById('table-search-input');
const subcatFilterBanner = document.getElementById('table-subcat-filter-banner');
const subcatFilterLabel = document.getElementById('table-subcat-filter-label');
const subcatFilterClearBtn = document.getElementById('table-subcat-filter-clear');
const filtersToggleBtn = document.getElementById('table-filters-toggle-btn');
const filtersResetBtn = document.getElementById('table-filters-reset-btn');
const filtersPanel = document.getElementById('table-filters-panel');
const filtersApplyBtn = document.getElementById('table-filters-apply-btn');
const typeFilterRow = document.getElementById('table-type-filters');
const categoryFilterRow = document.getElementById('table-category-filters');
const subcategoryFilterRow = document.getElementById('table-subcategory-filters');
const storageFilterRow = document.getElementById('table-storage-filters');
const sortBarEl = document.getElementById('table-sort-bar');
const rowListEl = document.getElementById('table-row-list');

const bulkBar = document.getElementById('table-bulk-bar');
const bulkCountEl = document.getElementById('table-bulk-count');
const bulkCancelBtn = document.getElementById('table-bulk-cancel-btn');
const bulkDeleteBtn = document.getElementById('table-bulk-delete-btn');

const editModal = document.getElementById('table-edit-modal');
const editEmptyEl = document.getElementById('table-edit-empty');
const editFormEl = document.getElementById('table-edit-form');
const editTitleEl = document.getElementById('table-edit-title');
const editBatchFieldsEl = document.getElementById('table-edit-batch-fields');
const editNoStockNoteEl = document.getElementById('table-edit-no-stock-note');
const editNameInput = document.getElementById('table-edit-name');
const editQtyNumEl = document.getElementById('table-edit-qty-num');
const editQtyMinusBtn = document.getElementById('table-edit-qty-minus');
const editQtyPlusBtn = document.getElementById('table-edit-qty-plus');
const editDetailsInput = document.getElementById('table-edit-details');
const editContentGroup = document.getElementById('table-edit-content-group');
const editContentInput = document.getElementById('table-edit-content');
const editBestBeforeDisplay = document.getElementById('table-edit-bestbefore-display');
const editBestBeforeInput = document.getElementById('table-edit-bestbefore-input');
const editStorageSelect = document.getElementById('table-edit-storage');
const editSaveBtn = document.getElementById('table-edit-save-btn');
const editDeleteBtn = document.getElementById('table-edit-delete-btn');

const dateModal = document.getElementById('table-date-modal');
const monthCol = document.getElementById('table-month-col');
const yearCol = document.getElementById('table-year-col');
const dateModalConfirmBtn = document.getElementById('table-date-modal-confirm');

// Sortable columns shown as tap-to-sort badges above the list (Build 100:
// Subcategory/Category/Type/Storage dropped — those already have their own
// dedicated filter chips, sorting by them added little beyond what the
// filters already do). sortValue()/compareBatches() below still resolve
// all eight batch fields regardless — this only trims which ones the admin
// can pick as the *explicit* sort column; the multi-key fallback sort when
// none is picked is unaffected.
const COLUMNS = [
  { key: 'product', label: 'Produkt' },
  { key: 'quantity', label: 'Menge' },
  { key: 'content', label: 'Inhalt' },
  { key: 'bestBefore', label: 'MHD' },
];

const COLOR_HEX = Object.fromEntries(PALETTE.map((c) => [c.name, c.hex]));

let taxonomy = { types: [] };
let storageLocations = [];
let yearColorMap = { none: 'white' };
let targets = { products: {} };
let allProducts = [];
let allBatches = [];
let productIndex = new Map();

let searchText = '';
// Set only via openFilteredBySubcategory (a tap-through from Übersicht,
// Step 10) — matched by subcategoryId via the product, never by the
// batch's own denormalized subcategory name string, so a rename in
// Taxonomie can't silently break it.
let activeSubcategoryFilter = null;
let activeSubcategoryFilterName = '';
let selectedTypes = new Set();
let selectedCategories = new Set();
let selectedSubcategories = new Set();
let selectedStorages = new Set();
let sortColumn = null;
let sortDir = 'asc';
let selectMode = false;
let selectedIds = new Set();
let editingBatch = null;
// Set to the origin tab ('dashboard' or 'stock') only by
// openFilteredBySubcategory/openFilteredByProductSearch (tap-throughs from
// Übersicht, Step 10) or the stockOpenTableBtn handler (Bestand's own
// admin-only shortcut, Build 101) — tells the panel's own back button to
// switch back to that origin tab *without* the normal nav-icon reset (see
// switchTabWithoutReset), instead of the generic "Admin main menu" default.
// Every tap-through origin lands on the exact screen it left, since
// skipping that reset means nothing there was ever torn down. Cleared
// whenever the panel is opened the normal way (tapping the Bestandsliste
// card itself).
let returnTarget = null;
let pendingMonthIndex = 0;
let pendingYearIndex = 0;
let years = [];
let months = [];

// --- Data loading ---------------------------------------------------------

async function loadConfig() {
  try {
    const [taxSnap, storeSnap, colorSnap, targetsSnap, productsSnap, batchesSnap] = await Promise.all([
      getDoc(doc(db, 'config', 'taxonomy')),
      getDoc(doc(db, 'config', 'storageLocations')),
      getDoc(doc(db, 'config', 'yearColorMap')),
      getDoc(doc(db, 'config', 'targets')),
      getDocs(collection(db, 'products')),
      getDocs(collection(db, 'stockItems')),
    ]);
    taxonomy = taxSnap.exists() && Array.isArray(taxSnap.data().types) ? taxSnap.data() : { types: [] };
    storageLocations = storeSnap.exists() && Array.isArray(storeSnap.data().locations) ? storeSnap.data().locations : [];
    yearColorMap = colorSnap.exists() && colorSnap.data() ? colorSnap.data() : { none: 'white' };
    targets = targetsSnap.exists() && targetsSnap.data() ? targetsSnap.data() : { products: {} };
    if (!targets.products) targets.products = {};
    allProducts = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    allBatches = batchesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    productIndex = new Map(allProducts.map((p) => [p.id, p]));
  } catch (err) {
    console.error(err);
  }
}

function productName(productId) {
  const p = productIndex.get(productId);
  return p ? p.name : '(unbekanntes Produkt)';
}

function batchMetaLine(batch) {
  const parts = [`${batch.quantity}×`];
  if (batch.details) parts.push(batch.details);
  if (batch.content) parts.push(batch.content);
  if (batch.bestBefore) parts.push(`MHD ${batch.bestBefore}`);
  if (batch.storage) parts.push(batch.storage);
  return parts.join(' · ');
}

function normalizeContent(raw) {
  const trimmed = (raw || '').trim();
  return /^\d+([.,]\d+)?$/.test(trimmed) ? trimmed + 'g' : trimmed;
}

function yearColorFor(bestBefore) {
  if (!bestBefore) return 'none';
  const year = bestBefore.split('/')[1];
  return (yearColorMap && yearColorMap[year]) || 'none';
}

// See js/taxonomy.js's typeClass for the fallback-derivation rationale.
function typeClass(type) {
  if (type.typeClass) return type.typeClass;
  return type.isFoodType ? 'food' : 'other';
}

function findSubcategoryContext(subcategoryId) {
  for (const type of taxonomy.types || []) {
    for (const cat of (type.categories || [])) {
      for (const sub of (cat.subcategories || [])) {
        if (sub.id === subcategoryId) return { type, cat, sub };
      }
    }
  }
  return null;
}

// Typ › Kategorie › Unterkategorie, symbols included — resolved live from
// Taxonomie via the product's own subcategoryId (same approach as
// js/targets.js's productContextLabel), not from a batch's own frozen
// type/category/subcategory text snapshot: that snapshot never carried
// symbols in the first place, and resolving live also means a rename in
// Taxonomie shows up here immediately instead of staying stuck at
// whatever the text said at check-in time. Falls back to that frozen
// snapshot only when live resolution fails (orphaned/deleted subcategory).
function rowBreadcrumb(batch) {
  const product = productIndex.get(batch.productId);
  const ctx = product ? findSubcategoryContext(product.subcategoryId) : null;
  if (!ctx) {
    return [batch.type, batch.category, batch.subcategory].filter(Boolean).join(' › ');
  }
  const { type, cat, sub } = ctx;
  const typePart = type.sym ? `${type.sym} ${type.name}` : type.name;
  const catPart = cat.sym ? `${cat.sym} ${cat.name}` : cat.name;
  // A Wasser subcategory's name mirrors its category (js/taxonomy.js's
  // ensureWaterSubcategory) — skip the redundant repeat.
  if (sub.name === cat.name) return `${typePart} › ${catPart}`;
  const subPart = sub.sym ? `${sub.sym} ${sub.name}` : sub.name;
  return `${typePart} › ${catPart} › ${subPart}`;
}

// --- Products without any stock (Build 96, revised Build 98) --------------
// filteredBatches() below shows these as synthetic rows alongside real
// batches. Since Build 98, checking a product's last batch out to zero
// (js/stock-checkout.js) already auto-deletes it from the catalog unless it
// has an active Ziele target — so in the normal case a plain zero-stock
// product never reaches here at all, it's just gone. These rows are for
// what that auto-delete deliberately doesn't cover: a product still
// tracked by a target (shown with that target inline, so it's clear why
// it's here and what to restock), and any straggler that reached zero
// stock some other way (a manual Bestandsliste batch delete, pre-Build-98
// legacy data) — Bestandsliste stays the one place an admin can see and
// clean up every product, no exceptions, via "Produkt löschen" below.
// type/category/subcategory are resolved live from Taxonomie via the
// product's own subcategoryId — unlike a real batch, which freezes those as
// plain text at check-in time — so a product whose subcategory no longer
// exists shows that honestly instead of silently defaulting somewhere.
function unitLabelForTarget(unit) {
  if (unit === 'kg' || unit === 'l') return unit;
  if (unit === 'stueck') return 'Stk';
  return unit || 'kg';
}

// Product targets are always mode:'flat' (see js/targets.js) — no
// Personen×Tage variant to branch on here.
function targetLabel(target) {
  if (!target) return '';
  return `${target.amount || 0} ${unitLabelForTarget(target.unit)}`;
}

function phantomBatchFor(product) {
  const ctx = findSubcategoryContext(product.subcategoryId);
  return {
    id: null,
    productId: product.id,
    quantity: 0,
    details: '',
    content: '',
    bestBefore: '',
    yearColor: 'none',
    storage: '',
    type: ctx ? ctx.type.name : '',
    category: ctx ? ctx.cat.name : '',
    subcategory: ctx ? ctx.sub.name : (product.subcategoryId ? '⚠️ Unterkategorie fehlt' : ''),
    target: targets.products[product.id] || null,
  };
}

function allRows() {
  const withStock = new Set(allBatches.map((b) => b.productId));
  const phantoms = allProducts.filter((p) => !withStock.has(p.id)).map(phantomBatchFor);
  return allBatches.concat(phantoms);
}

// --- Filter chip entries (Typ/Kategorie/Unterkategorie, Build 96) ---------
// Each level cascades from the one above: with no Typ selected, Kategorie
// shows every category across every type; select one or more Typ chips and
// Kategorie narrows to just those types' categories (and any Kategorie
// selection that's no longer among them gets cleared — see
// pruneInvalidSelections) — then Unterkategorie narrows the same way off
// whichever Kategorie chips are selected. cls drives the green/Lebensmittel,
// blue/Wasser, plain/Sonstiges chip tint (see css .filter-chip.chip-food/
// .chip-water) — same convention as the Taxonomie editor's type rows.

function allTypeChipEntries() {
  return (taxonomy.types || []).map((t) => ({ name: t.name, cls: typeClass(t) }));
}

function allCategoryChipEntries() {
  const map = new Map();
  (taxonomy.types || []).forEach((type) => {
    if (selectedTypes.size && !selectedTypes.has(type.name)) return;
    (type.categories || []).forEach((cat) => {
      if (!map.has(cat.name)) map.set(cat.name, typeClass(type));
    });
  });
  return Array.from(map, ([name, cls]) => ({ name, cls })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function allSubcategoryChipEntries() {
  const map = new Map();
  (taxonomy.types || []).forEach((type) => {
    if (selectedTypes.size && !selectedTypes.has(type.name)) return;
    (type.categories || []).forEach((cat) => {
      if (selectedCategories.size && !selectedCategories.has(cat.name)) return;
      (cat.subcategories || []).forEach((sub) => {
        if (!map.has(sub.name)) map.set(sub.name, typeClass(type));
      });
    });
  });
  return Array.from(map, ([name, cls]) => ({ name, cls })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function pruneInvalidSelections(selectedSet, validNames) {
  const valid = new Set(validNames);
  Array.from(selectedSet).forEach((name) => {
    if (!valid.has(name)) selectedSet.delete(name);
  });
}

// --- Sorting & filtering ---------------------------------------------------

function sortValue(batch, key) {
  switch (key) {
    case 'product': return productName(batch.productId);
    case 'subcategory': return batch.subcategory || '';
    case 'category': return batch.category || '';
    case 'type': return batch.type || '';
    case 'quantity': return batch.quantity || 0;
    case 'content': return batch.content || '';
    case 'bestBefore': {
      if (!batch.bestBefore) return null;
      const [mm, yyyy] = batch.bestBefore.split('/');
      return Number(yyyy) * 100 + Number(mm);
    }
    case 'storage': return batch.storage || '';
    default: return '';
  }
}

function compareValues(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'de');
}

function compareBatches(a, b) {
  if (sortColumn) {
    return compareValues(sortValue(a, sortColumn), sortValue(b, sortColumn)) * (sortDir === 'asc' ? 1 : -1);
  }
  for (const key of ['product', 'subcategory', 'category', 'type']) {
    const c = compareValues(sortValue(a, key), sortValue(b, key));
    if (c !== 0) return c;
  }
  return 0;
}

function filteredBatches() {
  const q = searchText.trim().toLowerCase();
  return allRows().filter((b) => {
    if (activeSubcategoryFilter) {
      const product = productIndex.get(b.productId);
      if (!product || product.subcategoryId !== activeSubcategoryFilter) return false;
    }
    if (selectedTypes.size && !selectedTypes.has(b.type)) return false;
    if (selectedCategories.size && !selectedCategories.has(b.category)) return false;
    if (selectedSubcategories.size && !selectedSubcategories.has(b.subcategory)) return false;
    if (selectedStorages.size && !selectedStorages.has(b.storage)) return false;
    if (q) {
      const name = productName(b.productId).toLowerCase();
      const details = (b.details || '').toLowerCase();
      if (!name.includes(q) && !details.includes(q)) return false;
    }
    return true;
  });
}

// --- Filter chips & sort bar ------------------------------------------

function renderChips(container, values, selectedSet) {
  container.innerHTML = '';
  values.forEach((v) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'filter-chip' + (selectedSet.has(v) ? ' active' : '');
    chip.textContent = v;
    chip.addEventListener('click', () => {
      if (selectedSet.has(v)) selectedSet.delete(v);
      else selectedSet.add(v);
      renderChips(container, values, selectedSet);
      renderRows();
    });
    container.appendChild(chip);
  });
}

// Typ/Kategorie/Unterkategorie chips (Build 96) — tinted by type-class and
// re-rendered as a full cascade on every click (see refreshHierarchyChips),
// unlike the plain renderChips above.
function renderHierarchyChips(container, entries, selectedSet, onToggle) {
  container.innerHTML = '';
  entries.forEach(({ name, cls }) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    const tint = cls === 'food' ? ' chip-food' : cls === 'water' ? ' chip-water' : '';
    chip.className = 'filter-chip' + tint + (selectedSet.has(name) ? ' active' : '');
    chip.textContent = name;
    chip.addEventListener('click', () => {
      if (selectedSet.has(name)) selectedSet.delete(name);
      else selectedSet.add(name);
      onToggle();
    });
    container.appendChild(chip);
  });
}

// Re-derives and re-renders all three cascading rows top-down on every
// click at any level — simpler and cheap enough at household-catalog scale
// than trying to patch just the affected row(s), and it's what keeps a
// stale selection from lingering (e.g. a Kategorie chip selected before its
// Typ was deselected) via pruneInvalidSelections at each level.
function refreshHierarchyChips() {
  renderHierarchyChips(typeFilterRow, allTypeChipEntries(), selectedTypes, () => {
    refreshHierarchyChips();
    renderRows();
  });

  const catEntries = allCategoryChipEntries();
  pruneInvalidSelections(selectedCategories, catEntries.map((e) => e.name));
  renderHierarchyChips(categoryFilterRow, catEntries, selectedCategories, () => {
    refreshHierarchyChips();
    renderRows();
  });

  const subEntries = allSubcategoryChipEntries();
  pruneInvalidSelections(selectedSubcategories, subEntries.map((e) => e.name));
  renderHierarchyChips(subcategoryFilterRow, subEntries, selectedSubcategories, () => {
    refreshHierarchyChips();
    renderRows();
  });
}

function renderFilters() {
  refreshHierarchyChips();
  renderChips(storageFilterRow, storageLocations, selectedStorages);
}

function renderSortBar() {
  sortBarEl.innerHTML = '';
  COLUMNS.forEach((col) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sort-btn' + (sortColumn === col.key ? ' active' : '');
    const arrow = sortColumn === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    btn.textContent = col.label + arrow;
    btn.addEventListener('click', () => {
      if (sortColumn === col.key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortColumn = col.key;
        sortDir = 'asc';
      }
      renderSortBar();
      renderRows();
    });
    sortBarEl.appendChild(btn);
  });
}

// --- Row rendering ---------------------------------------------------------

function makeYearBadge(batch) {
  const wrap = document.createElement('span');
  wrap.className = 'year-badge';
  const dot = document.createElement('span');
  dot.className = 'year-dot';
  const label = document.createElement('span');
  label.className = 'year-badge-label';
  if (batch.bestBefore && batch.yearColor && batch.yearColor !== 'none' && COLOR_HEX[batch.yearColor]) {
    dot.style.background = COLOR_HEX[batch.yearColor];
    label.textContent = batch.bestBefore.split('/')[1] || '';
  } else {
    dot.style.background = 'var(--stone-dark)';
    label.textContent = '–';
  }
  wrap.appendChild(dot);
  wrap.appendChild(label);
  return wrap;
}

function renderRow(batch) {
  const isPhantom = batch.id === null;
  const row = document.createElement('div');
  row.className = 'stock-product-row' + (editingBatch && editingBatch.id === batch.id ? ' selected' : '') + (isPhantom ? ' no-stock' : '');

  if (selectMode) {
    // A product with no stock has no stockItem doc to bulk-delete — select
    // mode simply doesn't apply to it, so its checkbox slot stays empty
    // rather than offering a control that can't do anything.
    if (!isPhantom) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'select-checkbox';
      cb.checked = selectedIds.has(batch.id);
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        if (cb.checked) selectedIds.add(batch.id);
        else selectedIds.delete(batch.id);
        updateBulkBar();
      });
      row.appendChild(cb);
    }
  } else {
    row.appendChild(makeYearBadge(batch));
  }

  const textWrap = document.createElement('span');
  textWrap.style.display = 'flex';
  textWrap.style.flexDirection = 'column';
  textWrap.style.flex = '1';

  const nameEl = document.createElement('span');
  nameEl.className = 'pname';
  nameEl.textContent = productName(batch.productId);

  const metaEl = document.createElement('span');
  metaEl.className = 'pmeta';
  metaEl.textContent = isPhantom
    ? (batch.target ? `Kein Bestand · Ziel: ${targetLabel(batch.target)}` : 'Kein Bestand')
    : batchMetaLine(batch);

  const subEl = document.createElement('span');
  subEl.className = 'table-row-sub';
  subEl.textContent = rowBreadcrumb(batch);

  textWrap.appendChild(nameEl);
  textWrap.appendChild(metaEl);
  textWrap.appendChild(subEl);
  row.appendChild(textWrap);

  row.addEventListener('click', () => {
    if (selectMode) {
      if (isPhantom) return;
      if (selectedIds.has(batch.id)) selectedIds.delete(batch.id);
      else selectedIds.add(batch.id);
      renderRows();
    } else {
      openEditModal(batch);
    }
  });

  return row;
}

function renderSubcatFilterBanner() {
  if (activeSubcategoryFilter) {
    subcatFilterLabel.textContent = `Unterkategorie: ${activeSubcategoryFilterName}`;
    subcatFilterBanner.classList.remove('hidden');
  } else {
    subcatFilterBanner.classList.add('hidden');
  }
}

subcatFilterClearBtn.addEventListener('click', () => {
  activeSubcategoryFilter = null;
  activeSubcategoryFilterName = '';
  renderSubcatFilterBanner();
  renderRows();
});

// --- Filter panel: mobile full-screen sidebar / tablet inline (Build 99) -
// The Typ/Kategorie/Unterkategorie/Lagerort chip rows themselves render
// into #table-filters-panel regardless of layout — only the CSS repositions
// that panel between a slide-in sidebar (mobile) and plain inline flow
// (tablet, see the min-width:900px override), so none of the chip-rendering
// functions above need to know which layout is active.
filtersToggleBtn.addEventListener('click', () => {
  filtersPanel.classList.add('show');
});

filtersApplyBtn.addEventListener('click', () => {
  filtersPanel.classList.remove('show');
});

filtersResetBtn.addEventListener('click', () => {
  selectedTypes.clear();
  selectedCategories.clear();
  selectedSubcategories.clear();
  selectedStorages.clear();
  renderFilters();
  renderRows();
});

function updateFiltersToggleState() {
  const anyActive = selectedTypes.size || selectedCategories.size || selectedSubcategories.size || selectedStorages.size;
  filtersToggleBtn.classList.toggle('active', Boolean(anyActive));
}

function renderRows() {
  renderSubcatFilterBanner();
  updateFiltersToggleState();
  rowListEl.innerHTML = '';
  const rows = filteredBatches().sort(compareBatches);
  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'screen-placeholder';
    empty.textContent = 'Keine Treffer.';
    rowListEl.appendChild(empty);
  } else {
    rows.forEach((batch) => rowListEl.appendChild(renderRow(batch)));
  }
  updateBulkBar();
}

searchInput.addEventListener('input', () => {
  searchText = searchInput.value;
  renderRows();
});

// --- Select mode & bulk delete ------------------------------------------

addBtn.addEventListener('click', () => openAddFlow());

selectModeBtn.addEventListener('click', () => {
  selectMode = !selectMode;
  selectModeBtn.classList.toggle('active', selectMode);
  selectModeBtn.textContent = selectMode ? 'Fertig' : 'Auswählen';
  if (!selectMode) selectedIds.clear();
  renderRows();
});

function updateBulkBar() {
  if (!selectMode || selectedIds.size === 0) {
    bulkBar.classList.add('hidden');
    return;
  }
  bulkBar.classList.remove('hidden');
  bulkCountEl.textContent = `${selectedIds.size} ausgewählt`;
}

bulkCancelBtn.addEventListener('click', () => {
  selectedIds.clear();
  renderRows();
});

bulkDeleteBtn.addEventListener('click', async () => {
  if (selectedIds.size === 0) return;
  if (!confirm(`${selectedIds.size} Bestandseinträge löschen?`)) return;
  const ids = Array.from(selectedIds);
  bulkDeleteBtn.disabled = true;
  try {
    await Promise.all(ids.map((id) => deleteDoc(doc(db, 'stockItems', id))));
    allBatches = allBatches.filter((b) => !selectedIds.has(b.id));
    selectedIds.clear();
    renderRows();
    // Einlagern/Entnehmen (stock-checkin.js/stock-checkout.js) each keep
    // their own read cache — without this they wouldn't see this change
    // until a manual refresh or full reload.
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    alert('Löschen fehlgeschlagen: ' + err.message);
    console.error(err);
  } finally {
    bulkDeleteBtn.disabled = false;
  }
});

// --- Edit panel (bottom-sheet on mobile, inline on tablet — see CSS) -----

let editQty = 1;

function openEditModal(batch) {
  editingBatch = batch;
  const product = productIndex.get(batch.productId);
  const isPhantom = batch.id === null;

  editTitleEl.textContent = isPhantom ? 'Produkt (kein Bestand)' : 'Bestand bearbeiten';
  editNameInput.value = productName(batch.productId);
  editBatchFieldsEl.classList.toggle('hidden', isPhantom);
  editNoStockNoteEl.classList.toggle('hidden', !isPhantom);
  editDeleteBtn.textContent = isPhantom ? 'Produkt löschen' : 'Löschen';

  if (!isPhantom) {
    editQty = batch.quantity;
    editQtyNumEl.value = String(editQty);

    editDetailsInput.value = batch.details || '';

    // kg/l are the only "fractional" units (content-string-parsed) — every
    // other unit (legacy 'stueck', or an open Sonstiges unit like Flaschen/
    // Säcke/custom) tracks by plain integer quantity instead, no content
    // field needed. See js/dashboard.js's isFractionalUnit for the same
    // distinction driving the stock-summing math.
    const isFractional = !product || product.unitType === 'kg' || product.unitType === 'l';
    editContentGroup.classList.toggle('hidden', !isFractional);
    editContentInput.value = batch.content || '';

    editBestBeforeInput.value = batch.bestBefore || '';

    editStorageSelect.innerHTML = '';
    storageLocations.forEach((loc) => {
      const opt = document.createElement('option');
      opt.value = loc;
      opt.textContent = loc;
      editStorageSelect.appendChild(opt);
    });
    editStorageSelect.value = batch.storage || '';
  }

  editEmptyEl.classList.add('hidden');
  editFormEl.classList.remove('hidden');
  editModal.classList.add('show');
  renderRows();
}

function closeEdit() {
  editModal.classList.remove('show');
  editingBatch = null;
  editFormEl.classList.add('hidden');
  editEmptyEl.classList.remove('hidden');
  renderRows();
}

editQtyMinusBtn.addEventListener('click', () => {
  editQty = Math.max(1, editQty - 1);
  editQtyNumEl.value = String(editQty);
});
editQtyPlusBtn.addEventListener('click', () => {
  editQty += 1;
  editQtyNumEl.value = String(editQty);
});
// Tap the number to type a quantity directly (e.g. correcting to 60
// bottles of water) — see the .qty-num CSS comment for why this is a real
// <input> styled to look like the plain number it replaced.
editQtyNumEl.addEventListener('focus', () => editQtyNumEl.select());
editQtyNumEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') editQtyNumEl.blur();
});
editQtyNumEl.addEventListener('blur', () => {
  const n = parseInt(editQtyNumEl.value, 10);
  editQty = Number.isFinite(n) && n >= 1 ? n : 1;
  editQtyNumEl.value = String(editQty);
});
editContentInput.addEventListener('blur', () => {
  editContentInput.value = normalizeContent(editContentInput.value);
});

editModal.addEventListener('click', (e) => {
  if (e.target === editModal) closeEdit();
});

editSaveBtn.addEventListener('click', async () => {
  if (!editingBatch) return;
  const newName = editNameInput.value.trim();

  // A product-with-no-stock row has no stockItem doc — the rename below is
  // the only thing to save for it, same catalog-wide rename mechanism as
  // the real-batch path already uses.
  if (editingBatch.id === null) {
    editSaveBtn.disabled = true;
    try {
      if (newName && newName !== productName(editingBatch.productId)) {
        await updateDoc(doc(db, 'products', editingBatch.productId), { name: newName });
        const product = productIndex.get(editingBatch.productId);
        if (product) product.name = newName;
      }
      closeEdit();
      window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
    } catch (err) {
      alert('Speichern fehlgeschlagen: ' + err.message);
      console.error(err);
    } finally {
      editSaveBtn.disabled = false;
    }
    return;
  }

  const isFractional = !editContentGroup.classList.contains('hidden');
  const updated = {
    quantity: editQty,
    details: editDetailsInput.value.trim(),
    content: isFractional ? normalizeContent(editContentInput.value) : (editContentInput.value.trim() || ''),
    bestBefore: editBestBeforeInput.value || '',
    yearColor: yearColorFor(editBestBeforeInput.value),
    storage: editStorageSelect.value,
    updatedAt: new Date().toISOString(),
  };
  editSaveBtn.disabled = true;
  try {
    await updateDoc(doc(db, 'stockItems', editingBatch.id), updated);
    const idx = allBatches.findIndex((b) => b.id === editingBatch.id);
    if (idx >= 0) allBatches[idx] = { ...allBatches[idx], ...updated };

    // Product name lives on /products, not the batch — a rename here is a
    // catalog-wide rename, applying to every batch of this product.
    if (newName && newName !== productName(editingBatch.productId)) {
      await updateDoc(doc(db, 'products', editingBatch.productId), { name: newName });
      const product = productIndex.get(editingBatch.productId);
      if (product) product.name = newName;
    }

    closeEdit();
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    alert('Speichern fehlgeschlagen: ' + err.message);
    console.error(err);
  } finally {
    editSaveBtn.disabled = false;
  }
});

editDeleteBtn.addEventListener('click', async () => {
  if (!editingBatch) return;

  // A product-with-no-stock row's "Löschen" removes the product from the
  // catalog itself (there's no stockItem doc to delete) — this is what
  // actually lets a stray/orphaned catalog entry (see Ziele's Produktziele
  // picker context labels) get cleaned up, which nothing in the app could
  // do before this. Since a zero-stock row only ever shows here because it
  // still has a Ziele product target (see allRows() above), its target
  // entry is deleted along with it — otherwise it'd be a dangling reference
  // in /config/targets pointing at a product that no longer exists, same
  // shape as the "Aus"/clearBtn path in js/targets.js itself.
  if (editingBatch.id === null) {
    if (!confirm(`Produkt "${productName(editingBatch.productId)}" endgültig aus dem Katalog löschen?`)) return;
    try {
      await deleteDoc(doc(db, 'products', editingBatch.productId));
      if (targets.products[editingBatch.productId]) {
        delete targets.products[editingBatch.productId];
        await setDoc(doc(db, 'config', 'targets'), targets);
      }
      allProducts = allProducts.filter((p) => p.id !== editingBatch.productId);
      productIndex.delete(editingBatch.productId);
      closeEdit();
      window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
    } catch (err) {
      alert('Löschen fehlgeschlagen: ' + err.message);
      console.error(err);
    }
    return;
  }

  if (!confirm(`"${productName(editingBatch.productId)}" wirklich löschen?`)) return;
  try {
    await deleteDoc(doc(db, 'stockItems', editingBatch.id));
    allBatches = allBatches.filter((b) => b.id !== editingBatch.id);
    closeEdit();
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    alert('Löschen fehlgeschlagen: ' + err.message);
    console.error(err);
  }
});

// --- Date picker modal (mirrors stock-checkin.js) ------------------------

function buildPickerColumn(colEl, items, selectedIndex, onPick) {
  colEl.innerHTML = '';
  items.forEach((label, idx) => {
    const item = document.createElement('div');
    item.className = 'picker-item' + (idx === selectedIndex ? ' selected' : '');
    item.textContent = label;
    item.addEventListener('click', () => onPick(idx));
    colEl.appendChild(item);
  });
  const activeEl = colEl.children[selectedIndex];
  if (activeEl) activeEl.scrollIntoView({ block: 'center' });
}

function renderMonthColumn() {
  buildPickerColumn(monthCol, months, pendingMonthIndex, (idx) => {
    pendingMonthIndex = idx;
    renderMonthColumn();
  });
}

function renderYearColumn() {
  buildPickerColumn(yearCol, years.map(String), pendingYearIndex, (idx) => {
    pendingYearIndex = idx;
    renderYearColumn();
  });
}

function openDateModal() {
  months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
  const nowYear = new Date().getFullYear();
  years = Array.from({ length: 21 }, (_, i) => nowYear - 1 + i);

  let monthIdx = new Date().getMonth();
  let yearIdx = years.indexOf(nowYear);
  if (editBestBeforeInput.value) {
    const [mm, yyyy] = editBestBeforeInput.value.split('/');
    const mi = months.indexOf(mm);
    const yi = years.indexOf(Number(yyyy));
    if (mi >= 0) monthIdx = mi;
    if (yi >= 0) yearIdx = yi;
  }
  pendingMonthIndex = monthIdx;
  pendingYearIndex = yearIdx >= 0 ? yearIdx : 0;

  renderMonthColumn();
  renderYearColumn();

  dateModal.classList.add('show');
}

editBestBeforeDisplay.addEventListener('click', openDateModal);

dateModalConfirmBtn.addEventListener('click', () => {
  const mm = String(pendingMonthIndex + 1).padStart(2, '0');
  const yyyy = years[pendingYearIndex];
  editBestBeforeInput.value = `${mm}/${yyyy}`;
  dateModal.classList.remove('show');
});

dateModal.addEventListener('click', (e) => {
  if (e.target === dateModal) dateModal.classList.remove('show');
});

// --- Entry point -----------------------------------------------------------
// Settings-nav.js already handles showing/hiding this panel generically
// (data-target/data-back); this just resets and (re)renders its contents
// each time the Bestandsliste card is opened.

stocktableCard.addEventListener('click', () => {
  selectMode = false;
  selectedIds.clear();
  selectModeBtn.classList.remove('active');
  selectModeBtn.textContent = 'Auswählen';
  activeSubcategoryFilter = null;
  activeSubcategoryFilterName = '';
  returnTarget = null;
  closeEdit();
  filtersPanel.classList.remove('show');
  renderFilters();
  renderSortBar();
  renderRows();
});

// The panel's own back button already gets a generic handler from
// settings-nav.js (return to the Admin main menu) — this listener is
// attached afterwards (script tag order) and runs second within the same
// click, so when a returnTarget is set it overrides the final visible
// screen by switching away to that origin tab entirely ('dashboard' or
// 'stock', whichever tap-through set it — see openFilteredBySubcategory/
// openFilteredByProductSearch/stockOpenTableBtn below). back-nav.js's
// hardware-back handling already delegates to a real .click() on this
// exact button, so this also covers that path with no changes there.
// switchTabWithoutReset (not a plain nav-icon .click()) is what actually
// makes this "return to where I was" rather than "return to that tab's
// root" — a real click dispatches erdkeller:navreset, which is exactly
// what clears e.g. the Dashboard's expanded-category state and forces its
// sub-tab back to "Bestand" on every other navigation.
const stocktableBackBtn = document.querySelector('#settings-panel-stocktable [data-back]');
stocktableBackBtn.addEventListener('click', () => {
  if (!returnTarget) return;
  const target = returnTarget;
  returnTarget = null;
  switchTabWithoutReset(target);
});

// Tap-through from Übersicht (Step 10, js/dashboard.js): reuses the same
// nav-btn/settings-card click handlers a real tap would trigger — that's
// what actually switches to the Admin tab and opens this panel — then
// layers the subcategory filter on top once it's open.
export function openFilteredBySubcategory(subcategoryId, subcategoryName) {
  document.querySelector('.nav-btn[data-tab="settings"]').click();
  stocktableCard.click();
  returnTarget = 'dashboard';
  activeSubcategoryFilter = subcategoryId;
  activeSubcategoryFilterName = subcategoryName;
  renderRows();
}

// Tap-through from Übersicht's Alerts (js/dashboard.js) — an expiring
// batch doesn't have a subcategory-filter equivalent worth building (it's
// one specific product, not a whole subcategory), so this reuses the
// plain free-text search box instead.
export function openFilteredByProductSearch(productName) {
  document.querySelector('.nav-btn[data-tab="settings"]').click();
  stocktableCard.click();
  returnTarget = 'dashboard';
  searchText = productName;
  searchInput.value = productName;
  renderRows();
}

// Admin-only shortcut button on Bestand's own home screen (Build 101) —
// same tap-through mechanism as the two above, just landing back on Bestand
// instead of Dashboard, and with no filter to layer on top.
const stockOpenTableBtn = document.getElementById('stock-open-table-btn');
stockOpenTableBtn.addEventListener('click', () => {
  document.querySelector('.nav-btn[data-tab="settings"]').click();
  stocktableCard.click();
  returnTarget = 'stock';
});

window.addEventListener('erdkeller:signedin', () => loadConfig());
window.addEventListener('erdkeller:refresh', async () => {
  await loadConfig();
  // If Bestandsliste is already open when a refresh fires (e.g. a checkin/
  // checkout elsewhere in this session), reflect the fresh data immediately
  // instead of only updating the in-memory cache silently.
  if (!settingsPanelStocktable.classList.contains('hidden')) renderRows();
});
