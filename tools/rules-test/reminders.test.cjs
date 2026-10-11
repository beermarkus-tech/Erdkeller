// Tests the reminder scheduler in functions/index.js (Build 205) against
// the Firestore emulator: recipients are household members (uids, plus old
// slugs until converted), each household runs on its own timezone, removed
// members and other households get nothing, "remind again after N days" and
// "done for this period" hold. Push sending is replaced by a fake that
// records what would be sent.
//
//   npm test   (or: NODE_PATH=node_modules npx firebase emulators:exec --only firestore --project demo-erdkeller "node reminders.test.cjs")
process.env.GCLOUD_PROJECT = 'demo-erdkeller';
const { Messaging } = require('firebase-admin/messaging');
const sent = [];
Messaging.prototype.sendEachForMulticast = async ({ tokens, data }) => { tokens.forEach((t) => sent.push({ t, title: data.title, body: data.body })); return { responses: tokens.map(() => ({ success: true })) }; };
const fns = require('../../functions/index.js');
const { getFirestore } = require('firebase-admin/firestore');
const db = getFirestore();
const hourIn = (tz) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date())) % 24;
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log((ok ? ' ok  ' : 'FAIL ') + name + (extra ? ` (${extra})` : '')); };
(async () => {
  for (const col of await db.listCollections()) await db.recursiveDelete(col);
  const NY = 'America/New_York';
  await db.doc('households/hA').set({ name: 'A', timezone: NY, lang: 'de' });
  await db.doc('households/hB').set({ name: 'B', timezone: 'Asia/Tokyo', lang: 'en' });
  const user = async (uid, d, tok) => { await db.doc(`users/${uid}`).set(d); if (tok) await db.doc(`users/${uid}/devices/d`).set({ token: tok }); };
  await user('a', { name: 'Anna', role: 'admin', householdId: 'hA', lang: 'en', recipientSlug: 'markus' }, 'tokA');
  await user('m', { name: 'Max', role: 'member', householdId: 'hA', lang: 'de' }, 'tokM');
  await user('r', { name: 'Gone', role: 'member', householdId: 'hA', removed: true }, 'tokR');
  await user('x', { name: 'Xena', role: 'admin', householdId: 'hB', recipientSlug: 'markus' }, 'tokX');
  for (const [h, tz] of [['hA', NY], ['hB', NY]]) await db.doc(`households/${h}/config/notifications`).set({ enabled: true, checklists: { hour: hourIn(tz) } });
  await db.doc('households/hA/checklists/l1').set({ name: 'Keller', recipients: ['markus', 'r'] });
  await db.doc('households/hA/checklists/l2').set({ name: 'Auto', recipients: ['m'] });
  await db.doc('households/hA/checklistItems/i1').set({ listId: 'l1', text: 'a', frequency: 'monthly', lastCompletedAt: null });
  await db.doc('households/hA/checklistItems/i2').set({ listId: 'l2', text: 'b', frequency: 'monthly', lastCompletedAt: null });
  await db.doc('households/hB/checklists/l1').set({ name: 'Garage', recipients: ['x'] });
  await db.doc('households/hB/checklistItems/i1').set({ listId: 'l1', text: 'c', frequency: 'monthly', lastCompletedAt: null });

  await fns.sendReminders.run({});
  const by = Object.fromEntries(sent.map((s) => [s.t, s]));
  check('old slug recipient gets it, in English', by.tokA && by.tokA.body === '1 task due: Keller (1)');
  check('uid recipient gets it, in German', by.tokM && by.tokM.body === '1 Aufgabe fällig: Auto (1)');
  check('removed member gets nothing', !by.tokR);
  check('other household on its own (Tokyo) clock is not sent', !by.tokX);
  const st = (await db.doc('households/hA/config/notificationState').get()).data(); 
  check('send state written as nested fields', !!(st && st.checklists && st.checklists.monthly.lastSentAt));
  sent.length = 0;
  await fns.sendReminders.run({});
  check('no repeat within repeatDays', sent.length === 0);
  // legacy literal dismissal key in B's state must be honored: make B due now
  await db.doc('households/hB').update({ timezone: NY });
  const occ = st.checklists.monthly.occurrence;
  await db.doc('households/hB/config/notificationState').set({ ['checklists.monthly.dismissedOccurrence']: occ });
  await fns.sendReminders.run({});
  check('old-style dismissal still honoured', !sent.some((x) => x.t === 'tokX'));
  await db.doc('households/hB/config/notificationState').delete();
  await fns.sendReminders.run({});
  check('without it, that household is sent', sent.some((x) => x.t === 'tokX'));

  const p = await fns.previewReminders.run({ auth: { uid: 'a' }, data: { lang: 'en' } });
  check('preview uses the household timezone', p.timezone === NY && p.currentHour === hourIn(NY));
  check('preview lists members by name', p.frequencies.monthly.recipients.map((r) => `${r.name}:${r.total}`).join(', ') === 'Anna:1, Max:1');

  await db.doc('households/hA').update({ timezone: 'Mars/Olympus' });
  const p2 = await fns.previewReminders.run({ auth: { uid: 'a' }, data: {} });
  check('invalid timezone falls back to Europe/Paris', p2.timezone === 'Europe/Paris');
  console.log(failed ? `\n${failed} reminder test(s) FAILED` : '\nall reminder tests passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
