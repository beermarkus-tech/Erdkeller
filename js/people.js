import { auth, db, getHouseholdId } from './firebase-init.js?v=203';
import {
  collection, getDocs, doc, updateDoc, query, where,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { t, getLocale } from './i18n.js?v=203';

const peopleCard = document.querySelector('.settings-card[data-target="people"]');
const peopleListEl = document.getElementById('people-list');
const peoplePanel = document.getElementById('settings-panel-people');
const pendingBadge = document.getElementById('people-pending-badge');

function roleLabel(role) {
  return role === 'admin' ? t('people.admin') : t('people.mitglied');
}

// Removal (Build 180) — tombstone, not delete. Deleting the /users/{uid}
// doc would let the exact same self-provisioning rule that lets new
// members join silently let a removed person re-join as a fresh member
// the next time they open the app (firestore.rules' /users/{userId}
// create rule fires whenever the doc doesn't exist). Setting removed:true
// instead keeps the doc in place, so that create rule never fires again
// for this uid — and firestore.rules' tightened isSignedIn() (Build 180)
// means every OTHER rule in the database that gates on it now denies this
// uid immediately, on its very next request. recipientSlug is cleared in
// the same write so a removed person stops being a checklist-reminder
// recipient right away too.

// Checklisten-Erinnerungen (SPEC.md Step 17): list.recipients on a
// checklist holds these same hardcoded slugs — there's no other link
// anywhere between a real signed-in account and "who gets notified about
// the Autos checklist." This is the one place that mapping gets made.
const RECIPIENT_SLUG_OPTIONS = [
  { value: '', get label() { return t('people.kein_empfaenger'); } },
  { value: 'markus', label: 'Markus' },
  { value: 'julia', label: 'Julia' },
  { value: 'sophia', label: 'Sophia' },
];

// The whole Settings tab is already admin-only (app-shell.js), so anyone
// who can even open this screen is an admin — no separate isAdmin gate
// needed here, unlike the shared Info-tab screens (Kontakte/Notizen).
function makePersonRow(id, data) {
  const row = document.createElement('div');
  row.className = 'stock-product-row people-row' + (data.removed ? ' people-row-removed' : '');

  const avatar = document.createElement('img');
  avatar.className = 'user-avatar people-avatar';
  avatar.alt = '';
  avatar.src = data.photoURL || '';
  row.appendChild(avatar);

  const textWrap = document.createElement('span');
  textWrap.style.display = 'flex';
  textWrap.style.flexDirection = 'column';
  textWrap.style.flex = '1';
  textWrap.style.minWidth = '0';

  const nameEl = document.createElement('span');
  nameEl.className = 'pname';
  nameEl.textContent = data.name || t('people.ohne_namen');
  textWrap.appendChild(nameEl);

  const metaEl = document.createElement('span');
  metaEl.className = 'pmeta';
  const since = data.createdAt ? new Date(data.createdAt).toLocaleDateString(getLocale()) : '';
  if (data.role === 'pending' && !data.removed) {
    metaEl.textContent = since ? t('people.wartet_auf_freigabe_seit', { since }) : t('people.wartet_auf_freigabe');
  } else if (data.removed) {
    const removedSince = data.removedAt ? new Date(data.removedAt).toLocaleDateString(getLocale()) : '';
    metaEl.textContent = removedSince ? t('people.entfernt_am', { removedSince }) : t('people.entfernt');
  } else {
    metaEl.textContent = since ? t('people.mitglied_seit', { since }) : '';
  }
  textWrap.appendChild(metaEl);

  row.appendChild(textWrap);

  const isSelf = id === auth.currentUser?.uid;

  // A removed person's row skips the recipient picker and role toggle
  // entirely (both are meaningless once they've lost access) and shows
  // only a restore action.
  if (data.removed) {
    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'select-mode-btn';
    restoreBtn.textContent = t('people.wiederherstellen');
    restoreBtn.addEventListener('click', () => setRemoved(id, data, false));
    row.appendChild(restoreBtn);
    return row;
  }

  // Build 201 — a new account waiting for approval: approve (→ member) or
  // reject (→ removed tombstone, same as Entfernen, so it can't re-apply
  // by signing in again). No recipient picker or role toggle yet.
  if (data.role === 'pending') {
    const approveBtn = document.createElement('button');
    approveBtn.type = 'button';
    approveBtn.className = 'select-mode-btn active';
    approveBtn.textContent = t('people.freigeben');
    approveBtn.addEventListener('click', () => setRole(id, data, 'member'));
    row.appendChild(approveBtn);

    const rejectBtn = document.createElement('button');
    rejectBtn.type = 'button';
    rejectBtn.className = 'select-mode-btn';
    rejectBtn.textContent = t('people.ablehnen');
    rejectBtn.addEventListener('click', () => setRemoved(id, data, true, true));
    row.appendChild(rejectBtn);
    return row;
  }

  const recipientSelect = document.createElement('select');
  recipientSelect.className = 'people-recipient-select';
  recipientSelect.title = t('people.empfaenger_fuer_checklisten_erinnerungen');
  RECIPIENT_SLUG_OPTIONS.forEach((opt) => {
    const optionEl = document.createElement('option');
    optionEl.value = opt.value;
    optionEl.textContent = opt.label;
    if ((data.recipientSlug || '') === opt.value) optionEl.selected = true;
    recipientSelect.appendChild(optionEl);
  });
  recipientSelect.addEventListener('change', () => setRecipientSlug(id, recipientSelect.value));
  row.appendChild(recipientSelect);

  if (isSelf) {
    // Self-demotion is blocked outright, not just confirm-guarded — the
    // only admin demoting themselves would lock the household out of
    // Settings with no in-app way back in. Removing yourself is blocked
    // for the identical reason, so there's no remove button on this row.
    const selfLabel = document.createElement('span');
    selfLabel.className = 'pmeta people-self-label';
    selfLabel.textContent = t('people.du', { roleLabel: roleLabel(data.role) });
    row.appendChild(selfLabel);
  } else {
    const toggle = document.createElement('div');
    toggle.className = 'people-role-toggle';
    ['admin', 'member'].forEach((role) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'select-mode-btn' + (data.role === role ? ' active' : '');
      btn.textContent = roleLabel(role);
      btn.addEventListener('click', () => setRole(id, data, role));
      toggle.appendChild(btn);
    });
    row.appendChild(toggle);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'people-remove-btn';
    removeBtn.title = t('people.entfernen');
    removeBtn.textContent = '🗑️';
    removeBtn.addEventListener('click', () => setRemoved(id, data, true));
    row.appendChild(removeBtn);
  }

  return row;
}

