// Step 11c — Planung: household roster, autonomy duration, macro split and
// water rate, and the resulting per-category kg suggestions (SPEC.md
// Section 7). This is a calculator that feeds Ziele (js/targets.js), not a
// live-linked source of truth — "Anwenden" on a suggestion row writes a
// normal flat kg target into /config/targets and from then on it's just a
// regular manually-set target.
import { db } from './firebase-init.js?v=47';
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
const waterCategorySelect = document.getElementById('planning-water-category');
const statusEl = document.getElementById('planning-status');
const suggestionsEl = document.getElementById('planning-suggestions');

const MACRO_LABELS = { kohlenhydrat: 'Kohlenhydrate', protein: 'Protein', fett: 'Fett' };

let taxonomy = { types: [] };
let household = { members: [] };
let planning = { autonomyDays: null, macroSplit: {}, waterLitersPerPersonDay: null, waterCategoryId: '' };
let loadOk = false;

function genId() {
  return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

// Same gating rule as js/taxonomy.js's categoryPlanningEnabled — unchecking
// "Für Vorratsplanung berücksichtigen" on a category must stop it from
// feeding these suggestions even though its kcal/macro/diversity data is
// still sitting there in Firestore, ready to come back the moment it's
// re-checked.
function categoryPlanningEnabled(cat) {
  if (cat.planningEnabled != null) return !!cat.planningEnabled;
  return cat.kcalPerKg != null || !!cat.macroType || cat.diversityFloorGramsPerPersonDay != null;
}

function flatCategories() {
  const list = [];
  taxonomy.types.forEach((type) => {
    (type.categories || []).forEach((cat) => list.push({ id: cat.id, name: cat.name, cat }));
  });
  return list;
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
      waterCategoryId: p.waterCategoryId || '',
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
  } catch (err) {
    statusEl.textContent = 'Fehler beim Speichern: ' + err.message;
    console.error(err);
  }
}

// Applying a suggestion must never clobber a concurrent edit made in
// js/targets.js (or another applied suggestion in the same session), so it
// always does a fresh read-merge-write of the whole /config/targets doc
// rather than trusting any in-memory copy.
async function applySuggestion(categoryId, kg) {
  try {
    const ref = doc(db, 'config', 'targets');
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    const categories = { ...(data.categories || {}) };
    categories[categoryId] = { mode: 'flat', amount: Math.round(kg * 100) / 100, unit: 'kg' };
    await setDoc(ref, { ...data, categories });
  } catch (err) {
    console.error(err);
    alert('Fehler beim Anwenden: ' + err.message);
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
      renderSuggestions();
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

function renderWaterCategoryOptions() {
  const current = planning.waterCategoryId || '';
  waterCategorySelect.innerHTML = '';
  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = '– Kategorie wählen –';
  waterCategorySelect.appendChild(emptyOpt);
  flatCategories().forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    waterCategorySelect.appendChild(opt);
  });
  waterCategorySelect.value = current;
}

autonomyDaysInput.addEventListener('input', renderSuggestions);
autonomyDaysInput.addEventListener('change', () => {
  planning.autonomyDays = autonomyDaysInput.value === '' ? null : Number(autonomyDaysInput.value);
  savePlanning();
});

[['kohlenhydrat', macroKohlenhydratInput], ['protein', macroProteinInput], ['fett', macroFettInput]].forEach(([key, input]) => {
  input.addEventListener('input', renderSuggestions);
  input.addEventListener('change', () => {
    planning.macroSplit[key] = input.value === '' ? null : Number(input.value);
    savePlanning();
  });
});

waterRateInput.addEventListener('input', renderSuggestions);
waterRateInput.addEventListener('change', () => {
  planning.waterLitersPerPersonDay = waterRateInput.value === '' ? null : Number(waterRateInput.value);
  savePlanning();
});

waterCategorySelect.addEventListener('change', () => {
  planning.waterCategoryId = waterCategorySelect.value;
  savePlanning();
  renderSuggestions();
});

// --- Suggestions ---------------------------------------------------------

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

