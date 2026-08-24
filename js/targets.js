// Ziele — SPEC.md Section 7. Three flat, independently collapsible sections
// (no more Type→Category→Subcategory tree — a category/subcategory now
// appears in exactly one place, never duplicated across a summary area and
// a tree row):
//   - Kategorien: every category's target. "Aus" categories are fully
//     manual (flat kg/Stk, or Personen×Tage) — click the badge, edit, save.
//     Kalorien categories sharing a macro (Kohlenhydrate/Protein/Fett) split
//     that macro's global kcal target between them via a ±5% stepper (see
//     stepSplit below); Diversität categories and the Wasser category
//     (assigned in Planung) compute independently, no stepper.
//   - Unterkategorien: every subcategory's target, grouped by parent
//     category. Manual under an "Aus" parent; split off the parent's
//     computed total (same ±5% stepper) under a computed parent.
//   - Produktziele: manual overrides, independent of everything above.
// This file reads /config/household and /config/planning directly so the
// whole pipeline (Taxonomie → Planung → Ziele) stays in sync with no
// manual commit anywhere.
import { db } from './firebase-init.js?v=52';
import {
  doc, getDoc, setDoc, addDoc, collection, getDocs,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const targetsCard = document.querySelector('.settings-card[data-target="targets"]');
const panelEl = document.getElementById('settings-panel-targets');
const unitToggleButtons = document.querySelectorAll('#targets-unit-toggle .select-mode-btn');
const categoriesListEl = document.getElementById('targets-categories-list');
const subcategoriesListEl = document.getElementById('targets-subcategories-list');
const statusEl = document.getElementById('targets-status');
const productTargetsList = document.getElementById('product-targets-list');
const addProductTargetBtn = document.getElementById('add-product-target-btn');

document.querySelectorAll('.targets-section-header').forEach((btn) => {
  btn.addEventListener('click', () => {
    const body = btn.nextElementSibling;
    const collapsed = body.classList.toggle('collapsed');
    btn.querySelector('.tax-toggle').textContent = collapsed ? '▾' : '▴';
  });
});

const pickerModal = document.getElementById('target-picker-modal');
const pickerSearch = document.getElementById('target-picker-search');
const pickerList = document.getElementById('target-picker-list');

const newProductForm = document.getElementById('target-new-product-form');
const newProductNameInput = document.getElementById('target-new-product-name');
const newProductUnitButtons = document.querySelectorAll('#target-new-product-unit-toggle .unit-btn');
const newProductSubcategorySelect = document.getElementById('target-new-product-subcategory');
const newProductCreateBtn = document.getElementById('target-new-product-create-btn');
let newProductUnit = 'kg';

const editModal = document.getElementById('target-edit-modal');
const editTitle = document.getElementById('target-edit-title');
const modeToggleEl = document.getElementById('target-mode-toggle');
const modeToggleButtons = modeToggleEl.querySelectorAll('.unit-btn');
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

function categoryPlanningMode(type, cat) {
  if (!type.isFoodType) return 'off';
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
    if (categoryPlanningMode(type, cat) === 'calorie' && cat.macroType && cat.kcalPerKg != null && macroGroupIds[cat.macroType]) {
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

// Macro split and water rate have real defaults per SPEC.md Section 7
// (50/20/30, 3 L/person/day) that js/planning.js already shows in its input
// fields the moment the screen opens — but a field only gets WRITTEN to
// /config/planning once the admin actually touches it (blur → 'change').
// Reading only what's saved would silently compute 0 for any macro whose
// field the admin never happened to touch, even though Planung is visibly
// showing 20/30 for it. Fall back to the same defaults here so Ziele always
// matches what Planung displays, saved or not.
const DEFAULT_MACRO_SPLIT = { kohlenhydrat: 50, protein: 20, fett: 30 };
const DEFAULT_WATER_RATE = 3;

function macroGlobalKcal(macro) {
  const pct = planning.macroSplit?.[macro] != null ? Number(planning.macroSplit[macro]) : DEFAULT_MACRO_SPLIT[macro];
  return totalDailyKcal() * autonomyDaysVal() * (pct || 0) / 100;
}

function waterGlobalKg() {
  const rate = planning.waterLitersPerPersonDay != null ? Number(planning.waterLitersPerPersonDay) : DEFAULT_WATER_RATE;
  return rate * peopleCount() * autonomyDaysVal();
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

// The macro group's header total, in whichever unit is toggled — kcal/
// kcal-per-Person&Tag come straight from the macro's global kcal figure;
// kg/kg-per-Person&Tag sum the group's current per-category kg amounts
// (their sum always equals the macro total by construction, since the
// split always sums to 100%).
function formatMacroHeaderTotal(macro, items) {
  const people = peopleCount();
  const days = autonomyDaysVal();
  if (displayUnit === 'kcal') return `${Math.round(macroGlobalKcal(macro)).toLocaleString('de-DE')} kcal`;
  if (displayUnit === 'kcalpd') {
    return people > 0 && days > 0 ? `${Math.round(macroGlobalKcal(macro) / people / days)} kcal/P/T` : `${round2(macroGlobalKcal(macro))} kcal`;
  }
  const sumKg = items.reduce((s, it) => s + (it.kg || 0), 0);
  if (displayUnit === 'kgpd') {
    return people > 0 && days > 0 ? `${Math.round((sumKg / people / days) * 1000) / 1000} kg/P/T` : `${round2(sumKg)} kg`;
  }
  return `${round2(sumKg)} kg`;
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

// --- Manual row (Aus categories/subcategories, products) ----------------

function makeRow(sym, name, target, level, id, unit) {
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
  return head;
}

function renderManualSubRow(sub) {
  return makeRow(sub.sym, sub.name, targets.subcategories[sub.id], 'subcategories', sub.id, 'kg');
}

// --- Computed category (Kalorien / Diversität / Wasser) ------------------

function categoryTargetSource(type, cat) {
  if (planning.waterCategoryId && cat.id === planning.waterCategoryId) {
    return { kind: 'water', kg: waterGlobalKg() };
  }
  const mode = categoryPlanningMode(type, cat);
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

// Generic ±5%-stepper list, reused for the macro-split sections, the
// diversity/water rows (showStepper=false — those totals aren't pooled,
// each computes independently), and a computed category's own subcategory
// split.
function renderSplitGroup(items, splitMap, groupIds, onStep, showStepper) {
  const container = document.createElement('div');
  items.forEach(({
    id, name, sym, formatted,
  }) => {
    const row = document.createElement('div');
    row.className = 'split-row';

    const info = document.createElement('div');
    info.className = 'split-info';
    const titleEl = document.createElement('div');
    titleEl.className = 'split-title';
    titleEl.textContent = sym ? `${sym} ${name}` : name;
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

function renderSubSplitGroup(cat, source) {
  const subIds = (cat.subcategories || []).map((s) => s.id);
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

// --- Kategorien section ----------------------------------------------------

function renderMacroSplitSections() {
  const frag = document.createDocumentFragment();
  ['kohlenhydrat', 'protein', 'fett'].forEach((macro) => {
    const ids = macroGroupIds[macro];
    if (ids.length === 0) return;
    const split = getMacroSplit(macro, ids);
    const items = ids.map((id) => {
      const cat = findCategoryById(id);
      const kg = cat && cat.kcalPerKg > 0 ? (macroGlobalKcal(macro) * (split[id] || 0)) / 100 / cat.kcalPerKg : null;
      return {
        id,
        name: cat ? cat.name : '?',
        sym: cat ? cat.sym : '',
        kg: kg || 0,
        formatted: kg != null ? formatComputedAmount(kg, cat) : '– Daten unvollständig',
      };
    });
    const header = document.createElement('div');
    header.className = 'targets-subgroup-label';
    header.textContent = `${MACRO_LABELS[macro]} — ${formatMacroHeaderTotal(macro, items)}`;
    frag.appendChild(header);
    frag.appendChild(renderSplitGroup(items, split, ids, (id, delta) => {
      targets.macroSplits[macro] = stepSplit({ ...split }, ids, id, delta);
      saveTargets();
      render();
    }, true));
  });
  return frag;
}

function renderDiversitySection() {
  const cats = [];
  taxonomy.types.forEach((type) => (type.categories || []).forEach((cat) => {
    if (categoryPlanningMode(type, cat) === 'diversity') cats.push(cat);
  }));
  if (cats.length === 0) return null;

  const frag = document.createDocumentFragment();
  const header = document.createElement('div');
  header.className = 'targets-subgroup-label';
  header.textContent = 'Diversität';
  frag.appendChild(header);

  const items = cats.map((cat) => {
    const kg = cat.diversityFloorGramsPerPersonDay != null
      ? (cat.diversityFloorGramsPerPersonDay / 1000) * peopleCount() * autonomyDaysVal()
      : null;
    return {
      id: cat.id, name: cat.name, sym: cat.sym, formatted: kg != null ? formatComputedAmount(kg, cat) : '– Diversitäts-Wert fehlt',
    };
  });
  frag.appendChild(renderSplitGroup(items, {}, cats.map((c) => c.id), () => {}, false));
  return frag;
}

function renderManualCategoriesGroup() {
  const frag = document.createDocumentFragment();
  let any = false;
  taxonomy.types.forEach((type) => {
    const manualCats = (type.categories || []).filter((cat) => categoryTargetSource(type, cat).kind === 'off');
    if (manualCats.length === 0) return;
    any = true;
    const header = document.createElement('div');
    header.className = 'targets-subgroup-label';
    header.textContent = type.name;
    frag.appendChild(header);
    manualCats.forEach((cat) => {
      frag.appendChild(makeRow(cat.sym, cat.name, targets.categories[cat.id], 'categories', cat.id, 'kg'));
    });
  });
  return any ? frag : null;
}

function renderCategoriesSection() {
  categoriesListEl.innerHTML = '';
  if (peopleCount() > 0 && autonomyDaysVal() > 0) {
    categoriesListEl.appendChild(renderMacroSplitSections());
    const diversitySection = renderDiversitySection();
    if (diversitySection) categoriesListEl.appendChild(diversitySection);
  } else {
    const p = document.createElement('p');
    p.className = 'screen-placeholder';
    p.textContent = 'Haushalt und Autonomiedauer in Planung eingeben, um berechnete Ziele zu sehen — manuelle Kategorien stehen unten.';
    categoriesListEl.appendChild(p);
  }
  const manualGroup = renderManualCategoriesGroup();
  if (manualGroup) categoriesListEl.appendChild(manualGroup);
  if (!categoriesListEl.children.length) {
    const empty = document.createElement('p');
    empty.className = 'screen-placeholder';
    empty.textContent = 'Keine Kategorien vorhanden.';
    categoriesListEl.appendChild(empty);
  }
}

// --- Unterkategorien section ------------------------------------------------

function renderSubcategoryGroupFor(type, cat) {
  const subs = cat.subcategories || [];
  if (subs.length === 0) return null;
  const source = categoryTargetSource(type, cat);

  const frag = document.createDocumentFragment();
  const header = document.createElement('div');
  header.className = 'targets-subgroup-label';
  header.textContent = cat.name;
  frag.appendChild(header);

  if (source.kind === 'off') {
    subs.forEach((sub) => frag.appendChild(renderManualSubRow(sub)));
  } else {
    frag.appendChild(renderSubSplitGroup(cat, source));
  }
  return frag;
}

function renderSubcategoriesSection() {
  subcategoriesListEl.innerHTML = '';
  let any = false;
  taxonomy.types.forEach((type) => (type.categories || []).forEach((cat) => {
    const group = renderSubcategoryGroupFor(type, cat);
    if (group) {
      any = true;
      subcategoriesListEl.appendChild(group);
    }
  }));
  if (!any) {
    const empty = document.createElement('p');
    empty.className = 'screen-placeholder';
    empty.textContent = 'Keine Unterkategorien vorhanden.';
    subcategoriesListEl.appendChild(empty);
  }
}

// --- Produktziele section ----------------------------------------------

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
  renderCategoriesSection();
  renderSubcategoriesSection();
  renderProductTargets();
}

// --- Product picker (for adding a new product target) ---------------

function flatSubcategories() {
  const list = [];
  taxonomy.types.forEach((type) => (type.categories || []).forEach((cat) => (cat.subcategories || []).forEach((sub) => {
    list.push({ id: sub.id, label: `${type.name} › ${cat.name} › ${sub.name}` });
  })));
  return list;
}

function renderNewProductSubcategoryOptions() {
  newProductSubcategorySelect.innerHTML = '';
  flatSubcategories().forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.label;
    newProductSubcategorySelect.appendChild(opt);
  });
}

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

  const addRow = document.createElement('div');
  addRow.className = 'stock-product-row add-new';
  addRow.textContent = '+ Neues Produkt anlegen';
  addRow.addEventListener('click', () => {
    newProductNameInput.value = filterText || '';
    newProductUnit = 'kg';
    newProductUnitButtons.forEach((b) => b.classList.toggle('active', b.dataset.unit === 'kg'));
    renderNewProductSubcategoryOptions();
    newProductForm.classList.remove('hidden');
  });
  pickerList.appendChild(addRow);
}

addProductTargetBtn.addEventListener('click', () => {
  pickerSearch.value = '';
  newProductForm.classList.add('hidden');
  renderPickerList('');
  pickerModal.classList.add('show');
});

pickerSearch.addEventListener('input', () => {
  newProductForm.classList.add('hidden');
  renderPickerList(pickerSearch.value);
});

pickerModal.addEventListener('click', (e) => {
  if (e.target === pickerModal) pickerModal.classList.remove('show');
});

newProductUnitButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    newProductUnit = btn.dataset.unit;
    newProductUnitButtons.forEach((b) => b.classList.toggle('active', b === btn));
  });
});

newProductCreateBtn.addEventListener('click', async () => {
  const name = newProductNameInput.value.trim();
  const subcategoryId = newProductSubcategorySelect.value;
  if (!name) {
    alert('Bitte einen Produktnamen eingeben.');
    return;
  }
  if (!subcategoryId) {
    alert('Bitte eine Unterkategorie wählen.');
    return;
  }
  newProductCreateBtn.disabled = true;
  try {
    const newDoc = await addDoc(collection(db, 'products'), { name, subcategoryId, unitType: newProductUnit });
    const product = { id: newDoc.id, name, subcategoryId, unitType: newProductUnit };
    allProducts.push(product);
    productIndex.set(product.id, product);
    newProductForm.classList.add('hidden');
    pickerModal.classList.remove('show');
    openEdit('products', product.id, product.name, product.unitType);
  } catch (err) {
    alert('Fehler beim Anlegen: ' + err.message);
    console.error(err);
  } finally {
    newProductCreateBtn.disabled = false;
  }
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

  // Product targets are flat-only — a single product doesn't have its own
  // "Personen" to divide across, that's what the category/subcategory
  // split already handles.
  const isProduct = level === 'products';
  modeToggleEl.classList.toggle('hidden', isProduct);
  setMode(isProduct ? 'flat' : (target ? target.mode : 'flat'));

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
