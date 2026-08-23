import { db } from './firebase-init.js?v=14';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const editorEl = document.getElementById('taxonomy-editor');
const addTypeBtn = document.getElementById('add-type-btn');
const statusEl = document.getElementById('taxonomy-status');
const ref = doc(db, 'config', 'taxonomy');

let taxonomy = { types: [] };
const openTypes = new Set(); // UI-only expand/collapse state, not persisted

function genId() {
  return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Auto-focus + select a freshly created node's name input (post-render, so
// the element actually exists in the DOM) — lets you just type over the
// default "Neuer Typ"/"Neue Kategorie"/… placeholder name immediately.
function focusNewName(id) {
  const input = editorEl.querySelector(`[data-id="${id}"] .tax-name-input`);
  if (input) {
    input.focus();
    input.select();
  }
}

async function loadTaxonomy() {
  try {
    const snap = await getDoc(ref);
    taxonomy = snap.exists() && Array.isArray(snap.data().types) ? snap.data() : { types: [] };
  } catch (err) {
    statusEl.textContent = 'Fehler beim Laden: ' + err.message;
    console.error(err);
    taxonomy = { types: [] };
  }
  render();
}

async function saveTaxonomy() {
  statusEl.textContent = 'Speichere…';
  try {
    await setDoc(ref, taxonomy);
    statusEl.textContent = '';
  } catch (err) {
    statusEl.textContent = 'Fehler beim Speichern: ' + err.message;
    console.error(err);
  }
}

// Generic pointer-based reorder (works with touch, unlike native HTML5
// drag-and-drop which Android/mobile browsers largely don't support).
// containerEl must contain only reorderable item elements as direct
// children — no trailing "add" buttons mixed in.
function makeReorderable(containerEl, itemSelector, onReorder) {
  const items = () => Array.from(containerEl.querySelectorAll(':scope > ' + itemSelector));
  items().forEach((item) => {
    const handle = item.querySelector('.drag-handle');
    if (!handle) return;

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const pointerId = e.pointerId;
      item.setPointerCapture(pointerId);
      item.classList.add('dragging');

      function onMove(ev) {
        const y = ev.clientY;
        const siblings = items().filter((el) => el !== item);
        let placed = false;
        for (const sib of siblings) {
          const box = sib.getBoundingClientRect();
          if (y < box.top + box.height / 2) {
            containerEl.insertBefore(item, sib);
            placed = true;
            break;
          }
        }
        if (!placed) containerEl.appendChild(item);
      }

      function onUp() {
        item.classList.remove('dragging');
        item.releasePointerCapture(pointerId);
        item.removeEventListener('pointermove', onMove);
        item.removeEventListener('pointerup', onUp);
        item.removeEventListener('pointercancel', onUp);
        onReorder(items().map((el) => el.dataset.id));
      }

      item.addEventListener('pointermove', onMove);
      item.addEventListener('pointerup', onUp);
      item.addEventListener('pointercancel', onUp);
    });
  });
}

function render() {
  editorEl.innerHTML = '';
  taxonomy.types.forEach((type) => editorEl.appendChild(renderType(type)));
  makeReorderable(editorEl, '.tax-type', (orderedIds) => {
    taxonomy.types = orderedIds.map((id) => taxonomy.types.find((t) => t.id === id));
    saveTaxonomy();
  });
}

function renderType(type) {
  const wrap = document.createElement('div');
  wrap.className = 'tax-type';
  wrap.dataset.id = type.id;

  const head = document.createElement('div');
  head.className = 'tax-type-head';
  head.innerHTML = `
    <span class="drag-handle">☰</span>
    <input class="tax-sym-input" value="${escapeAttr(type.sym || '')}" placeholder="🗂️">
    <input class="tax-name-input" value="${escapeAttr(type.name || '')}" placeholder="Typname">
    <button class="tax-del" title="Typ löschen">✕</button>
    <button class="tax-toggle">${openTypes.has(type.id) ? '▴' : '▾'}</button>
  `;
  wrap.appendChild(head);

  const body = document.createElement('div');
  body.className = 'tax-body' + (openTypes.has(type.id) ? ' open' : '');
  wrap.appendChild(body);

  head.querySelector('.tax-sym-input').addEventListener('change', (e) => {
    type.sym = e.target.value.trim();
    saveTaxonomy();
  });
  head.querySelector('.tax-name-input').addEventListener('change', (e) => {
    type.name = e.target.value.trim();
    saveTaxonomy();
  });
  head.querySelector('.tax-del').addEventListener('click', () => {
    if (!confirm(`Typ "${type.name}" inkl. aller Kategorien und Unterkategorien löschen?`)) return;
    taxonomy.types = taxonomy.types.filter((t) => t.id !== type.id);
    saveTaxonomy();
    render();
  });
  head.querySelector('.tax-toggle').addEventListener('click', () => {
    if (openTypes.has(type.id)) openTypes.delete(type.id);
    else openTypes.add(type.id);
    render();
  });

  const catList = document.createElement('div');
  catList.className = 'tax-cat-list';
  (type.categories || []).forEach((cat) => catList.appendChild(renderCategory(type, cat)));
  body.appendChild(catList);

  const addCatBtn = document.createElement('button');
  addCatBtn.className = 'add-row-btn small';
  addCatBtn.textContent = '+ Kategorie hinzufügen';
  addCatBtn.addEventListener('click', () => {
    if (!type.categories) type.categories = [];
    const newCat = { id: genId(), name: 'Neue Kategorie', sym: '', subcategories: [] };
    type.categories.push(newCat);
    openTypes.add(type.id);
    saveTaxonomy();
    render();
    focusNewName(newCat.id);
  });
  body.appendChild(addCatBtn);

  makeReorderable(catList, '.tax-cat', (orderedIds) => {
    type.categories = orderedIds.map((id) => type.categories.find((c) => c.id === id));
    saveTaxonomy();
  });

  return wrap;
}

