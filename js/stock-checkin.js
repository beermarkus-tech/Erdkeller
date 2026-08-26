import { db } from './firebase-init.js?v=94';
import { renderRecentLog } from './stock-log.js?v=94';
import { renderResultLines } from './format-batch.js?v=94';
import {
  doc, getDoc, collection, getDocs, addDoc, deleteDoc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const stockHomeEl = document.getElementById('stock-home');
const stockFlowEl = document.getElementById('stock-flow');
const startCheckinBtn = document.getElementById('start-checkin-btn');
const backHomeBtn = document.getElementById('back-home-btn');
const flowBackBtn = document.getElementById('checkin-back-btn');
const recentLogEl = document.getElementById('checkin-recent-log');

const breadcrumbEl = document.getElementById('stock-breadcrumb');
const flowSteps = document.querySelectorAll('#stock-flow .flow-step');

const PREV_STEP = {
  type: null,
  category: 'type',
  subcategory: 'category',
  product: 'subcategory',
  'new-product': 'product',
};

const globalSearchInput = document.getElementById('global-product-search');
const globalSearchResults = document.getElementById('global-search-results');
const typeGrid = document.getElementById('type-grid');
const typeGridLabel = document.getElementById('type-grid-label');
const categoryGrid = document.getElementById('category-grid');
const subcategoryGrid = document.getElementById('subcategory-grid');

const productSearchInput = document.getElementById('product-search');
const productListEl = document.getElementById('product-list');

const newProductNameInput = document.getElementById('new-product-name');
// Scoped to this screen's own toggle — the bare .unit-btn class is reused
// by js/targets.js's own new-product-unit-toggle AND its unrelated
// target-mode-toggle (Feste Menge/Personen×Tage), and since all
// type="module" scripts run after the whole document is parsed, an
// unscoped querySelectorAll('.unit-btn') here would have silently also
// matched those two other elements and wired an unwanted second listener
// onto them.
const newProductUnitToggleEl = document.getElementById('new-product-unit-toggle');
const newProductWaterNoteEl = document.getElementById('new-product-water-note');
const unitButtons = newProductUnitToggleEl.querySelectorAll('.unit-btn');
const newProductContinueBtn = document.getElementById('new-product-continue-btn');

const detailProductName = document.getElementById('detail-product-name');
const qtyNumEl = document.getElementById('qty-num');
const qtyMinusBtn = document.getElementById('qty-minus');
const qtyPlusBtn = document.getElementById('qty-plus');
const detailsInput = document.getElementById('details-input');
const contentFieldGroup = document.getElementById('content-field-group');
const contentInput = document.getElementById('content-input');
const bestbeforeDisplay = document.getElementById('bestbefore-display');
const bestbeforeInput = document.getElementById('bestbefore-input');
const storageSelect = document.getElementById('storage-select');
const checkinConfirmBtn = document.getElementById('checkin-confirm-btn');

const successDetail = document.getElementById('success-detail');

const dateModal = document.getElementById('date-modal');
const monthCol = document.getElementById('month-col');
const yearCol = document.getElementById('year-col');
const dateModalConfirm = document.getElementById('date-modal-confirm');

const undoToast = document.getElementById('undo-toast');
const undoToastText = document.getElementById('undo-toast-text');
const undoBtn = document.getElementById('undo-btn');

let taxonomy = { types: [] };
let storageLocations = [];
let yearColorMap = { none: 'white' };
let allProducts = [];
let subcategoryIndex = new Map(); // subcategoryId -> { type, category, subcategory }
let configLoadOk = false;

let selection = {
  type: null, category: null, subcategory: null,
  product: null, isNewProduct: false, newProductUnit: 'kg',
  qty: 1, details: '', content: '', bestBefore: '', storage: '',
};

let lastCheckInId = null;
let lastLogId = null;
let undoTimer = null;
let pendingMonthIndex = 0;
let pendingYearIndex = 0;
let years = [];
let months = [];

function currentUnitType() {
  return selection.isNewProduct ? selection.newProductUnit : (selection.product ? selection.product.unitType : 'kg');
}

// kg/l are the only "fractional" units (content-string-parsed) — every
// other unit (legacy 'stueck', or an open Sonstiges unit like Flaschen/
// Säcke/custom, settable via Ziele's Sonstiges product-target picker)
// tracks by plain integer quantity instead, no content field needed. See
// js/dashboard.js's isFractionalUnit for the same distinction driving the
// stock-summing math.
function isCurrentUnitFractional() {
  const u = currentUnitType();
  return u === 'kg' || u === 'l';
}

// --- Data loading -----------------------------------------------------

async function loadConfig() {
  try {
    const [taxSnap, storeSnap, colorSnap, productsSnap] = await Promise.all([
      getDoc(doc(db, 'config', 'taxonomy')),
      getDoc(doc(db, 'config', 'storageLocations')),
      getDoc(doc(db, 'config', 'yearColorMap')),
      getDocs(collection(db, 'products')),
    ]);
    taxonomy = taxSnap.exists() && Array.isArray(taxSnap.data().types) ? taxSnap.data() : { types: [] };
    storageLocations = storeSnap.exists() && Array.isArray(storeSnap.data().locations) ? storeSnap.data().locations : [];
    yearColorMap = colorSnap.exists() && colorSnap.data() ? colorSnap.data() : { none: 'white' };
    allProducts = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    buildSubcategoryIndex();
    configLoadOk = true;
  } catch (err) {
    configLoadOk = false;
    console.error(err);
  }
  startCheckinBtn.disabled = !configLoadOk;
}

function buildSubcategoryIndex() {
  subcategoryIndex = new Map();
  (taxonomy.types || []).forEach((type) => {
    (type.categories || []).forEach((cat) => {
      (cat.subcategories || []).forEach((sub) => {
        subcategoryIndex.set(sub.id, { type, category: cat, subcategory: sub });
      });
    });
  });
}

// See js/taxonomy.js's typeClass for the fallback-derivation rationale.
function typeClass(type) {
  if (type.typeClass) return type.typeClass;
  return type.isFoodType ? 'food' : 'other';
}

// --- Navigation ---------------------------------------------------------

function setActiveStep(stepName) {
  flowSteps.forEach((el) => {
    el.classList.toggle('active', el.dataset.flowStep === stepName);
  });
}

function currentStepName() {
  const active = Array.from(flowSteps).find((el) => el.classList.contains('active'));
  return active ? active.dataset.flowStep : null;
}

function goBack() {
  const current = currentStepName();
  if (!current || current === 'success') return;
  let prev = current === 'detail' ? (selection.isNewProduct ? 'new-product' : 'product') : PREV_STEP[current];
  // Wasser skips the subcategory step (see renderCategoryGrid) — never
  // step back into a screen that was never actually shown.
  if (current === 'product' && selection.type && typeClass(selection.type) === 'water') prev = 'category';
  if (prev) goToStep(prev);
  else returnHome();
}

flowBackBtn.addEventListener('click', goBack);

function goToStep(stepName) {
  flowBackBtn.classList.toggle('hidden', stepName === 'success');
  if (stepName === 'type') {
    selection.category = null;
    selection.subcategory = null;
    selection.product = null;
    selection.isNewProduct = false;
    globalSearchInput.value = '';
    globalSearchResults.classList.add('hidden');
    typeGrid.classList.remove('hidden');
    typeGridLabel.classList.remove('hidden');
    renderTypeGrid();
  } else if (stepName === 'category') {
    selection.subcategory = null;
    selection.product = null;
    selection.isNewProduct = false;
    renderCategoryGrid();
  } else if (stepName === 'subcategory') {
    selection.product = null;
    selection.isNewProduct = false;
    renderSubcategoryGrid();
  } else if (stepName === 'product') {
    selection.isNewProduct = false;
    productSearchInput.value = '';
    renderProductList('');
  } else if (stepName === 'new-product') {
    newProductNameInput.value = '';
    // Wasser products are always liter-tracked — they count toward the one
    // global Wasser target (Planung's rate × people × days, Übersicht),
    // never an individual override, so there's no unit choice to offer at
    // all here. Anyone wanting a separately-tracked "always keep N bottles"
    // target models that as an actual Sonstiges product instead (Ziele's
    // own Sonstiges picker, js/targets.js) — same name as "water" in the
    // everyday sense, but no link to this Taxonomie Wasser type.
    const isWater = selection.type && typeClass(selection.type) === 'water';
    newProductUnitToggleEl.classList.toggle('hidden', isWater);
    newProductWaterNoteEl.classList.toggle('hidden', !isWater);
    setUnitToggle(isWater ? 'l' : 'kg');
  } else if (stepName === 'detail') {
    prepareDetailStep();
  }
  setActiveStep(stepName);
  renderBreadcrumb(stepName);
}

function renderBreadcrumb(currentStep) {
  breadcrumbEl.innerHTML = '';
  const crumbs = [];
  if (selection.type) crumbs.push({ label: `${selection.type.sym || ''} ${selection.type.name}`.trim(), step: 'type' });
  if (selection.category) crumbs.push({ label: `${selection.category.sym || ''} ${selection.category.name}`.trim(), step: 'category' });
  // Wasser's subcategory is an invisible implementation detail (see
  // renderCategoryGrid) — never surface it as its own breadcrumb step.
  if (selection.subcategory && !(selection.type && typeClass(selection.type) === 'water')) {
    crumbs.push({ label: `${selection.subcategory.sym || ''} ${selection.subcategory.name}`.trim(), step: 'subcategory' });
  }
  if (selection.product && (currentStep === 'detail' || currentStep === 'success')) {
    crumbs.push({ label: selection.product.name, step: currentStep === 'success' ? null : 'detail' });
  }

  crumbs.forEach((crumb, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›';
      breadcrumbEl.appendChild(sep);
    }
    const btn = document.createElement('button');
    const isCurrent = crumb.step === currentStep || crumb.step === null;
    btn.className = 'crumb' + (isCurrent ? ' current' : '');
    btn.textContent = crumb.label;
    if (!isCurrent) {
      btn.addEventListener('click', () => goToStep(crumb.step));
    } else {
      btn.disabled = true;
    }
    breadcrumbEl.appendChild(btn);
  });
}

