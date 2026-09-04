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
// is a single sitting working through everything due, not a per-item
// rolling timer, so each item just carries a `frequency` and a
// `lastCompletedAt` timestamp; "done for the current period" is *derived*
// by comparing lastCompletedAt against the most recent scheduled
// occurrence for that frequency. Ticking a box sets lastCompletedAt to
// now; the box silently resets unchecked once the schedule rolls past
// that occurrence again — no rescheduling logic, no drift.
//
// Reset-boundary scheduling (Build 74) — "monatlich"/"vierteljährlich"/etc.
// mean "since the most recent admin-configured weekday" (Settings →
// Erinnerungen → Checklisten, js/notifications.js writes /config/
// notifications), not a plain calendar month/quarter/year. Markus: monthly
// = pick an occurrence (1st-4th) + weekday, e.g. "2nd Saturday of the
// month"; quarterly/half-yearly = the same rule repeating every 3/6 months
// from a chosen anchor month; yearly = the same rule within one fixed
// month; weekly = just a weekday. This only computes the boundary — still
// a pure derived comparison against item.lastCompletedAt, no wipe action,
// no new infra. Actually *sending* a reminder at that date/time is
// Step 17 (push notifications), not built yet.
//
// No "einmalig" (one-time) frequency — every item gets a real recurring
// cadence (Markus: "even one-time topics need to be checked occasionally
// if still there"). Items that were one-time in the source list (Kompass,
// Reisepass, ...) are seeded as yearly, the closest "occasionally" already
// in the model.
import { db } from './firebase-init.js?v=171';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

// --- DOM refs: main screen ------------------------------------------------
//
// No separate Settings → Checklisten submenu (there was one through Build
// 72; Markus asked for it to fold inline instead, matching how SPEC.md
// Section 9 already does Contacts/Notes — admin edits happen where the
// content lives, not in a submenu you have to go find). The admin-only
// pencil toggle below swaps each tab's view between the read/checkbox
// list and the same editor markup, in place.

const checklistsEditToggleBtn = document.getElementById('checklists-edit-toggle');
const checklistsTabBtns = document.querySelectorAll('.seg-btn[data-checklists-tab]');
const checklistsTabPanels = document.querySelectorAll('.checklists-tab[data-checklists-tab-panel]');
const maintenanceFilterButtons = document.querySelectorAll('#maintenance-filter-toggle .select-mode-btn');
const maintenanceViewEl = document.getElementById('maintenance-view');
const maintenanceLiveListFiltersEl = document.getElementById('maintenance-live-list-filters');
const maintenanceLiveFreqFiltersEl = document.getElementById('maintenance-live-freq-filters');
const maintenanceDismissBtn = document.getElementById('maintenance-dismiss-period-btn');
const maintenanceListEl = document.getElementById('maintenance-list');
const crisisViewEl = document.getElementById('crisis-view');
const crisisListEl = document.getElementById('crisis-list');
const crisisReferenceEl = document.getElementById('crisis-reference');
const crisisReferenceCloseBtn = document.getElementById('crisis-reference-close');
const crisisReferenceTitleEl = document.getElementById('crisis-reference-title');
const crisisReferenceStepsEl = document.getElementById('crisis-reference-steps');

const maintenanceEditViewEl = document.getElementById('maintenance-edit-view');
const maintenanceManageListEl = document.getElementById('maintenance-manage-list');
const addMaintenanceListBtn = document.getElementById('add-maintenance-list-btn');
const maintenanceSearchInput = document.getElementById('maintenance-search-input');
const maintenanceListFiltersEl = document.getElementById('maintenance-list-filters');
const maintenanceFreqFiltersEl = document.getElementById('maintenance-freq-filters');
const maintenanceFlatListEl = document.getElementById('maintenance-flat-list');
const addMaintenanceItemBtn = document.getElementById('add-maintenance-item-btn');
const crisisEditViewEl = document.getElementById('crisis-edit-view');
const crisisEditorEl = document.getElementById('crisis-editor');
const addCrisisTypeBtn = document.getElementById('add-crisis-type-btn');
const statusEl = document.getElementById('checklists-status');

