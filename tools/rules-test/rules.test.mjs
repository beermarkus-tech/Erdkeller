// Firestore security-rules tests (Build 201). Runs firestore.rules in the
// local Firestore emulator — no real project, no real data.
//
//   cd tools/rules-test && npm install && npx firebase emulators:exec --only firestore --project demo-erdkeller "node rules.test.mjs"
//
// (Needs Java for the emulator. "demo-" project ids never touch a real
// Firebase project.)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = await initializeTestEnvironment({
  projectId: 'demo-erdkeller',
  firestore: { rules: fs.readFileSync(path.join(here, '../../firestore.rules'), 'utf8') },
});

// Seed with rules bypassed.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users/admin'), { name: 'Admin', role: 'admin' });
  await setDoc(doc(db, 'users/member'), { name: 'Member', role: 'member' });
  await setDoc(doc(db, 'users/legacy'), { name: 'Pre-180 member', role: 'member' }); // no `removed` field
  await setDoc(doc(db, 'users/pending'), { name: 'Pending', role: 'pending' });
  await setDoc(doc(db, 'users/removed'), { name: 'Removed', role: 'member', removed: true });
  await setDoc(doc(db, 'contacts/c1'), { name: 'Dr. Weber' });
  await setDoc(doc(db, 'stockItems/s1'), { quantity: 1 });
  await setDoc(doc(db, 'config/taxonomy'), { types: [] });
  // Build 203 — two households under /households/{hid}.
  await setDoc(doc(db, 'users/hadmin'), { name: 'H1 admin', role: 'admin', householdId: 'h1' });
  await setDoc(doc(db, 'users/hmember'), { name: 'H1 member', role: 'member', householdId: 'h1' });
  await setDoc(doc(db, 'users/hremoved'), { name: 'H1 removed', role: 'member', householdId: 'h1', removed: true });
  await setDoc(doc(db, 'users/oadmin'), { name: 'H2 admin', role: 'admin', householdId: 'h2' });
  await setDoc(doc(db, 'users/hpending'), { name: 'Waiting', role: 'pending' });
  await setDoc(doc(db, 'users/hmember/devices/d1'), { token: 't' });
  await setDoc(doc(db, 'households/h1'), { name: 'One', createdBy: 'hadmin', lang: 'de' });
  await setDoc(doc(db, 'households/h2'), { name: 'Two', createdBy: 'oadmin', lang: 'en' });
  for (const h of ['h1', 'h2']) {
    await setDoc(doc(db, `households/${h}/contacts/c1`), { name: 'Contact ' + h });
    await setDoc(doc(db, `households/${h}/stockItems/s1`), { quantity: 1 });
    await setDoc(doc(db, `households/${h}/checklistItems/i1`), { text: 'Task', lastCompletedAt: null });
  }
});

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = env.unauthenticatedContext().firestore();
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(' ok  ' + name); } catch (err) { failed++; console.log('FAIL ' + name + '\n     ' + err.message.split('\n')[0]); }
}

// --- the gap this build closes ----------------------------------------------
await check('stranger cannot self-provision as member', () => assertFails(setDoc(doc(as('stranger'), 'users/stranger'), { role: 'member' })));
await check('stranger cannot self-provision as admin', () => assertFails(setDoc(doc(as('stranger'), 'users/stranger'), { role: 'admin' })));
await check('stranger can self-provision as pending', () => assertSucceeds(setDoc(doc(as('stranger2'), 'users/stranger2'), { role: 'pending', name: 'X' })));
await check('nobody can create a doc for someone else', () => assertFails(setDoc(doc(as('stranger3'), 'users/other'), { role: 'pending' })));

// --- pending: no access until approved --------------------------------------
await check('pending reads own doc', () => assertSucceeds(getDoc(doc(as('pending'), 'users/pending'))));
await check('pending cannot read contacts', () => assertFails(getDoc(doc(as('pending'), 'contacts/c1'))));
await check('pending cannot read stock', () => assertFails(getDocs(collection(as('pending'), 'stockItems'))));
await check('pending cannot read config', () => assertFails(getDoc(doc(as('pending'), 'config/taxonomy'))));
await check('pending cannot read other users', () => assertFails(getDoc(doc(as('pending'), 'users/admin'))));
await check('pending cannot write stock', () => assertFails(setDoc(doc(as('pending'), 'stockItems/s2'), { quantity: 1 })));
await check('pending can update own name/lang', () => assertSucceeds(updateDoc(doc(as('pending'), 'users/pending'), { name: 'P2', lang: 'en' })));
await check('pending cannot approve itself', () => assertFails(updateDoc(doc(as('pending'), 'users/pending'), { role: 'member' })));
await check('pending cannot make itself admin', () => assertFails(updateDoc(doc(as('pending'), 'users/pending'), { role: 'admin' })));

