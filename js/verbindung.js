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
// Notifications stay genuinely household-level (/config/notifications.enabled,
// Build 154) — surfaced here as a link, not duplicated as a second toggle.
// Cloud backup will be the same shape once Step 16c builds it.
import { db } from './firebase-init.js?v=178';
import { doc, getDoc, disableNetwork, enableNetwork } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const panelEl = document.getElementById('settings-panel-verbindung');
const verbindungCard = document.querySelector('.settings-card[data-target="verbindung"]');
const funkstilleToggle = document.getElementById('verbindung-funkstille-toggle');
const suboptionsEl = document.getElementById('verbindung-suboptions');
const syncToggle = document.getElementById('verbindung-sync-toggle');
const aiToggle = document.getElementById('verbindung-ai-toggle');
const notifStatusEl = document.getElementById('verbindung-notif-status');
const statusEl = document.getElementById('verbindung-status');

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

function applySuboptionsGreyedOut() {
  suboptionsEl.classList.toggle('verbindung-disabled', isFunkstille());
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

// Loaded on card click, same lazy pattern as every other Settings panel
// (e.g. js/notifications.js's own notificationsCard listener) — the
// toggles themselves are pure localStorage reads (instant, no Firestore
// round trip needed), only the Erinnerungen status line below needs a
// network read.
async function loadPanel() {
  funkstilleToggle.checked = isFunkstille();
  syncToggle.checked = readBool(SYNC_KEY, true);
  aiToggle.checked = readBool(AI_KEY, true);
  applySuboptionsGreyedOut();

  statusEl.textContent = '';
  notifStatusEl.textContent = 'Wird geladen…';
  try {
    const snap = await getDoc(doc(db, 'config', 'notifications'));
    const enabled = !snap.exists() || snap.data().enabled !== false;
    notifStatusEl.textContent = enabled ? 'Aktiviert' : 'Deaktiviert';
  } catch (err) {
    notifStatusEl.textContent = 'Status unbekannt';
    console.error(err);
  }
}

verbindungCard.addEventListener('click', loadPanel);
window.addEventListener('erdkeller:refresh', () => {
  if (!panelEl.classList.contains('hidden')) loadPanel();
});
