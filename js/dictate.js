// Diktieren — WhatsApp-style chat for voice check-in. This is a new,
// standalone full-screen modal (closest in spirit to Notizen/Rezepte's
// view modal), not another step inside js/stock-checkin.js's guided-flow
// wizard — so it keeps its own Firestore reads for taxonomy/products/
// storageLocations/yearColorMap rather than reaching into that file's
// private module state, per this codebase's established "duplicate
// rather than share" convention (js/dashboard.js's own header comment is
// the clearest statement of why).
//
// Flow: mic → Web Speech API transcript → one Cloud Function call
// (parseDictation, functions/index.js) that extracts a list of batch
// lines from the transcript, matching each against the existing product
// catalog or suggesting a subcategory for anything new → rendered as one
// proposal bubble per dictation turn, each line tappable to correct via
// the edit sheet → "Registrieren" writes every line through the same
// /products (if new) + /stockItems + /stockLog shape js/stock-checkin.js's
// own confirm handler already uses.
import { db, functions } from './firebase-init.js?v=133';
import {
  collection, getDocs, doc, getDoc, addDoc, setDoc, deleteDoc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";

const startBtn = document.getElementById('start-dictate-btn');
const modal = document.getElementById('dictate-modal');
const closeBtn = document.getElementById('dictate-close-btn');
const chatEl = document.getElementById('dictate-chat');
const liveEl = document.getElementById('dictate-live');
const hintEl = document.getElementById('dictate-hint');
const micBtn = document.getElementById('dictate-mic-btn');

const editModal = document.getElementById('dictate-edit-modal');
const editSheetEl = document.querySelector('#dictate-edit-modal .dictate-edit-sheet');
const editTitleEl = document.getElementById('dictate-edit-title');
const editTypeSelect = document.getElementById('dictate-edit-type-select');
const editCategorySelect = document.getElementById('dictate-edit-category-select');
const editSubcategoryGroup = document.getElementById('dictate-edit-subcategory-group');
const editSubcategorySelect = document.getElementById('dictate-edit-subcategory-select');
const editNameInput = document.getElementById('dictate-edit-name');
const editUnitToggle = document.getElementById('dictate-edit-unit-toggle');
const editUnitButtons = editUnitToggle.querySelectorAll('.unit-btn');
const editBatchSelect = document.getElementById('dictate-edit-batch-select');
const editQtyLabel = document.getElementById('dictate-edit-qty-label');
const editQtyNum = document.getElementById('dictate-edit-qty-num');
const editQtyMinus = document.getElementById('dictate-edit-qty-minus');
const editQtyPlus = document.getElementById('dictate-edit-qty-plus');
const editDetailsInput = document.getElementById('dictate-edit-details');
const editContentGroup = document.getElementById('dictate-edit-content-group');
const editContentInput = document.getElementById('dictate-edit-content');
const editBestBeforeInput = document.getElementById('dictate-edit-bestbefore-input');
const editStorageSelect = document.getElementById('dictate-edit-storage-select');
const editApplyBtn = document.getElementById('dictate-edit-apply-btn');

// --- Config state — own reads, own copies (see file header) -------------

let taxonomy = { types: [] };
let allProducts = [];
let productIndex = new Map();
let subcategoryIndex = new Map(); // subcategoryId -> { type, category, subcategory }
let allBatches = [];
let batchIndex = new Map(); // batchId -> stockItems doc (incl. id)
let targets = { products: {} };
let storageLocations = [];
let yearColorMap = {};
let loadOk = false;

function typeClass(type) {
  if (type.typeClass) return type.typeClass;
  return type.isFoodType ? 'food' : 'other';
}

function buildSubcategoryIndex() {
  subcategoryIndex = new Map();
  taxonomy.types.forEach((type) => {
    (type.categories || []).forEach((cat) => {
      (cat.subcategories || []).forEach((sub) => {
        subcategoryIndex.set(sub.id, { type, category: cat, subcategory: sub });
      });
    });
  });
}

async function loadConfig() {
  try {
    const [taxSnap, productsSnap, storeSnap, colorSnap, batchesSnap, targetsSnap] = await Promise.all([
      getDoc(doc(db, 'config', 'taxonomy')),
      getDocs(collection(db, 'products')),
      getDoc(doc(db, 'config', 'storageLocations')),
      getDoc(doc(db, 'config', 'yearColorMap')),
      getDocs(collection(db, 'stockItems')),
      getDoc(doc(db, 'config', 'targets')),
    ]);
    taxonomy = taxSnap.exists() && Array.isArray(taxSnap.data().types) ? taxSnap.data() : { types: [] };
    allProducts = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    productIndex = new Map(allProducts.map((p) => [p.id, p]));
    storageLocations = storeSnap.exists() && Array.isArray(storeSnap.data().locations) ? storeSnap.data().locations : [];
    yearColorMap = colorSnap.exists() ? colorSnap.data() : {};
    allBatches = batchesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    batchIndex = new Map(allBatches.map((b) => [b.id, b]));
    targets = targetsSnap.exists() ? targetsSnap.data() : { products: {} };
    if (!targets.products) targets.products = {};
    buildSubcategoryIndex();
    loadOk = true;
  } catch (err) {
    loadOk = false;
    console.error(err);
  }
}

window.addEventListener('erdkeller:signedin', () => loadConfig());
window.addEventListener('erdkeller:refresh', () => loadConfig());

// --- Small duplicated helpers (mirrors js/stock-checkin.js's own) -------

function normalizeContent(raw) {
  const trimmed = (raw || '').trim();
  return /^\d+([.,]\d+)?$/.test(trimmed) ? trimmed + 'g' : trimmed;
}

function productName(productId) {
  return (productIndex.get(productId) || {}).name || '(unbekanntes Produkt)';
}

function clampQty(n, max) {
  const v = Number.isFinite(n) ? n : 1;
  return Math.min(max, Math.max(1, v));
}

function batchMetaLine(batch) {
  const parts = [`${batch.quantity}×`];
  if (batch.content) parts.push(batch.content);
  if (batch.bestBefore) parts.push('MHD ' + batch.bestBefore);
  if (batch.storage) parts.push(batch.storage);
  return parts.join(' · ');
}

function yearColorFor(bestBefore) {
  if (!bestBefore) return 'none';
  const year = bestBefore.split('/')[1];
  return (yearColorMap && yearColorMap[year]) || 'none';
}

function bestBeforeToMonthInput(bb) {
  if (!bb) return '';
  const [mm, yyyy] = bb.split('/');
  if (!mm || !yyyy) return '';
  return `${yyyy}-${mm}`;
}

function monthInputToBestBefore(v) {
  if (!v) return '';
  const [yyyy, mm] = v.split('-');
  if (!mm || !yyyy) return '';
  return `${mm}/${yyyy}`;
}

// --- Modal open/close -----------------------------------------------------

function setHint(text) {
  hintEl.textContent = text;
}

function scrollChatToBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

function openDictateModal() {
  if (!loadOk) {
    loadConfig();
  }
  chatEl.innerHTML = '';
  liveEl.classList.add('hidden');
  liveEl.textContent = '';
  setHint('Zum Sprechen tippen');
  modal.classList.add('show');
}

function closeDictateModal() {
  stopRecording();
  modal.classList.remove('show');
}

startBtn.addEventListener('click', openDictateModal);
closeBtn.addEventListener('click', closeDictateModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeDictateModal(); });

