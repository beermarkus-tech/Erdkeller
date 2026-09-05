// Verbindung (Step 16b) — Funkstille and the per-device connection
// toggles. SPEC.md Section 13.5: Funkstille, sync, and AI/Diktieren are
// deliberately PER-DEVICE settings, stored in localStorage rather than
// Firestore — the fourth deliberate localStorage use in this app (after
// js/push.js's deviceId, js/auth.js's cached identity, and the pending-
// redirect flag). Turning Funkstille on from the phone must not cut the
// tablet off, and the setting has to be readable synchronously, before
// Firestore is even reachable — a household-wide flag would have exactly
// that bootstrap problem, since a device that was already offline when it
// was flipped would never learn about it.
//
// Build 180 — merged into the same card/panel as Erinnerungen, as its own
// "Verbindung" tab (js/reminders-tabs.js), and the Erinnerungen master
// toggle got a THIRD checkbox here (Markus: a link out to the other tab
// wasn't wanted). Unlike Funkstille/Sync/AI, this one is genuinely
// household-level — it's the exact same /config/notifications.enabled
// field js/notifications.js's own toggle writes (Build 154) — so this
// file writes it with a targeted updateDoc (enabled + updatedAt only),
// never a whole-object setDoc, so it can never clobber the schedule
// fields js/notifications.js keeps in memory. The two checkboxes stay in
// sync by both re-reading this field fresh every time their OWN tab is
// opened (this file's loadPanel, js/notifications.js's loadAll) — the
// same lazy-load-on-shown convention already used everywhere else in
// Settings, not a live listener, since the two are tabs in one screen and
// only one is ever visible at a time.
import { db } from './firebase-init.js?v=184';
import {
  doc, getDoc, updateDoc, disableNetwork, enableNetwork,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const panelEl = document.getElementById('settings-panel-notifications');
const verbindungTabEl = document.querySelector('.reminders-tab[data-reminders-tab-panel="verbindung"]');
const verbindungTabBtn = document.querySelector('.seg-btn[data-reminders-tab="verbindung"]');
const funkstilleToggle = document.getElementById('verbindung-funkstille-toggle');
const suboptionsEl = document.getElementById('verbindung-suboptions');
const syncToggle = document.getElementById('verbindung-sync-toggle');
const aiToggle = document.getElementById('verbindung-ai-toggle');
const remindersToggle = document.getElementById('verbindung-reminders-toggle');
const statusEl = document.getElementById('verbindung-status');
const notificationsRef = doc(db, 'config', 'notifications');

const FUNKSTILLE_KEY = 'erdkeller-funkstille';
const SYNC_KEY = 'erdkeller-sync-enabled';
const AI_KEY = 'erdkeller-ai-enabled';

function readBool(key, defaultValue) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? defaultValue : v === '1';
  } catch (err) {
    return defaultValue;
  }
}

function writeBool(key, value) {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch (err) { /* ignore */ }
}

// Not exported — js/firebase-init.js and js/dictate.js each keep their own
// tiny duplicate of this same read logic (house convention: duplicate
// small helpers rather than share them), since both need it synchronously
// at module load, before this module is guaranteed to have run yet; they
// react to later changes via the erdkeller:verbindung-changed event below
// instead of a live import.
function isFunkstille() {
  return readBool(FUNKSTILLE_KEY, false);
}

function isSyncEnabled() {
  return !isFunkstille() && readBool(SYNC_KEY, true);
}

// The single source of truth for "should the network actually be on right
// now" — Firestore's disableNetwork()/enableNetwork() ARE the mutation
// queue (SPEC.md Section 13.5), so there's nothing else to wire up. Called
// on every toggle change here; js/firebase-init.js applies the same
// combined state once at boot, before this panel has even loaded.
function applyNetworkState() {
  if (isSyncEnabled()) {
    enableNetwork(db).catch(() => {});
  } else {
    disableNetwork(db).catch(() => {});
  }
}

// Build 181 — a greyed-but-still-checked box read as "still on" (Markus:
// wanted Funkstille to visibly uncheck the three below it, not just grey
// them). This only changes what's DISPLAYED while Funkstille is on: the
// underlying stored preference (localStorage for Sync/AI, lastKnownRemindersEnabled
// for Erinnerungen) is untouched, so switching Funkstille back off restores
// each toggle to whatever it actually was — never forces them back on.
// isSyncEnabled()/js/dictate.js's aiDisabled() already treated Funkstille
// as an override for the REAL behavior regardless of the checkbox's own
// state; this just makes the display stop contradicting that.
let lastKnownRemindersEnabled = true;

function applySuboptionsGreyedOut() {
  const funkstille = isFunkstille();
  suboptionsEl.classList.toggle('verbindung-disabled', funkstille);
  syncToggle.checked = funkstille ? false : readBool(SYNC_KEY, true);
  aiToggle.checked = funkstille ? false : readBool(AI_KEY, true);
  remindersToggle.checked = funkstille ? false : lastKnownRemindersEnabled;
}

// Lets js/dictate.js (and anything else per-device-setting-aware in the
// future) react immediately to a toggle flip on this device without a
// reload — mirrors how every other cross-screen data change in this app
// already announces itself via a window CustomEvent rather than a shared
// module import.
function announceChange() {
  window.dispatchEvent(new CustomEvent('erdkeller:verbindung-changed'));
}

funkstilleToggle.addEventListener('change', () => {
  writeBool(FUNKSTILLE_KEY, funkstilleToggle.checked);
  applySuboptionsGreyedOut();
  applyNetworkState();
  announceChange();
});

syncToggle.addEventListener('change', () => {
  writeBool(SYNC_KEY, syncToggle.checked);
  applyNetworkState();
  announceChange();
});

aiToggle.addEventListener('change', () => {
  writeBool(AI_KEY, aiToggle.checked);
  announceChange();
});

remindersToggle.addEventListener('change', async () => {
  const enabled = remindersToggle.checked;
  statusEl.textContent = '';
  try {
    await updateDoc(notificationsRef, { enabled, updatedAt: new Date().toISOString() });
    lastKnownRemindersEnabled = enabled;
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    remindersToggle.checked = !enabled;
    statusEl.textContent = 'Fehler beim Speichern: ' + err.message;
    console.error(err);
  }
});

// Loaded on this tab's own button click, same lazy pattern as every other
// Settings panel (e.g. js/notifications.js's own notificationsCard
// listener) — the per-device toggles are pure localStorage reads (instant,
// no Firestore round trip needed), only the Erinnerungen checkbox needs a
// network read.
async function loadPanel() {
  funkstilleToggle.checked = isFunkstille();
  applySuboptionsGreyedOut();

  statusEl.textContent = '';
  try {
    const snap = await getDoc(notificationsRef);
    lastKnownRemindersEnabled = !snap.exists() || snap.data().enabled !== false;
    applySuboptionsGreyedOut();
  } catch (err) {
    statusEl.textContent = 'Status der Erinnerungen unbekannt: ' + err.message;
    console.error(err);
  }
}

verbindungTabBtn.addEventListener('click', loadPanel);
window.addEventListener('erdkeller:refresh', () => {
  if (!panelEl.classList.contains('hidden') && !verbindungTabEl.classList.contains('hidden')) loadPanel();
});
