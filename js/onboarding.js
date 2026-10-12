// Onboarding (Build 206, MULTI_HOUSEHOLD.md step 4) — what an account that
// isn't in a household yet sees after signing in, in place of the Google
// button on the sign-in screen (js/auth.js shows/hides it and dispatches
// erdkeller:onboarding). Two ways in:
// - accept an invitation an admin sent to this Google account's e-mail
//   (Admin → Personen), or
// - create a household of its own and become its admin.
// Both run server-side (functions/index.js: myInvites, acceptInvite,
// declineInvite, createHousehold) — moving an account into a household is
// nothing the client is allowed to do itself. On success the server updates
// /users/{uid}; js/auth.js's profile listener then opens the app.
import { auth, functions } from './firebase-init.js?v=208';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";
import { t, getLang } from './i18n.js?v=208';

const helloEl = document.getElementById('onboarding-hello');
const invitesEl = document.getElementById('onboarding-invites');
const noInviteEl = document.getElementById('onboarding-noinvite');
const recheckBtn = document.getElementById('onboarding-recheck');
const nameEl = document.getElementById('onboarding-name');
const countryEl = document.getElementById('onboarding-country');
const tzEl = document.getElementById('onboarding-tz');
const createBtn = document.getElementById('onboarding-create');
const statusEl = document.getElementById('onboarding-status');

const myInvitesFn = httpsCallable(functions, 'myInvites');
const acceptInviteFn = httpsCallable(functions, 'acceptInvite');
const declineInviteFn = httpsCallable(functions, 'declineInvite');
const createHouseholdFn = httpsCallable(functions, 'createHousehold');

// A short list rather than every region: the country is only a hint for
// units and templates later (MULTI_HOUSEHOLD.md Section 6). Names come from
// the browser in the current UI language. Never derived from the IP.
const COUNTRIES = [
  'DE', 'AT', 'CH', 'LI', 'LU', 'BE', 'NL', 'FR', 'IT', 'ES', 'PT', 'DK', 'SE', 'NO', 'FI', 'IS', 'IE', 'GB',
  'PL', 'CZ', 'SK', 'HU', 'SI', 'HR', 'RO', 'BG', 'GR', 'EE', 'LV', 'LT', 'MT', 'CY',
  'US', 'CA', 'MX', 'AU', 'NZ', 'ZA', 'IN', 'SG', 'JP', 'BR', 'AR', 'IL',
];

let state = { loading: false, offline: false, email: '', invites: [], error: '' };
let busy = false;
let shown = false;

function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';
  } catch (err) {
    return 'Europe/Paris';
  }
}

// Pre-selected from the device language's region ("de-AT" → AT); a bare
// language falls back to DE for German, US otherwise.
function defaultCountry() {
  const tag = String((navigator.languages && navigator.languages[0]) || navigator.language || '');
  const region = (tag.split('-')[1] || '').toUpperCase();
  if (/^[A-Z]{2}$/.test(region)) return region;
  return getLang() === 'de' ? 'DE' : 'US';
}

function firstName() {
  const name = (auth.currentUser && auth.currentUser.displayName) || '';
  return name.split(' ')[0] || name;
}

function renderCountries() {
  const selected = countryEl.value || defaultCountry();
  let names = null;
  try {
    names = new Intl.DisplayNames([getLang()], { type: 'region' });
  } catch (err) { /* older browser: codes only */ }
  const codes = COUNTRIES.includes(selected) ? COUNTRIES : [selected, ...COUNTRIES];
  const label = (code) => (names ? names.of(code) : code) || code;
  countryEl.innerHTML = '';
  [...codes].sort((a, b) => label(a).localeCompare(label(b), getLang())).forEach((code) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = label(code);
    countryEl.appendChild(opt);
  });
  countryEl.value = selected;
}

function render() {
  helloEl.textContent = t('onboarding.hallo', { name: firstName() });
  tzEl.textContent = t('onboarding.zeitzone', { tz: deviceTimeZone() });
  if (!nameEl.value && nameEl.dataset.auto !== '0') nameEl.value = t('onboarding.default_name', { name: firstName() });
  renderCountries();

  invitesEl.innerHTML = '';
  if (state.loading) {
    noInviteEl.textContent = t('onboarding.suche');
  } else if (state.offline) {
    noInviteEl.textContent = t('onboarding.offline');
  } else if (state.error) {
    noInviteEl.textContent = state.error;
  } else if (!state.invites.length) {
    noInviteEl.textContent = t('onboarding.keine_einladung', { email: state.email });
  } else {
    noInviteEl.textContent = '';
    state.invites.forEach((inv) => invitesEl.appendChild(inviteRow(inv)));
  }
  noInviteEl.classList.toggle('hidden', !noInviteEl.textContent);
  recheckBtn.disabled = busy || state.loading;
  createBtn.disabled = busy;
}

