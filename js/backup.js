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
import { db } from './firebase-init.js?v=198';
import {
  collection, getDocs, doc, getDoc, setDoc, deleteDoc, writeBatch,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { t, getLocale } from './i18n.js?v=198';

const statusEl = document.getElementById('export-status');

const stockBtn = document.getElementById('export-stock-btn');
const checklistsBtn = document.getElementById('export-checklists-btn');
const contactsBtn = document.getElementById('export-contacts-btn');
const notesBtn = document.getElementById('export-notes-btn');
const recipesBtn = document.getElementById('export-recipes-btn');
const jsonBtn = document.getElementById('export-json-btn');
const migrateBtn = document.getElementById('migrate-checklists-btn');
const migrateMeta = document.getElementById('migrate-checklists-meta');
const migrateStatus = document.getElementById('migrate-checklists-status');

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
    getDocs(collection(db, 'stockItems')),
    getDocs(collection(db, 'products')),
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
    getDocs(collection(db, 'checklists')),
    getDocs(collection(db, 'checklistItems')),
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
  const snap = await getDocs(collection(db, 'contacts'));
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
  const snap = await getDocs(collection(db, 'notes'));
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
  const snap = await getDocs(collection(db, 'recipes'));
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

// 'checklists'/'checklistItems' added ahead of the Step 16.3 migration
// (dev plan) landing — until that migration action has actually run these
// two collections are simply empty in every backup, no different from any
// other unused collection. 'checklists' also still appears below in
// CONFIG_DOCS for the legacy /config/checklists doc; both names are kept
// deliberately distinct (a flat collection vs. a /config singleton) rather
// than colliding, and the legacy entry is removed only once the migration
// fully cuts over (see dev plan Step 16.3, step 7).
// Shared by the full-replace import's chunked delete/write below AND the
// checklists migration further down — Firestore's own cap is 500 writes
// per batch, this stays comfortably under it.
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
    Promise.all(COLLECTIONS.map((name) => getDocs(collection(db, name)))),
    Promise.all(CONFIG_DOCS.map((id) => getDoc(doc(db, 'config', id)))),
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

// --- Checklisten-Migration (dev plan Step 16.3) -------------------------
// Splits the single /config/checklists document (rewritten wholesale on
// every tick, see js/checklists.js) into two flat collections,
// /checklists/{listId} and /checklistItems/{itemId}, so two devices
// ticking different items offline merge on reconnect instead of one
// device's entire set of edits silently clobbering the other's. This
// button only ever WRITES the two new collections — js/checklists.js
// itself keeps reading/writing the legacy document until its own
// switchover ships separately, so running this migration (even
// repeatedly) has no visible effect on the live app until that lands.
//
// The one real hazard of moving from one nested document to two flat
// collections: a duplicate item id across two different lists would
// collapse into a single document. Every id in this app already comes
// from genId() (js/checklists.js), which is virtually certain to be
// unique, but "virtually certain" isn't good enough for a migration that
// can't be un-run cleanly — so this validates real uniqueness first and
// refuses loudly rather than silently merging two items into one.
function validateChecklistsForMigration(maintenance) {
  const lists = Array.isArray(maintenance.lists) ? maintenance.lists : [];
  if (!lists.length) return t('backup.keine_checklisten_gefunden_nichts_zu');
  const listIds = new Set();
  const itemIds = new Set();
  for (const list of lists) {
    if (!list.id) return t('backup.checkliste_hat_keine_id', { value: list.name || t('backup.ohne_namen') });
    if (String(list.id).includes('/')) return t('backup.checklisten_id_enthaelt_ein_und', { id: list.id });
    if (listIds.has(list.id)) return t('backup.doppelte_checklisten_id', { id: list.id });
    listIds.add(list.id);
    for (const item of (list.items || [])) {
      if (!item.id) return t('backup.ein_eintrag_in_hat_keine', { value: list.name || list.id });
      if (String(item.id).includes('/')) return t('backup.eintrags_id_enthaelt_ein_und', { id: item.id });
      if (itemIds.has(item.id)) return t('backup.doppelte_eintrags_id_wuerde_beim', { id: item.id });
      itemIds.add(item.id);
    }
  }
  return null;
}

// Set to true only in the build that ships js/checklists.js's own
// switchover to reading /checklists + /checklistItems directly (Build
// 175, dev plan Step 16.3 step 6) — flips the NEXT migration run (which
// Markus runs once after that build is live, to catch any ticks made in
// the window since the last run) into the one that stamps cutoverAt and
// permanently disables further re-runs. Before this flipped to true, this
// button only ever prepared data for a future switchover; from here on,
// running it also declares that switchover complete.
const CHECKLISTS_CUTOVER_SHIPPED = true;

// Same chunking shape as replaceCollection() below, generalised to take
// prebuilt mutation closures rather than doc lists — the migration writes
// two different kinds of documents (lists and items) plus one marker doc
// in a single logical operation, which replaceCollection's single-name
// shape doesn't fit. In real use this is one household's ~10 lists + ~113
// items + 1 marker ≈ 124 writes, so it always runs as exactly one batch;
// chunking only matters as a safety net well past today's data volume,
// same reasoning as the dev plan's own "well under the 500 cap" note.
async function commitInChunks(ops) {
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    ops.slice(i, i + BATCH_SIZE).forEach((op) => op(batch));
    await batch.commit();
  }
}

