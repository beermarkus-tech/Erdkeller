import { db } from './firebase-init.js?v=158';
import { PALETTE } from './year-colors.js?v=158';
import { renderRecentLog } from './stock-log.js?v=158';
import { renderResultLines } from './format-batch.js?v=158';
import {
  doc, getDoc, collection, getDocs, deleteDoc, setDoc, addDoc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const stockHomeEl = document.getElementById('stock-home');
const stockFlowEl = document.getElementById('stock-flow-checkout');
const startCheckoutBtn = document.getElementById('start-checkout-btn');
const backHomeBtn = document.getElementById('checkout-back-home-btn');
const flowBackBtn = document.getElementById('checkout-back-btn');
const recentLogEl = document.getElementById('checkout-recent-log');

const breadcrumbEl = document.getElementById('checkout-breadcrumb');
const flowSteps = document.querySelectorAll('#stock-flow-checkout .flow-step');

// The header (topbar-subtitle/tablet-header) otherwise just shows the
// tab's own fixed label ("Bestand") no matter which of Einlagern/Entnehmen
// is open, making the two flows' identical-looking first step ambiguous —
// same pattern js/settings-nav.js already uses for its own sub-panels.
const topbarSubtitle = document.getElementById('topbar-subtitle');
const tabletHeader = document.getElementById('tablet-header');
function setHeader(text) {
  topbarSubtitle.textContent = text;
  tabletHeader.textContent = text;
}

const PREV_STEP = {
  type: null,
  category: 'type',
  subcategory: 'category',
  batch: 'subcategory',
  remove: 'batch',
};

const globalSearchInput = document.getElementById('checkout-global-search');
const globalSearchResults = document.getElementById('checkout-global-search-results');
const typeGrid = document.getElementById('checkout-type-grid');
const typeGridLabel = document.getElementById('checkout-type-grid-label');
const categoryGrid = document.getElementById('checkout-category-grid');
const subcategoryGrid = document.getElementById('checkout-subcategory-grid');

const batchSearchInput = document.getElementById('checkout-batch-search');
const batchListEl = document.getElementById('checkout-batch-list');

const batchMetaEl = document.getElementById('checkout-batch-meta');
const qtyNumEl = document.getElementById('checkout-qty-num');
const qtyMinusBtn = document.getElementById('checkout-qty-minus');
const qtyPlusBtn = document.getElementById('checkout-qty-plus');
const confirmBtn = document.getElementById('checkout-confirm-btn');

const successDetail = document.getElementById('checkout-success-detail');

const undoToast = document.getElementById('checkout-undo-toast');
const undoToastText = document.getElementById('checkout-undo-toast-text');
const undoBtn = document.getElementById('checkout-undo-btn');

const COLOR_HEX = Object.fromEntries(PALETTE.map((c) => [c.name, c.hex]));

let taxonomy = { types: [] };
let allProducts = [];
let allBatches = [];
let targets = { products: {} };
let productIndex = new Map(); // productId -> product
let subcategoryIndex = new Map(); // subcategoryId -> { type, category, subcategory }
let configLoadOk = false;

let selection = { type: null, category: null, subcategory: null, batch: null, removeQty: 1 };

let lastCheckoutId = null;
let lastCheckoutOriginal = null;
let lastLogId = null;
// Set only when this checkout auto-deleted the product's catalog entry too
// (see confirmBtn below) — restored by Rückgängig alongside the batch so
// undo doesn't leave a restored stockItem pointing at a product that no
// longer exists.
let lastDeletedProduct = null;
let undoTimer = null;

// --- Data loading -----------------------------------------------------

async function loadConfig() {
  try {
    const [taxSnap, productsSnap, batchesSnap, targetsSnap] = await Promise.all([
      getDoc(doc(db, 'config', 'taxonomy')),
      getDocs(collection(db, 'products')),
      getDocs(collection(db, 'stockItems')),
      getDoc(doc(db, 'config', 'targets')),
    ]);
    taxonomy = taxSnap.exists() && Array.isArray(taxSnap.data().types) ? taxSnap.data() : { types: [] };
    allProducts = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    allBatches = batchesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    targets = targetsSnap.exists() && targetsSnap.data() ? targetsSnap.data() : { products: {} };
    if (!targets.products) targets.products = {};
    productIndex = new Map(allProducts.map((p) => [p.id, p]));
    buildSubcategoryIndex();
    configLoadOk = true;
  } catch (err) {
    configLoadOk = false;
    console.error(err);
  }
  startCheckoutBtn.disabled = !configLoadOk;
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

function subcategoryHasStock(subId) {
  return allBatches.some((b) => {
    const p = productIndex.get(b.productId);
    return p && p.subcategoryId === subId;
  });
}

function categoryHasStock(cat) {
  return (cat.subcategories || []).some((sub) => subcategoryHasStock(sub.id));
}

function typeHasStock(type) {
  return (type.categories || []).some((cat) => categoryHasStock(cat));
}

// See js/taxonomy.js's typeClass for the fallback-derivation rationale.
function typeClass(type) {
  if (type.typeClass) return type.typeClass;
  return type.isFoodType ? 'food' : 'other';
}

// --- Navigation ---------------------------------------------------------

function setActiveStep(stepName) {
  flowSteps.forEach((el) => {
    el.classList.toggle('active', el.dataset.checkoutStep === stepName);
  });
}

function currentStepName() {
  const active = Array.from(flowSteps).find((el) => el.classList.contains('active'));
  return active ? active.dataset.checkoutStep : null;
}

function goBack() {
  const current = currentStepName();
  if (!current || current === 'success') return;
  let prev = PREV_STEP[current];
  // Wasser skips the subcategory step (see renderCategoryGrid) — never
  // step back into a screen that was never actually shown.
  if (current === 'batch' && selection.type && typeClass(selection.type) === 'water') prev = 'category';
  if (prev) goToStep(prev);
  else returnHome();
}

flowBackBtn.addEventListener('click', goBack);

function goToStep(stepName) {
  flowBackBtn.classList.toggle('hidden', stepName === 'success');
  if (stepName === 'type') {
    selection.category = null;
    selection.subcategory = null;
    selection.batch = null;
    globalSearchInput.value = '';
    globalSearchResults.classList.add('hidden');
    typeGrid.classList.remove('hidden');
    typeGridLabel.classList.remove('hidden');
    renderTypeGrid();
  } else if (stepName === 'category') {
    selection.subcategory = null;
    selection.batch = null;
    renderCategoryGrid();
  } else if (stepName === 'subcategory') {
    selection.batch = null;
    renderSubcategoryGrid();
  } else if (stepName === 'batch') {
    batchSearchInput.value = '';
    renderBatchList('');
  } else if (stepName === 'remove') {
    prepareRemoveStep();
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
  if (selection.batch && (currentStep === 'remove' || currentStep === 'success')) {
    crumbs.push({ label: productName(selection.batch.productId), step: currentStep === 'success' ? null : 'remove' });
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

function makeTile(sym, name, onClick, extraClass, disabled) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'tile' + (extraClass ? ' ' + extraClass : '') + (disabled ? ' tile-empty' : '');
  const symEl = document.createElement('span');
  symEl.className = 'sym';
  symEl.textContent = sym || '';
  const nameEl = document.createElement('span');
  nameEl.textContent = name;
  tile.appendChild(symEl);
  tile.appendChild(nameEl);
  if (disabled) {
    tile.disabled = true;
  } else {
    tile.addEventListener('click', onClick);
  }
  return tile;
}

function renderTypeGrid() {
  typeGrid.innerHTML = '';
  (taxonomy.types || []).forEach((type) => {
    typeGrid.appendChild(makeTile(type.sym, type.name, () => {
      selection.type = type;
      goToStep('category');
    }, 'type-tile', !typeHasStock(type)));
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
      // straight to the batch list instead of showing that step.
      if (isWater && cat.subcategories && cat.subcategories[0]) {
        selection.subcategory = cat.subcategories[0];
        goToStep('batch');
      } else {
        goToStep('subcategory');
      }
    }, null, !categoryHasStock(cat)));
  });
}

function renderSubcategoryGrid() {
  subcategoryGrid.innerHTML = '';
  ((selection.category && selection.category.subcategories) || []).forEach((sub) => {
    subcategoryGrid.appendChild(makeTile(sub.sym, sub.name, () => {
      selection.subcategory = sub;
      goToStep('batch');
    }, null, !subcategoryHasStock(sub.id)));
  });
}

function batchesForCurrentSubcategory() {
  if (!selection.subcategory) return [];
  return allBatches.filter((b) => {
    const p = productIndex.get(b.productId);
    return p && p.subcategoryId === selection.subcategory.id;
  });
}

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

function renderBatchRow(batch, container) {
  const row = document.createElement('div');
  row.className = 'stock-product-row';

  const left = document.createElement('span');
  left.style.display = 'flex';
  left.style.alignItems = 'center';

  left.appendChild(makeYearBadge(batch));

  const textWrap = document.createElement('span');
  textWrap.style.display = 'flex';
  textWrap.style.flexDirection = 'column';
  const nameEl = document.createElement('span');
  nameEl.className = 'pname';
  nameEl.textContent = productName(batch.productId);
  const metaEl = document.createElement('span');
  metaEl.className = 'pmeta';
  metaEl.textContent = batchMetaLine(batch);
  textWrap.appendChild(nameEl);
  textWrap.appendChild(metaEl);
  left.appendChild(textWrap);

  row.appendChild(left);
  row.addEventListener('click', () => {
    selection.batch = batch;
    goToStep('remove');
  });
  container.appendChild(row);
}

function renderBatchList(filterText) {
  batchListEl.innerHTML = '';
  const q = (filterText || '').trim().toLowerCase();
  const batches = batchesForCurrentSubcategory()
    .filter((b) => !q || productName(b.productId).toLowerCase().includes(q))
    .sort((a, b) => productName(a.productId).localeCompare(productName(b.productId), 'de'));

  if (batches.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'screen-placeholder';
    empty.textContent = 'Kein Bestand in dieser Unterkategorie.';
    batchListEl.appendChild(empty);
    return;
  }
  batches.forEach((b) => renderBatchRow(b, batchListEl));
}

batchSearchInput.addEventListener('input', () => renderBatchList(batchSearchInput.value));

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

  const matches = allBatches
    .filter((b) => productName(b.productId).toLowerCase().includes(q))
    .sort((a, b) => productName(a.productId).localeCompare(productName(b.productId), 'de'))
    .slice(0, 30);

  if (matches.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'screen-placeholder';
    empty.textContent = 'Kein Bestand gefunden.';
    globalSearchResults.appendChild(empty);
    return;
  }

  matches.forEach((batch) => {
    const p = productIndex.get(batch.productId);
    const path = p ? subcategoryIndex.get(p.subcategoryId) : null;
    const row = document.createElement('div');
    row.className = 'stock-product-row';
    const left = document.createElement('span');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.appendChild(makeYearBadge(batch));
    const nameEl = document.createElement('span');
    nameEl.className = 'pname';
    nameEl.textContent = productName(batch.productId);
    const metaEl = document.createElement('span');
    metaEl.className = 'pmeta';
    metaEl.textContent = batchMetaLine(batch);
    const wrap = document.createElement('span');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.appendChild(nameEl);
    wrap.appendChild(metaEl);
    left.appendChild(wrap);
    row.appendChild(left);
    row.addEventListener('click', () => {
      if (!path) return;
      selection.type = path.type;
      selection.category = path.category;
      selection.subcategory = path.subcategory;
      selection.batch = batch;
      globalSearchInput.value = '';
      globalSearchResults.classList.add('hidden');
      typeGrid.classList.remove('hidden');
      typeGridLabel.classList.remove('hidden');
      goToStep('remove');
    });
    globalSearchResults.appendChild(row);
  });
}

