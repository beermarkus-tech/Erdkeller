// Erinnerungen (Notifications) — Checklisten scheduling config, the master
// on/off toggle, and the Step-17 push-notification setup UI (permission,
// device registration, test send, dry-run preview). SPEC.md's Section 12
// has other notification types landing here later (same one-doc-with-
// subsections shape, just more keys under /config/notifications as they're
// built — no rules or structure churn needed).
//
// This only *defines* what "monatlich"/"vierteljährlich"/etc. mean in
// calendar terms (which weekday, which occurrence, which anchor month),
// plus now when/how often the reminder itself is sent (hour, repeatDays) —
// js/checklists.js is what actually reads the calendar half to decide
// whether an item is done-for-the-current-period; functions/index.js's
// sendReminders is what actually reads the send-time half and dispatches
// the push.
import { db } from './firebase-init.js?v=184';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import {
  permissionState, enableOnThisDevice, refreshIfAlreadyEnabled, listMyDevices, sendTestNotification, previewReminders,
} from './push.js?v=184';

const notificationsCard = document.querySelector('.settings-card[data-target="notifications"]');
const panelEl = document.getElementById('settings-panel-notifications');
const statusEl = document.getElementById('notifications-status');

const enabledToggleEl = document.getElementById('notif-enabled-toggle');
const notifBodyEl = document.getElementById('notif-body');

const weeklyWeekdayEl = document.getElementById('notif-weekly-weekday');
const monthlyWeekEl = document.getElementById('notif-monthly-week');
const monthlyWeekdayEl = document.getElementById('notif-monthly-weekday');
const quarterlyMonthEl = document.getElementById('notif-quarterly-month');
const quarterlyWeekEl = document.getElementById('notif-quarterly-week');
const quarterlyWeekdayEl = document.getElementById('notif-quarterly-weekday');
const halfYearlyMonthEl = document.getElementById('notif-halfyearly-month');
const halfYearlyWeekEl = document.getElementById('notif-halfyearly-week');
const halfYearlyWeekdayEl = document.getElementById('notif-halfyearly-weekday');
const yearlyMonthEl = document.getElementById('notif-yearly-month');
const yearlyWeekEl = document.getElementById('notif-yearly-week');
const yearlyWeekdayEl = document.getElementById('notif-yearly-weekday');
const hourEl = document.getElementById('notif-hour');
const repeatDaysEl = document.getElementById('notif-repeat-days');

const pushStatusEl = document.getElementById('notif-push-status');
const enablePushBtn = document.getElementById('notif-enable-push-btn');
const deviceListEl = document.getElementById('notif-device-list');
const testBtn = document.getElementById('notif-test-btn');
const previewBtn = document.getElementById('notif-preview-btn');
const previewResultEl = document.getElementById('notif-preview-result');

const notificationsRef = doc(db, 'config', 'notifications');

// Sensible fallback until the admin configures this the first time —
// 1st Monday everywhere, 09:00, re-nudge every 3 days. js/checklists.js and
// functions/index.js fall back to the same defaults independently, so the
// three never disagree (kept in sync by hand — same duplicated-small-
// helper convention as everywhere else in this codebase).
function defaultChecklists() {
  return {
    weekly: { weekday: 1 },
    monthly: { weekOfMonth: 1, weekday: 1 },
    quarterly: { anchorMonth: 1, weekOfMonth: 1, weekday: 1 },
    halfYearly: { anchorMonth: 1, weekOfMonth: 1, weekday: 1 },
    yearly: { month: 1, weekOfMonth: 1, weekday: 1 },
    hour: 9,
    repeatDays: 3,
  };
}

// A doc saved before repeatDays (or any single frequency's fields) existed
// only has the top level covered by the old `if (!notifications.checklists)`
// fallback — this deep-merges per key so a partial doc never throws when
// syncFields() reads e.g. c.halfYearly.anchorMonth on a doc that predates it.
function mergeChecklists(stored) {
  const d = defaultChecklists();
  const s = stored || {};
  return {
    weekly: { ...d.weekly, ...(s.weekly || {}) },
    monthly: { ...d.monthly, ...(s.monthly || {}) },
    quarterly: { ...d.quarterly, ...(s.quarterly || {}) },
    halfYearly: { ...d.halfYearly, ...(s.halfYearly || {}) },
    yearly: { ...d.yearly, ...(s.yearly || {}) },
    hour: Number.isFinite(s.hour) ? s.hour : d.hour,
    repeatDays: Number.isFinite(s.repeatDays) && s.repeatDays > 0 ? s.repeatDays : d.repeatDays,
  };
}

let notifications = { enabled: true, checklists: defaultChecklists() };
// Same data-integrity guard as taxonomy.js/planning.js.
let loadOk = false;

