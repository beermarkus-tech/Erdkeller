import { db, hdoc } from './firebase-init.js?v=214';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { t } from './i18n.js?v=214';

const listEl = document.getElementById('storage-list');
const addBtn = document.getElementById('add-storage-btn');
const statusEl = document.getElementById('storage-status');
const ref = () => hdoc('config', 'storageLocations');

let locations = [];
// Same data-integrity guard as taxonomy.js: never let a save persist
// unless the most recent load actually succeeded, so a load failure can't
// silently overwrite real Firestore data with an empty local state.
let loadOk = false;

async function loadStorage() {
  try {
    const snap = await getDoc(ref());
    locations = snap.exists() && Array.isArray(snap.data().locations) ? snap.data().locations : [];
    loadOk = true;
  } catch (err) {
    statusEl.textContent = t('storageLocations.fehler_beim_laden') + err.message + t('storageLocations.bearbeiten_deaktiviert_bis_der_ladevorgang');
    console.error(err);
    if (!loadOk) locations = [];
    loadOk = false;
  }
  addBtn.disabled = !loadOk;
  render();
}

async function saveStorage() {
  if (!loadOk) {
    statusEl.textContent = t('storageLocations.speichern_blockiert_die_daten_wurden');
    return;
  }
  statusEl.textContent = t('storageLocations.speichere');
  try {
    await setDoc(ref(), { locations, updatedAt: new Date().toISOString() });
    statusEl.textContent = '';
    // stock-checkin/-checkout/-table cache this list in memory and only
    // reload on this event — same bug class as js/taxonomy.js's
    // saveTaxonomy fix.
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    statusEl.textContent = t('storageLocations.fehler_beim_speichern') + err.message;
    console.error(err);
  }
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Build 117: preserve focus/selection across this innerHTML rebuild, same
// as js/taxonomy.js's render() — saveStorage()'s own erdkeller:refresh
// dispatch (once its Firestore write completes) loops back into this
// module's own listener a moment later and re-renders, which was tearing
// down the input the add-button flow had just focused before the user
// even blurred it (the actual cause of the keyboard flashing open then
// closing — Build 116's requestAnimationFrame deferral alone didn't
// address this later, async-triggered rebuild).
function render() {
  const active = document.activeElement;
  const preserveIndex = active && active.classList.contains('tax-name-input') && listEl.contains(active)
    ? active.closest('[data-index]')?.dataset.index
    : null;
  const preserveSelection = preserveIndex !== null ? [active.selectionStart, active.selectionEnd] : null;

  listEl.innerHTML = '';
  locations.forEach((name, index) => {
    const row = document.createElement('div');
    row.className = 'storage-row';
    row.dataset.index = index;
    row.innerHTML = `
      <input class="tax-name-input" value="${escapeAttr(name)}" placeholder="${escapeAttr(t('storageLocations.lagerort'))}">
      <button class="tax-del" title="${escapeAttr(t('storageLocations.lagerort_loeschen_title'))}">✕</button>
    `;
    row.querySelector('.tax-name-input').addEventListener('change', (e) => {
      locations[index] = e.target.value.trim();
      saveStorage();
    });
    row.querySelector('.tax-del').addEventListener('click', () => {
      if (!confirm(t('storageLocations.lagerort_loeschen', { name }))) return;
      locations.splice(index, 1);
      saveStorage();
      render();
    });
    listEl.appendChild(row);
  });

  if (preserveIndex !== null) {
    const input = listEl.querySelector(`[data-index="${preserveIndex}"] .tax-name-input`);
    if (input) {
      input.focus();
      input.setSelectionRange(preserveSelection[0], preserveSelection[1]);
    }
  }
}

addBtn.addEventListener('click', () => {
  locations.push(t('storageLocations.neuer_lagerort'));
  saveStorage();
  render();
  // requestAnimationFrame (Build 116) — focusing synchronously right after
  // render()'s innerHTML rebuild made the keyboard flash open then
  // immediately close on a real Android device; deferring one frame lets
  // the reflow settle first (same fix as Taxonomie/Jahresfarben).
  requestAnimationFrame(() => {
    const rows = listEl.querySelectorAll('.storage-row');
    const lastInput = rows[rows.length - 1]?.querySelector('.tax-name-input');
    if (lastInput) {
      lastInput.focus();
      lastInput.select();
    }
  });
});

window.addEventListener('erdkeller:signedin', () => loadStorage());
window.addEventListener('erdkeller:refresh', () => loadStorage());
