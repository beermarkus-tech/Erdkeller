// Alternate tour (HARNESS_TOUR=signup, with HARNESS_USER=<a uid that has no
// fixture doc>): a stranger's first sign-in → waiting screen → an admin
// approves them (simulated by writing role 'member' to their doc) → app.
const asAdmin = (uid, role) => async (page) => page.evaluate(async ({ uid, role }) => {
  const fb = await import('https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js');
  await fb.updateDoc(fb.doc({}, 'users', uid), { role });
}, { uid, role });
const uid = process.env.HARNESS_USER || 'u-new';
module.exports = [
  { name: 'signup: first sign-in', run: async () => {} },
  { name: 'signup: switch language while waiting', run: async (page) => page.click('#auth-gate .lang-btn') },
  { name: 'signup: approved by an admin', run: asAdmin(uid, 'member') },
];
