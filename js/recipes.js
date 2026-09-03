// Rezepte (SPEC.md Section 10, Step 13) — structurally js/notes.js copied
// and extended: same card grid, same base64-photo-on-the-document/
// compression pipeline, same Google-Keep-style autosave edit screen, same
// admin-only gating. Two things notes.js doesn't have:
//
// - tags (a comma-separated text field, stored as a trimmed/deduped
//   array) drive a filter-chip row above the grid (SPEC.md: "filterable
//   tags/categories") — reuses the existing .filter-chip-row/.filter-chip
//   pattern already used for Bestandsliste's Typ/Kategorie chips.
// - ingredients (a plain array of free-text lines, one per row in the
//   editor — same shape as js/storage-locations.js's `locations` array)
//   get an automatic, zero-effort stock-availability check: no manual
//   linking step at all. Markus's own call, deliberately overriding
//   SPEC.md Section 10's original "No linkage to live stock data" —
//   ingredientAvailable() below does a whole-word match of every real
//   product's name against the ingredient's free text, and if a match is
//   currently in stock, the view screen shows a small green dot next to
//   that line. Nothing else — no red/warning state for what's missing,
//   on purpose (a "nice to have" signal, not a checklist that nags), and
//   no summary badge on the card either (Markus's call) — the dot only
//   ever shows up once a recipe is actually opened.
import { db } from './firebase-init.js?v=161';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const MAX_PHOTO_DIMENSION = 1000;
const JPEG_QUALITY = 0.6;
const MAX_TOTAL_PHOTO_CHARS = 700000;
const SAVE_DEBOUNCE_MS = 300;

const addRecipeBtn = document.getElementById('add-recipe-btn');
const searchInput = document.getElementById('recipes-search-input');
const tagFilterEl = document.getElementById('recipes-tag-filter');
const recipesListEl = document.getElementById('recipes-list');
const statusEl = document.getElementById('recipes-status');

const viewModal = document.getElementById('recipe-view-modal');
const viewCloseBtn = document.getElementById('recipe-view-close-btn');
const viewEditBtn = document.getElementById('recipe-view-edit-btn');
const viewTitleEl = document.getElementById('recipe-view-title');
const viewHeroEl = document.getElementById('recipe-view-hero');
const viewHeroImgEl = document.getElementById('recipe-view-hero-img');
const viewTagsEl = document.getElementById('recipe-view-tags');
const viewIngredientsSectionEl = document.getElementById('recipe-view-ingredients-section');
const viewIngredientsListEl = document.getElementById('recipe-view-ingredients');
const viewBodyLabelEl = document.getElementById('recipe-view-body-label');
const viewContentEl = document.getElementById('recipe-view-content');
const viewBodyEl = document.getElementById('recipe-view-body');

const editModal = document.getElementById('recipe-edit-modal');
const editBackBtn = document.getElementById('recipe-edit-back-btn');
const editPhotoBtn = document.getElementById('recipe-edit-photo-btn');
const editPhotoRemoveBadge = document.getElementById('recipe-edit-photo-remove-btn');
const photoInput = document.getElementById('recipe-edit-photo-input');
const editTitleInput = document.getElementById('recipe-edit-title');
const editTagsInput = document.getElementById('recipe-edit-tags');
const editIngredientsEl = document.getElementById('recipe-edit-ingredients');
const editAddIngredientBtn = document.getElementById('recipe-edit-add-ingredient-btn');
const editToolbarEl = document.getElementById('recipe-edit-toolbar');
const editBodyInput = document.getElementById('recipe-edit-body');
const editStatusEl = document.getElementById('recipe-edit-status');

let recipes = [];
let loadOk = false;
let isAdmin = false;
let searchText = '';
let activeTagFilters = new Set();

let viewingRecipe = null;

let editingRecipeId = null;
let pendingPhotos = [];
let editIngredients = [];
let dirty = false;
let saveTimer = null;

// --- Stock-availability matching ------------------------------------------
// Own local copy of js/dashboard.js's isFractionalUnit/batchKg/
// parseContentGrams/productCurrentAmount, per this codebase's convention
// of duplicating small helpers rather than sharing a module (the same
// logic is already independently duplicated in stock-table.js/
// stock-checkin.js/targets.js too).

