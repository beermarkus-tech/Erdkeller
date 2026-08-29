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
import { db } from './firebase-init.js?v=124';
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
// blank (never today's checked/due state). Each item is a fixed-height
// cell with the text vertically centered inside it (cellPad above/below
// the text block) and the gray rule drawn at the cell's own bottom edge —
// so the line sits below the text's descenders instead of cutting
// through it, and the next item's text starts with equal padding below
// that same line.
function checkboxLine(pdf, y, text, meta) {
  const lineStep = LINE_H - 1;
  const cellPad = 2.4;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  const lines = pdf.splitTextToSize(text, CONTENT_W - 6);
  const rowH = lines.length * lineStep + cellPad * 2;
  y = ensure(pdf, y, rowH);
  const rowTop = y;
  const baseline = rowTop + cellPad + lineStep * 0.8;
  pdf.rect(MARGIN, baseline - 3, 3.5, 3.5);
  lines.forEach((line, li) => {
    pdf.text(line, MARGIN + 6, baseline + li * lineStep);
  });
  if (meta) {
    pdf.setFontSize(8.5);
    const metaW = pdf.getTextWidth(meta);
    pdf.text(meta, MARGIN + CONTENT_W - metaW, baseline);
    pdf.setFontSize(10);
  }
  y = rowTop + rowH;
  pdf.setDrawColor(210);
  pdf.setLineWidth(0.15);
  pdf.line(MARGIN, y, MARGIN + CONTENT_W, y);
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.2);
  return y;
}

// One numbered crisis step — bigger type, a bold number, vertically
// centered within its own cell (same fixed-cell-then-rule-at-the-bottom
// shape as checkboxLine above), plus a few mm of extra air after the rule
// before the next step starts. Meant to work as an actual checklist
// glanced at under stress, not a dense paragraph.
function crisisStep(pdf, y, index, text) {
  const stepLineH = 6.5;
  const cellPad = 3;
  const numText = `${index}.`;
  const numWidth = 9;
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'normal');
  const lines = pdf.splitTextToSize(text, CONTENT_W - numWidth);
  const rowH = lines.length * stepLineH + cellPad * 2;
  y = ensure(pdf, y, rowH + 3);
  const rowTop = y;
  const baseline = rowTop + cellPad + stepLineH * 0.75;
  pdf.setFont('helvetica', 'bold');
  pdf.text(numText, MARGIN, baseline);
  pdf.setFont('helvetica', 'normal');
  lines.forEach((line, li) => {
    pdf.text(line, MARGIN + numWidth, baseline + li * stepLineH);
  });
  y = rowTop + rowH;
  pdf.setDrawColor(190);
  pdf.setLineWidth(0.2);
  pdf.line(MARGIN, y, MARGIN + CONTENT_W, y);
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.2);
  pdf.setFontSize(10);
  return y + 3;
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

