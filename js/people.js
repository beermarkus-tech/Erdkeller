import { auth, db, getHouseholdId } from './firebase-init.js?v=206';
import {
  collection, getDocs, doc, setDoc, updateDoc, query, where,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { t, getLocale } from './i18n.js?v=206';

const peopleCard = document.querySelector('.settings-card[data-target="people"]');
const peopleListEl = document.getElementById('people-list');
const peoplePanel = document.getElementById('settings-panel-people');
const inviteSection = document.getElementById('people-invite-section');
const inviteEmailEl = document.getElementById('invite-email');
const inviteRoleEl = document.getElementById('invite-role');
const inviteBtn = document.getElementById('invite-btn');
const inviteStatusEl = document.getElementById('invite-status');
const inviteListEl = document.getElementById('invite-list');

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
// uid immediately, on its very next request — and the reminder scheduler
// skips removed accounts (Build 205), so they stop getting reminders too.
// (recipientSlug is still cleared in the same write: old lists may name
// that slug until an admin's next visit converts them to uids.)

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
  if (data.removed) {
    const removedSince = data.removedAt ? new Date(data.removedAt).toLocaleDateString(getLocale()) : '';
    metaEl.textContent = removedSince ? t('people.entfernt_am', { removedSince }) : t('people.entfernt');
  } else {
    metaEl.textContent = since ? t('people.mitglied_seit', { since }) : '';
  }
  textWrap.appendChild(metaEl);

  row.appendChild(textWrap);

  const isSelf = id === auth.currentUser?.uid;

  // A removed person's row skips the role toggle
  // entirely (it is meaningless once they've lost access) and shows
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
    await updateDoc(doc(db, 'users', id), { role: newRole });
    await loadPeople();
  } catch (err) {
    console.error(err);
    alert(t('people.rolle_konnte_nicht_geaendert_werden') + err.message);
  }
}

