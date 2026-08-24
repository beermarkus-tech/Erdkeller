import { db } from './firebase-init.js?v=53';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const listEl = document.getElementById('storage-list');
const addBtn = document.getElementById('add-storage-btn');
const statusEl = document.getElementById('storage-status');
const ref = doc(db, 'config', 'storageLocations');

let locations = [];
// Same data-integrity guard as taxonomy.js: never let a save persist
// unless the most recent load actually succeeded, so a load failure can't
// silently overwrite real Firestore data with an empty local state.
let loadOk = false;

async function loadStorage() {
  try {
    const snap = await getDoc(ref);
    locations = snap.exists() && Array.isArray(snap.data().locations) ? snap.data().locations : [];
    loadOk = true;
  } catch (err) {
    statusEl.textContent = 'Fehler beim Laden: ' + err.message + ' — Bearbeiten deaktiviert, bis der Ladevorgang erfolgreich war.';
    console.error(err);
    if (!loadOk) locations = [];
    loadOk = false;
  }
  addBtn.disabled = !loadOk;
  render();
}

async function saveStorage() {
  if (!loadOk) {
    statusEl.textContent = 'Speichern blockiert: Die Daten wurden zuletzt nicht erfolgreich geladen. Bitte Seite neu laden, bevor du änderst.';
    return;
  }
  statusEl.textContent = 'Speichere…';
  try {
    await setDoc(ref, { locations });
    statusEl.textContent = '';
  } catch (err) {
    statusEl.textContent = 'Fehler beim Speichern: ' + err.message;
    console.error(err);
  }
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function render() {
  listEl.innerHTML = '';
  locations.forEach((name, index) => {
    const row = document.createElement('div');
    row.className = 'storage-row';
    row.dataset.index = index;
    row.innerHTML = `
      <input class="tax-name-input" value="${escapeAttr(name)}" placeholder="Lagerort">
      <button class="tax-del" title="Lagerort löschen">✕</button>
    `;
    row.querySelector('.tax-name-input').addEventListener('change', (e) => {
      locations[index] = e.target.value.trim();
      saveStorage();
    });
    row.querySelector('.tax-del').addEventListener('click', () => {
      if (!confirm(`Lagerort "${name}" löschen?`)) return;
      locations.splice(index, 1);
      saveStorage();
      render();
    });
    listEl.appendChild(row);
  });
}

addBtn.addEventListener('click', () => {
  locations.push('Neuer Lagerort');
  saveStorage();
  render();
  const rows = listEl.querySelectorAll('.storage-row');
  const lastInput = rows[rows.length - 1]?.querySelector('.tax-name-input');
  if (lastInput) {
    lastInput.focus();
    lastInput.select();
  }
});

window.addEventListener('erdkeller:signedin', () => loadStorage());
window.addEventListener('erdkeller:refresh', () => loadStorage());