// --- Tile / list rendering ------------------------------------------

function makeTile(sym, name, onClick, extraClass) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'tile' + (extraClass ? ' ' + extraClass : '');
  const symEl = document.createElement('span');
  symEl.className = 'sym';
  symEl.textContent = sym || '';
  const nameEl = document.createElement('span');
  nameEl.textContent = name;
  tile.appendChild(symEl);
  tile.appendChild(nameEl);
  tile.addEventListener('click', onClick);
  return tile;
}

function renderTypeGrid() {
  typeGrid.innerHTML = '';
  (taxonomy.types || []).forEach((type) => {
    typeGrid.appendChild(makeTile(type.sym, type.name, () => {
      selection.type = type;
      goToStep('category');
    }, 'type-tile'));
  });
}

function renderCategoryGrid() {
  categoryGrid.innerHTML = '';
  const isWater = selection.type && typeClass(selection.type) === 'water';
  ((selection.type && selection.type.categories) || []).forEach((cat) => {
    categoryGrid.appendChild(makeTile(cat.sym, cat.name, () => {
      selection.category = cat;
      // Wasser has no subcategory choice to make (js/taxonomy.js keeps
      // exactly one auto-managed subcategory per category) — jump
      // straight to product selection instead of showing that step.
      if (isWater && cat.subcategories && cat.subcategories[0]) {
        selection.subcategory = cat.subcategories[0];
        goToStep('product');
      } else {
        goToStep('subcategory');
      }
    }));
  });
}

