# Erdkeller — Stock Management & Crisis Preparation App
## Specification v16

> **Note for implementation (e.g. Claude Code): follow the numbered build order in Section 17 ("Development Plan") — each step has its own test to pass before moving to the next. Section 18 lists the setup Markus needs to do on his side (GitHub repo, Firebase project, etc.) — some of it should happen before or during the early steps.**
>
> **Six reference mockups accompany this spec:**
> - **`stock-flow.html`** — guided check-in/check-out flow (tile drill-down, product catalog step, detail form)
> - **`dashboard.html`** — dashboard with scrollable previews, full-screen drill-ins, responsive mobile/tablet layout
> - **`checklists.html`** — maintenance checklist (grouped by frequency, checkbox detail) and the distinct full-screen, high-contrast crisis reference view
> - **`info.html`** — Contacts (pinned emergency section), Notes, and tag-filtered Recipes grid
> - **`stock-table.html`** — admin stock browse/edit table (sortable columns, filters, multi-select bulk actions) and the two-column month/year date-picker modal
> - **`settings.html`** — Settings sub-sections, including the drag-to-reorder taxonomy editor and role toggles
>
> **Treat them as reference implementations for interaction and layout** — navigation logic, breadcrumb behavior, tile-grid drill-down, the scrollable-preview-with-"Alle anzeigen" pattern, the date-picker modal, drag-reorder, and the mobile/tablet responsive breakpoint are all meant to carry over directly. They are NOT the final visual design to copy pixel-for-pixel — styling can still evolve. All data shown in them (products, categories, quantities, names, contacts, recipes) is placeholder/dummy data, not the real starting dataset. The files are standalone demos and don't share navigation state with each other — the real app needs **one shared app shell** (bottom nav on mobile / sidebar on tablet) that all screens, including these, plug into.**

---

## 1. Purpose

- Manage the stock of a root cellar (type, amounts, best-before dates, storage location)
- Prepare, anticipate, and manage crisis situations
- Manage checklists for recurring maintenance and crisis first-steps
- Central place for emergency contacts, notes, and recipes

---

## 2. General Requirements

- Intuitive, simple UI — usable by all family members without training
- UI language: **German**
- Responsive: full-screen layout on tablet, fully mobile-friendly on phone
- Target devices: **Android only** (phone + tablet)
- Track stock in/out with minimal manual input, maximum automation
- Best-before date tracking with proactive alerts (always MM/YYYY granularity, no exact-day tracking needed)
- Offline-first: fully functional without connection, syncs to Firebase when online
- Push notifications via Firebase Cloud Messaging (FCM), even when app is closed — reliable since all devices are Android
- Recurring checklists (monthly/quarterly/yearly) with reminders
- Crisis first-steps checklists, fully open/user-defined categories
- Emergency contacts section
- Freeform notes section (how-tos, e.g. water tank cleaning)
- Recipe section (freeform text/photos, filterable tags/categories, no stock linkage)
- QR-code based check-in/check-out via device camera (no extra hardware)
- **PDF export for every section** (stock list, checklists, emergency contacts, notes, recipes, etc.) — this is a crisis-prep app, so the app cannot be the single point of failure even though it works fully offline. Printed paper copies of key sections are the fallback if the device itself is unavailable, damaged, or dead. Refreshing these printouts is intended to become a recurring item on the quarterly maintenance checklist once the app is in regular use.
- **Overscroll/bounce scrolling disabled app-wide** — no rubber-band effect at the top/bottom of scrollable views, for a more native/app-like feel
- **Undo on check-in/check-out** — a brief "Rückgängig" toast after confirming a stock action, reversing the last change if tapped (see Section 15, Stock)
- **Global search** — a single search bar covering all sections at once (Stock, Contacts, Notes, Recipes), separate from the per-screen/per-step search bars already scoped within a given flow (see Section 15, Navigation)

---

## 3. Roles & Permissions

| Role | Users | Permissions |
|---|---|---|
| **Admin** | Markus | Full access: stock, config, categories, targets, checklists, crisis lists, per-checklist reminder recipients, contacts, notes, recipes |
| **Member** | Julia, Sophia | Check-in / check-out stock, view dashboard, view notes/recipes/contacts (view-only — adding/editing content is admin-only, same as checklists) |

Settings/config screen is **admin-only** — not visible to Julia/Sophia at all (not even a scaled-down version for personal notification prefs, unless we decide otherwise later).

- Shared Firebase project, all three as authenticated users with a role flag
- **Auth method**: Google Sign-In (no password-reset flow to build; simplest given everyone already has a Google account) — flag if you'd rather use email/password instead

---

## 4. Firestore Collection Structure

Firestore organizes data as **collections** (folders) of **documents** (individual JSON records), optionally with nested subcollections.

```
/users/{userId}                  name, role (admin|member), fcmToken
/config/taxonomy                 types, categories (optional kcalPerKg, macroType,
                                  diversityFloorGramsPerPersonDay — see Section 7),
                                  subcategories (with symbol)
/config/storageLocations         admin-managed list
/config/yearColorMap             { "2026": "green", "2027": "blue", "none": "gray" }
/config/targets                  target totals per type/category/subcategory/product
/config/household                family members for autonomy planning — see Section 7
/config/planning                 autonomy duration, macro split, water rate — see Section 7
/stockItems/{itemId}             see Section 5
/products/{productId}            name, subcategoryId, unitType (kg | stueck)
/config/checklists               lists: [{ id, name, recipients, items: [{ id, text,
                                  frequency, lastCompletedAt }] }] — see Section 8
/config/crisisTypes              types: [{ id, name, sym, steps: [{ id, text }] }]
/config/notifications             checklists: { weekly: { weekday }, monthly: { weekOfMonth,
                                  weekday }, quarterly/halfYearly: { anchorMonth, weekOfMonth,
                                  weekday }, yearly: { month, weekOfMonth, weekday }, hour } —
                                  see Section 12
/contacts/{contactId}            name, role, phone, address, notes, isEmergency (bool)
/notes/{noteId}                  title, body, photos
/recipes/{recipeId}              title, body, photos, tags
```

## 5. Data Structure

### Stock line (one per purchase batch)
```
{
  type: "Groceries" | "Medication" | "Animal Food" | ...
  category: string          // e.g. "Gemüse & Hülsenfrüchte"
  subcategory: string       // e.g. "Hülsenfrüchte getrocknet"
  subcategorySymbol: string // ASCII/emoji icon per subcategory
  productId: string         // references /products/{productId} — see below
  details: string           // free text, e.g. "Dose", "Glas"
  quantity: number          // e.g. 5
  content: string           // e.g. "500g", "800ml" for kg-tracked products; free text for Stück-tracked
  bestBefore: "MM/YYYY"
  yearColor: string         // looked up from yearColorMap config, or "none"
  storage: string           // from fixed, admin-managed storage list
  createdAt, updatedAt
}
```

- **Batch model**: one stock line = one purchase batch (e.g. "5x Spaghetti, best before 06/2026"). Checking out reduces `quantity` on that line rather than creating individual item records. Dashboard/alerts can still expand batches into "N units due soon" on demand.
- **Type/Category/Subcategory**: fully editable in-app (admin only), stored as a manageable taxonomy collection in Firebase. ASCII/emoji symbol is a field on the subcategory.
- **Details field**: free text (not a fixed list) — e.g. "Dose", "Glas".
- **Storage locations**: fixed list, admin-managed as part of app configuration (like categories) — can be added/renamed/removed over time. A batch has one storage location (no split-batch support for v1).
- **Color badge (`yearColorMap`)**: admin manually assigns a color per year (mirrors the physical colored stickers already used in the cellar), plus an explicit "no badge" option for items with no best-before date (salt, honey, etc.). Not auto-generated — a simple year→color config table admin edits directly.
- **No conversion factor**: for **kg**-tracked products, `content` is parsed directly into a weight — strip the unit, treat ml as equivalent to grams (close enough for household stock-tracking purposes; even the least favorable common case, cooking oil, is only ~8–9% off, immaterial for "are we roughly on target"), divide by 1000 for kg. No per-product conversion factor is stored or needed. For **Stück**-tracked products, `quantity` alone is the tracked total; `content` becomes optional free text (e.g. "Sack", "Blister"), not used in any calculation.

### Product-level config (master catalog)
```
{
  productId: string
  name: string              // e.g. "Bohnen weiß"
  subcategoryId: string
  unitType: string          // set once per product, not per subcategory — determines
                              // whether this product's stock is tracked as a fractional
                              // amount (batch content parsed into a running decimal
                              // total) or a plain integer count. "kg" and "l" are
                              // fractional; every other value (medication, batteries,
                              // animal-feed sacks, ...) is a plain count. Products
                              // created via the guided Bestand flow or Ziele's
                              // Lebensmittel picker are still only ever "kg" | "stueck";
                              // Ziele's Sonstiges picker (Build 93) is the one place
                              // that opens this up to any string — "l", "Stück",
                              // "Flaschen", "Dosen", "Säcke", or a free-typed custom
                              // unit — see Section 7's Ziele/Sonstiges writeup.
}
```
- This is the **master product list** — every product that has ever existed in stock. A product only needs to persist at 0 stock if it (or its subcategory/category) carries its own target — see Section 7; otherwise there's no obligation to keep it around, and no automatic cleanup either. Products are effectively append-only, low-maintenance data.
- New products are added inline — during the check-in flow (Section 15, Stock) the first time something is bought that isn't in the catalog yet, or when defining a product-level target for something not yet purchased (Section 7). There is **no standalone admin catalog-management screen** — the earlier plan for one (Section 17, Step 6) turned out to add nothing once conversion factors were dropped and inline creation covered the real need.

---

## 6. Dashboard

- Lists grouped by type / category / subcategory / product, filterable by best-before horizon (1 Monat / 6 Monate / Bis Jahresende — see Section 15 for the dashboard preview vs. full-list behavior)
- Totals in kg per type / category / subcategory / product (Stück-tracked products/categories show a plain count instead)
- Target totals, settable three ways (admin-configured):
  - Flat number per item/category (e.g. "10 kg pasta")
  - Calculated from people count × duration (e.g. 4 people × 6 months) using a per-person consumption rate
  - Suggested by the autonomy-based calculator (Section 7) — kcal/water-driven, reviewed and applied by admin, then behaves like any other target
- Missing-quantity view: highlights gaps vs. target (staples like pasta/rice, and specific items like medication or animal food)
- Shopping list: viewable in-app, grouped by type, plus a share option (e.g. share as text)

---

## 7. Autonomy-Based Stock Sizing (Targets Extension)

Three admin Settings sub-sections form one **continuously live pipeline** — Taxonomie → Planung → Ziele — with **no manual "apply"/"commit" step anywhere**. Change a category's `kcalPerKg` in Taxonomie, or a household member's kcal in Planung, and every affected number in Ziele recomputes immediately.

Everything here is deliberately approximate — the whole exercise is about getting *roughly* the right balance of calories, macros, and diversity for a given autonomy duration, not a precision nutrition tool.

