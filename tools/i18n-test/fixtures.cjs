// Sample household data for the i18n regression harness. Shapes follow
// SPEC.md Section 4/5/7; the content is deliberately German (it's user
// data, which stays untranslated) and covers enough variety that every
// screen has something to render: food/water/other types, all planning
// modes, batches past/near/far from best-before, open + done checklist
// items, emergency + normal contacts, notes, recipes with tags.
const iso = (s) => new Date(s).toISOString();

const taxonomy = {
  types: [
    {
      id: 't-food', name: 'Lebensmittel', sym: '🍞', typeClass: 'food',
      categories: [
        {
          id: 'c-grain', name: 'Getreide & Hülsenfrüchte', sym: '🌾', planningMode: 'calorie', kcalPerKg: 3500, macroType: 'kohlenhydrat',
          subcategories: [
            { id: 's-pasta', name: 'Nudeln', sym: '🍝' },
            { id: 's-beans', name: 'Hülsenfrüchte getrocknet', sym: '🫘' },
          ],
        },
        {
          id: 'c-fat', name: 'Fette, Öle, Nüsse', sym: '🫒', planningMode: 'calorie', kcalPerKg: 8000, macroType: 'fett',
          subcategories: [{ id: 's-oil', name: 'Öl', sym: '🫒' }],
        },
        {
          id: 'c-meat', name: 'Fisch, Fleisch, Eier', sym: '🥩', planningMode: 'calorie', kcalPerKg: 2000, macroType: 'protein',
          subcategories: [{ id: 's-fish', name: 'Fischkonserven', sym: '🐟' }],
        },
        {
          id: 'c-veg', name: 'Gemüse', sym: '🍆', planningMode: 'diversity', diversityFloorGramsPerPersonDay: 100,
          subcategories: [
            { id: 's-tom', name: 'Tomaten', sym: '🍅' },
            { id: 's-veg2', name: 'Mischgemüse', sym: '🥕' },
          ],
        },
        {
          id: 'c-sweet', name: 'Süßes', sym: '🍫', planningMode: 'off',
          subcategories: [{ id: 's-choc', name: 'Schokolade', sym: '🍫' }],
        },
      ],
    },
    {
      id: 't-water', name: 'Wasser', sym: '💧', typeClass: 'water',
      categories: [{ id: 'c-water', name: 'Trinkwasser', sym: '💧', subcategories: [{ id: 's-water', name: 'Trinkwasser', sym: '💧' }] }],
    },
    {
      id: 't-gear', name: 'Ausrüstung', sym: '🔦', typeClass: 'other',
      categories: [{ id: 'c-light', name: 'Licht & Energie', sym: '🔋', subcategories: [{ id: 's-batt', name: 'Batterien', sym: '🔋' }] }],
    },
  ],
};

const products = {
  'products/p-spag': { name: 'Spaghetti', subcategoryId: 's-pasta', unitType: 'kg', createdAt: iso('2026-01-05') },
  'products/p-lins': { name: 'Linsen', subcategoryId: 's-beans', unitType: 'kg', createdAt: iso('2026-01-05') },
  'products/p-oil': { name: 'Rapsöl', subcategoryId: 's-oil', unitType: 'l', createdAt: iso('2026-01-05') },
  'products/p-tuna': { name: 'Thunfisch', subcategoryId: 's-fish', unitType: 'kg', createdAt: iso('2026-01-05') },
  'products/p-tom': { name: 'Gehackte Tomaten', subcategoryId: 's-tom', unitType: 'kg', createdAt: iso('2026-01-05') },
  'products/p-mix': { name: 'Erbsen & Möhren', subcategoryId: 's-veg2', unitType: 'kg', createdAt: iso('2026-01-05') },
  'products/p-choc': { name: 'Zartbitter', subcategoryId: 's-choc', unitType: 'stueck', createdAt: iso('2026-01-05') },
  'products/p-water': { name: 'Mineralwasser', subcategoryId: 's-water', unitType: 'l', createdAt: iso('2026-01-05') },
  'products/p-aa': { name: 'AA-Batterien', subcategoryId: 's-batt', unitType: 'Stück', createdAt: iso('2026-01-05') },
  'products/p-empty': { name: 'Reis', subcategoryId: 's-pasta', unitType: 'kg', createdAt: iso('2026-01-05') },
};

