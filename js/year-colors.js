import { db } from './firebase-init.js?v=138';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const listEl = document.getElementById('year-color-list');
const addBtn = document.getElementById('add-year-btn');
const statusEl = document.getElementById('year-color-status');
const ref = doc(db, 'config', 'yearColorMap');

// Mirrors the physical colored stickers already used in the cellar
// (SPEC.md Section 5) — a small fixed palette rather than a free color
// picker, since the point is a handful of easily-told-apart marker colors.
export const PALETTE = [
  { name: 'green', hex: '#3C9142', label: 'Grün' },
  { name: 'blue', hex: '#2F6FED', label: 'Blau' },
  { name: 'pink', hex: '#E85D9C', label: 'Pink' },
  { name: 'yellow', hex: '#F2C94C', label: 'Gelb' },
  { name: 'red', hex: '#E23D3D', label: 'Rot' },
  { name: 'orange', hex: '#F2994A', label: 'Orange' },
  { name: 'black', hex: '#1A1A1A', label: 'Schwarz' },
  { name: 'white', hex: '#FFFFFF', label: 'Weiß' },
];

let yearColorMap = {};
// Same data-integrity guard as taxonomy.js/storage-locations.js.
let loadOk = false;

function defaultMap() {
  return { none: 'white' };
}

async function loadYearColors() {
  try {
    const snap = await getDoc(ref);
    yearColorMap = snap.exists() && snap.data() ? snap.data() : defaultMap();
    if (!('none' in yearColorMap)) yearColorMap.none = 'white';
    loadOk = true;
  } catch (err) {
    statusEl.textContent = 'Fehler beim Laden: ' + err.message + ' — Bearbeiten deaktiviert, bis der Ladevorgang erfolgreich war.';
    console.error(err);
    if (!loadOk) yearColorMap = defaultMap();
    loadOk = false;
  }
  addBtn.disabled = !loadOk;
  render();
}

async function saveYearColors() {
  if (!loadOk) {
    statusEl.textContent = 'Speichern blockiert: Die Daten wurden zuletzt nicht erfolgreich geladen. Bitte Seite neu laden, bevor du änderst.';
    return;
  }
  statusEl.textContent = 'Speichere…';
  try {
    await setDoc(ref, yearColorMap);
    statusEl.textContent = '';
    // stock-checkin/-checkout/-table cache this map in memory and only
    // reload on this event — same bug class as js/taxonomy.js's
    // saveTaxonomy fix.
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    statusEl.textContent = 'Fehler beim Speichern: ' + err.message;
    console.error(err);
  }
}

function sortedKeys() {
  const years = Object.keys(yearColorMap)
    .filter((k) => k !== 'none')
    .sort((a, b) => Number(a) - Number(b));
  return [...years, 'none'];
}

function renderRow(key) {
  const isNone = key === 'none';
  const row = document.createElement('div');
  row.className = 'year-row';
  row.dataset.key = key;

  if (isNone) {
    const label = document.createElement('span');
    label.className = 'year-label';
    label.textContent = 'Kein Datum';
    row.appendChild(label);
  } else {
    const input = document.createElement('input');
    input.className = 'tax-name-input year-input';
    input.value = key;
    input.addEventListener('change', (e) => renameYear(key, e.target.value.trim()));
    row.appendChild(input);
  }

  const swatchRow = document.createElement('div');
  swatchRow.className = 'swatch-row';
  PALETTE.forEach((c) => {
    const btn = document.createElement('button');
    btn.className = 'swatch-btn' + (yearColorMap[key] === c.name ? ' selected' : '');
    btn.style.background = c.hex;
    btn.title = c.label;
    btn.addEventListener('click', () => {
      yearColorMap[key] = c.name;
      saveYearColors();
      render();
    });
    swatchRow.appendChild(btn);
  });
  row.appendChild(swatchRow);

  if (!isNone) {
    const del = document.createElement('button');
    del.className = 'tax-del';
    del.title = 'Jahr löschen';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      if (!confirm(`Jahr "${key}" löschen?`)) return;
      delete yearColorMap[key];
      saveYearColors();
      render();
    });
    row.appendChild(del);
  }

  return row;
}

// Build 117: preserve focus/selection across this innerHTML rebuild, same
// as js/taxonomy.js's render() — saveYearColors()'s own erdkeller:refresh
// dispatch (once its Firestore write completes) loops back into this
// module's own listener a moment later and re-renders, which was tearing
// down the input the add-button flow had just focused before the user
// even blurred it (the actual cause of the keyboard flashing open then
// closing — Build 116's requestAnimationFrame deferral alone didn't
// address this later, async-triggered rebuild).
function render() {
  const active = document.activeElement;
  const preserveKey = active && active.classList.contains('year-input') && listEl.contains(active)
    ? active.closest('[data-key]')?.dataset.key
    : null;
  const preserveSelection = preserveKey ? [active.selectionStart, active.selectionEnd] : null;

  listEl.innerHTML = '';
  sortedKeys().forEach((key) => listEl.appendChild(renderRow(key)));

  if (preserveKey) {
    const input = listEl.querySelector(`[data-key="${preserveKey}"] .year-input`);
    if (input) {
      input.focus();
      input.setSelectionRange(preserveSelection[0], preserveSelection[1]);
    }
  }
}

function renameYear(oldKey, newKey) {
  if (!newKey || newKey === oldKey) {
    render();
    return;
  }
  if (yearColorMap[newKey] !== undefined) {
    alert(`Jahr "${newKey}" existiert bereits.`);
    render();
    return;
  }
  const color = yearColorMap[oldKey];
  delete yearColorMap[oldKey];
  yearColorMap[newKey] = color;
  saveYearColors();
  render();
}

addBtn.addEventListener('click', () => {
  const years = Object.keys(yearColorMap)
    .filter((k) => k !== 'none')
    .map(Number)
    .filter((n) => !isNaN(n));
  let nextYear = years.length ? Math.max(...years) + 1 : new Date().getFullYear();
  while (yearColorMap[String(nextYear)] !== undefined) nextYear++;
  const key = String(nextYear);
  yearColorMap[key] = 'green';
  saveYearColors();
  render();
  // requestAnimationFrame (Build 116) — focusing synchronously right after
  // render()'s innerHTML rebuild made the keyboard flash open then
  // immediately close on a real Android device; deferring one frame lets
  // the reflow settle first (same fix as Taxonomie/Lagerorte).
  requestAnimationFrame(() => {
    const input = listEl.querySelector(`[data-key="${key}"] .year-input`);
    if (input) {
      input.focus();
      input.select();
    }
  });
});

window.addEventListener('erdkeller:signedin', () => loadYearColors());
window.addEventListener('erdkeller:refresh', () => loadYearColors());
