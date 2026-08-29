// Erinnerungen (Notifications) — currently just the Checklisten subsection;
// SPEC.md's Section 12 has other notification types landing here later
// (same one-doc-with-subsections shape, just more keys under /config/
// notifications as they're built — no rules or structure churn needed).
//
// This only *defines* what "monatlich"/"vierteljährlich"/etc. mean in
// calendar terms (which weekday, which occurrence, which anchor month) —
// js/checklists.js is what actually reads this to decide whether an item
// is done-for-the-current-period. Actually *sending* a reminder at the
// resulting date/time is Step 17 (push notifications), not built yet; the
// 9:00 send time is hardcoded for now since there's nothing to configure
// it against until that step exists.
import { db } from './firebase-init.js?v=126';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const notificationsCard = document.querySelector('.settings-card[data-target="notifications"]');
const panelEl = document.getElementById('settings-panel-notifications');
const statusEl = document.getElementById('notifications-status');

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

const notificationsRef = doc(db, 'config', 'notifications');

// Sensible fallback until the admin configures this the first time —
// 1st Monday everywhere. js/checklists.js falls back to the same defaults
// independently if the doc doesn't exist yet, so the two never disagree.
function defaultChecklists() {
  return {
    weekly: { weekday: 1 },
    monthly: { weekOfMonth: 1, weekday: 1 },
    quarterly: { anchorMonth: 1, weekOfMonth: 1, weekday: 1 },
    halfYearly: { anchorMonth: 1, weekOfMonth: 1, weekday: 1 },
    yearly: { month: 1, weekOfMonth: 1, weekday: 1 },
    hour: 9,
  };
}

let notifications = { checklists: defaultChecklists() };
// Same data-integrity guard as taxonomy.js/planning.js.
let loadOk = false;

async function loadAll() {
  try {
    const snap = await getDoc(notificationsRef);
    notifications = snap.exists() ? snap.data() : { checklists: defaultChecklists() };
    if (!notifications.checklists) notifications.checklists = defaultChecklists();
    loadOk = true;
  } catch (err) {
    loadOk = false;
    statusEl.textContent = 'Fehler beim Laden: ' + err.message;
    console.error(err);
    return;
  }
  syncFields();
}

async function save() {
  if (!loadOk) {
    statusEl.textContent = 'Speichern blockiert: Die Daten wurden zuletzt nicht erfolgreich geladen. Bitte Seite neu laden.';
    return;
  }
  try {
    await setDoc(notificationsRef, notifications);
    statusEl.textContent = '';
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    statusEl.textContent = 'Fehler beim Speichern: ' + err.message;
    console.error(err);
  }
}

function syncFields() {
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
}

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
].forEach(([el, freq, key]) => {
  el.addEventListener('change', () => {
    notifications.checklists[freq][key] = Number(el.value);
    save();
  });
});

notificationsCard.addEventListener('click', () => loadAll());

window.addEventListener('erdkeller:refresh', () => {
  if (!panelEl.classList.contains('hidden')) loadAll();
});