let allProducts = [];
let allBatches = [];

function parseContentGrams(content) {
  if (!content) return null;
  const match = String(content).trim().match(/^(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  return parseFloat(match[1].replace(',', '.'));
}

function isFractionalUnit(unit) {
  return unit === 'kg' || unit === 'l';
}

function batchKg(batch, product) {
  if (!isFractionalUnit(product.unitType)) return 0;
  const grams = parseContentGrams(batch.content);
  if (grams == null) return 0;
  return (batch.quantity || 0) * (grams / 1000);
}

function productCurrentAmount(product) {
  const batches = allBatches.filter((b) => b.productId === product.id);
  if (isFractionalUnit(product.unitType)) {
    return batches.reduce((s, b) => s + batchKg(b, product), 0);
  }
  return batches.reduce((s, b) => s + (b.quantity || 0), 0);
}

// Whole-word match rather than a raw substring — a short product name
// like "Ei" shouldn't light up inside "Eis" or "Getreide". One notch more
// careful than the plain .includes() search used everywhere else in this
// app, because a false-positive green dot is the one failure mode worth
// actively avoiding here (a false negative just shows nothing, which is
// already the accepted default for anything unmatched or out of stock).
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function productNameMatchesText(productName, text) {
  const name = (productName || '').trim();
  if (!name) return false;
  const boundary = '[^a-zA-ZäöüÄÖÜß]';
  const re = new RegExp(`(^|${boundary})${escapeRegExp(name)}(${boundary}|$)`, 'i');
  return re.test(text);
}

function ingredientAvailable(text) {
  return allProducts.some((p) => productNameMatchesText(p.name, text) && productCurrentAmount(p) > 0);
}

// --- Data loading -----------------------------------------------------

async function loadRecipes() {
  try {
    const [recipesSnap, productsSnap, batchesSnap] = await Promise.all([
      getDocs(collection(db, 'recipes')),
      getDocs(collection(db, 'products')),
      getDocs(collection(db, 'stockItems')),
    ]);
    recipes = recipesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    allProducts = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    allBatches = batchesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    loadOk = true;
  } catch (err) {
    loadOk = false;
    statusEl.textContent = 'Fehler beim Laden: ' + err.message;
    console.error(err);
    return;
  }
  renderTagFilter();
  renderRecipes();
}

// --- Photo compression (identical to js/notes.js) ------------------------

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_PHOTO_DIMENSION || height > MAX_PHOTO_DIMENSION) {
          if (width > height) {
            height = Math.round(height * (MAX_PHOTO_DIMENSION / width));
            width = MAX_PHOTO_DIMENSION;
          } else {
            width = Math.round(width * (MAX_PHOTO_DIMENSION / height));
            height = MAX_PHOTO_DIMENSION;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };
      img.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  });
}

function updatePhotoRemoveBadge() {
  editPhotoRemoveBadge.classList.toggle('hidden', pendingPhotos.length === 0);
}

editPhotoBtn.addEventListener('click', () => {
  photoInput.click();
});

photoInput.addEventListener('change', async () => {
  const file = photoInput.files[0];
  photoInput.value = '';
  if (!file) return;
  try {
    const dataUri = await compressImage(file);
    if (dataUri.length > MAX_TOTAL_PHOTO_CHARS) {
      alert('Das Foto ist zu groß. Bitte ein anderes wählen.');
      return;
    }
    pendingPhotos = [dataUri];
    updatePhotoRemoveBadge();
    scheduleSave();
  } catch (err) {
    alert('Foto konnte nicht verarbeitet werden: ' + err.message);
    console.error(err);
  }
});

editPhotoRemoveBadge.addEventListener('click', () => {
  pendingPhotos = [];
  updatePhotoRemoveBadge();
  scheduleSave();
});

// --- Rich text body (identical mechanism to js/notes.js) ------------------

