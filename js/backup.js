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
import { db } from './firebase-init.js?v=174';
import {
  collection, getDocs, doc, getDoc, setDoc, deleteDoc, writeBatch,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

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
    statusEl.textContent = 'Export fehlgeschlagen: ' + err.message;
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
    { label: 'Typ', get: (r) => r.type },
    { label: 'Kategorie', get: (r) => r.category },
    { label: 'Unterkategorie', get: (r) => r.subcategory },
    { label: 'Produkt', get: (r) => productNames.get(r.productId) || '' },
    { label: 'Details', get: (r) => r.details },
    { label: 'Menge', get: (r) => r.quantity },
    { label: 'Inhalt', get: (r) => r.content },
    { label: 'MHD', get: (r) => r.bestBefore },
    { label: 'Lagerort', get: (r) => r.storage },
    { label: 'Erstellt', get: (r) => r.createdAt },
    { label: 'Geändert', get: (r) => r.updatedAt },
  ];
  return { rows, columns };
}));

// --- Checklisten (maintenance only — the crisis reference isn't a
// frequency-based checklist and isn't part of this export) --------------

checklistsBtn.addEventListener('click', () => downloadCsv(checklistsBtn, 'checklisten', async () => {
  const FREQ_LABELS = {
    weekly: 'Wöchentlich', monthly: 'Monatlich', quarterly: 'Vierteljährlich', halfYearly: 'Halbjährlich', yearly: 'Jährlich',
  };
  // Reads the legacy single document for now — see js/pdf-export.js's
  // buildMaintenanceSection for why this and the PDF export both stay on
  // /config/checklists until the Step 16.3 cutover switches all three
  // read sites (this one, the PDF, and js/checklists.js itself) together.
  const snap = await getDoc(doc(db, 'config', 'checklists'));
  const rawLists = snap.exists() && Array.isArray(snap.data().lists) ? snap.data().lists : [];
  // Explicit sort reproducing sortMaintenanceInPlace()'s comparator — see
  // js/pdf-export.js's identical comment; that function is retired as
  // part of this same migration, so this keeps CSV output byte-identical
  // across the change rather than depending on stored array order.
  const lists = [...rawLists].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
  const rows = [];
  lists.forEach((list) => {
    const items = [...(list.items || [])].sort((a, b) => (a.text || '').localeCompare(b.text || '', 'de'));
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
    { label: 'Checkliste', get: (r) => r.list },
    { label: 'Aufgabe', get: (r) => r.text },
    { label: 'Häufigkeit', get: (r) => r.frequency },
    { label: 'Zuletzt erledigt', get: (r) => r.lastCompletedAt },
  ];
  return { rows, columns };
}));

// --- Kontakte -----------------------------------------------------------

contactsBtn.addEventListener('click', () => downloadCsv(contactsBtn, 'kontakte', async () => {
  const snap = await getDocs(collection(db, 'contacts'));
  const rows = snap.docs.map((d) => d.data());
  const columns = [
    { label: 'Name', get: (r) => r.name },
    { label: 'Rolle', get: (r) => r.role },
    { label: 'Telefon', get: (r) => r.phone },
    { label: 'Adresse', get: (r) => r.address },
    { label: 'Notizen', get: (r) => r.notes },
    { label: 'Notruf', get: (r) => (r.isEmergency ? 'Ja' : 'Nein') },
  ];
  return { rows, columns };
}));

// --- Notizen --------------------------------------------------------------

notesBtn.addEventListener('click', () => downloadCsv(notesBtn, 'notizen', async () => {
  const snap = await getDocs(collection(db, 'notes'));
  const rows = snap.docs.map((d) => d.data());
  const columns = [
    { label: 'Titel', get: (r) => r.title },
    { label: 'Text', get: (r) => bodyPlainText(r.body) },
    { label: 'Foto vorhanden', get: (r) => ((r.photos || []).length ? 'Ja' : 'Nein') },
    { label: 'Erstellt', get: (r) => r.createdAt },
    { label: 'Geändert', get: (r) => r.updatedAt },
  ];
  return { rows, columns };
}));

// --- Rezepte --------------------------------------------------------------

recipesBtn.addEventListener('click', () => downloadCsv(recipesBtn, 'rezepte', async () => {
  const snap = await getDocs(collection(db, 'recipes'));
  const rows = snap.docs.map((d) => d.data());
  const columns = [
    { label: 'Titel', get: (r) => r.title },
    { label: 'Tags', get: (r) => (r.tags || []).join('; ') },
    { label: 'Zutaten', get: (r) => (r.ingredients || []).join('; ') },
    { label: 'Zubereitung', get: (r) => bodyPlainText(r.body) },
    { label: 'Foto vorhanden', get: (r) => ((r.photos || []).length ? 'Ja' : 'Nein') },
    { label: 'Erstellt', get: (r) => r.createdAt },
    { label: 'Geändert', get: (r) => r.updatedAt },
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
    statusEl.textContent = 'Backup fehlgeschlagen: ' + err.message;
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
  if (!lists.length) return 'Keine Checklisten gefunden — nichts zu migrieren.';
  const listIds = new Set();
  const itemIds = new Set();
  for (const list of lists) {
    if (!list.id) return `Checkliste "${list.name || '(ohne Namen)'}" hat keine ID.`;
    if (String(list.id).includes('/')) return `Checklisten-ID "${list.id}" enthält ein "/" und kann nicht migriert werden.`;
    if (listIds.has(list.id)) return `Doppelte Checklisten-ID "${list.id}".`;
    listIds.add(list.id);
    for (const item of (list.items || [])) {
      if (!item.id) return `Ein Eintrag in "${list.name || list.id}" hat keine ID.`;
      if (String(item.id).includes('/')) return `Eintrags-ID "${item.id}" enthält ein "/" und kann nicht migriert werden.`;
      if (itemIds.has(item.id)) return `Doppelte Eintrags-ID "${item.id}" — würde beim Umstieg auf einzelne Dokumente kollidieren.`;
      itemIds.add(item.id);
    }
  }
  return null;
}

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
      migrateMeta.textContent = 'Noch nicht ausgeführt';
      migrateBtn.textContent = 'Migration starten';
      migrateBtn.disabled = false;
      return;
    }
    const data = snap.data();
    if (data.cutoverAt) {
      migrateMeta.textContent = `Abgeschlossen am ${new Date(data.cutoverAt).toLocaleString('de-DE')}`;
      migrateBtn.textContent = 'Abgeschlossen';
      migrateBtn.disabled = true;
      return;
    }
    migrateMeta.textContent = `Migriert am ${new Date(data.migratedAt).toLocaleString('de-DE')} — ${data.listCount} Checklisten, ${data.itemCount} Einträge`;
    migrateBtn.textContent = 'Erneut ausführen';
    migrateBtn.disabled = false;
  } catch (err) {
    migrateMeta.textContent = 'Status konnte nicht geladen werden';
    console.error('Migrations-Status konnte nicht geladen werden', err);
  }
}

async function runChecklistsMigration() {
  migrateBtn.disabled = true;
  migrateStatus.textContent = 'Prüfe Daten…';
  try {
    const snap = await getDoc(doc(db, 'config', 'checklists'));
    const maintenance = snap.exists() && Array.isArray(snap.data().lists) ? snap.data() : { lists: [] };
    const validationError = validateChecklistsForMigration(maintenance);
    if (validationError) {
      migrateStatus.textContent = 'Migration abgebrochen: ' + validationError;
      migrateBtn.disabled = false;
      return;
    }

    migrateStatus.textContent = 'Sicherheits-Backup wird heruntergeladen…';
    const safetyBackup = await buildBackup();
    download(`erdkeller-vor-checklisten-migration-${todayStamp()}.json`, JSON.stringify(safetyBackup, null, 2), 'application/json;charset=utf-8');

    // Max-wins reconciliation (dev plan Step 16.3): on a re-run before
    // cutover, an item already migrated may have a NEWER lastCompletedAt
    // than the legacy doc if someone ticked it on the new collections in
    // the meantime (possible once js/checklists.js's switchover is live
    // for testing but before this migration's "run again" is disabled).
    // Read what's there now so the newer of the two timestamps always
    // wins, never the legacy one just because it happens to run last.
    migrateStatus.textContent = 'Lese bereits migrierte Einträge…';
    const existingItemsSnap = await getDocs(collection(db, 'checklistItems'));
    const existingItems = new Map(existingItemsSnap.docs.map((d) => [d.id, d.data()]));

    const nowIso = new Date().toISOString();
    const lists = maintenance.lists;
    let itemCount = 0;
    lists.forEach((list) => { itemCount += (list.items || []).length; });

    migrateStatus.textContent = `Migriere ${lists.length} Checklisten, ${itemCount} Einträge…`;
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
      status: 'migrated',
      migratedAt: nowIso,
      listCount: lists.length,
      itemCount,
      cutoverAt: null,
    }));
    await commitInChunks(ops);

    migrateStatus.textContent = `Migration abgeschlossen: ${lists.length} Checklisten, ${itemCount} Einträge.`;
    await loadMigrationMarker();
  } catch (err) {
    migrateStatus.textContent = 'Migration fehlgeschlagen: ' + err.message;
    console.error(err);
    migrateBtn.disabled = false;
  }
}