function inviteRow(inv) {
  const row = document.createElement('div');
  row.className = 'onboarding-invite';
  const text = document.createElement('div');
  text.className = 'onboarding-invite-text';
  text.textContent = t(inv.role === 'admin' ? 'onboarding.einladung_admin' : 'onboarding.einladung', {
    by: inv.invitedBy || t('onboarding.jemand'), household: inv.householdName || '—',
  });
  row.appendChild(text);
  const actions = document.createElement('div');
  actions.className = 'onboarding-invite-actions';
  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'google-btn onboarding-primary';
  accept.textContent = t('onboarding.beitreten');
  accept.disabled = busy;
  accept.addEventListener('click', () => acceptInvite(inv));
  const decline = document.createElement('button');
  decline.type = 'button';
  decline.className = 'google-btn onboarding-btn-secondary';
  decline.textContent = t('onboarding.ablehnen');
  decline.disabled = busy;
  decline.addEventListener('click', () => declineInvite(inv));
  actions.append(accept, decline);
  row.appendChild(actions);
  return row;
}

async function loadInvites() {
  if (!navigator.onLine) {
    state = { ...state, loading: false, offline: true };
    render();
    return;
  }
  state = { ...state, loading: true, offline: false, error: '' };
  render();
  try {
    // The gate can be painted from the cached identity before Firebase Auth
    // has resolved; the callables need the real session.
    if (auth.authStateReady) await auth.authStateReady();
    if (!auth.currentUser) {
      state = { ...state, loading: false };
      render();
      return;
    }
    const { data } = await myInvitesFn({ lang: getLang() });
    state = { loading: false, offline: false, error: '', email: data.email || '', invites: data.invites || [] };
  } catch (err) {
    console.error(err);
    state = { ...state, loading: false, error: err.message };
  }
  render();
}

async function run(statusKey, fn) {
  if (busy) return;
  if (!navigator.onLine) {
    statusEl.textContent = t('onboarding.offline');
    return;
  }
  busy = true;
  statusEl.textContent = t(statusKey);
  render();
  try {
    await fn();
    statusEl.textContent = t('onboarding.geschafft');
  } catch (err) {
    console.error(err);
    statusEl.textContent = err.message;
  } finally {
    busy = false;
    render();
  }
}

function acceptInvite(inv) {
  run('onboarding.trete_bei', () => acceptInviteFn({ inviteId: inv.id, lang: getLang() }));
}

function declineInvite(inv) {
  if (!confirm(t('onboarding.ablehnen_confirm', { household: inv.householdName || '—' }))) return;
  run('onboarding.lehne_ab', async () => {
    await declineInviteFn({ inviteId: inv.id, lang: getLang() });
    state = { ...state, invites: state.invites.filter((x) => x.id !== inv.id) };
  });
}

createBtn.addEventListener('click', () => {
  const name = nameEl.value.trim();
  if (!name) {
    statusEl.textContent = t('onboarding.name_fehlt');
    nameEl.focus();
    return;
  }
  run('onboarding.lege_an', () => createHouseholdFn({
    name, country: countryEl.value, timezone: deviceTimeZone(), dataLang: getLang(), lang: getLang(),
  }));
});

// Once typed into, the name is the person's own — a language switch must
// not replace it with the default in the other language.
nameEl.addEventListener('input', () => { nameEl.dataset.auto = '0'; });
recheckBtn.addEventListener('click', () => loadInvites());

window.addEventListener('erdkeller:onboarding', (e) => {
  shown = e.detail.show;
  statusEl.textContent = '';
  if (shown) loadInvites();
});
window.addEventListener('erdkeller:langchange', () => {
  if (!shown) return;
  if (nameEl.dataset.auto !== '0') nameEl.value = '';
  render();
});
window.addEventListener('online', () => { if (shown && state.offline) loadInvites(); });

// js/auth.js runs first and may already have shown the gate (from the
// cached identity) before this module was there to hear the event.
if (!document.getElementById('auth-pending').classList.contains('hidden')) {
  shown = true;
  loadInvites();
}