const maintenanceRef = doc(db, 'config', 'checklists');
const crisisRef = doc(db, 'config', 'crisisTypes');
const notificationsRef = doc(db, 'config', 'notifications');
// Step 17 — send-tracking + per-period dismissal, written by both
// functions/index.js's sendReminders AND this file's own dismissPeriod()
// below. Deliberately its own doc, not a key inside maintenanceRef/
// notificationsRef above — both of those are saved wholesale from an
// in-memory object by their own screens, so any field written there by
// something else would be silently clobbered on the next unrelated save.
const notificationStateRef = doc(db, 'config', 'notificationState');

const RECIPIENT_OPTIONS = [
  { id: 'markus', label: 'Markus' },
  { id: 'julia', label: 'Julia' },
  { id: 'sophia', label: 'Sophia' },
];

const FREQ_LABELS = {
  weekly: 'Wöchentlich', monthly: 'Monatlich', quarterly: 'Vierteljährlich', halfYearly: 'Halbjährlich', yearly: 'Jährlich',
};

// Kept in sync with js/notifications.js's defaultChecklists() — same
// duplicated-small-helper convention as everywhere else in this app; this
// file only ever reads the config, js/notifications.js is the only writer.
function defaultNotificationsChecklists() {
  return {
    weekly: { weekday: 1 },
    monthly: { weekOfMonth: 1, weekday: 1 },
    quarterly: { anchorMonth: 1, weekOfMonth: 1, weekday: 1 },
    halfYearly: { anchorMonth: 1, weekOfMonth: 1, weekday: 1 },
    yearly: { month: 1, weekOfMonth: 1, weekday: 1 },
    hour: 9,
  };
}

let maintenance = { lists: [] };
let crisis = { types: [] };
let notifications = { checklists: defaultNotificationsChecklists() };
let notificationState = { checklists: {} };
// Same data-integrity guard as taxonomy.js/storage-locations.js.
let loadOk = false;
let maintenanceFilter = 'due'; // 'due' | 'all' — live view
// Which checklist groups to show on the live view — separate from the
// editor's own selectedListFilters (Set), so filtering in one doesn't
// silently affect the other.
let selectedLiveListFilters = new Set();
// Häufigkeit filter on the live view (Step 17) — mirrors selectedLiveList
// Filters' own shape/independence from the editor's selectedFreqFilters.
// Exactly one entry is what unlocks the "Für diesen Zeitraum erledigt"
// action below, since a notification/deep-link always targets one specific
// frequency's round.
let selectedLiveFreqFilters = new Set();
// One flag for both tabs — whichever tab is active shows its editor while
// this is true, so switching tabs mid-edit stays in edit mode.
let editMode = false;
// Edit-view flat list filtering state.
let maintenanceSearch = '';
let selectedListFilters = new Set();
let selectedFreqFilters = new Set();