globalSearchInput.addEventListener('input', () => renderGlobalSearchResults(globalSearchInput.value));

// --- Remove step ---------------------------------------------------------

function prepareRemoveStep() {
  if (selection.batch) {
    renderResultLines(batchMetaEl, {
      qty: selection.batch.quantity,
      productName: productName(selection.batch.productId),
      bestBefore: selection.batch.bestBefore,
      storage: selection.batch.storage,
    });
  } else {
    batchMetaEl.innerHTML = '';
  }
  selection.removeQty = 1;
  qtyNumEl.value = '1';
}

qtyMinusBtn.addEventListener('click', () => {
  selection.removeQty = Math.max(1, selection.removeQty - 1);
  qtyNumEl.value = String(selection.removeQty);
});
qtyPlusBtn.addEventListener('click', () => {
  const max = selection.batch ? selection.batch.quantity : 1;
  selection.removeQty = Math.min(max, selection.removeQty + 1);
  qtyNumEl.value = String(selection.removeQty);
});
// Tap the number to type a quantity directly (e.g. removing 60 bottles of
// water at once) — see the .qty-num CSS comment for why this is a real
// <input> styled to look like the plain number it replaced.
qtyNumEl.addEventListener('focus', () => qtyNumEl.select());
qtyNumEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') qtyNumEl.blur();
});
qtyNumEl.addEventListener('blur', () => {
  const max = selection.batch ? selection.batch.quantity : 1;
  const n = parseInt(qtyNumEl.value, 10);
  selection.removeQty = Number.isFinite(n) ? Math.min(max, Math.max(1, n)) : 1;
  qtyNumEl.value = String(selection.removeQty);
});

