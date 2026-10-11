// Alternate tour (HARNESS_TOUR=create, HARNESS_USER=<uid with no fixture
// doc>, e.g. u-new): a stranger's first sign-in → onboarding with no
// invitation → creates a household of their own (Build 206) → the app
// opens on a completely EMPTY household; every main screen must render
// without errors.
const c = (sel) => async (page) => page.click(sel);
const nav = (tab) => async (page) => {
  const btn = page.locator(`.nav-btn[data-tab="${tab}"]`).filter({ visible: true }).first();
  await btn.click();
};
module.exports = [
  { name: 'create: first sign-in (onboarding)', run: async (page) => { await page.waitForTimeout(300); } },
  { name: 'create: name it', run: async (page) => { await page.fill('#onboarding-name', 'Familie Neu'); } },
  { name: 'create: create household', run: async (page) => { await page.click('#onboarding-create'); await page.waitForTimeout(500); } },
  { name: 'create: overview', run: nav('dashboard') },
  { name: 'create: stock', run: nav('stock') },
  { name: 'create: checklists', run: nav('checklists') },
  { name: 'create: info', run: nav('info') },
  { name: 'create: admin', run: nav('settings') },
  { name: 'create: people', run: c('.settings-card[data-target="people"]') },
];
