// Ziele — SPEC.md Section 7. Type-level targets were removed (the food/
// non-food distinction that would give a type-level number real meaning is
// a later feature); everything below the type level works as follows:
//   - A category in Taxonomy mode "Aus" keeps a fully manual target (flat
//     kg/Stk, or Personen×Tage), exactly like before — click the badge,
//     edit, save. Its subcategories are independently manual the same way.
//   - A category tagged Kalorien, Diversität, or assigned as the Wasser
//     category in Planung gets a LIVE COMPUTED target instead: no click,
//     no "apply" step. Kalorien categories that share a macro (Kohlenhydrate/
//     Protein/Fett) split that macro's global kcal target between them via
//     a ±5% stepper (see stepSplit below); any computed category's total
//     then splits again across its own subcategories the same way.
// This file reads /config/household and /config/planning directly so the
// whole pipeline (Taxonomie → Planung → Ziele) stays in sync with no
// manual commit anywhere.
import { db } from './firebase-init.js?v=48';
import {
  doc, getDoc, setDoc, collection, getDocs,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const targetsCard = document.querySelector('.settings-card[data-target="targets"]');
const panelEl = document.getElementById('settings-panel-targets');
const unitToggleButtons = document.querySelectorAll('#targets-unit-toggle .unit-btn');
const macroSummaryEl = document.getElementById('targets-macro-summary');
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

const MACRO_LABELS = { kohlenhydrat: 'Kohlenhydrate', protein: 'Protein', fett: 'Fett' };

let taxonomy = { types: [] };
let allProducts = [];
let productIndex = new Map();
let targets = {
  categories: {}, subcategories: {}, products: {}, macroSplits: {}, subSplits: {},
};
let household = { members: [] };
let planning = {
  autonomyDays: null, macroSplit: {}, waterLitersPerPersonDay: null, waterCategoryId: '',
};
let loadOk = false;

// Which categories currently feed each macro's split (planningMode
// 'calorie', a macroType set, and a usable kcalPerKg) — recomputed at the
// top of every render() since it depends on the live taxonomy.
let macroGroupIds = { kohlenhydrat: [], protein: [], fett: [] };

let displayUnit = 'kg';

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
      categories: t.categories || {},
      subcategories: t.subcategories || {},
      products: t.products || {},
      macroSplits: t.macroSplits || {},
      subSplits: t.subSplits || {},
    };
    allProducts = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    productIndex = new Map(allProducts.map((p) => [p.id, p]));
    household = {
      members: householdSnap.exists() && Array.isArray(householdSnap.data().members) ? householdSnap.data().members : [],
    };
    const p = planningSnap.exists() ? planningSnap.data() : {};
    planning = {
      autonomyDays: p.autonomyDays ?? null,
      macroSplit: p.macroSplit || {},
      waterLitersPerPersonDay: p.waterLitersPerPersonDay ?? null,
      waterCategoryId: p.waterCategoryId || '',
    };
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

// --- Same 3-way mode as js/taxonomy.js ---------------------------------

function categoryPlanningMode(cat) {
  if (cat.planningMode) return cat.planningMode;
  if (cat.kcalPerKg != null || !!cat.macroType) return 'calorie';
  if (cat.diversityFloorGramsPerPersonDay != null) return 'diversity';
  return 'off';
}

function findCategoryById(id) {
  for (const type of taxonomy.types) {
    for (const cat of (type.categories || [])) {
      if (cat.id === id) return cat;
    }
  }
  return null;
}

function computeMacroGroups() {
  macroGroupIds = { kohlenhydrat: [], protein: [], fett: [] };
  taxonomy.types.forEach((type) => (type.categories || []).forEach((cat) => {
    if (categoryPlanningMode(cat) === 'calorie' && cat.macroType && cat.kcalPerKg != null && macroGroupIds[cat.macroType]) {
      macroGroupIds[cat.macroType].push(cat.id);
    }
  }));
}

