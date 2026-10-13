import de from './locales/de.js?v=214';
import en from './locales/en.js?v=214';

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

let lang = readStoredLang() || deviceLang();

// Build 195 — switching happens in place (no reload): see setLang(). The
// reload path is kept behind this flag as a fallback.
const LIVE_SWITCH = true;

export function getLang() {
  return lang;
}

export function getLocale() {
  return LOCALES[lang];
}

// Switching saves the choice, then either reloads (LIVE_SWITCH false — works
// offline, the service worker serves the shell) or switches in place:
// static markup is re-applied here, then
// - erdkeller:langchange lets modules fix text that no data refresh touches
//   (headers, labels painted once at sign-in), and
// - erdkeller:refresh makes every screen re-render from its data, exactly
//   as the ↻ button does — and like ↻, the language button is unreachable
//   while a full-screen modal is open, so no half-typed form is ever
//   re-rendered under the user.
// Both come after the static pass, so a module's own render always wins
// over a stale static default.
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
  if (!LIVE_SWITCH) {
    location.reload();
    return;
  }
  const prev = lang;
  lang = next;
  pluralRules = new Intl.PluralRules(LOCALES[lang]);
  document.documentElement.lang = lang;
  applyStatic(document, prev);
  updateLangButtons();
  window.dispatchEvent(new CustomEvent('erdkeller:langchange', { detail: { lang } }));
  window.dispatchEvent(new CustomEvent('erdkeller:refresh'));
}

let pluralRules = new Intl.PluralRules(LOCALES[lang]);

function lookup(key, inLang = lang) {
  if (Object.prototype.hasOwnProperty.call(DICTS[inLang], key)) return DICTS[inLang][key];
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

// Static markup (index.html, Build 190):
// - data-i18n="key" replaces the element's own text. Many elements mix an
//   icon <span> with a text node (e.g. the nav buttons' "<span>🏠</span>
//   Übersicht"), so only the one non-blank direct text node is replaced —
//   child elements and the whitespace around the text are left untouched.
// - data-i18n-html="key" sets innerHTML. Only for the few static sentences
//   with inline markup (<strong>), whose values live in de.js/en.js — never
//   use it for anything containing user data.
// - data-i18n-attr="placeholder:key;title:key" sets attributes.
//
// `from` is the language the markup currently shows (the HTML source is
// German). Text is only replaced while it still reads exactly as the static
// default in that language: many of these elements are later rewritten by
// their module (a modal title showing a contact's name, a select-mode
// button toggled to "Fertig", a status line), and on a language switch those
// must be left to the module's own re-render rather than reset to the
// static default.
// Run once at startup below, and on every in-place language switch.
const plain = (v) => (typeof v === 'string' ? v : '');

function setOwnText(el, text, expected) {
  const node = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.nodeValue.trim());
  if (!node) return; // emptied or rewritten by its module: not ours any more
  const [, lead, current, trail] = node.nodeValue.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (current !== expected) return;
  node.nodeValue = lead + text + trail;
}

function serializeHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.innerHTML;
}

export function applyStatic(root = document, from = 'de') {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    setOwnText(el, t(key), plain(lookup(key, from)));
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const key = el.dataset.i18nHtml;
    if (el.innerHTML === serializeHtml(plain(lookup(key, from)))) el.innerHTML = t(key);
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(';').forEach((pair) => {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (!attr || !key) return;
      if (!el.hasAttribute(attr) || el.getAttribute(attr) === plain(lookup(key, from))) el.setAttribute(attr, t(key));
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

function updateLangButtons() {
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.textContent = lang.toUpperCase();
  });
}

function initLangButtons() {
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // A reload throws away an open flow; switching in place doesn't.
      if (!LIVE_SWITCH && flowInProgress() && !confirm(t('lang.confirmLeaveFlow'))) return;
      setLang(LANGUAGES[(LANGUAGES.indexOf(lang) + 1) % LANGUAGES.length]);
    });
  });
  updateLangButtons();
}

document.documentElement.lang = lang;
applyStatic();
initLangButtons();
