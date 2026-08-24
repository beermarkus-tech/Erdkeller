import { db } from './firebase-init.js?v=47';
import {
  doc, getDoc, setDoc, collection, getDocs,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const targetsCard = document.querySelector('.settings-card[data-target="targets"]');
const panelEl = document.getElementById('settings-panel-targets');
const treeEl = document.getElementById('targets-tree');
const statusEl = document.getElementById('targets-status');
const productTargetsList = document.getElementById('product-targets-list');
const addProductTargetBtn = document.getElementById('add-product-target-btn');

const pickerModal = document.getElementById('target-picker-modal');
const pickerSearch = document.getElementById('target-picker-search');
const pickerList = document.getElementById('target-picker-list');

const editModal = document.getElementById('target-edit-modal');
const editTitle = document.getElementById('target-edit-title');
const modeToggleButtons = editModal.querySelectorAll('#target-mode-toggle .unit-btn');
const flatGroup = document.getElementById('target-flat-group');
const flatLabel = document.getElementById('target-flat-label');
const flatInput = document.getElementById('target-flat-input');
const pdGroup = document.getElementById('target-pd-group');
const rateLabel = document.getElementById('target-rate-label');
const rateInput = document.getElementById('target-rate-input');
const peopleInput = document.getElementById('target-people-input');
const daysInput = document.getElementById('target-days-input');
const computedNote = document.getElementById('target-computed-note');
const saveBtn = document.getElementById('target-save-btn');
const clearBtn = document.getElementById('target-clear-btn');

let taxonomy = { types: [] };
let allProducts = [];
let productIndex = new Map();
let targets = { types: {}, categories: {}, subcategories: {}, products: {} };
let loadOk = false;

// Defaults for the Personen×Tage fields, sourced from Settings → Planung
// (js/planning.js) — household member count and the configured autonomy
// duration. Only used to pre-fill new/unset targets, never overwrites a
// target that already has its own saved people/days values.
let defaultPeopleCount = null;
let defaultAutonomyDays = null;

const openTypes = new Set();
const openCats = new Set();

let editingContext = null; // { level, id, label, unit }
let pendingMode = 'flat';

// --- Data loading -----------------------------------------------------

async function loadAll() {
  try {
    const [taxSnap, targetsSnap, productsSnap, householdSnap, planningSnap] = await Promise.all([
      getDoc(doc(db, 'config', 'taxonomy')),
      getDoc(doc(db, 'config', 'targets')),
      getDocs(collection(db, 'products')),
      getDoc(doc(db, 'config', 'household')),
      getDoc(doc(db, 'config', 'planning')),
    ]);
    taxonomy = taxSnap.exists() && Array.isArray(taxSnap.data().types) ? taxSnap.data() : { types: [] };
    const t = targetsSnap.exists() ? targetsSnap.data() : {};
    targets = {
      types: t.types || {},
      categories: t.categories || {},
      subcategories: t.subcategories || {},
      products: t.products || {},
    };
    allProducts = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    productIndex = new Map(allProducts.map((p) => [p.id, p]));
    const householdMembers = householdSnap.exists() && Array.isArray(householdSnap.data().members) ? householdSnap.data().members : [];
    defaultPeopleCount = householdMembers.length || null;
    defaultAutonomyDays = planningSnap.exists() ? (planningSnap.data().autonomyDays ?? null) : null;
    loadOk = true;
  } catch (err) {
    loadOk = false;
    statusEl.textContent = 'Fehler beim Laden: ' + err.message;
    console.error(err);
  }
  render();
}

async function saveTargets() {
  if (!loadOk) {
    statusEl.textContent = 'Speichern blockiert: Die Daten wurden zuletzt nicht erfolgreich geladen. Bitte Seite neu laden.';
    return;
  }
  statusEl.textContent = 'Speichere…';
  try {
    await setDoc(doc(db, 'config', 'targets'), targets);
    statusEl.textContent = '';
  } catch (err) {
    statusEl.textContent = 'Fehler beim Speichern: ' + err.message;
    console.error(err);
  }
}

// --- Target formatting -----------------------------------------------

function computeAmount(target) {
  if (!target) return 0;
  if (target.mode === 'flat') return target.amount || 0;
  return Math.round((target.ratePerPersonDay || 0) * (target.people || 0) * (target.days || 0) * 100) / 100;
}

function unitLabel(unit) {
  return unit === 'stueck' ? 'Stk' : 'kg';
}

function formatTargetLabel(target) {
  if (!target) return 'Kein Ziel';
  const amt = computeAmount(target);
  const u = unitLabel(target.unit);
  if (target.mode === 'flat') return `${amt} ${u}`;
  return `${target.people}×${target.days}T (${amt} ${u})`;
}

// --- Tree rendering ------------------------------------------------------

function makeRow(sym, name, target, level, id, unit, hasToggle, isOpen, onToggle) {
  const head = document.createElement('div');
  head.className = level === 'types' ? 'tax-type-head' : (level === 'categories' ? 'tax-cat-head' : 'tax-sub-row');

  const symEl = document.createElement('span');
  symEl.className = 'sym';
  symEl.textContent = sym || '';

  const nameEl = document.createElement('span');
  nameEl.className = 'tax-name-display';
  nameEl.textContent = name;

  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'target-badge' + (target ? ' has-target' : '');
  badge.textContent = formatTargetLabel(target);
  badge.addEventListener('click', () => openEdit(level, id, name, unit));

  head.appendChild(symEl);
  head.appendChild(nameEl);
  head.appendChild(badge);

  if (hasToggle) {
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'tax-toggle';
    toggleBtn.textContent = isOpen ? '▴' : '▾';
    toggleBtn.addEventListener('click', onToggle);
    head.appendChild(toggleBtn);
  }

  return head;
}

function renderTypeRow(type) {
  const wrap = document.createElement('div');
  wrap.className = 'tax-type';
  const isOpen = openTypes.has(type.id);
  const head = makeRow(type.sym, type.name, targets.types[type.id], 'types', type.id, 'kg', true, isOpen, () => {
    if (openTypes.has(type.id)) openTypes.delete(type.id);
    else openTypes.add(type.id);
    render();
  });
  wrap.appendChild(head);

  const body = document.createElement('div');
  body.className = 'tax-body' + (isOpen ? ' open' : '');
  (type.categories || []).forEach((cat) => body.appendChild(renderCategoryRow(cat)));
  wrap.appendChild(body);
  return wrap;
}

function renderCategoryRow(cat) {
  const wrap = document.createElement('div');
  wrap.className = 'tax-cat';
  const isOpen = openCats.has(cat.id);
  const head = makeRow(cat.sym, cat.name, targets.categories[cat.id], 'categories', cat.id, 'kg', true, isOpen, () => {
    if (openCats.has(cat.id)) openCats.delete(cat.id);
    else openCats.add(cat.id);
    render();
  });
  wrap.appendChild(head);

  const body = document.createElement('div');
  body.className = 'tax-cat-body' + (isOpen ? ' open' : '');
  const subList = document.createElement('div');
  subList.className = 'tax-sub-list';
  (cat.subcategories || []).forEach((sub) => subList.appendChild(renderSubcategoryRow(sub)));
  body.appendChild(subList);
  wrap.appendChild(body);
  return wrap;
}

function renderSubcategoryRow(sub) {
  return makeRow(sub.sym, sub.name, targets.subcategories[sub.id], 'subcategories', sub.id, 'kg', false, false, null);
}

function renderProductTargets() {
  productTargetsList.innerHTML = '';
  const ids = Object.keys(targets.products || {});
  if (ids.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'screen-placeholder';
    empty.textContent = 'Keine Produktziele.';
    productTargetsList.appendChild(empty);
    return;
  }
  ids.forEach((productId) => {
    const product = productIndex.get(productId);
    const name = product ? product.name : '(unbekanntes Produkt)';
    const unit = product ? product.unitType : 'kg';
    const row = document.createElement('div');
    row.className = 'stock-product-row';
    const nameEl = document.createElement('span');
    nameEl.className = 'pname';
    nameEl.textContent = name;
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'target-badge has-target';
    badge.textContent = formatTargetLabel(targets.products[productId]);
    badge.addEventListener('click', () => openEdit('products', productId, name, unit));
    row.appendChild(nameEl);
    row.appendChild(badge);
    productTargetsList.appendChild(row);
  });
}

function render() {
  treeEl.innerHTML = '';
  taxonomy.types.forEach((type) => treeEl.appendChild(renderTypeRow(type)));
  renderProductTargets();
}

// --- Product picker (for adding a new product target) ---------------

function renderPickerList(filterText) {
  pickerList.innerHTML = '';
  const q = filterText.trim().toLowerCase();
  const matches = allProducts
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    .slice(0, 50);

  if (matches.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'screen-placeholder';
    empty.textContent = 'Keine Produkte gefunden.';
    pickerList.appendChild(empty);
    return;
  }

  matches.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'stock-product-row';
    const nameEl = document.createElement('span');
    nameEl.className = 'pname';
    nameEl.textContent = p.name;
    row.appendChild(nameEl);
    row.addEventListener('click', () => {
      pickerModal.classList.remove('show');
      openEdit('products', p.id, p.name, p.unitType);
    });
    pickerList.appendChild(row);
  });
}