// --- Web Speech API wrapper -------------------------------------------

const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
let recording = false;
let stopRequested = false;
let accumulatedTranscript = '';

// Android Chrome's continuous mode has a long-standing bug: it
// periodically re-finalizes the *whole* utterance heard so far as a
// brand-new "final" result instead of just the new words, so anything
// that sums every final result across the session snowballs into
// duplicated text ("zehn zehn Gläser zehn Gläser..."). continuous:false
// sessions are reliable — each one ends cleanly after a single utterance
// with exactly one final result — so we chain sessions manually
// (restarting in onend) to keep listening across pauses without ever
// enabling continuous mode.
function runRecognitionSession() {
  recognizer = new SpeechRecognitionCtor();
  recognizer.lang = 'de-DE';
  recognizer.continuous = false;
  recognizer.interimResults = true;

  let sessionFinal = '';

  recognizer.onresult = (event) => {
    let final = '';
    let interim = '';
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        final += result[0].transcript;
      } else {
        interim += result[0].transcript;
      }
    }
    sessionFinal = final;
    liveEl.textContent = (accumulatedTranscript + ' ' + final + ' ' + interim).trim();
  };

  recognizer.onerror = (event) => {
    console.error('SpeechRecognition error', event.error);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      stopRequested = true;
      resetMicUi();
      appendErrorBubbleSimple('Mikrofon-Zugriff wurde verweigert — bitte in den Browser-Einstellungen erlauben.');
    }
    // Other errors (e.g. no-speech during a pause between items) are left
    // to onend, which restarts the next session automatically.
  };

  recognizer.onend = () => {
    if (sessionFinal) {
      accumulatedTranscript = (accumulatedTranscript + ' ' + sessionFinal).trim();
    }
    if (stopRequested) {
      resetMicUi();
      const text = accumulatedTranscript.trim();
      accumulatedTranscript = '';
      if (text) handleTranscript(text);
    } else {
      runRecognitionSession();
    }
  };

  try {
    recognizer.start();
  } catch (err) {
    console.error(err);
    stopRequested = true;
    resetMicUi();
  }
}

function startRecording() {
  if (!SpeechRecognitionCtor) {
    appendErrorBubbleSimple('Spracherkennung wird auf diesem Gerät/Browser nicht unterstützt.');
    return;
  }
  if (recording) return;

  recording = true;
  stopRequested = false;
  accumulatedTranscript = '';
  micBtn.classList.add('recording');
  setHint('Höre zu… nochmal tippen zum Beenden');
  liveEl.classList.remove('hidden');
  liveEl.textContent = '';

  runRecognitionSession();
}

