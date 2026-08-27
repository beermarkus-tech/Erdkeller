// Notizen (SPEC.md Section 9, Step 13) — freeform rich-text + one-photo
// notes, card grid with the photo as hero image, tap for a full-screen (on
// tablet: large dialog) read-only view screen, admin-only Google-Keep-style
// edit screen with instant autosave (no separate Speichern step — see
// persistNow below) reached from the card's own pencil icon or the view
// screen's edit button. Deleting a note only ever happens from the card's
// trash icon (Build 103) — neither the view nor the edit screen has a
// delete control of its own.
//
// The photo is stored compressed/resized directly on the note document as
// a base64 JPEG data URI, not in Firebase Storage — the project stays on
// the free Spark plan (SPEC.md Section 18), which has no free Storage
// tier, and Storage was never provisioned. Still stored as a `photos`
// array of length 0 or 1 (Build 92 shape, capped to one item since Build
// 102) rather than renamed to a single `photo` field, so a pre-Build-102
// note with more than one photo just shows photos[0] as its hero until
// next edited, same as everywhere else in this app that reads a narrowed
// field defensively instead of needing a migration.
import { db } from './firebase-init.js?v=103';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const MAX_PHOTO_DIMENSION = 1000;
const JPEG_QUALITY = 0.6;
// Rough budget, not Firestore's exact 1MB — leaves headroom for the title/
// body text and Firestore's own per-document overhead.
const MAX_TOTAL_PHOTO_CHARS = 700000;
// Autosave debounce — long enough that a normal typing burst only writes
// once at the end of it, short enough that "instant" still feels true.
const SAVE_DEBOUNCE_MS = 700;

const addNoteBtn = document.getElementById('add-note-btn');
const searchInput = document.getElementById('notes-search-input');
const notesListEl = document.getElementById('notes-list');
const statusEl = document.getElementById('notes-status');

const viewModal = document.getElementById('note-view-modal');
const viewCloseBtn = document.getElementById('note-view-close-btn');
const viewEditBtn = document.getElementById('note-view-edit-btn');
const viewTitleEl = document.getElementById('note-view-title');
const viewHeroEl = document.getElementById('note-view-hero');
const viewHeroImgEl = document.getElementById('note-view-hero-img');
const viewContentEl = document.getElementById('note-view-content');

const editModal = document.getElementById('note-edit-modal');
const editBackBtn = document.getElementById('note-edit-back-btn');
const editPhotoBtn = document.getElementById('note-edit-photo-btn');
const editPhotoRemoveBadge = document.getElementById('note-edit-photo-remove-btn');
const photoInput = document.getElementById('note-edit-photo-input');
const editTitleInput = document.getElementById('note-edit-title');
const editToolbarEl = document.getElementById('note-edit-toolbar');
const editBodyInput = document.getElementById('note-edit-body');
const editStatusEl = document.getElementById('note-edit-status');

let notes = [];
let loadOk = false;
let isAdmin = false;
let searchText = '';

let viewingNote = null;

// null until the note being edited actually has a Firestore doc (a brand
// new note doesn't get one until the first bit of real content autosaves —
// see persistNow) — not the same as "isNewNote" in the old Build 92/102
// shape, since a note started fresh can still end up with an id partway
// through this same editing session.
let editingNoteId = null;
let pendingPhotos = [];
let dirty = false;
let saveTimer = null;

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

function updatePhotoRemoveBadge() {
  editPhotoRemoveBadge.classList.toggle('hidden', pendingPhotos.length === 0);
}

// The camera button always opens the picker — with one photo allowed, "add"
// and "replace" are the same action (confirmed with Markus). The small ✕
// badge next to it is the only way to remove a photo outright.
editPhotoBtn.addEventListener('click', () => {
  photoInput.click();
});

photoInput.addEventListener('change', async () => {
  const file = photoInput.files[0];
  photoInput.value = '';
  if (!file) return;
  try {
    const dataUri = await compressImage(file);
    if (dataUri.length > MAX_TOTAL_PHOTO_CHARS) {
      alert('Das Foto ist zu groß. Bitte ein anderes wählen.');
      return;
    }
    pendingPhotos = [dataUri];
    updatePhotoRemoveBadge();
    scheduleSave();
  } catch (err) {
    alert('Foto konnte nicht verarbeitet werden: ' + err.message);
    console.error(err);
  }
});

editPhotoRemoveBadge.addEventListener('click', () => {
  pendingPhotos = [];
  updatePhotoRemoveBadge();
  scheduleSave();
});

// --- Rich text body ------------------------------------------------------
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
    scheduleSave();
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
    const actions = document.createElement('div');
    actions.className = 'note-card-actions';

    const editIcon = document.createElement('button');
    editIcon.type = 'button';
    editIcon.className = 'note-card-icon-btn';
    editIcon.textContent = '✏️';
    editIcon.title = 'Bearbeiten';
    editIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditScreen(note);
    });
    actions.appendChild(editIcon);

    const deleteIcon = document.createElement('button');
    deleteIcon.type = 'button';
    deleteIcon.className = 'note-card-icon-btn';
    deleteIcon.textContent = '🗑️';
    deleteIcon.title = 'Löschen';
    deleteIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNote(note);
    });
    actions.appendChild(deleteIcon);

    card.appendChild(actions);
  }

  card.addEventListener('click', () => openViewScreen(note));
  return card;
}

