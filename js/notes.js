// Notizen (SPEC.md Section 9, Step 13) — freeform text + photo notes, list
// by title, tap for a read-only detail view, admin-only inline add/edit.
// Same list/detail/modal shape as js/contacts.js; the one real addition is
// photo handling.
//
// Photos are stored compressed/resized directly on the note document as
// base64 JPEG data URIs, not in Firebase Storage — the project stays on
// the free Spark plan (SPEC.md Section 18), which has no free Storage
// tier, and Storage was never provisioned. That caps things at a handful
// of small photos per note (Firestore's 1MB document limit, plus base64's
// ~33% size inflation) rather than a real photo gallery — fine for "how
// to clean the water tank" reference shots, not meant for more.
import { db } from './firebase-init.js?v=96';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const MAX_PHOTOS = 3;
const MAX_PHOTO_DIMENSION = 1000;
const JPEG_QUALITY = 0.6;
// Rough budget, not Firestore's exact 1MB — leaves headroom for the title/
// body text and Firestore's own per-document overhead.
const MAX_TOTAL_PHOTO_CHARS = 700000;

const addNoteBtn = document.getElementById('add-note-btn');
const notesListEl = document.getElementById('notes-list');
const statusEl = document.getElementById('notes-status');

const detailModal = document.getElementById('note-detail-modal');
const detailTitleEl = document.getElementById('note-detail-title');
const detailViewEl = document.getElementById('note-detail-view');
const detailBodyEl = document.getElementById('note-detail-body');
const detailPhotosEl = document.getElementById('note-detail-photos');

const editFormEl = document.getElementById('note-edit-form');
const editTitleInput = document.getElementById('note-edit-title');
const editBodyInput = document.getElementById('note-edit-body');
const editPhotoGridEl = document.getElementById('note-edit-photo-grid');
const photoInput = document.getElementById('note-edit-photo-input');
const addPhotoBtn = document.getElementById('note-add-photo-btn');

const viewActionsEl = document.getElementById('note-view-actions');
const editActionsEl = document.getElementById('note-edit-actions');
const editBtn = document.getElementById('note-edit-btn');
const saveBtn = document.getElementById('note-save-btn');
const deleteBtn = document.getElementById('note-delete-btn');

let notes = [];
let loadOk = false;
let isAdmin = false;
let editingNote = null;
let isNewNote = false;
let pendingPhotos = [];

// --- Data loading -----------------------------------------------------

async function loadNotes() {
  try {
    const snap = await getDocs(collection(db, 'notes'));
    notes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    loadOk = true;
  } catch (err) {
    loadOk = false;
    statusEl.textContent = 'Fehler beim Laden: ' + err.message;
    console.error(err);
    return;
  }
  renderNotes();
}

// --- Photo compression --------------------------------------------------

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_PHOTO_DIMENSION || height > MAX_PHOTO_DIMENSION) {
          if (width > height) {
            height = Math.round(height * (MAX_PHOTO_DIMENSION / width));
            width = MAX_PHOTO_DIMENSION;
          } else {
            width = Math.round(width * (MAX_PHOTO_DIMENSION / height));
            height = MAX_PHOTO_DIMENSION;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };
      img.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  });
}

function renderPhotoGrid(container, photos, removable) {
  container.innerHTML = '';
  photos.forEach((src, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'note-photo-thumb';
    const img = document.createElement('img');
    img.src = src;
    thumb.appendChild(img);
    if (removable) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'note-photo-remove';
      removeBtn.textContent = '✕';
      removeBtn.title = 'Foto entfernen';
      removeBtn.addEventListener('click', () => {
        pendingPhotos.splice(idx, 1);
        renderPhotoGrid(editPhotoGridEl, pendingPhotos, true);
      });
      thumb.appendChild(removeBtn);
    }
    container.appendChild(thumb);
  });
}

addPhotoBtn.addEventListener('click', () => {
  if (pendingPhotos.length >= MAX_PHOTOS) {
    alert(`Maximal ${MAX_PHOTOS} Fotos pro Notiz.`);
    return;
  }
  photoInput.click();
});

photoInput.addEventListener('change', async () => {
  const file = photoInput.files[0];
  photoInput.value = '';
  if (!file) return;
  try {
    const dataUri = await compressImage(file);
    pendingPhotos.push(dataUri);
    renderPhotoGrid(editPhotoGridEl, pendingPhotos, true);
  } catch (err) {
    alert('Foto konnte nicht verarbeitet werden: ' + err.message);
    console.error(err);
  }
});

// --- Row rendering ---------------------------------------------------------

