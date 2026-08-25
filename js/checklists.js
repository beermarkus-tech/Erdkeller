// Checklisten (Step 12) — Wartung (maintenance) + Krise (crisis reference).
//
// Deliberately NOT integrated with Bestand/Ziele at all — an earlier draft
// considered linking stock-flavored items (e.g. "Klopapier (2x)") straight
// to a taxonomy product so the checkbox could reflect live stock status,
// but that means mapping ~40 items to real products, keeping that mapping
// alive as the taxonomy changes, and inventing what "satisfied" means for
// a "(4x)" style count that doesn't fit Ziele's target model. Rejected in
// favor of the simplest possible item: text + frequency + checkbox, full
// stop, completely decoupled from Bestand.
//
// Completion model — deliberately NOT the classic "nextDue rolls forward
// from whenever you last completed it" scheduler. Markus's real workflow
// is a single once-a-month sitting working through everything due, not a
// per-item rolling timer, so each item just carries a `frequency` and a
// `lastCompletedAt` timestamp; "done for the current period" is *derived*
// by comparing the calendar period (week/month/quarter/year) of
// lastCompletedAt against the current one — the same "compute a period-
// bucket integer, compare current vs. stored" shape js/dashboard.js's MHD
// alerts already use for month-index comparisons. Ticking a box sets
// lastCompletedAt to now; the box silently resets unchecked the moment the
// calendar rolls into a new period, whether or not it was ever checked in
// the period that just ended — no rescheduling logic, no drift.
//
// No "einmalig" (one-time) frequency — every item gets a real recurring
// cadence (Markus: "even one-time topics need to be checked occasionally
// if still there"). Items that were one-time in the source list (Kompass,
// Reisepass, ...) are seeded as yearly, the closest "occasionally" already
// in the model.
import { db } from './firebase-init.js?v=72';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

// --- DOM refs: main screen ------------------------------------------------

const checklistsTabBtns = document.querySelectorAll('.seg-btn[data-checklists-tab]');
const checklistsTabPanels = document.querySelectorAll('.checklists-tab[data-checklists-tab-panel]');
const maintenanceFilterButtons = document.querySelectorAll('#maintenance-filter-toggle .select-mode-btn');
const maintenanceListEl = document.getElementById('maintenance-list');
const crisisListEl = document.getElementById('crisis-list');
const crisisReferenceEl = document.getElementById('crisis-reference');
const crisisReferenceCloseBtn = document.getElementById('crisis-reference-close');
const crisisReferenceTitleEl = document.getElementById('crisis-reference-title');
const crisisReferenceStepsEl = document.getElementById('crisis-reference-steps');

// --- DOM refs: Settings → Checklisten editor -------------------------------

const checklistsCard = document.querySelector('.settings-card[data-target="checklists"]');
const checklistsEditTabBtns = document.querySelectorAll('.seg-btn[data-checklists-edit-tab]');
const checklistsEditTabPanels = document.querySelectorAll('.checklists-edit-tab[data-checklists-edit-tab-panel]');
const maintenanceEditorEl = document.getElementById('maintenance-editor');
const addMaintenanceListBtn = document.getElementById('add-maintenance-list-btn');
const importMaintenanceBtn = document.getElementById('import-maintenance-btn');
const crisisEditorEl = document.getElementById('crisis-editor');
const addCrisisTypeBtn = document.getElementById('add-crisis-type-btn');
const statusEl = document.getElementById('checklists-status');

const maintenanceRef = doc(db, 'config', 'checklists');
const crisisRef = doc(db, 'config', 'crisisTypes');

const RECIPIENT_OPTIONS = [
  { id: 'markus', label: 'Markus' },
  { id: 'julia', label: 'Julia' },
  { id: 'sophia', label: 'Sophia' },
];

const FREQ_LABELS = {
  weekly: 'Wöchentlich', monthly: 'Monatlich', quarterly: 'Vierteljährlich', yearly: 'Jährlich',
};

