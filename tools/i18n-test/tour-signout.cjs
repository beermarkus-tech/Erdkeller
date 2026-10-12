// Alternate tour (HARNESS_TOUR=signout): signing out after data was shown
// reloads the page (Build 213), so nothing of one account's household can
// stay on screen for the next account on the same device.
module.exports = [
  { name: 'signout: app with data', run: async () => {} },
  { name: 'signout: sign out reloads the page', run: async (page) => {
    await page.evaluate(() => { window.__beforeReload = true; });
    await page.locator('#account-toggle-topbar, #account-toggle-sidebar').filter({ visible: true }).first().click();
    await page.locator('#signout-btn-topbar, #signout-btn-sidebar').filter({ visible: true }).first().click();
    await page.waitForFunction(() => !window.__beforeReload, null, { timeout: 5000 });
  } },
];
