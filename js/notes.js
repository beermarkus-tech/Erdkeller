// Notizen (SPEC.md Section 9, Step 13) — freeform rich-text + one-photo
// notes, card grid with the photo as hero image, tap for a read-only
// detail modal, admin-only inline add/edit.
//
// The photo is stored compressed/resized directly on the note document as
// a base64 JPEG data URI, not in Firebase Storage — the project stays on
// the free Spark plan (SPEC.md Section 18), which has no free Storage
// tier, and Storage was never provisioned. Still stored as a `photos`
// array of length 0 or 1 (Build 92 shape, capped to one item since Build
// 102 — see the settings-note in the edit form) rather than renaming the
// field to a single `photo`, so existing notes from before the one-photo
// limit don't need a migration: an old note with more than one photo just
// shows photos[0] as its hero until next edited, same as everywhere else
// in this app that reads a narrowed field defensively.
import { db } from './firebase-init.js?v=102';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const MAX_PHOTO_DIMENSION = 1000;
const JPEG_QUALITY = 0.6;
// Rough budget, not Firestore's exact 1MB — leaves headroom for the title/
// body text and Firestore's own per-document overhead.
const MAX_TOTAL_PHOTO_CHARS = 700000;

const addNoteBtn = document.getElementById('add-note-btn');
const searchInput = document.getElementById('notes-search-input');
const notesListEl = document.getElementById('notes-list');
const statusEl = document.getElementById('notes-status');

const detailModal = document.getElementById('note-detail-modal');
const detailCloseBtn = document.getElementById('note-detail-close-btn');
const detailTitleEl = document.getElementById('note-detail-title');
const detailViewEl = document.getElementById('note-detail-view');
const detailHeroEl = document.getElementById('note-detail-hero');
const detailHeroImgEl = document.getElementById('note-detail-hero-img');
const detailBodyEl = document.getElementById('note-detail-body');

const editFormEl = document.getElementById('note-edit-form');
const editTitleInput = document.getElementById('note-edit-title');
const editBodyInput = document.getElementById('note-edit-body');
const editToolbarEl = document.getElementById('note-edit-toolbar');
const editPhotoSlotEl = document.getElementById('note-edit-photo-slot');
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
let searchText = '';

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

// One photo only (Build 102) — the add button hides itself once a photo is
// set (see below) rather than a runtime "max reached" check, so this only
// ever needs to render zero or one thumbnail.
function renderPhotoSlot() {
  editPhotoSlotEl.innerHTML = '';
  addPhotoBtn.classList.toggle('hidden', pendingPhotos.length > 0);
  if (pendingPhotos.length === 0) return;
  const thumb = document.createElement('div');
  thumb.className = 'note-photo-thumb';
  const img = document.createElement('img');
  img.src = pendingPhotos[0];
  thumb.appendChild(img);
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'note-photo-remove';
  removeBtn.textContent = '✕';
  removeBtn.title = 'Foto entfernen';
  removeBtn.addEventListener('click', () => {
    pendingPhotos = [];
    renderPhotoSlot();
  });
  thumb.appendChild(removeBtn);
  editPhotoSlotEl.appendChild(thumb);
}

addPhotoBtn.addEventListener('click', () => {
  photoInput.click();
});

photoInput.addEventListener('change', async () => {
  const file = photoInput.files[0];
  photoInput.value = '';
  if (!file) return;
  try {
    const dataUri = await compressImage(file);
    pendingPhotos = [dataUri];
    renderPhotoSlot();
  } catch (err) {
    alert('Foto konnte nicht verarbeitet werden: ' + err.message);
    console.error(err);
  }
});

// --- Rich text body (Build 102) ------------------------------------------
// A plain contenteditable div + execCommand toolbar rather than a rich-text
// library — this project has no bundler (CDN ESM imports only), and the
// six formatting options requested (two heading levels, bold/italic/
// underline, bullet/numbered lists) don't need more than that.

editToolbarEl.querySelectorAll('button[data-cmd]').forEach((btn) => {
  // mousedown + preventDefault (not click) so the editor never loses its
  // text selection to the toolbar button gaining focus first — execCommand
  // needs that selection to know what to format.
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    editBodyInput.focus();
    document.execCommand(btn.dataset.cmd, false, btn.dataset.value || null);
  });
});

// Body is rendered via innerHTML (below and in the card preview's plain-
// text extraction), and a contenteditable editor doesn't sanitize what a
// paste brings in — a clipboard paste from a random webpage could carry a
// <script>/onerror=/href="javascript:..." payload that would then run for
// every signed-in member who opens the note, not just the admin who wrote
// it. Applied once at save time so what's actually stored (and everywhere
// it's later rendered) is already clean: unknown tags are unwrapped
// (their text kept, so a pasted heading/link still reads correctly, just
// unstyled) and every attribute is stripped from what's kept — none of
// the allowed tags need one, and that's what actually blocks an event-
// handler or style-based payload from surviving.
const ALLOWED_BODY_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'H2', 'H3', 'UL', 'OL', 'LI', 'BR', 'P', 'DIV', 'SPAN']);

