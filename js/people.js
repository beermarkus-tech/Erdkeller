import { auth, db } from './firebase-init.js?v=138';
import {
  collection, getDocs, doc, updateDoc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const peopleCard = document.querySelector('.settings-card[data-target="people"]');
const peopleListEl = document.getElementById('people-list');
const peoplePanel = document.getElementById('settings-panel-people');

function roleLabel(role) {
  return role === 'admin' ? 'Admin' : 'Mitglied';
}

// The whole Settings tab is already admin-only (app-shell.js), so anyone
// who can even open this screen is an admin — no separate isAdmin gate
// needed here, unlike the shared Info-tab screens (Kontakte/Notizen).
function makePersonRow(id, data) {
  const row = document.createElement('div');
  row.className = 'stock-product-row people-row';

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
  nameEl.textContent = data.name || '(ohne Namen)';
  textWrap.appendChild(nameEl);

  const metaEl = document.createElement('span');
  metaEl.className = 'pmeta';
  const since = data.createdAt ? new Date(data.createdAt).toLocaleDateString('de-DE') : '';
  metaEl.textContent = since ? `Mitglied seit ${since}` : '';
  textWrap.appendChild(metaEl);

  row.appendChild(textWrap);

  const isSelf = id === auth.currentUser?.uid;
  if (isSelf) {
    // Self-demotion is blocked outright, not just confirm-guarded — the
    // only admin demoting themselves would lock the household out of
    // Settings with no in-app way back in.
    const selfLabel = document.createElement('span');
    selfLabel.className = 'pmeta people-self-label';
    selfLabel.textContent = `${roleLabel(data.role)} (Du)`;
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
  }

  return row;
}

async function setRole(id, data, newRole) {
  if (newRole === data.role) return;
  if (newRole === 'admin' && !confirm(`${data.name || 'Diese Person'} zum Admin machen? Admins haben vollen Zugriff auf alle Daten und Einstellungen.`)) return;
  try {
    await updateDoc(doc(db, 'users', id), { role: newRole });
    await loadPeople();
  } catch (err) {
    console.error(err);
    alert('Rolle konnte nicht geändert werden: ' + err.message);
  }
}

async function loadPeople() {
  peopleListEl.innerHTML = '';
  try {
    const snap = await getDocs(collection(db, 'users'));
    const people = snap.docs
      .map((d) => ({ id: d.id, data: d.data() }))
      .sort((a, b) => (a.data.name || '').localeCompare(b.data.name || ''));
    people.forEach(({ id, data }) => peopleListEl.appendChild(makePersonRow(id, data)));
  } catch (err) {
    console.error(err);
    const p = document.createElement('p');
    p.className = 'taxonomy-status';
    p.textContent = 'Fehler beim Laden: ' + err.message;
    peopleListEl.appendChild(p);
  }
}

peopleCard.addEventListener('click', loadPeople);

window.addEventListener('erdkeller:refresh', () => {
  if (!peoplePanel.classList.contains('hidden')) loadPeople();
});