migrateBtn.addEventListener('click', runChecklistsMigration);
loadMigrationMarker();

// --- Import (full-replace JSON restore) -------------------------------
// Deletes every doc in each collection above and every /config doc, then
// recreates them from the chosen backup file — a complete replace, not a
// merge. Firestore batches cap at 500 writes, so both the delete and the
// write phase of each collection are chunked (same pattern as Settings →
// Verlauf's "Verlauf löschen", js/stock-log.js's deleteAllLogs).

const CONFIRM_PHRASE = 'ALLES ERSETZEN';

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
    return 'Die Datei enthält kein gültiges Backup-Objekt.';
  }
  for (const name of COLLECTIONS) {
    if (name in obj && !Array.isArray(obj[name])) {
      return `Das Feld "${name}" müsste eine Liste sein.`;
    }
  }
  if ('config' in obj && (typeof obj.config !== 'object' || obj.config === null || Array.isArray(obj.config))) {
    return 'Das Feld "config" müsste ein Objekt sein.';
  }
  return null;
}

function describeBackup(backup) {
  const lines = [];
  if (backup.exportedAt) lines.push(`Erstellt am: ${new Date(backup.exportedAt).toLocaleString('de-DE')}`);
  COLLECTIONS.forEach((name) => {
    lines.push(`${name}: ${(backup[name] || []).length}`);
  });
  const configKeys = backup.config ? Object.keys(backup.config).filter((k) => backup.config[k] != null) : [];
  lines.push(`Einstellungen enthalten: ${configKeys.length ? configKeys.join(', ') : '—'}`);
  return lines;
}

