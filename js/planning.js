// Planung (SPEC.md Section 7) — household roster, autonomy duration, macro
// split, and water rate. Collects the inputs and shows only the resulting
// global numbers (kcal per macro, liters for water); the actual per-
// category/subcategory split lives in Ziele (js/targets.js), which reads
// /config/household and /config/planning directly and recomputes live —
// there is deliberately no "apply" step here. Water no longer needs a
// category picker: which stock counts as water is now a whole Taxonomie
// type tagged Wasser (js/taxonomy.js), summed globally in the Übersicht
// (js/dashboard.js) rather than assigned to one hand-picked category here.
import { db } from './firebase-init.js?v=69';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const planningCard = document.querySelector('.settings-card[data-target="planning"]');
const panelEl = document.getElementById('settings-panel-planning');

const householdListEl = document.getElementById('household-list');
const addHouseholdBtn = document.getElementById('add-household-member-btn');

const autonomyDaysInput = document.getElementById('planning-autonomy-days');
const macroKohlenhydratInput = document.getElementById('planning-macro-kohlenhydrat');
const macroProteinInput = document.getElementById('planning-macro-protein');
const macroFettInput = document.getElementById('planning-macro-fett');
const waterRateInput = document.getElementById('planning-water-rate');
const statusEl = document.getElementById('planning-status');
const computedEl = document.getElementById('planning-computed');

const MACRO_LABELS = { kohlenhydrat: 'Kohlenhydrate', protein: 'Protein', fett: 'Fett' };

let taxonomy = { types: [] };
let household = { members: [] };
let planning = { autonomyDays: null, macroSplit: {}, waterLitersPerPersonDay: null };
let loadOk = false;

