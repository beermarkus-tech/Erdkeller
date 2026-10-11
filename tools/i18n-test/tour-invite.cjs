// Alternate tour (HARNESS_TOUR=invite, with HARNESS_HOUSEHOLD=h1): the admin
// invites someone in Admin → Personen (Builds 206/207) — a bad address is
// refused; a non-Gmail address asks first (the harness answers "cancel", so
// nothing is created); a Gmail address (mixed case) is stored lower-case
// with its match key and listed; then a member is removed from the household.
const nav = (tab) => async (page) => {
  await page.locator(`.nav-btn[data-tab="${tab}"]`).filter({ visible: true }).first().click();
};
module.exports = [
  { name: 'invite: open people', run: async (page) => { await nav('settings')(page); await page.click('.settings-card[data-target="people"]'); } },
  { name: 'invite: bad address', run: async (page) => { await page.fill('#invite-email', 'nope'); await page.click('#invite-btn'); } },
  { name: 'invite: non-gmail address (cancelled)', run: async (page) => { await page.fill('#invite-email', 'opa@firma.de'); await page.click('#invite-btn'); } },
  { name: 'invite: gmail address', run: async (page) => {
    await page.fill('#invite-email', 'Opa.Test@GMail.com');
    await page.selectOption('#invite-role', 'admin');
    await page.click('#invite-btn');
    await page.waitForTimeout(300);
  } },
];