importFileBtn.addEventListener('click', () => importFileInput.click());

importFileInput.addEventListener('change', async () => {
  const file = importFileInput.files[0];
  importFileInput.value = '';
  if (!file) return;
  importFileName.textContent = file.name;
  resetImportState('Datei wird geprüft…');
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const err = validateBackup(parsed);
    if (err) {
      resetImportState('Datei ungültig: ' + err);
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
    resetImportState('Datei ungültig: konnte nicht als JSON gelesen werden.');
    console.error(err);
  }
});

importConfirmInput.addEventListener('input', () => {
  importConfirmBtn.disabled = !pendingBackup || importConfirmInput.value !== CONFIRM_PHRASE;
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
  if (!pendingBackup || importConfirmInput.value !== CONFIRM_PHRASE) return;
  importFileBtn.disabled = true;
  importConfirmBtn.disabled = true;
  importConfirmInput.disabled = true;
  try {
    importStatus.textContent = 'Sicherheits-Backup der aktuellen Daten wird heruntergeladen…';
    const safetyBackup = await buildBackup();
    download(`erdkeller-vor-import-backup-${todayStamp()}.json`, JSON.stringify(safetyBackup, null, 2), 'application/json;charset=utf-8');

    for (let i = 0; i < COLLECTIONS.length; i++) {
      const name = COLLECTIONS[i];
      importStatus.textContent = `Ersetze ${name}… (${i + 1}/${COLLECTIONS.length + 1})`;
      await replaceCollection(name, pendingBackup[name]);
    }
    importStatus.textContent = `Aktualisiere Einstellungen… (${COLLECTIONS.length + 1}/${COLLECTIONS.length + 1})`;
    await replaceConfig(pendingBackup.config);

    importStatus.textContent = 'Fertig — wird neu geladen…';
    setTimeout(() => location.reload(), 1000);
  } catch (err) {
    importStatus.textContent = 'Import fehlgeschlagen: ' + err.message + ' — bitte Datei erneut auswählen und Bestätigung erneut eingeben.';
    console.error(err);
    importFileBtn.disabled = false;
    importConfirmInput.disabled = false;
    importConfirmInput.value = '';
    importConfirmBtn.disabled = true;
  }
});
