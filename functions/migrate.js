// One-time move of the original household's data from the database root to
// /households/{hid}/… (MULTI_HOUSEHOLD.md step 2, Build 203).
//
// COPY, never move: the root data is left exactly as it is. Once every
// account carries `householdId`, firestore.rules stop letting anyone read
// or write the root copy, so it stays behind frozen as a fallback (to be
// deleted by hand weeks later, once the household copy has proven itself).
//
// Order matters, and makes an interrupted run safe to simply start again:
//   1. remember the new household id in _system/householdMigration, so a
//      re-run after a crash/timeout reuses it instead of starting a second
//      household;
//   2. copy every root collection (and any subcollections) — plain set()s,
//      so copying again just overwrites with the same data;
//   3. verify: every copied collection must hold at least as many documents
//      as its source (a count mismatch aborts BEFORE anyone is switched);
//   4. create the household document;
//   5. LAST, give every approved/removed account the householdId — that
//      single step is what switches the apps over (they reload on it).
// Nothing before step 5 changes what any app sees.
//
// Kept free of firebase-functions so tools/rules-test can run it against
// the Firestore emulator with firebase-admin alone.

// Never copied: per-person data, the households themselves, the retired
// diagnostics doc, and this migration's own bookkeeping.
const SKIP = new Set(['users', 'households', 'diagnostics', '_system']);

const MARKER = '_system/householdMigration';

async function copyCollection(db, writer, src, destPath, copied) {
  const snap = await src.get();
  copied.push({ src: src.path, dest: destPath, count: snap.size });
  for (const d of snap.docs) {
    writer.set(db.doc(`${destPath}/${d.id}`), d.data());
    const subs = await d.ref.listCollections();
    for (const sub of subs) {
      await copyCollection(db, writer, sub, `${destPath}/${d.id}/${sub.id}`, copied);
    }
  }
}

// Returns { householdId, alreadyDone, collections: [{ src, dest, count }],
// users }. Throws an Error with .code = 'count-mismatch' when verification
// fails (nobody has been switched over at that point).
async function migrateRootToHousehold(db, { callerUid, household = {}, now = new Date() }) {
  const callerSnap = await db.doc(`users/${callerUid}`).get();
  const caller = callerSnap.exists ? callerSnap.data() : null;
  if (caller && caller.householdId) {
    return { householdId: caller.householdId, alreadyDone: true, collections: [], users: 0 };
  }

  const markerRef = db.doc(MARKER);
  const marker = await markerRef.get();
  const householdId = (marker.exists && marker.data().householdId) || db.collection('households').doc().id;
  const base = `households/${householdId}`;
  await markerRef.set({
    householdId, status: 'copying', startedAt: now.toISOString(), startedBy: callerUid,
  }, { merge: true });

  // 2. Copy.
  const copied = [];
  const writer = db.bulkWriter();
  const roots = (await db.listCollections()).filter((c) => !SKIP.has(c.id));
  for (const col of roots) {
    await copyCollection(db, writer, col, `${base}/${col.id}`, copied);
  }
  await writer.close();

  // 3. Verify.
  const mismatches = [];
  for (const c of copied) {
    const destCount = (await db.collection(c.dest).count().get()).data().count;
    c.copied = destCount;
    if (destCount < c.count) mismatches.push(`${c.src}: ${c.count} → ${destCount}`);
  }
  if (mismatches.length) {
    await markerRef.set({ status: 'failed', failedAt: new Date().toISOString(), mismatches }, { merge: true });
    const err = new Error(`count mismatch: ${mismatches.join(', ')}`);
    err.code = 'count-mismatch';
    throw err;
  }

  // 4. The household document.
  const summary = Object.fromEntries(copied.filter((c) => c.src.split('/').length === 1).map((c) => [c.src, c.count]));
  await db.doc(base).set({
    name: household.name || '',
    createdAt: now.toISOString(),
    createdBy: callerUid,
    lang: household.lang || 'de',
    country: household.country || 'DE',
    timezone: household.timezone || 'Europe/Paris',
    migratedFromRoot: true,
    migratedAt: now.toISOString(),
    migratedCounts: summary,
  });

  // 5. Switch the accounts. Pending accounts stay without a household —
  // approving one (Settings → Personen) puts it into the approver's.
  const usersSnap = await db.collection('users').get();
  const batch = db.batch();
  let users = 0;
  usersSnap.docs.forEach((d) => {
    const data = d.data();
    if (data.householdId || data.role === 'pending') return;
    batch.update(d.ref, { householdId });
    users++;
  });
  await batch.commit();

  await markerRef.set({ status: 'done', doneAt: new Date().toISOString(), users, collections: summary }, { merge: true });
  return { householdId, alreadyDone: false, collections: copied, users };
}

module.exports = { migrateRootToHousehold, SKIP };
