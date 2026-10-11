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
import { doc, getDoc, setDoc, updateDoc, collection, getDocs } from 'firebase/firestore';

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

await env.cleanup();
console.log(failed ? `\n${failed} rule test(s) FAILED` : '\nall rule tests passed');
process.exitCode = failed ? 1 : 0;
