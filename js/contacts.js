// Kontakte (SPEC.md Section 9, Step 13) — pinned emergency contacts +
// general list, tap a row for a read-only detail view, admin-only inline
// add/edit (a "+" button and a per-row pencil icon, not a Settings
// submenu — this is content you'd add while browsing, unlike structural
// config). Same loadOk guard + erdkeller:refresh dispatch convention as
// every other admin-editable module.
import { db } from './firebase-init.js?v=144';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const addContactBtn = document.getElementById('add-contact-btn');
const emergencySectionEl = document.getElementById('contacts-emergency-section');
const emergencyListEl = document.getElementById('contacts-emergency-list');
const generalListEl = document.getElementById('contacts-general-list');
const statusEl = document.getElementById('contacts-status');

const detailModal = document.getElementById('contact-detail-modal');
const detailTitleEl = document.getElementById('contact-detail-title');
const detailViewEl = document.getElementById('contact-detail-view');
const roleRowEl = document.getElementById('contact-detail-role-row');
const roleValEl = document.getElementById('contact-detail-role');
const phoneRowEl = document.getElementById('contact-detail-phone-row');
const phoneValEl = document.getElementById('contact-detail-phone');
const addressRowEl = document.getElementById('contact-detail-address-row');
const addressValEl = document.getElementById('contact-detail-address');
const notesRowEl = document.getElementById('contact-detail-notes-row');
const notesValEl = document.getElementById('contact-detail-notes');

const editFormEl = document.getElementById('contact-edit-form');
const editNameInput = document.getElementById('contact-edit-name');
const editRoleInput = document.getElementById('contact-edit-role');
const editPhoneInput = document.getElementById('contact-edit-phone');
const editAddressInput = document.getElementById('contact-edit-address');
const editNotesInput = document.getElementById('contact-edit-notes');
const editEmergencyInput = document.getElementById('contact-edit-emergency');

const viewActionsEl = document.getElementById('contact-view-actions');
const editActionsEl = document.getElementById('contact-edit-actions');
const editBtn = document.getElementById('contact-edit-btn');
const saveBtn = document.getElementById('contact-save-btn');
const deleteBtn = document.getElementById('contact-delete-btn');

let contacts = [];
let loadOk = false;
let isAdmin = false;
let editingContact = null;
let isNewContact = false;

// --- Data loading -----------------------------------------------------

async function loadContacts() {
  try {
    const snap = await getDocs(collection(db, 'contacts'));
    contacts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    loadOk = true;
  } catch (err) {
    loadOk = false;
    statusEl.textContent = 'Fehler beim Laden: ' + err.message;
    console.error(err);
    return;
  }
  renderContacts();
}

// --- Row rendering ---------------------------------------------------------

function makeContactRow(contact) {
  const row = document.createElement('div');
  row.className = 'stock-product-row';

  const textWrap = document.createElement('span');
  textWrap.style.display = 'flex';
  textWrap.style.flexDirection = 'column';
  textWrap.style.flex = '1';
  textWrap.style.minWidth = '0';

  const nameEl = document.createElement('span');
  nameEl.className = 'pname';
  nameEl.textContent = contact.name || '(ohne Namen)';
  textWrap.appendChild(nameEl);

  if (contact.role) {
    const roleEl = document.createElement('span');
    roleEl.className = 'pmeta';
    roleEl.textContent = contact.role;
    textWrap.appendChild(roleEl);
  }

  row.appendChild(textWrap);

  if (contact.phone) {
    const callLink = document.createElement('a');
    callLink.className = 'contact-call-btn';
    callLink.href = 'tel:' + contact.phone.replace(/\s+/g, '');
    callLink.textContent = '📞';
    callLink.title = 'Anrufen';
    callLink.addEventListener('click', (e) => e.stopPropagation());
    row.appendChild(callLink);
  }

  if (isAdmin) {
    const editIcon = document.createElement('button');
    editIcon.type = 'button';
    editIcon.className = 'contact-edit-icon';
    editIcon.textContent = '✏️';
    editIcon.title = 'Bearbeiten';
    editIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      openContact(contact, { edit: true });
    });
    row.appendChild(editIcon);
  }

  row.addEventListener('click', () => openContact(contact));
  return row;
}

function renderContacts() {
  const sorted = [...contacts].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
  const emergency = sorted.filter((c) => c.isEmergency);
  const general = sorted.filter((c) => !c.isEmergency);

  emergencySectionEl.classList.toggle('hidden', emergency.length === 0);
  emergencyListEl.innerHTML = '';
  emergency.forEach((c) => emergencyListEl.appendChild(makeContactRow(c)));

  generalListEl.innerHTML = '';
  if (general.length === 0 && emergency.length === 0) {
    const p = document.createElement('p');
    p.className = 'screen-placeholder';
    p.textContent = 'Noch keine Kontakte.';
    generalListEl.appendChild(p);
  } else {
    general.forEach((c) => generalListEl.appendChild(makeContactRow(c)));
  }
}