async function deleteNote(note) {
  if (!confirm(`"${note.title || 'Notiz'}" wirklich löschen?`)) return;
  try {
    await deleteDoc(doc(db, 'notes', note.id));
    notes = notes.filter((n) => n.id !== note.id);
    renderNotes();
    window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  } catch (err) {
    alert('Löschen fehlgeschlagen: ' + err.message);
    console.error(err);
  }
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

// --- View screen (read-only, admin-only edit button) -----------------------

function openViewScreen(note) {
  viewingNote = note;
  viewTitleEl.textContent = note.title || '(ohne Titel)';
  const photo = (note.photos || [])[0];
  if (photo) {
    viewHeroImgEl.src = photo;
    viewHeroEl.classList.remove('hidden');
  } else {
    viewHeroImgEl.src = '';
    viewHeroEl.classList.add('hidden');
  }
  const html = bodyToHtml(note.body);
  if (html) {
    viewContentEl.innerHTML = html;
    viewContentEl.classList.remove('hidden');
  } else {
    viewContentEl.innerHTML = '';
    viewContentEl.classList.add('hidden');
  }
  viewModal.classList.add('show');
}

function closeViewScreen() {
  viewModal.classList.remove('show');
  viewingNote = null;
}

viewCloseBtn.addEventListener('click', closeViewScreen);
viewModal.addEventListener('click', (e) => {
  if (e.target === viewModal) closeViewScreen();
});
viewEditBtn.addEventListener('click', () => {
  if (!viewingNote) return;
  const note = viewingNote;
  closeViewScreen();
  openEditScreen(note);
});

// --- Edit screen (Google Keep-style, instant autosave) ----------------------

function setEditStatus(msg) {
  editStatusEl.textContent = msg || '';
  editStatusEl.classList.toggle('hidden', !msg);
}

function openEditScreen(note) {
  if (!note && !loadOk) {
    statusEl.textContent = 'Hinzufügen blockiert: Die Daten wurden zuletzt nicht erfolgreich geladen. Bitte Seite neu laden.';
    return;
  }
  editingNoteId = note ? note.id : null;
  dirty = false;
  editTitleInput.value = note ? (note.title || '') : '';
  editBodyInput.innerHTML = note ? bodyToHtml(note.body || '') : '';
  pendingPhotos = note ? (note.photos || []).slice(0, 1) : [];
  updatePhotoRemoveBadge();
  setEditStatus('');
  editModal.classList.add('show');
  if (!note) editTitleInput.focus();
}

async function closeEditScreen() {
  const changed = await persistNow();
  // A failed flush leaves dirty=true (see persistNow's catch) — keep the
  // editor open with the error visible instead of closing over an unsaved
  // change and losing it silently; tapping back again retries the save.
  if (dirty) return;
  editModal.classList.remove('show');
  editingNoteId = null;
  pendingPhotos = [];
  // Only broadcast when something actually happened this session — every
  // other screen in the app reloads its own Firestore data in response
  // (see the erdkeller:refresh listeners across js/*.js), so a no-op
  // close (opened a note, changed nothing, tapped back) shouldn't trigger
  // that app-wide re-fetch.
  if (changed) window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
}

editBackBtn.addEventListener('click', () => closeEditScreen());
editModal.addEventListener('click', (e) => {
  if (e.target === editModal) closeEditScreen();
});

editTitleInput.addEventListener('input', scheduleSave);
editBodyInput.addEventListener('input', scheduleSave);

function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, SAVE_DEBOUNCE_MS);
}

// The core of "saving is instant during editing" (Build 103) — every edit
// (title/body keystroke debounced, photo add/remove and toolbar clicks
// immediate) runs through here instead of a Speichern button. A note with
// no content at all is never actually created (a fresh "+ Notiz" the admin
// backs out of without typing anything leaves nothing behind); a note
// that's edited down to fully empty gets deleted the same way Google Keep
// does it, rather than leaving a blank card in the grid.
async function persistNow() {
  clearTimeout(saveTimer);
  if (!dirty || !loadOk) return false;
  dirty = false;
  const data = {
    title: editTitleInput.value.trim(),
    body: editBodyInput.textContent.trim() ? sanitizeBodyHtml(editBodyInput.innerHTML.trim()) : '',
    photos: pendingPhotos,
  };
  const hasContent = Boolean(data.title || data.body || data.photos.length);
  const nowIso = new Date().toISOString();
  try {
    if (!hasContent) {
      if (!editingNoteId) return false;
      await deleteDoc(doc(db, 'notes', editingNoteId));
      notes = notes.filter((n) => n.id !== editingNoteId);
      editingNoteId = null;
      renderNotes();
      return true;
    }
    if (!editingNoteId) {
      const newDoc = await addDoc(collection(db, 'notes'), { ...data, createdAt: nowIso, updatedAt: nowIso });
      editingNoteId = newDoc.id;
      notes.push({ id: newDoc.id, ...data, createdAt: nowIso, updatedAt: nowIso });
    } else {
      await updateDoc(doc(db, 'notes', editingNoteId), { ...data, updatedAt: nowIso });
      const idx = notes.findIndex((n) => n.id === editingNoteId);
      if (idx >= 0) notes[idx] = { ...notes[idx], ...data, updatedAt: nowIso };
    }
    setEditStatus('');
    renderNotes();
    return true;
  } catch (err) {
    console.error(err);
    setEditStatus('Speichern fehlgeschlagen: ' + err.message);
    dirty = true; // retried on the next keystroke/close instead of silently dropping the change
    return false;
  }
}

addNoteBtn.addEventListener('click', () => openEditScreen(null));

// --- Entry point -----------------------------------------------------------

window.addEventListener('erdkeller:signedin', (e) => {
  isAdmin = e.detail.role === 'admin';
  loadNotes();
});
window.addEventListener('erdkeller:refresh', () => loadNotes());
