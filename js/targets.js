// Ziele — SPEC.md Section 7. Three flat, independently collapsible sections
// (no more Type→Category→Subcategory tree — a category/subcategory now
// appears in exactly one place, never duplicated across a summary area and
// a tree row):
//   - Kategorien: every category's target. "Aus" categories are fully
//     manual (flat kg/Stk, or Personen×Tage) — click the badge, edit, save.
//     Kalorien categories sharing a macro (Kohlenhydrate/Protein/Fett) split
//     that macro's global kcal target between them via a ±5% stepper (see
//     stepSplit below); Diversität categories compute independently, no
//     stepper. Wasser-classed types don't appear here at all — water has
//     exactly one global target (Planung's rate), no per-category split,
//     see js/dashboard.js's water hero.
//   - Unterkategorien: every subcategory's target, grouped by parent
//     category. Manual under an "Aus" parent; split off the parent's
//     computed total (same ±5% stepper) under a computed parent.
//   - Produktziele: manual overrides, independent of everything above.
// This file reads /config/household and /config/planning directly so the
// whole pipeline (Taxonomie → Planung → Ziele) stays in sync with no
// manual commit anywhere.
import { db } from './firebase-init.js?v=98';
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
const nonfoodProductTargetsList = document.getElementById('product-targets-list-nonfood');
const addProductTargetNonfoodBtn = document.getElementById('add-product-target-nonfood-btn');

document.querySelectorAll('.targets-section-header').forEach((btn) => {
  btn.addEventListener('click', () => {
    const body = btn.nextElementSibling;
    const collapsed = body.classList.toggle('collapsed');
    btn.querySelector('.tax-toggle').textContent = collapsed ? '▾' : '▴';
  });
});

// Lebensmittel/Sonstiges tabs — same pattern as js/data-tabs.js's
// Taxonomie/Lagerorte/Jahresfarben segmented control.
const zieleTabBtns = document.querySelectorAll('.seg-btn[data-ziele-tab]');
const zieleTabPanels = document.querySelectorAll('.ziele-tab[data-ziele-tab-panel]');
zieleTabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    zieleTabBtns.forEach((b) => b.classList.toggle('active', b === btn));
    zieleTabPanels.forEach((p) => p.classList.toggle('hidden', p.dataset.zieleTabPanel !== btn.dataset.zieleTab));
  });
});

const pickerModal = document.getElementById('target-picker-modal');
const pickerModalTitle = pickerModal.querySelector('.modal-title');
const pickerSearch = document.getElementById('target-picker-search');
const pickerList = document.getElementById('target-picker-list');
// Which tab's "+ Produktziel hinzufügen" opened the shared picker —
// determines which products the search matches and which subcategories
// the inline "+ Neues Produkt anlegen" form offers.
let pickerFoodClass = 'food';

const newProductForm = document.getElementById('target-new-product-form');
const newProductNameInput = document.getElementById('target-new-product-name');
const newProductUnitButtons = document.querySelectorAll('#target-new-product-unit-toggle .unit-btn');
const newProductSubcategorySelect = document.getElementById('target-new-product-subcategory');
const newProductCreateBtn = document.getElementById('target-new-product-create-btn');
let newProductUnit = 'kg';

// Sonstiges' own "+ Neues Produkt anlegen" — a separate modal (not the
// Lebensmittel form above expanded in place), since it also folds in the
// target amount itself (one save instead of create-then-auto-open-the-
// edit-modal) and offers the open Stück/Flaschen/Dosen/Säcke/custom unit
// picker instead of the fixed Kilogramm/Stück toggle.
const BASE_UNITS = ['kg', 'l', 'Stück', 'Flaschen', 'Dosen', 'Säcke'];
const nonfoodNewProductModal = document.getElementById('target-new-product-nonfood-modal');
const nonfoodNewNameInput = document.getElementById('target-nonfood-new-name');
const nonfoodUnitSelect = document.getElementById('target-nonfood-unit-select');
const nonfoodUnitCustomInput = document.getElementById('target-nonfood-unit-custom');
const nonfoodNewAmountInput = document.getElementById('target-nonfood-new-amount');
const nonfoodNewSubcategorySelect = document.getElementById('target-nonfood-new-subcategory');
const nonfoodNewCreateBtn = document.getElementById('target-nonfood-new-create-btn');

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
let planning = { autonomyDays: null, macroSplit: {} };
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
    // js/dashboard.js caches /config/targets in memory (its Kategorien/
    // Wasser gaps and Einkaufsliste both depend on it) and only reloads
    // on this event — same bug class as js/taxonomy.js's saveTaxonomy fix.
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    statusEl.textContent = 'Fehler beim Speichern: ' + err.message;
    console.error(err);
  }
}