function resetMicUi() {
  recording = false;
  micBtn.classList.remove('recording');
  liveEl.classList.add('hidden');
  setHint('Zum Sprechen tippen');
}

function stopRecording() {
  if (recognizer && recording) {
    stopRequested = true;
    recognizer.stop();
  }
}

micBtn.addEventListener('click', () => {
  if (recording) {
    stopRecording();
  } else {
    startRecording();
  }
});

// --- Cloud Function call + line resolution -------------------------------

const parseDictationFn = httpsCallable(functions, 'parseDictation');

function normalizeQty(q) {
  const n = Math.round(Number(q));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function normalizeBestBefore(v) {
  if (typeof v !== 'string') return '';
  const m = v.trim().match(/^(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  return `${m[1].padStart(2, '0')}/${m[2]}`;
}

function resolveStorage(v) {
  // Empty when not dictated, rather than silently guessing the first
  // storage location — a wrong silent guess is worse than an explicit
  // "missing" flag the proposal line surfaces for the user to fill in.
  if (typeof v !== 'string' || !v.trim()) return '';
  const q = v.trim().toLowerCase();
  const match = storageLocations.find((loc) => {
    const lq = loc.toLowerCase();
    return lq === q || lq.includes(q) || q.includes(lq);
  });
  return match || '';
}

function breadcrumbFieldsFor(subcategoryId) {
  const ctx = contextFor(subcategoryId);
  return {
    subcategoryId: subcategoryId || null,
    typeName: ctx ? ctx.type.name : '',
    typeSym: ctx ? ctx.type.sym : '',
    categoryName: ctx ? ctx.category.name : '',
    categorySym: ctx ? ctx.category.sym : '',
    subcategoryName: ctx ? ctx.subcategory.name : '',
    subcategorySym: ctx ? ctx.subcategory.sym : '',
  };
}

function contextFor(subcategoryId) {
  return subcategoryId ? subcategoryIndex.get(subcategoryId) : null;
}

function resolveLine(item) {
  if (item && item.direction === 'out') {
    const batch = batchIndex.get(item.matchedBatchId);
    if (!batch) {
      // Genuinely nothing in stock matched — shown as its own "not
      // available" row rather than silently dropped, so the user sees
      // their dictation was heard even though there's nothing to act on.
      return {
        direction: 'out',
        unresolved: true,
        name: (item.attemptedName && String(item.attemptedName).trim()) || 'Unbekanntes Produkt',
      };
    }
    const product = productIndex.get(batch.productId);
    return {
      direction: 'out',
      batchId: batch.id,
      productId: batch.productId,
      name: productName(batch.productId),
      content: batch.content || '',
      bestBefore: batch.bestBefore || '',
      storage: batch.storage || '',
      batchQuantity: batch.quantity,
      removeQty: clampQty(normalizeQty(item.quantity), batch.quantity),
      confidence: item.confidence === 'medium' || item.confidence === 'low' ? item.confidence : 'high',
      ...breadcrumbFieldsFor(product ? product.subcategoryId : null),
    };
  }
  if (item && item.matchedProductId) {
    const product = productIndex.get(item.matchedProductId);
    if (!product) return null; // stale/unknown id from the model — skip defensively
    const ctx = contextFor(product.subcategoryId);
    return {
      direction: 'in',
      isNew: false,
      productId: product.id,
      name: product.name,
      unitType: product.unitType,
      subcategoryId: product.subcategoryId || null,
      typeName: ctx ? ctx.type.name : '',
      typeSym: ctx ? ctx.type.sym : '',
      categoryName: ctx ? ctx.category.name : '',
      categorySym: ctx ? ctx.category.sym : '',
      subcategoryName: ctx ? ctx.subcategory.name : '',
      subcategorySym: ctx ? ctx.subcategory.sym : '',
      quantity: normalizeQty(item.quantity),
      content: (item.content || '').trim(),
      details: '',
      bestBefore: normalizeBestBefore(item.bestBefore),
      storage: resolveStorage(item.storage),
    };
  }
  if (item && item.newProductName) {
    const ctx = contextFor(item.suggestedSubcategoryId);
    const unitType = item.guessedUnitType === 'l' || item.guessedUnitType === 'stueck' ? item.guessedUnitType : 'kg';
    return {
      direction: 'in',
      isNew: true,
      productId: null,
      name: String(item.newProductName).trim(),
      unitType,
      subcategoryId: ctx ? ctx.subcategory.id : null,
      typeName: ctx ? ctx.type.name : '',
      typeSym: ctx ? ctx.type.sym : '',
      categoryName: ctx ? ctx.category.name : '',
      categorySym: ctx ? ctx.category.sym : '',
      subcategoryName: ctx ? ctx.subcategory.name : '',
      subcategorySym: ctx ? ctx.subcategory.sym : '',
      quantity: normalizeQty(item.quantity),
      content: (item.content || '').trim(),
      details: '',
      bestBefore: normalizeBestBefore(item.bestBefore),
      storage: resolveStorage(item.storage),
    };
  }
  return null;
}

// --- Manual direction override (the AI's in/out call is a guess; this is
// the escape hatch for when it guessed wrong) -----------------------------

function canToggleDirection(line) {
  if (line.unresolved) return false; // nothing found — no batch/product to toggle from
  if (line.direction === 'out') return true; // out -> in is always possible
  if (line.isNew || !line.productId) return false; // nothing to check out yet
  return allBatches.some((b) => b.productId === line.productId);
}

function toggleLineDirection(line) {
  if (line.direction === 'out') {
    const product = productIndex.get(line.productId);
    const ctx = product ? contextFor(product.subcategoryId) : null;
    return {
      direction: 'in',
      isNew: false,
      productId: line.productId,
      name: line.name,
      unitType: product ? product.unitType : 'kg',
      subcategoryId: product ? (product.subcategoryId || null) : null,
      typeName: ctx ? ctx.type.name : '',
      typeSym: ctx ? ctx.type.sym : '',
      categoryName: ctx ? ctx.category.name : '',
      categorySym: ctx ? ctx.category.sym : '',
      subcategoryName: ctx ? ctx.subcategory.name : '',
      subcategorySym: ctx ? ctx.subcategory.sym : '',
      quantity: line.removeQty,
      content: line.content || '',
      details: '',
      bestBefore: line.bestBefore || '',
      storage: line.storage || '',
    };
  }

  if (!canToggleDirection(line)) return line; // toggle button is disabled in this case anyway
  const candidates = allBatches.filter((b) => b.productId === line.productId);
  const batch = candidates.find((b) => b.content === line.content) || candidates[0];
  return {
    direction: 'out',
    batchId: batch.id,
    productId: batch.productId,
    name: productName(batch.productId),
    content: batch.content || '',
    bestBefore: batch.bestBefore || '',
    storage: batch.storage || '',
    batchQuantity: batch.quantity,
    removeQty: clampQty(line.quantity, batch.quantity),
    confidence: 'high', // manually chosen — no need to flag
    ...breadcrumbFieldsFor(batch.productId ? (productIndex.get(batch.productId) || {}).subcategoryId : null),
  };
}

async function handleTranscript(transcript) {
  appendUserBubble(transcript);
  const pendingBubble = appendPendingBubble('Analysiere…');

  let items = [];
  try {
    const result = await parseDictationFn({ transcript });
    items = (result.data && Array.isArray(result.data.items)) ? result.data.items : [];
  } catch (err) {
    console.error(err);
    pendingBubble.remove();
    appendErrorBubble('Verbindung zur Erkennung fehlgeschlagen.', transcript);
    return;
  }

  pendingBubble.remove();
  const lines = items.map(resolveLine).filter(Boolean);
  if (lines.length === 0) {
    appendErrorBubble('Das habe ich nicht verstanden.', transcript);
    return;
  }
  appendProposalBubble(lines);
}

// --- Chat bubble rendering -----------------------------------------------

function appendUserBubble(text) {
  const div = document.createElement('div');
  div.className = 'dictate-bubble user';
  div.textContent = text;
  chatEl.appendChild(div);
  scrollChatToBottom();
}

function appendPendingBubble(text) {
  const div = document.createElement('div');
  div.className = 'dictate-bubble app pending';
  div.textContent = text;
  chatEl.appendChild(div);
  scrollChatToBottom();
  return div;
}

function appendErrorBubbleSimple(message) {
  const div = document.createElement('div');
  div.className = 'dictate-bubble app error';
  div.textContent = message;
  chatEl.appendChild(div);
  scrollChatToBottom();
}

function appendErrorBubble(message, transcript) {
  const div = document.createElement('div');
  div.className = 'dictate-bubble app error';
  const p = document.createElement('div');
  p.textContent = message;
  div.appendChild(p);
  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = 'select-mode-btn dictate-retry-btn';
  retryBtn.textContent = 'Nochmal versuchen';
  retryBtn.addEventListener('click', () => {
    retryBtn.disabled = true;
    handleTranscript(transcript);
  });
  div.appendChild(retryBtn);
  chatEl.appendChild(div);
  scrollChatToBottom();
}

async function undoTurn(records) {
  for (const rec of records) {
    await setDoc(doc(db, 'stockItems', rec.batchId), rec.originalBatch);
    if (rec.deletedProduct) {
      const { id, ...productData } = rec.deletedProduct;
      await setDoc(doc(db, 'products', id), productData);
    }
    await deleteDoc(doc(db, 'stockLog', rec.stockLogId));
  }
  window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
}

function appendConfirmationBubble(result) {
  const div = document.createElement('div');
  div.className = 'dictate-bubble app confirmation';

  if (!result.inSummaries.length && !result.outSummaries.length) {
    div.textContent = 'Nichts zu registrieren — alle Zeilen waren nicht auflösbar.';
    chatEl.appendChild(div);
    scrollChatToBottom();
    return;
  }

  if (result.inSummaries.length) {
    const p = document.createElement('div');
    p.className = 'dictate-confirmation-line';
    p.textContent = '✅ Eingelagert: ' + result.inSummaries.join(', ');
    div.appendChild(p);
  }
  if (result.outSummaries.length) {
    const p = document.createElement('div');
    p.className = 'dictate-confirmation-line';
    p.textContent = '➖ Entnommen: ' + result.outSummaries.join(', ');
    div.appendChild(p);
  }
  if (result.undoRecords.length) {
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'dictate-undo-btn';
    undoBtn.textContent = '↩ Rückgängig';
    undoBtn.addEventListener('click', async () => {
      undoBtn.disabled = true;
      try {
        await undoTurn(result.undoRecords);
        undoBtn.textContent = 'Rückgängig gemacht';
      } catch (err) {
        console.error(err);
        undoBtn.disabled = false;
        undoBtn.textContent = '↩ Rückgängig';
        appendErrorBubbleSimple('Rückgängig machen fehlgeschlagen: ' + err.message);
      }
    });
    div.appendChild(undoBtn);
  }

  chatEl.appendChild(div);
  scrollChatToBottom();
}

function lineBreadcrumb(line) {
  return [line.typeName, line.categoryName, line.subcategoryName].filter(Boolean).join(' › ');
}

function renderProposalLine(line, onTap, onToggle) {
  const row = document.createElement('div');
  row.className = 'dictate-proposal-line'
    + (line.direction === 'out' ? ' out' : '')
    + (line.unresolved ? ' unresolved' : '');

  if (!line.unresolved) {
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    // Same color+symbol language as the two big Einlagern/Entnehmen
    // buttons on the Bestand home screen (.big-btn.in/.out) — this button
    // shows the line's CURRENT direction (green ⬇ = wird eingelagert,
    // rust ⬆ = wird entnommen) and flips it on tap, so it doubles as a
    // state indicator, not just a control.
    toggleBtn.className = 'dictate-line-toggle' + (line.direction === 'out' ? ' out' : '');
    toggleBtn.textContent = line.direction === 'out' ? '⬆' : '⬇';
    const toggleDisabled = line.direction === 'in' && !canToggleDirection(line);
    toggleBtn.disabled = toggleDisabled;
    toggleBtn.title = toggleDisabled
      ? 'Kein Bestand dieses Produkts vorhanden'
      : (line.direction === 'out' ? 'Entnehmen — antippen für Einlagern' : 'Einlagern — antippen für Entnehmen');
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onToggle();
    });
    row.appendChild(toggleBtn);
  }

  const content = document.createElement('div');
  content.className = 'dictate-line-content';
  row.appendChild(content);

  if (line.unresolved) {
    const mainEl = document.createElement('div');
    mainEl.className = 'dictate-line-main';
    mainEl.textContent = `❌ „${line.name}“ nicht im Bestand gefunden`;
    content.appendChild(mainEl);
    return row; // nothing to tap into or toggle — informational only
  }

  if (line.direction === 'out') {
    const pathEl = document.createElement('div');
    pathEl.className = 'dictate-line-path';
    const sym = line.subcategorySym || line.categorySym || line.typeSym || '';
    pathEl.textContent = (sym ? sym + ' ' : '') + (lineBreadcrumb(line) || 'Kategorie unbekannt');
    content.appendChild(pathEl);

    const mainEl = document.createElement('div');
    mainEl.className = 'dictate-line-main';
    mainEl.textContent = `−${line.removeQty}× ${line.name}`;
    if (line.confidence !== 'high') {
      const confEl = document.createElement('span');
      confEl.className = 'dictate-line-confidence';
      confEl.textContent = '?';
      confEl.title = 'Unsichere Chargen-Zuordnung — bitte prüfen';
      mainEl.appendChild(confEl);
    }
    content.appendChild(mainEl);

    const meta2El = document.createElement('div');
    meta2El.className = 'dictate-line-meta2';
    meta2El.textContent = batchMetaLine({ quantity: line.batchQuantity, content: line.content, bestBefore: line.bestBefore, storage: line.storage });
    content.appendChild(meta2El);
  } else {
    const pathEl = document.createElement('div');
    pathEl.className = 'dictate-line-path';
    const sym = line.subcategorySym || line.categorySym || line.typeSym || '';
    pathEl.textContent = (sym ? sym + ' ' : '') + (lineBreadcrumb(line) || 'Kategorie auswählen');
    content.appendChild(pathEl);

    const mainEl = document.createElement('div');
    mainEl.className = 'dictate-line-main';
    mainEl.textContent = `${line.quantity}× ${line.name}`;
    if (line.content) {
      const metaSpan = document.createElement('span');
      metaSpan.className = 'dictate-line-meta';
      metaSpan.textContent = ' · ' + line.content;
      mainEl.appendChild(metaSpan);
    }
    content.appendChild(mainEl);

    const meta2Parts = [];
    if (line.bestBefore) meta2Parts.push('MHD ' + line.bestBefore);
    meta2Parts.push(line.storage || '⚠ Lagerort fehlt');
    if (line.isNew) meta2Parts.push('neues Produkt');
    const meta2El = document.createElement('div');
    meta2El.className = 'dictate-line-meta2' + (line.storage ? '' : ' missing');
    meta2El.textContent = meta2Parts.join(' · ');
    content.appendChild(meta2El);
  }

  content.addEventListener('click', onTap);
  return row;
}

function appendProposalBubble(lines) {
  const div = document.createElement('div');
  div.className = 'dictate-bubble app proposal';
  const linesWrap = document.createElement('div');
  div.appendChild(linesWrap);

  function rerender() {
    linesWrap.innerHTML = '';
    lines.forEach((line, i) => {
      linesWrap.appendChild(renderProposalLine(
        line,
        () => openEditSheet(lines, i, rerender),
        () => { lines[i] = toggleLineDirection(lines[i]); rerender(); },
      ));
    });
  }
  rerender();

  const actions = document.createElement('div');
  actions.className = 'dictate-proposal-actions';

  const discardBtn = document.createElement('button');
  discardBtn.type = 'button';
  discardBtn.className = 'dictate-discard-btn';
  discardBtn.textContent = '✕ Verwerfen';
  discardBtn.addEventListener('click', () => div.remove());

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'confirm-btn';
  confirmBtn.textContent = '✅ Registrieren';
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    discardBtn.disabled = true;
    try {
      const result = await registerLines(lines);
      actions.remove();
      appendConfirmationBubble(result);
      window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
    } catch (err) {
      console.error(err);
      confirmBtn.disabled = false;
      discardBtn.disabled = false;
      appendErrorBubbleSimple('Registrieren fehlgeschlagen: ' + err.message);
    }
  });

  actions.appendChild(discardBtn);
  actions.appendChild(confirmBtn);
  div.appendChild(actions);

  chatEl.appendChild(div);
  scrollChatToBottom();
}