function renderSubcategoryGrid() {
  subcategoryGrid.innerHTML = '';
  ((selection.category && selection.category.subcategories) || []).forEach((sub) => {
    subcategoryGrid.appendChild(makeTile(sub.sym, sub.name, () => {
      selection.subcategory = sub;
      goToStep('product');
    }));
  });
}

function productsForCurrentSubcategory() {
  if (!selection.subcategory) return [];
  return allProducts.filter((p) => p.subcategoryId === selection.subcategory.id);
}

function renderProductList(filterText) {
  productListEl.innerHTML = '';
  const q = (filterText || '').trim().toLowerCase();
  const products = productsForCurrentSubcategory()
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  products.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'stock-product-row';
    const nameEl = document.createElement('span');
    nameEl.className = 'pname';
    nameEl.textContent = p.name;
    row.appendChild(nameEl);
    row.addEventListener('click', () => {
      selection.product = p;
      selection.isNewProduct = false;
      goToStep('detail');
    });
    productListEl.appendChild(row);
  });

  const addRow = document.createElement('div');
  addRow.className = 'stock-product-row add-new';
  addRow.textContent = '+ Neues Produkt';
  addRow.addEventListener('click', () => goToStep('new-product'));
  productListEl.appendChild(addRow);
}

productSearchInput.addEventListener('input', () => renderProductList(productSearchInput.value));

