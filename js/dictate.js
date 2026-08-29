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
import { db, functions } from './firebase-init.js?v=127';
import {
  collection, getDocs, doc, getDoc, addDoc,
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
const editTypeSelect = document.getElementById('dictate-edit-type-select');
const editCategorySelect = document.getElementById('dictate-edit-category-select');
const editSubcategoryGroup = document.getElementById('dictate-edit-subcategory-group');
const editSubcategorySelect = document.getElementById('dictate-edit-subcategory-select');
const editNameInput = document.getElementById('dictate-edit-name');
const editUnitToggle = document.getElementById('dictate-edit-unit-toggle');
const editUnitButtons = editUnitToggle.querySelectorAll('.unit-btn');
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
    const [taxSnap, productsSnap, storeSnap, colorSnap] = await Promise.all([
      getDoc(doc(db, 'config', 'taxonomy')),
      getDocs(collection(db, 'products')),
      getDoc(doc(db, 'config', 'storageLocations')),
      getDoc(doc(db, 'config', 'yearColorMap')),
    ]);
    taxonomy = taxSnap.exists() && Array.isArray(taxSnap.data().types) ? taxSnap.data() : { types: [] };
    allProducts = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    productIndex = new Map(allProducts.map((p) => [p.id, p]));
    storageLocations = storeSnap.exists() && Array.isArray(storeSnap.data().locations) ? storeSnap.data().locations : [];
    yearColorMap = colorSnap.exists() ? colorSnap.data() : {};
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

function startRecording() {
  if (!SpeechRecognitionCtor) {
    appendErrorBubbleSimple('Spracherkennung wird auf diesem Gerät/Browser nicht unterstützt.');
    return;
  }
  if (recording) return;

  recognizer = new SpeechRecognitionCtor();
  recognizer.lang = 'de-DE';
  recognizer.continuous = true;
  recognizer.interimResults = true;

  let finalTranscript = '';

  recognizer.onstart = () => {
    recording = true;
    micBtn.classList.add('recording');
    setHint('Höre zu… nochmal tippen zum Beenden');
    liveEl.classList.remove('hidden');
    liveEl.textContent = '';
  };

  recognizer.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalTranscript += result[0].transcript;
      } else {
        interim += result[0].transcript;
      }
    }
    liveEl.textContent = (finalTranscript + ' ' + interim).trim();
  };

  recognizer.onerror = (event) => {
    console.error('SpeechRecognition error', event.error);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      resetMicUi();
      appendErrorBubbleSimple('Mikrofon-Zugriff wurde verweigert — bitte in den Browser-Einstellungen erlauben.');
    }
    // Other errors (e.g. no-speech) are left to onend, which already
    // handles "nothing usable was said" via the empty-transcript check.
  };

  recognizer.onend = () => {
    resetMicUi();
    const text = finalTranscript.trim();
    if (text) handleTranscript(text);
  };

  try {
    recognizer.start();
  } catch (err) {
    console.error(err);
    resetMicUi();
  }
}

function resetMicUi() {
  recording = false;
  micBtn.classList.remove('recording');
  liveEl.classList.add('hidden');
  setHint('Zum Sprechen tippen');
}

function stopRecording() {
  if (recognizer && recording) {
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
  if (typeof v !== 'string' || !v.trim()) return storageLocations[0] || '';
  const q = v.trim().toLowerCase();
  const match = storageLocations.find((loc) => {
    const lq = loc.toLowerCase();
    return lq === q || lq.includes(q) || q.includes(lq);
  });
  return match || storageLocations[0] || '';
}

function contextFor(subcategoryId) {
  return subcategoryId ? subcategoryIndex.get(subcategoryId) : null;
}

function resolveLine(item) {
  if (item && item.matchedProductId) {
    const product = productIndex.get(item.matchedProductId);
    if (!product) return null; // stale/unknown id from the model — skip defensively
    const ctx = contextFor(product.subcategoryId);
    return {
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

function appendConfirmationBubble(text) {
  const div = document.createElement('div');
  div.className = 'dictate-bubble app confirmation';
  div.textContent = text;
  chatEl.appendChild(div);
  scrollChatToBottom();
}

function lineBreadcrumb(line) {
  return [line.typeName, line.categoryName, line.subcategoryName].filter(Boolean).join(' › ');
}

function renderProposalLine(line, onTap) {
  const row = document.createElement('div');
  row.className = 'dictate-proposal-line';

  const pathEl = document.createElement('div');
  pathEl.className = 'dictate-line-path';
  const sym = line.subcategorySym || line.categorySym || line.typeSym || '';
  pathEl.textContent = (sym ? sym + ' ' : '') + (lineBreadcrumb(line) || 'Kategorie auswählen');
  row.appendChild(pathEl);

  const mainEl = document.createElement('div');
  mainEl.className = 'dictate-line-main';
  mainEl.textContent = `${line.quantity}× ${line.name}`;
  if (line.content) {
    const metaSpan = document.createElement('span');
    metaSpan.className = 'dictate-line-meta';
    metaSpan.textContent = ' · ' + line.content;
    mainEl.appendChild(metaSpan);
  }
  row.appendChild(mainEl);

  const meta2Parts = [];
  if (line.bestBefore) meta2Parts.push('MHD ' + line.bestBefore);
  if (line.storage) meta2Parts.push(line.storage);
  if (line.isNew) meta2Parts.push('neues Produkt');
  if (meta2Parts.length) {
    const meta2El = document.createElement('div');
    meta2El.className = 'dictate-line-meta2';
    meta2El.textContent = meta2Parts.join(' · ');
    row.appendChild(meta2El);
  }

  row.addEventListener('click', onTap);
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
      linesWrap.appendChild(renderProposalLine(line, () => openEditSheet(lines, i, rerender)));
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
      const summary = await registerLines(lines);
      actions.remove();
      appendConfirmationBubble(summary);
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

editQtyMinus.addEventListener('click', () => {
  const n = Math.max(1, (parseInt(editQtyNum.value, 10) || 1) - 1);
  editQtyNum.value = String(n);
});
editQtyPlus.addEventListener('click', () => {
  const n = (parseInt(editQtyNum.value, 10) || 1) + 1;
  editQtyNum.value = String(n);
});
editQtyNum.addEventListener('focus', () => editQtyNum.select());
editQtyNum.addEventListener('blur', () => {
  const n = parseInt(editQtyNum.value, 10);
  editQtyNum.value = String(Number.isFinite(n) && n >= 1 ? n : 1);
});

function populateEditStorageSelect() {
  editStorageSelect.innerHTML = '';
  storageLocations.forEach((loc) => {
    const opt = document.createElement('option');
    opt.value = loc;
    opt.textContent = loc;
    editStorageSelect.appendChild(opt);
  });
}

function openEditSheet(lines, index, onApply) {
  const line = lines[index];
  editingContext = { lines, index, onApply };

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
  populateEditStorageSelect();
  if (line.storage) editStorageSelect.value = line.storage;

  editModal.classList.add('show');
}

editModal.addEventListener('click', (e) => { if (e.target === editModal) editModal.classList.remove('show'); });

editApplyBtn.addEventListener('click', () => {
  if (!editingContext) return;
  const { lines, index, onApply } = editingContext;
  const line = lines[index];

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
  const summaries = [];

  for (const line of lines) {
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

    summaries.push(`${line.quantity}× ${line.name}${content ? ' (' + content + ')' : ''}`);
  }

  return '✅ Eingelagert: ' + summaries.join(', ');
}
