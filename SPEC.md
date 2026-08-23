# Erdkeller — Stock Management & Crisis Preparation App
## Specification v14

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
/checklists/{checklistId}        title, frequency, recipients, nextDue
/crisisTypes/{crisisId}          title, steps
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
  unitType: "kg" | "stueck"  // set once per product, not per subcategory — determines
                              // whether this product's stock is tracked in kg (from batch
                              // content) or as a plain count (medication, batteries,
                              // animal-feed sacks, etc.)
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

A calorie- and water-driven calculator that **pre-fills the existing per-level target system** (Section 6, Settings → Targets) with suggested kg values — a calculator you review and apply, not a formula that stays live-linked to your targets afterward. Lives in its own admin Settings sub-section, **Settings → Planung**.

Everything here is deliberately approximate — the whole exercise is about getting *roughly* the right balance of calories, macros, and diversity for a given autonomy duration, not a precision nutrition tool.

### Household roster
- A separate admin-managed list of household members (`/config/household`), independent of `/users` — covers everyone who eats, including household members without their own app sign-in (e.g. children)
- Each member: name + a **freely entered daily kcal value**. Reference ranges are shown as hints in the UI, not enforced or baked into app logic: Kind ~1200–1800, Teenager ~2000–2200, Erwachsener ~2000–2500 — adjusted upward by the admin for higher physical activity. No fixed age/activity lookup table in the app; this stays a judgment call by design.

