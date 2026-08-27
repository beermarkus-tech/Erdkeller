import { db } from './firebase-init.js?v=108';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const editorEl = document.getElementById('taxonomy-editor');
const addTypeBtn = document.getElementById('add-type-btn');
const expandAllBtn = document.getElementById('expand-all-btn');
const collapseAllBtn = document.getElementById('collapse-all-btn');
const statusEl = document.getElementById('taxonomy-status');
const ref = doc(db, 'config', 'taxonomy');

let taxonomy = { types: [] };
const openTypes = new Set(); // UI-only expand/collapse state, not persisted
const openCats = new Set(); // same, one level down (category → subcategories)

// A type's class: 'food' | 'water' | 'other', exclusive. Persisted as
// type.typeClass; for types saved before this field existed we derive it
// from the old boolean type.isFoodType (true -> 'food', missing/false ->
// 'other') rather than migrating Firestore. That fallback only works
// because there were exactly two buckets before — the moment a fourth
// class is introduced, "not food and not water" stops having one single
// meaning and every type needs typeClass written explicitly (a one-time
// backfill), since this inference can no longer tell the new class apart
// from plain 'other'.
function typeClass(type) {
  if (type.typeClass) return type.typeClass;
  return type.isFoodType ? 'food' : 'other';
}

// Which Planung path a category is on: 'off' | 'calorie' | 'diversity'.
// Gated first by the parent TYPE's class — only a food-classed type
// (Ausrüstung, Wasser, Tiernahrung, … all excluded) offers Kalorien/
// Diversität at all, its categories are always 'off', full stop. This is
// deliberately a tag on the type rather than a name match ("is this
// literally called Lebensmittel"), since a taxonomy can have more than
// one food type, and Tiernahrung is food but not *human* food, so it
// stays untagged even though it's food in the everyday sense.
// Below that gate, mode is persisted as its own field (cat.planningMode)
// rather than derived from whether kcal/macro/diversity data happens to be
// present — switching modes (or the type's class) must not delete the
// other mode's data, only stop it from being used, so switching back
// brings the same numbers straight back. Categories saved before this
// field existed (or before Kalorien/Diversität were split into an
// exclusive choice) have no planningMode key at all; for those we infer
// from whatever data is present, preferring Kalorien if a category
// somehow has both (pre-existing edge case from the old single-checkbox
// model).
// Wasser categories skip the subcategory level entirely from the user's
// perspective (Type → Category → Product, no picking a subcategory that
// doesn't semantically exist for water) — but the data model underneath
// is untouched: subcategoryId stays the one universal addressing key
// everywhere else in the app (Ziele, Übersicht, Bestand). So each Wasser
// category silently keeps exactly one auto-managed subcategory, its
// name/symbol kept in sync with the category so raw Firestore data never
// looks orphaned. Returns true if it changed something (caller should
// save). If a category already has more than one subcategory (e.g. real
// ones from before it was reclassified to Wasser), this leaves it alone —
// renderCategory falls back to the normal subcategory UI in that case
// rather than silently hiding existing structure.
function ensureWaterSubcategory(cat) {
  if (!cat.subcategories) cat.subcategories = [];
  if (cat.subcategories.length > 1) return false;
  if (cat.subcategories.length === 0) {
    cat.subcategories.push({ id: genId(), name: cat.name, sym: cat.sym || '' });
    return true;
  }
  const sub = cat.subcategories[0];
  if (sub.name !== cat.name || sub.sym !== (cat.sym || '')) {
    sub.name = cat.name;
    sub.sym = cat.sym || '';
    return true;
  }
  return false;
}

function categoryPlanningMode(type, cat) {
  if (typeClass(type) !== 'food') return 'off';
  if (cat.planningMode) return cat.planningMode;
  if (cat.kcalPerKg != null || !!cat.macroType) return 'calorie';
  if (cat.diversityFloorGramsPerPersonDay != null) return 'diversity';
  return 'off';
}

// Tracks whether the in-memory `taxonomy` object actually reflects what's
// in Firestore. This is the fix for a real data-loss bug: a prior version
// called loadTaxonomy() before Firebase Auth had resolved, the read got
// rejected as permission-denied, and the catch block quietly reset
// `taxonomy` to {types: []} — which then got written for real the next
// time any add/rename/delete triggered saveTaxonomy() (a raw overwrite,
// not a merge), wiping the real data in Firestore. That specific race is
// fixed (loadTaxonomy now only runs after erdkeller:signedin), but this
// flag is the general safeguard: saveTaxonomy() refuses to run at all
// unless the last load actually succeeded, so no future bug in the load
// path can silently overwrite real data with an empty/stale local state.
let loadOk = false;

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
    loadOk = true;
  } catch (err) {
    statusEl.textContent = 'Fehler beim Laden: ' + err.message + ' — Bearbeiten deaktiviert, bis der Ladevorgang erfolgreich war.';
    console.error(err);
    // Only blank the tree if we never had real data to show. A failed
    // *re*load (e.g. via the refresh button) keeps showing the last-known-
    // good tree — frozen, edits blocked below — rather than making data
    // that's still safely in Firestore look like it vanished.
    if (!loadOk) taxonomy = { types: [] };
    loadOk = false;
  }
  addTypeBtn.disabled = !loadOk;
  render();
}

