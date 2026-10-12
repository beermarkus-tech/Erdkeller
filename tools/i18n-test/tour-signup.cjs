// Alternate tour (HARNESS_TOUR=signup, HARNESS_USER=u-pending): an account
// without a household signs in → onboarding with one invitation (Build
// 206) → language switch → accepts → the app opens in that household.
module.exports = [
  { name: 'signup: first sign-in (onboarding)', run: async (page) => { await page.waitForTimeout(300); } },
  { name: 'signup: switch language on onboarding', run: async (page) => page.click('#auth-gate .lang-btn') },
  { name: 'signup: join without consent (refused)', run: async (page) => { await page.click('#onboarding-invites .onboarding-primary'); } },
  { name: 'signup: tick consent', run: async (page) => { await page.check('#onboarding-consent'); } },
  { name: 'signup: accept the invitation', run: async (page) => { await page.click('#onboarding-invites .onboarding-primary'); await page.waitForTimeout(500); } },
];