editToolbarEl.querySelectorAll('button[data-cmd]').forEach((btn) => {
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    editBodyInput.focus();
    document.execCommand(btn.dataset.cmd, false, btn.dataset.value || null);
    scheduleSave();
  });
});

const ALLOWED_BODY_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'H2', 'H3', 'UL', 'OL', 'LI', 'BR', 'P', 'DIV', 'SPAN']);

function sanitizeNode(node) {
  Array.from(node.childNodes).forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) return;
    if (child.nodeType !== Node.ELEMENT_NODE) {
      node.removeChild(child);
      return;
    }
    if (!ALLOWED_BODY_TAGS.has(child.tagName)) {
      while (child.firstChild) node.insertBefore(child.firstChild, child);
      node.removeChild(child);
      sanitizeNode(node);
      return;
    }
    Array.from(child.attributes).forEach((attr) => child.removeAttribute(attr.name));
    sanitizeNode(child);
  });
}

function sanitizeBodyHtml(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  sanitizeNode(container);
  return container.innerHTML;
}

function bodyToHtml(value) {
  return value || '';
}

function bodyPlainText(value) {
  if (!value) return '';
  const div = document.createElement('div');
  div.innerHTML = value;
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
}

// --- Tags -------------------------------------------------------------

function parseTagsInput(value) {
  const seen = new Set();
  const tags = [];
  (value || '').split(',').forEach((raw) => {
    const t = raw.trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      tags.push(t);
    }
  });
  return tags;
}

function allTagsInUse() {
  const seen = new Set();
  const tags = [];
  recipes.forEach((r) => (r.tags || []).forEach((t) => {
    if (!seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      tags.push(t);
    }
  }));
  return tags.sort((a, b) => a.localeCompare(b, 'de'));
}

function renderTagFilter() {
  const tags = allTagsInUse();
  // Drop a filter that no longer matches any recipe (its last recipe was
  // deleted/retagged) rather than leaving a permanently-active chip with
  // nothing left to show for it.
  activeTagFilters.forEach((t) => {
    if (!tags.some((tag) => tag.toLowerCase() === t.toLowerCase())) activeTagFilters.delete(t);
  });
  tagFilterEl.innerHTML = '';
  tagFilterEl.classList.toggle('hidden', tags.length === 0);
  tags.forEach((tag) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'filter-chip' + (activeTagFilters.has(tag) ? ' active' : '');
    chip.textContent = tag;
    chip.addEventListener('click', () => {
      if (activeTagFilters.has(tag)) activeTagFilters.delete(tag);
      else activeTagFilters.add(tag);
      renderTagFilter();
      renderRecipes();
    });
    tagFilterEl.appendChild(chip);
  });
}

// --- Card rendering ---------------------------------------------------------

function makeRecipeCard(recipe) {
  const card = document.createElement('div');
  card.className = 'recipe-card';

  const hero = document.createElement('div');
  hero.className = 'recipe-card-hero';
  const photo = (recipe.photos || [])[0];
  if (photo) {
    const img = document.createElement('img');
    img.src = photo;
    img.alt = '';
    hero.appendChild(img);
  } else {
    const placeholder = document.createElement('span');
    placeholder.className = 'recipe-card-hero-placeholder';
    placeholder.textContent = '🍲';
    hero.appendChild(placeholder);
  }
  card.appendChild(hero);

  const body = document.createElement('div');
  body.className = 'recipe-card-body';

  const titleEl = document.createElement('div');
  titleEl.className = 'recipe-card-title';
  titleEl.textContent = recipe.title || '(ohne Titel)';
  body.appendChild(titleEl);

  const tags = recipe.tags || [];
  if (tags.length) {
    const tagsEl = document.createElement('div');
    tagsEl.className = 'recipe-card-tags';
    tags.forEach((t) => {
      const chip = document.createElement('span');
      chip.className = 'recipe-card-tag';
      chip.textContent = t;
      tagsEl.appendChild(chip);
    });
    body.appendChild(tagsEl);
  }

  card.appendChild(body);

  if (isAdmin) {
    const actions = document.createElement('div');
    actions.className = 'recipe-card-actions';

    const editIcon = document.createElement('button');
    editIcon.type = 'button';
    editIcon.className = 'recipe-card-icon-btn';
    editIcon.textContent = '✏️';
    editIcon.title = 'Bearbeiten';
    editIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditScreen(recipe);
    });
    actions.appendChild(editIcon);

    const duplicateIcon = document.createElement('button');
    duplicateIcon.type = 'button';
    duplicateIcon.className = 'recipe-card-icon-btn';
    duplicateIcon.textContent = '📋';
    duplicateIcon.title = 'Duplizieren';
    duplicateIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      duplicateRecipe(recipe);
    });
    actions.appendChild(duplicateIcon);

    const deleteIcon = document.createElement('button');
    deleteIcon.type = 'button';
    deleteIcon.className = 'recipe-card-icon-btn';
    deleteIcon.textContent = '🗑️';
    deleteIcon.title = 'Löschen';
    deleteIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteRecipe(recipe);
    });
    actions.appendChild(deleteIcon);

    card.appendChild(actions);
  }

  card.addEventListener('click', () => openViewScreen(recipe));
  return card;
}