function genId() {
  return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

// See js/taxonomy.js's typeClass for the fallback-derivation rationale.
function typeClass(type) {
  if (type.typeClass) return type.typeClass;
  return type.isFoodType ? 'food' : 'other';
}

function hasWaterType() {
  return taxonomy.types.some((type) => typeClass(type) === 'water');
}

// --- Data loading -----------------------------------------------------

async function loadAll() {
  try {
    const [taxSnap, householdSnap, planningSnap] = await Promise.all([
      getDoc(doc(db, 'config', 'taxonomy')),
      getDoc(doc(db, 'config', 'household')),
      getDoc(doc(db, 'config', 'planning')),
    ]);
    taxonomy = taxSnap.exists() && Array.isArray(taxSnap.data().types) ? taxSnap.data() : { types: [] };
    household = {
      members: householdSnap.exists() && Array.isArray(householdSnap.data().members) ? householdSnap.data().members : [],
    };
    const p = planningSnap.exists() ? planningSnap.data() : {};
    planning = {
      autonomyDays: p.autonomyDays ?? null,
      macroSplit: p.macroSplit || {},
      waterLitersPerPersonDay: p.waterLitersPerPersonDay ?? null,
    };
    loadOk = true;
  } catch (err) {
    loadOk = false;
    statusEl.textContent = 'Fehler beim Laden: ' + err.message;
    console.error(err);
  }
  render();
}

async function saveHousehold() {
  if (!loadOk) {
    statusEl.textContent = 'Speichern blockiert: Die Daten wurden zuletzt nicht erfolgreich geladen. Bitte Seite neu laden.';
    return;
  }
  statusEl.textContent = 'Speichere…';
  try {
    await setDoc(doc(db, 'config', 'household'), household);
    statusEl.textContent = '';
    // Dashboard/Ziele cache household+planning in memory and only reload
    // on this event — see js/taxonomy.js's saveTaxonomy for the same fix
    // and the full rationale (this is the same bug class).
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    statusEl.textContent = 'Fehler beim Speichern: ' + err.message;
    console.error(err);
  }
}

async function savePlanning() {
  if (!loadOk) {
    statusEl.textContent = 'Speichern blockiert: Die Daten wurden zuletzt nicht erfolgreich geladen. Bitte Seite neu laden.';
    return;
  }
  statusEl.textContent = 'Speichere…';
  try {
    await setDoc(doc(db, 'config', 'planning'), planning);
    statusEl.textContent = '';
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    statusEl.textContent = 'Fehler beim Speichern: ' + err.message;
    console.error(err);
  }
}

// --- Household roster --------------------------------------------------

function renderHousehold() {
  householdListEl.innerHTML = '';
  household.members.forEach((member) => {
    const row = document.createElement('div');
    row.className = 'tax-sub-row';
    row.dataset.id = member.id;

    const nameInput = document.createElement('input');
    nameInput.className = 'tax-name-input';
    nameInput.placeholder = 'Name';
    nameInput.value = member.name || '';

    const kcalInput = document.createElement('input');
    kcalInput.type = 'number';
    kcalInput.className = 'household-kcal-input';
    kcalInput.placeholder = 'kcal/Tag';
    kcalInput.value = member.kcalPerDay ?? '';

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'tax-del';
    delBtn.title = 'Person entfernen';
    delBtn.textContent = '✕';

    nameInput.addEventListener('change', (e) => {
      member.name = e.target.value.trim();
      saveHousehold();
    });
    kcalInput.addEventListener('change', (e) => {
      member.kcalPerDay = e.target.value === '' ? null : Number(e.target.value);
      saveHousehold();
      renderComputedOutput();
    });
    delBtn.addEventListener('click', () => {
      if (!confirm(`"${member.name || 'Person'}" entfernen?`)) return;
      household.members = household.members.filter((m) => m.id !== member.id);
      saveHousehold();
      render();
    });

    row.appendChild(nameInput);
    row.appendChild(kcalInput);
    row.appendChild(delBtn);
    householdListEl.appendChild(row);
  });
}

addHouseholdBtn.addEventListener('click', () => {
  const member = { id: genId(), name: 'Neue Person', kcalPerDay: null };
  household.members.push(member);
  saveHousehold();
  render();
  const input = householdListEl.querySelector(`[data-id="${member.id}"] .tax-name-input`);
  if (input) {
    input.focus();
    input.select();
  }
});

// --- Autonomy / macro / water fields ------------------------------------

// autonomyDays has no hard default per SPEC.md Section 7 (placeholder hint
// only); macro split and water rate do have real defaults (50/20/30,
// 3 L/person/day), so those fields always show a number even before the
// admin has saved anything.
function syncPlanningFields() {
  autonomyDaysInput.value = planning.autonomyDays ?? '';
  macroKohlenhydratInput.value = planning.macroSplit.kohlenhydrat ?? 50;
  macroProteinInput.value = planning.macroSplit.protein ?? 20;
  macroFettInput.value = planning.macroSplit.fett ?? 30;
  waterRateInput.value = planning.waterLitersPerPersonDay ?? 3;
}

autonomyDaysInput.addEventListener('input', renderComputedOutput);
autonomyDaysInput.addEventListener('change', () => {
  planning.autonomyDays = autonomyDaysInput.value === '' ? null : Number(autonomyDaysInput.value);
  savePlanning();
});

[['kohlenhydrat', macroKohlenhydratInput], ['protein', macroProteinInput], ['fett', macroFettInput]].forEach(([key, input]) => {
  input.addEventListener('input', renderComputedOutput);
  input.addEventListener('change', () => {
    planning.macroSplit[key] = input.value === '' ? null : Number(input.value);
    savePlanning();
  });
});

waterRateInput.addEventListener('input', renderComputedOutput);
waterRateInput.addEventListener('change', () => {
  planning.waterLitersPerPersonDay = waterRateInput.value === '' ? null : Number(waterRateInput.value);
  savePlanning();
});

// --- Global computed output -----------------------------------------------

function peopleCount() {
  return household.members.length;
}

function totalDailyKcal() {
  return household.members.reduce((sum, m) => sum + (Number(m.kcalPerDay) || 0), 0);
}

function currentAutonomyDays() {
  return Number(autonomyDaysInput.value) || 0;
}

function currentMacroSplit() {
  return {
    kohlenhydrat: Number(macroKohlenhydratInput.value) || 0,
    protein: Number(macroProteinInput.value) || 0,
    fett: Number(macroFettInput.value) || 0,
  };
}

function currentWaterRate() {
  return Number(waterRateInput.value) || 0;
}

function makeComputedRow(label, valueText) {
  const row = document.createElement('div');
  row.className = 'computed-row';
  const labelEl = document.createElement('span');
  labelEl.className = 'computed-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'computed-value';
  valueEl.textContent = valueText;
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

// The four global numbers this screen exists to produce — Ziele reads
// /config/household + /config/planning directly and live-computes the same
// values itself to split across tagged categories/subcategories, so there
// is deliberately no "apply" action here anymore (SPEC.md Section 7).
function renderComputedOutput() {
  computedEl.innerHTML = '';
  const people = peopleCount();
  const days = currentAutonomyDays();
  if (people === 0 || days <= 0) {
    const empty = document.createElement('p');
    empty.className = 'screen-placeholder';
    empty.textContent = people === 0
      ? 'Bitte zuerst Haushaltsmitglieder hinzufügen.'
      : 'Bitte eine Autonomiedauer (Tage) eingeben.';
    computedEl.appendChild(empty);
    return;
  }

  const totalKcal = totalDailyKcal() * days;
  const split = currentMacroSplit();
  ['kohlenhydrat', 'protein', 'fett'].forEach((macro) => {
    const macroKcal = totalKcal * (split[macro] || 0) / 100;
    computedEl.appendChild(makeComputedRow(MACRO_LABELS[macro], `${Math.round(macroKcal).toLocaleString('de-DE')} kcal`));
  });

  const waterLiters = currentWaterRate() * people * days;
  const waterLabel = hasWaterType() ? 'Wasser' : 'Wasser (kein Wasser-Typ in der Taxonomie markiert)';
  computedEl.appendChild(makeComputedRow(waterLabel, `${Math.round(waterLiters * 100) / 100} L`));
}

// --- Entry point -----------------------------------------------------------

function render() {
  renderHousehold();
  syncPlanningFields();
  renderComputedOutput();
}

planningCard.addEventListener('click', () => loadAll());

window.addEventListener('erdkeller:refresh', () => {
  if (!panelEl.classList.contains('hidden')) loadAll();
});
