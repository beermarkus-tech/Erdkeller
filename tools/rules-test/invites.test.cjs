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

  // Build 207: Gmail spelling variants
  await inv('g1', { email: 'mar.kus+erdkeller@googlemail.com', emailKey: 'markus@gmail.com' });
  const gm = (await call('myInvites', as('mk', 'Markus@gmail.com'))).invites.map((i) => i.id);
  check('Gmail dots/+tag/googlemail variants find the invitation', gm.includes('g1'), gm.join(','));
  await call('acceptInvite', as('mk', 'markus@gmail.com'), { inviteId: 'g1' });
  check('…and can accept it', (await db.doc('users/mk').get()).data().householdId === 'h1');
  await inv('g2', { email: 'other.person@gmail.com', emailKey: 'markus@gmail.com' });
  check('a wrong emailKey cannot hand the invitation to someone else', (await code(call('acceptInvite', as('mk2', 'markus@gmail.com'), { inviteId: 'g2' }))) === 'permission-denied');

  // Build 207: an account removed the old way (tombstone) is free to join again
  await inv('back', { email: 'gone@x.com', createdAt: daysAgo(0) });
  check('old removed account sees its new invitation', (await call('myInvites', as('gone', 'gone@x.com'))).invites.some((i) => i.id === 'back'));
  await call('acceptInvite', as('gone', 'gone@x.com'), { inviteId: 'back' });
  const back = (await db.doc('users/gone').get()).data();
  check('…accepts it: back in, tombstone cleared', back.householdId === 'h1' && back.role === 'member' && back.removed === undefined);

  // Build 207: removeMember
  await db.doc('users/mk/devices/d').set({ token: 't' });
  await db.doc('users/m2').set({ name: 'M2', role: 'member', householdId: 'h1' });
  await db.doc('households/h9').set({ name: 'Other' });
  await db.doc('users/o9').set({ name: 'O9', role: 'admin', householdId: 'h9' });
  check('a member cannot remove anyone', (await code(call('removeMember', as('m2', 'm2@x.com'), { uid: 'mk' }))) === 'permission-denied');
  check('an admin of another household cannot', (await code(call('removeMember', as('o9', 'o9@x.com'), { uid: 'mk' }))) === 'permission-denied');
  check('an admin cannot remove themselves', (await code(call('removeMember', as('boss', 'b@x.com'), { uid: 'boss' }))) === 'failed-precondition');
  await call('removeMember', as('boss', 'b@x.com'), { uid: 'mk' });
  const gone2 = (await db.doc('users/mk').get()).data();
  check('removing takes the account out of the household', gone2.householdId === undefined && gone2.role === 'pending' && gone2.removed === undefined);
  check('…and deletes its devices', (await db.collection('users/mk/devices').get()).empty);
  await inv('again', { email: 'markus@gmail.com', emailKey: 'markus@gmail.com', createdAt: daysAgo(0) });
  await call('acceptInvite', as('mk', 'markus@gmail.com'), { inviteId: 'again' });
  check('…and the person can be invited again', (await db.doc('users/mk').get()).data().householdId === 'h1');

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

  // Build 209: starter categories by data language
  const taxOf = async (id) => (await db.doc(`households/${id}/config/taxonomy`).get()).data();
  const enTax = await taxOf(created.householdId);
  const deTax = await taxOf(c2.householdId);
  check('an English household starts with the English categories', enTax && enTax.fromTemplate === 'en' && enTax.types.some((t) => t.name === 'Food'));
  check('a German household starts with the German categories', deTax && deTax.fromTemplate === 'de' && deTax.types.some((t) => t.name === 'Lebensmittel'));
  // The two templates must differ only in names: same ids, icons, planning settings, order.
  const strip = (node) => {
    if (Array.isArray(node)) return node.map(strip);
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).filter(([k]) => k !== 'name').map(([k, v]) => [k, strip(v)]));
    return node;
  };
  const tde = require('../../functions/templates/taxonomy-de.json');
  const ten = require('../../functions/templates/taxonomy-en.json');
  check('German and English templates are identical except for the names', JSON.stringify(strip(tde)) === JSON.stringify(strip(ten)));
  const names = (node, out = []) => { if (node.name) out.push(node.name); [...(node.types || []), ...(node.categories || []), ...(node.subcategories || [])].forEach((c) => names(c, out)); return out; };
  check('every English name is filled in', names(ten).every((n) => typeof n === 'string' && n.trim()));

  console.log(failed ? `\n${failed} invitation test(s) FAILED` : '\nall invitation tests passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