function batch(id, productId, sub, quantity, content, bestBefore, storage, extra = {}) {
  const sc = taxonomy.types.flatMap((t) => t.categories.flatMap((c) => c.subcategories.map((s) => ({ t, c, s })))).find((x) => x.s.id === sub);
  return [`stockItems/${id}`, {
    type: sc.t.name, category: sc.c.name, subcategory: sc.s.name, subcategorySymbol: sc.s.sym,
    productId, details: extra.details || '', quantity, content, bestBefore,
    yearColor: bestBefore ? bestBefore.slice(3) : 'none', storage, createdAt: iso('2026-03-01'), updatedAt: iso('2026-03-01'),
  }];
}
const stockItems = Object.fromEntries([
  batch('b1', 'p-spag', 's-pasta', 6, '500g', '03/2027', 'Keller Regal 1'),
  batch('b2', 'p-spag', 's-pasta', 2, '1000g', '09/2026', 'Keller Regal 1'),
  batch('b3', 'p-lins', 's-beans', 4, '500g', '11/2026', 'Keller Regal 2', { details: 'Tüte' }),
  batch('b4', 'p-oil', 's-oil', 3, '1000ml', '05/2027', 'Küche'),
  batch('b5', 'p-tuna', 's-fish', 10, '185g', '12/2028', 'Keller Regal 2', { details: 'Dose' }),
  batch('b6', 'p-tom', 's-tom', 8, '400g', '10/2026', 'Keller Regal 1', { details: 'Dose' }),
  batch('b7', 'p-choc', 's-choc', 5, 'Tafel', '02/2027', 'Küche'),
  batch('b8', 'p-water', 's-water', 24, '1500ml', '06/2028', 'Garage'),
  batch('b9', 'p-aa', 's-batt', 16, '', '', 'Garage'),
  batch('b10', 'p-mix', 's-veg2', 3, '400g', '01/2027', 'Keller Regal 1', { details: 'Glas' }),
]);

const stockLog = {
  'stockLog/l1': { action: 'in', productName: 'Spaghetti', quantity: 6, details: '', content: '500g', bestBefore: '03/2027', createdAt: iso('2026-09-20T10:00:00') },
  'stockLog/l2': { action: 'out', productName: 'Linsen', quantity: 1, details: 'Tüte', content: '500g', bestBefore: '11/2026', createdAt: iso('2026-10-01T18:30:00') },
};

const checklists = {
  'checklists/cl1': { name: 'Keller', recipients: ['markus', 'julia'], createdAt: iso('2026-01-01'), updatedAt: iso('2026-01-01') },
  'checklists/cl2': { name: 'Fahrzeug', recipients: ['markus'], createdAt: iso('2026-01-02'), updatedAt: iso('2026-01-02') },
  'checklistItems/i1': { listId: 'cl1', text: 'Wassertank prüfen', frequency: 'monthly', lastCompletedAt: null, createdAt: iso('2026-01-01') },
  'checklistItems/i2': { listId: 'cl1', text: 'MHD-Liste ausdrucken', frequency: 'quarterly', lastCompletedAt: iso('2026-10-02'), createdAt: iso('2026-01-01') },
  'checklistItems/i3': { listId: 'cl1', text: 'Kellerlüftung', frequency: 'weekly', lastCompletedAt: null, createdAt: iso('2026-01-01') },
  'checklistItems/i4': { listId: 'cl2', text: 'Reifendruck', frequency: 'halfYearly', lastCompletedAt: null, createdAt: iso('2026-01-01') },
  'checklistItems/i5': { listId: 'cl2', text: 'Verbandskasten Ablaufdatum', frequency: 'yearly', lastCompletedAt: null, createdAt: iso('2026-01-01') },
};