### Autonomy duration & macro split
- Admin sets a target autonomy duration in days (`/config/planning.autonomyDays`). No hard default is enforced, but the UI should suggest **90 days** as a common starting benchmark.
- Total kcal target = sum(household members' daily kcal) × autonomyDays
- Macro split: adjustable percentages of that total, default **50% Kohlenhydrate / 20% Protein / 30% Fett**

### Category kcal/kg + macro tagging
- Each taxonomy **category** (Section 4/5, `/config/taxonomy`) gets two new **optional, admin-editable** fields, set directly in the existing category editor (Section 17, Step 4): `kcalPerKg` (number) and `macroType` (`kohlenhydrat` | `protein` | `fett`).
- Categories without these fields simply don't participate in the calorie system — their targets stay purely manual. This is the expected, normal case for non-caloric categories (Medizin) and for produce categories governed by the diversity floor instead (see below).
- **Deliberately admin-editable data, not hardcoded in app code.** The taxonomy is fully custom per household and actively evolves — matching in code by category name breaks silently on rename (which the taxonomy editor fully supports); matching by ID requires an awkward manual handshake every time the taxonomy changes. Two more optional fields on an already-editable category row is a small, consistent extension of existing functionality rather than new, more fragile architecture.

**Suggested starting values**, worked out for Markus's actual category list (kcal/kg figures are household-planning-grade estimates, not lab values):

| Category | kcal/kg | Makro |
|---|---|---|
| Fette, Öle & Nüsse | ~7000 | Fett |
| Fisch, Fleisch, Eier | ~2000 | Protein |
| Getreide & Hülsenfrüchte | ~3600 | Kohlenhydrate |
| Milch & Milchprodukte | ~2800 | Fett |
| Sonstiges | ~4000 | Kohlenhydrate |
| Medizin | — | *(ausgeschlossen)* |
| Gemüse | — | *(ausgeschlossen → Diversitäts-Mindestmenge)* |
| Obst | — | *(ausgeschlossen → Diversitäts-Mindestmenge)* |

This assumes a small taxonomy restructuring (a data edit via the existing Step 4 editor, not a code change):
- **Fette & Öle** → renamed **Fette, Öle & Nüsse**; "Nüsse, Kerne, Samen" moves in from Obst & Nüsse (nuts are fat-dominant, same order of magnitude as oil — folding them in loses much less accuracy than leaving them with low-density fruit)
- **Getreideprodukte** → renamed **Getreide & Hülsenfrüchte**; "Hülsenfrüchte getrocknet" moves in from Gemüse & Hülsenfrüchte (dried legumes behave like a carb staple, not a vegetable, and land almost exactly on the existing grain density)
- **Gemüse & Hülsenfrüchte** → renamed **Gemüse** (remaining subcategories: Hülsenfrüchte eingelegt, Tomaten/Sugo, Eintopf (Gemüse), Eingelegtes Gemüse, Frisches Gemüse/Kartoffeln)
- **Obst & Nüsse** → renamed **Obst** (remaining subcategories: Eingelegtes Obst/Kompott/Mus, Trockenfrüchte, Frisches Obst)

Canned/pickled/dried fruit and vegetables **stay fully in the taxonomy and stock system** either way — this restructuring only affects which categories feed the calorie calculator, not what's trackable as stock.

### Output & applying to targets
- **No automatic cross-category split.** When a macro has multiple tagged categories, the calculator shows the macro-level kcal total plus its kg-equivalent computed per tagged category, as a reference — the admin manually decides the actual per-category kg targets from that. An automatic split (equal? weighted by existing stock?) would be arbitrary, so this stays a human decision.
- An explicit **"Auf Ziele anwenden"** action writes the reviewed numbers into the regular `/config/targets` structure. From that point on they're indistinguishable from any other manually-set category target — no live link back to the calculator.

### Diversity / micronutrient floor
- Independent of the calorie/macro math, since calorie math alone can't guarantee vitamin adequacy. A **minimum kg floor per person per day**, settable on any category as a third optional field alongside `kcalPerKg`/`macroType`.
- Suggested defaults: **Gemüse ~50 g/person/day**, **Obst ~30 g/person/day** — rough placeholders (there's no authoritative figure for stockpiled preserved/dried produce specifically), using the same people × autonomyDays formula as the calorie system, freely adjustable.
- **Vitamin C is deliberately not modeled via a produce floor.** Canned and dried produce loses significant vitamin C through heat processing and storage time, making a weight-based floor an unreliable guarantee. Recommended instead: stock a stable vitamin C supplement as its own product, with a manually-set target computed from the RDA directly — roughly 90 mg/day × people × autonomyDays ÷ mg per tablet. This is a one-time manual calculation using the existing per-product target field, not a feature the app needs to compute.

### Water
- A parallel, simpler calculator: **liters/person/day** (admin-adjustable, default **3 L**, covering drinking + basic cooking/hygiene) × household size × autonomyDays → a suggested kg target for the Wasser category.
- 1 L of water = 1 kg, so water is just a normal **kg**-tracked category/product like any other — no new unit type needed.
- No macro split or category tagging needed — water is a single homogeneous need mapping directly to one category, unlike the calorie system's multi-category spread.

---

## 8. Checklists

- **Maintenance checklists**: monthly/quarterly/yearly, recurring (e.g. water tank cleaning, battery charging, diesel changing). Admin-configured; **admin decides per checklist who receives the reminder** (self only, or also Julia/Sophia). List is **grouped by frequency** (all monthly checklists together, then quarterly, then yearly) rather than sorted by due date.
- **Crisis checklists**: fully open — admin can create new crisis types freely (e.g. "Power outage", "Water outage", "Medical emergency", "Evacuation"), each with its own first-steps checklist. Presented as a **large-text, high-contrast scrolling list** — a pure read-through reference, no checkboxes or step-tracking, since the goal is fast calm reading under stress rather than progress tracking.
- **Guaranteed offline availability**: crisis checklist content is explicitly pre-cached on first app load/sign-in (not just covered incidentally by general offline persistence, see Section 13) — this is the one section where offline access is mission-critical, since it's meant to be readable during outages regardless of when the device last synced.

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

### Barcode scanning (retail products)
- A separate, unrelated capability that ships earlier in the build order (folded into Section 17 Step 7, not the later QR/Labels step) since it accelerates the check-in flow rather than depending on it.
- Same underlying tech as QR scanning — a barcode format (EAN/UPC) is just another symbology the same browser-based scanning library reads, no new capability class.
- On scan, look up the barcode via the [Open Food Facts](https://world.openfoodfacts.org) API — free, open, crowd-sourced, callable directly from the browser with no API key and no backend (fits the free Firebase Spark-plan constraint, Section 18 item 10). If found, prefill the product name (and a best-effort category guess where available) at the "+ Neues Produkt" step; admin/member reviews and confirms before saving.
- Coverage isn't complete (smaller/regional brands, non-barcoded or home-repackaged goods) — manual entry always remains the fallback, this is purely an accelerant.
- **Explicitly out of scope**: photographing the nutrition table for OCR extraction, and photographing the best-before date for OCR extraction. Neither is needed by the calorie system (Section 7 works at the category level, not per-product), and both have materially worse accuracy/cost tradeoffs than barcode lookup — nutrition-table OCR would need either an unreliable client-side approach or a paid cloud vision API (reintroducing the Blaze-plan cost problem); best-before date stamps are a notoriously hard real-world OCR case even for dedicated retail inventory tools.

---

## 12. Notifications

- Firebase Cloud Messaging (FCM) for real push notifications, delivered even when the app is closed
- Reliable on all-Android device fleet (no iOS push limitations to design around)
- Triggers: best-before approaching (1/3/6 month thresholds), checklist due dates (per-checklist recipient list, admin-configured)
- Requires: service worker registration for the PWA, FCM setup in Firebase project, notification permission prompt in-app

---

## 13. Sync & Offline

- Offline-first: local persistence (e.g. Firestore's built-in offline cache, or a custom IndexedDB store), syncing to Firebase on reconnect
- Conflict resolution: **last-write-wins** (simplest approach; conflicts expected to be rare given quick check-in/out actions)
- **Crisis checklists — explicit pre-cache guarantee**: general offline persistence covers whatever's already been loaded/queried, which isn't a strong enough guarantee for a mission-critical section. On sign-in (and whenever crisis data changes), proactively fetch and store all `/crisisTypes` documents in the local store/service-worker cache, so they're readable offline even if that screen was never opened while online.

---

## 14. Backup & Data Portability

- No automatic scheduled backup for v1 (would require Firebase's paid Blaze plan for scheduled Cloud Functions) — not worth the added cost/complexity at this stage
- **Manual CSV export**: an in-app "Download backup (CSV)" button, admin-triggered, whenever desired
- **CSV import (full replace)**: planned as an **end-game / later-phase feature** — imports a CSV and replaces all data in the Firebase DB. Not urgent; sequenced after core stock/checklist/crisis features are working.

---

## 15. UI / App Structure

### Navigation
- **Mobile**: bottom nav bar, 5 tabs (Dashboard, Stock, Checklists, Info, Settings)
- **Tablet**: same 5 sections as a **persistent sidebar** instead of a bottom nav — same information architecture, more room
- Wherever a section has a list-with-detail pattern (Stock, Checklists, Info), tablet uses a **two-pane layout**: list on the left, detail/edit view on the right, so opening an item doesn't navigate away from the list
- **Global search**: a search icon in the shared app shell (top bar on mobile, sidebar on tablet) opens a single search covering **Stock (products/batches), Contacts, Notes, and Recipes** at once, with results grouped by section — distinct from the per-step search bars already embedded within the Stock guided flow and the admin stock table, which stay scoped to their own step/table. Tapping a global result jumps straight to that item's detail view in its section. Checklists aren't included (nothing free-text to search — titles are already short and visible in the grouped list).

### 1. Dashboard (default screen on open)
Each preview section shows a capped number of items (top 3–5) in a **fixed-height, internally-scrollable preview box** — so a long list doesn't push the rest of the dashboard down, but nothing is hidden either. Each has an **"Alle anzeigen"** link (top-right of its section) opening a full-screen view.

1. **Alerts** — preview: top 3–5 items due/overdue within a **default 3-month horizon**, most prominent, always visible. "Alle anzeigen" opens a full-screen list with a **horizon selector** (1 Monat / 6 Monate / Bis Jahresende) to change the window; the dashboard preview itself always stays at the 3-month default regardless of what's picked in the full view.
2. **Gaps summary** — preview: top few missing items in the same scrollable-preview pattern; **conditional**, only rendered if something is actually missing. "Alle anzeigen" opens the full list.
3. **Totals overview** — per Type, each tile shows **current vs. target** (e.g. "45 kg / Ziel: 60 kg" with a small progress bar), tappable. "Alle anzeigen" opens a **hierarchical drill-down view**: Type → Category → Subcategory, each level showing amount vs. target (expand/collapse per type).
4. **Shopping list** — quick-access button; tapping opens the full shopping list (grouped by type, checkable items).

Targets themselves are defined and edited in **Settings → Targets** (admin-only), not on the dashboard — the dashboard only displays progress against whatever targets are configured there.

### 2. Stock
Two entry points, each a **guided step-by-step flow** rather than a single browse screen (validated via interactive mockup):

**Einlagern (check-in):**
1. Type → Category → Subcategory (large tappable tiles, as in the mockup), with a "häufig verwendet" (frequently used) shortcut row and a search bar available at every step to skip drilling. A **barcode-scan button** is also available at this stage (Section 11) — scanning a recognized retail barcode jumps straight past the drill-down to the product step, or to "+ Neues Produkt" pre-filled with the looked-up name if it's not yet in the catalog.
2. **Product step**: list of products **pulled from the master product catalog** (`/products`), filtered to the chosen subcategory — not hardcoded. Shows **product name only** (e.g. "Bohnen weiß") — no weight/content shown here, since that's entered next. Includes a **"+ Neues Produkt"** option at the end of the list for the first time a product is bought (adds it to the master catalog, incl. its `unitType` — see Section 5)
3. **Detail screen**: quantity stepper, best-before, storage, plus one of:
   - **kg-tracked product**: a content field (weight/volume, e.g. "500g", "800ml") — parsed directly into kg, no conversion factor (Section 5)
   - **Stück-tracked product**: no content field needed — the quantity stepper alone is the tracked total
   - **Best-before field**: tapping it opens a **modal date picker** with two scrollable columns — months (1–12) on the left, years (2026–2040, extendable) on the right
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
- **Filters**: Type, Category, Storage (chips), plus free-text search
- **Multi-select bulk actions**: checkboxes per row enable bulk operations (e.g. deleting several expired batches at once)
- Tap a single row (outside multi-select mode) → same detail/edit view used elsewhere (quantity, content, best-before via the date-picker modal, storage, details, delete)
- This view is for admin-style bulk review and cleanup — the guided Einlagern/Entnehmen flow remains the primary daily-use path for everyone else

### 3. Checklists (Maintenance / Crisis sub-tabs)
**Maintenance:**
- List **grouped by frequency** (Monatlich / Quartalsweise / Jährlich sections), each item showing title, next-due date, status (overdue/due soon/OK)
- Detail: steps as **individual checkboxes**, auto-reset to unchecked when the cycle restarts; checklist auto-completes and rolls `nextDue` forward once all steps are checked
- Admin-only: edit title/frequency/steps/recipients

**Crisis:**
- List: crisis types as cards (Power outage, Water outage, etc.)
- Detail: **large-text, high-contrast scrolling list** of numbered steps — a pure read-through reference (no checkboxes/tracking), designed to be readable fast and calmly under stress, possibly by someone unfamiliar with the app
- Admin-only: add/edit crisis types and their steps

### 4. Info (Contacts / Notes / Recipes sub-tabs)
- **Contacts**: **pinned emergency section at top** (Notruf, Handwerker, etc.), general contacts below; list shows name, role/label, and **phone number directly on the row** (not hidden behind a tap); tap-to-call via `tel:` link on the number/call icon. Tapping the row itself (outside the call icon) opens a **detail view** with the full record (address, notes, alternate numbers, etc.) — so a contact's information is never more than one tap away, whether that's calling immediately or reading more context. **Admin-only add/edit, controlled inline** — a "+" button and per-item edit icons visible only to admin, directly within the Contacts tab (not tucked into Settings, since this is content you'd add while browsing rather than structural config).
- **Notes**: list by title → full text + photos. Same inline admin-only add/edit pattern.
- **Recipes**: **photo-first grid** (thumbnail + title) with **filterable tags/categories** (e.g. Dutch Oven, Eintopf, Brot); tap → full recipe. Same inline admin-only add/edit pattern. On tablet, full-width grid rather than two-pane.
- Tablet: Contacts/Notes use two-pane list+detail; Recipes stays a grid

### 5. Settings (admin-only)
- Grouped into sub-sections rather than one flat list:
  - **Data**: taxonomy management — **nested list editor** (Type → Category → Subcategory) with add/rename/delete **and drag-to-reorder** at each level; symbol field; optional per-category `kcalPerKg`/`macroType`/diversity-floor fields (Section 7); storage locations list; year color map
  - **People**: **role toggle per existing signed-in user** — since sign-in is Google-based and self-provisioning (Julia/Sophia already have Google accounts), there's no invite-by-email flow needed; admin just flips a member's role between Admin/Member once they've signed in at least once
  - **Checklists**: maintenance + crisis management, reminder recipients
  - **Targets**: settable at **any level** — type, category, subcategory, or individual product, whichever makes sense for that item (e.g. a flat "60kg Lebensmittel" type-level target, alongside a specific "10kg Reis" product-level target, coexisting without conflict) — using the flat-number or people×duration method from Section 6, or reviewing/applying suggestions from the autonomy calculator (Section 7)
  - **Planung**: the autonomy-based stock sizing calculator (Section 7) — household roster, autonomy duration, macro split, water rate, and the computed suggestions with an "Auf Ziele anwenden" action
  - **Export**: PDF export access point, CSV backup

### PDF export
- Available from every section (Stock list, Checklists, Contacts, Notes, Recipes) — generates a printable PDF snapshot of that section's current data
- Supports the "print and keep a paper copy" fallback described in Section 2, refreshed periodically as part of the quarterly checklist

---

## 16. Tech Stack

- Frontend: HTML/JS, hosted on GitHub Pages, deployed as installable PWA
- Backend/DB: Firebase (Firestore for data, FCM for push, Firebase Auth — Google Sign-In — for the 3 users/roles)
- External API: Open Food Facts (barcode → product lookup, Section 11) — free, no key, called directly client-side
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
Nested Type → Category → Subcategory editor: add/rename/delete at each level, symbol field, drag-to-reorder. (The optional `kcalPerKg`/`macroType`/diversity-floor category fields from Section 7 extend this editor later, in Step 11 — not part of this step.)
*Test:* Build out a full taxonomy tree, reorder subcategories, reload the app, and confirm it persisted correctly in Firestore.

**Step 5 — Storage locations & year color map (Settings → Data)**
Admin-managed storage list; year → color config table with a "no badge" option.
*Test:* Add/edit/remove storage locations and year colors; changes persist.

**Step 6 — Product data model (simplified)**
`/products` collection: `name`, `subcategoryId`, `unitType` (kg | stueck) — no conversion factor. **No standalone admin catalog-management screen** — an earlier version of this step built one (with a conversion-factor field), but it turned out to add nothing once the conversion factor was dropped and inline creation (Step 7) covered the real need; that screen is retired.
*Test:* Folded into Step 7's test — a product created inline during check-in has the correct fields in Firestore.

**Step 7 — Stock check-in (Einlagern) guided flow**
Type → Category → Subcategory tiles → Product list (from catalog, filtered, with "+ Neues Produkt") → detail form (quantity, best-before via the two-column date-picker modal, storage, plus a content/weight field for kg-tracked products or nothing extra for Stück-tracked ones) → confirm → writes a new stock batch. Confirming shows the "Rückgängig" undo toast (see Section 15). Also: barcode-scan entry point (Section 11) — scan → Open Food Facts lookup → prefill name/category at "+ Neues Produkt" if found, otherwise falls through to manual entry.
*Test:* Complete a full check-in end to end for both a kg-tracked and a Stück-tracked product; the resulting Firestore documents have all fields correct; a brand-new product typed at "+ Neues Produkt" gets added to the catalog with the right `unitType`; scanning a barcode found in Open Food Facts pre-fills the product name correctly; tapping "Rückgängig" on the toast deletes the just-created batch and returns to the two big buttons, while letting it time out keeps the batch.

**Step 8 — Stock check-out (Entnehmen) guided flow**
Same drill-down, but the product/batch step shows real existing batches with full inline detail and color badge; quantity stepper removes stock. Confirming shows the same undo toast.
*Test:* Checking out reduces the batch's quantity correctly; checking out the full quantity removes or zeroes the batch appropriately; badge color matches the configured year-color map; tapping "Rückgängig" restores the removed quantity (or un-zeroes/recreates the batch if it was fully removed).

**Step 9 — Admin stock table**
Sortable/filterable table (Product, Subcategory, Category, Type, Quantity, Content, Best-before, Storage), default sort Product→Subcategory→Category→Type, multi-select bulk delete, tap-through to the shared edit/delete detail view.
*Test:* Sorting by each column works both directions; filters and search narrow results correctly; multi-select bulk delete removes the right batches; single-row edit saves correctly.

**Step 10 — Dashboard**
Alerts preview (3-month horizon, scrollable, "Alle anzeigen" → full list with 1 Monat/6 Monate/Bis Jahresende selector); gaps summary (conditional preview + full list); totals-with-targets tiles + hierarchical Type→Category→Subcategory drill-down; shopping list preview + full detail.
*Test:* Dashboard accurately reflects real stock data — alerts match actual best-before dates, gaps match actual targets vs. stock, totals sum correctly in kg (or as plain counts for Stück-tracked categories).

**Step 11 — Targets & Autonomy-Based Stock Sizing (Settings → Targets, Settings → Planung)**
Set targets at any level (type/category/subcategory/product), via flat number or people × duration. Extends the Step 4 taxonomy editor with the optional `kcalPerKg`/`macroType`/diversity-floor category fields (Section 7). Builds the Planung screen: household roster CRUD, autonomy-duration + macro-split config, water-rate config, the computed macro/water suggestions (kcal totals + per-category kg reference, no auto-split across categories), and the "Auf Ziele anwenden" action writing into `/config/targets`.
*Test:* Setting a target at each of the four levels correctly changes the corresponding Dashboard progress bar/gap calculation, with no conflicts between overlapping levels. Separately: build out a household + autonomy duration + macro split, confirm the calculated kcal/kg suggestions match the formulas in Section 7, and confirm "Auf Ziele anwenden" correctly writes them into regular category targets indistinguishable from manually-set ones. Water target: confirm the liters→kg suggestion matches people × days × rate.

**Step 12 — Checklists**
Maintenance: grouped-by-frequency list, checkbox detail, auto-reset + `nextDue` roll-forward on completion, Settings → Checklists CRUD with per-checklist recipients. Crisis: card list, full-screen high-contrast reference view, Settings → Checklists CRUD for steps.
*Test:* Complete a maintenance checklist and confirm `nextDue` advances correctly by its frequency and all checkboxes reset; crisis reference view renders in its distinct style with no checkboxes.

**Step 13 — Info section (Contacts / Notes / Recipes)**
Pinned emergency contacts + general list + detail view; notes list + detail; recipes tag-filtered photo grid + detail. Inline admin-only add/edit on all three.
*Test:* CRUD works on all three; emergency contacts render in the pinned section; recipe tag filter narrows the grid correctly; phone numbers are tappable (`tel:` links) and open correctly.

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
QR generation encoding product/batch reference IDs; printable flexible HTML label template; camera-based scan (secondary entry point within the guided Stock flow). Barcode scanning (Section 11) is already built in Step 7 — this step is specifically about Erdkeller's own generated QR labels, a separate capability.
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
10. **Firebase billing plan**: stay on the free **Spark plan** — nothing in this spec requires the paid Blaze plan (scheduled Cloud Functions were explicitly ruled out in favor of manual CSV export, and the Open Food Facts barcode lookup runs client-side with no backend). No action needed unless priorities change later.
11. **Label printer**: no rush — pick one whenever convenient, and let me know so we can finalize the label template (still the one open item in Section 19).

---

## 19. Remaining Open Items

- Label printer/size — to decide once a printer is chosen (template stays flexible until then)
- **Drag-to-reorder doesn't work on real devices yet** (taxonomy editor, Settings → Data, Step 4): implemented with the Pointer Events API to avoid native HTML5 drag-and-drop's lack of touch support, but on an actual test it still doesn't work — on mobile, a press-and-hold just selects text; on tablet, it opens the browser's context menu. Something about the current handling isn't actually suppressing the platform's default touch/long-press behavior on the drag handle. Deliberately deferred — revisit later.