// --- Confirm & write -------------------------------------------------

confirmBtn.addEventListener('click', async () => {
  if (!selection.batch) return;
  confirmBtn.disabled = true;
  try {
    const batch = selection.batch;
    const ref = doc(db, 'stockItems', batch.id);
    const originalData = { ...batch };
    delete originalData.id;
    lastDeletedProduct = null;

    if (selection.removeQty >= batch.quantity) {
      await deleteDoc(ref);
      allBatches = allBatches.filter((b) => b.id !== batch.id);

      // Checking a product's last batch out to zero deletes it from the
      // catalog too, not just the batch — otherwise it's exactly the kind
      // of orphaned /products doc (no stock, invisible everywhere, never
      // cleaned up) Bestandsliste's zero-stock rows exist to catch. The one
      // exception: a product with an active Ziele target stays in the
      // catalog (and shows up there with zero stock) since it's still
      // meant to be restocked.
      const stillStocked = allBatches.some((b) => b.productId === batch.productId);
      if (!stillStocked && !targets.products[batch.productId]) {
        const product = productIndex.get(batch.productId);
        if (product) {
          await deleteDoc(doc(db, 'products', batch.productId));
          lastDeletedProduct = { ...product };
          allProducts = allProducts.filter((p) => p.id !== batch.productId);
          productIndex.delete(batch.productId);
        }
      }
    } else {
      const updated = { ...originalData, quantity: batch.quantity - selection.removeQty, updatedAt: new Date().toISOString() };
      await setDoc(ref, updated);
      const idx = allBatches.findIndex((b) => b.id === batch.id);
      if (idx >= 0) allBatches[idx] = { id: batch.id, ...updated };
    }

    lastCheckoutId = batch.id;
    lastCheckoutOriginal = originalData;

    const logDoc = await addDoc(collection(db, 'stockLog'), {
      action: 'out',
      productName: productName(batch.productId),
      quantity: selection.removeQty,
      details: batch.details || '',
      content: batch.content || '',
      bestBefore: batch.bestBefore || '',
      createdAt: new Date().toISOString(),
    });
    lastLogId = logDoc.id;

    renderResultLines(successDetail, {
      qty: selection.removeQty,
      productName: productName(batch.productId),
      bestBefore: batch.bestBefore,
      storage: batch.storage,
    });

    // Build 134: same pattern as Einlagern — the button itself confirms
    // (checkmark + "Entnommen") for a beat, then the toast carries the
    // lingering confirmation/undo while the flow drops straight back to
    // its own first step instead of a separate success screen.
    confirmBtn.textContent = '✓ Entnommen';
    await new Promise((resolve) => setTimeout(resolve, 600));
    confirmBtn.textContent = 'Entnehmen bestätigen';

    goToStep('type');
    showUndoToast(`Entnommen: ${productName(batch.productId)}`);
    renderRecentLog(recentLogEl);
    // Bestandsliste (stock-table.js) and Einlagern (stock-checkin.js) each
    // keep their own read cache of stockItems — without this they wouldn't
    // see this change until a manual refresh or full reload.
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    alert('Fehler beim Entnehmen: ' + err.message);
    console.error(err);
  } finally {
    confirmBtn.disabled = false;
  }
});