// --- Global search (type step) ---------------------------------------

function renderGlobalSearchResults(text) {
  const q = text.trim().toLowerCase();
  if (!q) {
    globalSearchResults.classList.add('hidden');
    typeGrid.classList.remove('hidden');
    typeGridLabel.classList.remove('hidden');
    return;
  }
  typeGrid.classList.add('hidden');
  typeGridLabel.classList.add('hidden');
  globalSearchResults.classList.remove('hidden');
  globalSearchResults.innerHTML = '';

  const matches = allProducts
    .filter((p) => p.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    .slice(0, 30);

  if (matches.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'screen-placeholder';
    empty.textContent = 'Keine Produkte gefunden.';
    globalSearchResults.appendChild(empty);
    return;
  }

  matches.forEach((p) => {
    const path = subcategoryIndex.get(p.subcategoryId);
    const row = document.createElement('div');
    row.className = 'stock-product-row';
    const nameEl = document.createElement('span');
    nameEl.className = 'pname';
    nameEl.textContent = p.name;
    const metaEl = document.createElement('span');
    metaEl.className = 'pmeta';
    // Wasser's subcategory name mirrors its category (see renderCategoryGrid
    // above) — drop the redundant trailing segment rather than showing
    // "Wasser › Trinkwasser › Trinkwasser".
    metaEl.textContent = path
      ? (path.subcategory.name === path.category.name
        ? `${path.type.name} › ${path.category.name}`
        : `${path.type.name} › ${path.category.name} › ${path.subcategory.name}`)
      : '';
    const wrap = document.createElement('span');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.appendChild(nameEl);
    wrap.appendChild(metaEl);
    row.appendChild(wrap);
    row.addEventListener('click', () => {
      if (!path) return;
      selection.type = path.type;
      selection.category = path.category;
      selection.subcategory = path.subcategory;
      selection.product = p;
      selection.isNewProduct = false;
      globalSearchInput.value = '';
      globalSearchResults.classList.add('hidden');
      typeGrid.classList.remove('hidden');
      typeGridLabel.classList.remove('hidden');
      goToStep('detail');
    });
    globalSearchResults.appendChild(row);
  });
}

globalSearchInput.addEventListener('input', () => renderGlobalSearchResults(globalSearchInput.value));

// --- New product step --------------------------------------------------

function setUnitToggle(unit) {
  selection.newProductUnit = unit;
  unitButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.unit === unit));
}

unitButtons.forEach((btn) => {
  btn.addEventListener('click', () => setUnitToggle(btn.dataset.unit));
});

newProductContinueBtn.addEventListener('click', () => {
  const name = newProductNameInput.value.trim();
  if (!name) {
    newProductNameInput.focus();
    return;
  }
  selection.product = {
    id: null,
    name,
    subcategoryId: selection.subcategory.id,
    unitType: selection.newProductUnit,
  };
  selection.isNewProduct = true;
  goToStep('detail');
});

// --- Detail step ---------------------------------------------------------

function prepareDetailStep() {
  detailProductName.textContent = selection.product ? selection.product.name : '';
  selection.qty = 1;
  qtyNumEl.value = '1';
  selection.details = '';
  detailsInput.value = '';
  selection.content = '';
  contentInput.value = '';
  selection.bestBefore = '';
  bestbeforeInput.value = '';

  contentFieldGroup.classList.toggle('hidden', !isCurrentUnitFractional());

  storageSelect.innerHTML = '';
  storageLocations.forEach((loc) => {
    const opt = document.createElement('option');
    opt.value = loc;
    opt.textContent = loc;
    storageSelect.appendChild(opt);
  });
  selection.storage = storageLocations[0] || '';
}

