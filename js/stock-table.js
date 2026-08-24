import { db } from './firebase-init.js?v=54';
import { PALETTE } from './year-colors.js?v=54';
import {
  doc, getDoc, collection, getDocs, deleteDoc, updateDoc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const stocktableCard = document.querySelector('.settings-card[data-target="stocktable"]');

const selectModeBtn = document.getElementById('table-select-mode-btn');
const searchInput = document.getElementById('table-search-input');
const typeFilterRow = document.getElementById('table-type-filters');
const categoryFilterRow = document.getElementById('table-category-filters');
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

const COLUMNS = [
  { key: 'product', label: 'Produkt' },
  { key: 'subcategory', label: 'Unterkat.' },
  { key: 'category', label: 'Kategorie' },
  { key: 'type', label: 'Typ' },
  { key: 'quantity', label: 'Menge' },
  { key: 'content', label: 'Inhalt' },
  { key: 'bestBefore', label: 'MHD' },
  { key: 'storage', label: 'Lagerort' },
];

const COLOR_HEX = Object.fromEntries(PALETTE.map((c) => [c.name, c.hex]));
const ITEM_HEIGHT = 36;
const PICKER_PAD = 72; // matches .picker-highlight top offset — see css/styles.css

let taxonomy = { types: [] };
let storageLocations = [];
let yearColorMap = { none: 'white' };
let allProducts = [];
let allBatches = [];
let productIndex = new Map();

let searchText = '';
let selectedTypes = new Set();
let selectedCategories = new Set();
let selectedStorages = new Set();
let sortColumn = null;
let sortDir = 'asc';
let selectMode = false;
let selectedIds = new Set();
let editingBatch = null;
let pendingMonthIndex = 0;
let pendingYearIndex = 0;
let years = [];

// --- Data loading ---------------------------------------------------------

async function loadConfig() {
  try {
    const [taxSnap, storeSnap, colorSnap, productsSnap, batchesSnap] = await Promise.all([
      getDoc(doc(db, 'config', 'taxonomy')),
      getDoc(doc(db, 'config', 'storageLocations')),
      getDoc(doc(db, 'config', 'yearColorMap')),
      getDocs(collection(db, 'products')),
      getDocs(collection(db, 'stockItems')),
    ]);
    taxonomy = taxSnap.exists() && Array.isArray(taxSnap.data().types) ? taxSnap.data() : { types: [] };
    storageLocations = storeSnap.exists() && Array.isArray(storeSnap.data().locations) ? storeSnap.data().locations : [];
    yearColorMap = colorSnap.exists() && colorSnap.data() ? colorSnap.data() : { none: 'white' };
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

function allTypeNames() {
  return (taxonomy.types || []).map((t) => t.name);
}

function allCategoryNames() {
  const set = new Set();
  (taxonomy.types || []).forEach((t) => (t.categories || []).forEach((c) => set.add(c.name)));
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'de'));
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
  return allBatches.filter((b) => {
    if (selectedTypes.size && !selectedTypes.has(b.type)) return false;
    if (selectedCategories.size && !selectedCategories.has(b.category)) return false;
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

function renderFilters() {
  renderChips(typeFilterRow, allTypeNames(), selectedTypes);
  renderChips(categoryFilterRow, allCategoryNames(), selectedCategories);
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
  const row = document.createElement('div');
  row.className = 'stock-product-row' + (editingBatch && editingBatch.id === batch.id ? ' selected' : '');

  if (selectMode) {
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
  metaEl.textContent = batchMetaLine(batch);

  const subEl = document.createElement('span');
  subEl.className = 'table-row-sub';
  subEl.textContent = `${batch.subcategory || ''} › ${batch.category || ''} › ${batch.type || ''}`;

  textWrap.appendChild(nameEl);
  textWrap.appendChild(metaEl);
  textWrap.appendChild(subEl);
  row.appendChild(textWrap);

  row.addEventListener('click', () => {
    if (selectMode) {
      if (selectedIds.has(batch.id)) selectedIds.delete(batch.id);
      else selectedIds.add(batch.id);
      renderRows();
    } else {
      openEditModal(batch);
    }
  });

  return row;
}

function renderRows() {
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

  editNameInput.value = productName(batch.productId);

  editQty = batch.quantity;
  editQtyNumEl.textContent = String(editQty);

  editDetailsInput.value = batch.details || '';

  const isKg = !product || product.unitType === 'kg';
  editContentGroup.classList.toggle('hidden', !isKg);
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
  editQtyNumEl.textContent = String(editQty);
});
editQtyPlusBtn.addEventListener('click', () => {
  editQty += 1;
  editQtyNumEl.textContent = String(editQty);
});
editContentInput.addEventListener('blur', () => {
  editContentInput.value = normalizeContent(editContentInput.value);
});

editModal.addEventListener('click', (e) => {
  if (e.target === editModal) closeEdit();
});

editSaveBtn.addEventListener('click', async () => {
  if (!editingBatch) return;
  const isKg = !editContentGroup.classList.contains('hidden');
  const newName = editNameInput.value.trim();
  const updated = {
    quantity: editQty,
    details: editDetailsInput.value.trim(),
    content: isKg ? normalizeContent(editContentInput.value) : (editContentInput.value.trim() || ''),
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
  } catch (err) {
    alert('Speichern fehlgeschlagen: ' + err.message);
    console.error(err);
  } finally {
    editSaveBtn.disabled = false;
  }
});

editDeleteBtn.addEventListener('click', async () => {
  if (!editingBatch) return;
  if (!confirm(`"${productName(editingBatch.productId)}" wirklich löschen?`)) return;
  try {
    await deleteDoc(doc(db, 'stockItems', editingBatch.id));
    allBatches = allBatches.filter((b) => b.id !== editingBatch.id);
    closeEdit();
  } catch (err) {
    alert('Löschen fehlgeschlagen: ' + err.message);
    console.error(err);
  }
});

// --- Date picker modal (mirrors stock-checkin.js) ------------------------

function buildPickerColumn(colEl, items, selectedIndex) {
  colEl.innerHTML = '';
  const topPad = document.createElement('div');
  topPad.style.height = PICKER_PAD + 'px';
  colEl.appendChild(topPad);
  items.forEach((label) => {
    const item = document.createElement('div');
    item.className = 'picker-item';
    item.textContent = label;
    colEl.appendChild(item);
  });
  const bottomPad = document.createElement('div');
  bottomPad.style.height = PICKER_PAD + 'px';
  colEl.appendChild(bottomPad);
  colEl.scrollTop = selectedIndex * ITEM_HEIGHT;
}

function readCenteredIndex(colEl, max) {
  const idx = Math.round(colEl.scrollTop / ITEM_HEIGHT);
  return Math.min(Math.max(idx, 0), max - 1);
}

function openDateModal() {
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
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

  buildPickerColumn(monthCol, months, pendingMonthIndex);
  buildPickerColumn(yearCol, years.map(String), pendingYearIndex);

  dateModal.classList.add('show');
}

let scrollDebounce;
function onPickerScroll(colEl, max, setter) {
  clearTimeout(scrollDebounce);
  scrollDebounce = setTimeout(() => setter(readCenteredIndex(colEl, max)), 100);
}

monthCol.addEventListener('scroll', () => onPickerScroll(monthCol, 12, (i) => { pendingMonthIndex = i; }));
yearCol.addEventListener('scroll', () => onPickerScroll(yearCol, years.length || 21, (i) => { pendingYearIndex = i; }));

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
  closeEdit();
  renderFilters();
  renderSortBar();
  renderRows();
});

window.addEventListener('erdkeller:signedin', () => loadConfig());
window.addEventListener('erdkeller:refresh', () => loadConfig());
