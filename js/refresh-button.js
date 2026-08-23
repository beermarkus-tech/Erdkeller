const buttons = [
  document.getElementById('refresh-btn-topbar'),
  document.getElementById('refresh-btn-tablet'),
].filter(Boolean);

let refreshing = false;

async function doRefresh() {
  if (refreshing) return;
  refreshing = true;
  buttons.forEach((btn) => btn.classList.add('spinning'));

  // No promise tracking of listeners (mirrors how the retired pull-to-refresh
  // gesture worked) — just hold the spin briefly so the click feels
  // acknowledged before resetting.
  window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
  await new Promise((resolve) => setTimeout(resolve, 600));

  refreshing = false;
  buttons.forEach((btn) => btn.classList.remove('spinning'));
}

buttons.forEach((btn) => btn.addEventListener('click', doRefresh));
