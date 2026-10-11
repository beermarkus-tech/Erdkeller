// Alternate tour (HARNESS_TOUR=invite, with HARNESS_HOUSEHOLD=h1): the admin
// invites someone in Admin → Personen (Build 206) — a bad address is
// refused, a good one (mixed case) is stored lower-case and listed.
const nav = (tab) => async (page) => {
  await page.locator(`.nav-btn[data-tab="${tab}"]`).filter({ visible: true }).first().click();
};
module.exports = [
  { name: 'invite: open people', run: async (page) => { await nav('settings')(page); await page.click('.settings-card[data-target="people"]'); } },
  { name: 'invite: bad address', run: async (page) => { await page.fill('#invite-email', 'nope'); await page.click('#invite-btn'); } },
  { name: 'invite: good address', run: async (page) => {
    await page.fill('#invite-email', 'Opa@Example.com');
    await page.selectOption('#invite-role', 'admin');
    await page.click('#invite-btn');
    await page.waitForTimeout(300);
  } },
];