// --- Edit sheet (correcting one proposed line) ---------------------------

let editingContext = null; // { lines, index, onApply }

function populateEditTypeSelect() {
  editTypeSelect.innerHTML = '';
  taxonomy.types.forEach((type) => {
    const opt = document.createElement('option');
    opt.value = type.id;
    opt.textContent = `${type.sym ? type.sym + ' ' : ''}${type.name}`;
    editTypeSelect.appendChild(opt);
  });
}

function populateEditCategorySelect(typeId) {
  const type = taxonomy.types.find((t) => t.id === typeId);
  editCategorySelect.innerHTML = '';
  ((type && type.categories) || []).forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = `${cat.sym ? cat.sym + ' ' : ''}${cat.name}`;
    editCategorySelect.appendChild(opt);
  });
}

function populateEditSubcategorySelect(typeId, categoryId) {
  const type = taxonomy.types.find((t) => t.id === typeId);
  const cat = type && (type.categories || []).find((c) => c.id === categoryId);
  editSubcategorySelect.innerHTML = '';
  ((cat && cat.subcategories) || []).forEach((sub) => {
    const opt = document.createElement('option');
    opt.value = sub.id;
    opt.textContent = `${sub.sym ? sub.sym + ' ' : ''}${sub.name}`;
    editSubcategorySelect.appendChild(opt);
  });
  // Wasser auto-manages exactly one subcategory per category (see
  // js/taxonomy.js's ensureWaterSubcategory) — hide the picker but keep
  // it populated/selected, same as js/stock-checkin.js's own flow does.
  editSubcategoryGroup.classList.toggle('hidden', type ? typeClass(type) === 'water' : false);
}