let maintenance = { lists: [] };
let crisis = { types: [] };
// Same data-integrity guard as taxonomy.js/storage-locations.js.
let loadOk = false;
let maintenanceFilter = 'due'; // 'due' | 'all'

function genId() {
  return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// --- Data loading -----------------------------------------------------

async function loadAll() {
  try {
    const [mSnap, cSnap] = await Promise.all([getDoc(maintenanceRef), getDoc(crisisRef)]);
    maintenance = mSnap.exists() && Array.isArray(mSnap.data().lists) ? mSnap.data() : { lists: [] };
    crisis = cSnap.exists() && Array.isArray(cSnap.data().types) ? cSnap.data() : { types: [] };
    loadOk = true;
  } catch (err) {
    loadOk = false;
    statusEl.textContent = 'Fehler beim Laden: ' + err.message;
    console.error(err);
  }
  render();
}

async function saveMaintenance() {
  if (!loadOk) {
    statusEl.textContent = 'Speichern blockiert: Die Daten wurden zuletzt nicht erfolgreich geladen. Bitte Seite neu laden.';
    return;
  }
  try {
    await setDoc(maintenanceRef, maintenance);
    statusEl.textContent = '';
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    statusEl.textContent = 'Fehler beim Speichern: ' + err.message;
    console.error(err);
  }
}

async function saveCrisis() {
  if (!loadOk) {
    statusEl.textContent = 'Speichern blockiert: Die Daten wurden zuletzt nicht erfolgreich geladen. Bitte Seite neu laden.';
    return;
  }
  try {
    await setDoc(crisisRef, crisis);
    statusEl.textContent = '';
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    statusEl.textContent = 'Fehler beim Speichern: ' + err.message;
    console.error(err);
  }
}

// --- Period-bucket completion model --------------------------------------

// Not true ISO-8601 week numbering — just a stable, monotonically
// increasing bucket that changes roughly weekly. That's all a household
// chore tracker needs; exact Mon-Sun calendar alignment isn't worth the
// extra code.
function weekBucket(d) {
  const epochDays = Math.floor(d.getTime() / 86400000);
  return Math.floor(epochDays / 7);
}

function periodBucket(frequency, d) {
  if (frequency === 'weekly') return 'w' + weekBucket(d);
  if (frequency === 'monthly') return 'm' + (d.getFullYear() * 12 + d.getMonth());
  if (frequency === 'quarterly') return 'q' + (d.getFullYear() * 4 + Math.floor(d.getMonth() / 3));
  return 'y' + d.getFullYear();
}

function isDoneThisPeriod(item) {
  if (!item.lastCompletedAt) return false;
  return periodBucket(item.frequency, new Date(item.lastCompletedAt)) === periodBucket(item.frequency, new Date());
}

function formatLastDone(iso) {
  const d = new Date(iso);
  return `zuletzt: ${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function toggleItemDone(item) {
  item.lastCompletedAt = isDoneThisPeriod(item) ? null : new Date().toISOString();
  saveMaintenance();
  renderMaintenanceList();
}

// --- Main screen: Wartung -------------------------------------------------

function renderMaintenanceList() {
  maintenanceListEl.innerHTML = '';
  if (!loadOk) return;
  maintenance.lists.forEach((list) => {
    const dueItems = (list.items || []).filter((it) => !isDoneThisPeriod(it));
    const items = maintenanceFilter === 'due' ? dueItems : (list.items || []);
    if (items.length === 0) return;

    const group = document.createElement('div');
    group.className = 'checklist-group';
    const header = document.createElement('div');
    header.className = 'checklist-group-header';
    header.innerHTML = `
      <div class="checklist-group-name">${list.name}</div>
      ${dueItems.length > 0 ? `<div class="checklist-group-badge">${dueItems.length} offen</div>` : ''}
    `;
    group.appendChild(header);

    items.forEach((item) => {
      const done = isDoneThisPeriod(item);
      const row = document.createElement('div');
      row.className = 'checklist-item-row';
      row.innerHTML = `
        <input type="checkbox" class="checklist-item-check" ${done ? 'checked' : ''}>
        <div class="checklist-item-main">
          <div class="checklist-item-text">${item.text}</div>
          <div class="checklist-item-meta">
            <span class="checklist-freq-tag">${FREQ_LABELS[item.frequency] || item.frequency}</span>
            ${item.lastCompletedAt ? `<span class="checklist-item-lastdone">${formatLastDone(item.lastCompletedAt)}</span>` : ''}
          </div>
        </div>
      `;
      row.querySelector('.checklist-item-check').addEventListener('change', () => toggleItemDone(item));
      group.appendChild(row);
    });

    maintenanceListEl.appendChild(group);
  });

  if (!maintenanceListEl.children.length) {
    const p = document.createElement('p');
    p.className = 'screen-placeholder';
    p.textContent = maintenanceFilter === 'due'
      ? 'Nichts fällig — alles erledigt.'
      : 'Noch keine Checklisten vorhanden (Settings → Checklisten).';
    maintenanceListEl.appendChild(p);
  }
}

maintenanceFilterButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    maintenanceFilter = btn.dataset.filter;
    maintenanceFilterButtons.forEach((b) => b.classList.toggle('active', b === btn));
    renderMaintenanceList();
  });
});

// --- Main screen: Krise ----------------------------------------------------

function renderCrisisList() {
  crisisListEl.innerHTML = '';
  if (!loadOk) return;
  if (crisis.types.length === 0) {
    const p = document.createElement('p');
    p.className = 'screen-placeholder';
    p.textContent = 'Noch keine Krisentypen angelegt (Settings → Checklisten).';
    crisisListEl.appendChild(p);
    return;
  }
  crisis.types.forEach((type) => {
    const card = document.createElement('div');
    card.className = 'crisis-card';
    card.innerHTML = `
      <span class="sym">${type.sym || '⚠️'}</span>
      <span class="crisis-card-name">${type.name}</span>
      <span class="chev">›</span>
    `;
    card.addEventListener('click', () => openCrisisReference(type));
    crisisListEl.appendChild(card);
  });
}

// Full-screen, high-contrast, read-only — a pure read-through reference for
// fast calm reading under stress, deliberately no checkboxes or progress
// tracking (SPEC.md Section 8).
function openCrisisReference(type) {
  crisisReferenceTitleEl.textContent = type.name;
  crisisReferenceStepsEl.innerHTML = '';
  (type.steps || []).forEach((step) => {
    const p = document.createElement('p');
    p.textContent = step.text;
    crisisReferenceStepsEl.appendChild(p);
  });
  crisisReferenceEl.classList.add('show');
}

crisisReferenceCloseBtn.addEventListener('click', () => {
  crisisReferenceEl.classList.remove('show');
});

// --- Main screen: tabs ------------------------------------------------

checklistsTabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    checklistsTabBtns.forEach((b) => b.classList.toggle('active', b === btn));
    checklistsTabPanels.forEach((p) => p.classList.toggle('hidden', p.dataset.checklistsTabPanel !== btn.dataset.checklistsTab));
  });
});

// --- Settings → Checklisten editor: Wartung -------------------------------

function focusFirstInput(container) {
  const input = container.querySelector('.tax-name-input:last-of-type') || container.querySelector('.tax-name-input');
  if (input) {
    input.focus();
    input.select();
  }
}

function renderMaintenanceEditor() {
  maintenanceEditorEl.innerHTML = '';
  maintenance.lists.forEach((list) => {
    const group = document.createElement('div');
    group.className = 'checklist-edit-group';

    const head = document.createElement('div');
    head.className = 'checklist-edit-head';
    head.innerHTML = `
      <input class="tax-name-input" value="${escapeAttr(list.name)}" placeholder="Checklistenname">
      <button class="tax-del" title="Checkliste löschen">✕</button>
    `;
    head.querySelector('.tax-name-input').addEventListener('change', (e) => {
      list.name = e.target.value.trim();
      saveMaintenance();
    });
    head.querySelector('.tax-del').addEventListener('click', () => {
      if (!confirm(`Checkliste "${list.name}" inkl. aller Einträge löschen?`)) return;
      maintenance.lists = maintenance.lists.filter((l) => l.id !== list.id);
      saveMaintenance();
      renderMaintenanceEditor();
    });
    group.appendChild(head);

    const recipients = document.createElement('div');
    recipients.className = 'checklist-recipients';
    recipients.innerHTML = RECIPIENT_OPTIONS.map((r) => `
      <label><input type="checkbox" data-recipient="${r.id}"${(list.recipients || []).includes(r.id) ? ' checked' : ''}> ${r.label}</label>
    `).join('');
    recipients.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (!list.recipients) list.recipients = [];
        const id = cb.dataset.recipient;
        if (cb.checked) {
          if (!list.recipients.includes(id)) list.recipients.push(id);
        } else {
          list.recipients = list.recipients.filter((r) => r !== id);
        }
        saveMaintenance();
      });
    });
    group.appendChild(recipients);

    (list.items || []).forEach((item) => {
      const row = document.createElement('div');
      row.className = 'checklist-edit-item-row';
      row.innerHTML = `
        <input class="tax-name-input" value="${escapeAttr(item.text)}" placeholder="Eintrag">
        <select class="checklist-freq-select">
          <option value="weekly"${item.frequency === 'weekly' ? ' selected' : ''}>Wöchentlich</option>
          <option value="monthly"${item.frequency === 'monthly' ? ' selected' : ''}>Monatlich</option>
          <option value="quarterly"${item.frequency === 'quarterly' ? ' selected' : ''}>Vierteljährlich</option>
          <option value="yearly"${item.frequency === 'yearly' ? ' selected' : ''}>Jährlich</option>
        </select>
        <button class="tax-del" title="Eintrag löschen">✕</button>
      `;
      row.querySelector('.tax-name-input').addEventListener('change', (e) => {
        item.text = e.target.value.trim();
        saveMaintenance();
      });
      row.querySelector('.checklist-freq-select').addEventListener('change', (e) => {
        item.frequency = e.target.value;
        saveMaintenance();
      });
      row.querySelector('.tax-del').addEventListener('click', () => {
        list.items = list.items.filter((it) => it.id !== item.id);
        saveMaintenance();
        renderMaintenanceEditor();
      });
      group.appendChild(row);
    });

    const addItemBtn = document.createElement('button');
    addItemBtn.type = 'button';
    addItemBtn.className = 'add-row-btn small';
    addItemBtn.textContent = '+ Eintrag hinzufügen';
    addItemBtn.addEventListener('click', () => {
      if (!list.items) list.items = [];
      list.items.push({
        id: genId(), text: 'Neuer Eintrag', frequency: 'yearly', lastCompletedAt: null,
      });
      saveMaintenance();
      renderMaintenanceEditor();
      focusFirstInput(group);
    });
    group.appendChild(addItemBtn);

    maintenanceEditorEl.appendChild(group);
  });
}

addMaintenanceListBtn.addEventListener('click', () => {
  maintenance.lists.push({
    id: genId(), name: 'Neue Checkliste', recipients: ['markus'], items: [],
  });
  saveMaintenance();
  renderMaintenanceEditor();
});

// --- Settings → Checklisten editor: Krise ---------------------------------

function renderCrisisEditor() {
  crisisEditorEl.innerHTML = '';
  crisis.types.forEach((type) => {
    const group = document.createElement('div');
    group.className = 'checklist-edit-group';

    const head = document.createElement('div');
    head.className = 'checklist-edit-head';
    head.innerHTML = `
      <input class="tax-sym-input" value="${escapeAttr(type.sym || '')}" placeholder="⚠️">
      <input class="tax-name-input" value="${escapeAttr(type.name)}" placeholder="Krisentyp">
      <button class="tax-del" title="Krisentyp löschen">✕</button>
    `;
    head.querySelector('.tax-sym-input').addEventListener('change', (e) => {
      type.sym = e.target.value.trim();
      saveCrisis();
    });
    head.querySelector('.tax-name-input').addEventListener('change', (e) => {
      type.name = e.target.value.trim();
      saveCrisis();
    });
    head.querySelector('.tax-del').addEventListener('click', () => {
      if (!confirm(`Krisentyp "${type.name}" inkl. aller Schritte löschen?`)) return;
      crisis.types = crisis.types.filter((t) => t.id !== type.id);
      saveCrisis();
      renderCrisisEditor();
    });
    group.appendChild(head);

    (type.steps || []).forEach((step) => {
      const row = document.createElement('div');
      row.className = 'checklist-edit-item-row';
      row.innerHTML = `
        <input class="tax-name-input" value="${escapeAttr(step.text)}" placeholder="Schritt">
        <button class="tax-del" title="Schritt löschen">✕</button>
      `;
      row.querySelector('.tax-name-input').addEventListener('change', (e) => {
        step.text = e.target.value.trim();
        saveCrisis();
      });
      row.querySelector('.tax-del').addEventListener('click', () => {
        type.steps = type.steps.filter((s) => s.id !== step.id);
        saveCrisis();
        renderCrisisEditor();
      });
      group.appendChild(row);
    });

    const addStepBtn = document.createElement('button');
    addStepBtn.type = 'button';
    addStepBtn.className = 'add-row-btn small';
    addStepBtn.textContent = '+ Schritt hinzufügen';
    addStepBtn.addEventListener('click', () => {
      if (!type.steps) type.steps = [];
      type.steps.push({ id: genId(), text: '' });
      saveCrisis();
      renderCrisisEditor();
      focusFirstInput(group);
    });
    group.appendChild(addStepBtn);

    crisisEditorEl.appendChild(group);
  });
}

addCrisisTypeBtn.addEventListener('click', () => {
  crisis.types.push({
    id: genId(), name: 'Neuer Krisentyp', sym: '', steps: [],
  });
  saveCrisis();
  renderCrisisEditor();
});

checklistsEditTabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    checklistsEditTabBtns.forEach((b) => b.classList.toggle('active', b === btn));
    checklistsEditTabPanels.forEach((p) => p.classList.toggle('hidden', p.dataset.checklistsEditTabPanel !== btn.dataset.checklistsEditTab));
  });
});

// --- One-time seed import --------------------------------------------------
// Markus's real checklist, transcribed once. Adds to whatever's already
// there rather than replacing it, so it's safe alongside manual edits —
// but running it twice does duplicate every item, hence the confirm.

const SEED_MAINTENANCE = [
  { name: 'Ausrüstung', items: [
    ['Baseballschläger', 'yearly'], ['Batterien AA, AAA (Haltbarkeit prüfen)', 'yearly'],
    ['Campinglampe prüfen / aufladen', 'monthly'], ['Chlor choque', 'yearly'],
    ['Feuerstahl', 'yearly'], ['Feuerzeuge', 'yearly'], ['Kerzenvorrat', 'yearly'],
    ['Kompass', 'yearly'], ['Leatherman', 'yearly'], ['Pfefferspray', 'yearly'],
    ['Powerbank prüfen / aufladen', 'monthly'], ['Radio prüfen / aufladen', 'monthly'],
    ['Starke Taschenlampe & Akkus prüfen / aufladen', 'monthly'], ['Streichhölzer', 'yearly'],
    ['Taschenlampen', 'yearly'], ['Wasserfilter', 'yearly'], ['Wanderkarte Umgebung vorhanden?', 'yearly'],
  ] },
  { name: 'Autos', items: [
    ['Ab Oktober: Autotanks immer halbvoll', 'weekly'], ['Ab Oktober: Benzinkanister Rasenmäher voll?', 'monthly'],
    ['Ab Oktober: Dieselkanister durchtauschen', 'monthly'], ['Ab Oktober: Ölstand kontrollieren', 'monthly'],
  ] },
  { name: 'Dokumente', items: [
    ['Ausweise: Personalausweis Julia', 'yearly'], ['Ausweise: Personalausweis Markus', 'yearly'],
    ['Ausweise: Reisepass Julia', 'yearly'], ['Ausweise: Reisepass Markus', 'yearly'],
    ['Ausweise: Reisepass Sophia', 'yearly'], ['Autos: Carte Grise (Touran)', 'yearly'],
    ['Autos: Carte Grise (Volvo)', 'yearly'], ['Autos: Führerschein Julia', 'yearly'],
    ['Autos: Führerschein Markus', 'yearly'], ['Eltern: Patientenverfügung Beers', 'yearly'],
    ['Familienbuch: Eheurkunde (D & F)', 'yearly'], ['Familienbuch: Geburtsurkunde Julia', 'yearly'],
    ['Familienbuch: Geburtsurkunde Markus', 'yearly'], ['Familienbuch: Geburtsurkunde Sophia (D & F)', 'yearly'],
    ['Gesundheit: Blutgruppenausweis Julia', 'yearly'], ['Gesundheit: Blutgruppenausweis Markus', 'yearly'],
    ['Gesundheit: Impfheft Julia', 'yearly'], ['Gesundheit: Impfheft Markus', 'yearly'],
    ['Gesundheit: Impfheft Sophia', 'yearly'], ['Gesundheit: Sozialversicherungsausweis Markus', 'yearly'],
    ['Haus: Attestation Compromis de Vente', 'yearly'], ['Kreditkarten', 'yearly'],
    ['Notfallfrequenzen checken', 'yearly'], ['Notfallordner: Auf Stand?', 'yearly'],
    ['Tiere: Dokumente Ziegen', 'yearly'], ['Tiere: Heimtierausweis Karlchen', 'yearly'],
    ['Tiere: Heimtierausweis Maja', 'yearly'], ['Tiere: Heimtierausweis Peppa', 'yearly'],
    ['Tiere: iCAD Ausweis Karlchen', 'yearly'], ['Tiere: iCAD Ausweis Maja', 'yearly'],
    ['Tiere: iCAD Ausweis Peppa', 'yearly'], ['USB-Stick (Alle Dokumente) auf Stand?', 'yearly'],
    ['Versicherung: Haftpflicht', 'yearly'], ['Versicherung: Hausrat', 'yearly'],
    ['Versicherung: Schule', 'yearly'], ['Versicherung: Touran', 'yearly'],
    ['Versicherung: Volvo', 'yearly'], ['Wichtige Kontakte & Adressen', 'yearly'],
  ] },
  { name: 'Gesundheit', items: [
    ['Erste-Hilfe-Kit', 'yearly'], ['Handdesinfektionsmittel', 'yearly'], ['Medizinischer Alkohol', 'yearly'],
    ['OP-Masken & FFP2-Masken', 'yearly'], ['Vitaminpräparate', 'yearly'], ['Wunddesinfektion', 'yearly'],
  ] },
  { name: 'Haushalt', items: [
    ['Alufolie', 'yearly'], ['Einweggeschirr und -Besteck (2/P/d×6Wo=250)', 'yearly'],
    ['Küchenpapier (4x)', 'yearly'], ['Müllbeutel (120l, 3 Rollen)', 'yearly'],
    ['Müllbeutel (30l, 3 Rollen)', 'yearly'], ['Müllbeutel (60l, 3 Rollen)', 'yearly'],
    ['Müllbeutel Klo (50l, 120 Stück)', 'yearly'], ['Waschmittel Hand (2x)', 'yearly'],
    ['FI-Schutzschalter prüfen', 'yearly'],
  ] },
  { name: 'Heizung', items: [
    ['Anzündholz Ofen vorhanden? (5x)', 'yearly'], ['Gasheizgerät prüfen', 'yearly'],
    ['Holz für Ofen kaufen', 'yearly'], ['Ofenanzünder kaufen', 'yearly'],
    ['Ofenstreichhölzer kaufen', 'yearly'], ['Schornsteinfeger kommen lassen', 'yearly'],
  ] },
  { name: 'Hygiene', items: [
    ['Binden / Tampons', 'yearly'], ['Eau de Javel', 'yearly'], ['Einmalhandschuhe (100x)', 'yearly'],
    ['Feuchttücher', 'yearly'], ['Heulboxen (4x)', 'yearly'], ['Kernseife (2x)', 'yearly'],
    ['Klopapier (2x)', 'yearly'], ['Pflaster', 'yearly'], ['Rasierklingen (1x)', 'yearly'],
    ['Rasierschaum (1x)', 'yearly'], ['Seife (4x)', 'yearly'], ['Shampoo (je 2 Flaschen)', 'yearly'],
    ['Taschentücher (2x)', 'yearly'], ['Zahnbürsten (je 1x)', 'yearly'], ['Zahnpasta (je 2 Tuben)', 'yearly'],
  ] },
  { name: 'Kochen', items: [
    ['Dutch Oven ok?', 'yearly'], ['Gaskocher prüfen', 'yearly'], ['Raketenofen OK?', 'yearly'],
    ['Sack Kohlebriketts (5x)', 'yearly'], ['Tampons (Feueranzünder)', 'yearly'],
    ['Volle Gasflasche vorhanden? (Propan)', 'monthly'], ['Zwei Gasflaschen (Propan)', 'yearly'],
    ['Zweige für Raketenofen', 'yearly'],
  ] },
  { name: 'Sicherheit', items: [
    ['Feuerlöscher prüfen', 'yearly'], ['Löschdecke vorhanden?', 'yearly'], ['Warnwesten vorhanden?', 'yearly'],
  ] },
  { name: 'Tiere', items: [
    ['Heu (2 Ballen)', 'monthly'], ['Stroh (1 Ballen)', 'monthly'],
    ['Tierfutter vorhanden?', 'monthly'], ['Wassertank Tiere voll?', 'weekly'],
  ] },
  { name: 'Vorräte', items: [
    ['Vorräte auffüllen? (Einkaufsliste)', 'monthly'], ['Vorratsliste drucken (MHD)', 'monthly'],
    ['Brauchwasserkanister neu befüllen', 'yearly'],
  ] },
];

importMaintenanceBtn.addEventListener('click', () => {
  if (!confirm('Bekannte Checkliste hinzufügen? Bestehende Checklisten bleiben erhalten — bei erneutem Ausführen entstehen doppelte Einträge.')) return;
  SEED_MAINTENANCE.forEach((list) => {
    maintenance.lists.push({
      id: genId(),
      name: list.name,
      recipients: ['markus'],
      items: list.items.map(([text, frequency]) => ({
        id: genId(), text, frequency, lastCompletedAt: null,
      })),
    });
  });
  saveMaintenance();
  renderMaintenanceEditor();
});

// --- Entry point -----------------------------------------------------------

function render() {
  renderMaintenanceList();
  renderCrisisList();
  renderMaintenanceEditor();
  renderCrisisEditor();
}

window.addEventListener('erdkeller:signedin', () => loadAll());
window.addEventListener('erdkeller:refresh', () => loadAll());
checklistsCard.addEventListener('click', () => loadAll());

window.addEventListener('erdkeller:navreset', (e) => {
  if (e.detail.tab !== 'checklists') return;
  crisisReferenceEl.classList.remove('show');
  render();
});