async function deleteRecipe(recipe) {
  if (!confirm(`"${recipe.title || 'Rezept'}" wirklich löschen?`)) return;
  try {
    await deleteDoc(doc(db, 'recipes', recipe.id));
    recipes = recipes.filter((r) => r.id !== recipe.id);
    renderTagFilter();
    renderRecipes();
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    alert('Löschen fehlgeschlagen: ' + err.message);
    console.error(err);
  }
}

async function duplicateRecipe(recipe) {
  const nowIso = new Date().toISOString();
  const data = {
    title: recipe.title ? `${recipe.title} (Kopie)` : '',
    tags: recipe.tags || [],
    ingredients: recipe.ingredients || [],
    body: recipe.body || '',
    photos: recipe.photos || [],
  };
  try {
    const newDoc = await addDoc(collection(db, 'recipes'), { ...data, createdAt: nowIso, updatedAt: nowIso });
    recipes.push({ id: newDoc.id, ...data, createdAt: nowIso, updatedAt: nowIso });
    renderTagFilter();
    renderRecipes();
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    alert('Duplizieren fehlgeschlagen: ' + err.message);
    console.error(err);
  }
}

function matchesSearch(recipe, q) {
  if (!q) return true;
  if ((recipe.title || '').toLowerCase().includes(q)) return true;
  if ((recipe.tags || []).some((t) => t.toLowerCase().includes(q))) return true;
  if ((recipe.ingredients || []).some((i) => i.toLowerCase().includes(q))) return true;
  return bodyPlainText(recipe.body).toLowerCase().includes(q);
}

function matchesTagFilter(recipe) {
  if (activeTagFilters.size === 0) return true;
  const tags = new Set((recipe.tags || []).map((t) => t.toLowerCase()));
  return [...activeTagFilters].some((t) => tags.has(t.toLowerCase()));
}

function renderRecipes() {
  const q = searchText.trim().toLowerCase();
  const sorted = recipes
    .filter((r) => matchesSearch(r, q) && matchesTagFilter(r))
    .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'de'));
  recipesListEl.innerHTML = '';
  if (sorted.length === 0) {
    const p = document.createElement('p');
    p.className = 'screen-placeholder';
    p.textContent = recipes.length === 0 ? 'Noch keine Rezepte.' : 'Keine Treffer.';
    recipesListEl.appendChild(p);
  } else {
    sorted.forEach((r) => recipesListEl.appendChild(makeRecipeCard(r)));
  }
}

searchInput.addEventListener('input', () => {
  searchText = searchInput.value;
  renderRecipes();
});

// --- View screen (read-only, admin-only edit button) -----------------------