// --- removed: stays locked out ----------------------------------------------
await check('removed reads own doc', () => assertSucceeds(getDoc(doc(as('removed'), 'users/removed'))));
await check('removed cannot read contacts', () => assertFails(getDoc(doc(as('removed'), 'contacts/c1'))));
await check('removed cannot un-remove itself', () => assertFails(updateDoc(doc(as('removed'), 'users/removed'), { removed: false })));
await check('removed cannot update own doc at all', () => assertFails(updateDoc(doc(as('removed'), 'users/removed'), { name: 'Y' })));

// --- members and admins: unchanged ------------------------------------------
await check('member reads contacts', () => assertSucceeds(getDoc(doc(as('member'), 'contacts/c1'))));
await check('legacy member (no removed field) reads contacts', () => assertSucceeds(getDoc(doc(as('legacy'), 'contacts/c1'))));
await check('member writes stock', () => assertSucceeds(setDoc(doc(as('member'), 'stockItems/s3'), { quantity: 2 })));
await check('member updates own lang', () => assertSucceeds(updateDoc(doc(as('member'), 'users/member'), { lang: 'en' })));
await check('member cannot promote itself', () => assertFails(updateDoc(doc(as('member'), 'users/member'), { role: 'admin' })));
await check('member cannot remove itself via removed flag', () => assertFails(updateDoc(doc(as('member'), 'users/member'), { removed: true })));
await check('member cannot approve a pending user', () => assertFails(updateDoc(doc(as('member'), 'users/pending'), { role: 'member' })));
await check('member reads the roster', () => assertSucceeds(getDocs(collection(as('member'), 'users'))));
await check('admin approves a pending user', () => assertSucceeds(updateDoc(doc(as('admin'), 'users/pending'), { role: 'member' })));
await check('approved user now reads contacts', () => assertSucceeds(getDoc(doc(as('pending'), 'contacts/c1'))));
await check('admin rejects (removes) a pending user', () => assertSucceeds(updateDoc(doc(as('admin'), 'users/stranger2'), { removed: true })));

// --- diagnostics closed -------------------------------------------------------
await check('anonymous cannot write diagnostics', () => assertFails(setDoc(doc(anon, 'diagnostics/x'), { a: 1 })));
await check('anonymous cannot read diagnostics', () => assertFails(getDoc(doc(anon, 'diagnostics/x'))));
await check('anonymous cannot read contacts', () => assertFails(getDoc(doc(anon, 'contacts/c1'))));