addProductTargetBtn.addEventListener('click', () => {
  pickerSearch.value = '';
  renderPickerList('');
  pickerModal.classList.add('show');
});

pickerSearch.addEventListener('input', () => renderPickerList(pickerSearch.value));

pickerModal.addEventListener('click', (e) => {
  if (e.target === pickerModal) pickerModal.classList.remove('show');
});

// --- Edit modal ------------------------------------------------------------

function setMode(mode) {
  pendingMode = mode;
  modeToggleButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === mode));
  flatGroup.classList.toggle('hidden', mode !== 'flat');
  pdGroup.classList.toggle('hidden', mode !== 'peopleDuration');
}

modeToggleButtons.forEach((btn) => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

function updateComputedNote() {
  const rate = Number(rateInput.value) || 0;
  const people = Number(peopleInput.value) || 0;
  const days = Number(daysInput.value) || 0;
  const amt = Math.round(rate * people * days * 100) / 100;
  const u = editingContext ? unitLabel(editingContext.unit) : 'kg';
  computedNote.textContent = `= ${amt} ${u} gesamt`;
}

[rateInput, peopleInput, daysInput].forEach((el) => el.addEventListener('input', updateComputedNote));

function openEdit(level, id, label, unit) {
  editingContext = { level, id, label, unit };
  const target = targets[level][id];

  editTitle.textContent = label;

  const u = unitLabel(unit);
  flatLabel.textContent = `Menge (${u})`;
  rateLabel.textContent = `Menge pro Person/Tag (${u})`;

  setMode(target ? target.mode : 'flat');

  flatInput.value = target && target.mode === 'flat' ? target.amount : '';
  rateInput.value = target && target.mode === 'peopleDuration' ? target.ratePerPersonDay : '';
  // Pre-fill Personen/Tage from Settings → Planung (household size / autonomy
  // duration) whenever this target has no saved value of its own yet — lets
  // switching to "Personen × Tage" mode start from a sensible default
  // instead of blank fields.
  peopleInput.value = target && target.mode === 'peopleDuration' ? target.people : (defaultPeopleCount ?? '');
  daysInput.value = target && target.mode === 'peopleDuration' ? target.days : (defaultAutonomyDays ?? '');
  updateComputedNote();

  editModal.classList.add('show');
}

editModal.addEventListener('click', (e) => {
  if (e.target === editModal) editModal.classList.remove('show');
});

saveBtn.addEventListener('click', async () => {
  if (!editingContext) return;
  const { level, id, unit } = editingContext;
  let target;
  if (pendingMode === 'flat') {
    const amount = Number(flatInput.value);
    if (flatInput.value === '' || isNaN(amount)) {
      alert('Bitte eine Menge eingeben.');
      return;
    }
    target = { mode: 'flat', amount, unit };
  } else {
    const rate = Number(rateInput.value);
    const people = Number(peopleInput.value);
    const days = Number(daysInput.value);
    if (rateInput.value === '' || peopleInput.value === '' || daysInput.value === '') {
      alert('Bitte Menge/Person/Tag, Personen und Tage ausfüllen.');
      return;
    }
    target = {
      mode: 'peopleDuration', ratePerPersonDay: rate, people, days, unit,
    };
  }
  targets[level][id] = target;
  editModal.classList.remove('show');
  editingContext = null;
  await saveTargets();
  render();
});

clearBtn.addEventListener('click', async () => {
  if (!editingContext) return;
  const { level, id } = editingContext;
  delete targets[level][id];
  editModal.classList.remove('show');
  editingContext = null;
  await saveTargets();
  render();
});

// --- Entry point -----------------------------------------------------------

targetsCard.addEventListener('click', () => loadAll());

window.addEventListener('erdkeller:refresh', () => {
  if (!panelEl.classList.contains('hidden')) loadAll();
});
