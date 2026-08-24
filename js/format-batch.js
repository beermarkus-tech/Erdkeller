// Shared "result lines" renderer — used by the Einlagern/Entnehmen success
// screens and the Entnehmen detail step's batch summary: "qty× product",
// "MHD date", and storage, each its own line — no header, no dot
// separators, just the three facts that matter when confirming what
// just changed.
export function renderResultLines(container, { qty, productName, bestBefore, storage } = {}) {
  container.innerHTML = '';

  if (qty != null || productName) {
    const line = document.createElement('div');
    line.className = 'result-line';
    line.textContent = [qty != null ? `${qty}×` : null, productName].filter(Boolean).join(' ');
    container.appendChild(line);
  }

  if (bestBefore) {
    const line = document.createElement('div');
    line.className = 'result-line';
    line.textContent = `MHD ${bestBefore}`;
    container.appendChild(line);
  }

  if (storage) {
    const line = document.createElement('div');
    line.className = 'result-line';
    line.textContent = storage;
    container.appendChild(line);
  }
}