editTypeSelect.addEventListener('change', () => {
  populateEditCategorySelect(editTypeSelect.value);
  editCategorySelect.dispatchEvent(new Event('change'));
});
editCategorySelect.addEventListener('change', () => {
  populateEditSubcategorySelect(editTypeSelect.value, editCategorySelect.value);
});

function setEditUnitToggle(unit) {
  editUnitButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.unit === unit));
  editContentGroup.classList.toggle('hidden', unit !== 'kg' && unit !== 'l');
}

editUnitButtons.forEach((btn) => {
  btn.addEventListener('click', () => setEditUnitToggle(btn.dataset.unit));
});

// Unlimited for 'in' lines (any quantity can be checked in); clamped to the
// selected batch's own quantity for 'out' lines (populateEditBatchSelect
// sets this whenever the sheet opens in out-mode or the batch changes).
let editQtyMax = Infinity;

editQtyMinus.addEventListener('click', () => {
  const n = Math.max(1, (parseInt(editQtyNum.value, 10) || 1) - 1);
  editQtyNum.value = String(n);
});
editQtyPlus.addEventListener('click', () => {
  const n = Math.min(editQtyMax, (parseInt(editQtyNum.value, 10) || 1) + 1);
  editQtyNum.value = String(n);
});
editQtyNum.addEventListener('focus', () => editQtyNum.select());
editQtyNum.addEventListener('blur', () => {
  const n = parseInt(editQtyNum.value, 10);
  editQtyNum.value = String(clampQty(n, editQtyMax));
});

