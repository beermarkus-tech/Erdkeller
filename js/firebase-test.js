// Step 1 connectivity check only — writes/reads a dummy doc in /diagnostics.
// Removed once real features (Step 4+) exercise Firestore directly.
import { db } from './firebase-init.js';
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const btn = document.getElementById('fb-test-btn');
const statusEl = document.getElementById('fb-status');

async function testConnection() {
  const ref = doc(db, 'diagnostics', 'connectionTest');
  try {
    statusEl.textContent = 'Schreibe Testdokument…';
    await setDoc(ref, {
      message: 'Erdkeller Verbindungstest',
      writtenAt: new Date().toISOString(),
    });

    statusEl.textContent = 'Lese Testdokument…';
    const snap = await getDoc(ref);

    if (snap.exists()) {
      const data = snap.data();
      statusEl.textContent = `✓ Verbunden — "${data.message}" (${data.writtenAt})`;
    } else {
      statusEl.textContent = '✗ Dokument nach dem Schreiben nicht gefunden.';
    }
  } catch (err) {
    statusEl.textContent = '✗ Fehler: ' + err.message;
    console.error(err);
  }
}

btn.addEventListener('click', testConnection);