async function saveTaxonomy() {
  if (!loadOk) {
    statusEl.textContent = 'Speichern blockiert: Die Daten wurden zuletzt nicht erfolgreich geladen. Bitte Seite neu laden, bevor du änderst.';
    return;
  }
  statusEl.textContent = 'Speichere…';
  try {
    await setDoc(ref, taxonomy);
    statusEl.textContent = '';
    // Every other module that reads taxonomy (Ziele, Planung, Übersicht,
    // the Bestand type/category/subcategory tile grids) caches it in
    // memory and only reloads on this event — without it, a symbol
    // change, a new subcategory, etc. is invisible everywhere but here
    // until a manual refresh or full reload (same bug class as the
    // stock-checkin/-checkout/-table fix; see their write handlers).
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
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
  const cls = typeClass(type);
  wrap.className = 'tax-type' + (cls === 'food' ? ' food-type' : cls === 'water' ? ' water-type' : '');
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

  // Classifies the whole type as exactly one of Lebensmittel / Wasser /
  // Sonstiges. Lebensmittel gates whether ANY category under this type can
  // offer Kalorien/Diversität at all (see categoryPlanningMode) — a
  // Werkzeug or Tiernahrung type has no business showing a calorie toggle
  // on its categories. Wasser opts the type into the Übersicht's dedicated
  // water total (js/dashboard.js) instead — its stock is summed globally,
  // not planned per category. Switching class never deletes a category's
  // kcal/macro/diversity data, only stops the calculator from using it.
  const classToggle = document.createElement('div');
  classToggle.className = 'tax-expand-row tax-planning-toggle';
  classToggle.innerHTML = `
    <button type="button" class="select-mode-btn${cls === 'food' ? ' active' : ''}" data-class="food">Lebensmittel</button>
    <button type="button" class="select-mode-btn${cls === 'water' ? ' active' : ''}" data-class="water">Wasser</button>
    <button type="button" class="select-mode-btn${cls === 'other' ? ' active' : ''}" data-class="other">Sonstiges</button>
  `;
  body.appendChild(classToggle);

  classToggle.querySelectorAll('.select-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      type.typeClass = btn.dataset.class;
      delete type.isFoodType;
      saveTaxonomy();
      render();
    });
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
    openCats.add(newCat.id);
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

  // A Wasser category with 0-1 subcategories has an entirely empty body —
  // it never gets the Kalorien/Diversität toggle (water skips that
  // entirely), and the subcategory list stays hidden too (see
  // ensureWaterSubcategory below) — so the expand/collapse chevron would
  // have nothing to reveal. Only show it when the body can actually hold
  // something: any food-classed category (planning mode toggle), or a
  // Wasser category that still has real pre-existing subcategories (the
  // >1 fallback case).
  const emptyBody = typeClass(type) === 'water' && (cat.subcategories || []).length <= 1;

  const head = document.createElement('div');
  head.className = 'tax-cat-head';
  head.innerHTML = `
    <span class="drag-handle">☰</span>
    <input class="tax-sym-input" value="${escapeAttr(cat.sym || '')}" placeholder="•">
    <input class="tax-name-input" value="${escapeAttr(cat.name || '')}" placeholder="Kategoriename">
    <button class="tax-del" title="Kategorie löschen">✕</button>
    ${emptyBody ? '' : `<button class="tax-toggle">${openCats.has(cat.id) ? '▴' : '▾'}</button>`}
  `;
  wrap.appendChild(head);

  const body = document.createElement('div');
  body.className = 'tax-cat-body' + (emptyBody || openCats.has(cat.id) ? ' open' : '');
  wrap.appendChild(body);

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
  const catToggleBtn = head.querySelector('.tax-toggle');
  if (catToggleBtn) {
    catToggleBtn.addEventListener('click', () => {
      if (openCats.has(cat.id)) openCats.delete(cat.id);
      else openCats.add(cat.id);
      render();
    });
  }

  // Optional Planung fields (SPEC.md Section 7) — a category picks exactly
  // one path: Kalorien (kcal/kg + macro type, feeds the calorie/macro
  // calculator) or Diversität (a per-person minimum stock floor for
  // low-calorie/high-nutrition categories like produce) — never both, since
  // in practice a category is either a macro staple or a diversity
  // safeguard, not both at once. Switching modes never clears the other
  // mode's stored data, only stops it from being used — flipping back
  // brings the same numbers straight back. Only shown at all when the
  // parent type is tagged as a food type (see the Lebensmittel-Typ
  // checkbox in renderType) — a Werkzeug category has no business offering
  // Kalorien/Diversität.
  if (typeClass(type) === 'food') {
    const modeToggle = document.createElement('div');
    modeToggle.className = 'tax-expand-row tax-mode-toggle';
    const mode = categoryPlanningMode(type, cat);
    modeToggle.innerHTML = `
      <button type="button" class="select-mode-btn${mode === 'off' ? ' active' : ''}" data-mode="off">Nicht genutzt</button>
      <button type="button" class="select-mode-btn${mode === 'calorie' ? ' active' : ''}" data-mode="calorie">Kalorien</button>
      <button type="button" class="select-mode-btn${mode === 'diversity' ? ' active' : ''}" data-mode="diversity">Diversität</button>
    `;
    body.appendChild(modeToggle);

    modeToggle.querySelectorAll('.select-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        cat.planningMode = btn.dataset.mode;
        saveTaxonomy();
        render();
      });
    });

    if (mode === 'calorie') {
      const planningRow = document.createElement('div');
      planningRow.className = 'tax-planning-row';
      planningRow.innerHTML = `
        <div class="tax-planning-field">
          <label>kcal/kg</label>
          <input type="number" class="tax-kcal-input" value="${cat.kcalPerKg ?? ''}" placeholder="z.B. 7000">
        </div>
        <div class="tax-planning-field">
          <label>Makro</label>
          <select class="tax-macro-select">
            <option value=""${!cat.macroType ? ' selected' : ''}>–</option>
            <option value="kohlenhydrat"${cat.macroType === 'kohlenhydrat' ? ' selected' : ''}>Kohlenhydrat</option>
            <option value="protein"${cat.macroType === 'protein' ? ' selected' : ''}>Protein</option>
            <option value="fett"${cat.macroType === 'fett' ? ' selected' : ''}>Fett</option>
          </select>
        </div>
      `;
      body.appendChild(planningRow);

      planningRow.querySelector('.tax-kcal-input').addEventListener('change', (e) => {
        if (e.target.value === '') delete cat.kcalPerKg;
        else cat.kcalPerKg = Number(e.target.value);
        saveTaxonomy();
      });
      planningRow.querySelector('.tax-macro-select').addEventListener('change', (e) => {
        if (e.target.value === '') delete cat.macroType;
        else cat.macroType = e.target.value;
        saveTaxonomy();
      });
    } else if (mode === 'diversity') {
      const planningRow = document.createElement('div');
      planningRow.className = 'tax-planning-row';
      planningRow.innerHTML = `
        <div class="tax-planning-field">
          <label>Diversität (g/Pers./Tag)</label>
          <input type="number" class="tax-diversity-input" value="${cat.diversityFloorGramsPerPersonDay ?? ''}" placeholder="z.B. 50">
        </div>
      `;
      body.appendChild(planningRow);

      planningRow.querySelector('.tax-diversity-input').addEventListener('change', (e) => {
        if (e.target.value === '') delete cat.diversityFloorGramsPerPersonDay;
        else cat.diversityFloorGramsPerPersonDay = Number(e.target.value);
        saveTaxonomy();
      });
    }
  }

  if (typeClass(type) === 'water') {
    if (ensureWaterSubcategory(cat)) saveTaxonomy();
  }

  if (!emptyBody) {
    const subList = document.createElement('div');
    subList.className = 'tax-sub-list';
    (cat.subcategories || []).forEach((sub) => subList.appendChild(renderSubcategory(cat, sub)));
    body.appendChild(subList);

    const addSubBtn = document.createElement('div');
    addSubBtn.className = 'add-sub-row';
    addSubBtn.textContent = '+ Unterkategorie hinzufügen';
    addSubBtn.addEventListener('click', () => {
      if (!cat.subcategories) cat.subcategories = [];
      const newSub = { id: genId(), name: 'Neue Unterkategorie', sym: '' };
      cat.subcategories.push(newSub);
      openCats.add(cat.id);
      saveTaxonomy();
      render();
      focusNewName(newSub.id);
    });
    body.appendChild(addSubBtn);

    makeReorderable(subList, '.tax-sub-row', (orderedIds) => {
      cat.subcategories = orderedIds.map((id) => cat.subcategories.find((s) => s.id === id));
      saveTaxonomy();
    });
  }

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

expandAllBtn.addEventListener('click', () => {
  taxonomy.types.forEach((type) => {
    openTypes.add(type.id);
    (type.categories || []).forEach((cat) => openCats.add(cat.id));
  });
  render();
});

collapseAllBtn.addEventListener('click', () => {
  openTypes.clear();
  openCats.clear();
  render();
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