function makeNoteRow(note) {
  const row = document.createElement('div');
  row.className = 'stock-product-row';

  const textWrap = document.createElement('span');
  textWrap.style.display = 'flex';
  textWrap.style.flexDirection = 'column';
  textWrap.style.flex = '1';
  textWrap.style.minWidth = '0';

  const nameEl = document.createElement('span');
  nameEl.className = 'pname';
  nameEl.textContent = note.title || '(ohne Titel)';
  textWrap.appendChild(nameEl);

  if (note.body) {
    const previewEl = document.createElement('span');
    previewEl.className = 'pmeta';
    previewEl.textContent = note.body.length > 80 ? note.body.slice(0, 80) + '…' : note.body;
    textWrap.appendChild(previewEl);
  }

  row.appendChild(textWrap);

  if ((note.photos || []).length > 0) {
    const photoBadge = document.createElement('span');
    photoBadge.className = 'contact-call-btn';
    photoBadge.textContent = '📷';
    photoBadge.title = `${note.photos.length} Foto(s)`;
    row.appendChild(photoBadge);
  }

  if (isAdmin) {
    const editIcon = document.createElement('button');
    editIcon.type = 'button';
    editIcon.className = 'contact-edit-icon';
    editIcon.textContent = '✏️';
    editIcon.title = 'Bearbeiten';
    editIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      openNote(note, { edit: true });
    });
    row.appendChild(editIcon);
  }

  row.addEventListener('click', () => openNote(note));
  return row;
}

function renderNotes() {
  const sorted = [...notes].sort((a, b) => (a.title || '').localeCompare(b.title || '', 'de'));
  notesListEl.innerHTML = '';
  if (sorted.length === 0) {
    const p = document.createElement('p');
    p.className = 'screen-placeholder';
    p.textContent = 'Noch keine Notizen.';
    notesListEl.appendChild(p);
  } else {
    sorted.forEach((n) => notesListEl.appendChild(makeNoteRow(n)));
  }
}

// --- Detail / edit modal ---------------------------------------------------

function populateDetailView(note) {
  detailTitleEl.textContent = note.title || '(ohne Titel)';
  if (note.body) {
    detailBodyEl.textContent = note.body;
    detailBodyEl.classList.remove('hidden');
  } else {
    detailBodyEl.classList.add('hidden');
  }
  renderPhotoGrid(detailPhotosEl, note.photos || [], false);
}

function populateEditForm(note) {
  editTitleInput.value = note.title || '';
  editBodyInput.value = note.body || '';
  pendingPhotos = [...(note.photos || [])];
  renderPhotoGrid(editPhotoGridEl, pendingPhotos, true);
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
  deleteBtn.classList.toggle('hidden', isNewNote);
}

function openNote(note, { edit = false } = {}) {
  editingNote = note;
  isNewNote = false;
  detailTitleEl.textContent = note.title || '(ohne Titel)';
  if (edit) {
    populateEditForm(note);
    showEditMode();
  } else {
    populateDetailView(note);
    showViewMode();
  }
  detailModal.classList.add('show');
}

addNoteBtn.addEventListener('click', () => {
  if (!loadOk) {
    statusEl.textContent = 'Hinzufügen blockiert: Die Daten wurden zuletzt nicht erfolgreich geladen. Bitte Seite neu laden.';
    return;
  }
  editingNote = null;
  isNewNote = true;
  detailTitleEl.textContent = 'Neue Notiz';
  populateEditForm({});
  showEditMode();
  detailModal.classList.add('show');
});

editBtn.addEventListener('click', () => {
  populateEditForm(editingNote);
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
  const title = editTitleInput.value.trim();
  if (!title) {
    alert('Bitte einen Titel eingeben.');
    return;
  }
  const totalPhotoChars = pendingPhotos.reduce((sum, p) => sum + p.length, 0);
  if (totalPhotoChars > MAX_TOTAL_PHOTO_CHARS) {
    alert('Die Fotos sind zusammen zu groß. Bitte ein Foto entfernen.');
    return;
  }
  const nowIso = new Date().toISOString();
  const data = {
    title,
    body: editBodyInput.value.trim(),
    photos: pendingPhotos,
    updatedAt: nowIso,
  };
  saveBtn.disabled = true;
  try {
    if (isNewNote) {
      data.createdAt = nowIso;
      const newDoc = await addDoc(collection(db, 'notes'), data);
      notes.push({ id: newDoc.id, ...data });
    } else {
      await updateDoc(doc(db, 'notes', editingNote.id), data);
      const idx = notes.findIndex((n) => n.id === editingNote.id);
      if (idx >= 0) notes[idx] = { ...notes[idx], ...data };
    }
    detailModal.classList.remove('show');
    renderNotes();
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    alert('Speichern fehlgeschlagen: ' + err.message);
    console.error(err);
  } finally {
    saveBtn.disabled = false;
  }
});

deleteBtn.addEventListener('click', async () => {
  if (!editingNote) return;
  if (!confirm(`"${editingNote.title || 'Notiz'}" wirklich löschen?`)) return;
  try {
    await deleteDoc(doc(db, 'notes', editingNote.id));
    notes = notes.filter((n) => n.id !== editingNote.id);
    detailModal.classList.remove('show');
    renderNotes();
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    alert('Löschen fehlgeschlagen: ' + err.message);
    console.error(err);
  }
});

// --- Entry point -----------------------------------------------------------

window.addEventListener('erdkeller:signedin', (e) => {
  isAdmin = e.detail.role === 'admin';
  loadNotes();
});
window.addEventListener('erdkeller:refresh', () => loadNotes());
