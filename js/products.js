import { db } from './firebase-init.js?v=24';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const listEl = document.getElementById('product-list');
const addBtn = document.getElementById('add-product-btn');
const statusEl = document.getElementById('product-status');
const productsRef = collection(db, 'products');
const taxonomyRef = doc(db, 'config', 'taxonomy');

let products = []; // [{id, name, subcategoryId, conversionToKg, conversionNote}]
let subcategoryOptions = []; // [{id, label}] — flattened Type › Category › Subcategory
// Same data-integrity spirit as taxonomy.js, though the stakes differ:
// /products is a real collection (each doc edited/deleted individually),
// not a single doc overwritten wholesale, so a load failure here can't
// wipe the whole catalog the way it could for taxonomy. Still guards the
// UI so you're not editing against a list you know is out of date.
let loadOk = false;

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

async function loadSubcategoryOptions() {
  try {
    const snap = await getDoc(taxonomyRef);
    const taxonomy = snap.exists() && Array.isArray(snap.data().types) ? snap.data() : { types: [] };
    subcategoryOptions = [];
    (taxonomy.types || []).forEach((type) => {
      (type.categories || []).forEach((cat) => {
        (cat.subcategories || []).forEach((sub) => {
          subcategoryOptions.push({ id: sub.id, label: `${type.name} › ${cat.name} › ${sub.name}` });
        });
      });
    });
  } catch (err) {
    console.error(err);
    subcategoryOptions = [];
  }
}

async function loadProducts() {
  try {
    const snap = await getDocs(productsRef);
    products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    loadOk = true;
  } catch (err) {
    statusEl.textContent = 'Fehler beim Laden: ' + err.message;
    console.error(err);
    if (!loadOk) products = [];
    loadOk = false;
  }
  addBtn.disabled = !loadOk;
  render();
}

async function loadAll() {
  await loadSubcategoryOptions();
  await loadProducts();
}

async function updateProduct(id, patch) {
  if (!loadOk) {
    statusEl.textContent = 'Speichern blockiert: Bitte zuerst neu laden.';
    return;
  }
  statusEl.textContent = 'Speichere…';
  try {
    await updateDoc(doc(db, 'products', id), patch);
    statusEl.textContent = '';
  } catch (err) {
    statusEl.textContent = 'Fehler beim Speichern: ' + err.message;
    console.error(err);
  }
}

async function deleteProduct(id, name) {
  if (!confirm(`Produkt "${name}" löschen?`)) return;
  try {
    await deleteDoc(doc(db, 'products', id));
    products = products.filter((p) => p.id !== id);
    render();
  } catch (err) {
    statusEl.textContent = 'Fehler beim Löschen: ' + err.message;
    console.error(err);
  }
}

async function createProduct() {
  const newRef = doc(productsRef);
  const data = {
    name: 'Neues Produkt',
    subcategoryId: subcategoryOptions[0]?.id || '',
    conversionToKg: 1,
    conversionNote: '',
  };
  try {
    await setDoc(newRef, data);
    products.push({ id: newRef.id, ...data });
    render();
    focusNewName(newRef.id);
  } catch (err) {
    statusEl.textContent = 'Fehler beim Erstellen: ' + err.message;
    console.error(err);
  }
}

function focusNewName(id) {
  const input = listEl.querySelector(`[data-id="${id}"] .product-name-input`);
  if (input) {
    input.focus();
    input.select();
  }
}

function renderRow(p) {
  const row = document.createElement('div');
  row.className = 'product-row';
  row.dataset.id = p.id;

  const optionsHtml = subcategoryOptions.length
    ? subcategoryOptions
        .map((s) => `<option value="${escapeAttr(s.id)}"${s.id === p.subcategoryId ? ' selected' : ''}>${escapeAttr(s.label)}</option>`)
        .join('')
    : '<option value="">— keine Unterkategorien angelegt —</option>';

  row.innerHTML = `
    <div class="product-row-main">
      <input class="tax-name-input product-name-input" value="${escapeAttr(p.name || '')}" placeholder="Produktname">
      <button class="tax-del" title="Produkt löschen">✕</button>
    </div>
    <select class="product-subcat-select">${optionsHtml}</select>
    <div class="product-row-conv">
      <input type="number" step="any" class="product-kg-input" value="${p.conversionToKg ?? ''}" placeholder="kg">
      <input class="tax-name-input product-note-input" value="${escapeAttr(p.conversionNote || '')}" placeholder="Hinweis (optional)">
    </div>
  `;

  row.querySelector('.product-name-input').addEventListener('change', (e) => {
    p.name = e.target.value.trim();
    updateProduct(p.id, { name: p.name });
  });
  row.querySelector('.tax-del').addEventListener('click', () => deleteProduct(p.id, p.name));
  row.querySelector('.product-subcat-select').addEventListener('change', (e) => {
    p.subcategoryId = e.target.value;
    updateProduct(p.id, { subcategoryId: p.subcategoryId });
  });
  row.querySelector('.product-kg-input').addEventListener('change', (e) => {
    const val = parseFloat(e.target.value);
    p.conversionToKg = isNaN(val) ? 0 : val;
    updateProduct(p.id, { conversionToKg: p.conversionToKg });
  });
  row.querySelector('.product-note-input').addEventListener('change', (e) => {
    p.conversionNote = e.target.value.trim();
    updateProduct(p.id, { conversionNote: p.conversionNote });
  });

  return row;
}

function render() {
  listEl.innerHTML = '';
  const sorted = [...products].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
  sorted.forEach((p) => listEl.appendChild(renderRow(p)));
}

addBtn.addEventListener('click', createProduct);

window.addEventListener('erdkeller:signedin', () => loadAll());
window.addEventListener('erdkeller:refresh', () => loadAll());
