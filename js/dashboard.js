// Übersicht (Dashboard, Step 10) — Totals/Gaps view, Lebensmittel + Wasser.
// Sonstiges has no autonomy-duration/kcal framing (a screwdriver doesn't
// "last N weeks"), so it isn't part of this view. Wasser gets its own
// simple hero card next to the Lebensmittel one (renderHeroWater) rather
// than joining the Kategorien list — it has exactly one global target
// (Planung's rate), no per-category breakdown, so there's nothing to list.
//
// Reads the same computation graph as Ziele (js/targets.js) — taxonomy,
// /config/targets, /config/household, /config/planning — duplicated here
// rather than shared, matching this codebase's established convention of
// duplicating small-to-medium helpers until a third real consumer shows up
// (see js/planning.js's categoryPlanningMode for the same pattern at
// smaller scale). Keeping the two screens' target math byte-for-byte
// identical is why: a category's target here must always equal its target
// in Ziele, or the two screens contradict each other.
//
// "Vorrat" (current stock) is new territory no other screen needed yet:
// a stock batch stores quantity (a count) and content (free text like
// "500g") — SPEC.md Section 5 defines the parse rule this file implements
// (parseContentGrams): strip the unit, treat the leading number as grams,
// divide by 1000. Products matched to categories via subcategoryId, never
// via a batch's own denormalized category/subcategory name text.
// Stück-tracked products have no such conversion and are excluded from
// every kg sum for now (flagged to Markus, to be solved later).
import { db } from './firebase-init.js?v=118';
import {
  doc, getDoc, getDocs, collection,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { openFilteredBySubcategory, openFilteredByProductSearch } from './stock-table.js?v=118';
import { openAtSubcategory } from './stock-checkin.js?v=118';

const dashTabBtns = document.querySelectorAll('.seg-btn[data-dash-tab]');
const dashTabPanels = document.querySelectorAll('.dash-tab[data-dash-tab-panel]');

const unitToggleButtons = document.querySelectorAll('#dash-unit-toggle .select-mode-btn');
const heroEl = document.getElementById('dash-hero');
const heroWaterEl = document.getElementById('dash-hero-water');
const categoryListEl = document.getElementById('dash-category-list');
const legendEl = document.getElementById('dash-legend');

const alertsHorizonButtons = document.querySelectorAll('#alerts-horizon-toggle .select-mode-btn');
const alertsFullListEl = document.getElementById('alerts-full-list');

const shoppingFullListEl = document.getElementById('shopping-full-list');

let taxonomy = { types: [] };
let targetsDoc = {
  categories: {}, subcategories: {}, products: {}, macroSplits: {}, subSplits: {},
};
let household = { members: [] };
let planning = { autonomyDays: null, macroSplit: {}, waterLitersPerPersonDay: null };
let allProducts = [];
let productIndex = new Map();
let allBatches = [];
let displayUnit = 'kg';
let loadOk = false;
let isAdmin = false;

const openCategoryIds = new Set();

// --- Data loading -----------------------------------------------------

async function loadAll() {
  try {
    const [taxSnap, targetsSnap, householdSnap, planningSnap, productsSnap, batchesSnap] = await Promise.all([
      getDoc(doc(db, 'config', 'taxonomy')),
      getDoc(doc(db, 'config', 'targets')),
      getDoc(doc(db, 'config', 'household')),
      getDoc(doc(db, 'config', 'planning')),
      getDocs(collection(db, 'products')),
      getDocs(collection(db, 'stockItems')),
    ]);
    taxonomy = taxSnap.exists() && Array.isArray(taxSnap.data().types) ? taxSnap.data() : { types: [] };
    const t = targetsSnap.exists() ? targetsSnap.data() : {};
    targetsDoc = {
      categories: t.categories || {},
      subcategories: t.subcategories || {},
      products: t.products || {},
      macroSplits: t.macroSplits || {},
      subSplits: t.subSplits || {},
    };
    household = {
      members: householdSnap.exists() && Array.isArray(householdSnap.data().members) ? householdSnap.data().members : [],
    };
    const p = planningSnap.exists() ? planningSnap.data() : {};
    planning = {
      autonomyDays: p.autonomyDays ?? null,
      macroSplit: p.macroSplit || {},
      waterLitersPerPersonDay: p.waterLitersPerPersonDay ?? null,
    };
    allProducts = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    productIndex = new Map(allProducts.map((prod) => [prod.id, prod]));
    allBatches = batchesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    loadOk = true;
  } catch (err) {
    loadOk = false;
    console.error(err);
  }
  render();
}

// --- Same target math as js/targets.js (see file header) ----------------

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

function computeMacroGroups() {
  const groups = { kohlenhydrat: [], protein: [], fett: [] };
  taxonomy.types.forEach((type) => (type.categories || []).forEach((cat) => {
    if (categoryPlanningMode(type, cat) === 'calorie' && cat.macroType && cat.kcalPerKg != null && groups[cat.macroType]) {
      groups[cat.macroType].push(cat.id);
    }
  }));
  return groups;
}

let macroGroupIds = { kohlenhydrat: [], protein: [], fett: [] };

function peopleCount() {
  return household.members.length;
}

function totalDailyKcal() {
  return household.members.reduce((sum, m) => sum + (Number(m.kcalPerDay) || 0), 0);
}

function autonomyDaysVal() {
  return Number(planning.autonomyDays) || 0;
}

const DEFAULT_MACRO_SPLIT = { kohlenhydrat: 50, protein: 20, fett: 30 };
const DEFAULT_WATER_RATE = 3;

function macroGlobalKcal(macro) {
  const pct = planning.macroSplit?.[macro] != null ? Number(planning.macroSplit[macro]) : DEFAULT_MACRO_SPLIT[macro];
  return totalDailyKcal() * autonomyDaysVal() * (pct || 0) / 100;
}

// Water's one global target — no per-category split, unlike Kalorien/
// Diversität (see js/planning.js's file header for why the old category
// picker is gone). Tracked natively in liters, not kg: a stock batch's
// content is parsed unit-agnostically anyway (see parseContentGrams
// below), and 1 L of water weighs ~1 kg, so the same numeric pipeline
// that sums Lebensmittel's kg also sums water's liters with zero changes.
function waterGlobalLiters() {
  if (peopleCount() === 0 || autonomyDaysVal() <= 0) return null;
  const rate = planning.waterLitersPerPersonDay != null ? Number(planning.waterLitersPerPersonDay) : DEFAULT_WATER_RATE;
  return rate * peopleCount() * autonomyDaysVal();
}

function hasWaterType() {
  return taxonomy.types.some((type) => typeClass(type) === 'water');
}

// The global Wasser shortfall isn't tied to any one subcategory the way a
// Lebensmittel gap or a Produktziel is — it's a single global target. For
// the shopping-list tap-through (openAtSubcategory below) this just needs
// *a* reasonable landing spot rather than the "correct" one, so the first
// category's auto-managed subcategory (js/taxonomy.js keeps exactly one
// per Wasser category) is as good as any — the admin picks the actual
// storage form (Tank/Flaschen/…) themselves from there anyway.
function firstWaterSubcategoryId() {
  const waterType = taxonomy.types.find((type) => typeClass(type) === 'water');
  const firstCat = waterType && (waterType.categories || [])[0];
  const firstSub = firstCat && (firstCat.subcategories || [])[0];
  return firstSub ? firstSub.id : null;
}

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
  return resolveSplit(targetsDoc.macroSplits[macro] || {}, ids);
}

