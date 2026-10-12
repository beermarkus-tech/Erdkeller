// Alternate tour (HARNESS_TOUR=operator HARNESS_PAGE=operator.html): the
// operator overview page (Build 212) renders the households it is given.
module.exports = [
  { name: 'operator: overview', run: async (page) => { await page.waitForTimeout(300); } },
];
