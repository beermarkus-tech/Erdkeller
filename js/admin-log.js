import { renderRecentLog } from './stock-log.js?v=48';

const logCard = document.querySelector('.settings-card[data-target="log"]');
const logListEl = document.getElementById('admin-log-list');
const logPanel = document.getElementById('settings-panel-log');

const ADMIN_LOG_LIMIT = 50;

logCard.addEventListener('click', () => renderRecentLog(logListEl, ADMIN_LOG_LIMIT));

window.addEventListener('erdkeller:refresh', () => {
  if (!logPanel.classList.contains('hidden')) renderRecentLog(logListEl, ADMIN_LOG_LIMIT);
});
