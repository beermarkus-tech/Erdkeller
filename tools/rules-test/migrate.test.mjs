// Tests functions/migrate.js (Build 203) against the Firestore emulator —
// the one-time copy of the root household into /households/{id}.
//
//   npx firebase emulators:exec --only firestore --project demo-erdkeller "node migrate.test.mjs"
import { createRequire } from 'module';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const { migrateRootToHousehold } = require('../../functions/migrate.js');

initializeApp({ projectId: 'demo-erdkeller' });
const db = getFirestore();

let failed = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(' ok  ' + name);
  else { failed++; console.log('FAIL ' + name + (detail ? '\n     ' + detail : '')); }
}

// Start clean (the emulator may hold data from another test file).
for (const col of await db.listCollections()) await db.recursiveDelete(col);

// --- seed a root household --------------------------------------------------
const when = Timestamp.fromDate(new Date('2026-03-01T10:00:00Z'));
await db.doc('users/admin').set({ name: 'Admin', role: 'admin' });
await db.doc('users/member').set({ name: 'Member', role: 'member', recipientSlug: 'julia' });
await db.doc('users/gone').set({ name: 'Gone', role: 'member', removed: true });
await db.doc('users/waiting').set({ name: 'Waiting', role: 'pending' });
await db.doc('users/member/devices/d1').set({ token: 'tok' });
await db.doc('config/taxonomy').set({ types: [{ id: 't1', name: 'Konserven', subtypes: [] }] });
await db.doc('config/notifications').set({ enabled: true });
for (let i = 0; i < 620; i++) await db.doc(`stockLog/l${i}`).set({ n: i, at: when }); // > one batch
await db.doc('stockItems/s1').set({ productId: 'p1', quantity: 3, bestBefore: '2027-01-01' });
await db.doc('products/p1').set({ name: 'Bohnen', unitType: 'Dose' });
await db.doc('contacts/c1').set({ name: 'Dr. Weber' });
await db.doc('contacts/c1/history/h1').set({ note: 'nested' }); // subcollection
await db.doc('diagnostics/x').set({ junk: true });

// --- run --------------------------------------------------------------------
const res = await migrateRootToHousehold(db, { callerUid: 'admin', household: { name: 'Erdkeller' } });
const hid = res.householdId;
const base = `households/${hid}`;
check('returns a new household id', typeof hid === 'string' && hid.length > 0 && !res.alreadyDone);

const count = async (p) => (await db.collection(p).count().get()).data().count;
check('stockLog copied completely (620)', (await count(`${base}/stockLog`)) === 620);
check('config copied', (await db.doc(`${base}/config/taxonomy`).get()).data().types[0].name === 'Konserven');
check('timestamps keep their type', (await db.doc(`${base}/stockLog/l5`).get()).data().at instanceof Timestamp);
check('subcollections copied', (await db.doc(`${base}/contacts/c1/history/h1`).get()).data().note === 'nested');
check('users not copied into the household', (await count(`${base}/users`)) === 0);
check('diagnostics not copied', (await count(`${base}/diagnostics`)) === 0);
check('root data left in place (copy, not move)', (await count('stockLog')) === 620 && (await db.doc('contacts/c1').get()).exists);
const hh = (await db.doc(base).get()).data();
check('household doc created', hh.name === 'Erdkeller' && hh.createdBy === 'admin' && hh.lang === 'de' && hh.migratedCounts.stockLog === 620);
const u = async (id) => (await db.doc(`users/${id}`).get()).data();
check('admin switched', (await u('admin')).householdId === hid);
check('member switched', (await u('member')).householdId === hid);
check('removed account switched too (stays locked out)', (await u('gone')).householdId === hid);
check('pending account left without household', (await u('waiting')).householdId === undefined);
check('devices untouched', (await db.doc('users/member/devices/d1').get()).data().token === 'tok');
check('every collection verified', res.collections.every((c) => c.copied >= c.count), JSON.stringify(res.collections));
check('marker done', (await db.doc('_system/householdMigration').get()).data().status === 'done');

// --- re-run is a no-op ------------------------------------------------------
const again = await migrateRootToHousehold(db, { callerUid: 'admin' });
check('second run reports already done, same household', again.alreadyDone && again.householdId === hid);
check('still one household', (await count('households')) === 1);

// --- an interrupted run resumes into the SAME household -------------------
for (const col of await db.listCollections()) await db.recursiveDelete(col);
await db.doc('users/admin').set({ name: 'Admin', role: 'admin' });
await db.doc('contacts/c1').set({ name: 'A' });
await db.doc('_system/householdMigration').set({ householdId: 'resumeMe', status: 'copying' });
await db.doc('households/resumeMe/contacts/c1').set({ name: 'A' }); // half-copied earlier
const resumed = await migrateRootToHousehold(db, { callerUid: 'admin' });
check('resumes into the remembered household id', resumed.householdId === 'resumeMe');
check('no second household created', (await count('households')) === 1);
check('resumed copy complete', (await db.doc('households/resumeMe/contacts/c1').get()).data().name === 'A');

console.log(failed ? `\n${failed} migration test(s) FAILED` : '\nall migration tests passed');
process.exit(failed ? 1 : 0);
