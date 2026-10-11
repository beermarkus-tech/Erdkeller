// Tests the joining/creating callables in functions/index.js (Build 206,
// MULTI_HOUSEHOLD.md step 4) against the Firestore emulator: myInvites,
// acceptInvite, declineInvite, createHousehold.
//
//   npm test
process.env.GCLOUD_PROJECT = 'demo-erdkeller';
const fns = require('../../functions/index.js');
const { getFirestore } = require('firebase-admin/firestore');
const db = getFirestore();

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log((ok ? ' ok  ' : 'FAIL ') + name + (extra ? ` (${extra})` : '')); };
const as = (uid, email, verified = true) => ({ uid, token: { email, email_verified: verified, name: uid.toUpperCase() } });
const call = (fn, auth, data = {}) => fns[fn].run({ auth, data });
async function code(p) { try { await p; return 'ok'; } catch (e) { return e.code || e.message; } }
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

(async () => {
  for (const col of await db.listCollections()) await db.recursiveDelete(col);
  await db.doc('households/h1').set({ name: 'Erdkeller', createdBy: 'boss', lang: 'de', timezone: 'Europe/Paris' });
  await db.doc('users/boss').set({ name: 'Markus', role: 'admin', householdId: 'h1' });
  await db.doc('users/new').set({ name: 'Neu', role: 'pending' });
  await db.doc('users/gone').set({ name: 'Weg', role: 'member', householdId: 'h1', removed: true });
  const inv = (id, o) => db.doc(`invites/${id}`).set({ householdId: 'h1', email: 'new@x.com', role: 'member', status: 'open', createdBy: 'boss', createdAt: daysAgo(1), ...o });
  await inv('i1');
  await inv('old', { createdAt: daysAgo(20) });
  await inv('other', { email: 'someone@x.com' });
  await inv('adm', { role: 'admin', createdAt: daysAgo(2) });
  await inv('forgone', { email: 'gone@x.com' });

  // myInvites
  const mine = (await call('myInvites', as('new', 'New@X.com'))).invites;
  check('lists open, unexpired invitations for the caller\'s address only', mine.map((i) => i.id).sort().join(',') === 'adm,i1', mine.map((i) => i.id).join(','));
  check('names come from the household and inviter docs', mine[0].householdName === 'Erdkeller' && mine[0].invitedBy === 'Markus');
  check('unverified e-mail is refused', (await code(call('myInvites', as('new', 'new@x.com', false)))) === 'failed-precondition');
  check('signed-out is refused', (await code(call('myInvites', null))) === 'unauthenticated');

  // acceptInvite
  check('someone else cannot accept it', (await code(call('acceptInvite', as('intruder', 'evil@x.com'), { inviteId: 'i1' }))) === 'permission-denied');
  check('expired invitation is refused', (await code(call('acceptInvite', as('new', 'new@x.com'), { inviteId: 'old' }))) === 'failed-precondition');
  check('unknown invitation is refused', (await code(call('acceptInvite', as('new', 'new@x.com'), { inviteId: 'nope' }))) === 'not-found');
  check('removed account cannot accept one', (await code(call('acceptInvite', as('gone', 'gone@x.com'), { inviteId: 'forgone' }))) === 'failed-precondition');
  const res = await call('acceptInvite', as('new', 'new@x.com'), { inviteId: 'i1' });
  const u = (await db.doc('users/new').get()).data();
  check('accepting puts the account into the household as member', res.householdId === 'h1' && u.householdId === 'h1' && u.role === 'member' && u.email === 'new@x.com');
  check('the invitation is marked accepted', (await db.doc('invites/i1').get()).data().status === 'accepted');
  check('a second invitation cannot move them again', (await code(call('acceptInvite', as('new', 'new@x.com'), { inviteId: 'adm' }))) === 'failed-precondition');
  check('an accepted invitation cannot be reused', (await code(call('acceptInvite', as('new2', 'new@x.com'), { inviteId: 'i1' }))) === 'failed-precondition');

  // brand-new account without a /users doc yet, admin invitation
  await inv('fresh', { email: 'fresh@x.com', role: 'admin' });
  await call('acceptInvite', as('fresh', 'fresh@x.com'), { inviteId: 'fresh' });
  const f = (await db.doc('users/fresh').get()).data();
  check('works without an existing /users doc, with the invited role', f && f.role === 'admin' && f.householdId === 'h1' && f.name === 'FRESH');

  // declineInvite
  await inv('d1', { email: 'dec@x.com' });
  check('someone else cannot decline it', (await code(call('declineInvite', as('x', 'x@x.com'), { inviteId: 'd1' }))) === 'permission-denied');
  await call('declineInvite', as('dec', 'dec@x.com'), { inviteId: 'd1' });
  check('declining marks it declined', (await db.doc('invites/d1').get()).data().status === 'declined');

  // createHousehold
  await db.doc('users/solo').set({ name: 'Solo', role: 'pending' });
  check('closed until openSignup', (await code(call('createHousehold', as('solo', 'solo@x.com'), { name: 'Solo' }))) === 'permission-denied');
  await db.doc('_system/config').set({ allowEmails: ['Solo@x.com'] });
  check('a name is required', (await code(call('createHousehold', as('solo', 'solo@x.com'), { name: '  ' }))) === 'invalid-argument');
  const created = await call('createHousehold', as('solo', 'solo@x.com'), { name: 'Familie Solo', country: 'US', timezone: 'America/Chicago', dataLang: 'en', lang: 'en' });
  const hh = (await db.doc(`households/${created.householdId}`).get()).data();
  const so = (await db.doc('users/solo').get()).data();
  check('allow-listed address creates a household', hh && hh.name === 'Familie Solo' && hh.country === 'US' && hh.timezone === 'America/Chicago' && hh.lang === 'en' && hh.createdBy === 'solo');
  check('creator becomes its admin', so.role === 'admin' && so.householdId === created.householdId);
  check('cannot create a second one', (await code(call('createHousehold', as('solo', 'solo@x.com'), { name: 'Again' }))) === 'failed-precondition');
  check('a household member cannot create one', (await code(call('createHousehold', as('boss', 'solo@x.com'), { name: 'X' }))) === 'failed-precondition');
  await db.doc('_system/config').set({ openSignup: true });
  const c2 = await call('createHousehold', as('newbie', 'newbie@x.com'), { name: 'N', country: 'not-a-country', timezone: 'Mars/Base' });
  const h2 = (await db.doc(`households/${c2.householdId}`).get()).data();
  check('openSignup lets anyone in; bad country/timezone are cleaned', h2.country === null && h2.timezone === 'Europe/Paris' && h2.lang === 'de');

  console.log(failed ? `\n${failed} invitation test(s) FAILED` : '\nall invitation tests passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