function sanitizeNode(node) {
  Array.from(node.childNodes).forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) return;
    if (child.nodeType !== Node.ELEMENT_NODE) {
      node.removeChild(child);
      return;
    }
    if (!ALLOWED_BODY_TAGS.has(child.tagName)) {
      while (child.firstChild) node.insertBefore(child.firstChild, child);
      node.removeChild(child);
      sanitizeNode(node);
      return;
    }
    Array.from(child.attributes).forEach((attr) => child.removeAttribute(attr.name));
    sanitizeNode(child);
  });
}

function sanitizeBodyHtml(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  sanitizeNode(container);
  return container.innerHTML;
}

// Existing notes predate rich text and stored plain text with real
// newlines — detected by the absence of any HTML tag at all. Escaped and
// newline-to-<br> converted here so they still display with their line
// breaks intact instead of running together, and so opening one for
// editing doesn't nuke that formatting the moment it's re-saved.
function isLegacyPlainText(value) {
  return !/<[a-z][\s\S]*>/i.test(value || '');
}

function bodyToHtml(value) {
  if (!value) return '';
  if (!isLegacyPlainText(value)) return value;
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML.replace(/\n/g, '<br>');
}

// Plain-text extraction for the card preview and for search — strips every
// tag regardless of heading/list/bold markup, since neither cares about
// formatting, just the words.
function bodyPlainText(value) {
  if (!value) return '';
  const div = document.createElement('div');
  div.innerHTML = bodyToHtml(value);
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
}

// --- Card rendering ---------------------------------------------------------

function makeNoteCard(note) {
  const card = document.createElement('div');
  card.className = 'note-card';

  const photo = (note.photos || [])[0];
  if (photo) {
    const hero = document.createElement('div');
    hero.className = 'note-card-hero';
    const img = document.createElement('img');
    img.src = photo;
    img.alt = '';
    hero.appendChild(img);
    card.appendChild(hero);
  }

  const body = document.createElement('div');
  body.className = 'note-card-body';

  const titleEl = document.createElement('div');
  titleEl.className = 'note-card-title';
  titleEl.textContent = note.title || '(ohne Titel)';
  body.appendChild(titleEl);

  const preview = bodyPlainText(note.body);
  if (preview) {
    const previewEl = document.createElement('div');
    previewEl.className = 'note-card-preview';
    previewEl.textContent = preview;
    body.appendChild(previewEl);
  }

  card.appendChild(body);

  if (isAdmin) {
    const editIcon = document.createElement('button');
    editIcon.type = 'button';
    editIcon.className = 'note-card-edit-icon';
    editIcon.textContent = '✏️';
    editIcon.title = 'Bearbeiten';
    editIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      openNote(note, { edit: true });
    });
    card.appendChild(editIcon);
  }

  card.addEventListener('click', () => openNote(note));
  return card;
}

function matchesSearch(note, q) {
  if (!q) return true;
  if ((note.title || '').toLowerCase().includes(q)) return true;
  return bodyPlainText(note.body).toLowerCase().includes(q);
}

function renderNotes() {
  const q = searchText.trim().toLowerCase();
  const sorted = notes
    .filter((n) => matchesSearch(n, q))
    .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'de'));
  notesListEl.innerHTML = '';
  if (sorted.length === 0) {
    const p = document.createElement('p');
    p.className = 'screen-placeholder';
    p.textContent = notes.length === 0 ? 'Noch keine Notizen.' : 'Keine Treffer.';
    notesListEl.appendChild(p);
  } else {
    sorted.forEach((n) => notesListEl.appendChild(makeNoteCard(n)));
  }
}

searchInput.addEventListener('input', () => {
  searchText = searchInput.value;
  renderNotes();
});

// --- Detail / edit modal ---------------------------------------------------

function populateDetailView(note) {
  detailTitleEl.textContent = note.title || '(ohne Titel)';
  const photo = (note.photos || [])[0];
  if (photo) {
    detailHeroImgEl.src = photo;
    detailHeroEl.classList.remove('hidden');
  } else {
    detailHeroImgEl.src = '';
    detailHeroEl.classList.add('hidden');
  }
  const html = bodyToHtml(note.body);
  if (html) {
    detailBodyEl.innerHTML = html;
    detailBodyEl.classList.remove('hidden');
  } else {
    detailBodyEl.innerHTML = '';
    detailBodyEl.classList.add('hidden');
  }
}

function populateEditForm(note) {
  editTitleInput.value = note.title || '';
  editBodyInput.innerHTML = bodyToHtml(note.body || '');
  pendingPhotos = (note.photos || []).slice(0, 1);
  renderPhotoSlot();
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

detailCloseBtn.addEventListener('click', () => {
  detailModal.classList.remove('show');
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
    alert('Das Foto ist zu groß. Bitte ein anderes wählen.');
    return;
  }
  // An emptied editor can leave stray markup (e.g. "<br>") behind rather
  // than a clean empty string — textContent is what actually decides
  // whether there's real content to save.
  const bodyHtml = editBodyInput.textContent.trim() ? sanitizeBodyHtml(editBodyInput.innerHTML.trim()) : '';
  const nowIso = new Date().toISOString();
  const data = {
    title,
    body: bodyHtml,
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