function populateEditStorageSelect(selected) {
  editStorageSelect.innerHTML = '';
  if (!selected) {
    // No blank option once a real location is picked — this placeholder
    // exists so opening the sheet on a not-yet-set line doesn't silently
    // look like the first storage location was already chosen.
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— Lagerort wählen —';
    editStorageSelect.appendChild(placeholder);
  }
  storageLocations.forEach((loc) => {
    const opt = document.createElement('option');
    opt.value = loc;
    opt.textContent = loc;
    editStorageSelect.appendChild(opt);
  });
}

function populateEditBatchSelect(productId, selectedBatchId) {
  editBatchSelect.innerHTML = '';
  const batches = allBatches.filter((b) => b.productId === productId);
  batches.forEach((b) => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = batchMetaLine(b);
    editBatchSelect.appendChild(opt);
  });
  if (selectedBatchId && batches.some((b) => b.id === selectedBatchId)) {
    editBatchSelect.value = selectedBatchId;
  }
  applyEditBatchMax();
}

function applyEditBatchMax() {
  const batch = batchIndex.get(editBatchSelect.value);
  editQtyMax = batch ? batch.quantity : 1;
  editQtyNum.value = String(clampQty(parseInt(editQtyNum.value, 10), editQtyMax));
}

editBatchSelect.addEventListener('change', applyEditBatchMax);