// --- Detail / edit modal ---------------------------------------------------

function setDetailRow(rowEl, valueEl, value) {
  if (value) {
    valueEl.textContent = value;
    rowEl.classList.remove('hidden');
  } else {
    rowEl.classList.add('hidden');
  }
}

function populateDetailView(contact) {
  detailTitleEl.textContent = contact.name || '(ohne Namen)';
  setDetailRow(roleRowEl, roleValEl, contact.role);
  if (contact.phone) {
    phoneValEl.textContent = contact.phone;
    phoneValEl.href = 'tel:' + contact.phone.replace(/\s+/g, '');
    phoneRowEl.classList.remove('hidden');
  } else {
    phoneRowEl.classList.add('hidden');
  }
  setDetailRow(addressRowEl, addressValEl, contact.address);
  setDetailRow(notesRowEl, notesValEl, contact.notes);
}

function populateEditForm(contact) {
  editNameInput.value = contact.name || '';
  editRoleInput.value = contact.role || '';
  editPhoneInput.value = contact.phone || '';
  editAddressInput.value = contact.address || '';
  editNotesInput.value = contact.notes || '';
  editEmergencyInput.checked = !!contact.isEmergency;
}

function showViewMode() {
  detailViewEl.classList.remove('hidden');
  editFormEl.classList.add('hidden');
  viewActionsEl.classList.remove('hidden');
  editActionsEl.classList.add('hidden');
}

function showEditMode() {
  detailViewEl.classList.add('hidden');
  editFormEl.classList.remove('hidden');
  viewActionsEl.classList.add('hidden');
  editActionsEl.classList.remove('hidden');
  deleteBtn.classList.toggle('hidden', isNewContact);
}

function openContact(contact, { edit = false } = {}) {
  editingContact = contact;
  isNewContact = false;
  detailTitleEl.textContent = contact.name || '(ohne Namen)';
  if (edit) {
    populateEditForm(contact);
    showEditMode();
  } else {
    populateDetailView(contact);
    showViewMode();
  }
  detailModal.classList.add('show');
}

addContactBtn.addEventListener('click', () => {
  if (!loadOk) {
    statusEl.textContent = 'Hinzufügen blockiert: Die Daten wurden zuletzt nicht erfolgreich geladen. Bitte Seite neu laden.';
    return;
  }
  editingContact = null;
  isNewContact = true;
  detailTitleEl.textContent = 'Neuer Kontakt';
  populateEditForm({});
  showEditMode();
  detailModal.classList.add('show');
});

editBtn.addEventListener('click', () => {
  populateEditForm(editingContact);
  showEditMode();
});

detailModal.addEventListener('click', (e) => {
  if (e.target === detailModal) detailModal.classList.remove('show');
});

saveBtn.addEventListener('click', async () => {
  if (!loadOk) {
    statusEl.textContent = 'Speichern blockiert: Die Daten wurden zuletzt nicht erfolgreich geladen. Bitte Seite neu laden.';
    return;
  }
  const name = editNameInput.value.trim();
  if (!name) {
    alert('Bitte einen Namen eingeben.');
    return;
  }
  const nowIso = new Date().toISOString();
  const data = {
    name,
    role: editRoleInput.value.trim(),
    phone: editPhoneInput.value.trim(),
    address: editAddressInput.value.trim(),
    notes: editNotesInput.value.trim(),
    isEmergency: editEmergencyInput.checked,
    updatedAt: nowIso,
  };
  saveBtn.disabled = true;
  try {
    if (isNewContact) {
      data.createdAt = nowIso;
      const newDoc = await addDoc(collection(db, 'contacts'), data);
      contacts.push({ id: newDoc.id, ...data });
    } else {
      await updateDoc(doc(db, 'contacts', editingContact.id), data);
      const idx = contacts.findIndex((c) => c.id === editingContact.id);
      if (idx >= 0) contacts[idx] = { ...contacts[idx], ...data };
    }
    detailModal.classList.remove('show');
    renderContacts();
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    alert('Speichern fehlgeschlagen: ' + err.message);
    console.error(err);
  } finally {
    saveBtn.disabled = false;
  }
});

deleteBtn.addEventListener('click', async () => {
  if (!editingContact) return;
  if (!confirm(`"${editingContact.name || 'Kontakt'}" wirklich löschen?`)) return;
  try {
    await deleteDoc(doc(db, 'contacts', editingContact.id));
    contacts = contacts.filter((c) => c.id !== editingContact.id);
    detailModal.classList.remove('show');
    renderContacts();
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    alert('Löschen fehlgeschlagen: ' + err.message);
    console.error(err);
  }
});

// --- Entry point -----------------------------------------------------------

window.addEventListener('erdkeller:signedin', (e) => {
  isAdmin = e.detail.role === 'admin';
  loadContacts();
});
window.addEventListener('erdkeller:refresh', () => loadContacts());
