// Deleting (Build 211, MULTI_HOUSEHOLD.md step 6b): "Konto löschen" for
// everyone (account menu, and the onboarding screen for an account that
// never joined a household), "Haushalt löschen" for admins (account menu).
// Both run server-side (functions/index.js deleteMyAccount/deleteHousehold)
// and are final, so they ask first — the household one by having the
// household's name typed in, which the server checks again.
import { db, functions, getHouseholdId } from './firebase-init.js?v=213';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";
import { t, getLang } from './i18n.js?v=213';
import { signOutAfterDeletion } from './auth.js?v=213';

const deleteMyAccountFn = httpsCallable(functions, 'deleteMyAccount');
const deleteHouseholdFn = httpsCallable(functions, 'deleteHousehold');
const amIOperatorFn = httpsCallable(functions, 'amIOperator');
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
async function checkOperator() {
  if (!navigator.onLine) return;
  try {
    const { data } = await amIOperatorFn({ lang: getLang() });
    operatorCard.classList.toggle('hidden', !(data && data.operator));
  } catch (err) {
    operatorCard.classList.add('hidden');
  }
}

// Only an admin of a real household sees "Haushalt löschen".
window.addEventListener('erdkeller:signedin', (e) => {
  const show = e.detail.role === 'admin' && !!getHouseholdId();
  householdBtns.forEach((btn) => btn.classList.toggle('hidden', !show));
  if (e.detail.role === 'admin') checkOperator();
  else operatorCard.classList.add('hidden');
});
window.addEventListener('erdkeller:signedout', () => {
  householdBtns.forEach((btn) => btn.classList.add('hidden'));
  operatorCard.classList.add('hidden');
});