async function setRemoved(id, data, removed) {
  const who = data.name || t('people.diese_person');
  if (removed && !confirm(t('people.entfernen_diese_person_verliert_sofort', { value: who }))) return;
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

// Build 203 — in a household, the roster is that household's accounts (a
// scoped query, since firestore.rules only allow reads that provably are).
// The legacy root household still reads the whole collection. Build 206:
// accounts without a household are nobody's to see any more — people join
// by invitation (below) instead of waiting for approval.
async function loadRoster() {
  const hid = getHouseholdId();
  if (!hid) return (await getDocs(collection(db, 'users'))).docs.filter((d) => d.data().role !== 'pending');
  return (await getDocs(query(collection(db, 'users'), where('householdId', '==', hid)))).docs;
}

async function loadPeople() {
  peopleListEl.innerHTML = '';
  try {
    const docs = await loadRoster();
    // Removed last.
    const rank = (data) => (data.removed ? 1 : 0);
    const people = docs
      .map((d) => ({ id: d.id, data: d.data() }))
      .sort((a, b) => (rank(a.data) - rank(b.data)) || (a.data.name || '').localeCompare(b.data.name || ''));
    people.forEach(({ id, data }) => peopleListEl.appendChild(makePersonRow(id, data)));
  } catch (err) {
    console.error(err);
    const p = document.createElement('p');
    p.className = 'taxonomy-status';
    p.textContent = t('people.fehler_beim_laden') + err.message;
    peopleListEl.appendChild(p);
  }
}

// --- Invitations (Build 206, MULTI_HOUSEHOLD.md step 4) -------------------
// An admin invites an e-mail address; the person signs in with exactly that
// Google account and accepts on the onboarding screen (js/onboarding.js).
// The app sends no e-mail itself (yet): "E-Mail schreiben" opens the
// admin's own mail app with a ready-made message. Valid 14 days — the
// server (functions/index.js acceptInvite) enforces that, not this list.
const INVITE_DAYS = 14;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function inviteExpiry(invite) {
  return new Date(Date.parse(invite.createdAt) + INVITE_DAYS * 86400000);
}

function appUrl() {
  return location.origin + location.pathname;
}

function mailtoFor(invite) {
  const subject = t('people.einladung_mail_betreff');
  const body = t('people.einladung_mail_text', { url: appUrl(), email: invite.email });
  return `mailto:${encodeURIComponent(invite.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function makeInviteRow(id, invite) {
  const row = document.createElement('div');
  row.className = 'stock-product-row people-row';
  const textWrap = document.createElement('span');
  textWrap.style.display = 'flex';
  textWrap.style.flexDirection = 'column';
  textWrap.style.flex = '1';
  textWrap.style.minWidth = '0';
  const nameEl = document.createElement('span');
  nameEl.className = 'pname';
  nameEl.textContent = invite.email;
  const metaEl = document.createElement('span');
  metaEl.className = 'pmeta';
  const expiry = inviteExpiry(invite);
  const expired = expiry.getTime() < Date.now();
  metaEl.textContent = `${roleLabel(invite.role)} · ${expired
    ? t('people.einladung_abgelaufen')
    : t('people.einladung_gueltig_bis', { date: expiry.toLocaleDateString(getLocale()) })}`;
  textWrap.append(nameEl, metaEl);
  row.appendChild(textWrap);

  if (!expired) {
    const mail = document.createElement('a');
    mail.className = 'select-mode-btn';
    mail.href = mailtoFor(invite);
    mail.textContent = t('people.email_schreiben');
    row.appendChild(mail);
  }
  const revoke = document.createElement('button');
  revoke.type = 'button';
  revoke.className = 'people-remove-btn';
  revoke.title = t('people.einladung_zurueckziehen');
  revoke.textContent = '🗑️';
  revoke.addEventListener('click', () => revokeInvite(id, invite));
  row.appendChild(revoke);
  return row;
}

async function loadInvites() {
  const hid = getHouseholdId();
  inviteSection.classList.toggle('hidden', !hid);
  inviteListEl.innerHTML = '';
  if (!hid) return;
  try {
    const snap = await getDocs(query(collection(db, 'invites'), where('householdId', '==', hid)));
    snap.docs
      .map((d) => ({ id: d.id, data: d.data() }))
      .filter(({ data }) => data.status === 'open')
      .sort((a, b) => String(b.data.createdAt).localeCompare(String(a.data.createdAt)))
      .forEach(({ id, data }) => inviteListEl.appendChild(makeInviteRow(id, data)));
  } catch (err) {
    console.error(err);
    inviteStatusEl.textContent = t('people.fehler_beim_laden') + err.message;
  }
}

async function revokeInvite(id, invite) {
  if (!confirm(t('people.einladung_zurueckziehen_confirm', { email: invite.email }))) return;
  try {
    await updateDoc(doc(db, 'invites', id), { status: 'revoked', revokedAt: new Date().toISOString() });
    await loadInvites();
  } catch (err) {
    console.error(err);
    alert(t('people.einladung_fehlgeschlagen') + err.message);
  }
}

inviteBtn.addEventListener('click', async () => {
  const hid = getHouseholdId();
  const email = inviteEmailEl.value.trim().toLowerCase();
  if (!hid) return;
  if (!EMAIL_RE.test(email)) {
    inviteStatusEl.textContent = t('people.einladung_ungueltige_email');
    inviteEmailEl.focus();
    return;
  }
  inviteBtn.disabled = true;
  inviteStatusEl.textContent = '';
  try {
    const invite = {
      householdId: hid, email, role: inviteRoleEl.value === 'admin' ? 'admin' : 'member',
      status: 'open', createdBy: auth.currentUser.uid, createdAt: new Date().toISOString(),
    };
    await setDoc(doc(collection(db, 'invites')), invite);
    inviteEmailEl.value = '';
    inviteStatusEl.textContent = t('people.einladung_erstellt', { email });
    await loadInvites();
  } catch (err) {
    console.error(err);
    inviteStatusEl.textContent = t('people.einladung_fehlgeschlagen') + err.message;
  } finally {
    inviteBtn.disabled = false;
  }
});

function loadPanel() {
  inviteStatusEl.textContent = '';
  loadPeople();
  loadInvites();
}

peopleCard.addEventListener('click', loadPanel);

window.addEventListener('erdkeller:refresh', () => {
  if (!peoplePanel.classList.contains('hidden')) loadPanel();
});