function genId() {
  return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// --- Data loading -----------------------------------------------------

async function loadAll() {
  try {
    const [mSnap, cSnap, nSnap, nsSnap] = await Promise.all([
      getDoc(maintenanceRef), getDoc(crisisRef), getDoc(notificationsRef), getDoc(notificationStateRef),
    ]);
    maintenance = mSnap.exists() && Array.isArray(mSnap.data().lists) ? mSnap.data() : { lists: [] };
    crisis = cSnap.exists() && Array.isArray(cSnap.data().types) ? cSnap.data() : { types: [] };
    notifications = nSnap.exists() ? nSnap.data() : { checklists: defaultNotificationsChecklists() };
    if (!notifications.checklists) notifications.checklists = defaultNotificationsChecklists();
    notificationState = nsSnap.exists() ? nsSnap.data() : { checklists: {} };
    if (!notificationState.checklists) notificationState.checklists = {};
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

// --- Reset-boundary completion model ---------------------------------------
//
// "Done for the current period" = lastCompletedAt is on or after the most
// recent scheduled occurrence for that frequency (per Settings →
// Erinnerungen). Still a pure derived comparison, same shape as the old
// calendar-bucket version, just with a real date as the boundary instead
// of an integer bucket.

// weekday1to7: ISO-style, 1=Monday..7=Sunday (matches Date#getDay()'s
// 0=Sunday..6=Saturday via the `=== 0 ? 7 : ...` conversions below).
function nthWeekdayOfMonth(year, month1based, weekOfMonth, weekday1to7) {
  const first = new Date(year, month1based - 1, 1);
  const firstWeekdayIso = first.getDay() === 0 ? 7 : first.getDay();
  let offset = weekday1to7 - firstWeekdayIso;
  if (offset < 0) offset += 7;
  const day = 1 + offset + (weekOfMonth - 1) * 7;
  return new Date(year, month1based - 1, day);
}

function mostRecentWeeklyOccurrence(cfg, now) {
  const nowIso = now.getDay() === 0 ? 7 : now.getDay();
  let diff = nowIso - cfg.weekday;
  if (diff < 0) diff += 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
  return d;
}

function mostRecentMonthlyOccurrence(cfg, now) {
  const thisMonth = nthWeekdayOfMonth(now.getFullYear(), now.getMonth() + 1, cfg.weekOfMonth, cfg.weekday);
  if (thisMonth <= now) return thisMonth;
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return nthWeekdayOfMonth(prev.getFullYear(), prev.getMonth() + 1, cfg.weekOfMonth, cfg.weekday);
}

// Shared by quarterly (every 3 months) and half-yearly (every 6 months)
// from a chosen anchor month, e.g. anchor=January+quarterly fires
// Jan/Apr/Jul/Oct. Uses a linear (year*12+month) index rather than
// looping within each calendar year, so an anchor month that makes the
// cycle cross a year boundary (e.g. anchor=November, quarterly →
// Nov/Feb/May/Aug) still lines up correctly — a per-year loop would
// silently miss the Feb/May firings for that anchor.
function mostRecentCyclicOccurrence(cfg, now, intervalMonths) {
  const nowIdx = now.getFullYear() * 12 + now.getMonth(); // 0-based month index
  const anchor0based = cfg.anchorMonth - 1;
  let best = null;
  for (let idx = nowIdx; idx >= nowIdx - intervalMonths * 2; idx--) {
    const month0based = ((idx % 12) + 12) % 12;
    if ((((month0based - anchor0based) % intervalMonths) + intervalMonths) % intervalMonths !== 0) continue;
    const year = Math.floor(idx / 12);
    const occ = nthWeekdayOfMonth(year, month0based + 1, cfg.weekOfMonth, cfg.weekday);
    if (occ <= now && (!best || occ > best)) best = occ;
  }
  return best;
}

function mostRecentYearlyOccurrence(cfg, now) {
  const thisYear = nthWeekdayOfMonth(now.getFullYear(), cfg.month, cfg.weekOfMonth, cfg.weekday);
  if (thisYear <= now) return thisYear;
  return nthWeekdayOfMonth(now.getFullYear() - 1, cfg.month, cfg.weekOfMonth, cfg.weekday);
}

function mostRecentOccurrence(frequency, now) {
  const c = notifications.checklists || defaultNotificationsChecklists();
  if (frequency === 'weekly') return mostRecentWeeklyOccurrence(c.weekly, now);
  if (frequency === 'monthly') return mostRecentMonthlyOccurrence(c.monthly, now);
  if (frequency === 'quarterly') return mostRecentCyclicOccurrence(c.quarterly, now, 3);
  if (frequency === 'halfYearly') return mostRecentCyclicOccurrence(c.halfYearly, now, 6);
  return mostRecentYearlyOccurrence(c.yearly, now);
}

function isDoneThisPeriod(item) {
  if (!item.lastCompletedAt) return false;
  return new Date(item.lastCompletedAt) >= mostRecentOccurrence(item.frequency, new Date());
}

// 'YYYY-MM-DD' identity for a frequency's current period — same format as
// functions/index.js's own occurrenceKey(), both describing the same real
// Europe/Paris calendar day (the household's devices are always on that
// timezone, same assumption the rest of this boundary math already makes).
// This is what "Für diesen Zeitraum erledigt" writes into
// /config/notificationState, and it's why a dismissal self-expires with no
// cleanup action needed — the moment the boundary rolls to the next
// occurrence, this key changes and the old dismissal simply stops matching.
function occurrenceKeyFor(frequency) {
  const occ = mostRecentOccurrence(frequency, new Date());
  if (!occ) return null;
  const y = occ.getFullYear();
  const m = String(occ.getMonth() + 1).padStart(2, '0');
  const d = String(occ.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

// Non-destructive — a plain copy sorted at render time, never reordering
// maintenance.lists itself (nothing else in this file depends on array
// order, but there's no reason to risk it).
function sortedLists() {
  return [...maintenance.lists].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function sortedItems(items) {
  return [...items].sort((a, b) => a.text.localeCompare(b.text, 'de'));
}

function renderMaintenanceLiveFilters() {
  const listNames = sortedLists().map((l) => l.name);
  renderChips(maintenanceLiveListFiltersEl, listNames, selectedLiveListFilters, renderMaintenanceList);
}

// Step 17 — separate chip row + separate Set from the editor's own
// Häufigkeit filter, same independence reasoning as the Checkliste filter
// above. Its onChange also has to refresh the dismiss button (not just the
// item list), since selecting down to exactly one frequency is what makes
// that button appear at all.
function renderMaintenanceLiveFreqFilters() {
  const freqLabels = Object.values(FREQ_LABELS);
  renderChips(maintenanceLiveFreqFiltersEl, freqLabels, selectedLiveFreqFilters, () => {
    renderMaintenanceList();
    renderDismissPeriodButton();
  });
}

function renderMaintenanceList() {
  maintenanceListEl.innerHTML = '';
  if (!loadOk) return;
  sortedLists().forEach((list) => {
    if (selectedLiveListFilters.size && !selectedLiveListFilters.has(list.name)) return;
    const freqScoped = selectedLiveFreqFilters.size
      ? (list.items || []).filter((it) => selectedLiveFreqFilters.has(FREQ_LABELS[it.frequency] || it.frequency))
      : (list.items || []);
    const dueItems = freqScoped.filter((it) => !isDoneThisPeriod(it));
    const items = sortedItems(maintenanceFilter === 'due' ? dueItems : freqScoped);
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
      : 'Noch keine Checklisten vorhanden — mit ✏️ oben rechts anlegen.';
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

// --- "Für diesen Zeitraum erledigt" (Step 17) ------------------------------
//
// Only ever shown when exactly one Häufigkeit chip is active — a dismissal
// always targets one specific frequency's round, mirroring exactly what a
// tapped reminder notification deep-links into (see applyDeepLinkFromHash
// below). This silences the PUSH reminder only — it writes nothing onto
// any item's lastCompletedAt, so the checklist itself still shows those
// items as open; "erledigt" here means the round, not the tasks.

function currentSingleFreqSelection() {
  if (selectedLiveFreqFilters.size !== 1) return null;
  const label = [...selectedLiveFreqFilters][0];
  return Object.keys(FREQ_LABELS).find((key) => FREQ_LABELS[key] === label) || null;
}

function renderDismissPeriodButton() {
  const freq = currentSingleFreqSelection();
  if (!freq) {
    maintenanceDismissBtn.classList.add('hidden');
    return;
  }
  const occKey = occurrenceKeyFor(freq);
  const freqState = (notificationState.checklists || {})[freq] || {};
  const dismissed = !!occKey && freqState.dismissedOccurrence === occKey;
  maintenanceDismissBtn.classList.remove('hidden');
  maintenanceDismissBtn.classList.toggle('dismissed', dismissed);
  maintenanceDismissBtn.disabled = dismissed || !occKey;
  maintenanceDismissBtn.textContent = dismissed
    ? 'Erinnerung für diesen Zeitraum pausiert'
    : `Für diesen Zeitraum (${FREQ_LABELS[freq]}) erledigt`;
}

async function dismissCurrentPeriod() {
  const freq = currentSingleFreqSelection();
  const occKey = freq ? occurrenceKeyFor(freq) : null;
  if (!freq || !occKey) return;
  maintenanceDismissBtn.disabled = true;
  try {
    // Targeted dot-path field write, not a whole-document setDoc — this doc
    // is also written by functions/index.js's sendReminders, and a
    // whole-object write from either side would clobber whatever the other
    // just wrote to a different frequency's fields. setDoc+merge (not
    // updateDoc) since the doc may not exist yet if no reminder has ever
    // sent.
    await setDoc(notificationStateRef, { [`checklists.${freq}.dismissedOccurrence`]: occKey }, { merge: true });
    if (!notificationState.checklists) notificationState.checklists = {};
    notificationState.checklists[freq] = { ...(notificationState.checklists[freq] || {}), dismissedOccurrence: occKey };
    renderDismissPeriodButton();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Konnte nicht als erledigt markiert werden: ' + err.message;
    maintenanceDismissBtn.disabled = false;
  }
}

maintenanceDismissBtn.addEventListener('click', dismissCurrentPeriod);

// --- Main screen: Krise ----------------------------------------------------

function renderCrisisList() {
  crisisListEl.innerHTML = '';
  if (!loadOk) return;
  if (crisis.types.length === 0) {
    const p = document.createElement('p');
    p.className = 'screen-placeholder';
    p.textContent = 'Noch keine Krisentypen angelegt — mit ✏️ oben rechts anlegen.';
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
  (type.steps || []).forEach((step, idx) => {
    const p = document.createElement('p');
    const numSpan = document.createElement('span');
    numSpan.className = 'crisis-step-number';
    numSpan.textContent = `${idx + 1}.`;
    p.appendChild(numSpan);
    p.appendChild(document.createTextNode(' ' + step.text));
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

// --- Inline editor: Wartung -------------------------------------------

function focusFirstInput(container) {
  const input = container.querySelector('.tax-name-input:last-of-type') || container.querySelector('.tax-name-input');
  if (input) {
    input.focus();
    input.select();
  }
}

// Structural checklist management (rename/recipients/delete/add) — no
// items nested here any more, those live in the flat filterable list
// below. Same .checklist-edit-group/.checklist-edit-head/.checklist-
// recipients markup as before, just without the per-list items loop.
// Deliberately raw (creation) order here, not sortedLists() — while the
// editor is open, a just-added checklist/item should stay where you put
// it instead of instantly jumping to its alphabetical slot mid-edit.
// Only the live Wartung view (always sorted, see above) is what's shown
// once you actually close the editor, so the sorted arrangement is what
// "closing the editor" reveals — no separate sort-on-close step needed.
function renderMaintenanceManageList() {
  maintenanceManageListEl.innerHTML = '';
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
      renderMaintenanceManageList();
      renderMaintenanceFilters();
      renderMaintenanceFlatList();
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

    maintenanceManageListEl.appendChild(group);
  });
}

addMaintenanceListBtn.addEventListener('click', () => {
  const newList = { id: genId(), name: 'Neue Checkliste', recipients: ['markus'], items: [] };
  maintenance.lists.push(newList);
  // Clear both filter rows rather than pointing them at the brand-new
  // checklist: it has no items yet, so filtering to it emptied the item
  // list entirely and left you re-picking filters to see anything again.
  // "+ Eintrag hinzufügen" still lands on this checklist with no filter
  // set — it falls back to the most recently created one (see its own
  // handler below), which is exactly the one just added here.
  selectedListFilters = new Set();
  selectedLiveListFilters = new Set();
  saveMaintenance();
  renderMaintenanceManageList();
  renderMaintenanceFilters();
  renderMaintenanceFlatList();
  renderMaintenanceLiveFilters();
  renderMaintenanceList();
});

// --- Flat, filterable item list (Build 74) ---------------------------------
//
// One row per item across every checklist, rather than nested per-
// checklist blocks — with ~113 real items this is the only way to make
// "just the monthly ones" or "just this one checklist" fast to find.
// Same .filter-chip/renderChips shape as js/stock-table.js's admin table.

function flattenMaintenanceItems() {
  const flat = [];
  maintenance.lists.forEach((list) => {
    (list.items || []).forEach((item) => flat.push({ item, list }));
  });
  return flat;
}

// Raw (creation) order too, same reasoning as renderMaintenanceManageList
// above — a freshly-added entry stays put instead of jumping mid-edit.
function filteredFlatItems() {
  const q = maintenanceSearch.trim().toLowerCase();
  return flattenMaintenanceItems()
    .filter(({ item, list }) => {
      if (selectedListFilters.size && !selectedListFilters.has(list.name)) return false;
      if (selectedFreqFilters.size && !selectedFreqFilters.has(FREQ_LABELS[item.frequency] || item.frequency)) return false;
      if (q && !item.text.toLowerCase().includes(q)) return false;
      return true;
    });
}

function renderChips(container, values, selectedSet, onChange) {
  container.innerHTML = '';
  values.forEach((v) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'filter-chip' + (selectedSet.has(v) ? ' active' : '');
    chip.textContent = v;
    chip.addEventListener('click', () => {
      if (selectedSet.has(v)) selectedSet.delete(v);
      else selectedSet.add(v);
      renderChips(container, values, selectedSet, onChange);
      onChange();
    });
    container.appendChild(chip);
  });
}

function renderMaintenanceFilters() {
  const listNames = maintenance.lists.map((l) => l.name);
  const freqLabels = Object.values(FREQ_LABELS);
  renderChips(maintenanceListFiltersEl, listNames, selectedListFilters, renderMaintenanceFlatList);
  renderChips(maintenanceFreqFiltersEl, freqLabels, selectedFreqFilters, renderMaintenanceFlatList);
}

function renderMaintenanceFlatList() {
  maintenanceFlatListEl.innerHTML = '';
  const rows = filteredFlatItems();

  rows.forEach(({ item, list }) => {
    const row = document.createElement('div');
    row.className = 'checklist-flat-row';
    row.dataset.itemId = item.id;

    const main = document.createElement('div');
    main.className = 'checklist-flat-row-main';
    main.innerHTML = `
      <input class="tax-name-input" value="${escapeAttr(item.text)}" placeholder="Eintrag">
      <button class="tax-del" title="Eintrag löschen">✕</button>
    `;
    main.querySelector('.tax-name-input').addEventListener('change', (e) => {
      item.text = e.target.value.trim();
      saveMaintenance();
    });
    main.querySelector('.tax-del').addEventListener('click', () => {
      list.items = list.items.filter((it) => it.id !== item.id);
      saveMaintenance();
      renderMaintenanceFlatList();
    });
    row.appendChild(main);

    const meta = document.createElement('div');
    meta.className = 'checklist-flat-row-meta';
    meta.innerHTML = `
      <select class="checklist-freq-select">
        ${Object.entries(FREQ_LABELS).map(([key, label]) => `<option value="${key}"${item.frequency === key ? ' selected' : ''}>${label}</option>`).join('')}
      </select>
      <select class="checklist-move-select">
        ${maintenance.lists.map((l) => `<option value="${l.id}"${l.id === list.id ? ' selected' : ''}>${escapeAttr(l.name)}</option>`).join('')}
      </select>
    `;
    meta.querySelector('.checklist-freq-select').addEventListener('change', (e) => {
      item.frequency = e.target.value;
      saveMaintenance();
      renderMaintenanceFilters();
      renderMaintenanceFlatList();
    });
    meta.querySelector('.checklist-move-select').addEventListener('change', (e) => {
      const targetList = maintenance.lists.find((l) => l.id === e.target.value);
      if (!targetList || targetList.id === list.id) return;
      list.items = list.items.filter((it) => it.id !== item.id);
      targetList.items = targetList.items || [];
      targetList.items.push(item);
      saveMaintenance();
      renderMaintenanceFlatList();
    });
    row.appendChild(meta);

    maintenanceFlatListEl.appendChild(row);
  });

  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'screen-placeholder';
    p.textContent = 'Keine Einträge für diese Auswahl.';
    maintenanceFlatListEl.appendChild(p);
  }
}

maintenanceSearchInput.addEventListener('input', (e) => {
  maintenanceSearch = e.target.value;
  renderMaintenanceFlatList();
});

addMaintenanceItemBtn.addEventListener('click', () => {
  if (!maintenance.lists.length) {
    statusEl.textContent = 'Zuerst eine Checkliste anlegen ("+ Neue Checkliste").';
    return;
  }
  // Falls back to the most recently created checklist, not the first —
  // "whichever checklist you were probably just working on" is a much
  // safer guess with no filter active than "whichever came first".
  const targetList = selectedListFilters.size === 1
    ? maintenance.lists.find((l) => selectedListFilters.has(l.name)) || maintenance.lists[maintenance.lists.length - 1]
    : maintenance.lists[maintenance.lists.length - 1];
  if (!targetList.items) targetList.items = [];
  const newItem = { id: genId(), text: 'Neuer Eintrag', frequency: 'yearly', lastCompletedAt: null };
  targetList.items.push(newItem);
  saveMaintenance();
  renderMaintenanceFlatList();
  const newRow = maintenanceFlatListEl.querySelector(`[data-item-id="${newItem.id}"] .tax-name-input`);
  if (newRow) {
    newRow.focus();
    newRow.select();
  }
});

// --- Inline editor: Krise -----------------------------------------------

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
      renderCrisisList();
    });
    head.querySelector('.tax-name-input').addEventListener('change', (e) => {
      type.name = e.target.value.trim();
      saveCrisis();
      renderCrisisList();
    });
    head.querySelector('.tax-del').addEventListener('click', () => {
      if (!confirm(`Krisentyp "${type.name}" inkl. aller Schritte löschen?`)) return;
      crisis.types = crisis.types.filter((t) => t.id !== type.id);
      saveCrisis();
      renderCrisisEditor();
      renderCrisisList();
    });
    group.appendChild(head);

    (type.steps || []).forEach((step, idx) => {
      const row = document.createElement('div');
      row.className = 'checklist-edit-item-row';
      row.innerHTML = `
        <span class="checklist-step-number">${idx + 1}.</span>
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
  renderCrisisList();
});

// --- Edit-mode toggle (admin-only pencil, top right) -----------------------
//
// One button swaps whichever tab is active between its read view and the
// same editor markup, in place; tapping it again ("✓ Fertig") swaps back.
// Both tabs' view/edit containers exist in the DOM at all times (editor
// content is always kept current by render(), same as every other panel
// in this app) — this just toggles which pair is visible.

function applyEditMode() {
  maintenanceViewEl.classList.toggle('hidden', editMode);
  maintenanceEditViewEl.classList.toggle('hidden', !editMode);
  crisisViewEl.classList.toggle('hidden', editMode);
  crisisEditViewEl.classList.toggle('hidden', !editMode);
  checklistsEditToggleBtn.classList.toggle('editing', editMode);
  checklistsEditToggleBtn.textContent = editMode ? '✓ Fertig' : '✏️';
}

// Reorders the stored arrays themselves, unlike the live view's own
// non-destructive sortedLists()/sortedItems() — that's what makes the
// *editor* come back up sorted the next time it's opened too, not just
// the read view. Returns whether anything actually moved, so closing an
// editor that changed nothing doesn't trigger a pointless Firestore
// write. Only ever called on leaving edit mode (leaveEditMode below):
// during editing everything stays in creation order, so a just-added
// checklist/entry never jumps out from under you mid-edit.
function sortMaintenanceInPlace() {
  const order = () => maintenance.lists
    .map((l) => l.id + ':' + (l.items || []).map((i) => i.id).join(','))
    .join('|');
  const before = order();
  maintenance.lists.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
  maintenance.lists.forEach((list) => {
    if (Array.isArray(list.items)) {
      list.items.sort((a, b) => (a.text || '').localeCompare(b.text || '', 'de'));
    }
  });
  return order() !== before;
}

function leaveEditMode() {
  editMode = false;
  applyEditMode();
  if (sortMaintenanceInPlace()) saveMaintenance();
  render();
}

checklistsEditToggleBtn.addEventListener('click', () => {
  if (editMode) {
    leaveEditMode();
    return;
  }
  editMode = true;
  applyEditMode();
});

applyEditMode();

// Checklisten verwalten / Einträge — collapsible, same
// .targets-section-header pattern as Ziele (js/targets.js), scoped to this
// screen so it doesn't pick up Ziele's own section headers.
maintenanceEditViewEl.querySelectorAll('.checklist-section-header').forEach((btn) => {
  btn.addEventListener('click', () => {
    const body = btn.nextElementSibling;
    const collapsed = body.classList.toggle('collapsed');
    btn.querySelector('.tax-toggle').textContent = collapsed ? '▾' : '▴';
  });
});

// --- Entry point -----------------------------------------------------------

function render() {
  renderMaintenanceLiveFilters();
  renderMaintenanceLiveFreqFilters();
  renderDismissPeriodButton();
  renderMaintenanceList();
  renderCrisisList();
  renderMaintenanceManageList();
  renderMaintenanceFilters();
  renderMaintenanceFlatList();
  renderCrisisEditor();
}

// --- Step 17 deep link: a tapped reminder notification lands here --------
//
// service-worker.js's notificationclick opens/focuses the app at
// index.html#erinnerung=<frequency> — read once after sign-in (a fresh
// window opened by the notification) AND on every `hashchange` (the
// service worker navigating an already-open window doesn't reload the
// page, so `erdkeller:signedin` never refires for that case). Both paths
// call the same function so there's exactly one place this logic lives.
function applyDeepLinkFromHash() {
  const match = location.hash.match(/^#erinnerung=([a-zA-Z]+)$/);
  if (!match || !FREQ_LABELS[match[1]]) return;
  const freq = match[1];
  // Clears the hash without adding a new history entry — js/back-nav.js
  // owns the app's one sentinel history entry globally and never inspects
  // event.state, so this deliberately doesn't push anything of its own.
  history.replaceState(null, '', location.pathname + location.search);
  document.querySelector('.nav-btn[data-tab="checklists"]').click();
  document.querySelector('.seg-btn[data-checklists-tab="maintenance"]').click();
  selectedLiveFreqFilters = new Set([FREQ_LABELS[freq]]);
  renderMaintenanceLiveFreqFilters();
  renderMaintenanceList();
  renderDismissPeriodButton();
}

window.addEventListener('erdkeller:signedin', async () => {
  await loadAll();
  applyDeepLinkFromHash();
});
window.addEventListener('erdkeller:refresh', () => loadAll());
window.addEventListener('hashchange', applyDeepLinkFromHash);

window.addEventListener('erdkeller:navreset', (e) => {
  if (e.detail.tab !== 'checklists') return;
  crisisReferenceEl.classList.remove('show');
  // Navigating away counts as closing the editor — same sort-and-save
  // as the ✓ Fertig button, so an edit session left via the nav bar
  // still lands sorted.
  leaveEditMode();
});