### Taxonomie: category nutritional data
- Each taxonomy **type** (Lebensmittel, Ausrüstung, Tiernahrung, …) has an exclusive 3-way class (`type.typeClass`): **Lebensmittel**, **Wasser**, or **Sonstiges** (default). Only categories under a Lebensmittel-classed type can offer the Kalorien/Diversität choice at all — a Werkzeug or Tiernahrung category never shows it, it's simply always manual. This is a tag rather than a name match ("is this type literally called Lebensmittel"), since a taxonomy can have more than one Lebensmittel type, and Tiernahrung is food but not *human* food — it stays Sonstiges even though "food" describes it in the everyday sense. Wasser-classed types don't get a Planung mode either — their stock feeds the Übersicht's dedicated water total instead (see below), summed across the whole type rather than assigned per category. A Lebensmittel type gets a light green tint and a Wasser type a light blue tint in the Taxonomie editor, so both read as distinct groups from Sonstiges at a glance. Switching a type's class never deletes any of its categories' kcal/macro/diversity data, only stops the calculator from using it — switching back brings it straight back, same principle as the mode switch below. (Data saved before this 3-way field existed is read via a fallback — `type.typeClass || (type.isFoodType ? 'food' : 'other')` — rather than migrated; that inference only holds while there are exactly two prior buckets, so a future 4th class needs an explicit one-time backfill instead.)
- **Wasser categories skip the subcategory level from the user's point of view** — `Wasser → Trinkwasser/Brauchwasser → Wassertank, Flaschen`, no separate "pick a subcategory" step, since one doesn't semantically exist for water. The data model underneath is untouched: `product.subcategoryId` stays the one universal addressing key everywhere else in the app. Each Wasser category silently keeps exactly one auto-managed subcategory (name/symbol kept in sync with the category), created and maintained by the Taxonomie editor itself — the subcategory list/add UI just doesn't render for a Wasser category with 0 or 1 subcategories. If a category already has more than one subcategory (real ones from before it was reclassified to Wasser), nothing is hidden — the normal subcategory UI keeps showing so existing structure is never silently swallowed. The Bestand guided flow (Einlagern/Entnehmen) and Ziele's inline product-creation picker both skip straight from category to product for a Wasser type, resolving to the implicit subcategory underneath.
- Within a food-tagged type, each **category** (Section 4/5, `/config/taxonomy`) has an exclusive 3-way Planung mode, set directly in the existing category editor (Section 17, Step 4): **Aus** (default — doesn't participate), **Kalorien** (`kcalPerKg` number + `macroType`: `kohlenhydrat` | `protein` | `fett`), or **Diversität** (`diversityFloorGramsPerPersonDay` number). A category is one or the other, never both — in practice a food is either a macro staple or a diversity safeguard, not both at once.
- Switching modes never deletes the other mode's stored data, only stops it being used — switching back brings the same numbers straight back.
- **Deliberately admin-editable data, not hardcoded in app code.** The taxonomy is fully custom per household and actively evolves — matching in code by category name breaks silently on rename (which the taxonomy editor fully supports); matching by ID requires an awkward manual handshake every time the taxonomy changes.

**Suggested starting values**, worked out for Markus's actual category list (kcal/kg figures are household-planning-grade estimates, not lab values):

| Category | Mode | kcal/kg | Makro |
|---|---|---|---|
| Fette, Öle & Nüsse | Kalorien | ~7000 | Fett |
| Fisch, Fleisch, Eier | Kalorien | ~2000 | Protein |
| Getreide & Hülsenfrüchte | Kalorien | ~3600 | Kohlenhydrate |
| Milch & Milchprodukte | Kalorien | ~2800 | Fett |
| Sonstiges | Kalorien | ~4000 | Kohlenhydrate |
| Medizin | Aus | — | — |
| Gemüse | Diversität (~50 g/Pers./Tag) | — | — |
| Obst | Diversität (~30 g/Pers./Tag) | — | — |

This assumes a small taxonomy restructuring (a data edit via the existing Step 4 editor, not a code change):
- **Fette & Öle** → renamed **Fette, Öle & Nüsse**; "Nüsse, Kerne, Samen" moves in from Obst & Nüsse (nuts are fat-dominant, same order of magnitude as oil — folding them in loses much less accuracy than leaving them with low-density fruit)
- **Getreideprodukte** → renamed **Getreide & Hülsenfrüchte**; "Hülsenfrüchte getrocknet" moves in from Gemüse & Hülsenfrüchte (dried legumes behave like a carb staple, not a vegetable, and land almost exactly on the existing grain density)
- **Gemüse & Hülsenfrüchte** → renamed **Gemüse** (remaining subcategories: Hülsenfrüchte eingelegt, Tomaten/Sugo, Eintopf (Gemüse), Eingelegtes Gemüse, Frisches Gemüse/Kartoffeln)
- **Obst & Nüsse** → renamed **Obst** (remaining subcategories: Eingelegtes Obst/Kompott/Mus, Trockenfrüchte, Frisches Obst)

Canned/pickled/dried fruit and vegetables **stay fully in the taxonomy and stock system** either way — this restructuring only affects which categories feed the calorie calculator, not what's trackable as stock.

**Vitamin C is deliberately not modeled via a produce floor.** Canned and dried produce loses significant vitamin C through heat processing and storage time, making a weight-based floor an unreliable guarantee. Recommended instead: stock a stable vitamin C supplement as its own product, with a manually-set target computed from the RDA directly — roughly 90 mg/day × people × autonomyDays ÷ mg per tablet. This is a one-time manual calculation using the per-product target override (see Ziele below), not a feature the app needs to compute.

### Planung: global targets
Settings → Planung collects the inputs and shows only the resulting **global numbers** — no per-category detail, no apply action, that all lives in Ziele now.
- **Household roster** (`/config/household`) — a separate admin-managed list of members, independent of `/users`, covering everyone who eats including household members without their own app sign-in (e.g. children). Each member: name + a **freely entered daily kcal value**. Reference ranges shown as hints, not enforced: Kind ~1200–1800, Teenager ~2000–2200, Erwachsener ~2000–2500 — adjusted upward for higher physical activity. No fixed age/activity lookup table; this stays a judgment call by design.
- **Autonomy duration** (`/config/planning.autonomyDays`) in days. No hard default enforced, but the UI suggests **90 days** as a starting benchmark.
- **Macro split** — adjustable percentages, default **50% Kohlenhydrate / 20% Protein / 30% Fett**.
- **Water rate** — liters/person/day, admin-adjustable, default **3 L** (drinking + basic cooking/hygiene), tracked natively in **liters** (not kg — see the Übersicht water card below). No category picker here anymore: which stock counts as water is now the Taxonomie **Wasser** type class above, summed globally across every category/subcategory under it, rather than one hand-picked category — content parsing is unit-agnostic (strip the leading number, ÷1000) so the exact same math that sums Lebensmittel's kg also sums water's liters (1 L ≈ 1 kg). The 3 L default is grounded in the BBK's (Bundesamt für Bevölkerungsschutz und Katastrophenhilfe) own guidance — 2 L Trinkwasser per person/day for drinking and cooking, plus Brauchwasser for hygiene (the BBK's own suggestion: a filled bathtub, 150–200 L, rather than a clean per-day figure; ~1 L/person/day is used here as the planning-friendly approximation) — shown as a `.settings-note` under the field, alongside a matching DGE-Referenzwerte-sourced note on the macro split (~50 % Kohlenhydrate / 30 % Fett / 20 % Protein of caloric intake) under the macro fields above.
- Output shown on this screen: total kcal target for Kohlenhydrate/Protein/Fett (household total kcal/day × autonomyDays × macro split %), and the total liter target for Wasser (rate × people × autonomyDays).

### Ziele: breaking global targets down to subcategories
Settings → Ziele has a **Lebensmittel/Sonstiges toggle**, and the two sides are shaped differently (Build 93 — see below for why). **Lebensmittel** is three flat, independently collapsible sections separated by a rule — **Kategorien**, **Unterkategorien**, **Produktziele** — not a Type→Category→Subcategory tree, so a given category/subcategory appears in exactly one place rather than being duplicated across a summary area and a browsable tree. A **unit toggle** (kg / kg per Person&Tag / kcal / kcal per Person&Tag) controls how amounts display, including each macro group's header total; kcal-based units fall back to kg for any category without a usable `kcalPerKg`.

**Sonstiges (Build 93, Wasser strictly separated in Build 94)**: category/subcategory-level targets were removed entirely — a Sonstiges category never reaches Kalorien/Diversität (those are Lebensmittel-only modes gated by the type's Lebensmittel class, see Taxonomie above), so every Sonstiges category/subcategory target was already just a manual "Aus" number with no computed backing; only products carry targets on this side now. The tab is just **"+ Neues Produktziel hinzufügen"** at the top, then one product-target list grouped by category → subcategory (reusing the same section-header styling Kategorien/Unterkategorien used to show), rather than three separate collapsible sections. Tapping the button opens the same product picker Lebensmittel uses (search + match list, now with **"+ Neues Produkt anlegen" right below the search bar** on both sides instead of after the match list — quicker to reach when you already know it's not in the catalog yet); picking an existing product opens the standard flat target-editor same as always. Tapping "+ Neues Produkt anlegen" on the Sonstiges side, though, opens its **own separate modal** (not the picker expanded in place, which is what it does on the Lebensmittel side, unchanged) that folds the target amount directly into product creation — one save instead of create-then-auto-open-the-edit-modal — and offers an **open unit picker** instead of the fixed Kilogramm/Stück toggle: a dropdown seeded with `kg`, `l`, `Stück`, `Flaschen`, `Dosen`, `Säcke` plus any custom unit already used on another Sonstiges product (derived live from the product catalog itself — no separate "known units" list is persisted), and a free-text box for typing a brand-new one on the spot. Only **kg and l** are "fractional" units — tracked the same way Lebensmittel already is, via the batch content field's number-and-unit string parsed into a running decimal total (`js/dashboard.js`'s `isFractionalUnit`/`batchKg`, duplicated with the same name across `js/stock-table.js`/`js/stock-checkin.js` per this codebase's small-helper-duplication convention). Every other unit — the fixed four, or a custom one — is tracked as a plain integer count via the quantity stepper alone, same as `stueck` already worked; this is a per-*product* choice via its own `unitType` field (now an open string, not just `"kg" | "stueck"`).

**Wasser is strictly excluded from both Ziele tabs (Build 94)** — not just from Kategorien/Unterkategorien (already true), but from Produktziele too, and from the Sonstiges picker's Unterkategorie list. Build 93 briefly let a Wasser product fall into the Sonstiges list (its `productIsFood()` check was a binary food/not-food test, so "not food" silently swept water in with everything else) — replaced with a proper three-way `productTypeClass()` (food/water/other) that drops water from both lists entirely. The reasoning, confirmed with Markus: the Taxonomie Wasser type exists purely to track toward the **one global liter target** (Planung's rate × people × days, shown in Übersicht) — never an individual product-level override, so it has no business in either Ziele tab's Produktziele picker. Wanting a separately-tracked "always keep 10 bottles of water available regardless of the tank" target means creating an **actual Sonstiges product** for it instead — e.g. Fluchtrucksack › Getränke › Wasserflaschen, with its own Sonstiges Produktziel — deliberately unlinked from the real Taxonomie Wasser type even though it's also called "water." New Wasser products (created via the guided Bestand check-in flow's own "+ Neues Produkt" step — the only place one gets created, since Ziele's own new-product forms both exclude Wasser subcategories) are locked to **liters only**: the kg/Stück toggle is hidden and the unit forced to `"l"` whenever the drilled-into type is Wasser-classed, with an explanatory note in its place — a Wasser product's stock is always meant to count toward the one global target, never anything else.