// --- Household / Planung formulas (SPEC.md Section 7) -------------------

function peopleCount() {
  return household.members.length;
}

function totalDailyKcal() {
  return household.members.reduce((sum, m) => sum + (Number(m.kcalPerDay) || 0), 0);
}

function autonomyDaysVal() {
  return Number(planning.autonomyDays) || 0;
}

function macroGlobalKcal(macro) {
  return totalDailyKcal() * autonomyDaysVal() * (Number(planning.macroSplit?.[macro]) || 0) / 100;
}

function waterGlobalKg() {
  return (Number(planning.waterLitersPerPersonDay) || 0) * peopleCount() * autonomyDaysVal();
}

// --- Split percentages (macro→category, category→subcategory) ---------

// A group's saved split is only trusted if it still exactly matches the
// group's current members — if a category was added/removed in Taxonomie
// since the split was last touched, fall back to a fresh equal split
// rather than risk a missing key or a stale total.
function equalSplit(ids) {
  const n = ids.length;
  if (n === 0) return {};
  const base = Math.floor(100 / (n * 5)) * 5;
  const result = {};
  let used = 0;
  ids.forEach((id) => {
    result[id] = base;
    used += base;
  });
  result[ids[0]] += 100 - used;
  return result;
}

function resolveSplit(saved, ids) {
  const complete = ids.length > 0 && Object.keys(saved).length === ids.length && ids.every((id) => saved[id] != null);
  return complete ? { ...saved } : equalSplit(ids);
}

function getMacroSplit(macro, ids) {
  return resolveSplit(targets.macroSplits[macro] || {}, ids);
}

function getSubSplit(categoryId, ids) {
  return resolveSplit(targets.subSplits[categoryId] || {}, ids);
}

// Moves exactly `delta` (±5) between `targetId` and whichever other member
// of `groupIds` currently has the most (when giving 5 away) or the least
// (when taking 5 back) — the group always sums to exactly 100, in 5-point
// steps, with no drag gesture and no way to land in an invalid split.
function stepSplit(splitMap, groupIds, targetId, delta) {
  const others = groupIds.filter((id) => id !== targetId);
  if (others.length === 0) return splitMap;
  if (delta > 0) {
    if ((splitMap[targetId] || 0) + delta > 100) return splitMap;
    const donor = others
      .filter((id) => (splitMap[id] || 0) >= delta)
      .sort((a, b) => (splitMap[b] || 0) - (splitMap[a] || 0))[0];
    if (!donor) return splitMap;
    splitMap[targetId] = (splitMap[targetId] || 0) + delta;
    splitMap[donor] = (splitMap[donor] || 0) - delta;
  } else {
    const amt = -delta;
    if ((splitMap[targetId] || 0) - amt < 0) return splitMap;
    const receiver = others.slice().sort((a, b) => (splitMap[a] || 0) - (splitMap[b] || 0))[0];
    splitMap[targetId] = (splitMap[targetId] || 0) - amt;
    splitMap[receiver] = (splitMap[receiver] || 0) + amt;
  }
  return splitMap;
}

// --- Computed-amount formatting (unit toggle) ---------------------------

function round2(n) {
  return Math.round(n * 100) / 100;
}

function formatComputedAmount(kg, cat) {
  const people = peopleCount();
  const days = autonomyDaysVal();
  if (displayUnit === 'kgpd') {
    return people > 0 && days > 0 ? `${Math.round((kg / people / days) * 1000) / 1000} kg/P/T` : `${round2(kg)} kg`;
  }
  if ((displayUnit === 'kcal' || displayUnit === 'kcalpd') && cat && cat.kcalPerKg != null) {
    const kcal = kg * cat.kcalPerKg;
    if (displayUnit === 'kcal') return `${Math.round(kcal).toLocaleString('de-DE')} kcal`;
    return people > 0 && days > 0 ? `${Math.round(kcal / people / days)} kcal/P/T` : `${round2(kg)} kg`;
  }
  return `${round2(kg)} kg`;
}