// --- Same 3-way mode as js/taxonomy.js ---------------------------------

// See js/taxonomy.js's typeClass for the fallback-derivation rationale.
function typeClass(type) {
  if (type.typeClass) return type.typeClass;
  return type.isFoodType ? 'food' : 'other';
}

function categoryPlanningMode(type, cat) {
  if (typeClass(type) !== 'food') return 'off';
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

function findSubcategoryContext(subcategoryId) {
  for (const type of taxonomy.types) {
    for (const cat of (type.categories || [])) {
      for (const sub of (cat.subcategories || [])) {
        if (sub.id === subcategoryId) return { type, cat, sub };
      }
    }
  }
  return null;
}

// A product's food-class comes from its subcategory's parent type — if that
// subcategory no longer exists (e.g. deleted from Taxonomie while a target
// still references it), default to the Lebensmittel tab rather than
// silently dropping the target from both lists.
// A product's type-class comes from its subcategory's parent type — if
// that subcategory no longer exists (e.g. deleted from Taxonomie while a
// target still references it), default to 'food' rather than silently
// dropping the target from every list (same fallback as before this was
// widened to three-way). Wasser products deliberately fall out of both
// Ziele tabs entirely (see renderProductTargets below) — the Taxonomie
// Wasser type exists purely to track toward the one global liter target
// (Planung/Übersicht); an admin wanting "always keep N bottles separately"
// models that as an actual Sonstiges product instead (e.g. Fluchtrucksack
// › Getränke › Wasserflaschen) — same name as "water" in the everyday
// sense, but no link at all to the Taxonomie Wasser type or its target.
function productTypeClass(product) {
  const ctx = findSubcategoryContext(product.subcategoryId);
  return ctx ? typeClass(ctx.type) : 'food';
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

function macroGlobalKcal(macro) {
  const pct = planning.macroSplit?.[macro] != null ? Number(planning.macroSplit[macro]) : DEFAULT_MACRO_SPLIT[macro];
  return totalDailyKcal() * autonomyDaysVal() * (pct || 0) / 100;
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

// Only kg/l are "fractional" (content-string-parsed) units — every other
// unit (legacy 'stueck', or any of the new open Sonstiges units: Stück,
// Flaschen, Dosen, Säcke, a custom one) is a plain integer count, and is
// shown exactly as stored rather than mapped through a fixed label table
// — see js/dashboard.js/js/stock-table.js/js/stock-checkin.js for the
// matching kg/l-vs-count branches this same distinction drives elsewhere.
function unitLabel(unit) {
  if (unit === 'kg' || unit === 'l') return unit;
  if (unit === 'stueck') return 'Stk';
  return unit || 'kg';
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

// --- Computed category (Kalorien / Diversität) ---------------------------
// Wasser-classed types never reach this — they're filtered out before the
// Kategorien/Unterkategorien sections render at all (see includeFoodTypes
// callers below), since water has one global target, not a per-category
// one. See js/dashboard.js for where that global figure actually lives.

function categoryTargetSource(type, cat) {
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
    const items = cat.subcategories.map((sub) => ({
      id: sub.id, name: sub.name, sym: sub.sym, formatted: '– Daten unvollständig',
    }));
    return renderSplitGroup(items, {}, subIds, () => {}, false);
  }
  const split = getSubSplit(cat.id, subIds);
  const items = cat.subcategories.map((sub) => {
    const kg = (source.kg * (split[sub.id] || 0)) / 100;
    return {
      id: sub.id, name: sub.name, sym: sub.sym, formatted: formatComputedAmount(kg, cat),
    };
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

// Lebensmittel-only (Sonstiges categories/subcategories no longer carry
// their own targets at all — Sonstiges targets live purely at the product
// level now, see renderNonfoodProductTargets below).
function renderManualCategoriesGroup() {
  const frag = document.createDocumentFragment();
  let any = false;
  taxonomy.types.forEach((type) => {
    if (typeClass(type) !== 'food') return;
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
  // The parent category's own total, so the split below reads as "X kg
  // divided into these subcategories" rather than a bare name — computed
  // categories show their live figure, manual ones show whatever target
  // is set on the category itself (if any).
  let totalText = null;
  if (source.kind !== 'off') {
    totalText = source.kg != null ? formatComputedAmount(source.kg, cat) : 'Daten unvollständig';
  } else if (targets.categories[cat.id]) {
    totalText = formatTargetLabel(targets.categories[cat.id]);
  }
  header.textContent = totalText ? `${cat.name} — ${totalText}` : cat.name;
  frag.appendChild(header);

  if (source.kind === 'off') {
    subs.forEach((sub) => frag.appendChild(renderManualSubRow(sub)));
  } else {
    frag.appendChild(renderSubSplitGroup(cat, source));
  }
  return frag;
}

// Lebensmittel-only — Sonstiges subcategories no longer carry their own
// targets (see renderNonfoodProductTargets below).
function renderSubcategoriesSection(listEl) {
  listEl.innerHTML = '';
  let any = false;
  taxonomy.types.forEach((type) => {
    if (typeClass(type) !== 'food') return;
    (type.categories || []).forEach((cat) => {
      const group = renderSubcategoryGroupFor(type, cat);
      if (group) {
        any = true;
        listEl.appendChild(group);
      }
    });
  });
  if (!any) {
    const empty = document.createElement('p');
    empty.className = 'screen-placeholder';
    empty.textContent = 'Keine Unterkategorien vorhanden.';
    listEl.appendChild(empty);
  }
}

// --- Produktziele section ----------------------------------------------

// A product whose subcategory no longer resolves (deleted/renamed in
// Taxonomie, or genuinely orphaned data) shows a visible warning instead
// of silently blank context — this is exactly the signal that surfaced a
// stale "Wasser" product landing in the Lebensmittel picker (its
// subcategoryId pointed nowhere, so productTypeClass()'s safe-default
// fallback put it there) rather than being invisible until reported.
function productContextLabel(product) {
  const ctx = findSubcategoryContext(product.subcategoryId);
  if (!ctx) return '⚠️ Unterkategorie fehlt (verwaiste Daten)';
  const { cat, sub } = ctx;
  const catPart = cat.sym ? `${cat.sym} ${cat.name}` : cat.name;
  // A Wasser subcategory's name mirrors its category (js/taxonomy.js's
  // ensureWaterSubcategory) — skip the redundant repeat.
  if (sub.name === cat.name) return catPart;
  const subPart = sub.sym ? `${sub.sym} ${sub.name}` : sub.name;
  return `${catPart} › ${subPart}`;
}

// showContext is on for the flat Lebensmittel list (renderProductTargetList
// below) — the Sonstiges list is already grouped by category/subcategory
// via its own headers (renderNonfoodProductTargets), so repeating the same
// text per row there would just be noise.
function makeProductTargetRow(productId, { showContext = false } = {}) {
  const product = productIndex.get(productId);
  const name = product ? product.name : '(unbekanntes Produkt)';
  const unit = product ? product.unitType : 'kg';
  const row = document.createElement('div');
  row.className = 'stock-product-row';

  const textWrap = document.createElement('span');
  textWrap.style.display = 'flex';
  textWrap.style.flexDirection = 'column';
  textWrap.style.flex = '1';
  textWrap.style.minWidth = '0';
  const nameEl = document.createElement('span');
  nameEl.className = 'pname';
  nameEl.textContent = name;
  textWrap.appendChild(nameEl);
  if (showContext) {
    const metaEl = document.createElement('span');
    metaEl.className = 'pmeta';
    metaEl.textContent = product ? productContextLabel(product) : '⚠️ Produkt nicht gefunden';
    textWrap.appendChild(metaEl);
  }

  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'target-badge has-target';
  badge.textContent = formatTargetLabel(targets.products[productId]);
  badge.addEventListener('click', () => openEdit('products', productId, name, unit));
  row.appendChild(textWrap);
  row.appendChild(badge);
  return row;
}

function renderProductTargetList(listEl, ids) {
  listEl.innerHTML = '';
  if (ids.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'screen-placeholder';
    empty.textContent = 'Keine Produktziele.';
    listEl.appendChild(empty);
    return;
  }
  ids.forEach((productId) => listEl.appendChild(makeProductTargetRow(productId, { showContext: true })));
}

// Sonstiges no longer has its own Kategorien/Unterkategorien targets (see
// renderManualCategoriesGroup/renderSubcategoriesSection above, both
// Lebensmittel-only now) — this is the only place a Sonstiges target lives
// at all, so it's grouped by category → subcategory, reusing the exact
// same .targets-subgroup-label header those sections used to show, rather
// than left as one flat list. A product whose subcategory no longer
// resolves (deleted in Taxonomie since the target was set) still shows,
// under a fallback group, rather than silently vanishing from view.
function renderNonfoodProductTargets(ids) {
  nonfoodProductTargetsList.innerHTML = '';
  if (ids.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'screen-placeholder';
    empty.textContent = 'Keine Produktziele.';
    nonfoodProductTargetsList.appendChild(empty);
    return;
  }

  const groups = new Map(); // categoryId -> { cat, subs: Map<subId, { sub, productIds }> }
  const fallback = [];
  ids.forEach((productId) => {
    const product = productIndex.get(productId);
    const ctx = product ? findSubcategoryContext(product.subcategoryId) : null;
    if (!ctx) {
      fallback.push(productId);
      return;
    }
    const { cat, sub } = ctx;
    if (!groups.has(cat.id)) groups.set(cat.id, { cat, subs: new Map() });
    const group = groups.get(cat.id);
    if (!group.subs.has(sub.id)) group.subs.set(sub.id, { sub, productIds: [] });
    group.subs.get(sub.id).productIds.push(productId);
  });

  const byName = (a, b) => a.localeCompare(b, 'de');
  Array.from(groups.values())
    .sort((a, b) => byName(a.cat.name, b.cat.name))
    .forEach(({ cat, subs }) => {
      const catHeader = document.createElement('div');
      catHeader.className = 'targets-subgroup-label';
      catHeader.textContent = cat.name;
      nonfoodProductTargetsList.appendChild(catHeader);

      Array.from(subs.values())
        .sort((a, b) => byName(a.sub.name, b.sub.name))
        .forEach(({ sub, productIds }) => {
          // A Wasser subcategory's name mirrors its category (js/taxonomy.js's
          // ensureWaterSubcategory) — skip the redundant sub-header rather
          // than showing "Trinkwasser — Trinkwasser".
          if (sub.name !== cat.name) {
            const subHeader = document.createElement('div');
            subHeader.className = 'targets-subgroup-label';
            subHeader.textContent = sub.name;
            nonfoodProductTargetsList.appendChild(subHeader);
          }
          productIds
            .slice()
            .sort((a, b) => byName(productIndex.get(a)?.name || '', productIndex.get(b)?.name || ''))
            .forEach((productId) => nonfoodProductTargetsList.appendChild(makeProductTargetRow(productId)));
        });
    });

  if (fallback.length > 0) {
    const header = document.createElement('div');
    header.className = 'targets-subgroup-label';
    header.textContent = 'Ohne Kategorie';
    nonfoodProductTargetsList.appendChild(header);
    fallback.forEach((productId) => nonfoodProductTargetsList.appendChild(makeProductTargetRow(productId)));
  }
}

// Every product target is unambiguously Lebensmittel, Wasser, or Sonstiges
// via its own subcategory's parent type, so — unlike Kategorien/
// Unterkategorien, which read the taxonomy tree directly — this splits the
// flat targets.products map by looking each product up. A Wasser product
// target (only ever possible as leftover data from before this three-way
// split existed) is dropped from both lists rather than shown anywhere —
// see productTypeClass's comment for why Wasser never gets one going
// forward.
function renderProductTargets() {
  const foodIds = [];
  const nonfoodIds = [];
  Object.keys(targets.products || {}).forEach((id) => {
    const product = productIndex.get(id);
    const cls = product ? productTypeClass(product) : 'food';
    if (cls === 'water') return;
    (cls === 'other' ? nonfoodIds : foodIds).push(id);
  });
  renderProductTargetList(productTargetsList, foodIds);
  renderNonfoodProductTargets(nonfoodIds);
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
  renderSubcategoriesSection(subcategoriesListEl);
  renderProductTargets();
}

// --- Product picker (for adding a new product target) ---------------

function flatSubcategories() {
  const list = [];
  taxonomy.types.forEach((type) => (type.categories || []).forEach((cat) => (cat.subcategories || []).forEach((sub) => {
    // A Wasser subcategory's name mirrors its category (js/taxonomy.js's
    // ensureWaterSubcategory) — drop the redundant trailing segment
    // rather than showing "Wasser › Trinkwasser › Trinkwasser".
    const label = sub.name === cat.name ? `${type.name} › ${cat.name}` : `${type.name} › ${cat.name} › ${sub.name}`;
    list.push({ id: sub.id, label, cls: typeClass(type) });
  })));
  return list;
}

// Only ever called for the Lebensmittel picker's own inline new-product
// form (see the add-row handler below — Sonstiges branches to its own
// separate modal/subcategory list, renderNonfoodNewSubcategoryOptions).
function renderNewProductSubcategoryOptions() {
  newProductSubcategorySelect.innerHTML = '';
  flatSubcategories()
    .filter((s) => s.cls === 'food')
    .forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.label;
      newProductSubcategorySelect.appendChild(opt);
    });
}

function renderPickerList(filterText) {
  pickerList.innerHTML = '';
  const q = filterText.trim().toLowerCase();

  // Right below the search bar rather than after the match list — an
  // admin adding something new shouldn't have to scroll past every
  // existing product first to find it.
  const addRow = document.createElement('div');
  addRow.className = 'stock-product-row add-new';
  addRow.textContent = '+ Neues Produkt anlegen';
  addRow.addEventListener('click', () => {
    if (pickerFoodClass === 'nonfood') {
      // Sonstiges gets its own separate, cleaner modal — not this same
      // picker modal expanded in place — that also folds the target
      // amount itself in, saving the create-then-auto-open-the-edit-modal
      // hop the Lebensmittel path below still does.
      pickerModal.classList.remove('show');
      openNonfoodNewProductModal(filterText);
      return;
    }
    newProductNameInput.value = filterText || '';
    newProductUnit = 'kg';
    newProductUnitButtons.forEach((b) => b.classList.toggle('active', b.dataset.unit === 'kg'));
    renderNewProductSubcategoryOptions();
    newProductForm.classList.remove('hidden');
  });
  pickerList.appendChild(addRow);

  const matches = allProducts
    .filter((p) => productTypeClass(p) === (pickerFoodClass === 'food' ? 'food' : 'other'))
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
    const textWrap = document.createElement('span');
    textWrap.style.display = 'flex';
    textWrap.style.flexDirection = 'column';
    textWrap.style.flex = '1';
    textWrap.style.minWidth = '0';
    const nameEl = document.createElement('span');
    nameEl.className = 'pname';
    nameEl.textContent = p.name;
    textWrap.appendChild(nameEl);
    const metaEl = document.createElement('span');
    metaEl.className = 'pmeta';
    metaEl.textContent = productContextLabel(p);
    textWrap.appendChild(metaEl);
    row.appendChild(textWrap);
    row.addEventListener('click', () => {
      pickerModal.classList.remove('show');
      openEdit('products', p.id, p.name, p.unitType);
    });
    pickerList.appendChild(row);
  });

}

function openPicker(foodClass) {
  pickerFoodClass = foodClass;
  pickerModalTitle.textContent = foodClass === 'food' ? 'Produkt wählen (Lebensmittel)' : 'Produkt wählen (Sonstiges)';
  pickerSearch.value = '';
  newProductForm.classList.add('hidden');
  renderPickerList('');
  pickerModal.classList.add('show');
}

addProductTargetBtn.addEventListener('click', () => openPicker('food'));
addProductTargetNonfoodBtn.addEventListener('click', () => openPicker('nonfood'));

pickerSearch.addEventListener('input', () => {
  newProductForm.classList.add('hidden');
  renderPickerList(pickerSearch.value);
});

pickerModal.addEventListener('click', (e) => {
  if (e.target === pickerModal) pickerModal.classList.remove('show');
});

// --- Sonstiges: new product + folded-in target ---------------------------

// The dropdown always offers the 6 base units, plus whatever custom units
// are already in use on other Sonstiges products — no separate "known
// units" list is persisted anywhere; a freshly-typed custom unit (via the
// free-text box below) simply starts showing up here itself once it's
// actually been used on a real product. Wasser products are excluded from
// this scan (see productTypeClass's comment) — they're locked to 'l' at
// creation time anyway (js/stock-checkin.js's own "+ Neues Produkt" step),
// so they'd never contribute a custom unit worth surfacing here.
function populateNonfoodUnitSelect() {
  const used = new Set();
  allProducts.forEach((p) => {
    if (p.unitType && productTypeClass(p) === 'other' && p.unitType !== 'stueck' && !BASE_UNITS.includes(p.unitType)) {
      used.add(p.unitType);
    }
  });
  nonfoodUnitSelect.innerHTML = '';
  [...BASE_UNITS, ...Array.from(used).sort((a, b) => a.localeCompare(b, 'de'))].forEach((unit) => {
    const opt = document.createElement('option');
    opt.value = unit;
    opt.textContent = unit;
    nonfoodUnitSelect.appendChild(opt);
  });
}

// Genuinely Sonstiges subcategories only — Wasser is deliberately excluded
// (see productTypeClass's comment above): the Taxonomie Wasser type tracks
// only toward the one global liter target, never an individual product
// override here. Wanting "60 Flaschen Wasser" as its own separate target
// means modeling it as an actual Sonstiges product instead (e.g.
// Fluchtrucksack › Getränke › Wasserflaschen).
function renderNonfoodNewSubcategoryOptions() {
  nonfoodNewSubcategorySelect.innerHTML = '';
  flatSubcategories()
    .filter((s) => s.cls === 'other')
    .forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.label;
      nonfoodNewSubcategorySelect.appendChild(opt);
    });
}

function openNonfoodNewProductModal(filterText) {
  nonfoodNewNameInput.value = filterText || '';
  populateNonfoodUnitSelect();
  nonfoodUnitSelect.value = 'kg';
  nonfoodUnitCustomInput.value = '';
  nonfoodNewAmountInput.value = '';
  renderNonfoodNewSubcategoryOptions();
  nonfoodNewProductModal.classList.add('show');
}

nonfoodNewProductModal.addEventListener('click', (e) => {
  if (e.target === nonfoodNewProductModal) nonfoodNewProductModal.classList.remove('show');
});

nonfoodNewCreateBtn.addEventListener('click', async () => {
  const name = nonfoodNewNameInput.value.trim();
  const unit = nonfoodUnitCustomInput.value.trim() || nonfoodUnitSelect.value;
  const subcategoryId = nonfoodNewSubcategorySelect.value;
  const amount = Number(nonfoodNewAmountInput.value);
  if (!name) {
    alert('Bitte einen Produktnamen eingeben.');
    return;
  }
  if (!subcategoryId) {
    alert('Bitte eine Unterkategorie wählen.');
    return;
  }
  if (nonfoodNewAmountInput.value === '' || Number.isNaN(amount)) {
    alert('Bitte eine Ziel-Menge eingeben.');
    return;
  }
  nonfoodNewCreateBtn.disabled = true;
  try {
    const newDoc = await addDoc(collection(db, 'products'), { name, subcategoryId, unitType: unit });
    const product = { id: newDoc.id, name, subcategoryId, unitType: unit };
    allProducts.push(product);
    productIndex.set(product.id, product);
    targets.products[product.id] = { mode: 'flat', amount, unit };
    nonfoodNewProductModal.classList.remove('show');
    await saveTargets();
    // saveTargets() already dispatches erdkeller:refresh (which reloads
    // the product catalog everywhere else too), so nothing further needed
    // here beyond re-rendering this screen's own state.
    render();
  } catch (err) {
    alert('Fehler beim Anlegen: ' + err.message);
    console.error(err);
  } finally {
    nonfoodNewCreateBtn.disabled = false;
  }
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
    // Other modules (Bestand's guided flow, Übersicht) cache the product
    // list in memory too and only reload on this event — same bug class
    // as js/taxonomy.js's saveTaxonomy fix. Fired here rather than left
    // to saveTargets() below, since the admin can dismiss the target-edit
    // modal that follows without saving a target at all.
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
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