// Read-only status display, driven by the marker doc written at the end
// of a successful run — see runChecklistsMigration() below for the two
// fields that matter: migratedAt (pre-cutover, freely re-runnable) and
// cutoverAt (set only once js/checklists.js's own switchover ships and
// actually starts reading these collections — NOT by this button, which
// only ever prepares data for that future switchover). Once cutoverAt is
// set, re-running is disabled: after cutover the legacy doc is frozen, so
// this migration's own max-wins reconciliation (see below) could
// otherwise resurrect a completion status someone deliberately un-ticked
// on the new collections after that point.
async function loadMigrationMarker() {
  try {
    const snap = await getDoc(doc(db, 'config', 'checklistsMigration'));
    if (!snap.exists()) {
      migrateMeta.textContent = t('backup.noch_nicht_ausgefuehrt');
      migrateBtn.textContent = t('backup.migration_starten');
      migrateBtn.disabled = false;
      return;
    }
    const data = snap.data();
    if (data.cutoverAt) {
      migrateMeta.textContent = t('backup.abgeschlossen_am', { date: new Date(data.cutoverAt).toLocaleString(getLocale()) });
      migrateBtn.textContent = t('backup.abgeschlossen');
      migrateBtn.disabled = true;
      return;
    }
    migrateMeta.textContent = t('backup.migriert_am_checklisten_eintraege', { date: new Date(data.migratedAt).toLocaleString(getLocale()), listCount: data.listCount, itemCount: data.itemCount });
    migrateBtn.textContent = t('backup.erneut_ausfuehren');
    migrateBtn.disabled = false;
  } catch (err) {
    migrateMeta.textContent = t('backup.status_konnte_nicht_geladen_werden');
    console.error('Migrations-Status konnte nicht geladen werden', err);
  }
}

