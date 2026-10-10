import { renderRecentLog, deleteAllLogs } from './stock-log.js?v=196';
import { t } from './i18n.js?v=196';

const logCard = document.querySelector('.settings-card[data-target="log"]');
const logListEl = document.getElementById('admin-log-list');
const logPanel = document.getElementById('settings-panel-log');
const logClearBtn = document.getElementById('log-clear-btn');

const ADMIN_LOG_LIMIT = 50;

logCard.addEventListener('click', () => renderRecentLog(logListEl, ADMIN_LOG_LIMIT));

window.addEventListener('erdkeller:refresh', () => {
  if (!logPanel.classList.contains('hidden')) renderRecentLog(logListEl, ADMIN_LOG_LIMIT);
});

logClearBtn.addEventListener('click', async () => {
  if (!confirm(t('adminLog.gesamten_verlauf_unwiderruflich_loeschen'))) return;
  logClearBtn.disabled = true;
  try {
    await deleteAllLogs();
    renderRecentLog(logListEl, ADMIN_LOG_LIMIT);
  } catch (err) {
    console.error(err);
  } finally {
    logClearBtn.disabled = false;
  }
});