function makeComputedRow(label, valueText) {
  const row = document.createElement('div');
  row.className = 'computed-row';
  const labelEl = document.createElement('span');
  labelEl.className = 'computed-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'computed-value';
  valueEl.textContent = valueText;
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

// --- Target formatting (manual / "Aus" categories, subcategories, products) --

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

// --- Manual tree row (Aus categories/subcategories, products) -----------

function makeRow(sym, name, target, level, id, unit, hasToggle, isOpen, onToggle) {
  const head = document.createElement('div');
  head.className = level === 'categories' ? 'tax-cat-head' : 'tax-sub-row';

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

function renderManualSubRow(sub) {
  return makeRow(sub.sym, sub.name, targets.subcategories[sub.id], 'subcategories', sub.id, 'kg', false, false, null);
}

// --- Computed category (Kalorien / Diversität / Wasser) ------------------

function categoryTargetSource(cat) {
  if (planning.waterCategoryId && cat.id === planning.waterCategoryId) {
    return { kind: 'water', kg: waterGlobalKg() };
  }
  const mode = categoryPlanningMode(cat);
  if (mode === 'calorie') {
    if (!cat.macroType || cat.kcalPerKg == null || cat.kcalPerKg <= 0) return { kind: 'calorie', kg: null };
    const group = macroGroupIds[cat.macroType] || [cat.id];
    const split = getMacroSplit(cat.macroType, group);
    const pct = split[cat.id] || 0;
    return { kind: 'calorie', kg: (macroGlobalKcal(cat.macroType) * pct) / 100 / cat.kcalPerKg };
  }
  if (mode === 'diversity') {
    if (cat.diversityFloorGramsPerPersonDay == null) return { kind: 'diversity', kg: null };
    return { kind: 'diversity', kg: (cat.diversityFloorGramsPerPersonDay / 1000) * peopleCount() * autonomyDaysVal() };
  }
  return { kind: 'off', kg: null };
}

function makeComputedCategoryHead(cat, source, isOpen, onToggle) {
  const head = document.createElement('div');
  head.className = 'tax-cat-head';

  const symEl = document.createElement('span');
  symEl.className = 'sym';
  symEl.textContent = cat.sym || '';

  const nameEl = document.createElement('span');
  nameEl.className = 'tax-name-display';
  nameEl.textContent = cat.name;

  const badge = document.createElement('span');
  badge.className = 'target-badge computed';
  badge.textContent = source.kg != null ? formatComputedAmount(source.kg, cat) : '– Daten unvollständig';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'tax-toggle';
  toggleBtn.textContent = isOpen ? '▴' : '▾';
  toggleBtn.addEventListener('click', onToggle);

  head.appendChild(symEl);
  head.appendChild(nameEl);
  head.appendChild(badge);
  head.appendChild(toggleBtn);
  return head;
}

// Generic ±5%-stepper list, reused for the macro-split sections, the
// diversity section (showStepper=false — those totals aren't pooled, each
// category's floor is independent), and a computed category's own
// subcategory split.
function renderSplitGroup(items, splitMap, groupIds, onStep, showStepper) {
  const container = document.createElement('div');
  items.forEach(({ id, name, formatted }) => {
    const row = document.createElement('div');
    row.className = 'split-row';

    const info = document.createElement('div');
    info.className = 'split-info';
    const titleEl = document.createElement('div');
    titleEl.className = 'split-title';
    titleEl.textContent = name;
    const amountEl = document.createElement('div');
    amountEl.className = 'split-amount';
    amountEl.textContent = formatted;
    info.appendChild(titleEl);
    info.appendChild(amountEl);
    row.appendChild(info);

    if (showStepper && groupIds.length > 1) {
      const pct = splitMap[id] || 0;
      const stepper = document.createElement('div');
      stepper.className = 'split-stepper';

      const minusBtn = document.createElement('button');
      minusBtn.type = 'button';
      minusBtn.className = 'split-step-btn';
      minusBtn.textContent = '−';
      minusBtn.disabled = pct <= 0;
      minusBtn.addEventListener('click', () => onStep(id, -5));

      const pctEl = document.createElement('span');
      pctEl.className = 'split-percent';
      pctEl.textContent = `${pct}%`;

      const plusBtn = document.createElement('button');
      plusBtn.type = 'button';
      plusBtn.className = 'split-step-btn';
      plusBtn.textContent = '+';
      plusBtn.disabled = pct >= 100;
      plusBtn.addEventListener('click', () => onStep(id, 5));

      stepper.appendChild(minusBtn);
      stepper.appendChild(pctEl);
      stepper.appendChild(plusBtn);
      row.appendChild(stepper);
    }

    container.appendChild(row);
  });
  return container;
}

function renderSubSplitSection(cat, source) {
  const subIds = (cat.subcategories || []).map((s) => s.id);
  if (subIds.length === 0) return document.createDocumentFragment();

  if (source.kg == null) {
    const items = cat.subcategories.map((sub) => ({ id: sub.id, name: sub.name, formatted: '– Daten unvollständig' }));
    return renderSplitGroup(items, {}, subIds, () => {}, false);
  }

  const split = getSubSplit(cat.id, subIds);
  const items = cat.subcategories.map((sub) => {
    const kg = (source.kg * (split[sub.id] || 0)) / 100;
    return { id: sub.id, name: sub.name, formatted: formatComputedAmount(kg, cat) };
  });
  return renderSplitGroup(items, split, subIds, (id, delta) => {
    targets.subSplits[cat.id] = stepSplit({ ...split }, subIds, id, delta);
    saveTargets();
    render();
  }, true);
}

// --- Macro / Diversität sections (above the tree) ------------------------

function renderMacroSplitSections() {
  const frag = document.createDocumentFragment();
  let any = false;
  ['kohlenhydrat', 'protein', 'fett'].forEach((macro) => {
    const ids = macroGroupIds[macro];
    if (ids.length === 0) return;
    any = true;
    const split = getMacroSplit(macro, ids);
    const items = ids.map((id) => {
      const cat = findCategoryById(id);
      const kg = cat && cat.kcalPerKg > 0 ? (macroGlobalKcal(macro) * (split[id] || 0)) / 100 / cat.kcalPerKg : null;
      return {
        id, name: cat ? cat.name : '?', formatted: kg != null ? formatComputedAmount(kg, cat) : '– Daten unvollständig',
      };
    });
    const header = document.createElement('div');
    header.className = 'section-label';
    header.textContent = `${MACRO_LABELS[macro]} — ${Math.round(macroGlobalKcal(macro)).toLocaleString('de-DE')} kcal`;
    frag.appendChild(header);
    frag.appendChild(renderSplitGroup(items, split, ids, (id, delta) => {
      targets.macroSplits[macro] = stepSplit({ ...split }, ids, id, delta);
      saveTargets();
      render();
    }, true));
  });
  if (!any) {
    const p = document.createElement('p');
    p.className = 'screen-placeholder';
    p.textContent = 'Keine Kategorien im Kalorien-Modus (in der Taxonomie einstellen).';
    frag.appendChild(p);
  }
  return frag;
}

function renderDiversitySection() {
  const cats = [];
  taxonomy.types.forEach((type) => (type.categories || []).forEach((cat) => {
    if (categoryPlanningMode(cat) === 'diversity') cats.push(cat);
  }));
  if (cats.length === 0) return null;

  const frag = document.createDocumentFragment();
  const header = document.createElement('div');
  header.className = 'section-label';
  header.textContent = 'Diversität';
  frag.appendChild(header);

  const items = cats.map((cat) => {
    const kg = cat.diversityFloorGramsPerPersonDay != null
      ? (cat.diversityFloorGramsPerPersonDay / 1000) * peopleCount() * autonomyDaysVal()
      : null;
    return {
      id: cat.id, name: cat.name, formatted: kg != null ? formatComputedAmount(kg, cat) : '– Diversitäts-Wert fehlt',
    };
  });
  frag.appendChild(renderSplitGroup(items, {}, cats.map((c) => c.id), () => {}, false));
  return frag;
}

function renderTargetsSummary() {
  macroSummaryEl.innerHTML = '';
  if (peopleCount() === 0 || autonomyDaysVal() <= 0) {
    const p = document.createElement('p');
    p.className = 'screen-placeholder';
    p.textContent = 'Haushalt und Autonomiedauer in Planung eingeben, um Ziele automatisch zu berechnen.';
    macroSummaryEl.appendChild(p);
    return;
  }

  const waterCat = planning.waterCategoryId ? findCategoryById(planning.waterCategoryId) : null;
  macroSummaryEl.appendChild(makeComputedRow(
    waterCat ? `Wasser (${waterCat.name})` : 'Wasser (keine Kategorie zugewiesen)',
    `${round2(waterGlobalKg())} kg`,
  ));

  macroSummaryEl.appendChild(renderMacroSplitSections());

  const diversitySection = renderDiversitySection();
  if (diversitySection) macroSummaryEl.appendChild(diversitySection);
}

// --- Tree rendering (Typ → Kategorie → Unterkategorie) --------------------

function renderTypeRow(type) {
  const wrap = document.createElement('div');
  wrap.className = 'tax-type';
  const isOpen = openTypes.has(type.id);

  const head = document.createElement('div');
  head.className = 'tax-type-head';
  const symEl = document.createElement('span');
  symEl.className = 'sym';
  symEl.textContent = type.sym || '';
  const nameEl = document.createElement('span');
  nameEl.className = 'tax-name-display';
  nameEl.textContent = type.name;
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'tax-toggle';
  toggleBtn.textContent = isOpen ? '▴' : '▾';
  toggleBtn.addEventListener('click', () => {
    if (openTypes.has(type.id)) openTypes.delete(type.id);
    else openTypes.add(type.id);
    render();
  });
  head.appendChild(symEl);
  head.appendChild(nameEl);
  head.appendChild(toggleBtn);
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
  const onToggle = () => {
    if (openCats.has(cat.id)) openCats.delete(cat.id);
    else openCats.add(cat.id);
    render();
  };

  const source = categoryTargetSource(cat);
  const head = source.kind === 'off'
    ? makeRow(cat.sym, cat.name, targets.categories[cat.id], 'categories', cat.id, 'kg', true, isOpen, onToggle)
    : makeComputedCategoryHead(cat, source, isOpen, onToggle);
  wrap.appendChild(head);

  const body = document.createElement('div');
  body.className = 'tax-cat-body' + (isOpen ? ' open' : '');
  if (source.kind === 'off') {
    const subList = document.createElement('div');
    subList.className = 'tax-sub-list';
    (cat.subcategories || []).forEach((sub) => subList.appendChild(renderManualSubRow(sub)));
    body.appendChild(subList);
  } else if ((cat.subcategories || []).length > 0) {
    body.appendChild(renderSubSplitSection(cat, source));
  }
  wrap.appendChild(body);
  return wrap;
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

function syncUnitToggle() {
  unitToggleButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.unit === displayUnit));
}

unitToggleButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    displayUnit = btn.dataset.unit;
    render();
  });
});

function render() {
  computeMacroGroups();
  syncUnitToggle();
  renderTargetsSummary();
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

// --- Edit modal (manual targets only: Aus categories/subcategories, products) --

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
  peopleInput.value = target && target.mode === 'peopleDuration' ? target.people : (peopleCount() || '');
  daysInput.value = target && target.mode === 'peopleDuration' ? target.days : (planning.autonomyDays ?? '');
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