function openViewScreen(recipe) {
  viewingRecipe = recipe;
  viewTitleEl.textContent = recipe.title || '(ohne Titel)';

  const photo = (recipe.photos || [])[0];
  if (photo) {
    viewHeroImgEl.src = photo;
    viewHeroEl.classList.remove('hidden');
  } else {
    viewHeroImgEl.src = '';
    viewHeroEl.classList.add('hidden');
  }

  const tags = recipe.tags || [];
  viewTagsEl.innerHTML = '';
  if (tags.length) {
    tags.forEach((t) => {
      const chip = document.createElement('span');
      chip.className = 'filter-chip';
      chip.textContent = t;
      viewTagsEl.appendChild(chip);
    });
    viewTagsEl.classList.remove('hidden');
  } else {
    viewTagsEl.classList.add('hidden');
  }

  const ingredients = recipe.ingredients || [];
  viewIngredientsListEl.innerHTML = '';
  if (ingredients.length) {
    ingredients.forEach((line) => {
      const li = document.createElement('li');
      if (ingredientAvailable(line)) {
        const dot = document.createElement('span');
        dot.className = 'recipe-ingredient-dot';
        dot.title = 'Vorrätig';
        li.appendChild(dot);
      }
      const text = document.createElement('span');
      text.textContent = line;
      li.appendChild(text);
      viewIngredientsListEl.appendChild(li);
    });
    viewIngredientsSectionEl.classList.remove('hidden');
  } else {
    viewIngredientsSectionEl.classList.add('hidden');
  }

  const html = bodyToHtml(recipe.body);
  if (html) {
    viewContentEl.innerHTML = html;
    viewContentEl.classList.remove('hidden');
    viewBodyLabelEl.classList.remove('hidden');
  } else {
    viewContentEl.innerHTML = '';
    viewContentEl.classList.add('hidden');
    viewBodyLabelEl.classList.add('hidden');
  }

  viewModal.classList.add('show');
}

function closeViewScreen() {
  viewModal.classList.remove('show');
  viewingRecipe = null;
}

viewCloseBtn.addEventListener('click', closeViewScreen);
viewModal.addEventListener('click', (e) => {
  if (e.target === viewModal) closeViewScreen();
});
viewEditBtn.addEventListener('click', () => {
  if (!viewingRecipe) return;
  const recipe = viewingRecipe;
  closeViewScreen();
  openEditScreen(recipe);
});
viewBodyEl.addEventListener('dblclick', () => {
  if (!isAdmin || !viewingRecipe) return;
  const recipe = viewingRecipe;
  closeViewScreen();
  openEditScreen(recipe);
});

// --- Edit screen (Google Keep-style, autosave) -----------------------------

function setEditStatus(msg, isError) {
  editStatusEl.textContent = msg || '';
  editStatusEl.classList.toggle('error', Boolean(isError));
}

function renderIngredientEditor() {
  editIngredientsEl.innerHTML = '';
  editIngredients.forEach((line, index) => {
    const row = document.createElement('div');
    row.className = 'recipe-ingredient-row';
    row.dataset.index = index;

    const input = document.createElement('input');
    input.className = 'tax-name-input';
    input.placeholder = 'z.B. 500 g Mehl';
    input.value = line;
    input.addEventListener('input', () => {
      editIngredients[index] = input.value;
      scheduleSave();
    });
    // Enter confirms this line and starts the next one — same "+"
    // affordance as editAddIngredientBtn below, just reachable without
    // leaving the keyboard, matching how quickly a real ingredient list
    // gets typed out.
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      editIngredients.push('');
      renderIngredientEditor();
      const inputs = editIngredientsEl.querySelectorAll('.tax-name-input');
      requestAnimationFrame(() => inputs[inputs.length - 1]?.focus());
    });
    row.appendChild(input);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'tax-del';
    del.title = 'Zutat entfernen';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      editIngredients.splice(index, 1);
      renderIngredientEditor();
      scheduleSave();
    });
    row.appendChild(del);

    editIngredientsEl.appendChild(row);
  });
}

editAddIngredientBtn.addEventListener('click', () => {
  editIngredients.push('');
  renderIngredientEditor();
  const inputs = editIngredientsEl.querySelectorAll('.tax-name-input');
  requestAnimationFrame(() => inputs[inputs.length - 1]?.focus());
});

function updateViewportHeight() {
  if (!window.visualViewport) return;
  document.documentElement.style.setProperty('--note-vh', `${window.visualViewport.height}px`);
}