function getSubSplit(categoryId, ids) {
  return resolveSplit(targetsDoc.subSplits[categoryId] || {}, ids);
}

function computeAmount(target) {
  if (!target) return 0;
  if (target.mode === 'flat') return target.amount || 0;
  return Math.round((target.ratePerPersonDay || 0) * (target.people || 0) * (target.days || 0) * 100) / 100;
}

// { kind: 'calorie'|'diversity'|'off', kg: number|null }
// Wasser-classed types never reach this — buildCategoryRows only walks
// food-classed types; water gets its own hero (see renderHeroWater).
function categoryTargetSource(type, cat) {
  const mode = categoryPlanningMode(type, cat);
  if (mode === 'calorie') {
    if (peopleCount() === 0 || autonomyDaysVal() <= 0) return { kind: 'calorie', kg: null };
    if (!cat.macroType || cat.kcalPerKg == null || cat.kcalPerKg <= 0) return { kind: 'calorie', kg: null };
    const group = macroGroupIds[cat.macroType] || [cat.id];
    const split = getMacroSplit(cat.macroType, group);
    const pct = split[cat.id] || 0;
    return { kind: 'calorie', kg: (macroGlobalKcal(cat.macroType) * pct) / 100 / cat.kcalPerKg };
  }
  if (mode === 'diversity') {
    if (peopleCount() === 0 || autonomyDaysVal() <= 0) return { kind: 'diversity', kg: null };
    if (cat.diversityFloorGramsPerPersonDay == null) return { kind: 'diversity', kg: null };
    return { kind: 'diversity', kg: (cat.diversityFloorGramsPerPersonDay / 1000) * peopleCount() * autonomyDaysVal() };
  }
  return { kind: 'off', kg: null };
}