async function setRole(id, data, newRole) {
  if (newRole === data.role) return;
  if (newRole === 'admin' && !confirm(t('people.zum_admin_machen_admins_haben', { value: data.name || t('people.diese_person') }))) return;
  try {
    // Approving a pending account (Build 203) also puts it into this
    // admin's household — firestore.rules allow exactly that one move.
    const patch = { role: newRole };
    if (data.role === 'pending' && getHouseholdId()) patch.householdId = getHouseholdId();
    await updateDoc(doc(db, 'users', id), patch);
    await loadPeople();
  } catch (err) {
    console.error(err);
    alert(t('people.rolle_konnte_nicht_geaendert_werden') + err.message);
  }
}

async function setRemoved(id, data, removed, rejecting = false) {
  const who = data.name || t('people.diese_person');
  if (removed && !confirm(rejecting ? t('people.ablehnen_confirm', { value: who }) : t('people.entfernen_diese_person_verliert_sofort', { value: who }))) return;
  try {
    await updateDoc(doc(db, 'users', id), removed
      ? { removed: true, removedAt: new Date().toISOString(), recipientSlug: null }
      : { removed: false, removedAt: null });
    await loadPeople();
  } catch (err) {
    console.error(err);
    alert((removed ? t('people.entfernen_fehlgeschlagen') : t('people.wiederherstellen_fehlgeschlagen')) + err.message);
  }
}

async function setRecipientSlug(id, slug) {
  try {
    await updateDoc(doc(db, 'users', id), { recipientSlug: slug || null });
  } catch (err) {
    console.error(err);
    alert(t('people.empfaenger_konnte_nicht_geaendert_werden') + err.message);
    await loadPeople();
  }
}

// Build 203 — in a household, the roster is that household's accounts plus
// (for admins) the ones waiting for approval: two queries, since
// firestore.rules only allow reads that are provably scoped. The legacy
// root household still reads the whole collection, as before.
async function loadRoster() {
  const hid = getHouseholdId();
  if (!hid) return (await getDocs(collection(db, 'users'))).docs;
  const [members, pending] = await Promise.all([
    getDocs(query(collection(db, 'users'), where('householdId', '==', hid))),
    getDocs(query(collection(db, 'users'), where('role', '==', 'pending'))),
  ]);
  return [...members.docs, ...pending.docs];
}

async function loadPeople() {
  peopleListEl.innerHTML = '';
  try {
    const docs = await loadRoster();
    // Pending first (they need action), removed last.
    const rank = (data) => (data.removed ? 2 : data.role === 'pending' ? 0 : 1);
    const people = docs
      .map((d) => ({ id: d.id, data: d.data() }))
      .sort((a, b) => (rank(a.data) - rank(b.data)) || (a.data.name || '').localeCompare(b.data.name || ''));
    people.forEach(({ id, data }) => peopleListEl.appendChild(makePersonRow(id, data)));
    renderPendingBadge(people.filter(({ data }) => data.role === 'pending' && !data.removed).length);
  } catch (err) {
    console.error(err);
    const p = document.createElement('p');
    p.className = 'taxonomy-status';
    p.textContent = t('people.fehler_beim_laden') + err.message;
    peopleListEl.appendChild(p);
  }
}

peopleCard.addEventListener('click', loadPeople);

// Build 201 — the Personen card shows how many accounts wait for approval,
// so an admin notices without opening the list.
let pendingCount = 0;
function renderPendingBadge(count) {
  pendingCount = count;
  pendingBadge.classList.toggle('hidden', count === 0);
  pendingBadge.textContent = `⏳ ${count}`;
  pendingBadge.title = t('people.warten_auf_freigabe_count', { count });
}

async function refreshPendingBadge() {
  try {
    const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'pending')));
    renderPendingBadge(snap.docs.filter((d) => !d.data().removed).length);
  } catch (err) {
    console.error(err);
  }
}

let isAdminUser = false;
window.addEventListener('erdkeller:signedin', (e) => {
  isAdminUser = e.detail.role === 'admin';
  if (isAdminUser) refreshPendingBadge();
});
window.addEventListener('erdkeller:signedout', () => { isAdminUser = false; });
window.addEventListener('erdkeller:langchange', () => renderPendingBadge(pendingCount));

window.addEventListener('erdkeller:refresh', () => {
  if (!peoplePanel.classList.contains('hidden')) loadPeople();
  else if (isAdminUser) refreshPendingBadge();
});
