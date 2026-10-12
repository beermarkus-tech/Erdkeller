// Tests deleteMyAccount / deleteHousehold (Build 211, MULTI_HOUSEHOLD.md
// step 6b) against the Firestore and Auth emulators.
process.env.GCLOUD_PROJECT = 'demo-erdkeller';
const fns = require('../../functions/index.js');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const db = getFirestore();
const auth = getAuth();

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log((ok ? ' ok  ' : 'FAIL ') + name + (extra ? ` (${extra})` : '')); };
async function code(p) { try { await p; return 'ok'; } catch (e) { return e.code || e.message; } }
const as = (uid) => ({ uid, token: {} });
const call = (fn, uid, data = {}) => fns[fn].run({ auth: as(uid), data });
const exists = async (path) => (await db.doc(path).get()).exists;
const authExists = async (uid) => { try { await auth.getUser(uid); return true; } catch (e) { return false; } };

async function user(uid, data) {
  await db.doc(`users/${uid}`).set(data);
  await db.doc(`users/${uid}/devices/d1`).set({ token: 't-' + uid });
  try { await auth.createUser({ uid }); } catch (e) { /* exists */ }
}

(async () => {
  for (const col of await db.listCollections()) await db.recursiveDelete(col);
  // Household A: admin a1, member m1. Household B: admins b1, b2 + member bm. Household S: solo s1.
  await db.doc('households/A').set({ name: 'Haus A' });
  await db.doc('households/A/contacts/c1').set({ name: 'X' });
  await db.doc('households/A/config/taxonomy').set({ types: [] });
  await db.doc('households/B').set({ name: 'Haus B' });
  await db.doc('households/B/stockItems/s1').set({ quantity: 1 });
  await db.doc('households/S').set({ name: 'Solo' });
  await db.doc('households/S/notes/n1').set({ title: 'n' });
  await user('a1', { role: 'admin', householdId: 'A' });
  await user('m1', { role: 'member', householdId: 'A' });
  await user('b1', { role: 'admin', householdId: 'B' });
  await user('b2', { role: 'admin', householdId: 'B' });
  await user('bm', { role: 'member', householdId: 'B' });
  await user('s1', { role: 'admin', householdId: 'S' });
  await user('free', { role: 'pending' });
  await db.doc('invites/iA').set({ householdId: 'A', email: 'x@x.com', status: 'open' });
  await db.doc('invites/iS').set({ householdId: 'S', email: 'y@y.com', status: 'open' });

  // deleteMyAccount
  check('a member deletes their account', (await code(call('deleteMyAccount', 'm1'))) === 'ok');
  check('…their /users doc and devices are gone', !(await exists('users/m1')) && (await db.collection('users/m1/devices').get()).empty);
  check('…their sign-in record is gone', !(await authExists('m1')));
  check('…the household stays', await exists('households/A/contacts/c1'));
  const aRes = await call('deleteMyAccount', 'a1'); // alone in A now that m1 left
  check('the admin left alone deletes their account: household A goes too', aRes.householdDeleted && !(await exists('households/A')) && !(await exists('households/A/contacts/c1')));
  check('…and A\'s open invitations are revoked', (await db.doc('invites/iA').get()).data().status === 'revoked');
  check('an admin with another admin left can delete their account', (await code(call('deleteMyAccount', 'b1'))) === 'ok' && await exists('households/B/stockItems/s1'));
  check('the last admin with a member left is refused', (await code(call('deleteMyAccount', 'b2'))) === 'failed-precondition' && await exists('users/b2'));
  const soloRes = await call('deleteMyAccount', 's1');
  check('the last person deletes their account: household goes too', soloRes.householdDeleted && !(await exists('households/S')) && !(await exists('households/S/notes/n1')));
  check('…and its open invitations are revoked', (await db.doc('invites/iS').get()).data().status === 'revoked');
  check('an account without a household deletes itself', (await code(call('deleteMyAccount', 'free'))) === 'ok' && !(await exists('users/free')));

  // deleteHousehold
  await db.doc('households/C').set({ name: 'Haus C' });
  await db.doc('households/C/stockItems/x').set({ q: 1 });
  await db.doc('households/C/config/taxonomy').set({ types: [] });
  await user('c1', { role: 'admin', householdId: 'C' });
  await user('cm', { role: 'member', householdId: 'C' });
  await db.doc('invites/iC').set({ householdId: 'C', email: 'z@z.com', status: 'open' });
  check('a member cannot delete the household', (await code(call('deleteHousehold', 'cm', { confirmName: 'Haus C' }))) === 'permission-denied');
  check('a wrong name is refused', (await code(call('deleteHousehold', 'c1', { confirmName: 'Haus X' }))) === 'failed-precondition' && await exists('households/C/stockItems/x'));
  check('an empty name is refused', (await code(call('deleteHousehold', 'c1', { confirmName: '' }))) === 'failed-precondition');
  check('another household\'s admin cannot', (await code(call('deleteHousehold', 'b2', { confirmName: 'Haus C' }))) === 'failed-precondition' && await exists('households/C'));
  check('the admin deletes it with the right name', (await code(call('deleteHousehold', 'c1', { confirmName: ' Haus C ' }))) === 'ok');
  check('…all its data is gone', !(await exists('households/C')) && !(await exists('households/C/stockItems/x')) && !(await exists('households/C/config/taxonomy')));
  const c1 = (await db.doc('users/c1').get()).data();
  const cm = (await db.doc('users/cm').get()).data();
  check('…every member is out of it (back to no household), accounts kept', c1.householdId === undefined && c1.role === 'pending' && cm.householdId === undefined && cm.role === 'pending');
  check('…its open invitations are revoked', (await db.doc('invites/iC').get()).data().status === 'revoked');
  check('…other households untouched', await exists('households/B/stockItems/s1'));

  console.log(failed ? `\n${failed} deletion test(s) FAILED` : '\nall deletion tests passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
