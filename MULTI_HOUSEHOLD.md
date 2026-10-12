# Multiple households: analysis & plan

> **Status: design only. Nothing is built yet** apart from the prerequisite in Build 201: new accounts need approval. The analysis was written on 2026-10-11, against Build 200.
>
> **Goal.** Open the app to other families as a **test environment**: offer it on Reddit and see whether anyone is interested. Each family gets its own separate data. Family members join their household by invitation. A new household starts from pre-filled data in the chosen language.

---

## 0. Start here next time: to-do list

Everything suggested so far, in order. Tick it off as it gets done.

**Right now (Build 201 follow-up)**
- [x] **Markus: deploy Build 201** — done 2026-10-11. from Cloud Shell: `cd ~/Erdkeller && git checkout claude/project-onboarding-mdzoen && git pull && cd functions && npm install && cd .. && firebase deploy --only firestore:rules,functions --project erdkeller-cdbb9`. Until this runs, the old rules still let strangers in.
- [ ] **Markus: open Admin → Personen and remove any account you don't recognise.** Anyone who signed in before the fix is still a full member.

**Build 203, step 2: move your data into its own household — done 2026-10-11.** In this order:
- [x] **1. Open the app once on every device** (phone, tablet, family devices) so each one runs Build 203 (the tag bottom-left says "Build 203"). An older build would keep writing to the old place after the move and get "permission denied".
- [x] **2. Deploy** from Cloud Shell: `cd ~/Erdkeller && git checkout claude/project-onboarding-mdzoen && git pull && cd functions && npm install && cd .. && firebase deploy --only firestore:rules,functions --project erdkeller-cdbb9`. Nothing changes for anyone yet.
- [x] **3. Admin → Sicherung → Haushalts-Umstellung → Umstellen.** Pick a quiet moment: nobody editing on other devices, and no device in offline mode with unsynced changes (edits made offline on the old place can't sync after the move). It downloads a safety backup first — keep that file. Then the server copies everything, checks the counts, and only then switches every account over; all devices reload by themselves.
- [x] **4. Check** a few screens (stock, checklists, contacts, recipes). The old data stays untouched at the database root as a fallback.
- [x] **Build 204: migration code and buttons removed** (household move and the old checklist migration). Deploy once more (same command) — Firebase asks whether to delete the function `migrateToHousehold`: answer **y**.
- [x] **Build 205 (step 3): deploy** (same command), then open the app once as admin — that converts the checklists' old recipient names to real accounts. Check Admin → Checklisten (edit) that each list has the right people ticked, and Admin → Erinnerungen → Zeitzone. Done 2026-10-11.
- [x] **Build 206/207 (step 4): deploy** (same command) — done; invitation tested successfully 2026-10-11. Then try it: Admin → Personen → invite a second Google address of yours → sign in with that account on another browser/device → "Beitreten".
- [ ] **Creating households is closed until step 6** (privacy notice, dictation limit, budget). To try it yourself before then: Firebase console → Firestore → collection `_system` → document `config` → field `allowEmails` (array) with your test address. To open it for everyone later: field `openSignup` = true.
- [ ] **5. A few weeks later:** delete the old root data (ask Claude for the exact steps then). Until then the rules' legacy root blocks and the app's "no household" path stay, harmlessly — they go with the data.

**Before posting on Reddit**
- [x] **Clean up the categories and data.** Done; exported 2026-10-12 and used for the templates (Build 209).
- [x] **Answer the open questions in Section 10:** cloud region, dictation for testers, contact address. Answered 2026-10-11 (Section 10).
- [ ] **Build steps 1–6 of Section 9.**
- [x] **Write a privacy notice and test disclaimer, shown at sign-up and linked in the app** (Section 7). Build 210: `privacy.html` (DE/EN); joining or creating a household requires ticking it (server checks `consent`, stores `consentAt`/`consentVersion` = `PRIVACY_VERSION` in functions/index.js — bump it when the text changes); linked on the sign-in screen and in the account menu. *Not legal advice:* depending on the country, a privacy notice may need the operator's real name and postal address instead of only an e-mail.
- [x] **Limit AI dictation to 20 per household per day** (decided 2026-10-11). Build 210: counted per household per local calendar day in `/households/{id}/usage/dictation-YYYY-MM-DD` before the AI call; the 21st gets a friendly DE/EN message, no retry button. A household's own `dictationLimit` field (Firebase console only) overrides 20 — e.g. set your own household to 1000.
- [ ] **Add a Google Cloud budget alert** (Billing → Budgets & alerts).
- [ ] **Enable Cloud Data Access audit logs** for Firestore, so any console look at data is recorded (Section 8).
- [x] **Let testers delete their household and their account** themselves (GDPR, and it's fair). Build 211: account menu (profile picture) → "Konto löschen" (everyone; also on the onboarding screen) deletes the /users doc, devices and the Firebase sign-in record — the last person of a household takes the household with them, the last admin of a household with members is refused; "Haushalt löschen" (admins) needs the household's name typed in and deletes all its data, revokes its open invitations and takes every member out (their accounts stay, back to onboarding).
- [ ] **Build a metadata-only operator page** (Section 8).

**Later (not needed for the test)**
- [ ] **Imperial units** as a separate setting. Country is the trigger (I18N.md 8.3).
- [ ] **Real invitation emails** (Firebase "Trigger Email" extension). Until then the admin tells the person to sign in.
- [ ] **More templates** (e.g. `en-GB`) as testers from other countries appear.
- [ ] **Conflict-aware import** (SPEC.md 20.2.4) and paid tiers (SPEC.md 20.1), if the test shows interest.

---

## 1. Today (single household)

- **Data layout.** All data lives in top-level Firestore collections: `/products`, `/stockItems`, `/stockLog`, `/checklists`, `/checklistItems`, `/contacts`, `/notes`, `/recipes`, `/config/*` and `/users`. Every approved account sees all of it.
- **Accounts.** Roles are per user (`/users/{uid}.role`). Since Build 201, new accounts are `pending` until an admin approves them.
- **Hardcoded household details.**
  - The reminder recipients are the slugs `markus` / `julia` / `sophia` (`js/people.js`, `js/checklists.js`, `functions/index.js`).
  - The reminder timezone is fixed at `Europe/Paris`.
  - The data language for AI-suggested product names is fixed at `APP_LANGUAGE = 'Deutsch'`.
- **Scale of the change.** The client has about 150 Firestore path call sites (`collection(db, …)` 54, `doc(db, …)` 96). `functions/index.js` has 16.

## 2. Decisions so far (Markus, 2026-10-11)

| # | Question | Decision |
|---|---|---|
| 1 | Audience | Strangers via Reddit, as a **test environment**. A data disclaimer / privacy notice is still to be written (Section 7). |
| 2 | One person in several households? | **No.** One person belongs to one household. |
| 3 | How do family members join? | **By email invitation.** The admin enters a family member's Google email; that person signs in, sees the invitation, accepts, and becomes a member. Anyone who signs in **without** an invitation creates their own new household and is its admin, after an explicit "create household" step rather than silently. |
| 4 | Starter data | Markus's current category/data structure, **after he cleans it up**. That becomes the German template; a plain translation becomes the English one. |
| 5 | Ask for the country? | **Yes, confirmed by Markus.** It's not sensitive data (Section 6). Pre-select it from the device language, never from the IP address; the person can change it. It's stored on the household and drives emergency numbers, official guidance and, later, units. |
| 6 | Close the open sign-up gap first | **Done in Build 201.** |

## 3. Recommended data model: one Firestore section per household

```
/households/{hid}                      name, createdAt, createdBy, lang (data language),
                                       country, timezone, plan/limits
/households/{hid}/members/{uid}        role (admin|member), name, email, joinedAt,
                                       removed/removedAt, reminder settings
/households/{hid}/invites/{inviteId}   email (lower-case), role, createdBy, createdAt,
                                       expiresAt, status (open|accepted|revoked)
/households/{hid}/products, stockItems, stockLog, checklists, checklistItems,
                 contacts, notes, recipes, config/*        (same shapes as today)
/users/{uid}                           name, photoURL, lang, householdId (the one household)
```

**Why this model:** it isolates households by path, so the access rules need a single check: "is `request.auth.uid` an active member of `{hid}`?"
- Export, backup, import and deletion work per household for free.
- Each household gets its own reminder hour, timezone and data language.

**Rejected alternatives:**
- **A `householdId` field on every document.** A single forgotten `where()` leaks another family's data, and the rules become hard to get right.
- **A Firebase project per family.** No code change, but every family needs manual setup. Fine for 1–2 friends, impossible for Reddit testers.
- **Firestore named databases per household.** Operationally heavy, and quota-limited.

**What it involves:**
- **One data-access helper.** A `hcol('products')` / `hdoc('config', 'taxonomy')` helper in `firebase-init.js` prefixes the current household's path. That's one mechanical change across about 150 call sites, proven by the i18n harness to change nothing visible.
**As built in Build 203 (step 2) — one simplification:** since one person belongs to exactly one household, the role and membership stay on `/users/{uid}` (`role`, `removed`, and the new `householdId`) instead of a separate `/households/{hid}/members` collection. The rules check "is `householdId` on my user doc equal to `{hid}`?". Invitations (step 4) will add `/households/{hid}/invites`.

- **Recipients become member uids.** The hardcoded slugs `markus` / `julia` / `sophia` are replaced by member uids in `list.recipients`, the People picker and the reminder server code.
- **Server per household.** `sendReminders` loops over households, each at its own hour and timezone. `parseDictation` gets `hid`, checks membership, and uses the household's data language.
- **Migrating Markus's data: copy, don't move.**
  1. Back up and tag.
  2. Copy into `/households/{hid}/…`.
  3. Compare counts.
  4. Switch the client over.
  5. Keep the old top-level data read-only for a few weeks.
  6. Delete it.

## 4. Joining a household (email invitation)

1. **The admin invites.** In Settings → Personen → "Invite", the admin enters an email address. This writes `/households/{hid}/invites/{id}` with `status: 'open'` and an expiry (e.g. 14 days).
2. **The family member signs in** with that Google account. A Cloud Function `checkInvites()` looks for open invites whose email matches the **verified** `request.auth.token.email`.
3. **They see "You've been invited to the household «X» — Accept / Decline".**
   - **Accept** calls the function `acceptInvite(id)`. It runs server-side, so the rules never let anyone add themselves: it creates the member doc, sets `users/{uid}.householdId`, and marks the invite accepted.
4. **No invitation found:** the person sees "Create your household" (name, language, country), or "I was invited — sign out and use the invited email".
5. **Edge cases:**
   - **Wrong Google account:** the screen says which email to use; the admin can re-invite.
   - **Invite expired or revoked:** shown as such.
   - **Already in a household (decision 2):** the invite can't be accepted until they leave it.
   - **Email delivery:** the app doesn't need to send emails. The admin tells the person ("sign in with your Google account"). Sending real emails would need a mail service (e.g. the Firebase "Trigger Email" extension). That's optional, later.

## 5. Pre-filled starter data per language

- **Where templates live.** `functions/templates/de-DE.json`, `en-US.json` (later e.g. `en-GB`). They're versioned in the repo and hold:
  - taxonomy: types / categories / subcategories with symbols, type class, planning mode and kcal values;
  - storage locations;
  - year colors;
  - maintenance checklists and items;
  - crisis types with steps;
  - optionally emergency contacts and a few starter products.
- **How they're applied.** `createHousehold({ name, lang, country })` (Cloud Function) creates the household, makes the caller admin, and copies the template with **fresh ids**. From then on it's ordinary household data: editable and never re-translated.
- **Where the German template comes from.** Markus's current taxonomy, after his cleanup. Export it with a small admin-only "export as template" action that strips stock, logs and personal data. Then translate it for `en-US`; Markus reviews.
- **Data language.** `households/{hid}.lang` replaces the hardcoded `APP_LANGUAGE` for AI product names. The UI language stays per person, as today.
- **Country-dependent content** (that's why we ask for the country):
  - emergency numbers: 112 vs 911;
  - official guidance: BBK/DGE for Germany vs FEMA/Ready.gov for the US, e.g. 1 gallon ≈ 3.8 L of water per person per day;
  - the default timezone;
  - later, imperial units (I18N.md 8.3).

## 6. The country question (data protection)

- **The risk is low.** A country isn't a "special category" under GDPR. Stored on the **household**, not the person, it's barely personal data at all. It still has to be listed in the privacy notice like everything else.
- **How to ask:** pre-select from the browser locale (`en-US` → USA) and let people change it. **Don't** derive it from the IP address; that's unnecessary processing and needs a lookup service.
- **Catch:** none really. The only cost is keeping one template per language-country pair you want to support. Start with de-DE and en-US, and fall back to the closest template for other countries.

## 7. Opening it to strangers (Reddit test): what's needed besides code

- **A privacy notice and test disclaimer, shown at sign-up and linked in the app.** This is still needed for a test: as soon as strangers' data is stored, GDPR applies (the operator is in the EU). Keep it short and honest:
  - **What's stored:** Google name, email and photo; household data; the language/country chosen.
  - **Where:** Firebase / Google Cloud, region …
  - **Who can technically see it:** the project owner (Section 8).
  - **What the AI dictation sends to Anthropic.**
  - **Test status:** no guarantees, data may be reset or deleted, "please don't store sensitive data".
  - **How to get your data deleted,** plus a contact email.
- **Third-party data.** Testers will store other people's contacts (names, phone numbers, addresses). The notice should say they're responsible for that.
- **Costs and abuse.** Firestore and Functions usage is billed to Markus's project, and **AI dictation costs money per call.** Before the Reddit post:
  - put a per-household daily limit on dictation (e.g. 20/day), or turn dictation off for test households;
  - set a Google Cloud **budget alert**.
- **Delete household / delete my account:** needed so testers can leave, and for GDPR.

## 8. The super-admin (Markus as operator)

**What Markus can see without looking at anyone's data:**
- **A small operator page** (or the Firebase console), backed by a Cloud Function `listHouseholds()` that only Markus's uid may call (a custom claim `superadmin`). It returns **metadata only**: household name, created date, admin name/email, member count, last activity, template/language/country, and maybe dictation usage for the cost limits.
- **No household content.** The function never returns stock, contacts, notes and so on, and no security rule grants Markus access to other households' paths. In the app, his own household is just one household among others.

**The honest limit: Markus cannot be *technically* prevented from seeing the data.**
- As owner of the Google Cloud project, he can open any document in the Firebase console, and server code runs with full privileges. Security rules only govern the app's clients.
- The only technical fix would be end-to-end encryption, with keys known only to each household. That breaks the features that need the server to read data: AI dictation, reminder texts, server-side search. It isn't worth it for a test.
- **What to do instead:**
  - say so plainly in the privacy notice ("the operator has technical access but does not look at household data except to fix problems you report");
  - turn on Cloud **Data Access audit logs** so any console access is recorded;
  - keep the operator page metadata-only.

## 9. Proposed build order

Each step is its own build, with the harness and rules tests.

0. **Build 201 (done): approval for new accounts.** This closes the open sign-up gap.
1. **Data-access helper (`hcol` / `hdoc`). Done in Build 202.** A pure refactor that still points at today's top-level paths; no visible change.
   - **Client:** `js/firebase-init.js` exports `hcol(...)`, `hdoc(...)` and `setHouseholdPath(path)`; the path is empty today. All 166 household data accesses in `js/` use them. Only per-user data (`/users/{uid}`, its `devices`) still calls `doc(db, 'users', …)` directly.
   - **Load-time references** are now functions, built when used: `crisisRef()`, `notificationsRef()` and `notificationStateRef()` (`checklists.js`), `notificationsRef()` (`notifications.js`, `verbindung.js`), and `ref()` (`storage-locations.js`, `taxonomy.js`, `year-colors.js`).
   - **Server:** `functions/index.js` routes its 11 household paths through `hpath()`, with `HOUSEHOLD_PATH = ''`. Behaviour is identical, so no deploy was needed; the next server deploy simply includes it.
   - **Verified:**
     - German is identical to Build 201 on all 90 harness steps.
     - With `HARNESS_HOUSEHOLD=households/h1` (fixtures moved under that prefix, `firebase-init.js` served with it), every screen's text and the generated PDF are identical to the root run.
     - All 22 recorded writes land under `households/h1/…` or `users/…`.
     - This proves no data access bypasses the helper.
2. **Household model, rules and migration. Built in Build 203** — needs `firebase deploy` and then the one-time move (Section 0).
   - **Model:** `/households/{hid}` (name, createdAt, createdBy, lang, country, timezone, migratedAt, migratedCounts) and `householdId` on `/users/{uid}`. No `householdId` = the legacy household still at the root.
   - **Rules (`firestore.rules`):** `isMember(hid)` / `isHouseholdAdmin(hid)`; every collection is mirrored under `/households/{hid}/…` with the same per-collection rules as before. The root blocks call the same helpers with `null`, so the moment an account gets a `householdId` it loses access to the root copy — the old data freezes as a fallback without another rules change. Households are created server-side only; an admin may rename theirs (name/lang/country/timezone only). The roster is per household: you read your household's accounts; admins also see pending ones and approve them *into* their household (role + householdId in one write). Nobody can move an account between households or strip it out of one.
   - **Migration (`functions/migrate.js`, callable `migrateToHousehold`, admin-only; ran 2026-10-11, removed in Build 204 — see git history):** remembers the new id first (so a re-run after a crash resumes into the same household), copies every root collection incl. subcollections (not `users`, `diagnostics`), verifies each copied collection's count, and only then creates the household doc and gives every approved/removed account the `householdId`. Pending accounts stay without one. Re-running after success is a no-op. Started from Admin → Sicherung → Haushalts-Umstellung, which downloads a safety backup first.
   - **Client:** `js/auth.js` takes `householdId` from the account (and caches it, so offline starts know it) and calls `setHousehold()` before any screen loads. If it changes while the app is open (the move, or an approval), the app stores it and reloads once. `js/people.js` lists the household's accounts plus pending ones (two scoped queries) and approval sets `householdId`.
   - **Server:** `parseDictation` and `previewReminders` use the caller's household; `sendReminders` loops over all households (only the root one while none exists) and resolves recipients only within each household. Hour/timezone are still global until step 3.
   - **Verified:** 72 rules tests (41 new: isolation between two households, frozen root, roster scoping, approval into a household, devices); 21 migration tests on the emulator (620-doc collection beyond one batch, timestamps, subcollections, copy-not-move, pending untouched, re-run no-op, crash resume); the real Cloud Functions code run against the emulator (legacy preview, member refused, migration, household preview ignoring the frozen root, other household's recipients excluded); harness: 90/90 identical to Build 202 (apart from the new panel), household mode (`HARNESS_HOUSEHOLD=h1`, the app finds the household from the account itself) shows identical text in DE and EN except the move button's status, all writes land in `households/h1/…` or `users/…`, member and sign-up tours identical, live language switch 90/90, and a `switch` tour proves the one-time reload with no loop.
   - **Known gap until step 4:** admins of *every* household see pending accounts (name, photo) — harmless with one household, but invitations must replace open sign-up before strangers arrive.
3. **Recipients become member uids; reminders per household. Built in Build 205** — needs `firebase deploy`.
   - **Recipients:** a checklist's reminder recipients are now the household's members (Admin → Checklisten → edit lists shows one checkbox per person, by name). The fixed `markus` / `julia` / `sophia` slugs and the People screen's slug picker are gone. Lists saved before still name slugs: the first time an admin opens the app, those are rewritten to the uids of whoever had that slug (nothing is dropped); until then the server matches both. New lists start with their creator.
   - **Timezone:** each household's reminder hour and period resets use `/households/{id}.timezone` (Admin → Erinnerungen → Zeitzone; Europe/Paris for yours). An invalid value falls back to Europe/Paris. The app's own "due" view still uses the device's clock, assumed to be the household's.
   - **Data language:** dictation/photo prompts use `/households/{id}.lang` for new product names (German prompts byte-for-byte unchanged for German data; an English household gets English names).
   - **Bug fixed on the way (since Build 154):** the reminder state (`/config/notificationState`) was written with `"checklists.monthly.x"` keys, which `set()` stores as literal field names, so nothing read them back: reminders went out every day at the configured hour instead of every N days, and "Für diesen Zeitraum erledigt" neither stopped them nor survived a reload. Both writers now write nested fields; old literal keys are still read.
   - **Verified:** rules tests (+2 timezone cases); new `reminders.test.cjs` (11 checks, the real scheduler on the emulator); dictation prompts identical to Build 204 for German data; harness in household mode — only the expected differences (names instead of slugs, the timezone row); live switch 90/90; 0 untranslated strings; the admin's visit converts `['markus','julia']` → `['u-admin','u-member']`, a member's visit writes nothing.
4. **Invitations and onboarding. Built in Build 206** — needs `firebase deploy`.
   - **Inviting:** Admin → Personen → Einladen: e-mail address + role (member/admin). Stored in a top-level `/invites/{id}` (householdId, email lower-case, role, status open|accepted|declined|revoked, createdBy, createdAt); valid 14 days. The app sends no e-mail itself yet: "E-Mail schreiben" opens the admin's mail app with a ready-made message (link + which address to sign in with). Open invitations are listed and can be withdrawn.
   - **Joining:** a signed-in account without a household sees the onboarding screen (was "waiting for approval"): its open invitations (matched server-side against the *verified* Google e-mail, `myInvites`), each with "Beitreten"/"Ablehnen" (`acceptInvite`/`declineInvite`, a transaction: invitation open, not expired, right address, account not in a household and not removed).
   - **Creating:** the same screen offers "Eigenen Haushalt anlegen": name (pre-filled), country (short list, pre-selected from the device language's region, never the IP), the device's timezone, data language = UI language → `createHousehold` makes the caller its admin. **Closed until step 6**: allowed only if `_system/config.openSignup == true` or the address is in `_system/config.allowEmails`. New households start empty until templates (step 5).
   - **Approval is gone:** admins no longer see or approve accounts without a household (rules), which closes the step-2 gap where every household's admins saw everyone waiting. Admins can only change role/removed of their own household's accounts; nobody moves accounts between households from the client.
   - **Verified:** rules tests (invitation create/read/revoke scoping, no client-side accept, pending accounts invisible to admins); `invites.test.cjs` (21 checks of the four callables on the emulator: address matching, verified e-mail, expiry, single use, no second household, removed accounts, signup gate, allow-list, input cleaning); harness: main tour differs from Build 205 only in Admin → Personen (invite form instead of approval), `signup` tour (onboarding with an invitation → language switch → join), `create` tour (create → app on an empty household, all main screens without errors), `invite` tour (bad address refused, mixed-case address stored lower-case), live switch 90/90, 0 untranslated strings.
   - **Later:** real invitation e-mails (Trigger Email extension).
   - **Build 207 fixes (Markus's first real test):**
     - *Not Gmail-only, on purpose:* Google sign-in works for any address that is a Google account (Gmail, Google Workspace company addresses, other addresses registered with Google). Non-Gmail addresses get a "are you sure?" instead of a block. Gmail spelling variants match (dots, "+tag", googlemail.com): invites carry `emailKey`, the server re-checks.
     - *Sign-in window:* a private/incognito window knows no Google accounts, so Google must ask for the address — not something the app can change. The invitation link now carries `?login=<address>`, which pre-fills it in Google's window and otherwise shows the account chooser (instead of silently using the last account).
     - *"Blocked" after accepting:* the address had been removed earlier, and removal left a `removed:true` tombstone that signed the account out on every visit. Removing someone (🗑️) now takes the account out of the household server-side (`removeMember`: household, role and devices cleared) — they see the onboarding screen and can be invited again; no "restore" any more (re-invite instead). Old tombstones are treated as "no household": the person gets onboarding, can accept a new invitation, and admins can clear the leftover row with 🗑️.
5. **Templates. Built in Build 209** — needs `firebase deploy` (functions).
   - Markus's categories (types → categories → subcategories, with icons and planning settings), exported 2026-10-12 with a temporary button (Build 208, removed again in 209), are the German template `functions/templates/taxonomy-de.json`; `taxonomy-en.json` is the English translation — same ids, icons and settings, only names differ (tested). Side-by-side list for review: `functions/templates/README.md`.
   - `createHousehold` writes the template matching the household's data language (UI language at creation) as `config/taxonomy`. Existing households are untouched. Categories only for now (crisis types / checklists: maybe later).
   - The family-specific Medikamente subcategories "Menière" and "Hormone" were replaced by "Allergien / Allergies" in both templates (Markus, 2026-10-12).
6. **Opening up.** Privacy notice, test disclaimer and consent at sign-up; delete household / delete account; dictation limits; budget alert; metadata-only operator page.

## 10. Open questions

- **Template cleanup:** when will Markus's data cleanup be done? It blocks step 5, not steps 1–4.
- **Cloud region:** answered, **`eur3`**. That's Firestore's EU multi-region (data stored in Belgium and the Netherlands), for the privacy notice.
- **Dictation for testers:** answered, **on, limited to 20 dictations per household per day**.
- **Operator contact address** for the privacy notice and data-deletion requests: answered, **contact@solidcutlist.com**.