qtyMinusBtn.addEventListener('click', () => {
  selection.qty = Math.max(1, selection.qty - 1);
  qtyNumEl.value = String(selection.qty);
});
qtyPlusBtn.addEventListener('click', () => {
  selection.qty += 1;
  qtyNumEl.value = String(selection.qty);
});
// Tap the number to type a quantity directly (e.g. 60 bottles of water) —
// see the .qty-num CSS comment for why this is a real <input> styled to
// look like the plain number it replaced.
qtyNumEl.addEventListener('focus', () => qtyNumEl.select());
qtyNumEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') qtyNumEl.blur();
});
qtyNumEl.addEventListener('blur', () => {
  const n = parseInt(qtyNumEl.value, 10);
  selection.qty = Number.isFinite(n) && n >= 1 ? n : 1;
  qtyNumEl.value = String(selection.qty);
});
function normalizeContent(raw) {
  const trimmed = (raw || '').trim();
  // A bare number (no unit letters typed) is assumed to be grams.
  return /^\d+([.,]\d+)?$/.test(trimmed) ? trimmed + 'g' : trimmed;
}

detailsInput.addEventListener('input', () => { selection.details = detailsInput.value; });
contentInput.addEventListener('input', () => { selection.content = contentInput.value; });
contentInput.addEventListener('blur', () => {
  selection.content = normalizeContent(contentInput.value);
  contentInput.value = selection.content;
});
storageSelect.addEventListener('change', () => { selection.storage = storageSelect.value; });

// --- Date picker modal ---------------------------------------------------

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
  if (selection.bestBefore) {
    const [mm, yyyy] = selection.bestBefore.split('/');
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

bestbeforeDisplay.addEventListener('click', openDateModal);

dateModalConfirm.addEventListener('click', () => {
  const mm = String(pendingMonthIndex + 1).padStart(2, '0');
  const yyyy = years[pendingYearIndex];
  selection.bestBefore = `${mm}/${yyyy}`;
  bestbeforeInput.value = selection.bestBefore;
  dateModal.classList.remove('show');
});

dateModal.addEventListener('click', (e) => {
  if (e.target === dateModal) dateModal.classList.remove('show');
});

// --- Confirm & write -------------------------------------------------

function yearColorFor(bestBefore) {
  if (!bestBefore) return 'none';
  const year = bestBefore.split('/')[1];
  return (yearColorMap && yearColorMap[year]) || 'none';
}

checkinConfirmBtn.addEventListener('click', async () => {
  if (!selection.product || !selection.subcategory || !selection.category || !selection.type) return;
  checkinConfirmBtn.disabled = true;
  try {
    let productId = selection.product.id;
    if (selection.isNewProduct) {
      const newDoc = await addDoc(collection(db, 'products'), {
        name: selection.product.name,
        subcategoryId: selection.product.subcategoryId,
        unitType: selection.product.unitType,
      });
      productId = newDoc.id;
      selection.product.id = productId;
      allProducts.push({ id: productId, ...selection.product });
    }

    const nowIso = new Date().toISOString();
    const data = {
      type: selection.type.name,
      category: selection.category.name,
      subcategory: selection.subcategory.name,
      subcategorySymbol: selection.subcategory.sym || '',
      productId,
      details: selection.details || '',
      quantity: selection.qty,
      content: isCurrentUnitFractional() ? normalizeContent(selection.content) : (selection.content || ''),
      bestBefore: selection.bestBefore || '',
      yearColor: yearColorFor(selection.bestBefore),
      storage: selection.storage || '',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const stockDoc = await addDoc(collection(db, 'stockItems'), data);
    lastCheckInId = stockDoc.id;

    const logDoc = await addDoc(collection(db, 'stockLog'), {
      action: 'in',
      productName: selection.product.name,
      quantity: data.quantity,
      details: data.details,
      content: data.content,
      bestBefore: data.bestBefore,
      createdAt: nowIso,
    });
    lastLogId = logDoc.id;

    renderResultLines(successDetail, {
      qty: selection.qty,
      productName: selection.product.name,
      bestBefore: data.bestBefore,
      storage: data.storage,
    });

    // The add-from-Bestandsliste entry point (openAddFlow) skips the
    // success screen entirely and jumps straight back — the whole point
    // of that button was to add-and-return in one step, not add-then-
    // require-a-second-tap-on-"Zurück". showUndoToast() must run *after*
    // returnHome(), since returnHome() itself starts by hiding any
    // currently-shown toast.
    if (launchedFromStocktable) {
      returnHome();
    } else {
      goToStep('success');
    }
    showUndoToast(`Eingelagert: ${selection.product.name}`);
    renderRecentLog(recentLogEl);
    // Bestandsliste (stock-table.js) and Entnehmen (stock-checkout.js) each
    // keep their own read cache of stockItems/products — without this they
    // wouldn't see this batch until a manual refresh or full reload.
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    alert('Fehler beim Einlagern: ' + err.message);
    console.error(err);
  } finally {
    checkinConfirmBtn.disabled = false;
  }
});

// --- Success / undo ----------------------------------------------------

function showUndoToast(text) {
  undoToastText.textContent = text;
  undoToast.classList.remove('hidden');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    undoToast.classList.add('hidden');
    lastCheckInId = null;
    lastLogId = null;
  }, 5000);
}

