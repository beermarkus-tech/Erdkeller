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

**Before posting on Reddit**
- [ ] **Clean up the categories and data.** This blocks the starter templates (step 5 in Section 9).
- [x] **Answer the open questions in Section 10:** cloud region, dictation for testers, contact address. Answered 2026-10-11 (Section 10).
- [ ] **Build steps 1–6 of Section 9.**
- [ ] **Write a privacy notice and test disclaimer, shown at sign-up and linked in the app** (Section 7).
- [ ] **Limit AI dictation to 20 per household per day** (decided 2026-10-11). Enforce it server-side in `parseDictation` with a per-household daily counter, and show a friendly "daily limit reached" message in DE/EN.
- [ ] **Add a Google Cloud budget alert** (Billing → Budgets & alerts).
- [ ] **Enable Cloud Data Access audit logs** for Firestore, so any console look at data is recorded (Section 8).
- [ ] **Let testers delete their household and their account** themselves (GDPR, and it's fair).
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
2. **Household model, rules and migration.** `/households`, members, rules (emulator tests), and copying Markus's data in. *Risky step: tag, backup, copy-not-move, fallback.* Needs `firebase deploy`.
3. **Recipients become member uids.** Includes the server reminders per household (hour, timezone, data language). Needs `firebase deploy`.
4. **Invitations and onboarding.** Invite by email, accept/decline, and the "create your household" screen.
5. **Templates.** An "export as template" admin action, the de-DE template from Markus's cleaned-up data, its en-US translation, and `createHousehold`.
6. **Opening up.** Privacy notice, test disclaimer and consent at sign-up; delete household / delete account; dictation limits; budget alert; metadata-only operator page.

## 10. Open questions

- **Template cleanup:** when will Markus's data cleanup be done? It blocks step 5, not steps 1–4.
- **Cloud region:** answered, **`eur3`**. That's Firestore's EU multi-region (data stored in Belgium and the Netherlands), for the privacy notice.
- **Dictation for testers:** answered, **on, limited to 20 dictations per household per day**.
- **Operator contact address** for the privacy notice and data-deletion requests: answered, **contact@solidcutlist.com**.