**Product context shown in the picker + Lebensmittel list (Build 95)**: rows in the "+ Produktziel hinzufügen" picker and the flat Lebensmittel Produktziele list show a symbol-prefixed "Kategorie › Unterkategorie" line under the product name (`productContextLabel`), not just the bare name — a duplicate-looking or unexpectedly-placed product is now identifiable at a glance instead of a mystery. A product whose `subcategoryId` no longer resolves shows an explicit "⚠️ Unterkategorie fehlt (verwaiste Daten)" warning rather than blank/silent context — this is exactly what's behind an unresolvable product landing on the Lebensmittel side via `productTypeClass()`'s safe-default fallback (Build 94): the fallback keeps its target from silently vanishing, but gave no visible reason *why* it was there until this. Sonstiges' own grouped Produktziele list doesn't repeat this per row — its category/subcategory headers already show the same context.

- **Aus categories** (and their subcategories, and product-level overrides) work exactly as before: a manually set target, flat amount only for products, flat-or-Personen×Tage for categories/subcategories, via tap-to-edit. In Kategorien they're grouped under their type's name as a plain label (no expand/collapse — that's what the type-level tree row used to do).
- **Kalorien categories**: when a macro (Kohlenhydrate/Protein/Fett) has more than one tagged category, its global kcal target (from Planung) splits between them via a **±5-percentage-point stepper** per category, always summing to exactly 100% — clicking + on one category always takes 5 points from whichever sibling currently holds the most, clicking − always gives 5 to whichever holds the least, so the group can never land off 100% and there's no drag gesture to get wrong on a phone. A single tagged category in a macro is locked at 100% automatically. Only categories under a food-tagged type reach this path at all (see Taxonomie above).
- **Diversität categories**: each computes its own target independently (floor g/person/day × people × autonomyDays) — not pooled against siblings, so no stepper at this level.
- **Wasser-classed types don't appear in Ziele at all** — no Kategorien/Unterkategorien rows, no stepper. Water has exactly one global target (Planung's rate), not a per-category split, so there's nothing here to break down; it's shown as its own total in the Übersicht instead (Section 17, Step 10). Individual water *products* can still get a manual Produktziele override same as any other product — that's a fully independent mechanism, unaffected by this.
- **Subcategories under any computed category** (Kalorien or Diversität): the parent's computed total splits again across its subcategories with the same ±5% stepper mechanism, shown grouped by parent category name in the Unterkategorien section — this is the level a future shopping list can use directly, since it's where individual products' stock naturally rolls up.
- **Type level has no target of its own** — a type can span categories in completely different Planung modes (or none — most non-food types are entirely Aus), so a rollup number there wouldn't mean much yet. (A later, separate idea, distinct from the Lebensmittel-Typ gate above: an actual type-level target/rollup display. Not built.)
- **Product-level target overrides** stay available exactly as before, independent of everything above — e.g. "I specifically want 5 kg of this one product," or the vitamin C tablet calculation above. New products can be created directly from the Produktziele picker (name, unit, Unterkategorie) instead of needing the guided Bestand flow first — Sonstiges' own version of this flow is the open-unit modal described above.

Categories/subcategories with incomplete data (Kalorien mode without a macro or kcal/kg set, Diversität mode without a floor value) show a clear "data unvollständig" placeholder instead of a number, rather than silently computing 0 or crashing.

---

## 8. Checklists