async function runChecklistsMigration() {
  migrateBtn.disabled = true;
  migrateStatus.textContent = t('backup.pruefe_daten');
  try {
    // Defense in depth, not just the disabled button above: refuse to
    // re-run for real if cutoverAt is already set, in case this ever got
    // triggered some other way (a cached older page, devtools). See the
    // marker-loading comment above for why a post-cutover re-run is
    // actually unsafe, not merely redundant.
    const markerSnap = await getDoc(doc(db, 'config', 'checklistsMigration'));
    if (markerSnap.exists() && markerSnap.data().cutoverAt) {
      migrateStatus.textContent = t('backup.migration_bereits_abgeschlossen_keine_erneute');
      return;
    }

    const snap = await getDoc(doc(db, 'config', 'checklists'));
    const maintenance = snap.exists() && Array.isArray(snap.data().lists) ? snap.data() : { lists: [] };
    const validationError = validateChecklistsForMigration(maintenance);
    if (validationError) {
      migrateStatus.textContent = t('backup.migration_abgebrochen') + validationError;
      migrateBtn.disabled = false;
      return;
    }

    migrateStatus.textContent = t('backup.sicherheits_backup_wird_heruntergeladen');
    const safetyBackup = await buildBackup();
    download(`erdkeller-vor-checklisten-migration-${todayStamp()}.json`, JSON.stringify(safetyBackup, null, 2), 'application/json;charset=utf-8');

    // Max-wins reconciliation (dev plan Step 16.3): on a re-run before
    // cutover, an item already migrated may have a NEWER lastCompletedAt
    // than the legacy doc if someone ticked it on the new collections in
    // the meantime (possible once js/checklists.js's switchover is live
    // for testing but before this migration's "run again" is disabled).
    // Read what's there now so the newer of the two timestamps always
    // wins, never the legacy one just because it happens to run last.
    migrateStatus.textContent = t('backup.lese_bereits_migrierte_eintraege');
    const existingItemsSnap = await getDocs(collection(db, 'checklistItems'));
    const existingItems = new Map(existingItemsSnap.docs.map((d) => [d.id, d.data()]));

    const nowIso = new Date().toISOString();
    const lists = maintenance.lists;
    let itemCount = 0;
    lists.forEach((list) => { itemCount += (list.items || []).length; });

    migrateStatus.textContent = t('backup.migriere_checklisten_eintraege', { length: lists.length, itemCount });
    const ops = [];
    lists.forEach((list) => {
      ops.push((batch) => batch.set(doc(db, 'checklists', list.id), {
        name: list.name || '',
        recipients: list.recipients || [],
        createdAt: list.createdAt || nowIso,
        updatedAt: nowIso,
      }));
      (list.items || []).forEach((item) => {
        const existing = existingItems.get(item.id);
        const legacyCompleted = item.lastCompletedAt || null;
        const existingCompleted = existing ? (existing.lastCompletedAt || null) : null;
        let lastCompletedAt = legacyCompleted;
        if (existingCompleted && (!legacyCompleted || existingCompleted > legacyCompleted)) {
          lastCompletedAt = existingCompleted;
        }
        ops.push((batch) => batch.set(doc(db, 'checklistItems', item.id), {
          listId: list.id,
          text: item.text || '',
          frequency: item.frequency || '',
          lastCompletedAt,
          createdAt: (existing && existing.createdAt) || item.createdAt || nowIso,
          updatedAt: nowIso,
        }));
      });
    });
    ops.push((batch) => batch.set(doc(db, 'config', 'checklistsMigration'), {
      status: CHECKLISTS_CUTOVER_SHIPPED ? 'cutover' : 'migrated',
      migratedAt: nowIso,
      listCount: lists.length,
      itemCount,
      cutoverAt: CHECKLISTS_CUTOVER_SHIPPED ? nowIso : null,
    }));
    await commitInChunks(ops);

    migrateStatus.textContent = t('backup.migration_abgeschlossen_checklisten_eintraege', { length: lists.length, itemCount });
    await loadMigrationMarker();
  } catch (err) {
    migrateStatus.textContent = t('backup.migration_fehlgeschlagen') + err.message;
    console.error(err);
    migrateBtn.disabled = false;
  }
}

migrateBtn.addEventListener('click', runChecklistsMigration);
loadMigrationMarker();
// Language switch (I18N.md): the status line is rendered once per load.
window.addEventListener('erdkeller:langchange', () => loadMigrationMarker());

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
  const existingSnap = await getDocs(collection(db, name));
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
      batch.set(doc(db, name, id), data);
    });
    await batch.commit();
  }
}

async function replaceConfig(config) {
  const entries = config || {};
  for (const id of CONFIG_DOCS) {
    const value = entries[id];
    if (value == null) {
      await deleteDoc(doc(db, 'config', id));
    } else {
      await setDoc(doc(db, 'config', id), value);
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