// --- Success / undo ----------------------------------------------------

function showUndoToast(text) {
  undoToastText.textContent = text;
  undoToast.classList.remove('hidden');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    undoToast.classList.add('hidden');
    lastCheckoutId = null;
    lastCheckoutOriginal = null;
    lastLogId = null;
    lastDeletedProduct = null;
  }, 5000);
}

function hideUndoToast() {
  clearTimeout(undoTimer);
  undoToast.classList.add('hidden');
}

undoBtn.addEventListener('click', async () => {
  if (!lastCheckoutId || !lastCheckoutOriginal) {
    hideUndoToast();
    return;
  }
  const idToRestore = lastCheckoutId;
  const dataToRestore = lastCheckoutOriginal;
  const logIdToDelete = lastLogId;
  const productToRestore = lastDeletedProduct;
  lastCheckoutId = null;
  lastCheckoutOriginal = null;
  lastLogId = null;
  lastDeletedProduct = null;
  hideUndoToast();
  try {
    if (productToRestore) {
      const { id: productId, ...productData } = productToRestore;
      await setDoc(doc(db, 'products', productId), productData);
      allProducts.push({ id: productId, ...productData });
      productIndex.set(productId, { id: productId, ...productData });
    }
    await setDoc(doc(db, 'stockItems', idToRestore), dataToRestore);
    const idx = allBatches.findIndex((b) => b.id === idToRestore);
    if (idx >= 0) allBatches[idx] = { id: idToRestore, ...dataToRestore };
    else allBatches.push({ id: idToRestore, ...dataToRestore });
    if (logIdToDelete) await deleteDoc(doc(db, 'stockLog', logIdToDelete));
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    alert('Rückgängig fehlgeschlagen: ' + err.message);
    console.error(err);
  }
  returnHome();
});

function returnHome() {
  hideUndoToast();
  stockFlowEl.classList.add('hidden');
  stockHomeEl.classList.remove('hidden');
  setHeader('Bestand');
}

backHomeBtn.addEventListener('click', returnHome);

// --- Entry point ---------------------------------------------------------

startCheckoutBtn.addEventListener('click', () => {
  selection = { type: null, category: null, subcategory: null, batch: null, removeQty: 1 };
  stockHomeEl.classList.add('hidden');
  stockFlowEl.classList.remove('hidden');
  setHeader('Entnehmen');
  goToStep('type');
});

window.addEventListener('erdkeller:signedin', () => loadConfig());
window.addEventListener('erdkeller:refresh', () => loadConfig());

// Tapping the Bestand nav icon (even while already on it) always returns
// to the two big buttons, regardless of how deep this flow was.
window.addEventListener('erdkeller:navreset', (e) => {
  if (e.detail.tab !== 'stock') return;
  stockFlowEl.classList.add('hidden');
  stockHomeEl.classList.remove('hidden');
});
