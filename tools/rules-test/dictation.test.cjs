// Tests the daily dictation limit in parseDictation (Build 210,
// MULTI_HOUSEHOLD.md step 6) against the Firestore emulator. The Anthropic
// API is replaced by a fake fetch — no real AI call, no key needed.
process.env.GCLOUD_PROJECT = 'demo-erdkeller';
process.env.ANTHROPIC_API_KEY = 'test-key';
let aiCalls = 0;
global.fetch = async () => {
  aiCalls++;
  return { ok: true, json: async () => ({ content: [{ type: 'text', text: '[]' }] }), text: async () => '' };
};
const fns = require('../../functions/index.js');
const { getFirestore } = require('firebase-admin/firestore');
const db = getFirestore();

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log((ok ? ' ok  ' : 'FAIL ') + name + (extra ? ` (${extra})` : '')); };
async function code(p) { try { await p; return 'ok'; } catch (e) { return e.code || e.message; } }
const dictate = (uid, lang = 'de') => fns.parseDictation.run({ auth: { uid, token: {} }, data: { transcript: 'zwei Dosen Bohnen', lang } });
const today = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

(async () => {
  for (const col of await db.listCollections()) await db.recursiveDelete(col);
  await db.doc('households/h1').set({ name: 'A', timezone: 'Europe/Paris', lang: 'de' });
  await db.doc('households/h2').set({ name: 'B', timezone: 'America/Chicago', lang: 'en', dictationLimit: 2 });
  await db.doc('users/a').set({ role: 'admin', householdId: 'h1' });
  await db.doc('users/b').set({ role: 'member', householdId: 'h2' });

  check('a dictation goes through', (await code(dictate('a'))) === 'ok' && aiCalls === 1);
  const usage = (await db.doc(`households/h1/usage/dictation-${today('Europe/Paris')}`).get()).data();
  check('and is counted for the household, on its own calendar day', usage && usage.count === 1);

  await db.doc(`households/h1/usage/dictation-${today('Europe/Paris')}`).set({ count: 20 });
  const before = aiCalls;
  let msg = '';
  const c = await (async () => { try { await dictate('a'); return 'ok'; } catch (e) { msg = e.message; return e.code; } })();
  check('the 21st of the day is refused (default limit 20)', c === 'resource-exhausted');
  check('…without calling the AI', aiCalls === before);
  check('…with a German message naming the limit', /Tageslimit von 20/.test(msg), msg);

  check('a household\'s own limit applies (2)', (await code(dictate('b', 'en'))) === 'ok' && (await code(dictate('b', 'en'))) === 'ok' && (await code(dictate('b', 'en'))) === 'resource-exhausted');
  check('…counted in that household only', (await db.doc(`households/h1/usage/dictation-${today('Europe/Paris')}`).get()).data().count === 20);

  console.log(failed ? `\n${failed} dictation test(s) FAILED` : '\nall dictation tests passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