// --- Build 203: households ----------------------------------------------------
await check('household member reads own household data', () => assertSucceeds(getDoc(doc(as('hmember'), 'households/h1/contacts/c1'))));
await check('household member reads own household doc', () => assertSucceeds(getDoc(doc(as('hmember'), 'households/h1'))));
await check('household member cannot read another household', () => assertFails(getDoc(doc(as('hmember'), 'households/h2/contacts/c1'))));
await check('household member cannot read another household doc', () => assertFails(getDoc(doc(as('hmember'), 'households/h2'))));
await check('household admin cannot read another household', () => assertFails(getDocs(collection(as('oadmin'), 'households/h1/stockItems'))));
await check('household admin cannot write another household', () => assertFails(setDoc(doc(as('oadmin'), 'households/h1/contacts/x'), { name: 'X' })));
await check('migrated member cannot read the old root data', () => assertFails(getDoc(doc(as('hmember'), 'contacts/c1'))));
await check('migrated member cannot write the old root data', () => assertFails(setDoc(doc(as('hmember'), 'stockItems/s9'), { quantity: 1 })));
await check('legacy member cannot read household data', () => assertFails(getDoc(doc(as('member'), 'households/h1/contacts/c1'))));
await check('pending cannot read household data', () => assertFails(getDoc(doc(as('hpending'), 'households/h1/contacts/c1'))));
await check('removed household member cannot read household data', () => assertFails(getDoc(doc(as('hremoved'), 'households/h1/contacts/c1'))));
await check('household member writes stock', () => assertSucceeds(setDoc(doc(as('hmember'), 'households/h1/stockItems/s2'), { quantity: 2 })));
await check('household member cannot write contacts', () => assertFails(setDoc(doc(as('hmember'), 'households/h1/contacts/c2'), { name: 'X' })));
await check('household admin writes contacts', () => assertSucceeds(setDoc(doc(as('hadmin'), 'households/h1/contacts/c2'), { name: 'X' })));
await check('household member ticks a checklist item', () => assertSucceeds(updateDoc(doc(as('hmember'), 'households/h1/checklistItems/i1'), { lastCompletedAt: '2026-01-01' })));
await check('household member cannot rename a checklist item', () => assertFails(updateDoc(doc(as('hmember'), 'households/h1/checklistItems/i1'), { text: 'Y' })));
await check('nobody creates a household from the client', () => assertFails(setDoc(doc(as('hadmin'), 'households/h3'), { name: 'Three' })));
await check('household admin renames own household', () => assertSucceeds(updateDoc(doc(as('hadmin'), 'households/h1'), { name: 'Uno' })));
await check('household admin sets the household timezone', () => assertSucceeds(updateDoc(doc(as('hadmin'), 'households/h1'), { timezone: 'America/New_York' })));
await check('household member cannot set the timezone', () => assertFails(updateDoc(doc(as('hmember'), 'households/h1'), { timezone: 'Asia/Tokyo' })));
await check('household admin cannot change createdBy', () => assertFails(updateDoc(doc(as('hadmin'), 'households/h1'), { createdBy: 'x' })));
await check('household member cannot rename the household', () => assertFails(updateDoc(doc(as('hmember'), 'households/h1'), { name: 'Mine' })));
await check('household member lists own household roster', () => assertSucceeds(getDocs(query(collection(as('hmember'), 'users'), where('householdId', '==', 'h1')))));
await check('household member cannot list the whole users collection', () => assertFails(getDocs(collection(as('hmember'), 'users'))));
await check('household member cannot read another household\'s person', () => assertFails(getDoc(doc(as('hmember'), 'users/oadmin'))));
await check('household member cannot list another household roster', () => assertFails(getDocs(query(collection(as('hmember'), 'users'), where('householdId', '==', 'h2')))));
await check('household admin lists pending accounts', () => assertSucceeds(getDocs(query(collection(as('hadmin'), 'users'), where('role', '==', 'pending')))));
await check('household member cannot list pending accounts', () => assertFails(getDocs(query(collection(as('hmember'), 'users'), where('role', '==', 'pending')))));
await check('pending cannot self-provision with a household', () => assertFails(setDoc(doc(as('newbie'), 'users/newbie'), { role: 'pending', householdId: 'h1' })));
await check('member cannot change own household', () => assertFails(updateDoc(doc(as('hmember'), 'users/hmember'), { householdId: 'h2' })));
await check('member still updates own lang', () => assertSucceeds(updateDoc(doc(as('hmember'), 'users/hmember'), { lang: 'en' })));
await check('admin cannot strip a member out of the household', () => assertFails(updateDoc(doc(as('hadmin'), 'users/hmember'), { householdId: null })));
await check('admin cannot move a member to another household', () => assertFails(updateDoc(doc(as('hadmin'), 'users/hmember'), { householdId: 'h2' })));
await check('other household admin cannot touch a member', () => assertFails(updateDoc(doc(as('oadmin'), 'users/hmember'), { role: 'admin' })));
await check('admin cannot approve a pending account into another household', () => assertFails(updateDoc(doc(as('hadmin'), 'users/hpending'), { role: 'member', householdId: 'h2' })));
await check('admin approves a pending account into own household', () => assertSucceeds(updateDoc(doc(as('hadmin'), 'users/hpending'), { role: 'member', householdId: 'h1' })));
await check('newly approved account reads the household', () => assertSucceeds(getDoc(doc(as('hpending'), 'households/h1/contacts/c1'))));
await check('other admin no longer sees the approved account', () => assertFails(getDoc(doc(as('oadmin'), 'users/hpending'))));
await check('household admin reads a member\'s devices', () => assertSucceeds(getDocs(collection(as('hadmin'), 'users/hmember/devices'))));
await check('other household admin cannot read those devices', () => assertFails(getDocs(collection(as('oadmin'), 'users/hmember/devices'))));
await check('household member manages own devices', () => assertSucceeds(setDoc(doc(as('hmember'), 'users/hmember/devices/d2'), { token: 'u' })));
await check('household admin cannot read legacy root config', () => assertFails(getDoc(doc(as('hadmin'), 'config/taxonomy'))));

await env.cleanup();
console.log(failed ? `\n${failed} rule test(s) FAILED` : '\nall rule tests passed');
process.exitCode = failed ? 1 : 0;