// Manual ("Aus") categories/subcategories carry whatever unit their target
// was set in — a Stück-unit manual target doesn't fit this kg-based view
// (same open item as Stück-tracked stock, see file header), so it's
// skipped here rather than silently misreported.
function manualTargetKg(target) {
  if (!target || target.unit === 'stueck') return null;
  return computeAmount(target);
}

function categoryDisplayTarget(cat, source) {
  if (source.kind !== 'off') return source.kg;
  return manualTargetKg(targetsDoc.categories[cat.id]);
}

function subcategoryDisplayTarget(cat, sub, source, categoryKg) {
  if (source.kind === 'off') {
    return manualTargetKg(targetsDoc.subcategories[sub.id]);
  }
  if (categoryKg == null) return null;
  const subIds = (cat.subcategories || []).map((s) => s.id);
  const split = getSubSplit(cat.id, subIds);
  return (categoryKg * (split[sub.id] || 0)) / 100;
}

// --- Vorrat (current stock) ----------------------------------------------

// SPEC.md Section 5: no per-product conversion factor. Strip the unit
// suffix, treat the leading number as grams (ml treated as ~1g, close
// enough for household planning), divide by 1000.
function parseContentGrams(content) {
  if (!content) return null;
  const match = String(content).trim().match(/^(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  return parseFloat(match[1].replace(',', '.'));
}

// kg and l are the only "fractional" units (content-string-parsed, 1L≈1kg
// per SPEC.md Section 5) — every other unit (legacy 'stueck', or any of
// the open Sonstiges units: Stück, Flaschen, Dosen, Säcke, a custom one)
// is tracked as a plain integer count instead, see productCurrentAmount().
function isFractionalUnit(unit) {
  return unit === 'kg' || unit === 'l';
}

function batchKg(batch) {
  const product = productIndex.get(batch.productId);
  if (!product || !isFractionalUnit(product.unitType)) return 0;
  const grams = parseContentGrams(batch.content);
  if (grams == null) return 0;
  return (batch.quantity || 0) * (grams / 1000);
}

function computeSubcategoryStock() {
  const stock = new Map();
  allBatches.forEach((batch) => {
    const product = productIndex.get(batch.productId);
    if (!product || !product.subcategoryId) return;
    const kg = batchKg(batch);
    if (kg === 0) return;
    stock.set(product.subcategoryId, (stock.get(product.subcategoryId) || 0) + kg);
  });
  return stock;
}

// Sums the same subcategory stock map across every Wasser-classed type's
// subcategories — numerically kg and liters are the same number here (see
// waterGlobalLiters), so this reuses computeSubcategoryStock() unchanged.
function waterCurrentLiters(subStock) {
  let sum = 0;
  taxonomy.types.forEach((type) => {
    if (typeClass(type) !== 'water') return;
    (type.categories || []).forEach((cat) => {
      (cat.subcategories || []).forEach((sub) => {
        sum += subStock.get(sub.id) || 0;
      });
    });
  });
  return sum;
}

// Current stock for one specific product, in that product's own unit —
// used by the Einkaufsliste's product-level targets (see
// computeShoppingList). Unlike batchKg() above (kg-only, for the
// Kategorien/Wasser sums), this also handles Stück-tracked products: a
// piece count needs no content-string parsing at all, so it sidesteps the
// "Stück has no kg conversion" gap entirely rather than hitting it.
function productCurrentAmount(product) {
  const batches = allBatches.filter((b) => b.productId === product.id);
  if (isFractionalUnit(product.unitType)) {
    return batches.reduce((s, b) => s + batchKg(b), 0);
  }
  return batches.reduce((s, b) => s + (b.quantity || 0), 0);
}

// --- Bald ablaufend (best-before alerts) ---------------------------------
// bestBefore is stored as "MM/YYYY" (month precision only, no day — see
// js/stock-checkin.js), so "expires within N months" is a month-index
// comparison, not a date one. Unlike the rest of this screen, alerts cover
// every batch regardless of Lebensmittel/Wasser/Sonstiges — a best-before
// date matters for medicine or batteries just as much as food, and there's
// no kcal/autonomy framing dependency here that would need excluding them.

function monthIndex(mm, yyyy) {
  return Number(yyyy) * 12 + Number(mm);
}

function nowMonthIndex() {
  const d = new Date();
  return d.getFullYear() * 12 + (d.getMonth() + 1);
}

// 'danger' = already due this month or overdue, 'warn' = due next month,
// 'none' = further out (only reachable via the 6-Monate/Jahresende views).
function alertSeverity(idx, nowIdx) {
  if (idx <= nowIdx) return 'danger';
  if (idx <= nowIdx + 1) return 'warn';
  return 'none';
}

function computeAlerts(minIdx, maxIdx) {
  const nowIdx = nowMonthIndex();
  return allBatches
    .filter((b) => b.bestBefore)
    .map((b) => {
      const [mm, yyyy] = b.bestBefore.split('/');
      return { batch: b, idx: monthIndex(mm, yyyy) };
    })
    .filter(({ idx }) => idx >= minIdx && idx <= maxIdx)
    .sort((a, b) => a.idx - b.idx)
    .map(({ batch, idx }) => ({
      batch,
      product: productIndex.get(batch.productId),
      severity: alertSeverity(idx, nowIdx),
    }))
    .filter((a) => a.product);
}

// Each button is its own exclusive band, not "everything up to here" —
// picking 1 Monat should never re-show what MHD erreicht already covers.
// A clean duration ladder: reached, next month, months 2-6, months 7-12.
function alertsRange(horizon) {
  const nowIdx = nowMonthIndex();
  if (horizon === 'reached') return { min: -Infinity, max: nowIdx };
  if (horizon === '1') return { min: nowIdx + 1, max: nowIdx + 1 };
  if (horizon === '6') return { min: nowIdx + 2, max: nowIdx + 6 };
  return { min: nowIdx + 7, max: nowIdx + 12 };
}

// --- Einkaufsliste (shopping list) ---------------------------------------
// Every gap already visible on this screen, re-surfaced as "what to buy":
// subcategory gaps from the Kategorien cards above (Lebensmittel only, by
// construction of buildCategoryRows), individual product targets that are
// short (any type — Ziele's Produktziele isn't Lebensmittel/Wasser-scoped
// either, e.g. "at least 10 batteries" is just as valid a shopping-list
// entry as a food product), and the Wasser hero's own shortfall if any.

function computeShoppingList(subStock, rows) {
  const items = [];

  rows.forEach((row) => {
    row.subs.forEach(({ sub, targetKg, currentKg }) => {
      if (targetKg != null && currentKg < targetKg) {
        items.push({
          kind: 'sub', name: sub.name, group: row.cat.name, groupSym: row.cat.sym || '', need: targetKg - currentKg, unit: 'kg', kcalPerKg: row.kcalPerKg, subcategoryId: sub.id,
        });
      }
    });
  });

  Object.keys(targetsDoc.products || {}).forEach((productId) => {
    const target = targetsDoc.products[productId];
    const product = productIndex.get(productId);
    if (!product) return;
    const targetAmount = computeAmount(target);
    if (!targetAmount) return;
    const current = productCurrentAmount(product);
    if (current < targetAmount) {
      items.push({
        kind: 'product', name: product.name, group: 'Produktziele', groupSym: '', need: targetAmount - current, unit: target.unit, subcategoryId: product.subcategoryId,
      });
    }
  });

  const waterTarget = waterGlobalLiters();
  const waterCurrent = waterCurrentLiters(subStock);
  if (waterTarget != null && waterCurrent < waterTarget) {
    items.push({
      kind: 'water', name: 'Wasser', group: 'Produktziele', groupSym: '', need: waterTarget - waterCurrent, unit: 'L', subcategoryId: firstWaterSubcategoryId(),
    });
  }

  return items;
}

function formatShoppingNeed(item) {
  if (item.unit === 'kg') return formatAmount(item.need, item.kcalPerKg ?? null);
  if (item.unit === 'l') return `${round2(item.need)} l`;
  if (item.unit === 'L') return `${round2(item.need)} L`; // the synthetic Wasser-global entry, not a real product unit
  if (item.unit === 'stueck') return `${Math.ceil(item.need)} Stk`; // legacy value
  return `${Math.ceil(item.need)} ${item.unit}`; // open Sonstiges units: Stück, Flaschen, Dosen, Säcke, custom
}

// --- Formatting ------------------------------------------------------------

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Mirrors js/targets.js's formatComputedAmount exactly — same figure,
// same unit toggle, same look, on both screens.
function formatAmount(kg, kcalPerKg) {
  const people = peopleCount();
  const days = autonomyDaysVal();
  if (displayUnit === 'kgpd') {
    return people > 0 && days > 0 ? `${Math.round((kg / people / days) * 1000) / 1000} kg/P/T` : `${round2(kg)} kg`;
  }
  if ((displayUnit === 'kcal' || displayUnit === 'kcalpd') && kcalPerKg != null) {
    const kcal = kg * kcalPerKg;
    if (displayUnit === 'kcal') return `${Math.round(kcal).toLocaleString('de-DE')} kcal`;
    return people > 0 && days > 0 ? `${Math.round(kcal / people / days)} kcal/P/T` : `${round2(kg)} kg`;
  }
  return `${round2(kg)} kg`;
}

function pct(current, target) {
  if (!target || target <= 0) return current > 0 ? 100 : 0;
  return (current / target) * 100;
}

// hasTarget=false is its own neutral state — a subcategory under a manual
// (Aus) category with no target of its own has nothing to be "100%" or
// "danger" against; showing it green (current>0, no target) or red
// (current=0, no target) would both be actively misleading.
function stateFor(p, hasTarget = true) {
  if (!hasTarget) return 'none';
  if (p >= 100) return 'ok';
  if (p >= 60) return 'warn';
  return 'danger';
}

function weeksOfCoverage(currentKg, targetKg) {
  const days = autonomyDaysVal();
  if (!targetKg || targetKg <= 0 || days <= 0) return null;
  return (currentKg / targetKg) * (days / 7);
}

// --- Build the row model -----------------------------------------------

function buildCategoryRows(subStock) {
  const rows = [];
  taxonomy.types.forEach((type) => {
    if (typeClass(type) !== 'food') return;
    (type.categories || []).forEach((cat) => {
      const source = categoryTargetSource(type, cat);
      const targetKg = categoryDisplayTarget(cat, source);
      if (targetKg == null) return;
      const subs = (cat.subcategories || []).map((sub) => ({
        sub,
        targetKg: subcategoryDisplayTarget(cat, sub, source, source.kg),
        currentKg: subStock.get(sub.id) || 0,
      }));
      const currentKg = subs.reduce((s, r) => s + r.currentKg, 0);
      rows.push({
        cat, source, targetKg, currentKg, kcalPerKg: cat.kcalPerKg ?? null, subs,
      });
    });
  });
  return rows;
}

// --- Rendering ---------------------------------------------------------

function renderHero(rows) {
  heroEl.innerHTML = '';
  if (rows.length === 0) {
    const p = document.createElement('p');
    p.className = 'screen-placeholder';
    p.textContent = loadOk
      ? 'Noch keine Lebensmittel-Ziele gesetzt (Settings → Ziele, oder Haushalt/Autonomiedauer in Planung eingeben).'
      : 'Fehler beim Laden der Übersicht.';
    heroEl.appendChild(p);
    return;
  }

  const targetKgAll = rows.reduce((s, r) => s + r.targetKg, 0);
  const currentKgAll = rows.reduce((s, r) => s + r.currentKg, 0);
  const targetKcal = ['kohlenhydrat', 'protein', 'fett'].reduce((s, m) => s + macroGlobalKcal(m), 0);
  const currentKcal = rows.reduce((s, r) => s + (r.kcalPerKg ? r.currentKg * r.kcalPerKg : 0), 0);

  const useKcal = displayUnit === 'kcal' || displayUnit === 'kcalpd';
  const target = useKcal ? targetKcal : targetKgAll;
  const current = useKcal ? currentKcal : currentKgAll;
  const p = pct(current, target);

  const people = peopleCount();
  const days = autonomyDaysVal();
  let currentText;
  let targetText;
  if (displayUnit === 'kg') {
    currentText = `${round2(current)}`;
    targetText = `/ ${round2(target)} kg`;
  } else if (displayUnit === 'kgpd') {
    currentText = people > 0 && days > 0 ? `${Math.round((current / people / days) * 1000) / 1000}` : `${round2(current)}`;
    targetText = people > 0 && days > 0 ? `/ ${Math.round((target / people / days) * 1000) / 1000} kg/P/T` : `/ ${round2(target)} kg`;
  } else if (displayUnit === 'kcal') {
    currentText = Math.round(current).toLocaleString('de-DE');
    targetText = `/ ${Math.round(target).toLocaleString('de-DE')} kcal`;
  } else {
    currentText = people > 0 && days > 0 ? Math.round(current / people / days).toLocaleString('de-DE') : Math.round(current).toLocaleString('de-DE');
    targetText = people > 0 && days > 0 ? `/ ${Math.round(target / people / days).toLocaleString('de-DE')} kcal/P/T` : `/ ${Math.round(target).toLocaleString('de-DE')} kcal`;
  }

  const weeks = weeksOfCoverage(currentKgAll, targetKgAll);
  const weeksTarget = days > 0 ? days / 7 : null;

  const hero = document.createElement('div');
  hero.className = 'dash-hero';
  hero.innerHTML = `
    <div class="dash-hero-label">Lebensmittel gesamt</div>
    <div class="dash-hero-figures">
      <span class="dash-hero-current">${currentText}</span>
      <span class="dash-hero-target">${targetText}</span>
    </div>
    <div class="dash-hero-bar-track"><div class="dash-hero-bar-fill" style="width:${Math.min(100, p)}%"></div></div>
    <div class="dash-hero-meta">
      <span>${Math.round(p)} % gedeckt</span>
      <span>${weeks != null && weeksTarget != null ? `reicht ca. <b>${round2(Math.min(weeks, 999))}</b> von ${round2(weeksTarget)} Wochen` : ''}</span>
    </div>
  `;
  heroEl.appendChild(hero);
}

// Own card next to the Lebensmittel hero — one global figure (current vs.
// Planung's rate × people × days), no per-category breakdown, since a
// Wasser type has no per-category target to break down (see
// js/planning.js and js/targets.js's file-header comments).
function renderHeroWater(current, target) {
  heroWaterEl.innerHTML = '';
  heroWaterEl.classList.toggle('hidden', !hasWaterType());
  if (!hasWaterType()) return;

  if (target == null) {
    const p = document.createElement('p');
    p.className = 'screen-placeholder';
    p.textContent = 'Haushalt und Autonomiedauer in Planung eingeben, um das Wasserziel zu sehen.';
    heroWaterEl.appendChild(p);
    return;
  }

  const p = pct(current, target);
  const people = peopleCount();
  const days = autonomyDaysVal();
  const weeks = weeksOfCoverage(current, target);
  const weeksTarget = days > 0 ? days / 7 : null;

  let currentText;
  let targetText;
  if (displayUnit === 'kgpd' && people > 0 && days > 0) {
    currentText = `${Math.round((current / people / days) * 1000) / 1000}`;
    targetText = `/ ${Math.round((target / people / days) * 1000) / 1000} L/P/T`;
  } else {
    currentText = `${round2(current)}`;
    targetText = `/ ${round2(target)} L`;
  }

  const hero = document.createElement('div');
  hero.className = 'dash-hero water';
  hero.innerHTML = `
    <div class="dash-hero-label">Wasser gesamt</div>
    <div class="dash-hero-figures">
      <span class="dash-hero-current">${currentText}</span>
      <span class="dash-hero-target">${targetText}</span>
    </div>
    <div class="dash-hero-bar-track"><div class="dash-hero-bar-fill" style="width:${Math.min(100, p)}%"></div></div>
    <div class="dash-hero-meta">
      <span>${Math.round(p)} % gedeckt</span>
      <span>${weeks != null && weeksTarget != null ? `reicht ca. <b>${round2(Math.min(weeks, 999))}</b> von ${round2(weeksTarget)} Wochen` : ''}</span>
    </div>
  `;
  heroWaterEl.appendChild(hero);
}

function renderCategoryList(rows) {
  categoryListEl.innerHTML = '';
  legendEl.classList.toggle('hidden', rows.length === 0);
  if (rows.length === 0) return;

  rows.forEach((row) => {
    const { cat, targetKg, currentKg } = row;
    const p = pct(currentKg, targetKg);
    const s = stateFor(p);
    const weeks = weeksOfCoverage(currentKg, targetKg);

    const card = document.createElement('div');
    card.className = 'dash-cat-card' + (openCategoryIds.has(cat.id) ? ' open' : '');
    card.innerHTML = `
      <div class="dash-cat-head">
        <div class="dash-cat-sym">${cat.sym || ''}</div>
        <div class="dash-cat-main">
          <div class="dash-cat-name">${cat.name}</div>
          <div class="dash-cat-bar-track"><div class="dash-cat-bar-fill ${s}" style="width:${Math.min(100, p)}%"></div></div>
        </div>
        <div class="dash-cat-figures">
          <div class="dash-cat-current ${s}">${formatAmount(currentKg, row.kcalPerKg)}</div>
          <div class="dash-cat-target">von ${formatAmount(targetKg, row.kcalPerKg)}</div>
        </div>
        <div class="dash-cat-chevron">▾</div>
      </div>
      <div class="dash-cat-footer">
        <span class="dash-coverage-chip ${s}">${weeks != null ? `reicht ${round2(Math.min(weeks, 999))} Wo.` : 'reicht — Wo.'}</span>
      </div>
      <div class="dash-sub-list"></div>
    `;

    const subListEl = card.querySelector('.dash-sub-list');
    row.subs.forEach(({ sub, targetKg: subTarget, currentKg: subCurrent }) => {
      const hasTarget = subTarget != null;
      const sp = hasTarget ? pct(subCurrent, subTarget) : 0;
      const ss = stateFor(sp, hasTarget);
      const subRow = document.createElement('div');
      subRow.className = 'dash-sub-row' + (isAdmin ? ' tappable' : '');
      subRow.innerHTML = `
        <div class="dash-sub-sym">${sub.sym || ''}</div>
        <div class="dash-sub-name">${sub.name}</div>
        <div class="dash-sub-bar-track"><div class="dash-sub-bar-fill ${ss}" style="width:${hasTarget ? Math.min(100, sp) : 0}%"></div></div>
        <div class="dash-sub-figures"><span class="dash-sub-current ${ss}">${formatAmount(subCurrent, row.kcalPerKg)}</span></div>
        ${isAdmin ? '<div class="dash-sub-arrow">›</div>' : ''}
      `;
      if (isAdmin) {
        subRow.title = 'In Bestandsliste öffnen';
        subRow.addEventListener('click', () => openFilteredBySubcategory(sub.id, sub.name));
      }
      subListEl.appendChild(subRow);
    });

    card.querySelector('.dash-cat-head').addEventListener('click', () => {
      if (openCategoryIds.has(cat.id)) openCategoryIds.delete(cat.id);
      else openCategoryIds.add(cat.id);
      card.classList.toggle('open');
    });

    categoryListEl.appendChild(card);
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

// --- Tabs (Bestand / MHD / Einkaufsliste) --------------------------------

dashTabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    dashTabBtns.forEach((b) => b.classList.toggle('active', b === btn));
    dashTabPanels.forEach((p) => p.classList.toggle('hidden', p.dataset.dashTabPanel !== btn.dataset.dashTab));
  });
});

// --- Alerts rendering --------------------------------------------------

function renderAlertsList(horizon) {
  alertsFullListEl.innerHTML = '';
  if (!loadOk) return;
  const { min, max } = alertsRange(horizon);
  const alerts = computeAlerts(min, max);
  if (alerts.length === 0) {
    const p = document.createElement('p');
    p.className = 'screen-placeholder';
    p.textContent = 'Nichts läuft in diesem Zeitraum ab.';
    alertsFullListEl.appendChild(p);
    return;
  }
  alerts.forEach((alert) => {
    const row = document.createElement('div');
    row.className = 'dash-alert-row' + (alert.severity !== 'none' ? ' ' + alert.severity : '');
    row.addEventListener('click', () => openFilteredByProductSearch(alert.product.name));
    row.innerHTML = `
      <span class="dash-alert-row-name">${alert.product.name}</span>
      <span class="dash-alert-row-date">${alert.batch.bestBefore}</span>
    `;
    alertsFullListEl.appendChild(row);
  });
}

let currentAlertsHorizon = '1';

alertsHorizonButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    currentAlertsHorizon = btn.dataset.horizon;
    alertsHorizonButtons.forEach((b) => b.classList.toggle('active', b === btn));
    renderAlertsList(currentAlertsHorizon);
  });
});