function hideUndoToast() {
  clearTimeout(undoTimer);
  undoToast.classList.add('hidden');
}

undoBtn.addEventListener('click', async () => {
  if (!lastCheckInId) {
    hideUndoToast();
    return;
  }
  const idToDelete = lastCheckInId;
  const logIdToDelete = lastLogId;
  lastCheckInId = null;
  lastLogId = null;
  hideUndoToast();
  try {
    await deleteDoc(doc(db, 'stockItems', idToDelete));
    if (logIdToDelete) await deleteDoc(doc(db, 'stockLog', logIdToDelete));
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    alert('Rückgängig fehlgeschlagen: ' + err.message);
    console.error(err);
  }
  returnHome();
});

// Set only by openAddFlow (a tap-through from the Bestandsliste's own "+"
// button, js/stock-table.js) — tells returnHome() to land back on the
// Bestandsliste instead of this screen's own home once the flow ends,
// however it ends (confirm-then-"zurück", or cancelling all the way out).
let launchedFromStocktable = false;

function returnHome() {
  hideUndoToast();
  stockFlowEl.classList.add('hidden');
  stockHomeEl.classList.remove('hidden');
  if (launchedFromStocktable) {
    launchedFromStocktable = false;
    document.querySelector('.nav-btn[data-tab="settings"]').click();
    document.querySelector('.settings-card[data-target="stocktable"]').click();
  }
}

backHomeBtn.addEventListener('click', returnHome);

// --- Entry point ---------------------------------------------------------

startCheckinBtn.addEventListener('click', () => {
  selection = {
    type: null, category: null, subcategory: null,
    product: null, isNewProduct: false, newProductUnit: 'kg',
    qty: 1, details: '', content: '', bestBefore: '', storage: '',
  };
  stockHomeEl.classList.add('hidden');
  stockFlowEl.classList.remove('hidden');
  goToStep('type');
});

// Tap-through from the Bestandsliste's "+" button (js/stock-table.js) —
// reuses this exact guided flow (taxonomy drilldown or search, then new-
// or-existing product, then batch details) rather than building a second,
// bespoke add form; see returnHome() for the matching return trip.
export function openAddFlow() {
  // Switching tabs first, then setting the flag: the nav-btn click fires
  // erdkeller:navreset('stock') synchronously, and that handler clears
  // this exact flag (see below) as its own stale-flag guard — setting the
  // flag before the click meant it was wiped out immediately, before
  // startCheckinBtn.click() ever ran, silently turning this into a plain
  // Einlagern run with no memory of where it was launched from.
  document.querySelector('.nav-btn[data-tab="stock"]').click();
  launchedFromStocktable = true;
  startCheckinBtn.click();
}

window.addEventListener('erdkeller:signedin', () => loadConfig());
window.addEventListener('erdkeller:refresh', () => loadConfig());

// Tapping the Bestand nav icon (even while already on it) always returns
// to the two big buttons, regardless of how deep this flow was — and, if
// the add-from-Bestandsliste flow was abandoned by switching tabs rather
// than tapping its own back arrow, clears that stale flag so a later
// *normal* Einlagern run doesn't misfire back into Admin.
window.addEventListener('erdkeller:navreset', (e) => {
  if (e.detail.tab !== 'stock') return;
  stockFlowEl.classList.add('hidden');
  stockHomeEl.classList.remove('hidden');
  launchedFromStocktable = false;
});
