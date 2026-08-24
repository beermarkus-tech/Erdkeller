import { db } from './firebase-init.js?v=46';
import {
  collection, getDocs, query, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

function formatLogRow(entry) {
  const icon = entry.action === 'in' ? '⬇' : '⬆';
  const extra = [];
  if (entry.details) extra.push(entry.details);
  if (entry.content) extra.push(entry.content);
  if (entry.bestBefore) extra.push(`MHD ${entry.bestBefore}`);
  const text = `${entry.quantity}× ${entry.productName}` + (extra.length ? ' · ' + extra.join(' · ') : '');
  return { icon, text };
}

// Shared by the Einlagern/Entnehmen success screens (a short recent slice)
// and Settings → Verlauf (a longer standalone view) — same /stockLog feed,
// just a different `count`.
export async function renderRecentLog(container, count = 15) {
  container.innerHTML = '';
  try {
    const snap = await getDocs(query(collection(db, 'stockLog'), orderBy('createdAt', 'desc'), limit(count)));
    if (snap.empty) {
      const empty = document.createElement('p');
      empty.className = 'screen-placeholder';
      empty.textContent = 'Noch keine Änderungen.';
      container.appendChild(empty);
      return;
    }
    snap.docs.forEach((d) => {
      const entry = d.data();
      const { icon, text } = formatLogRow(entry);
      const row = document.createElement('div');
      row.className = 'recent-log-row';
      const iconEl = document.createElement('span');
      iconEl.className = 'log-icon ' + (entry.action === 'in' ? 'log-in' : 'log-out');
      iconEl.textContent = icon;
      const textEl = document.createElement('span');
      textEl.className = 'log-text';
      textEl.textContent = text;
      row.appendChild(iconEl);
      row.appendChild(textEl);
      container.appendChild(row);
    });
  } catch (err) {
    console.error(err);
  }
}