// jsPDF's own fonts have no emoji glyphs at all (WinAnsi encoding), so a
// taxonomy/crisis-type symbol like 🥫 or ⚡ can never render as PDF text —
// there's no vector outline for it in any font jsPDF can embed. Instead,
// rasterize the character through a plain <canvas> (the browser's own
// text renderer DOES draw full-color emoji there, same glyphs the app
// itself shows on screen) and embed the result as a small PNG. Cached by
// character since the same handful of symbols repeat throughout a
// document.
const symbolImageCache = new Map();
function symbolImageDataUrl(char) {
  if (!char) return null;
  if (symbolImageCache.has(char)) return symbolImageCache.get(char);
  let url = null;
  try {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.font = `${Math.round(size * 0.78)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(char, size / 2, size / 2 + size * 0.04);
    url = canvas.toDataURL('image/png');
  } catch (err) {
    url = null;
  }
  symbolImageCache.set(char, url);
  return url;
}

// A subheading with an optional small symbol icon to its left (rendered
// via symbolImageDataUrl above) — used by the Krise section for each
// crisis type's own icon, the same way the live crisis-type list shows it.
function subheadingWithIcon(pdf, y, sym, text) {
  y = ensure(pdf, y, LINE_H * 1.6);
  const img = sym ? symbolImageDataUrl(sym) : null;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text(text, MARGIN + (img ? 7 : 0), y);
  if (img) pdf.addImage(img, 'PNG', MARGIN, y - 4.2, 5, 5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  return y + LINE_H * 1.6;
}

// A flat-color progress bar: a light gray track the full column width,
// with a colored fill representing pct (0-100), plus a thin outline —
// the PDF equivalent of the app's own .dash-cat-bar-fill/.dash-hero-bar.
function drawBar(pdf, x, y, w, h, pct, color) {
  pdf.setDrawColor(180);
  pdf.setLineWidth(0.15);
  pdf.setFillColor(230, 230, 230);
  pdf.rect(x, y, w, h, 'FD');
  const fillW = (Math.max(0, Math.min(100, pct)) / 100) * w;
  if (fillW > 0.3) {
    pdf.setFillColor(color[0], color[1], color[2]);
    pdf.rect(x, y, fillW, h, 'F');
  }
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.2);
}

// Wrapping table: columns = [{header, width, align, icon(row), get(row)}],
// widths in mm, align: 'right' for numeric columns, icon(row) an optional
// getter returning a symbol character to render before the first line of
// that cell (left-aligned columns only). Each row is a fixed-height cell
// with its text block vertically centered inside (cellPad above/below),
// and the gray rule drawn at the cell's own bottom edge — so it never
// cuts through the row's own text or the next row's. The header row
// redraws itself whenever a row's own page break lands it on a fresh
// page, checked via jsPDF's own page count rather than guessing.
function table(pdf, y, columns, rows) {
  const tableWidth = columns.reduce((s, c) => s + c.width, 0);
  const lineStep = LINE_H - 1;
  const cellPad = 2.4;

  function textX(col, x, text) {
    return col.align === 'right' ? x + col.width - 2 - pdf.getTextWidth(text) : x;
  }

  function grayLine(yy) {
    pdf.setDrawColor(190);
    pdf.setLineWidth(0.2);
    pdf.line(MARGIN, yy, MARGIN + tableWidth, yy);
    pdf.setDrawColor(0);
    pdf.setLineWidth(0.2);
  }

  function drawHeader(rowTop) {
    const rowH = lineStep + cellPad * 2;
    const baseline = rowTop + cellPad + lineStep * 0.8;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    let x = MARGIN;
    columns.forEach((col) => {
      pdf.text(col.header, textX(col, x, col.header), baseline);
      x += col.width;
    });
    grayLine(rowTop + rowH);
    pdf.setFont('helvetica', 'normal');
    return rowTop + rowH;
  }

  y = ensure(pdf, y, lineStep + cellPad * 2 + 2);
  y = drawHeader(y);

  rows.forEach((row) => {
    const cellLines = columns.map((col) => pdf.splitTextToSize(String(col.get(row) ?? ''), col.width - 2));
    const rowLines = Math.max(...cellLines.map((l) => l.length), 1);
    const rowH = rowLines * lineStep + cellPad * 2;
    const pageBefore = pdf.internal.getNumberOfPages();
    y = ensure(pdf, y, rowH);
    if (pdf.internal.getNumberOfPages() !== pageBefore) y = drawHeader(y);

    const rowTop = y;
    const baseline = rowTop + cellPad + lineStep * 0.8;
    let x = MARGIN;
    pdf.setFontSize(9);
    columns.forEach((col, i) => {
      let tx0 = x;
      if (col.icon) {
        const sym = col.icon(row);
        const img = sym ? symbolImageDataUrl(sym) : null;
        if (img) {
          pdf.addImage(img, 'PNG', x, baseline - 3.2, 3.6, 3.6);
          tx0 += 5;
        }
      }
      cellLines[i].forEach((line, li) => {
        const tx = li === 0 ? tx0 : x;
        pdf.text(line, col.align === 'right' ? textX(col, x, line) : tx, baseline + li * lineStep);
      });
      x += col.width;
    });
    y = rowTop + rowH;
    grayLine(y);
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

// Same thresholds and colors as js/dashboard.js's own stateFor/CSS
// (--ok/--warn/--danger) — converted to RGB triples for jsPDF's
// setFillColor, which has no notion of CSS custom properties.
function stateFor(p, hasTarget = true) {
  if (!hasTarget) return 'none';
  if (p >= 100) return 'ok';
  if (p >= 60) return 'warn';
  return 'danger';
}

function stateColor(state) {
  if (state === 'ok') return [74, 107, 79];
  if (state === 'warn') return [184, 99, 47];
  if (state === 'danger') return [156, 59, 46];
  return [190, 190, 190];
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

// --- Übersicht's graphical rows -----------------------------------------
// Mirrors the live dashboard's own hero cards and category cards
// (js/dashboard.js's renderHero/renderCategoryList) as an actual bar
// graphic rather than plain text, per Markus's request — same color
// thresholds, same current/target figures, right-aligned.

function drawTotalBar(pdf, y, current, target) {
  y = ensure(pdf, y, 10);
  const p = pct(current, target);
  const state = stateFor(p, target != null && target > 0);
  const figText = `${round2(current)} / ${round2(target)} kg (${Math.round(p)} %)`;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  const figW = pdf.getTextWidth(figText);
  pdf.text(figText, MARGIN + CONTENT_W - figW, y);
  pdf.setFont('helvetica', 'normal');
  drawBar(pdf, MARGIN, y + 1.5, CONTENT_W, 4, p, stateColor(state));
  return y + 9;
}

// One category/subcategory row: icon, name, a bar, current/target kg
// right-aligned, and a gray rule at the row's own bottom edge (same
// fixed-cell-then-rule shape as table()/checkboxLine/crisisStep above).
function categoryGraphRow(pdf, y, sym, name, current, target, isCategory) {
  const indent = isCategory ? 0 : 6;
  const iconSize = isCategory ? 4.5 : 3.6;
  const rowH = isCategory ? 13 : 9.5;
  y = ensure(pdf, y, rowH);
  const rowTop = y;
  const textY = rowTop + (isCategory ? 5 : 4.2);
  const textX0 = MARGIN + indent + (sym ? iconSize + 1.5 : 0);

  const img = sym ? symbolImageDataUrl(sym) : null;
  if (img) pdf.addImage(img, 'PNG', MARGIN + indent, textY - iconSize + 1.2, iconSize, iconSize);

  pdf.setFont('helvetica', isCategory ? 'bold' : 'normal');
  pdf.setFontSize(isCategory ? 10.5 : 9);
  pdf.text(name, textX0, textY);

  const p = pct(current, target);
  const state = stateFor(p, target != null);
  const figText = `${round2(current)} / ${round2(target)} kg`;
  pdf.setFontSize(isCategory ? 9 : 8);
  const figW = pdf.getTextWidth(figText);
  pdf.text(figText, MARGIN + CONTENT_W - figW, textY);

  const barY = textY + 1.6;
  const barX = textX0;
  const barW = MARGIN + CONTENT_W - textX0;
  drawBar(pdf, barX, barY, barW, isCategory ? 3 : 2.2, p, stateColor(state));

  y = rowTop + rowH;
  pdf.setDrawColor(200);
  pdf.setLineWidth(0.15);
  pdf.line(MARGIN, y, MARGIN + CONTENT_W, y);
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.2);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  return y;
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
  y = drawTotalBar(pdf, y, currentKgAll, targetKgAll);
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
      y = drawTotalBar(pdf, y, waterCurrent, waterTarget);
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
    y = categoryGraphRow(pdf, y, row.cat.sym, row.cat.name, row.currentKg, row.targetKg, true);
    row.subs.forEach(({ sub, targetKg, currentKg }) => {
      if (targetKg == null) return;
      y = categoryGraphRow(pdf, y, sub.sym, sub.name, currentKg, targetKg, false);
    });
  });

  // Own page, per Markus's request — MHD-Alarme and Einkaufsliste each
  // read as their own report, not a continuation of the Kategorien graphs.
  pdf.addPage();
  y = MARGIN;
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

  pdf.addPage();
  y = MARGIN;
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
      y = table(pdf, y, [
        { header: 'Artikel', width: 130, get: (r) => r.name },
        { header: 'Fehlt', width: 50, align: 'right', get: (r) => formatShoppingNeed(r) },
      ], items);
      y = spacer(y, 0.5);
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
    { header: 'Menge', width: 15, align: 'right', get: (r) => r.quantity },
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
    y = subheadingWithIcon(pdf, y, type.sym, type.name || '');
    (type.steps || []).forEach((step, i) => {
      y = crisisStep(pdf, y, i + 1, step.text || '');
    });
    y = spacer(y, 1.2);
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
    y = spacer(y, 0.6);
    y = ensure(pdf, y, 3);
    pdf.setDrawColor(190);
    pdf.setLineWidth(0.2);
    pdf.line(MARGIN, y, MARGIN + CONTENT_W, y);
    pdf.setDrawColor(0);
    pdf.setLineWidth(0.2);
    y = spacer(y, 0.8);
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
  recipes.forEach((recipe, i) => {
    if (i > 0) {
      pdf.addPage();
      y = MARGIN;
    }
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

  const ZIELE_COLS = (nameHeader) => [
    { header: nameHeader, width: 130, icon: (r) => r.sym, get: (r) => r.name },
    { header: 'Ziel', width: 50, align: 'right', get: (r) => r.target },
  ];

  const catRows = [];
  taxonomy.types.forEach((type) => {
    if (typeClass(type) !== 'food') return;
    (type.categories || []).forEach((cat) => {
      const source = categoryTargetSource(type, cat, macroGroupIds, household, planning, targetsDoc);
      const targetKg = categoryDisplayTarget(cat, source, targetsDoc);
      catRows.push({ name: cat.name, sym: cat.sym, target: targetKg != null ? `${round2(targetKg)} kg` : '–' });
    });
  });
  y = subheading(pdf, y, 'Kategorien');
  if (catRows.length === 0) {
    y = bodyText(pdf, y, 'Keine Kategorien vorhanden.');
  } else {
    y = table(pdf, y, ZIELE_COLS('Kategorie'), catRows);
  }

  y = spacer(y);
  const subRows = [];
  taxonomy.types.forEach((type) => {
    if (typeClass(type) !== 'food') return;
    (type.categories || []).forEach((cat) => {
      const source = categoryTargetSource(type, cat, macroGroupIds, household, planning, targetsDoc);
      const catKg = categoryDisplayTarget(cat, source, targetsDoc);
      (cat.subcategories || []).forEach((sub) => {
        const subTarget = subcategoryDisplayTarget(cat, sub, source, catKg, targetsDoc);
        subRows.push({
          name: `${sub.name} (${cat.name})`, sym: sub.sym, target: subTarget != null ? `${round2(subTarget)} kg` : '–',
        });
      });
    });
  });
  y = subheading(pdf, y, 'Unterkategorien');
  if (subRows.length === 0) {
    y = bodyText(pdf, y, 'Keine Unterkategorien vorhanden.');
  } else {
    y = table(pdf, y, ZIELE_COLS('Unterkategorie'), subRows);
  }

  y = spacer(y);
  const productIds = Object.keys(targetsDoc.products || {});
  const prodRows = [];
  productIds.forEach((id) => {
    const product = productIndex.get(id);
    if (!product) return;
    const target = targetsDoc.products[id];
    prodRows.push({ name: product.name, target: `${round2(computeAmount(target))} ${unitLabelFor(target.unit)}` });
  });
  y = subheading(pdf, y, 'Produktziele');
  if (prodRows.length === 0) {
    y = bodyText(pdf, y, 'Keine Produktziele vorhanden.');
  } else {
    table(pdf, y, ZIELE_COLS('Produkt'), prodRows);
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