const config = {
  'config/taxonomy': taxonomy,
  'config/storageLocations': { locations: ['Keller Regal 1', 'Keller Regal 2', 'Küche', 'Garage'] },
  'config/yearColorMap': { 2026: 'red', 2027: 'green', 2028: 'blue', none: 'white' },
  'config/targets': {
    categories: { 'c-sweet': { mode: 'flat', amount: 2, unit: 'kg' } },
    subcategories: {},
    products: { 'p-choc': { mode: 'flat', amount: 10, unit: 'stueck' }, 'p-aa': { mode: 'flat', amount: 24, unit: 'stueck' }, 'p-empty': { mode: 'flat', amount: 5, unit: 'kg' } },
    macroSplits: {}, subSplits: {},
  },
  'config/household': { members: [{ id: 'm1', name: 'Markus', kcalPerDay: 2500 }, { id: 'm2', name: 'Julia', kcalPerDay: 2100 }, { id: 'm3', name: 'Sophia', kcalPerDay: 1900 }] },
  'config/planning': { autonomyDays: 42, macroSplit: { kohlenhydrat: 50, protein: 20, fett: 30 }, waterLitersPerPersonDay: 3 },
  'config/crisisTypes': {
    types: [
      { id: 'k1', name: 'Stromausfall', sym: '⚡', steps: [{ id: 'k1s1', text: 'Taschenlampen holen' }, { id: 'k1s2', text: 'Kühlschrank geschlossen halten' }] },
      { id: 'k2', name: 'Hochwasser', sym: '🌊', steps: [{ id: 'k2s1', text: 'Keller räumen' }] },
    ],
  },
  'config/notifications': { enabled: true },
  'config/notificationState': { checklists: {} },
};

const info = {
  'contacts/ct1': { name: 'Notruf', role: 'Feuerwehr & Rettung', phone: '112', address: '', notes: '', isEmergency: true },
  'contacts/ct2': { name: 'Dr. Weber', role: 'Hausarzt', phone: '+49 89 123456', address: 'Hauptstraße 5, München', notes: 'Mo–Fr 8–12 Uhr', isEmergency: false },
  'notes/n1': { title: 'Wassertank reinigen', body: '<h2>Ablauf</h2><ul><li>Wasser ablassen</li><li>Mit Essig spülen</li></ul>', photos: [], createdAt: iso('2026-02-01'), updatedAt: iso('2026-02-01') },
  'notes/n2': { title: 'Notstrom', body: '<p>Generator steht in der Garage.</p>', photos: [], createdAt: iso('2026-03-01'), updatedAt: iso('2026-04-01') },
  'recipes/r1': { title: 'Linseneintopf', body: '<p>Alles 40 Minuten köcheln.</p>', photos: [], tags: ['Eintopf', 'Vegetarisch'], ingredients: ['500g Linsen', '1 Dose Gehackte Tomaten', 'Salz'], createdAt: iso('2026-02-01') },
  'recipes/r2': { title: 'Thunfisch-Pasta', body: '<p>Nudeln kochen, Thunfisch unterheben.</p>', photos: [], tags: ['Schnell'], ingredients: ['Spaghetti', 'Thunfisch', 'Rapsöl'], createdAt: iso('2026-02-03') },
};

const users = {
  'users/u-admin': { name: 'Test Admin', photoURL: '', role: 'admin', recipientSlug: 'markus', createdAt: iso('2026-01-01') },
  'users/u-member': { name: 'Julia', photoURL: '', role: 'member', recipientSlug: 'julia', createdAt: iso('2026-01-03') },
  'users/u-pending': { name: 'Neuer Tester', photoURL: '', role: 'pending', recipientSlug: null, createdAt: iso('2026-10-09') },
  // Build 206 — an open invitation from the admin (household mode shows it
  // in Admin → Personen; invitations live at the root, not in a household).
  'invites/inv1': { householdId: 'h1', email: 'oma@example.com', role: 'member', status: 'open', createdBy: 'u-admin', createdAt: iso('2026-10-08T10:00:00') },
  'users/u-gone': { name: 'Alter Account', photoURL: '', role: 'member', recipientSlug: null, removed: true, removedAt: iso('2026-05-01'), createdAt: iso('2026-01-04') },
};

module.exports = { ...config, ...products, ...stockItems, ...stockLog, ...checklists, ...info, ...users };
