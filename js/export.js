// Settings → Export (SPEC.md Section 20.2.3: "two distinct formats for two
// distinct use cases") — five per-section CSV downloads (for opening/
// editing one section in a spreadsheet) plus one full JSON database backup
// (a faithful, restorable copy of everything, mirroring Firestore's own
// shape 1:1). Deliberately export-only: no import/restore, no offline
// IndexedDB mirror to read from (that's Section 20.2.2/20.2.4, both marked
// "V2, not yet scoped" and not built anywhere in this app yet) — every
// button here does a live Firestore read at click time, same as every
// other screen in the app already does, and just triggers a download.
import { db } from './firebase-init.js?v=120';
import {
  collection, getDocs, doc, getDoc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

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
  const snap = await getDoc(doc(db, 'config', 'checklists'));
  const lists = snap.exists() && Array.isArray(snap.data().lists) ? snap.data().lists : [];
  const rows = [];
  lists.forEach((list) => {
    (list.items || []).forEach((item) => {
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

const COLLECTIONS = ['products', 'stockItems', 'stockLog', 'contacts', 'notes', 'recipes', 'users'];
const CONFIG_DOCS = [
  'taxonomy', 'targets', 'household', 'planning',
  'storageLocations', 'yearColorMap', 'checklists', 'crisisTypes', 'notifications',
];

jsonBtn.addEventListener('click', async () => {
  jsonBtn.disabled = true;
  statusEl.textContent = '';
  try {
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
    download(`erdkeller-backup-${todayStamp()}.json`, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
  } catch (err) {
    statusEl.textContent = 'Backup fehlgeschlagen: ' + err.message;
    console.error(err);
  } finally {
    jsonBtn.disabled = false;
  }
});
