import de from './locales/de.js?v=189';
import en from './locales/en.js?v=189';

// UI language (I18N.md). Plain dictionaries, no library: i18next & co. would
// need a CDN fetch or a build step, and the app must boot fully offline —
// these two files are precached by service-worker.js like every other module.
//
// Data (taxonomy, products, checklists, notes, recipes, contacts) is NOT
// translated — it's the household's own content, shown exactly as entered.
// Only the app's own UI text goes through t().

const DICTS = { de, en };
const LOCALES = { de: 'de-DE', en: 'en-US' };
export const LANGUAGES = ['de', 'en'];

// Fourth deliberate localStorage use (after auth.js's cached identity,
// push.js's deviceId and the Verbindung toggles): the language has to be
// known synchronously, before sign-in and while offline. Unset means "follow
// the device".
const LANG_KEY = 'erdkeller-lang';

function readStoredLang() {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    return LANGUAGES.includes(stored) ? stored : null;
  } catch (err) {
    return null;
  }
}

// Device language: German devices get German, everything else English.
function deviceLang() {
  const list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
  return String(list[0] || '').toLowerCase().startsWith('de') ? 'de' : 'en';
}

const lang = readStoredLang() || deviceLang();

export function getLang() {
  return lang;
}

export function getLocale() {
  return LOCALES[lang];
}

// Switching saves the choice and reloads rather than re-rendering in place:
// ~30 modules each hold their own rendered state, and a reload is the one
// way to guarantee nothing is left in the old language. Works offline (the
// service worker serves the shell).
export function setLang(next) {
  if (!LANGUAGES.includes(next) || next === lang) return;
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch (err) {
    // Unavailable storage: the reload below would just come back in the
    // device language, so don't pretend the switch worked.
    console.error('Sprache konnte nicht gespeichert werden', err);
    return;
  }
  location.reload();
}

const pluralRules = new Intl.PluralRules(LOCALES[lang]);

function lookup(key) {
  if (Object.prototype.hasOwnProperty.call(DICTS[lang], key)) return DICTS[lang][key];
  if (Object.prototype.hasOwnProperty.call(de, key)) return de[key];
  console.warn('i18n: missing key', key);
  return key;
}

// t('key') or t('key', { name: 'x', count: 3 }). An entry may be a plain
// string or a plural object { one: '…', other: '…' } picked by params.count.
// {placeholders} are replaced verbatim — callers put the result into
// textContent, never innerHTML, unless the key is known markup.
export function t(key, params) {
  let value = lookup(key);
  if (value && typeof value === 'object') {
    const count = params && typeof params.count === 'number' ? params.count : 0;
    value = value[pluralRules.select(count)] ?? value.other ?? '';
  }
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  ));
}

export function fmtNumber(value, options) {
  return Number(value).toLocaleString(LOCALES[lang], options);
}

export function fmtDate(value, options) {
  return new Date(value).toLocaleDateString(LOCALES[lang], options);
}

// Static markup: data-i18n="key" sets textContent, data-i18n-attr=
// "placeholder:key;title:key" sets attributes. Run once at startup below,
// and callable on freshly inserted markup.
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(';').forEach((pair) => {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
}

// --- Language switch buttons -----------------------------------------------
//
// One per place an avatar lives (sidebar bottom-left on tablet, topbar on
// phone) plus the sign-in screen. With two languages a tap simply toggles;
// the label shows the language currently active.

// A reload throws away a half-finished check-in/check-out, so ask first.
// Everything else that holds unsaved input is a full-screen modal covering
// these buttons, so it can't be open when one is tapped.
function flowInProgress() {
  return ['stock-flow', 'stock-flow-checkout'].some((id) => {
    const el = document.getElementById(id);
    return el && !el.classList.contains('hidden');
  });
}

function initLangButtons() {
  const next = LANGUAGES[(LANGUAGES.indexOf(lang) + 1) % LANGUAGES.length];
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.textContent = lang.toUpperCase();
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (flowInProgress() && !confirm(t('lang.confirmLeaveFlow'))) return;
      setLang(next);
    });
  });
}

document.documentElement.lang = lang;
applyStatic();
initLangButtons();
