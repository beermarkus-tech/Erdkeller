// Tests listHouseholds (Build 212, MULTI_HOUSEHOLD.md step 6c): operators
// only, and metadata only — never household content.
process.env.GCLOUD_PROJECT = 'demo-erdkeller';
const fns = require('../../functions/index.js');
const { getFirestore } = require('firebase-admin/firestore');
const db = getFirestore();

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log((ok ? ' ok  ' : 'FAIL ') + name + (extra ? ` (${extra})` : '')); };
async function code(p) { try { await p; return 'ok'; } catch (e) { return e.code || e.message; } }
const as = (email, verified = true) => ({ uid: 'u-' + email, token: { email, email_verified: verified } });
const list = (auth) => fns.listHouseholds.run({ auth, data: {} });
const day = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

(async () => {
  for (const col of await db.listCollections()) await db.recursiveDelete(col);
  await db.doc('_system/config').set({ operators: ['Op.Erator@gmail.com'], allowEmails: ['a@x.com', 'b@x.com'] });
  await db.doc('households/h1').set({ name: 'Erdkeller', createdAt: '2026-10-01T00:00:00Z', lang: 'de', country: 'DE', timezone: 'Europe/Paris', dictationLimit: 1000 });
  await db.doc('households/h1/contacts/c1').set({ name: 'Dr. Secret', phone: '123' });
  await db.doc('households/h1/stockItems/s1').set({ productId: 'p', quantity: 99 });
  await db.doc(`households/h1/usage/dictation-${day(1)}`).set({ day: day(1), count: 5 });
  await db.doc(`households/h1/usage/dictation-${day(20)}`).set({ day: day(20), count: 7 });
  await db.doc('households/h2').set({ name: 'Familie Test', createdAt: '2026-10-10T00:00:00Z', lang: 'en', country: 'US' });
  await db.doc('users/a').set({ name: 'Markus', email: 'm@x.com', role: 'admin', householdId: 'h1', joinedAt: '2026-10-02' });
  await db.doc('users/b').set({ name: 'Julia', role: 'member', householdId: 'h1', joinedAt: '2026-10-05' });
  await db.doc('users/c').set({ name: 'Gone', role: 'member', householdId: 'h1', removed: true });
  await db.doc('users/d').set({ name: 'Tester', email: 't@x.com', role: 'admin', householdId: 'h2' });
  await db.doc('users/e').set({ name: 'Waiting', role: 'pending' });
  await db.doc('invites/i1').set({ householdId: 'h2', email: 'z@x.com', status: 'open' });

  check('a household admin is not an operator', (await code(list(as('m@x.com')))) === 'permission-denied');
  check('an unverified operator address is refused', (await code(list(as('op.erator@gmail.com', false)))) === 'failed-precondition');
  check('signed-out is refused', (await code(fns.listHouseholds.run({ auth: null, data: {} }))) === 'unauthenticated');
  const r = await list(as('operator@gmail.com')); // Gmail variant of the listed address
  check('the operator gets the list (Gmail spelling variants match)', Array.isArray(r.households) && r.households.length === 2);
  const h1 = r.households.find((h) => h.id === 'h1');
  const h2 = r.households.find((h) => h.id === 'h2');
  check('newest household first', r.households[0].id === 'h2');
  check('member counts exclude removed accounts', h1.members === 2 && h2.members === 1);
  check('admins by name and e-mail', h1.admins.length === 1 && h1.admins[0].name === 'Markus' && h1.admins[0].email === 'm@x.com');
  check('dictation use of the last 7 days, and the limit', h1.dictation7 === 5 && h1.dictationLimit === 1000 && h2.dictationLimit === 20);
  check('open invitations counted', h2.openInvites === 1 && h1.openInvites === 0);
  check('accounts without a household counted (pending + removed)', r.accountsWithoutHousehold === 2);
  check('signup status reported', r.signup.open === false && r.signup.allowEmails === 2);
  const allowed = ['id', 'name', 'createdAt', 'lang', 'country', 'timezone', 'members', 'admins', 'lastJoinedAt', 'openInvites', 'dictationLimit', 'dictation7', 'lastDictation'];
  check('only overview fields come back', r.households.every((h) => Object.keys(h).every((k) => allowed.includes(k))));
  const raw = JSON.stringify(r);
  check('no household content anywhere in the answer', !raw.includes('Dr. Secret') && !raw.includes('123') && !raw.includes('quantity'));

  // Build 213: the yes/no for the Admin card
  const am = async (auth) => (await fns.amIOperator.run({ auth, data: {} })).operator;
  check('amIOperator: yes for the operator', (await am(as('op.erator@gmail.com'))) === true);
  check('amIOperator: no for a household admin', (await am(as('m@x.com'))) === false);
  check('amIOperator: no for an unverified address', (await am(as('op.erator@gmail.com', false))) === false);
  check('amIOperator: signed-out is refused', (await code(fns.amIOperator.run({ auth: null, data: {} }))) === 'unauthenticated');

  console.log(failed ? `\n${failed} operator test(s) FAILED` : '\nall operator tests passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
