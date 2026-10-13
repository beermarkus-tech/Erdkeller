// Deleting (Build 211, MULTI_HOUSEHOLD.md step 6b): "Konto löschen" for
// everyone (account menu, and the onboarding screen for an account that
// never joined a household), "Haushalt löschen" for admins (account menu).
// Both run server-side (functions/index.js deleteMyAccount/deleteHousehold)
// and are final, so they ask first — the household one by having the
// household's name typed in, which the server checks again.
import { auth, db, functions, getHouseholdId } from './firebase-init.js?v=214';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";
import { t, getLang } from './i18n.js?v=214';
import { signOutAfterDeletion } from './auth.js?v=214';

const deleteMyAccountFn = httpsCallable(functions, 'deleteMyAccount');
const deleteHouseholdFn = httpsCallable(functions, 'deleteHousehold');
const amIOperatorFn = httpsCallable(functions, 'amIOperator');
const listHouseholdsFn = httpsCallable(functions, 'listHouseholds');
const operatorCard = document.getElementById('operator-card');

const accountBtns = document.querySelectorAll('.delete-account-btn');
const householdBtns = document.querySelectorAll('.delete-household-btn');
let busy = false;

function online() {
  if (navigator.onLine) return true;
  alert(t('account.nur_online'));
  return false;
}

async function deleteAccount() {
  if (busy || !online()) return;
  if (!confirm(t('account.konto_loeschen_confirm'))) return;
  busy = true;
  try {
    await deleteMyAccountFn({ lang: getLang() });
    signOutAfterDeletion(t('account.konto_geloescht'));
  } catch (err) {
    console.error(err);
    alert(t('account.loeschen_fehlgeschlagen') + err.message);
  } finally {
    busy = false;
  }
}

async function deleteHousehold() {
  const hid = getHouseholdId();
  if (busy || !hid || !online()) return;
  let name = '';
  try {
    const snap = await getDoc(doc(db, 'households', hid));
    name = (snap.exists() && snap.data().name) || '';
  } catch (err) {
    console.error(err);
  }
  const typed = prompt(t('account.haushalt_loeschen_prompt', { name }));
  if (typed === null) return;
  busy = true;
  try {
    await deleteHouseholdFn({ confirmName: typed.trim(), lang: getLang() });
    // The account listener (js/auth.js) now sees no household and reloads
    // into the onboarding screen.
    alert(t('account.haushalt_geloescht'));
  } catch (err) {
    console.error(err);
    alert(t('account.loeschen_fehlgeschlagen') + err.message);
  } finally {
    busy = false;
  }
}

accountBtns.forEach((btn) => btn.addEventListener('click', deleteAccount));
householdBtns.forEach((btn) => btn.addEventListener('click', deleteHousehold));

// Build 213 — the "Betrieb" card (operator.html) in Admin, only for the
// operator: the server decides (functions/index.js amIOperator, the
// addresses in _system/config.operators). The page itself checks again,
// so a card shown by mistake would still reveal nothing.
//
// Build 214 — made robust after the card stayed hidden for the operator:
// - wait until Firebase Auth has really resolved (the first erdkeller:
//   signedin can come from the cached identity, before the session exists,
//   and an unauthenticated call simply fails);
// - if amIOperator itself fails (e.g. not deployed yet), ask listHouseholds
//   instead — it answers the same question by succeeding or refusing;
// - remember a "yes" per account on this device, so the card shows at once
//   on the next start (and offline); a server "no" removes it again.
const OPERATOR_KEY = 'erdkeller-operator-uid';

function rememberedOperator(uid) {
  try { return !!uid && localStorage.getItem(OPERATOR_KEY) === uid; } catch (err) { return false; }
}

function setOperator(uid, yes) {
  operatorCard.classList.toggle('hidden', !yes);
  try {
    if (yes) localStorage.setItem(OPERATOR_KEY, uid);
    else if (localStorage.getItem(OPERATOR_KEY) === uid) localStorage.removeItem(OPERATOR_KEY);
  } catch (err) { /* ignore */ }
}

async function askServer() {
  try {
    const { data } = await amIOperatorFn({ lang: getLang() });
    return !!(data && data.operator);
  } catch (err) {
    console.warn('amIOperator failed, asking listHouseholds instead', err);
  }
  try {
    await listHouseholdsFn({ lang: getLang() });
    return true;
  } catch (err) {
    const code = String(err.code || '');
    if (code.endsWith('permission-denied') || code.endsWith('failed-precondition')) return false;
    throw err;
  }
}

async function checkOperator() {
  if (auth.authStateReady) await auth.authStateReady();
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) return;
  if (rememberedOperator(uid)) operatorCard.classList.remove('hidden');
  if (!navigator.onLine) return;
  try {
    setOperator(uid, await askServer());
  } catch (err) {
    // Network or server trouble: keep whatever we knew, try again later.
    console.error('Operator check failed', err);
  }
}
window.addEventListener('online', () => {
  if (!operatorCard.dataset.admin) return;
  checkOperator();
});

// Only an admin of a real household sees "Haushalt löschen".
window.addEventListener('erdkeller:signedin', (e) => {
  const show = e.detail.role === 'admin' && !!getHouseholdId();
  householdBtns.forEach((btn) => btn.classList.toggle('hidden', !show));
  operatorCard.dataset.admin = e.detail.role === 'admin' ? '1' : '';
  if (e.detail.role === 'admin') checkOperator();
  else operatorCard.classList.add('hidden');
});
window.addEventListener('erdkeller:signedout', () => {
  householdBtns.forEach((btn) => btn.classList.add('hidden'));
  operatorCard.classList.add('hidden');
});