async function loadAll() {
  try {
    const snap = await getDoc(notificationsRef);
    const data = snap.exists() ? snap.data() : {};
    notifications = { enabled: data.enabled !== false, checklists: mergeChecklists(data.checklists) };
    loadOk = true;
  } catch (err) {
    loadOk = false;
    statusEl.textContent = 'Fehler beim Laden: ' + err.message;
    console.error(err);
    return;
  }
  syncFields();
  loadPushSection();
}

async function save() {
  if (!loadOk) {
    statusEl.textContent = 'Speichern blockiert: Die Daten wurden zuletzt nicht erfolgreich geladen. Bitte Seite neu laden.';
    return;
  }
  try {
    notifications.updatedAt = new Date().toISOString();
    await setDoc(notificationsRef, notifications);
    statusEl.textContent = '';
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    statusEl.textContent = 'Fehler beim Speichern: ' + err.message;
    console.error(err);
  }
}

function syncFields() {
  enabledToggleEl.checked = notifications.enabled;
  notifBodyEl.classList.toggle('notif-disabled', !notifications.enabled);

  const c = notifications.checklists;
  weeklyWeekdayEl.value = c.weekly.weekday;
  monthlyWeekEl.value = c.monthly.weekOfMonth;
  monthlyWeekdayEl.value = c.monthly.weekday;
  quarterlyMonthEl.value = c.quarterly.anchorMonth;
  quarterlyWeekEl.value = c.quarterly.weekOfMonth;
  quarterlyWeekdayEl.value = c.quarterly.weekday;
  halfYearlyMonthEl.value = c.halfYearly.anchorMonth;
  halfYearlyWeekEl.value = c.halfYearly.weekOfMonth;
  halfYearlyWeekdayEl.value = c.halfYearly.weekday;
  yearlyMonthEl.value = c.yearly.month;
  yearlyWeekEl.value = c.yearly.weekOfMonth;
  yearlyWeekdayEl.value = c.yearly.weekday;
  hourEl.value = c.hour;
  repeatDaysEl.value = c.repeatDays;
}

enabledToggleEl.addEventListener('change', () => {
  notifications.enabled = enabledToggleEl.checked;
  notifBodyEl.classList.toggle('notif-disabled', !notifications.enabled);
  save();
});

[
  [weeklyWeekdayEl, 'weekly', 'weekday'],
  [monthlyWeekEl, 'monthly', 'weekOfMonth'],
  [monthlyWeekdayEl, 'monthly', 'weekday'],
  [quarterlyMonthEl, 'quarterly', 'anchorMonth'],
  [quarterlyWeekEl, 'quarterly', 'weekOfMonth'],
  [quarterlyWeekdayEl, 'quarterly', 'weekday'],
  [halfYearlyMonthEl, 'halfYearly', 'anchorMonth'],
  [halfYearlyWeekEl, 'halfYearly', 'weekOfMonth'],
  [halfYearlyWeekdayEl, 'halfYearly', 'weekday'],
  [yearlyMonthEl, 'yearly', 'month'],
  [yearlyWeekEl, 'yearly', 'weekOfMonth'],
  [yearlyWeekdayEl, 'yearly', 'weekday'],
  [hourEl, 'checklists', 'hour'],
  [repeatDaysEl, 'checklists', 'repeatDays'],
].forEach(([el, freqOrTop, key]) => {
  el.addEventListener('change', () => {
    // hour/repeatDays live directly on notifications.checklists, every
    // other field lives one level deeper under a frequency key — same
    // binding table shape, just two different target depths.
    if (freqOrTop === 'checklists') {
      notifications.checklists[key] = Number(el.value);
    } else {
      notifications.checklists[freqOrTop][key] = Number(el.value);
    }
    save();
  });
});

// --- Push section: permission, device registration, test send, preview --

function formatDeviceLine(device) {
  const seen = device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleDateString('de-DE') : '';
  return `${device.label || 'Gerät'}${seen ? ' · zuletzt ' + seen : ''}`;
}

async function renderDeviceList() {
  deviceListEl.innerHTML = '';
  let devices = [];
  try {
    devices = await listMyDevices();
  } catch (err) {
    console.error(err);
    return;
  }
  if (!devices.length) {
    const p = document.createElement('p');
    p.className = 'taxonomy-status';
    p.textContent = 'Kein Gerät für diesen Account registriert.';
    deviceListEl.appendChild(p);
    return;
  }
  devices.forEach((device) => {
    const row = document.createElement('div');
    row.className = 'stock-product-row';
    row.innerHTML = `<span class="pname">${formatDeviceLine(device)}</span>`;
    deviceListEl.appendChild(row);
  });
}

