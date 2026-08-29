// Settings → PDF-Export (Build 122, SPEC.md Step 15) — a checkbox picker
// over 8 printable sections, each rendered from a fresh Firestore read
// (never from whatever's currently collapsed/filtered on the live
// screens) into one combined PDF via jsPDF (window.jspdf, loaded from a
// CDN <script> tag in index.html — this is the live deployed app, not a
// Claude Artifact, so no CDN allowlist applies here). doc.save(...)
// triggers a direct client-side download of the generated PDF Blob — no
// window.print()/browser print dialog anywhere in this file.
//
// Naming note: 'doc' is already the Firestore doc() import used all over
// this codebase, so every jsPDF document instance in this file is named
// 'pdf' instead, never 'doc', to avoid shadowing it.
import { db } from './firebase-init.js?v=122';
import {
  collection, getDocs, doc, getDoc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const sectionChecks = document.querySelectorAll('.pdf-section-check');
const selectAllBtn = document.getElementById('pdf-select-all-btn');
const selectNoneBtn = document.getElementById('pdf-select-none-btn');
const createBtn = document.getElementById('pdf-create-btn');
const statusEl = document.getElementById('pdf-status');

selectAllBtn.addEventListener('click', () => sectionChecks.forEach((cb) => { cb.checked = true; }));
selectNoneBtn.addEventListener('click', () => sectionChecks.forEach((cb) => { cb.checked = false; }));

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Duplicated verbatim from js/backup.js's own CSV-export helper — same
// sanitized-HTML-to-plain-text stripping, jsPDF only draws plain text.
function bodyPlainText(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
}

// --- Layout helpers ------------------------------------------------------

const MARGIN = 15;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;
const LINE_H = 5;

function ensure(pdf, y, needed) {
  if (y + needed > PAGE_H - MARGIN) {
    pdf.addPage();
    return MARGIN;
  }
  return y;
}

function heading(pdf, y, text) {
  y = ensure(pdf, y, LINE_H * 2);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text(text, MARGIN, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  return y + LINE_H * 2;
}

function subheading(pdf, y, text) {
  y = ensure(pdf, y, LINE_H * 1.6);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text(text, MARGIN, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  return y + LINE_H * 1.6;
}

function bodyText(pdf, y, text, opts = {}) {
  const indent = opts.indent || 0;
  const size = opts.size || 10;
  pdf.setFont('helvetica', opts.bold ? 'bold' : 'normal');
  pdf.setFontSize(size);
  const lines = pdf.splitTextToSize(text, CONTENT_W - indent);
  lines.forEach((line) => {
    y = ensure(pdf, y, LINE_H);
    pdf.text(line, MARGIN + indent, y);
    y += LINE_H;
  });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  return y;
}

function bullet(pdf, y, text, opts = {}) {
  return bodyText(pdf, y, '• ' + text, { indent: 4, ...opts });
}

// A drawn empty checkbox square + label + right-aligned meta text — used
// only by the Wartung section, which per Markus's call must always print
// blank (never today's checked/due state).
function checkboxLine(pdf, y, text, meta) {
  y = ensure(pdf, y, LINE_H);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.rect(MARGIN, y - 3.3, 3.5, 3.5);
  pdf.text(text, MARGIN + 6, y);
  if (meta) {
    pdf.setFontSize(8.5);
    const metaW = pdf.getTextWidth(meta);
    pdf.text(meta, MARGIN + CONTENT_W - metaW, y);
    pdf.setFontSize(10);
  }
  return y + LINE_H;
}

function spacer(y, mult = 1) {
  return y + LINE_H * mult;
}

// jsPDF's getImageProperties gives natural pixel dimensions synchronously
// (no async Image-load round-trip needed) — scaled to fit inside a
// maxW×maxH mm box while preserving aspect ratio (notes/recipes photos
// are NOT cropped to square at save time, only shown square via CSS).
function image(pdf, y, dataUri, maxW = 70, maxH = 70) {
  let props;
  try {
    props = pdf.getImageProperties(dataUri);
  } catch (err) {
    return y;
  }
  const scale = Math.min(maxW / props.width, maxH / props.height);
  const w = props.width * scale;
  const h = props.height * scale;
  y = ensure(pdf, y, h + LINE_H);
  pdf.addImage(dataUri, 'JPEG', MARGIN, y, w, h);
  return y + h + LINE_H;
}

// Simple wrapping table: columns = [{header, width, get(row)}], widths in mm.
// No repeated header on page breaks — acceptable for this household-scale
// data (dozens to low hundreds of rows), kept simple rather than adding
// recursive header-redraw bookkeeping for a "nice to have" polish item.
function table(pdf, y, columns, rows) {
  y = ensure(pdf, y, LINE_H * 2);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  let x = MARGIN;
  columns.forEach((col) => {
    pdf.text(col.header, x, y);
    x += col.width;
  });
  y += 1;
  pdf.setLineWidth(0.2);
  pdf.line(MARGIN, y, MARGIN + columns.reduce((s, c) => s + c.width, 0), y);
  y += LINE_H - 1;
  pdf.setFont('helvetica', 'normal');

  rows.forEach((row) => {
    const cellLines = columns.map((col) => pdf.splitTextToSize(String(col.get(row) ?? ''), col.width - 2));
    const rowLines = Math.max(...cellLines.map((l) => l.length), 1);
    const rowHeight = rowLines * (LINE_H - 1) + 1;
    y = ensure(pdf, y, rowHeight);
    let cx = MARGIN;
    columns.forEach((col, i) => {
      cellLines[i].forEach((line, li) => {
        pdf.text(line, cx, y + li * (LINE_H - 1));
      });
      cx += col.width;
    });
    y += rowHeight;
  });
  pdf.setFontSize(10);
  return y;
}

// --- Shared target/stock computation ------------------------------------
// Duplicated a third time from js/dashboard.js/js/targets.js (see that
// file's own header: "duplicated here rather than shared... until a third
// real consumer shows up") — this module is exactly that third consumer,
// serving both the Übersicht snapshot and the Ziele listing below. Kept
// as pure functions over explicit params (not module-level state like the
// other two copies) since this module has no live screen of its own to
// hold state for.

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

function computeMacroGroups(taxonomy) {
  const groups = { kohlenhydrat: [], protein: [], fett: [] };
  taxonomy.types.forEach((type) => (type.categories || []).forEach((cat) => {
    if (categoryPlanningMode(type, cat) === 'calorie' && cat.macroType && cat.kcalPerKg != null && groups[cat.macroType]) {
      groups[cat.macroType].push(cat.id);
    }
  }));
  return groups;
}

function peopleCount(household) {
  return household.members.length;
}

function autonomyDaysVal(planning) {
  return Number(planning.autonomyDays) || 0;
}

function totalDailyKcal(household) {
  return household.members.reduce((sum, m) => sum + (Number(m.kcalPerDay) || 0), 0);
}

const DEFAULT_MACRO_SPLIT = { kohlenhydrat: 50, protein: 20, fett: 30 };
const DEFAULT_WATER_RATE = 3;

function macroGlobalKcal(macro, household, planning) {
  const pct = planning.macroSplit?.[macro] != null ? Number(planning.macroSplit[macro]) : DEFAULT_MACRO_SPLIT[macro];
  return totalDailyKcal(household) * autonomyDaysVal(planning) * (pct || 0) / 100;
}

function waterGlobalLiters(household, planning) {
  const people = peopleCount(household);
  const days = autonomyDaysVal(planning);
  if (people === 0 || days <= 0) return null;
  const rate = planning.waterLitersPerPersonDay != null ? Number(planning.waterLitersPerPersonDay) : DEFAULT_WATER_RATE;
  return rate * people * days;
}

function hasWaterType(taxonomy) {
  return taxonomy.types.some((type) => typeClass(type) === 'water');
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

function getMacroSplit(macro, ids, targetsDoc) {
  return resolveSplit(targetsDoc.macroSplits[macro] || {}, ids);
}

function getSubSplit(categoryId, ids, targetsDoc) {
  return resolveSplit(targetsDoc.subSplits[categoryId] || {}, ids);
}

function computeAmount(target) {
  if (!target) return 0;
  if (target.mode === 'flat') return target.amount || 0;
  return Math.round((target.ratePerPersonDay || 0) * (target.people || 0) * (target.days || 0) * 100) / 100;
}

function categoryTargetSource(type, cat, macroGroupIds, household, planning, targetsDoc) {
  const mode = categoryPlanningMode(type, cat);
  if (mode === 'calorie') {
    if (peopleCount(household) === 0 || autonomyDaysVal(planning) <= 0) return { kind: 'calorie', kg: null };
    if (!cat.macroType || cat.kcalPerKg == null || cat.kcalPerKg <= 0) return { kind: 'calorie', kg: null };
    const group = macroGroupIds[cat.macroType] || [cat.id];
    const split = getMacroSplit(cat.macroType, group, targetsDoc);
    const pct = split[cat.id] || 0;
    return { kind: 'calorie', kg: (macroGlobalKcal(cat.macroType, household, planning) * pct) / 100 / cat.kcalPerKg };
  }
  if (mode === 'diversity') {
    if (peopleCount(household) === 0 || autonomyDaysVal(planning) <= 0) return { kind: 'diversity', kg: null };
    if (cat.diversityFloorGramsPerPersonDay == null) return { kind: 'diversity', kg: null };
    return { kind: 'diversity', kg: (cat.diversityFloorGramsPerPersonDay / 1000) * peopleCount(household) * autonomyDaysVal(planning) };
  }
  return { kind: 'off', kg: null };
}

function manualTargetKg(target) {
  if (!target || target.unit === 'stueck') return null;
  return computeAmount(target);
}

function categoryDisplayTarget(cat, source, targetsDoc) {
  if (source.kind !== 'off') return source.kg;
  return manualTargetKg(targetsDoc.categories[cat.id]);
}

function subcategoryDisplayTarget(cat, sub, source, categoryKg, targetsDoc) {
  if (source.kind === 'off') {
    return manualTargetKg(targetsDoc.subcategories[sub.id]);
  }
  if (categoryKg == null) return null;
  const subIds = (cat.subcategories || []).map((s) => s.id);
  const split = getSubSplit(cat.id, subIds, targetsDoc);
  return (categoryKg * (split[sub.id] || 0)) / 100;
}

function parseContentGrams(content) {
  if (!content) return null;
  const match = String(content).trim().match(/^(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  return parseFloat(match[1].replace(',', '.'));
}

function isFractionalUnit(unit) {
  return unit === 'kg' || unit === 'l';
}

function batchKg(batch, productIndex) {
  const product = productIndex.get(batch.productId);
  if (!product || !isFractionalUnit(product.unitType)) return 0;
  const grams = parseContentGrams(batch.content);
  if (grams == null) return 0;
  return (batch.quantity || 0) * (grams / 1000);
}

function computeSubcategoryStock(allBatches, productIndex) {
  const stock = new Map();
  allBatches.forEach((batch) => {
    const product = productIndex.get(batch.productId);
    if (!product || !product.subcategoryId) return;
    const kg = batchKg(batch, productIndex);
    if (kg === 0) return;
    stock.set(product.subcategoryId, (stock.get(product.subcategoryId) || 0) + kg);
  });
  return stock;
}

function waterCurrentLiters(taxonomy, subStock) {
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

function productCurrentAmount(product, allBatches) {
  const batches = allBatches.filter((b) => b.productId === product.id);
  if (isFractionalUnit(product.unitType)) {
    return batches.reduce((s, b) => {
      const grams = parseContentGrams(b.content);
      return grams == null ? s : s + (b.quantity || 0) * (grams / 1000);
    }, 0);
  }
  return batches.reduce((s, b) => s + (b.quantity || 0), 0);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function pct(current, target) {
  if (!target || target <= 0) return current > 0 ? 100 : 0;
  return (current / target) * 100;
}

function weeksOfCoverage(currentKg, targetKg, planning) {
  const days = autonomyDaysVal(planning);
  if (!targetKg || targetKg <= 0 || days <= 0) return null;
  return (currentKg / targetKg) * (days / 7);
}

function buildCategoryRows(taxonomy, macroGroupIds, household, planning, targetsDoc, subStock) {
  const rows = [];
  taxonomy.types.forEach((type) => {
    if (typeClass(type) !== 'food') return;
    (type.categories || []).forEach((cat) => {
      const source = categoryTargetSource(type, cat, macroGroupIds, household, planning, targetsDoc);
      const targetKg = categoryDisplayTarget(cat, source, targetsDoc);
      if (targetKg == null) return;
      const subs = (cat.subcategories || []).map((sub) => ({
        sub,
        targetKg: subcategoryDisplayTarget(cat, sub, source, source.kg, targetsDoc),
        currentKg: subStock.get(sub.id) || 0,
      }));
      const currentKg = subs.reduce((s, r) => s + r.currentKg, 0);
      rows.push({ cat, targetKg, currentKg, subs });
    });
  });
  return rows;
}

function monthIndex(mm, yyyy) {
  return Number(yyyy) * 12 + Number(mm);
}

function nowMonthIndex() {
  const d = new Date();
  return d.getFullYear() * 12 + (d.getMonth() + 1);
}

function computeAlerts(allBatches, productIndex, minIdx, maxIdx) {
  return allBatches
    .filter((b) => b.bestBefore)
    .map((b) => {
      const [mm, yyyy] = b.bestBefore.split('/');
      return { batch: b, idx: monthIndex(mm, yyyy) };
    })
    .filter(({ idx }) => idx >= minIdx && idx <= maxIdx)
    .sort((a, b) => a.idx - b.idx)
    .map(({ batch }) => ({ batch, product: productIndex.get(batch.productId) }))
    .filter((a) => a.product);
}

function computeShoppingList(subStock, rows, targetsDoc, productIndex, allBatches, taxonomy, household, planning) {
  const items = [];
  rows.forEach((row) => {
    row.subs.forEach(({ sub, targetKg, currentKg }) => {
      if (targetKg != null && currentKg < targetKg) {
        items.push({
          name: sub.name, group: row.cat.name, need: targetKg - currentKg, unit: 'kg',
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
    const current = productCurrentAmount(product, allBatches);
    if (current < targetAmount) {
      items.push({
        name: product.name, group: 'Produktziele', need: targetAmount - current, unit: target.unit,
      });
    }
  });
  const waterTarget = waterGlobalLiters(household, planning);
  const waterCurrent = waterCurrentLiters(taxonomy, subStock);
  if (waterTarget != null && waterCurrent < waterTarget) {
    items.push({ name: 'Wasser', group: 'Produktziele', need: waterTarget - waterCurrent, unit: 'L' });
  }
  return items;
}

function formatShoppingNeed(item) {
  if (item.unit === 'kg') return `${round2(item.need)} kg`;
  if (item.unit === 'l') return `${round2(item.need)} l`;
  if (item.unit === 'L') return `${round2(item.need)} L`;
  if (item.unit === 'stueck') return `${Math.ceil(item.need)} Stk`;
  return `${Math.ceil(item.need)} ${item.unit}`;
}

function unitLabelFor(unit) {
  if (unit === 'kg') return 'kg';
  if (unit === 'l') return 'l';
  if (unit === 'stueck') return 'Stk';
  return unit || '';
}

// --- Shared Firestore reads for the two sections above ------------------

async function loadTargetGraph() {
  const [taxSnap, targetsSnap, householdSnap, planningSnap, productsSnap, batchesSnap] = await Promise.all([
    getDoc(doc(db, 'config', 'taxonomy')),
    getDoc(doc(db, 'config', 'targets')),
    getDoc(doc(db, 'config', 'household')),
    getDoc(doc(db, 'config', 'planning')),
    getDocs(collection(db, 'products')),
    getDocs(collection(db, 'stockItems')),
  ]);
  const taxonomy = taxSnap.exists() && Array.isArray(taxSnap.data().types) ? taxSnap.data() : { types: [] };
  const t = targetsSnap.exists() ? targetsSnap.data() : {};
  const targetsDoc = {
    categories: t.categories || {}, subcategories: t.subcategories || {}, products: t.products || {}, macroSplits: t.macroSplits || {}, subSplits: t.subSplits || {},
  };
  const household = { members: householdSnap.exists() && Array.isArray(householdSnap.data().members) ? householdSnap.data().members : [] };
  const p = planningSnap.exists() ? planningSnap.data() : {};
  const planning = { autonomyDays: p.autonomyDays ?? null, macroSplit: p.macroSplit || {}, waterLitersPerPersonDay: p.waterLitersPerPersonDay ?? null };
  const allProducts = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const productIndex = new Map(allProducts.map((prod) => [prod.id, prod]));
  const allBatches = batchesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return {
    taxonomy, targetsDoc, household, planning, allProducts, productIndex, allBatches,
  };
}

// --- Section builders ------------------------------------------------------
// Each takes the shared jsPDF instance and draws starting at y = MARGIN —
// the caller (createBtn's click handler) is responsible for calling
// pdf.addPage() between sections, so a section builder never does that
// itself.

async function buildDashboardSection(pdf) {
  let y = MARGIN;
  y = heading(pdf, y, 'Übersicht — Stand: ' + new Date().toLocaleDateString('de-DE'));

  const {
    taxonomy, targetsDoc, household, planning, productIndex, allBatches,
  } = await loadTargetGraph();
  const macroGroupIds = computeMacroGroups(taxonomy);
  const subStock = computeSubcategoryStock(allBatches, productIndex);
  const rows = buildCategoryRows(taxonomy, macroGroupIds, household, planning, targetsDoc, subStock);

  const targetKgAll = rows.reduce((s, r) => s + r.targetKg, 0);
  const currentKgAll = rows.reduce((s, r) => s + r.currentKg, 0);
  const weeks = weeksOfCoverage(currentKgAll, targetKgAll, planning);
  const days = autonomyDaysVal(planning);
  const weeksTarget = days > 0 ? days / 7 : null;

  y = subheading(pdf, y, 'Lebensmittel gesamt');
  y = bodyText(pdf, y, `${round2(currentKgAll)} kg / ${round2(targetKgAll)} kg (${Math.round(pct(currentKgAll, targetKgAll))} % gedeckt)`);
  if (weeks != null && weeksTarget != null) {
    y = bodyText(pdf, y, `Reicht ca. ${round2(Math.min(weeks, 999))} von ${round2(weeksTarget)} Wochen.`);
  }

  if (hasWaterType(taxonomy)) {
    const waterCurrent = waterCurrentLiters(taxonomy, subStock);
    const waterTarget = waterGlobalLiters(household, planning);
    y = spacer(y);
    y = subheading(pdf, y, 'Wasser gesamt');
    if (waterTarget != null) {
      const wWeeks = weeksOfCoverage(waterCurrent, waterTarget, planning);
      y = bodyText(pdf, y, `${round2(waterCurrent)} l / ${round2(waterTarget)} l (${Math.round(pct(waterCurrent, waterTarget))} % gedeckt)`);
      if (wWeeks != null && weeksTarget != null) {
        y = bodyText(pdf, y, `Reicht ca. ${round2(Math.min(wWeeks, 999))} von ${round2(weeksTarget)} Wochen.`);
      }
    } else {
      y = bodyText(pdf, y, 'Kein Wasserziel konfiguriert.');
    }
  }

  y = spacer(y);
  y = subheading(pdf, y, 'Kategorien');
  if (rows.length === 0) {
    y = bodyText(pdf, y, 'Keine Lebensmittel-Ziele gesetzt.');
  }
  rows.forEach((row) => {
    y = bodyText(pdf, y, `${row.cat.name}: ${round2(row.currentKg)} kg / ${round2(row.targetKg)} kg`, { bold: true });
    row.subs.forEach(({ sub, targetKg, currentKg }) => {
      if (targetKg == null) return;
      y = bodyText(pdf, y, `${sub.name}: ${round2(currentKg)} kg / ${round2(targetKg)} kg`, { indent: 5, size: 9 });
    });
  });

  y = spacer(y);
  y = subheading(pdf, y, 'MHD-Alarme');
  const nowIdx = nowMonthIndex();
  const bands = [
    { label: 'Bereits erreicht', min: -Infinity, max: nowIdx },
    { label: 'Nächste 6 Monate', min: nowIdx + 1, max: nowIdx + 6 },
    { label: 'Monate 7–12', min: nowIdx + 7, max: nowIdx + 12 },
  ];
  let anyAlert = false;
  bands.forEach((band) => {
    const alerts = computeAlerts(allBatches, productIndex, band.min, band.max);
    if (alerts.length === 0) return;
    anyAlert = true;
    y = bodyText(pdf, y, band.label, { bold: true, size: 9 });
    alerts.forEach((a) => {
      y = bodyText(pdf, y, `${a.product.name} — MHD ${a.batch.bestBefore}`, { indent: 5, size: 9 });
    });
  });
  if (!anyAlert) y = bodyText(pdf, y, 'Nichts läuft in den nächsten 12 Monaten ab.');

  y = spacer(y);
  y = subheading(pdf, y, 'Einkaufsliste');
  const shopping = computeShoppingList(subStock, rows, targetsDoc, productIndex, allBatches, taxonomy, household, planning);
  if (shopping.length === 0) {
    y = bodyText(pdf, y, 'Nichts fehlt gerade.');
  } else {
    const groups = new Map();
    shopping.forEach((item) => {
      if (!groups.has(item.group)) groups.set(item.group, []);
      groups.get(item.group).push(item);
    });
    groups.forEach((items, groupName) => {
      y = bodyText(pdf, y, groupName, { bold: true, size: 9 });
      items.forEach((item) => {
        y = bodyText(pdf, y, `${item.name}: +${formatShoppingNeed(item)}`, { indent: 5, size: 9 });
      });
    });
  }
}

async function buildStockSection(pdf) {
  let y = MARGIN;
  y = heading(pdf, y, 'Bestand');

  const [batchesSnap, productsSnap] = await Promise.all([
    getDocs(collection(db, 'stockItems')),
    getDocs(collection(db, 'products')),
  ]);
  const productNames = new Map(productsSnap.docs.map((d) => [d.id, d.data().name || '']));
  const rows = batchesSnap.docs.map((d) => {
    const b = d.data();
    return {
      product: productNames.get(b.productId) || '',
      breadcrumb: [b.type, b.category, b.subcategory].filter(Boolean).join(' › '),
      details: b.details || '',
      quantity: b.quantity ?? '',
      content: b.content || '',
      bestBefore: b.bestBefore || '',
      storage: b.storage || '',
    };
  });
  rows.sort((a, b) => (a.breadcrumb + a.product).localeCompare(b.breadcrumb + b.product));

  const columns = [
    { header: 'Produkt', width: 35, get: (r) => r.product },
    { header: 'Typ › Kategorie › Unterkat.', width: 45, get: (r) => r.breadcrumb },
    { header: 'Details', width: 30, get: (r) => r.details },
    { header: 'Menge', width: 15, get: (r) => r.quantity },
    { header: 'Inhalt', width: 20, get: (r) => r.content },
    { header: 'MHD', width: 15, get: (r) => r.bestBefore },
    { header: 'Lagerort', width: 20, get: (r) => r.storage },
  ];
  if (rows.length === 0) {
    bodyText(pdf, y, 'Kein Bestand vorhanden.');
    return;
  }
  table(pdf, y, columns, rows);
}

async function buildMaintenanceSection(pdf) {
  let y = MARGIN;
  y = heading(pdf, y, 'Checkliste – Wartung');

  const FREQ_LABELS = {
    weekly: 'Wöchentlich', monthly: 'Monatlich', quarterly: 'Vierteljährlich', halfYearly: 'Halbjährlich', yearly: 'Jährlich',
  };
  const snap = await getDoc(doc(db, 'config', 'checklists'));
  const lists = snap.exists() && Array.isArray(snap.data().lists) ? snap.data().lists : [];
  if (lists.length === 0) {
    bodyText(pdf, y, 'Keine Checklisten vorhanden.');
    return;
  }
  lists.forEach((list) => {
    y = subheading(pdf, y, list.name || '');
    (list.items || []).forEach((item) => {
      const freq = FREQ_LABELS[item.frequency] || item.frequency || '';
      y = checkboxLine(pdf, y, item.text || '', freq);
    });
    y = spacer(y, 0.6);
  });
}

async function buildCrisisSection(pdf) {
  let y = MARGIN;
  y = heading(pdf, y, 'Checkliste – Krise');

  const snap = await getDoc(doc(db, 'config', 'crisisTypes'));
  const types = snap.exists() && Array.isArray(snap.data().types) ? snap.data().types : [];
  if (types.length === 0) {
    bodyText(pdf, y, 'Keine Krisentypen vorhanden.');
    return;
  }
  types.forEach((type) => {
    y = subheading(pdf, y, `${type.sym ? type.sym + ' ' : ''}${type.name || ''}`);
    (type.steps || []).forEach((step, i) => {
      y = bodyText(pdf, y, `${i + 1}. ${step.text || ''}`, { size: 11 });
    });
    y = spacer(y, 0.6);
  });
}

async function buildContactsSection(pdf) {
  let y = MARGIN;
  y = heading(pdf, y, 'Kontakte');

  const snap = await getDocs(collection(db, 'contacts'));
  const all = snap.docs.map((d) => d.data());
  const emergency = all.filter((c) => c.isEmergency).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const general = all.filter((c) => !c.isEmergency).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  function renderContactBlock(c) {
    y = subheading(pdf, y, c.name || '');
    if (c.role) y = bodyText(pdf, y, `Rolle: ${c.role}`, { size: 9 });
    if (c.phone) y = bodyText(pdf, y, `Telefon: ${c.phone}`, { size: 9 });
    if (c.address) y = bodyText(pdf, y, `Adresse: ${c.address}`, { size: 9 });
    if (c.notes) y = bodyText(pdf, y, `Notizen: ${c.notes}`, { size: 9 });
    y = spacer(y, 0.5);
  }

  if (emergency.length > 0) {
    y = bodyText(pdf, y, 'NOTRUF', { bold: true });
    emergency.forEach(renderContactBlock);
    y = spacer(y);
  }
  if (general.length > 0) {
    if (emergency.length > 0) y = bodyText(pdf, y, 'WEITERE KONTAKTE', { bold: true });
    general.forEach(renderContactBlock);
  }
  if (all.length === 0) bodyText(pdf, y, 'Keine Kontakte vorhanden.');
}

async function buildNotesSection(pdf) {
  let y = MARGIN;
  y = heading(pdf, y, 'Notizen');

  const snap = await getDocs(collection(db, 'notes'));
  const notes = snap.docs.map((d) => d.data());
  if (notes.length === 0) {
    bodyText(pdf, y, 'Keine Notizen vorhanden.');
    return;
  }
  notes.forEach((note) => {
    y = subheading(pdf, y, note.title || '(ohne Titel)');
    if (note.photos && note.photos[0]) y = image(pdf, y, note.photos[0]);
    const text = bodyPlainText(note.body);
    if (text) y = bodyText(pdf, y, text);
    y = spacer(y);
  });
}

async function buildRecipesSection(pdf) {
  let y = MARGIN;
  y = heading(pdf, y, 'Rezepte');

  const snap = await getDocs(collection(db, 'recipes'));
  const recipes = snap.docs.map((d) => d.data());
  if (recipes.length === 0) {
    bodyText(pdf, y, 'Keine Rezepte vorhanden.');
    return;
  }
  recipes.forEach((recipe) => {
    y = subheading(pdf, y, recipe.title || '(ohne Titel)');
    if (recipe.tags && recipe.tags.length) {
      y = bodyText(pdf, y, `Tags: ${recipe.tags.join(', ')}`, { size: 9 });
    }
    (recipe.ingredients || []).forEach((line) => {
      y = bullet(pdf, y, line);
    });
    if (recipe.photos && recipe.photos[0]) y = image(pdf, y, recipe.photos[0]);
    const text = bodyPlainText(recipe.body);
    if (text) y = bodyText(pdf, y, text);
    y = spacer(y);
  });
}

async function buildTargetsSection(pdf) {
  let y = MARGIN;
  y = heading(pdf, y, 'Ziele');

  const {
    taxonomy, targetsDoc, household, planning, productIndex,
  } = await loadTargetGraph();
  const macroGroupIds = computeMacroGroups(taxonomy);

  y = subheading(pdf, y, 'Kategorien');
  let anyCat = false;
  taxonomy.types.forEach((type) => {
    if (typeClass(type) !== 'food') return;
    (type.categories || []).forEach((cat) => {
      const source = categoryTargetSource(type, cat, macroGroupIds, household, planning, targetsDoc);
      const targetKg = categoryDisplayTarget(cat, source, targetsDoc);
      anyCat = true;
      y = bodyText(pdf, y, `${cat.name}: ${targetKg != null ? round2(targetKg) + ' kg' : '–'}`);
    });
  });
  if (!anyCat) y = bodyText(pdf, y, 'Keine Kategorien vorhanden.');

  y = spacer(y);
  y = subheading(pdf, y, 'Unterkategorien');
  let anySub = false;
  taxonomy.types.forEach((type) => {
    if (typeClass(type) !== 'food') return;
    (type.categories || []).forEach((cat) => {
      const source = categoryTargetSource(type, cat, macroGroupIds, household, planning, targetsDoc);
      const catKg = categoryDisplayTarget(cat, source, targetsDoc);
      (cat.subcategories || []).forEach((sub) => {
        const subTarget = subcategoryDisplayTarget(cat, sub, source, catKg, targetsDoc);
        anySub = true;
        y = bodyText(pdf, y, `${sub.name} (${cat.name}): ${subTarget != null ? round2(subTarget) + ' kg' : '–'}`, { size: 9 });
      });
    });
  });
  if (!anySub) y = bodyText(pdf, y, 'Keine Unterkategorien vorhanden.');

  y = spacer(y);
  y = subheading(pdf, y, 'Produktziele');
  const productIds = Object.keys(targetsDoc.products || {});
  if (productIds.length === 0) {
    y = bodyText(pdf, y, 'Keine Produktziele vorhanden.');
  } else {
    productIds.forEach((id) => {
      const product = productIndex.get(id);
      if (!product) return;
      const target = targetsDoc.products[id];
      y = bodyText(pdf, y, `${product.name}: ${round2(computeAmount(target))} ${unitLabelFor(target.unit)}`, { size: 9 });
    });
  }
}

// --- Orchestration ---------------------------------------------------------

const SECTION_ORDER = ['dashboard', 'stock', 'maintenance', 'crisis', 'contacts', 'notes', 'recipes', 'targets'];
const SECTION_BUILDERS = {
  dashboard: buildDashboardSection,
  stock: buildStockSection,
  maintenance: buildMaintenanceSection,
  crisis: buildCrisisSection,
  contacts: buildContactsSection,
  notes: buildNotesSection,
  recipes: buildRecipesSection,
  targets: buildTargetsSection,
};

createBtn.addEventListener('click', async () => {
  const active = SECTION_ORDER.filter((id) => document.getElementById(`pdf-section-${id}`)?.checked);
  if (active.length === 0) {
    statusEl.textContent = 'Bitte mindestens einen Abschnitt auswählen.';
    return;
  }
  createBtn.disabled = true;
  statusEl.textContent = 'Erstelle PDF…';
  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    let first = true;
    for (const id of active) {
      if (!first) pdf.addPage();
      first = false;
      await SECTION_BUILDERS[id](pdf);
    }
    pdf.save(`erdkeller-pdf-${todayStamp()}.pdf`);
    statusEl.textContent = '';
  } catch (err) {
    statusEl.textContent = 'PDF-Erstellung fehlgeschlagen: ' + err.message;
    console.error(err);
  } finally {
    createBtn.disabled = false;
  }
});