function openEditSheet(lines, index, onApply) {
  const line = lines[index];
  editingContext = { lines, index, onApply };

  const isOut = line.direction === 'out';
  editSheetEl.classList.toggle('out-mode', isOut);
  editTitleEl.textContent = isOut ? 'Entnahme bearbeiten' : 'Charge bearbeiten';
  editQtyLabel.textContent = isOut ? 'Menge zum Entnehmen' : 'Menge';

  if (isOut) {
    populateEditBatchSelect(line.productId, line.batchId);
    editQtyNum.value = String(clampQty(line.removeQty || 1, editQtyMax));
    editModal.classList.add('show');
    return;
  }

  editQtyMax = Infinity;
  populateEditTypeSelect();
  const ctx = contextFor(line.subcategoryId);
  const initialType = ctx ? ctx.type.id : (taxonomy.types[0] && taxonomy.types[0].id);
  if (initialType) {
    editTypeSelect.value = initialType;
    populateEditCategorySelect(initialType);
    const initialCat = ctx ? ctx.category.id : editCategorySelect.value;
    if (initialCat) editCategorySelect.value = initialCat;
    populateEditSubcategorySelect(editTypeSelect.value, editCategorySelect.value);
    if (ctx) editSubcategorySelect.value = ctx.subcategory.id;
  }

  editNameInput.value = line.name || '';
  setEditUnitToggle(line.unitType || 'kg');
  editQtyNum.value = String(line.quantity || 1);
  editDetailsInput.value = line.details || '';
  editContentInput.value = line.content || '';
  editBestBeforeInput.value = bestBeforeToMonthInput(line.bestBefore);
  populateEditStorageSelect(line.storage);
  if (line.storage) editStorageSelect.value = line.storage;

  editModal.classList.add('show');
}

editModal.addEventListener('click', (e) => { if (e.target === editModal) editModal.classList.remove('show'); });

editApplyBtn.addEventListener('click', () => {
  if (!editingContext) return;
  const { lines, index, onApply } = editingContext;
  const line = lines[index];

  if (line.direction === 'out') {
    const batch = batchIndex.get(editBatchSelect.value);
    if (batch) {
      line.batchId = batch.id;
      line.productId = batch.productId;
      line.name = productName(batch.productId);
      line.content = batch.content || '';
      line.bestBefore = batch.bestBefore || '';
      line.storage = batch.storage || '';
      line.batchQuantity = batch.quantity;
    }
    line.removeQty = clampQty(parseInt(editQtyNum.value, 10), editQtyMax);
    line.confidence = 'high'; // manually confirmed — no longer worth flagging

    editModal.classList.remove('show');
    editingContext = null;
    onApply();
    return;
  }

  const subId = editSubcategorySelect.value || null;
  const ctx = contextFor(subId);

  line.subcategoryId = subId;
  line.typeName = ctx ? ctx.type.name : '';
  line.typeSym = ctx ? ctx.type.sym : '';
  line.categoryName = ctx ? ctx.category.name : '';
  line.categorySym = ctx ? ctx.category.sym : '';
  line.subcategoryName = ctx ? ctx.subcategory.name : '';
  line.subcategorySym = ctx ? ctx.subcategory.sym : '';
  line.name = editNameInput.value.trim() || line.name;
  const activeUnitBtn = [...editUnitButtons].find((b) => b.classList.contains('active'));
  line.unitType = activeUnitBtn ? activeUnitBtn.dataset.unit : 'kg';
  line.quantity = Math.max(1, parseInt(editQtyNum.value, 10) || 1);
  line.details = editDetailsInput.value.trim();
  line.content = editContentInput.value.trim();
  line.bestBefore = monthInputToBestBefore(editBestBeforeInput.value);
  line.storage = editStorageSelect.value || '';

  editModal.classList.remove('show');
  editingContext = null;
  onApply();
});