function makeSuggestionRow(categoryId, title, note, kg) {
  const row = document.createElement('div');
  row.className = 'suggestion-row';

  const info = document.createElement('div');
  info.className = 'suggestion-info';
  const titleEl = document.createElement('div');
  titleEl.className = 'suggestion-title';
  titleEl.textContent = title;
  const noteEl = document.createElement('div');
  noteEl.className = 'suggestion-note';
  noteEl.textContent = note;
  info.appendChild(titleEl);
  info.appendChild(noteEl);

  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.01';
  input.className = 'suggestion-input';
  input.value = Math.round(kg * 100) / 100;

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'suggestion-apply-btn';
  applyBtn.textContent = 'Anwenden';
  applyBtn.addEventListener('click', async () => {
    const amount = Number(input.value);
    if (input.value === '' || isNaN(amount)) return;
    applyBtn.disabled = true;
    applyBtn.textContent = '…';
    await applySuggestion(categoryId, amount);
    applyBtn.textContent = '✓ Übernommen';
    setTimeout(() => {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Anwenden';
    }, 1500);
  });

  row.appendChild(info);
  row.appendChild(input);
  row.appendChild(applyBtn);
  return row;
}

function renderSuggestions() {
  suggestionsEl.innerHTML = '';
  const people = peopleCount();
  if (people === 0) {
    const empty = document.createElement('p');
    empty.className = 'screen-placeholder';
    empty.textContent = 'Bitte zuerst Haushaltsmitglieder hinzufügen.';
    suggestionsEl.appendChild(empty);
    return;
  }

  const days = currentAutonomyDays();
  if (days <= 0) {
    const empty = document.createElement('p');
    empty.className = 'screen-placeholder';
    empty.textContent = 'Bitte eine Autonomiedauer (Tage) eingeben.';
    suggestionsEl.appendChild(empty);
    return;
  }

  const totalKcal = totalDailyKcal() * days;
  const split = currentMacroSplit();
  const cats = flatCategories();

  let anySection = false;

  ['kohlenhydrat', 'protein', 'fett'].forEach((macro) => {
    const taggedCats = cats.filter(({ cat }) => categoryPlanningEnabled(cat) && cat.macroType === macro && cat.kcalPerKg != null);
    if (taggedCats.length === 0) return;
    anySection = true;
    const macroKcal = totalKcal * (split[macro] || 0) / 100;
    const groupLabel = document.createElement('div');
    groupLabel.className = 'section-label';
    groupLabel.textContent = `${MACRO_LABELS[macro]} — ${Math.round(macroKcal)} kcal gesamt`;
    suggestionsEl.appendChild(groupLabel);
    taggedCats.forEach(({ id, name, cat }) => {
      const kg = cat.kcalPerKg > 0 ? macroKcal / cat.kcalPerKg : 0;
      suggestionsEl.appendChild(makeSuggestionRow(
        id, name, `${cat.kcalPerKg} kcal/kg · als einzige Quelle für ${MACRO_LABELS[macro]}`, kg,
      ));
    });
  });

  const diversityCats = cats.filter(({ cat }) => categoryPlanningEnabled(cat) && cat.diversityFloorGramsPerPersonDay != null);
  if (diversityCats.length > 0) {
    anySection = true;
    const groupLabel = document.createElement('div');
    groupLabel.className = 'section-label';
    groupLabel.textContent = 'Diversität';
    suggestionsEl.appendChild(groupLabel);
    diversityCats.forEach(({ id, name, cat }) => {
      const kg = (cat.diversityFloorGramsPerPersonDay / 1000) * people * days;
      suggestionsEl.appendChild(makeSuggestionRow(
        id, name, `${cat.diversityFloorGramsPerPersonDay} g/Person/Tag × ${people} Personen × ${days} Tage`, kg,
      ));
    });
  }

  if (planning.waterCategoryId) {
    const waterCat = cats.find((c) => c.id === planning.waterCategoryId);
    if (waterCat) {
      anySection = true;
      const groupLabel = document.createElement('div');
      groupLabel.className = 'section-label';
      groupLabel.textContent = 'Wasser';
      suggestionsEl.appendChild(groupLabel);
      const rate = currentWaterRate();
      const kg = rate * people * days;
      suggestionsEl.appendChild(makeSuggestionRow(
        waterCat.id, waterCat.name, `${rate} L/Person/Tag × ${people} Personen × ${days} Tage`, kg,
      ));
    }
  }

  if (!anySection) {
    const empty = document.createElement('p');
    empty.className = 'screen-placeholder';
    empty.textContent = 'Keine Kategorien für die Vorratsplanung markiert. In der Taxonomie kcal/kg, Makro oder Diversität setzen, oder eine Wasser-Kategorie wählen.';
    suggestionsEl.appendChild(empty);
  }
}

// --- Entry point -----------------------------------------------------------

function render() {
  renderHousehold();
  syncPlanningFields();
  renderWaterCategoryOptions();
  renderSuggestions();
}

planningCard.addEventListener('click', () => loadAll());

window.addEventListener('erdkeller:refresh', () => {
  if (!panelEl.classList.contains('hidden')) loadAll();
});
