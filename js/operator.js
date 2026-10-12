// Operator overview page (operator.html, Build 212) — see that file and
// functions/index.js listHouseholds. Reuses the app's sign-in: whoever is
// signed in to the app in this browser is signed in here.
import { auth, functions } from './firebase-init.js?v=213';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";
import { t, getLang, getLocale } from './i18n.js?v=213';

const statusEl = document.getElementById('operator-status');
const summaryEl = document.getElementById('operator-summary');
const listEl = document.getElementById('operator-list');
const listHouseholdsFn = httpsCallable(functions, 'listHouseholds');
let lastData = null;

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(getLocale()) : '—');

function line(label, value) {
  const row = document.createElement('div');
  row.className = 'operator-line';
  const l = document.createElement('span');
  l.className = 'pmeta';
  l.textContent = label;
  const v = document.createElement('span');
  v.textContent = value;
  row.append(l, v);
  return row;
}

function render() {
  if (!lastData) return;
  const { households, accountsWithoutHousehold, signup } = lastData;
  const people = households.reduce((sum, h) => sum + h.members, 0);
  summaryEl.innerHTML = '';
  summaryEl.append(
    line(t('operator.haushalte'), String(households.length)),
    line(t('operator.personen'), String(people)),
    line(t('operator.ohne_haushalt'), String(accountsWithoutHousehold)),
    line(t('operator.neue_haushalte'), signup.open
      ? t('operator.offen')
      : t('operator.geschlossen', { count: signup.allowEmails })),
  );
  listEl.innerHTML = '';
  households.forEach((h) => {
    const card = document.createElement('div');
    card.className = 'operator-card';
    const title = document.createElement('div');
    title.className = 'pname';
    title.textContent = h.name || '—';
    card.appendChild(title);
    card.append(
      line(t('operator.angelegt'), fmtDate(h.createdAt)),
      line(t('operator.land_sprache'), [h.country || '—', (h.lang || '—').toUpperCase(), h.timezone || '—'].join(' · ')),
      line(t('operator.mitglieder'), String(h.members)),
      line(t('operator.admins'), h.admins.map((a) => [a.name, a.email].filter(Boolean).join(' ')).join(', ') || '—'),
      line(t('operator.offene_einladungen'), String(h.openInvites)),
      line(t('operator.diktate_7_tage'), t('operator.diktate_wert', { count: h.dictation7, limit: h.dictationLimit })),
      line(t('operator.letztes_diktat'), h.lastDictation ? fmtDate(h.lastDictation) : '—'),
      line(t('operator.zuletzt_beigetreten'), fmtDate(h.lastJoinedAt)),
    );
    listEl.appendChild(card);
  });
}

async function load() {
  statusEl.textContent = t('operator.laedt');
  try {
    const { data } = await listHouseholdsFn({ lang: getLang() });
    lastData = data;
    statusEl.textContent = '';
    render();
  } catch (err) {
    console.error(err);
    statusEl.textContent = err.message;
  }
}

onAuthStateChanged(auth, (user) => {
  if (user) load();
  else statusEl.textContent = t('operator.bitte_anmelden');
});
window.addEventListener('erdkeller:langchange', render);