// --- Registering a confirmed proposal (the actual Firestore writes) -----

async function registerLines(lines) {
  const nowIso = new Date().toISOString();
  const newProductIds = new Map(); // dedupes a repeated newProductName within one turn
  const inSummaries = [];
  const outSummaries = [];
  const undoRecords = [];

  for (const line of lines) {
    if (line.unresolved) continue; // informational-only row — nothing to write

    if (line.direction === 'out') {
      // batchIndex/allBatches are mutated in place below, so a second line
      // in the same turn referencing the same batch sees the already-
      // decremented (or already-deleted) state here — no separate
      // per-turn bookkeeping needed.
      const batch = batchIndex.get(line.batchId);
      if (!batch || batch.quantity <= 0) {
        throw new Error(`"${line.name}" ist nicht mehr im Bestand — bitte Vorschlag verwerfen und erneut diktieren.`);
      }
      const removeQty = clampQty(line.removeQty, batch.quantity);

      const ref = doc(db, 'stockItems', batch.id);
      const originalBatch = { ...batch };
      delete originalBatch.id;
      let deletedProduct = null;

      if (removeQty >= batch.quantity) {
        await deleteDoc(ref);
        allBatches = allBatches.filter((b) => b.id !== batch.id);
        batchIndex.delete(batch.id);

        const stillStocked = allBatches.some((b) => b.productId === batch.productId);
        if (!stillStocked && !targets.products[batch.productId]) {
          const product = productIndex.get(batch.productId);
          if (product) {
            await deleteDoc(doc(db, 'products', batch.productId));
            deletedProduct = { ...product };
            allProducts = allProducts.filter((p) => p.id !== batch.productId);
            productIndex.delete(batch.productId);
          }
        }
      } else {
        const updated = { ...originalBatch, quantity: batch.quantity - removeQty, updatedAt: nowIso };
        await setDoc(ref, updated);
        const withId = { id: batch.id, ...updated };
        batchIndex.set(batch.id, withId);
        const idx = allBatches.findIndex((b) => b.id === batch.id);
        if (idx >= 0) allBatches[idx] = withId;
      }

      const logDoc = await addDoc(collection(db, 'stockLog'), {
        action: 'out',
        productName: line.name,
        quantity: removeQty,
        details: batch.details || '',
        content: batch.content || '',
        bestBefore: batch.bestBefore || '',
        createdAt: nowIso,
      });

      undoRecords.push({ batchId: batch.id, originalBatch, deletedProduct, stockLogId: logDoc.id });
      outSummaries.push(`${removeQty}× ${line.name}${batch.content ? ' (' + batch.content + ')' : ''}`);
      continue;
    }

    if (!line.subcategoryId) {
      throw new Error(`Kategorie für "${line.name}" fehlt — bitte antippen und auswählen.`);
    }
    const ctx = subcategoryIndex.get(line.subcategoryId);
    if (!ctx) {
      throw new Error(`Unbekannte Kategorie für "${line.name}".`);
    }

    let productId = line.productId;
    if (line.isNew) {
      const dedupeKey = line.name.trim().toLowerCase();
      if (newProductIds.has(dedupeKey)) {
        productId = newProductIds.get(dedupeKey);
      } else {
        const newDoc = await addDoc(collection(db, 'products'), {
          name: line.name.trim(),
          subcategoryId: line.subcategoryId,
          unitType: line.unitType,
        });
        productId = newDoc.id;
        newProductIds.set(dedupeKey, productId);
        const newProduct = { id: productId, name: line.name.trim(), subcategoryId: line.subcategoryId, unitType: line.unitType };
        allProducts.push(newProduct);
        productIndex.set(productId, newProduct);
      }
    }

    const isFractional = line.unitType === 'kg' || line.unitType === 'l';
    const content = isFractional ? normalizeContent(line.content) : (line.content || '');

    const data = {
      type: ctx.type.name,
      category: ctx.category.name,
      subcategory: ctx.subcategory.name,
      subcategorySymbol: ctx.subcategory.sym || '',
      productId,
      details: line.details || '',
      quantity: line.quantity,
      content,
      bestBefore: line.bestBefore || '',
      yearColor: yearColorFor(line.bestBefore),
      storage: line.storage || '',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await addDoc(collection(db, 'stockItems'), data);
    await addDoc(collection(db, 'stockLog'), {
      action: 'in',
      productName: line.name,
      quantity: data.quantity,
      details: data.details,
      content: data.content,
      bestBefore: data.bestBefore,
      createdAt: nowIso,
    });

    inSummaries.push(`${line.quantity}× ${line.name}${content ? ' (' + content + ')' : ''}`);
  }

  return { inSummaries, outSummaries, undoRecords };
}
