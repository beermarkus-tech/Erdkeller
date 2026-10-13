// Settings → Sicherung (SPEC.md Section 20.2.3: "two distinct formats for
// two distinct use cases") — five per-section CSV downloads, a full JSON
// database backup, and (Build 121) a full-replace JSON import/restore
// sharing the same panel. Export is a live Firestore read at click time,
// same as every other screen in the app already does; Import completely
// replaces Firestore's data with a previously exported backup file, then
// reloads the app.
//
// /users is deliberately excluded from both export and import — Markus's
// explicit call: firestore.rules only lets a user create their own doc
// (request.auth.uid == userId), so a delete-then-recreate import could
// never restore anyone but the currently-signed-in admin, and could even
// wedge itself mid-import if the admin's own doc got deleted before its
// replacement wrote (every subsequent write's isAdmin() check re-reads
// /users/{currentUid}). Roles/names are managed only through Settings →
// Personen, backup or no backup.
import { db, hcol, hdoc } from './firebase-init.js?v=214';
import {
  collection, getDocs, doc, getDoc, setDoc, deleteDoc, writeBatch,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { t, getLocale } from './i18n.js?v=214';

const statusEl = document.getElementById('export-status');

const stockBtn = document.getElementById('export-stock-btn');
const checklistsBtn = document.getElementById('export-checklists-btn');
const contactsBtn = document.getElementById('export-contacts-btn');
const notesBtn = document.getElementById('export-notes-btn');
const recipesBtn = document.getElementById('export-recipes-btn');
const jsonBtn = document.getElementById('export-json-btn');

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function download(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// RFC4180-ish: a field is quoted if it contains a comma, quote, or newline,
// with internal quotes doubled. The leading BOM (﻿) is what actually
// makes Excel open a UTF-8 CSV with German umlauts intact rather than
// mangled — without it Excel guesses the file's encoding wrong on Windows.
function csvField(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(rows, columns) {
  const header = columns.map((c) => csvField(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => csvField(c.get(row))).join(','));
  return '﻿' + [header, ...lines].join('\r\n');
}

function bodyPlainText(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
}

async function downloadCsv(btn, section, load) {
  btn.disabled = true;
  statusEl.textContent = '';
  try {
    const { rows, columns } = await load();
    download(`erdkeller-${section}-${todayStamp()}.csv`, toCsv(rows, columns), 'text/csv;charset=utf-8');
  } catch (err) {
    statusEl.textContent = t('backup.export_fehlgeschlagen') + err.message;
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

// --- Bestand ----------------------------------------------------------

stockBtn.addEventListener('click', () => downloadCsv(stockBtn, 'bestand', async () => {
  const [batchesSnap, productsSnap] = await Promise.all([
    getDocs(hcol('stockItems')),
    getDocs(hcol('products')),
  ]);
  const productNames = new Map(productsSnap.docs.map((d) => [d.id, d.data().name || '']));
  const rows = batchesSnap.docs.map((d) => d.data());
  const columns = [
    { label: t('backup.typ'), get: (r) => r.type },
    { label: t('backup.kategorie'), get: (r) => r.category },
    { label: t('backup.unterkategorie'), get: (r) => r.subcategory },
    { label: t('backup.produkt'), get: (r) => productNames.get(r.productId) || '' },
    { label: t('backup.details'), get: (r) => r.details },
    { label: t('backup.menge'), get: (r) => r.quantity },
    { label: t('backup.inhalt'), get: (r) => r.content },
    { label: t('backup.mhd'), get: (r) => r.bestBefore },
    { label: t('backup.lagerort'), get: (r) => r.storage },
    { label: t('backup.erstellt'), get: (r) => r.createdAt },
    { label: t('backup.geaendert'), get: (r) => r.updatedAt },
  ];
  return { rows, columns };
}));

// --- Checklisten (maintenance only — the crisis reference isn't a
// frequency-based checklist and isn't part of this export) --------------

checklistsBtn.addEventListener('click', () => downloadCsv(checklistsBtn, 'checklisten', async () => {
  const FREQ_LABELS = {
    weekly: t('backup.woechentlich'), monthly: t('backup.monatlich'), quarterly: t('backup.vierteljaehrlich'), halfYearly: t('backup.halbjaehrlich'), yearly: t('backup.jaehrlich'),
  };
  // Reads the split /checklists + /checklistItems collections (dev plan
  // Step 16.3, step 6 cutover) — see js/pdf-export.js's buildMaintenanceSection
  // for the identical read shape; js/checklists.js stopped writing the
  // legacy /config/checklists document in this same build.
  const [listsSnap, itemsSnap] = await Promise.all([
    getDocs(hcol('checklists')),
    getDocs(hcol('checklistItems')),
  ]);
  const itemsByListId = new Map();
  itemsSnap.docs.forEach((d) => {
    const data = d.data();
    const arr = itemsByListId.get(data.listId) || [];
    arr.push(data);
    itemsByListId.set(data.listId, arr);
  });
  // Explicit sort — see js/pdf-export.js's identical comment; a flat
  // collection has no array position to preserve, so this reproduces the
  // localeCompare(…, 'de') comparator the retired sortMaintenanceInPlace()
  // used to apply, keeping CSV output byte-identical across the change.
  const lists = listsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
  const rows = [];
  lists.forEach((list) => {
    const items = (itemsByListId.get(list.id) || [])
      .slice()
      .sort((a, b) => (a.text || '').localeCompare(b.text || '', 'de'));
    items.forEach((item) => {
      rows.push({
        list: list.name || '',
        text: item.text || '',
        frequency: FREQ_LABELS[item.frequency] || item.frequency || '',
        lastCompletedAt: item.lastCompletedAt || '',
      });
    });
  });
  const columns = [
    { label: t('backup.checkliste'), get: (r) => r.list },
    { label: t('backup.aufgabe'), get: (r) => r.text },
    { label: t('backup.haeufigkeit'), get: (r) => r.frequency },
    { label: t('backup.zuletzt_erledigt'), get: (r) => r.lastCompletedAt },
  ];
  return { rows, columns };
}));

// --- Kontakte -----------------------------------------------------------

contactsBtn.addEventListener('click', () => downloadCsv(contactsBtn, 'kontakte', async () => {
  const snap = await getDocs(hcol('contacts'));
  const rows = snap.docs.map((d) => d.data());
  const columns = [
    { label: t('backup.name'), get: (r) => r.name },
    { label: t('backup.rolle'), get: (r) => r.role },
    { label: t('backup.telefon'), get: (r) => r.phone },
    { label: t('backup.adresse'), get: (r) => r.address },
    { label: t('backup.notizen'), get: (r) => r.notes },
    { label: t('backup.notruf'), get: (r) => (r.isEmergency ? t('backup.ja') : t('backup.nein')) },
  ];
  return { rows, columns };
}));

// --- Notizen --------------------------------------------------------------

notesBtn.addEventListener('click', () => downloadCsv(notesBtn, 'notizen', async () => {
  const snap = await getDocs(hcol('notes'));
  const rows = snap.docs.map((d) => d.data());
  const columns = [
    { label: t('backup.titel'), get: (r) => r.title },
    { label: t('backup.text'), get: (r) => bodyPlainText(r.body) },
    { label: t('backup.foto_vorhanden'), get: (r) => ((r.photos || []).length ? t('backup.ja') : t('backup.nein')) },
    { label: t('backup.erstellt'), get: (r) => r.createdAt },
    { label: t('backup.geaendert'), get: (r) => r.updatedAt },
  ];
  return { rows, columns };
}));

// --- Rezepte --------------------------------------------------------------

recipesBtn.addEventListener('click', () => downloadCsv(recipesBtn, 'rezepte', async () => {
  const snap = await getDocs(hcol('recipes'));
  const rows = snap.docs.map((d) => d.data());
  const columns = [
    { label: t('backup.titel'), get: (r) => r.title },
    { label: t('backup.tags'), get: (r) => (r.tags || []).join('; ') },
    { label: t('backup.zutaten'), get: (r) => (r.ingredients || []).join('; ') },
    { label: t('backup.zubereitung'), get: (r) => bodyPlainText(r.body) },
    { label: t('backup.foto_vorhanden'), get: (r) => ((r.photos || []).length ? t('backup.ja') : t('backup.nein')) },
    { label: t('backup.erstellt'), get: (r) => r.createdAt },
    { label: t('backup.geaendert'), get: (r) => r.updatedAt },
  ];
  return { rows, columns };
}));

// --- Full JSON database backup ---------------------------------------------
// Every collection plus every /config singleton doc the app has, dumped
// as-is (each doc's own Firestore id included) — no denormalization, no
// transformation. This format's whole point is a faithful, restorable
// copy, not a readable report (that's what the CSVs above are for).
// /users is intentionally not included — see the file header comment.

// 'checklists' appears twice on purpose: the flat /checklists collection
// (current) and, in CONFIG_DOCS, the legacy /config/checklists document
// from before the Step 16.3 split — kept in backups so older backup files
// still round-trip; nothing in the app reads it any more.
// Used by the full-replace import's chunked delete/write below —
// Firestore's own cap is 500 writes per batch, this stays under it.
const BATCH_SIZE = 450;

const COLLECTIONS = ['products', 'stockItems', 'stockLog', 'contacts', 'notes', 'recipes', 'checklists', 'checklistItems'];
const CONFIG_DOCS = [
  'taxonomy', 'targets', 'household', 'planning',
  'storageLocations', 'yearColorMap', 'checklists', 'crisisTypes', 'notifications',
];

// Shared by the manual "Vollständiges Backup" button and Import's
// automatic pre-replace safety snapshot below.
async function buildBackup() {
  const [collectionSnaps, configSnaps] = await Promise.all([
    Promise.all(COLLECTIONS.map((name) => getDocs(hcol(name)))),
    Promise.all(CONFIG_DOCS.map((id) => getDoc(hdoc('config', id)))),
  ]);
  const backup = { exportedAt: new Date().toISOString() };
  COLLECTIONS.forEach((name, i) => {
    backup[name] = collectionSnaps[i].docs.map((d) => ({ id: d.id, ...d.data() }));
  });
  backup.config = {};
  CONFIG_DOCS.forEach((id, i) => {
    backup.config[id] = configSnaps[i].exists() ? configSnaps[i].data() : null;
  });
  return backup;
}

jsonBtn.addEventListener('click', async () => {
  jsonBtn.disabled = true;
  statusEl.textContent = '';
  try {
    const backup = await buildBackup();
    download(`erdkeller-backup-${todayStamp()}.json`, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
  } catch (err) {
    statusEl.textContent = t('backup.backup_fehlgeschlagen') + err.message;
    console.error(err);
  } finally {
    jsonBtn.disabled = false;
  }
});

// --- Import (full-replace JSON restore) -------------------------------
// Deletes every doc in each collection above and every /config doc, then
// recreates them from the chosen backup file — a complete replace, not a
// merge. Firestore batches cap at 500 writes, so both the delete and the
// write phase of each collection are chunked (same pattern as Settings →
// Verlauf's "Verlauf löschen", js/stock-log.js's deleteAllLogs).

// The phrase to type is the same dictionary entry as the placeholder and
// the <strong> in the hint above the input (index.html), so a translation
// can never make the hint and the check disagree. Looked up at check time,
// not load time, so it follows a language switch.
const confirmPhrase = () => t('settings.export.alles_ersetzen');

const importFileInput = document.getElementById('import-file-input');
const importFileBtn = document.getElementById('import-file-btn');
const importFileName = document.getElementById('import-file-name');
const importSummary = document.getElementById('import-summary');
const importConfirmInput = document.getElementById('import-confirm-input');
const importConfirmBtn = document.getElementById('import-confirm-btn');
const importStatus = document.getElementById('import-status');

let pendingBackup = null;

function resetImportState(message) {
  pendingBackup = null;
  importSummary.textContent = '';
  importSummary.classList.add('hidden');
  importConfirmInput.value = '';
  importConfirmInput.disabled = true;
  importConfirmBtn.disabled = true;
  importStatus.textContent = message || '';
}

function validateBackup(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return t('backup.die_datei_enthaelt_kein_gueltiges');
  }
  for (const name of COLLECTIONS) {
    if (name in obj && !Array.isArray(obj[name])) {
      return t('backup.das_feld_muesste_eine_liste', { name });
    }
  }
  if ('config' in obj && (typeof obj.config !== 'object' || obj.config === null || Array.isArray(obj.config))) {
    return t('backup.das_feld_config_muesste_ein');
  }
  return null;
}

function describeBackup(backup) {
  const lines = [];
  if (backup.exportedAt) lines.push(t('backup.erstellt_am', { date: new Date(backup.exportedAt).toLocaleString(getLocale()) }));
  COLLECTIONS.forEach((name) => {
    lines.push(`${name}: ${(backup[name] || []).length}`);
  });
  const configKeys = backup.config ? Object.keys(backup.config).filter((k) => backup.config[k] != null) : [];
  lines.push(t('backup.einstellungen_enthalten', { value: configKeys.length ? configKeys.join(', ') : '—' }));
  return lines;
}

importFileBtn.addEventListener('click', () => importFileInput.click());

importFileInput.addEventListener('change', async () => {
  const file = importFileInput.files[0];
  importFileInput.value = '';
  if (!file) return;
  importFileName.textContent = file.name;
  resetImportState(t('backup.datei_wird_geprueft'));
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const err = validateBackup(parsed);
    if (err) {
      resetImportState(t('backup.datei_ungueltig') + err);
      return;
    }
    pendingBackup = parsed;
    importSummary.innerHTML = '';
    describeBackup(parsed).forEach((line) => {
      const p = document.createElement('div');
      p.textContent = line;
      importSummary.appendChild(p);
    });
    importSummary.classList.remove('hidden');
    importConfirmInput.disabled = false;
    importStatus.textContent = '';
  } catch (err) {
    resetImportState(t('backup.datei_ungueltig_konnte_nicht_als'));
    console.error(err);
  }
});

importConfirmInput.addEventListener('input', () => {
  importConfirmBtn.disabled = !pendingBackup || importConfirmInput.value !== confirmPhrase();
});

async function replaceCollection(name, backupDocs) {
  const existingSnap = await getDocs(hcol(name));
  const existingDocs = existingSnap.docs;
  for (let i = 0; i < existingDocs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    existingDocs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  const docs = backupDocs || [];
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    docs.slice(i, i + BATCH_SIZE).forEach((docData) => {
      const { id, ...data } = docData;
      batch.set(hdoc(name, id), data);
    });
    await batch.commit();
  }
}

async function replaceConfig(config) {
  const entries = config || {};
  for (const id of CONFIG_DOCS) {
    const value = entries[id];
    if (value == null) {
      await deleteDoc(hdoc('config', id));
    } else {
      await setDoc(hdoc('config', id), value);
    }
  }
}

importConfirmBtn.addEventListener('click', async () => {
  if (!pendingBackup || importConfirmInput.value !== confirmPhrase()) return;
  importFileBtn.disabled = true;
  importConfirmBtn.disabled = true;
  importConfirmInput.disabled = true;
  try {
    importStatus.textContent = t('backup.sicherheits_backup_der_aktuellen_daten');
    const safetyBackup = await buildBackup();
    download(`erdkeller-vor-import-backup-${todayStamp()}.json`, JSON.stringify(safetyBackup, null, 2), 'application/json;charset=utf-8');

    for (let i = 0; i < COLLECTIONS.length; i++) {
      const name = COLLECTIONS[i];
      importStatus.textContent = t('backup.ersetze', { name, value: i + 1, value2: COLLECTIONS.length + 1 });
      await replaceCollection(name, pendingBackup[name]);
    }
    importStatus.textContent = t('backup.aktualisiere_einstellungen', { value: COLLECTIONS.length + 1, value2: COLLECTIONS.length + 1 });
    await replaceConfig(pendingBackup.config);

    importStatus.textContent = t('backup.fertig_wird_neu_geladen');
    setTimeout(() => location.reload(), 1000);
  } catch (err) {
    importStatus.textContent = t('backup.import_fehlgeschlagen') + err.message + t('backup.bitte_datei_erneut_auswaehlen_und');
    console.error(err);
    importFileBtn.disabled = false;
    importConfirmInput.disabled = false;
    importConfirmInput.value = '';
    importConfirmBtn.disabled = true;
  }
});