function renderCategory(type, cat) {
  const wrap = document.createElement('div');
  wrap.className = 'tax-cat';
  wrap.dataset.id = cat.id;

  const head = document.createElement('div');
  head.className = 'tax-cat-head';
  head.innerHTML = `
    <span class="drag-handle">☰</span>
    <input class="tax-sym-input" value="${escapeAttr(cat.sym || '')}" placeholder="•">
    <input class="tax-name-input" value="${escapeAttr(cat.name || '')}" placeholder="Kategoriename">
    <button class="tax-del" title="Kategorie löschen">✕</button>
  `;
  wrap.appendChild(head);

  head.querySelector('.tax-sym-input').addEventListener('change', (e) => {
    cat.sym = e.target.value.trim();
    saveTaxonomy();
  });
  head.querySelector('.tax-name-input').addEventListener('change', (e) => {
    cat.name = e.target.value.trim();
    saveTaxonomy();
  });
  head.querySelector('.tax-del').addEventListener('click', () => {
    if (!confirm(`Kategorie "${cat.name}" inkl. aller Unterkategorien löschen?`)) return;
    type.categories = type.categories.filter((c) => c.id !== cat.id);
    saveTaxonomy();
    render();
  });

  const subList = document.createElement('div');
  subList.className = 'tax-sub-list';
  (cat.subcategories || []).forEach((sub) => subList.appendChild(renderSubcategory(cat, sub)));
  wrap.appendChild(subList);

  const addSubBtn = document.createElement('div');
  addSubBtn.className = 'add-sub-row';
  addSubBtn.textContent = '+ Unterkategorie hinzufügen';
  addSubBtn.addEventListener('click', () => {
    if (!cat.subcategories) cat.subcategories = [];
    const newSub = { id: genId(), name: 'Neue Unterkategorie', sym: '' };
    cat.subcategories.push(newSub);
    saveTaxonomy();
    render();
    focusNewName(newSub.id);
  });
  wrap.appendChild(addSubBtn);

  makeReorderable(subList, '.tax-sub-row', (orderedIds) => {
    cat.subcategories = orderedIds.map((id) => cat.subcategories.find((s) => s.id === id));
    saveTaxonomy();
  });

  return wrap;
}

function renderSubcategory(cat, sub) {
  const row = document.createElement('div');
  row.className = 'tax-sub-row';
  row.dataset.id = sub.id;
  row.innerHTML = `
    <span class="drag-handle">☰</span>
    <input class="tax-sym-input" value="${escapeAttr(sub.sym || '')}" placeholder="•">
    <input class="tax-name-input" value="${escapeAttr(sub.name || '')}" placeholder="Unterkategoriename">
    <button class="tax-del" title="Unterkategorie löschen">✕</button>
  `;
  row.querySelector('.tax-sym-input').addEventListener('change', (e) => {
    sub.sym = e.target.value.trim();
    saveTaxonomy();
  });
  row.querySelector('.tax-name-input').addEventListener('change', (e) => {
    sub.name = e.target.value.trim();
    saveTaxonomy();
  });
  row.querySelector('.tax-del').addEventListener('click', () => {
    if (!confirm(`Unterkategorie "${sub.name}" löschen?`)) return;
    cat.subcategories = cat.subcategories.filter((s) => s.id !== sub.id);
    saveTaxonomy();
    render();
  });
  return row;
}

addTypeBtn.addEventListener('click', () => {
  const type = { id: genId(), name: 'Neuer Typ', sym: '', categories: [] };
  taxonomy.types.push(type);
  openTypes.add(type.id);
  saveTaxonomy();
  render();
  focusNewName(type.id);
});

// Wait for auth to actually resolve before reading /config/taxonomy — the
// same reason app-shell.js gates admin-only UI on this event rather than
// checking role at module-load time. Firebase Auth's session restore is
// async, so calling loadTaxonomy() unconditionally here would race it: on
// a fresh page load, request.auth is still null at the moment this module
// evaluates, and Firestore rejects the read with permission-denied even
// though the user is about to be (or already is) signed in a moment later.
window.addEventListener('erdkeller:signedin', () => {
  loadTaxonomy();
});

window.addEventListener('erdkeller:refresh', () => {
  loadTaxonomy();
});