async function loadPushSection() {
  const state = permissionState();
  if (state === 'unsupported') {
    pushStatusEl.textContent = 'Push-Benachrichtigungen werden von diesem Browser nicht unterstützt.';
    enablePushBtn.classList.add('hidden');
  } else if (state === 'denied') {
    pushStatusEl.textContent = 'Erlaubnis verweigert — lässt sich nur in den Website-Einstellungen des Browsers manuell zurücksetzen, nicht mehr hier.';
    enablePushBtn.classList.add('hidden');
  } else if (state === 'granted') {
    pushStatusEl.textContent = 'Aktiviert auf diesem Gerät.';
    enablePushBtn.textContent = 'Erneut synchronisieren';
    enablePushBtn.classList.remove('hidden');
    enablePushBtn.classList.add('enabled');
    refreshIfAlreadyEnabled();
  } else {
    pushStatusEl.textContent = 'Auf diesem Gerät noch nicht aktiviert.';
    enablePushBtn.textContent = 'Auf diesem Gerät aktivieren';
    enablePushBtn.classList.remove('hidden', 'enabled');
  }
  renderDeviceList();
}

enablePushBtn.addEventListener('click', async () => {
  enablePushBtn.disabled = true;
  pushStatusEl.textContent = 'Aktiviere…';
  try {
    await enableOnThisDevice();
    await loadPushSection();
  } catch (err) {
    pushStatusEl.textContent = err.message;
    console.error(err);
  } finally {
    enablePushBtn.disabled = false;
  }
});

testBtn.addEventListener('click', async () => {
  testBtn.disabled = true;
  const original = testBtn.textContent;
  testBtn.textContent = 'Sende…';
  try {
    const result = await sendTestNotification();
    testBtn.textContent = `Gesendet (${result.succeeded}/${result.total})`;
    if (result.failed && result.failed.length) {
      const lines = result.failed.map((f) => `${f.label || 'Unbekanntes Gerät'}: ${f.error}`).join('\n');
      alert(`${result.failed.length} von ${result.total} Geräten haben die Benachrichtigung nicht angenommen:\n\n${lines}\n\nHinweis: "Erfolgreich" heißt nur, dass FCM die Nachricht angenommen hat — ob sie auf dem Gerät auch angezeigt wird, hängt zusätzlich von Berechtigung und Akku-Einstellungen ab.`);
    }
  } catch (err) {
    testBtn.textContent = 'Fehlgeschlagen';
    console.error(err);
    alert('Testbenachrichtigung fehlgeschlagen: ' + err.message);
  } finally {
    setTimeout(() => { testBtn.textContent = original; testBtn.disabled = false; }, 2000);
  }
});

const FREQ_LABELS = {
  weekly: 'Wöchentlich', monthly: 'Monatlich', quarterly: 'Vierteljährlich', halfYearly: 'Halbjährlich', yearly: 'Jährlich',
};

function formatPreview(result) {
  const lines = [`Aktuelle Uhrzeit (Europe/Paris): ${result.currentParisHour}:00 — konfiguriert: ${result.configuredHour}:00`];
  Object.entries(result.frequencies).forEach(([freq, info]) => {
    const recipientsWithSomething = info.recipients.filter((r) => r.total > 0);
    if (!recipientsWithSomething.length) return;
    lines.push('');
    lines.push(`${FREQ_LABELS[freq] || freq} (Zeitraum ${info.occurrenceKey || '—'}${info.dismissed ? ', als erledigt markiert' : ''}) — würde jetzt senden: ${info.wouldSendNow ? 'ja' : 'nein'}`);
    recipientsWithSomething.forEach((r) => {
      lines.push(`  ${r.slug}: ${r.title} — ${r.body}`);
    });
  });
  return lines.join('\n');
}

previewBtn.addEventListener('click', async () => {
  previewBtn.disabled = true;
  previewResultEl.classList.remove('hidden');
  previewResultEl.textContent = 'Lädt…';
  try {
    const result = await previewReminders();
    previewResultEl.textContent = formatPreview(result);
  } catch (err) {
    previewResultEl.textContent = 'Fehler: ' + err.message;
    console.error(err);
  } finally {
    previewBtn.disabled = false;
  }
});

notificationsCard.addEventListener('click', () => loadAll());
// Build 180 — Erinnerungen/Verbindung merged into one card with two tabs
// (js/reminders-tabs.js). The card click above only fires on the way IN
// to the panel, defaulting to this tab; switching back to it FROM the
// Verbindung tab (already open) needs its own trigger, same lazy-load-
// on-shown convention as the card click.
document.querySelector('.seg-btn[data-reminders-tab="notifications"]').addEventListener('click', () => loadAll());

window.addEventListener('erdkeller:refresh', () => {
  if (!panelEl.classList.contains('hidden')) loadAll();
});
