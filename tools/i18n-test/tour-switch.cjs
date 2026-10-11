// Alternate tour (HARNESS_TOUR=switch): the household migration finishing
// while the app is open — the server writes householdId onto the signed-in
// account; the app must store it and reload ONCE into the household (here
// the fixtures stay at the root, so the household then reads as empty).
module.exports = [
  { name: 'switch: before', run: async () => {} },
  { name: 'switch: householdId arrives', run: async (page) => {
    await page.evaluate(async () => {
      window.__beforeReload = true;
      sessionStorage.setItem('__persist__', JSON.stringify({ 'users/u-admin': { householdId: 'hNew' } }));
      const fb = await import('https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js');
      await fb.updateDoc(fb.doc({}, 'users', 'u-admin'), { householdId: 'hNew' });
    });
    await page.waitForFunction(() => !window.__beforeReload, null, { timeout: 5000 });
    await page.waitForTimeout(1500);
    const cached = await page.evaluate(() => JSON.parse(localStorage.getItem('erdkeller-last-user')).householdId);
    if (cached !== 'hNew') throw new Error('household not cached: ' + cached);
  } },
  { name: 'switch: settled (no reload loop)', run: async (page) => {
    await page.evaluate(() => { window.__stillHere = true; });
    await page.waitForTimeout(2500);
    if (!(await page.evaluate(() => window.__stillHere))) throw new Error('reloaded again');
  } },
];