// --- Shopping list rendering ---------------------------------------------

function renderShoppingList(items) {
  shoppingFullListEl.innerHTML = '';
  if (items.length === 0) {
    const p = document.createElement('p');
    p.className = 'screen-placeholder';
    p.textContent = 'Nichts fehlt gerade.';
    shoppingFullListEl.appendChild(p);
    return;
  }
  const groups = new Map();
  items.forEach((item) => {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push(item);
  });

  // Two columns, side by side on tablet via CSS (stacked on mobile, same
  // flow as the old single-column list) — a whole category group always
  // goes into one column, never split mid-category. Greedy bin-packing:
  // each group goes into whichever column currently holds fewer items, so
  // both stay roughly balanced without needing to split a group itself.
  const columns = [[], []];
  const columnCounts = [0, 0];
  groups.forEach((groupItems, groupName) => {
    const target = columnCounts[0] <= columnCounts[1] ? 0 : 1;
    columns[target].push([groupName, groupItems]);
    columnCounts[target] += groupItems.length;
  });

  const colsWrap = document.createElement('div');
  colsWrap.className = 'dash-shopping-cols';
  columns.forEach((colGroups) => {
    const col = document.createElement('div');
    col.className = 'dash-shopping-col';
    colGroups.forEach(([groupName, groupItems]) => {
      const label = document.createElement('div');
      label.className = 'dash-shopping-group-label';
      const sym = groupItems[0].groupSym;
      label.textContent = sym ? `${sym} ${groupName}` : groupName;
      col.appendChild(label);
      groupItems.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'dash-shopping-row';
        row.innerHTML = `
          <span class="dash-shopping-row-name">${item.name}</span>
          <span class="dash-shopping-row-need">+${formatShoppingNeed(item)}</span>
        `;
        row.addEventListener('click', () => openAtSubcategory(item.subcategoryId));
        col.appendChild(row);
      });
    });
    colsWrap.appendChild(col);
  });
  shoppingFullListEl.appendChild(colsWrap);
}

function render() {
  macroGroupIds = computeMacroGroups();
  syncUnitToggle();
  const subStock = loadOk ? computeSubcategoryStock() : new Map();
  const rows = loadOk ? buildCategoryRows(subStock) : [];
  renderHero(rows);
  renderHeroWater(waterCurrentLiters(subStock), waterGlobalLiters());
  renderCategoryList(rows);
  renderAlertsList(currentAlertsHorizon);
  renderShoppingList(loadOk ? computeShoppingList(subStock, rows) : []);
}

// --- Entry point -----------------------------------------------------------

window.addEventListener('erdkeller:signedin', (e) => {
  isAdmin = e.detail.role === 'admin';
  loadAll();
});

window.addEventListener('erdkeller:refresh', () => loadAll());

window.addEventListener('erdkeller:navreset', (e) => {
  if (e.detail.tab !== 'dashboard') return;
  openCategoryIds.clear();
  dashTabBtns.forEach((b) => b.classList.toggle('active', b.dataset.dashTab === 'stock'));
  dashTabPanels.forEach((p) => p.classList.toggle('hidden', p.dataset.dashTabPanel !== 'stock'));
  render();
});
