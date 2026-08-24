// Shared "result lines" renderer — used by the Einlagern/Entnehmen success
// screens and the Entnehmen detail step's batch summary. Each field its own
// line rather than one long dot-joined string, since that's what needed to
// be legible at a glance right when it matters most.
export function renderResultLines(container, { qty, productName, details, content, bestBefore, storage } = {}) {
  container.innerHTML = '';

  const firstLineParts = [];
  if (qty != null) firstLineParts.push(`${qty}×`);
  if (productName) firstLineParts.push(productName);
  if (details) firstLineParts.push(details);
  if (content) firstLineParts.push(content);
  if (firstLineParts.length) {
    const line = document.createElement('div');
    line.className = 'result-line';
    line.textContent = firstLineParts.join(' · ');
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