function openEditScreen(recipe) {
  if (!recipe && !loadOk) {
    statusEl.textContent = 'Hinzufügen blockiert: Die Daten wurden zuletzt nicht erfolgreich geladen. Bitte Seite neu laden.';
    return;
  }
  editingRecipeId = recipe ? recipe.id : null;
  dirty = false;
  editTitleInput.value = recipe ? (recipe.title || '') : '';
  editTagsInput.value = recipe ? (recipe.tags || []).join(', ') : '';
  editIngredients = recipe ? [...(recipe.ingredients || [])] : [];
  renderIngredientEditor();
  editBodyInput.innerHTML = recipe ? bodyToHtml(recipe.body || '') : '';
  pendingPhotos = recipe ? (recipe.photos || []).slice(0, 1) : [];
  updatePhotoRemoveBadge();
  setEditStatus('Gespeichert');
  updateViewportHeight();
  editModal.classList.add('show');
  if (!recipe) editTitleInput.focus();
}

async function closeEditScreen() {
  const changed = await persistNow();
  if (dirty) return;
  editModal.classList.remove('show');
  editingRecipeId = null;
  pendingPhotos = [];
  editIngredients = [];
  if (changed) {
    renderTagFilter();
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  }
}

editBackBtn.addEventListener('click', () => closeEditScreen());
editModal.addEventListener('click', (e) => {
  if (e.target === editModal) closeEditScreen();
});

editTitleInput.addEventListener('input', scheduleSave);
editTagsInput.addEventListener('input', scheduleSave);
editBodyInput.addEventListener('input', scheduleSave);

function scheduleSave() {
  dirty = true;
  setEditStatus('Nicht gespeichert');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, SAVE_DEBOUNCE_MS);
}

async function persistNow() {
  clearTimeout(saveTimer);
  if (!dirty || !loadOk) return false;
  dirty = false;
  setEditStatus('Speichert…');
  const data = {
    title: editTitleInput.value.trim(),
    tags: parseTagsInput(editTagsInput.value),
    ingredients: editIngredients.map((line) => line.trim()).filter(Boolean),
    body: editBodyInput.textContent.trim() ? sanitizeBodyHtml(editBodyInput.innerHTML.trim()) : '',
    photos: pendingPhotos,
  };
  const hasContent = Boolean(data.title || data.tags.length || data.ingredients.length || data.body || data.photos.length);
  const nowIso = new Date().toISOString();
  try {
    if (!hasContent) {
      if (!editingRecipeId) {
        setEditStatus('Gespeichert');
        return false;
      }
      await deleteDoc(doc(db, 'recipes', editingRecipeId));
      recipes = recipes.filter((r) => r.id !== editingRecipeId);
      editingRecipeId = null;
      renderRecipes();
      setEditStatus('Gespeichert');
      return true;
    }
    if (!editingRecipeId) {
      const newDoc = await addDoc(collection(db, 'recipes'), { ...data, createdAt: nowIso, updatedAt: nowIso });
      editingRecipeId = newDoc.id;
      recipes.push({ id: newDoc.id, ...data, createdAt: nowIso, updatedAt: nowIso });
    } else {
      await updateDoc(doc(db, 'recipes', editingRecipeId), { ...data, updatedAt: nowIso });
      const idx = recipes.findIndex((r) => r.id === editingRecipeId);
      if (idx >= 0) recipes[idx] = { ...recipes[idx], ...data, updatedAt: nowIso };
    }
    setEditStatus('Gespeichert');
    renderRecipes();
    return true;
  } catch (err) {
    console.error(err);
    setEditStatus('Speichern fehlgeschlagen: ' + err.message, true);
    dirty = true;
    return false;
  }
}

addRecipeBtn.addEventListener('click', () => openEditScreen(null));

// --- Entry point -----------------------------------------------------------

window.addEventListener('erdkeller:signedin', (e) => {
  isAdmin = e.detail.role === 'admin';
  loadRecipes();
});
window.addEventListener('erdkeller:refresh', () => loadRecipes());