- **Maintenance checklists**: no link to Bestand/Ziele at all — deliberately rejected mapping items to real products (a stock-flavored entry like "Klopapier (2x)" doesn't cleanly become a taxonomy product with a "satisfied" threshold), so an item is just text + frequency + checkbox, full stop. Frequencies: **weekly, monthly, quarterly, half-yearly, yearly** — no "einmalig" (one-off); even nominally one-time items (passport, compass, ...) get a real recurring cadence (seeded as yearly) so they're still checked occasionally rather than disappearing from the list forever. **Grouped by topic** (Ausrüstung, Autos, Dokumente, Gesundheit, ...) on the live view, matching how the household actually organizes its own list, rather than by frequency — each item shows its frequency as a tag. A **Fällig/Alle filter toggle** shows only items due this period vs. everything, and (Build 76) a **Checkliste filter-chip row** above it lets you show/hide whole checklist groups — separate state from the editor's own Checkliste filter, so narrowing one view never silently narrows the other. On tablet (≥900px), checklist cards lay out two up, each column flowing independently (CSS multi-column, not grid, so a tall card in one column never leaves a forced gap under a shorter one in the other). Admin-configured inline on the Checklisten screen itself (an admin-only pencil toggle swaps the view into an editor and back — see Section 15); **admin decides per checklist who receives it** (Markus only, or also Julia/Sophia) — reminders themselves are still Section 12 (Notifications), not yet built.
  - **Completion model — reset-boundary, not calendar-bucket (Build 74)**: no rolling `nextDue`-from-completion scheduler, and no plain "calendar month/quarter/year" bucket either. "Done for the current period" is *derived* by comparing `lastCompletedAt` against the most recent occurrence of that frequency's admin-configured schedule (Settings → Erinnerungen → Checklisten, `/config/notifications`, Section 12) — e.g. monthly's boundary is "the most recent 2nd Saturday," not "the 1st of this month." Ticking the box sets `lastCompletedAt` to now; it silently resets unchecked once the schedule rolls past that occurrence again. Still a pure derived comparison, no wipe action, no new infrastructure — the same shape as the original calendar-bucket version, just a smarter boundary. (An earlier version used plain calendar buckets before the scheduling settings existed; superseded once Markus specified real workflow needs — a monthly sitting on a specific weekday, not an arbitrary calendar-month cutoff.)
  - Firestore permission note: `/config/checklists` is the one `/config` doc any signed-in family member can write (not just admin) — ticking a box is a member action, same reasoning as stock check-in/out. The admin-only pencil-toggle editor is what actually keeps structural edits (add/rename/delete/reorder) behind admin in practice. `/config/notifications` (the schedule itself) stays plain admin-only — that's a one-time structural setting, not a per-item action.
  - **Editing (Build 74, refined Build 75)**: the pencil-toggle editor is a flat, filterable list of every item across every checklist — not nested per-checklist blocks — since a real list this size (~113 items) needs to be searchable and filterable to be usable. A free-text search box, a **Checkliste** filter-chip row, and a **Häufigkeit** filter-chip row (multi-select, same `.filter-chip` pattern as the admin Bestandsliste table) narrow the list, which defaults to **alphabetical-ascending by item text**. Each row shows text, a delete button, a frequency `<select>`, and a "move to checklist" `<select>` listing every checklist by name — picking a different one moves the item there immediately, no modal. No checkbox and no checked/unchecked filter here — that's what the live view's Fällig/Alle toggle already covers (Alle shows and un-ticks completed items too), so duplicating it in the editor was redundant. Two collapsible sections (same chevron pattern as Ziele's Kategorien/Unterkategorien/Produktziele) keep the screen manageable: **Checklisten verwalten** (rename, recipients, delete, add a checklist — container-level actions that don't fit a per-item row) and **Einträge** (the flat list itself). The one-time **"Bekannte Checkliste importieren"** seed button was removed once the real data was safely imported — it had done its one job. Creating a checklist auto-selects it as the sole active filter in both filter rows (Build 81 fix) — without this, "+ Eintrag hinzufügen" targets whichever checklist the filter resolves to (falling back to the most recently created one with no filter active), so an item added right after creating a new checklist would otherwise silently land on a different, older checklist, leaving the new one with 0 items and invisible on the live view (which skips empty checklists entirely). On tablet (≥900px), each item row lays out text/frequency/move-to-checklist/delete side by side in one line instead of two, and each Checklisten verwalten row lays out name/Markus/Julia/Sophia/delete the same way.
- **Crisis checklists**: fully open — admin can create new crisis types freely (e.g. "Power outage", "Water outage", "Medical emergency", "Evacuation"), each with its own first-steps checklist. Presented as a **large-text, high-contrast scrolling list** — a pure read-through reference, no checkboxes or step-tracking, since the goal is fast calm reading under stress rather than progress tracking. Steps are **automatically numbered** (1., 2., 3., ...) by their position in the array, in both the reference view and the admin step editor — always sequential, renumbering itself whenever a step is added or deleted (no reorder feature exists yet). Adding, renaming, or deleting a crisis type re-renders both the editor and the live Krise card list immediately (Build 82 fix — the add/rename/delete handlers only re-rendered the editor, so a newly created or renamed type wouldn't show on the live list until an unrelated full refresh happened to fire). Tapping a card opens the reference view (Build 83 fix — the static markup carried a stray `hidden` class alongside the overlay's own `.show` toggle; `.hidden`'s `!important` always won, so the overlay could never actually become visible no matter how correctly the JS populated and "opened" it — a latent bug present since this view was first built, not something introduced later).
- **Guaranteed offline availability**: crisis checklist content is explicitly pre-cached on first app load/sign-in (not just covered incidentally by general offline persistence, see Section 13) — this is the one section where offline access is mission-critical, since it's meant to be readable during outages regardless of when the device last synced. *(Not yet implemented — still relies on general offline persistence, Section 13.)*

---

## 9. Contacts & Notes

- Emergency/important contacts list (name, role, phone, notes)
- **Emergency contacts are pinned in a separate highlighted section at the top** (e.g. Notruf, Handwerker) distinct from general contacts below — so the most critical numbers are found instantly without scrolling past unrelated entries
- Freeform notes section, supports text and photos (e.g. how to clean the water tank)
- Adding/editing contacts and notes is **admin-only** (same model as checklists) — members can view but not add or edit

---

## 10. Recipes

- Freeform text + photo entries (e.g. Dutch oven recipes)
- **Simple tags/categories** (e.g. "Dutch Oven", "Eintopf", "Brot") — filterable, so the grid can narrow down by type rather than only browsing everything at once
- No linkage to live stock data (kept simple, decoupled)
- Adding/editing recipes is **admin-only**, same as contacts and notes

---

## 11. QR / Labels / Barcode

### QR codes (own labels)
- QR codes encode a product/batch reference ID
- Check-in / check-out via device camera scan (phone or tablet), using a browser-based scanning library (e.g. ZXing or jsQR) — no dedicated scanner hardware
- Label design: **flexible/printable HTML template** for now (printer/label size not yet decided) — generate a printable page with QR code + key details (product, content, best-before), refine layout once a printer is chosen

### Barcode scanning (retail products) — deferred, see Section 19
Evaluated for Step 7 and **not built for now** — see Section 19 "Nice to have / Future ideas" for the full rationale and what it would take if revisited.

---

## 12. Notifications

- Firebase Cloud Messaging (FCM) for real push notifications, delivered even when the app is closed
- Reliable on all-Android device fleet (no iOS push limitations to design around)
- Triggers: best-before approaching (1/3/6 month thresholds), checklist due dates (per-checklist recipient list, admin-configured)
- Requires: service worker registration for the PWA, FCM setup in Firebase project, notification permission prompt in-app

**Status: scheduling config built (Build 74), actual sending not yet built.** Settings → Erinnerungen (`/config/notifications`, admin-only, standard `/config/{docId}` rule) is where "monatlich"/"vierteljährlich"/"halbjährlich"/"jährlich"/"wöchentlich" get pinned to real calendar dates — an occurrence (1st-4th) + weekday for monthly, the same rule plus an anchor month for quarterly/half-yearly (repeating every 3/6 months), a fixed month for yearly, just a weekday for weekly. Currently the *only* consumer of this config is js/checklists.js's own done-for-the-current-period math (Section 8) — it defines the reset boundary, not an actual notification. Send time is hardcoded at 9:00 for every frequency for now; wiring an actual FCM push at that computed date/time is unbuilt, same as the rest of this section. The doc has room for other notification types to land as sibling keys later without any rules or structure churn.

---

## 13. Sync & Offline

- Offline-first: local persistence (e.g. Firestore's built-in offline cache, or a custom IndexedDB store), syncing to Firebase on reconnect
- Conflict resolution: **last-write-wins** (simplest approach; conflicts expected to be rare given quick check-in/out actions)
- **Crisis checklists — explicit pre-cache guarantee**: general offline persistence covers whatever's already been loaded/queried, which isn't a strong enough guarantee for a mission-critical section. On sign-in (and whenever crisis data changes), proactively fetch and store all `/crisisTypes` documents in the local store/service-worker cache, so they're readable offline even if that screen was never opened while online.
- *(V2, not yet scoped: Section 20.2 sketches a stronger, explicit IndexedDB mirror — deliberately written on every sync rather than relying on Firestore's opaque built-in cache — plus a monetization tier that depends on it.)*

---

## 14. Backup & Data Portability

- No automatic scheduled backup for v1 (would require Firebase's paid Blaze plan for scheduled Cloud Functions) — not worth the added cost/complexity at this stage
- **Manual CSV export**: an in-app "Download backup (CSV)" button, admin-triggered, whenever desired
- **CSV import (full replace)**: planned as an **end-game / later-phase feature** — imports a CSV and replaces all data in the Firebase DB. Not urgent; sequenced after core stock/checklist/crisis features are working.
- *(V2, not yet scoped: Section 20.2 proposes a full JSON export/backup format alongside CSV, plus timestamp-based conflict handling on import — CSV alone can't round-trip Erdkeller's relational data.)*

---

## 15. UI / App Structure

### Navigation
- **Mobile**: bottom nav bar, 5 tabs (Dashboard, Stock, Checklists, Info, Settings)
- **Tablet**: same 5 sections as a **persistent sidebar** instead of a bottom nav — same information architecture, more room
- Wherever a section has a list-with-detail pattern (Stock, Checklists, Info), tablet uses a **two-pane layout**: list on the left, detail/edit view on the right, so opening an item doesn't navigate away from the list
- **Global search**: a search icon in the shared app shell (top bar on mobile, sidebar on tablet) opens a single search covering **Stock (products/batches), Contacts, Notes, and Recipes** at once, with results grouped by section — distinct from the per-step search bars already embedded within the Stock guided flow and the admin stock table, which stay scoped to their own step/table. Tapping a global result jumps straight to that item's detail view in its section. Checklists aren't included (nothing free-text to search — titles are already short and visible in the grouped list).
- **Hardware/gesture back button (Build 77, refined Build 78, `js/back-nav.js`)**: on Android, the back button/gesture drives the same "go back" action each screen's own on-screen control already performs, checked in priority order: (1) unwind whichever nested state is deepest — closing a Settings sub-panel, stepping back through the Stock guided flow, exiting Checklisten's edit mode, closing the crisis reference overlay; (2) if nothing's nested but a non-Dashboard tab is active, switch to **Dashboard — the floor**; (3) if already on Dashboard with nothing nested, absorb the press. **The app never exits via back while signed in** — a sentinel browser-history entry is kept pushed at all times (consumed by `popstate`, immediately re-pushed after handling it), so there's always another one waiting for the next press, all the way down to Dashboard and no further.

### 1. Dashboard (default screen on open)
Each preview section shows a capped number of items (top 3–5) in a **fixed-height, internally-scrollable preview box** — so a long list doesn't push the rest of the dashboard down, but nothing is hidden either. Each has an **"Alle anzeigen"** link (top-right of its section) opening a full-screen view.

1. **Alerts** — preview: top 3–5 items due/overdue within a **default 3-month horizon**, most prominent, always visible. "Alle anzeigen" opens a full-screen list with a **horizon selector** (1 Monat / 6 Monate / Bis Jahresende) to change the window; the dashboard preview itself always stays at the 3-month default regardless of what's picked in the full view.
2. **Gaps summary** — preview: top few missing items in the same scrollable-preview pattern; **conditional**, only rendered if something is actually missing. "Alle anzeigen" opens the full list.
3. **Totals overview** — per Type, each tile shows **current stock vs. the sum of its categories' targets** (e.g. "45 kg / Ziel: 60 kg" with a small progress bar) — a display-only rollup, since Ziele (Section 7) has no target stored at the type level itself. Tappable. "Alle anzeigen" opens a **hierarchical drill-down view**: Type (rollup) → Category → Subcategory, category/subcategory levels showing amount vs. their real (manual or computed) target from Ziele (expand/collapse per type).
4. **Shopping list** — quick-access button; tapping opens the full shopping list (grouped by type, checkable items).

Targets themselves are defined and edited in **Settings → Ziele** (admin-only), manually for Aus categories/subcategories/products or live-computed for Kalorien/Diversität categories per Section 7 — Wasser's target is set in Planung instead and shown directly in Übersicht. The dashboard only displays progress against whatever ends up there.

### 2. Stock
Two entry points, each a **guided step-by-step flow** rather than a single browse screen (validated via interactive mockup):

**Einlagern (check-in):**
1. Type → Category → Subcategory (large tappable tiles, as in the mockup), with a "häufig verwendet" (frequently used) shortcut row and a search bar available at every step to skip drilling.
2. **Product step**: list of products **pulled from the master product catalog** (`/products`), filtered to the chosen subcategory — not hardcoded. Shows **product name only** (e.g. "Bohnen weiß") — no weight/content shown here, since that's entered next. Includes a **"+ Neues Produkt"** option at the end of the list for the first time a product is bought (adds it to the master catalog, incl. its `unitType` — see Section 5)
3. **Detail screen**: quantity stepper, best-before, storage, plus one of:
   - **kg-tracked product**: a content field (weight/volume, e.g. "500g", "800ml") — parsed directly into kg, no conversion factor (Section 5)
   - **Stück-tracked product**: no content field needed — the quantity stepper alone is the tracked total
   - **Best-before field**: tapping it opens a **modal date picker** with two columns — months (1–12) on the left, years (extendable window) on the right; month and year are each picked by **tapping the item directly** (Build 85 — originally scroll-and-snap-to-center, which the admin found hard to hit precisely on a touchscreen), not by scrolling to align it with a center highlight. The selected item in each column is marked/highlighted; a column still scrolls if its content overflows the visible height, but that's incidental browsing, not how a value gets picked.
   - No color-badge dot shown at this stage — the badge is derived from the best-before year once the batch exists, so it doesn't apply yet during check-in (only appears afterward in stock lists)
4. Confirm → success screen → back to the two big buttons

**Entnehmen (check-out):**
1. Same guided drill-down (Type → Category → Subcategory), or search/frequently-used shortcut
2. **Product/batch step**: unlike check-in, this shows the **real existing batches already in stock** with full detail inline per row — e.g. "5× Dose · 400g · MHD 11/2027" with its color-badge dot (badge = best-before year, only relevant here since these are real dated batches) — since checkout means picking a specific batch to remove from, not a generic product
3. Quantity stepper to remove → confirm → success screen

**Undo**: on both flows, confirming shows a brief **"Rückgängig" toast** (a few seconds, non-blocking) on top of the success screen. Tapping it reverses the just-completed action — deletes the batch just created (check-in) or restores the quantity just removed (check-out) — and returns to the two big buttons. Letting the toast time out simply keeps the change; no other undo history is kept beyond the single most recent action.

Tablet: same guided-flow pattern, just with more tiles per row / more breathing room — this flow doesn't lend itself to the two-pane list+detail layout used elsewhere, since it's a linear sequence rather than a browsable list.

**Separately**, an admin browse/edit view of all stock is reached via a **search/list icon in the Stock tab's header** (next to the screen title, alongside the two big Einlagern/Entnehmen buttons on the main screen):
- Presented as a **sortable, filterable table** rather than a fixed grouped list — columns: Product, Subcategory, Category, Type, Quantity, Content, Best-before, Storage, each tappable to sort by that column, so admin has free control over sort order rather than a single fixed grouping
- **Default sort**: Product (alphabetical), then Subcategory, then Category, then Type
- **Filters**: Type, Category, Subcategory (Build 96, chips — see below), Storage (chips), plus free-text search. A **"Zurücksetzen"** button (Build 99) clears all four chip selections at once. On **mobile** the chip rows live behind a **"Filter"** toggle instead of sitting inline above the list — tapping it slides in a full-screen panel with all four rows and an "Anwenden" button to close it, and the toggle itself picks up an active style whenever any selection is non-empty, so it's clear a filter is applied even with the panel closed; **tablet** keeps the chip rows inline as before (Build 96), just with Zurücksetzen added next to them (min-width:900px CSS hides Filter/Anwenden and undoes the panel's positioning back to plain flow — the same `#table-filters-panel` DOM repositions between layouts, no JS branching needed).
- **Multi-select bulk actions**: checkboxes per row enable bulk operations (e.g. deleting several expired batches at once)
- Tap a single row (outside multi-select mode) → same detail/edit view used elsewhere (quantity, content, best-before via the date-picker modal, storage, details, delete)
- This view is for admin-style bulk review and cleanup — the guided Einlagern/Entnehmen flow remains the primary daily-use path for everyone else
- **Adding a product/batch (Build 85, refined Build 86, fixed Build 87)**: a **"+ Hinzufügen"** button in the panel header (next to "Auswählen") reuses the guided Einlagern flow itself rather than a second, bespoke add form — it switches to the Bestand tab and launches the same Type → Category → Subcategory → Product (existing or "+ Neues Produkt") → Detail sequence described above. The only difference from a normal Einlagern run: confirming the batch jumps straight back to the Bestandsliste (skipping the guided flow's own success screen entirely, Build 86 — the admin found the extra "Zurück" tap redundant when they'd only opened the flow to add this one thing), and cancelling all the way back out also returns to the Bestandsliste — either way, landing back where the admin actually started, not the Bestand tab's two big buttons. The brief "Rückgängig" undo toast still appears (it's a fixed-position overlay, visible above whichever screen is showing) so the add can still be undone even though the flow itself is no longer on screen. This "return here when done" marker is set only *after* switching to the Bestand tab (Build 87 fix — setting it first meant that tab switch's own reset-to-root event immediately cleared it again, before the flow even started, so confirming silently behaved like a plain Einlagern run instead).
- **Tap-through back navigation (Build 85, refined Build 86)**: reaching this view via a tap-through from the Dashboard — tapping a product row in the MHD/best-before alert list, or a subcategory row under a Dashboard category card — marks the panel's own back button (and the hardware/gesture back button, which delegates to it) to switch back to the Dashboard *without* the nav icon's normal "reset to root" behavior (Build 86 fix — the first version re-clicked the Dashboard nav icon to get there, which unconditionally fires the same reset a real tap on that icon fires, wiping the Dashboard's expanded/collapsed category state and forcing its sub-tab back to "Bestand" even when the admin had been on the "MHD" sub-tab). Skipping that reset means the Dashboard reappears exactly as it was left — same open categories, same sub-tab — since the screen was only hidden while the admin was in the Bestandsliste, never rebuilt. Opening the Bestandsliste normally (tapping its own card in Admin) clears this marker, so its back button falls back to the generic "Admin main menu" behavior shared by every other Settings panel.
- **Checking a product out to zero deletes it from the catalog, unless targeted (Build 96, revised Build 97, corrected Build 98)**: Build 96 first made every product with zero real batches show as a synthetic "phantom" row in Bestandsliste (`phantomBatchFor`/`allRows()` in `js/stock-table.js`, discriminated from a real batch by `id === null`). Build 97 tried hiding untargeted zero-stock rows instead — but that only hid the underlying orphan data (a `/products` doc nobody could see or clean up anymore), it didn't remove it, so Build 98 fixes it at the source instead: checking a product's last batch out to zero in `js/stock-checkout.js`'s Entnehmen flow now **deletes the product from the catalog outright** (`deleteDoc` on `/products/{id}`, right after the batch's own `stockItems` doc is deleted), not just from view. The one exception is a product with an active Ziele product target (`targets.products[productId]`, loaded alongside this flow's other config) — that one stays in the catalog, since it's meant to be restocked. Rückgängig (undo) restores the deleted product doc too when this happened (`lastDeletedProduct`), so undoing a checkout can't leave the restored batch pointing at a product that no longer exists. Bestandsliste's zero-stock phantom rows are back to showing unconditionally (Build 98 reverts Build 97's filter) — the auto-delete above only covers the checkout path, so a straggler that reached zero stock some other way (a manual Bestandsliste batch delete, or legacy data from before Build 98) still needs a place to be found and cleaned up. A targeted zero-stock row shows **"Kein Bestand · Ziel: …"** with the actual target amount and unit inline (`targetLabel`, Build 97); an untargeted one just says "Kein Bestand". Type/category/subcategory are resolved live from Taxonomie (showing "⚠️ Unterkategorie fehlt" for a genuinely orphaned reference). Tapping a phantom row opens a reduced edit view — rename only (the batch-specific fields and their date picker are hidden, with a note explaining there's no stock yet) — plus a **"Produkt löschen"** button, the first place anywhere in the app that can delete a product from the catalog by hand (already covered by the existing admin-only `/products` rule). Deleting a targeted product this way also strips its now-dangling `targets.products` entry (same shape as Ziele's own "Aus"/`clearBtn` target-clear path) so no stale reference is left in `/config/targets`.
- **Cascading tinted Typ/Kategorie/Unterkategorie filter chips (Build 96)**: a new Unterkategorie chip row joins the existing Type/Category filters, and all three levels now carry the same green (Lebensmittel) / blue (Wasser) tint the Taxonomie editor already uses for its type badges (`.filter-chip.chip-food`/`.chip-water`), so what vertical a chip belongs to is visible at a glance rather than only inferable from its label. The three rows are also **cascading**: selecting a Typ chip narrows which Kategorie and Unterkategorie chips even render to that vertical (picking Wasser hides every Lebensmittel/Sonstiges chip at both lower levels, not just their rows), and selecting a Kategorie narrows Unterkategorie further; any lower-level selection that becomes invalid when a higher level changes is cleared automatically (`pruneInvalidSelections`). Implemented as a full top-down re-render of all three chip rows on every click (`refreshHierarchyChips()`) rather than incremental patching, matching household-catalog data scale.

### 3. Checklists (Maintenance / Crisis sub-tabs)
**Maintenance** *(as built — see Section 8 for the deviations from the original plan below)*:
- **Live view** (Build 73, filter chips added Build 76): grouped by checklist topic (Ausrüstung, Autos, Dokumente, ...), each item showing text, a frequency tag, its checkbox, and (once checked at least once) a "zuletzt: MM/YYYY" note; a **Fällig/Alle** toggle filters to just what's due this period, and a **Checkliste filter-chip row** above it shows/hides whole checklist groups (own filter state, independent of the editor's). Checkbox per item, no sub-steps; auto-resets to unchecked once the schedule (Section 8/12) rolls past the item's next occurrence. Tablet (≥900px): checklist cards two up, columns flowing independently rather than row-aligned.
- Admin-only editing — **inline, not in Settings**: an admin-only pencil icon top-right of the Checklisten screen swaps the active tab (Wartung or Krise) between its normal view and an editor in place; tapping it again ("✓ Fertig") swaps back. No standalone Settings → Checklisten submenu — same "edit where the content lives" reasoning as Contacts/Notes below.
- **Wartung editor (Build 74, refined Build 75/76)**: a flat, filterable list of every item across every checklist, not nested per-checklist blocks — a free-text search box and Checkliste/Häufigkeit filter-chip rows (multi-select) narrow ~113+ items down to something scannable, sorted alphabetical-ascending by default. Each row: editable text, a delete button, a frequency `<select>`, and a "move to checklist" `<select>` (changing it moves the item immediately, no modal/drag-and-drop) — stacked two lines on mobile, all on one line on tablet (≥900px). No checkbox/checked-state filter in the editor — the live view's Fällig/Alle toggle already covers seeing and un-ticking completed items, so it isn't duplicated here. Two collapsible sections — **Checklisten verwalten** (rename, recipients, delete, "+ Neue Checkliste") and **Einträge** (the flat list) — keep the screen manageable, same collapsible pattern as Ziele's sections.

**Crisis:**
- List: crisis types as cards (Power outage, Water outage, etc.)
- Detail: **large-text, high-contrast scrolling list** of numbered steps — a pure read-through reference (no checkboxes/tracking), designed to be readable fast and calmly under stress, possibly by someone unfamiliar with the app
- Admin-only: add/edit crisis types and their steps, via the same inline pencil toggle as Maintenance (shared button, scoped to whichever tab is active)

### 4. Info (Contacts / Notes / Recipes sub-tabs)
- **Contacts**: **pinned emergency section at top** (Notruf, Handwerker, etc.), general contacts below; list shows name, role/label, and **phone number directly on the row** (not hidden behind a tap); tap-to-call via `tel:` link on the number/call icon. Tapping the row itself (outside the call icon) opens a **detail view** with the full record (address, notes, alternate numbers, etc.) — so a contact's information is never more than one tap away, whether that's calling immediately or reading more context. **Admin-only add/edit, controlled inline** — a "+" button and per-item edit icons visible only to admin, directly within the Contacts tab (not tucked into Settings, since this is content you'd add while browsing rather than structural config).
- **Notes**: list by title → full text + photos. Same inline admin-only add/edit pattern.
- **Recipes**: **photo-first grid** (thumbnail + title) with **filterable tags/categories** (e.g. Dutch Oven, Eintopf, Brot); tap → full recipe. Same inline admin-only add/edit pattern. On tablet, full-width grid rather than two-pane.
- Tablet: Contacts/Notes use two-pane list+detail; Recipes stays a grid

### 5. Settings (admin-only)
- Grouped into sub-sections rather than one flat list:
  - Every sub-panel's back button reads the generic **"‹ Zurück"** (Build 88 — previously each named its own panel, e.g. "‹ Daten", "‹ Bestandsliste"), matching the wording already used by the guided flows' and crisis reference's back buttons.
  - **Data**: taxonomy management — **nested list editor** (Type → Category → Subcategory) with add/rename/delete **and drag-to-reorder** at each level; symbol field; the exclusive Aus/Kalorien/Diversität category planning mode (Section 7); storage locations list; year color map
  - **People**: **role toggle per existing signed-in user** — since sign-in is Google-based and self-provisioning (Julia/Sophia already have Google accounts), there's no invite-by-email flow needed; admin just flips a member's role between Admin/Member once they've signed in at least once
  - **Erinnerungen** (Build 74): scheduling only — which weekday/occurrence/month each checklist frequency resets on (Section 12). Checklist *content* editing (maintenance + crisis management, reminder recipients) is deliberately not here — it moved inline onto the Checklisten screen itself (Section 15's Checklists sub-screen, Build 73) once a submenu proved to be an unnecessary hop for something edited far more often than the reminder schedule is.
  - **Ziele**: targets for **category, subcategory, or individual product** (no type-level target — see Section 7) — Aus categories/subcategories/products use the flat-number or people×duration method from Section 6; Kalorien/Diversität categories and their subcategories are live-computed from Planung, split via the ±5% stepper. Wasser-classed types don't appear here (Section 7) — their one global target shows in Übersicht instead.
  - **Planung**: the autonomy-based stock sizing inputs (Section 7) — household roster (each row prefixed with a fixed **👤** icon, Build 89 — a plain visual marker, not a per-person symbol picker like Taxonomie's), autonomy duration, macro split, water rate, and the resulting global kcal/liter numbers (no apply action — Ziele/Übersicht read these live)
  - **Export**: PDF export access point, CSV backup

### PDF export
- Available from every section (Stock list, Checklists, Contacts, Notes, Recipes) — generates a printable PDF snapshot of that section's current data
- Supports the "print and keep a paper copy" fallback described in Section 2, refreshed periodically as part of the quarterly checklist

---

## 16. Tech Stack

- Frontend: HTML/JS, hosted on GitHub Pages, deployed as installable PWA
- Backend/DB: Firebase (Firestore for data, FCM for push, Firebase Auth — Google Sign-In — for the 3 users/roles)
- Offline: local persistence with sync-on-reconnect (see Section 13)
- Dev environment: Claude Code via Claude mobile app, vibe-coded, laptop available when needed

---

## 17. Development Plan (Claude Code build steps)

A numbered, function-by-function build order. Each step is meant to produce something **independently testable** before moving to the next — don't start a step until the previous one's test passes. Steps map onto the four phases from the earlier draft, just broken down further.

**Step 0 — Project scaffolding**
Basic HTML/CSS/JS structure, `manifest.json`, empty service worker registration, deployed to GitHub Pages.
*Test:* App loads at the GitHub Pages URL and is installable as a PWA on an Android device.

**Step 1 — Firebase connection**
Connect the app to the Firebase project (Firestore + Auth SDKs initialized).
*Test:* App can write and read back a dummy Firestore document, visible in console/UI.

**Step 2 — Auth & roles**
Google Sign-In flow; `/users/{userId}` document created on first sign-in; role read from Firestore (admin manually set for the first user — see Section 18).
*Test:* Can sign in and out; signed-in state persists on reload; role is correctly read and displayed.

**Step 3 — App shell**
Bottom nav (mobile) / sidebar (tablet) with the 5 tabs, responsive breakpoint, placeholder screens.
*Test:* All 5 tabs are reachable; layout switches correctly between mobile and tablet widths; overscroll is disabled.

**Step 4 — Taxonomy management (Settings → Data)**
Nested Type → Category → Subcategory editor: add/rename/delete at each level, symbol field, drag-to-reorder. (The Kalorien/Diversität category planning mode from Section 7 extends this editor later, in Step 11 — not part of this step.)
*Test:* Build out a full taxonomy tree, reorder subcategories, reload the app, and confirm it persisted correctly in Firestore.

**Step 5 — Storage locations & year color map (Settings → Data)**
Admin-managed storage list; year → color config table with a "no badge" option.
*Test:* Add/edit/remove storage locations and year colors; changes persist.

**Step 6 — Product data model (simplified)**
`/products` collection: `name`, `subcategoryId`, `unitType` (kg | stueck) — no conversion factor. **No standalone admin catalog-management screen** — an earlier version of this step built one (with a conversion-factor field), but it turned out to add nothing once the conversion factor was dropped and inline creation (Step 7) covered the real need; that screen is retired.
*Test:* Folded into Step 7's test — a product created inline during check-in has the correct fields in Firestore.

**Step 7 — Stock check-in (Einlagern) guided flow**
Type → Category → Subcategory tiles → Product list (from catalog, filtered, with "+ Neues Produkt") → detail form (quantity, details free text, best-before via the two-column date-picker modal, storage, plus a content/weight field for kg-tracked products or nothing extra for Stück-tracked ones) → confirm → writes a new stock batch. Confirming shows the "Rückgängig" undo toast (see Section 15). A global product-name search is also available at the Type step, jumping straight to the detail form for a match anywhere in the catalog. Barcode-scan entry point evaluated and deferred — see Section 19.
*Test:* Complete a full check-in end to end for both a kg-tracked and a Stück-tracked product; the resulting Firestore documents have all fields correct; a brand-new product typed at "+ Neues Produkt" gets added to the catalog with the right `unitType`; tapping "Rückgängig" on the toast deletes the just-created batch and returns to the two big buttons, while letting it time out keeps the batch.
**Status: built (Build 27), verified on device.**

**Step 8 — Stock check-out (Entnehmen) guided flow**
Same drill-down, but the product/batch step shows real existing batches with full inline detail and color badge; quantity stepper removes stock. Confirming shows the same undo toast.
*Test:* Checking out reduces the batch's quantity correctly; checking out the full quantity removes or zeroes the batch appropriately; badge color matches the configured year-color map; tapping "Rückgängig" restores the removed quantity (or un-zeroes/recreates the batch if it was fully removed).

**Step 9 — Admin stock table**
Sortable/filterable table (Product, Subcategory, Category, Type, Quantity, Content, Best-before, Storage), default sort Product→Subcategory→Category→Type, multi-select bulk delete, tap-through to the shared edit/delete detail view.
*Test:* Sorting by each column works both directions; filters and search narrow results correctly; multi-select bulk delete removes the right batches; single-row edit saves correctly.

**Step 10 — Dashboard**
Alerts preview (3-month horizon, scrollable, "Alle anzeigen" → full list with 1 Monat/6 Monate/Bis Jahresende selector); gaps summary (conditional preview + full list); totals-with-targets tiles + hierarchical Type→Category→Subcategory drill-down; shopping list preview + full detail.
*Test:* Dashboard accurately reflects real stock data — alerts match actual best-before dates, gaps match actual targets vs. stock, totals sum correctly in kg (or as plain counts for Stück-tracked categories).

**Status: fully built** — Totals/Gaps, Alerts, and Einkaufsliste (shopping list), Lebensmittel + Wasser, as three tabs (**Bestand / MHD / Einkaufsliste**) via the same `.segmented`/`.seg-btn` control Settings → Daten uses for Taxonomie/Lagerorte/Jahresfarben — placed directly in the screen rather than under a settings-panel header, since Übersicht is a top-level nav tab, not a Settings sub-panel. All three panels render on every data refresh regardless of which is visible (only a `hidden` class toggles), matching how Daten/Ziele's tabs already work.
- **Bestand tab**: tap-to-expand category cards (current vs. target, a progress bar, a color-coded reicht-X-Wochen chip) and a hero card for the Lebensmittel-wide total, all through the same kg/kg-per-Person&Tag/kcal/kcal-per-Person&Tag toggle Ziele uses. Wasser gets its own hero card next to the Lebensmittel one instead — one global current-vs-target figure in liters, no category cards, since a Wasser type has no per-category target to expand (see Section 7). Sonstiges categories are excluded entirely — no autonomy-duration/kcal framing applies to them. Current stock ("Vorrat") is computed from `/stockItems` via each batch's product → `subcategoryId` (never by the batch's own denormalized category/subcategory name text) using the `content`-parsing rule from Section 5; **Stück-tracked products inside a food category have no kg conversion factor and are excluded from every Kategorien/Wasser sum for now** — a known gap to close later. Tapping a subcategory (admin only) jumps to Settings → Bestandsliste pre-filtered to it via a `subcategoryId`-based filter (not the free-text search).
- **MHD tab**: a horizon selector — **MHD erreicht / 1 Monat / 6 Monate / 12 Monate** — plus the full sorted list of what's due (danger-tinted if overdue/due this month, warn-tinted if due next month). Each button is its own **exclusive band**, not a cumulative "everything up to here": MHD erreicht = due this month or overdue, 1 Monat = exactly next month, 6 Monate = months 2-6 out, 12 Monate = months 7-12 out — picking a wider band never re-shows what a narrower one already covered. (An earlier version used "Bis Jahresende," a calendar cutoff rather than a fixed duration, which broke the exclusive-band ladder for roughly the second half of every year; replaced with a clean fourth duration step.) Unlike the Bestand tab, MHD covers *every* batch regardless of Lebensmittel/Wasser/Sonstiges — a best-before date matters for medicine or batteries too, and there's no kcal/autonomy-framing dependency here forcing the exclusion. `bestBefore` is month-precision only ("MM/YYYY"), so the horizon comparison is a month-index range comparison, not a day-level one. Tapping an entry jumps to Bestandsliste with the product name in the free-text search (no subcategoryId filter needed for a single product). (An earlier version showed a compact preview strip on the Bestand tab with an "Alle anzeigen" button opening this as a modal — replaced by its own tab once there were three substantial pieces of content to navigate between, so the full view no longer needs a preview/expand indirection.) On tablet (≥900px), the list lays out three columns wide instead of one, each column filling top-to-bottom before the next starts (CSS multi-column, not grid — grid would fill left-to-right row by row instead).
- **Einkaufsliste tab**: the Bestand tab's gaps data re-surfaced as "what to buy," grouped by category: every subcategory below target (from the Kategorien cards, so Lebensmittel-scoped by construction), every individual product with a manual Ziele target that's short (deliberately *not* Lebensmittel/Wasser-scoped — a Sonstiges product target like "10 Batterien" belongs on a shopping list just as much as food does), and the Wasser hero's own shortfall if any. No checkboxes — a "mark as bought" tick would be state the app has to maintain for no real benefit, since actually checking stock back in via Einlagern is what closes the gap and drops the item off the list on its own. Product-level gaps sidestep the Stück/kg-conversion gap above: a piece count needs no content-string parsing at all, so Stück-tracked products work here even though they don't in the Kategorien cards. (Same preview-card-plus-modal history as MHD, replaced the same way.) On tablet (≥900px), the list splits into two side-by-side columns — always at a category boundary (each category's full block goes to whichever column currently has fewer items, a simple greedy balance), never mid-category.

**Step 11 — Targets & Autonomy-Based Stock Sizing (Settings → Taxonomie, Settings → Planung, Settings → Ziele)**
Extends the Step 4 taxonomy editor with the exclusive Kalorien/Diversität/Aus category planning mode (Section 7), gated by the type-level Lebensmittel/Wasser/Sonstiges class. Builds Planung: household roster CRUD, autonomy-duration + macro-split + water-rate config, and the resulting global numbers (Kohlenhydrate/Protein/Fett kcal, Wasser liters) — no apply action. Builds Ziele: manual flat/Personen×Tage targets for Aus categories/subcategories/products (unchanged from the original per-level target system), plus live-computed targets for Kalorien/Diversität categories with the ±5%-stepper macro-split and subcategory-split UI, plus the kg/kg-per-Person-Tag/kcal/kcal-per-Person-Tag display toggle. Wasser-classed types don't appear in Ziele — their global target shows in Übersicht (Step 10) instead.
*Test:* Setting a manual target on an Aus category, subcategory, or product works as before. Separately: build out a household + autonomy duration + macro split + a Kalorien-tagged category, confirm its computed kg in Ziele matches the Section 7 formulas; add a second category to the same macro and confirm the ±5% steppers keep the group summing to exactly 100% and reallocate correctly in both directions; confirm a category's subcategories split its computed total the same way. Water: tag a type Wasser, add stock under it, confirm Übersicht's water hero current/target matches the summed stock and people × days × rate respectively. Diversity: confirm a Diversität category's computed kg matches its floor formula, independent of any macro category.

**Step 12 — Checklists**
Maintenance: grouped-by-frequency list, checkbox detail, auto-reset + `nextDue` roll-forward on completion, Settings → Checklists CRUD with per-checklist recipients. Crisis: card list, full-screen high-contrast reference view, Settings → Checklists CRUD for steps.
*Test:* Complete a maintenance checklist and confirm `nextDue` advances correctly by its frequency and all checkboxes reset; crisis reference view renders in its distinct style with no checkboxes.

**Status: built**, with five deliberate deviations from the plan above, confirmed with Markus during Step 12 design — see Section 8, Section 12, and Section 15 for the reasoning behind each: no Bestand/Ziele link at all (not even optional); no `nextDue` roll-forward, replaced by a derived reset-boundary comparison against an admin-configured weekday schedule (Build 74, Section 12) rather than a plain calendar bucket; no "einmalig" frequency (folded into yearly, and the frequency set itself is weekly/monthly/quarterly/half-yearly/yearly — half-yearly added, quarterly kept, per Markus's explicit "add both weekly and quarterly back" call); no Settings → Checklisten submenu — content editing is an admin-only pencil toggle inline on the Checklisten screen itself; and the maintenance editor is a flat, filterable, alphabetically-sorted list of every item across every checklist rather than nested per-checklist blocks, since ~113 real items needs search + filter chips (Checkliste/Häufigkeit) to stay usable, plus a "move to checklist" `<select>` per item instead of drag-and-drop, with no checked-state UI duplicated there (the live view's Fällig/Alle toggle already covers it) and two collapsible sections to keep the screen manageable. The reminder *schedule* itself (which weekday/occurrence/month each frequency resets on) lives in a genuinely separate Settings card, Erinnerungen — a one-time structural setting, unlike the frequently-edited checklist content, so it correctly stayed in Settings even as content editing moved out. The one-time "Bekannte Checkliste importieren" seed button (Build 74) was removed in Build 75 once the real ~113-item list was safely imported into `/config/checklists`. Build 76 added a Checkliste filter-chip row to the live view too (hide/show whole checklist groups, independent of the editor's own filter) and tablet-only (≥900px) layout: two-up checklist cards on the live view, and one-line item rows in the editor instead of two.
*Test:* Tick a maintenance item on the live view, confirm it shows done and reappears unchecked once its schedule rolls past the next occurrence (spot-check via Settings → Erinnerungen by picking a weekday close to today, or by editing `lastCompletedAt` directly in Firestore); Fällig/Alle toggle filters correctly on the live view, including revealing and letting you un-tick already-done items under Alle; as admin, tap the pencil icon top-right, confirm the view swaps to the flat editor in place, defaulting to A→Z alphabetical order and no checkbox on any row; collapse and expand both "Checklisten verwalten" and "Einträge" via their chevrons; use the search box and the Checkliste/Häufigkeit chips together and confirm the list narrows correctly; move an item to a different checklist via its select and confirm it appears there immediately and disappears from the old one; add/rename/delete a checklist via the manage section and an item via the flat list, tap "Fertig" and confirm the live view reflects every change; confirm the pencil icon is invisible when signed in as a non-admin member; add a crisis type with steps via the same pencil toggle on the Krise tab, confirm the full-screen high-contrast reference view still has no checkboxes; in Settings → Erinnerungen, confirm every dropdown (including Wöchentlich's) shares one visual style, each frequency has its own bold heading, and the dropdowns stay aligned regardless of label line-wrapping; change a frequency's weekday/occurrence/month and confirm the live Wartung view's Fällig/Alle split updates accordingly.

**Step 13 — Info section (Contacts / Notes / Recipes)**
Pinned emergency contacts + general list + detail view; notes list + detail; recipes tag-filtered photo grid + detail. Inline admin-only add/edit on all three.
*Test:* CRUD works on all three; emergency contacts render in the pinned section; recipe tag filter narrows the grid correctly; phone numbers are tappable (`tel:` links) and open correctly.

**Status: Kontakte + Notizen built (Build 90/92), Rezepte not yet.** Info is now a `.segmented` Kontakte/Notizen/Rezepte tab bar (`js/info-nav.js`, generic switcher so Notes/Recipes don't depend on Contacts for their own tab bar) — the same shape as Übersicht's Bestand/MHD/Einkaufsliste tabs. Kontakte (`js/contacts.js`): pinned "Notruf & Wichtige Kontakte" section (danger-tinted, hidden entirely when empty) above the general list, both sorted alphabetically; each row shows name + role, a tap-to-call `tel:` icon, and (admin only) an edit pencil, all `stopPropagation`-guarded so tapping either doesn't also open the row's own detail view; tapping the row body opens a read-only detail view (rows for empty fields — role/address/notes — are hidden individually rather than shown blank). Admin-only add/edit is inline (a "+ Kontakt" button, the per-row pencil, and a "Bearbeiten" button inside the detail view itself) rather than a Settings submenu, matching Section 9/15's "content you'd add while browsing" reasoning; mode-switching inside the shared detail/edit modal uses two separate button-wrapper divs (`#contact-view-actions`/`#contact-edit-actions`) rather than toggling `.hidden` directly on the buttons themselves, specifically to avoid the exact "`.hidden`'s `!important` silently wins over a custom show/hide toggle on the same element" bug class fixed for the crisis reference in Build 83 — the admin-only buttons keep their own independent visibility concern nested inside the mode wrapper's. `/contacts` is a new top-level Firestore collection (not `/config`) with its own security rules: any signed-in member can read, only admin can write — same reasoning as `/products`, since this is per-record content rather than a single shared config document. Build 91 fixes: Telefon (`type="tel"`) was unstyled and looked visibly different from the other fields — `.form-group`'s input styling only ever covered `type="text"`/`select` (plus a later `type="number"` carve-out for Planung/Ziele), the same bug class each time a new input type gets introduced without extending that selector list; folded `type="tel"` into the `type="text"` rule since it wants the identical look. "+ Kontakt" now also checks `loadOk` before opening the add form (previously only the Speichern handler did), so a failed initial load — e.g. testing before the `/contacts` security rules above are actually deployed — is caught on the "+" tap itself instead of after filling out a whole contact.

Notizen (`js/notes.js`, Build 92): same list/detail/modal shape as Kontakte (list by title, tap for a read-only detail view, admin-only inline add/edit), the one real addition being photos. **No Firebase Storage** — the project stays on the free Spark plan (Section 18), which has no free Storage tier, and Storage was never provisioned — so photos are compressed/resized client-side (canvas downscale to a 1000px longest side, JPEG quality 0.6) and stored inline on the note document itself as base64 data URIs, capped at 3 photos per note with a rough total-size check before save (~700KB of encoded photo data, leaving headroom under Firestore's 1MB document limit for the title/body text and Firestore's own overhead) — a clear "remove a photo" alert on hitting the cap rather than a cryptic Firestore write failure. This is a deliberate tradeoff (confirmed with Markus): fine for a handful of reference photos per note, not a real photo gallery — revisit with real Firebase Storage if that's ever not enough, which needs the paid Blaze plan. `/notes` is a new Firestore collection with the same security-rules shape as `/contacts`: any signed-in member can read, only admin can write. Also added: `.form-group textarea` styling (the app's first multi-line field, for the freeform note body — Details/notes fields everywhere else in the app are single-line).

**Step 14 — People management (Settings → People)**
Role toggle per signed-in user.
*Test:* Toggling a member's role actually changes what they can access in the app (not just a display change).

**Step 15 — PDF export**
Per-section PDF generation (Stock, Checklists, Contacts, Notes, Recipes).
*Test:* Each export produces a readable PDF matching the current on-screen data.

**Step 16 — Offline support & sync**
Local persistence (Firestore offline cache or custom store); last-write-wins sync-on-reconnect. Also implement the explicit crisis-checklist pre-cache from Section 13 (fetch and store all `/crisisTypes` on sign-in and on data change, independent of whether that screen has been opened).
*Test:* Put the device in airplane mode, perform a check-in/check-out, reconnect, and confirm the change syncs to Firestore correctly. Separately: sign in online, never open the Crisis tab, then go into airplane mode and confirm the crisis reference view still renders full content from the pre-cache.

**Step 17 — Push notifications (FCM)**
Best-before alerts and checklist reminders, respecting per-checklist recipient config; service worker + notification permission flow.
*Test:* Trigger a notification (e.g. by setting a near-term best-before date) and confirm it's received on an Android device even with the app closed.

**Step 18 — QR / Labels**
QR generation encoding product/batch reference IDs; printable flexible HTML label template; camera-based scan (secondary entry point within the guided Stock flow). Erdkeller's own generated QR labels only — retail barcode scanning is a separate, deferred idea (Section 19), not part of this step.
*Test:* Generate a QR for a batch, print or display it, scan it with the device camera, and confirm it correctly opens that batch in the check-in/check-out flow.

**Step 19 — Manual CSV export**
"Download backup (CSV)" button (Settings → Export).
*Test:* Downloaded CSV contains complete, correctly-formatted stock data.

**Step 20 — CSV import (end-game)**
Full-database-replace import from a CSV file.
*Test:* Importing a CSV correctly replaces all Firestore stock data, with a confirmation step before the destructive replace happens.

**Step 21 — Global search**
Search icon in the shared app shell opening a cross-section search (Stock, Contacts, Notes, Recipes), results grouped by section, tapping a result opens that item's detail view. Built last since it depends on all four sections' data/detail views already existing.
*Test:* A query matching items in more than one section (e.g. a product name that's also a note title) returns grouped results from each; tapping a result from any group navigates to the correct detail view in the correct section.

---

## 18. Manual Setup Steps (your side)

These need to happen outside Claude Code — mostly account/console setup that only you can do, since they require your credentials. Doing these upfront (roughly before or during Step 0–1 above) lets Claude Code get straight to building without blocking on access.

1. **Create a GitHub repository** for the project (public is fine for a GitHub Pages site with no secrets committed — see note on Firebase config below).
2. **Enable GitHub Pages** on the repo (Settings → Pages), pointing at the branch/folder Claude Code will deploy from.
3. **Create a Firebase project** (console.firebase.google.com).
4. **Enable Firestore Database** in the Firebase project — choose a region close to France (e.g. `europe-west1` or `europe-west3`) for lower latency.
5. **Enable Firebase Authentication** → turn on the **Google** sign-in provider.
6. **Register a Web App** within the Firebase project to get the Firebase config object (`apiKey`, `authDomain`, `projectId`, etc.) — share this with Claude Code so it can be wired into the app. This config is not secret (it's normal for it to be public in a client-side app), but real access control comes from **Firestore Security Rules**, which Claude Code should set up to restrict reads/writes to the three authenticated family members only.
7. **Generate a Web Push (VAPID) key** in Firebase (Project Settings → Cloud Messaging) — needed for Step 17 (push notifications), but fine to do later, right before that step.
8. **Sign in once yourself** via the deployed app once Step 2 is built, then **manually set your own user document's `role` field to `"admin"` directly in the Firestore console** — this is a one-time bootstrap step, since the app has no admin yet on the very first run. After that, all further role management happens in-app (Settings → People).
9. **Have Julia and Sophia sign in once** via the app (once Step 2 is built) so their user documents exist — you can then confirm their role is `"member"` in Settings → People (should be the default).
10. **Firebase billing plan**: stay on the free **Spark plan** — nothing in this spec requires the paid Blaze plan (scheduled Cloud Functions were explicitly ruled out in favor of manual CSV export). No action needed unless priorities change later.
11. **Label printer**: no rush — pick one whenever convenient, and let me know so we can finalize the label template (still the one open item in Section 19).

---

## 19. Remaining Open Items

- Label printer/size — to decide once a printer is chosen (template stays flexible until then)
- **Drag-to-reorder doesn't work on real devices yet** (taxonomy editor, Settings → Data, Step 4): implemented with the Pointer Events API to avoid native HTML5 drag-and-drop's lack of touch support, but on an actual test it still doesn't work — on mobile, a press-and-hold just selects text; on tablet, it opens the browser's context menu. Something about the current handling isn't actually suppressing the platform's default touch/long-press behavior on the drag handle. Deliberately deferred — revisit later.

### Nice to have / Future ideas

- **Barcode scanning (retail products), via Open Food Facts**: evaluated during Step 7 and deliberately not built. Same underlying tech as QR scanning (Section 11) — EAN/UPC is just another symbology the same browser-based scanning library reads — and lookup would hit the free, no-key [Open Food Facts](https://world.openfoodfacts.org) API directly from the browser. Shelved for two reasons: (1) narrower payoff than expected — OFF's category tree doesn't map to Erdkeller's custom taxonomy, so the Type→Category→Subcategory drill-down still has to happen manually either way, and there's no best-before data to pull (that's always batch-specific/manual); the only real win would be pre-filling the product name and a content/size string. (2) **the pre-filled name is the wrong name** — OFF returns full retail labels ("Barilla Top Ultra Fine Cooking Spaghetti") where Markus wants short generic stock names ("Spaghetti"), so auto-fill would need manual editing on every single scan anyway, undermining the "accelerant" premise. If revisited, it'd need either a stricter one-word-generic-name convention accepted at review time, or a mapping/alias step — neither trivial. Coverage also isn't complete (smaller/regional brands, home-repackaged goods).
- **Nutrition-table / best-before-date photo OCR**: ruled out earlier for the same categories of reasons (Section 11 history) — not needed by the category-level calorie system (Section 7), and both have materially worse accuracy/cost tradeoffs than barcode lookup already was.

---

## 20. V2 Ideas (Not Yet Scoped) — Monetization & Local-First Persistence

*Two fully-drafted proposals, captured here so they aren't lost. Neither is in scope for the current build (Section 17's Development Plan) — nothing below should be implemented until this chapter is explicitly picked up and actually scoped into a step. Kept as close to the original drafts as possible rather than compressed to a summary.*

### 20.1 Monetization Model, Distribution & Tier Transitions

#### 20.1.1 Distribution: staying PWA, no native app store
Erdkeller stays a PWA rather than migrating to native Android. Distribution is via a companion website (20.1.7) rather than an app store listing. This avoids Google Play's 15–30% cut on in-app purchases and the requirement to use Google Play Billing instead of Stripe. Android PWAs already support install-to-homescreen, push notifications, and full offline behavior, so nothing functional is lost by staying PWA. (Optional future consideration, not required: Trusted Web Activity wrapping for Play Store discoverability, which would reintroduce Google's billing cut for anything sold through that specific listing.)

#### 20.1.2 Monetization model overview
The app's usage pattern — infrastructure that sits quietly and is updated occasionally, not a daily-engagement app — makes a pure subscription a psychologically harder sell. The chosen model separates the app itself (one-time purchase) from multi-device sync (optional subscription), because sync is the piece with genuine ongoing hosting cost, while the core app has none once purchased.

**Chosen structure:**
1. **Thirty-day free trial** — full functionality, unlimited devices, full multi-device Firebase sync included (see 20.1.3 for why the trial shouldn't be artificially limited).
2. **One-time purchase** (indicative: €20–30) — unlocks the core app permanently on a device: all local functionality, offline crisis checklists, full editing, no sync required. The permanent foundation every user eventually needs beyond the trial.
3. **Optional monthly sync subscription** (indicative: ~€2/month) — unlocks multi-device Firebase sync, addable/removable independently of the one-time purchase at any point (immediately after purchase, or months later; cancellable and re-subscribable without losing the one-time unlock). Priced to cover Firebase's actual hosting/bandwidth cost, not as a profit-driving tier.

The one-time purchase and the sync subscription are independent toggles, not a linear upgrade path: one-time-purchase-alone (solo, full editing, no sync) and one-time-purchase-plus-sync (full editing, multi-device) are both valid states, added/removed on their own timeline.

#### 20.1.3 Trial scope: full sync, unlimited devices, no artificial caps
During the 30-day trial, the app must **not** limit device count or restrict sync:
- This is a family app — capping devices during the trial (e.g. 2 of 3 family members) gives an incomplete test and forces an awkward "who gets locked out" moment during the very trial meant to build trust.
- Multi-device sync is one of the app's most compelling features — a family actually seeing a check-in on one phone appear instantly on another is far more convincing than describing it in marketing copy. Cutting it off mid-trial undersells the best feature instead of demonstrating it.
- A full-featured, unlimited-device trial means one clean decision at day 30 (subscribe, purchase solo, or degrade — 20.1.4) instead of navigating a confusing combination of device-count and time constraints.

#### 20.1.4 End-of-trial behavior: graceful degrade, not lockdown
If a user takes no action at trial end, the app must **not** hard-lock or block access to their own data — that would contradict the core "your data is always safe and local" value proposition if payment lapse blocked access to that same data.

**Required behavior**: the app drops to **read-only/view-only mode**, locally:
- All existing data (stock, checklists, contacts, notes, recipes) stays fully visible on-device, sourced from the local IndexedDB mirror (20.2.2).
- No further add/edit/check-in/check-out or other write actions permitted.
- Firebase sync stops (20.1.5 covers the data hand-off at this transition).
- A persistent but non-intrusive banner communicates the state, e.g. "your data is safe — unlock full editing with a one-time purchase, or continue syncing across devices for [price]/month," linking to the purchase/subscription flow.

This preserves trust (data is never hidden or held hostage) while creating real, fair pressure to pay for the things that actually cost something: write access and ongoing sync.

#### 20.1.5 Tier transition and data hand-off logic
**Trial end without payment → read-only**: per 20.1.4. Local IndexedDB mirror remains the visible data source; nothing is deleted.

**Cancelling the sync subscription (any time) → dropping from synced to solo**: at the moment sync is cancelled, live Firebase data must be pulled down into the local IndexedDB mirror one final time as the authoritative final copy, before sync access is revoked — ensuring the local mirror reflects the true combined final state across all devices, with nothing lost when dropping to solo/single-device operation. After hand-off, the local mirror becomes the sole data store for that device (per the one-time-purchase, solo-editing tier) until/unless sync is re-subscribed to.

**Re-subscribing after a period of solo use**: needs a defined merge rule (not yet fully specified) for reconciling that device's local edits against the (potentially stale or diverged) Firebase state. Should reuse the same last-modified-timestamp-based conflict comparison as 20.2.4 (JSON backup import conflict handling) — compare per-record timestamps, never blindly overwrite newer data with older data, surface conflicts to the admin rather than silently resolving them.

#### 20.1.6 Authentication: Google Sign-In serves both tiers, not just sync
Google Sign-In should **not** be removed or bypassed for non-subscribing (solo, one-time-purchase-only) users, even though they aren't using multi-device sync. Sign-In serves two distinct purposes, easy to conflate:
1. **Identity for sync** (current/existing use) — ties multiple devices to one shared family Firebase data set.
2. **Identity for purchase verification** (new, from monetization) — even a solo, non-syncing user needs to be signed in so their one-time purchase is tied to an identity rather than a device. Without this, a user who gets a new phone has no way to prove they already paid and restore full editing.

So Google Sign-In stays in the flow for both tiers; what changes is how much Firebase is actually used for data (fully, for sync users; minimally or not at all, for solo users relying on the local IndexedDB mirror per 20.2).

#### 20.1.7 Payment mechanics: Stripe, and the role of a companion website
Payment (one-time purchase and recurring subscription) can be triggered directly from within the app via Stripe Checkout or Stripe's payment elements — this doesn't strictly require a separate website for the transaction mechanics themselves.

However, a minimal companion website is the practical, expected complement, for three reasons:
1. Stripe Checkout typically redirects to a hosted payment page and back to a success/cancel URL — a brief moment of leaving the in-app view even if it feels seamless.
2. Users need somewhere to access receipts, invoice history, and manage/cancel a subscription without going through the app itself — Stripe's Customer Portal handles this well but needs a link/page to reach it.
3. For trust and legitimacy with a paying audience — especially an app touching family data and crisis planning — a real webpage describing the product, pricing, and a privacy policy is expected, not optional.

Recommended minimal scope: a single page covering what the app does, pricing (one-time purchase price, sync subscription price), a link into the Stripe Customer Portal, plus a basic privacy policy.

### 20.2 Local Persistence, Offline Guarantee, Export/Backup & Sync Conflict Handling

#### 20.2.1 Architecture principle: Firebase remains the single source of truth
Firebase/Firestore remains the authoritative backend, exactly as currently designed: real-time multi-user sync, Google Sign-In per family member, shared data across all devices, with each signed-in user acting as themselves (admin or member) per the existing role rules (Section 3).

This is explicitly **not** a local-first architecture where each device's local database is its own independent source of truth requiring peer-to-peer conflict resolution — that was considered and rejected: it would give up the multi-user real-time sync that already works well, in exchange for problems (independently-writable local databases needing reconciliation across devices) that outweigh the benefit.

#### 20.2.2 Guaranteed local persistence layer (explicit IndexedDB mirror)
In addition to Firestore's default built-in offline cache (somewhat opaque, and prunable by the SDK under storage pressure — the "e.g." mentioned in Section 13's current offline note), the app should maintain an **explicit, app-controlled local mirror** of Firestore data in IndexedDB (e.g. via Dexie or equivalent).

Key properties:
- Written to deliberately by the app on every sync, not just relied upon as an incidental SDK cache.
- The app requests persistent storage permission from the browser so this data isn't subject to casual eviction under disk pressure.
- Crisis checklists specifically must be guaranteed present in this local mirror from first load — the one section where offline access is mission-critical, not just convenient (already the intent behind Section 13's crisis-checklist pre-cache guarantee; this is the persistence layer that guarantee actually depends on).
- Storage location (for documentation/support purposes): on Android, this data lives in the browser's or installed PWA's private, sandboxed app-data directory — not browsable via a normal file manager, not visible to the user directly, and not cleared by normal app backgrounding or device reboot. Only cleared by the user manually clearing app storage or uninstalling the PWA — which is why installing to the home screen (rather than a loose browser tab) matters for the persistence guarantee.

#### 20.2.3 Export feature: two distinct formats for two distinct use cases
Export should read from the local IndexedDB mirror (not a fresh Firebase call), so export always works offline too, consistent with the crisis-app design philosophy.

Two separate export options, not one format serving both purposes:

1. **CSV export (per-section)** — for opening/editing data in a spreadsheet (e.g. reviewing/editing stock or contacts). Already specified (Section 14). Good fit since CSV is human-readable and universally spreadsheet-compatible.
2. **Full JSON export/backup** — for faithful backup, restore, or device-to-device transfer. CSV is a poor fit here because Erdkeller's data is relational (stock items reference products, products reference taxonomy, checklists have nested steps, contacts have nested detail fields) — CSV can't represent this across linked tables without fragile manual reassembly on import. JSON mirrors Firestore's own document structure one-to-one, so export is close to a direct dump and import close to a direct restore, with no lossy flattening.

Import (an end-game/Phase-4 feature per Section 14) should only need to support JSON, not CSV — restoring a hand-edited CSV back into a relational structure is the fragile direction and not a real requirement.

#### 20.2.4 Conflict handling on JSON backup import (critical safety rule)
Scenario: a user exports a local backup, time passes, Firebase continues to be edited normally by the family (e.g. for a week), and that old backup gets reimported on some device. Naive import risks silently overwriting a week of genuine changes with stale data, because the *write* happens now even though the *content* is old.

**Required rule**: every record carries its own last-modified timestamp as a stored data field (distinct from when a write physically occurs — also useful as a "last edited by/at" transparency field; turns out to be load-bearing for this conflict-handling requirement, not merely cosmetic).

Import logic must compare, per document, whether the backup's stored timestamp is newer than the currently-live Firebase version, and must not blindly overwrite newer live data with older backup data.

Given import is already a rare, deliberate, admin-only action, and the family is small, the recommended behavior is conservative rather than automatic silent merging: before committing an import, show a comparison — e.g. "this backup would overwrite N items that have changed since [date]" — so the admin explicitly confirms before anything is overwritten, rather than the app silently resolving conflicts on its own.

#### 20.2.5 Monetization/platform note
Context for why 20.2 matters commercially: if Erdkeller is ever sold (20.1), staying PWA rather than migrating to native Android is the recommended path — Google Play would take a 15–30% cut on any in-app purchase/subscription and require Google Play Billing instead of Stripe, whereas the PWA path keeps full control of billing (Stripe + Firebase Auth gating access per household) with no store review process.

The guaranteed local persistence layer (20.2.2) is also a genuine product/marketing point for a crisis-preparedness app: data is confirmed to survive on-device even without connectivity — a claim that can be made accurately rather than assumed.
