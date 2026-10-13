# Onboarding: welcome tour, setup checklist, explanations

Plan for guiding a new household from "empty app" to "first item stored, and I understand what this does". Agreed with Markus on 2026-10-13; nothing built yet. Build in the stages of Section 8, one PR each.

## 0. Decisions so far

| # | Question | Decision |
|---|---|---|
| 1 | Setup checklist: floating card, or a box on the Overview? | **Floating** card, small and collapsible, on every tab |
| 2 | Steps: guided mini-screens, or the real Planning page with highlights? | **Guided** mini-screens, writing to the same Planning data |
| 3 | Step 3 (split into categories) | **"Accept the recommended split and see what it means"**; per-category tuning stays in Admin → Ziele for experts |
| 4 | Calorie presets | Adult ~2,500 / ~2,000 kcal, children by age group (Section 4) |
| — | The app's principle | Explained briefly and pragmatically on the Overview, with the **shopping list** as the payoff (Section 2) |

Open: Section 9.

## 1. Why

A new household lands on the Overview, and everything is empty apart from one sentence ("No food targets set yet…"). Nothing says what the app is for, which order to do things in, or why the people and the self-sufficiency period come before the first can of beans. The planning chain only makes sense once it has been explained, and nothing explains it today.

## 2. The principle, in the app's own words

This is the one idea every new user must get. It goes into the welcome tour (card 2) and a short "How it works" card on the Overview (Section 6). Draft text, deliberately short and pragmatic:

**DE**
> **So funktioniert Erdkeller**
> 1. Ihr sagt, wer im Haushalt lebt und wie viel jede Person am Tag isst (Kalorien).
> 2. Ihr wählt, wie lange ihr ohne Einkaufen auskommen wollt — z. B. 60 Tage.
> 3. Erdkeller rechnet das in **Kilos pro Lebensmittel** um: wie viel Getreide, Fette, Konserven, Wasser ihr dafür braucht.
>
> Und das Wichtigste: Die **Einkaufsliste** sagt euch, was noch fehlt — nicht „123.000 Kalorien“, sondern ganz konkret „**8,4 kg Nudeln** kaufen“.

**EN**
> **How Erdkeller works**
> 1. You tell it who lives in your household and how much each person eats per day (calories).
> 2. You choose how long you want to manage without shopping — e.g. 60 days.
> 3. Erdkeller turns that into **kilos per food**: how much grain, fats, canned food and water you need.
>
> And the point of it all: the **shopping list** tells you what's still missing — not "123,000 calories", but simply "**buy 8.4 kg of pasta**".

(The pasta figure is an example; in the app the line can use a real number from the household once it has targets.)

## 3. Three layers

### 3.1 Welcome tour (once, first time anyone opens the app)
Full-screen overlay, 5 swipeable cards. Each card has a large simple illustration, a heading and 2–3 sentences. Dots show the position; "Skip" is always there; it can be reopened later from the account menu ("So funktioniert's / How it works").

1. **Your supplies, planned instead of guessed.** What Erdkeller is for: knowing how long your household could manage on its own with food, water and essentials.
2. **How it works.** The principle from Section 2: people and calories → period → kilos per food → shopping list. Graphic: 👨‍👩‍👧 → 📅 → ⚖️ → 🛒.
3. **Storing and taking out.** Check-in/check-out, best-before dates and the year colours, dictation or a photo instead of typing.
4. **The overview and the shopping list.** The bars show how far your stock reaches; the shopping list shows what's missing, in kilos per food.
5. **More inside.** Checklists (maintenance, crisis), contacts, notes, recipes, reminders, inviting family, backup.
- Last button: **"Set up now"** (admins of a new household: starts the setup checklist) or **"Let's go"** (everyone else: closes).

### 3.2 Setup checklist (floating card until done)
A small card at the bottom of the screen, "**Getting started · 1 of 4**", which expands into the list. Ticks come **from the data**, not from clicking (Section 5):

1. ☐ **Who lives here.** At least one person with calories per day.
2. ☐ **How long.** Self-sufficiency period chosen.
3. ☐ **How to eat.** Macro split confirmed (or the recommendation accepted).
4. ☐ **First item stored.**
- **Optional**, collapsed below: invite family · turn on reminders · look at the crisis checklists (Section 9, Q5).

Tapping a step opens its **guided mini-screen** (Section 4). When all four are done: a short "All set 🎉 — your shopping list is ready" with a button to it, then the card disappears. It can be reopened from the account menu.

### 3.3 Helpful empty screens
Every empty screen explains itself in one sentence and offers the next step as a button, instead of a dead end:
- **Overview without targets:** the "How it works" card (Section 2) plus "Start with step 1: who lives here?".
- **Stock without items:** "Nothing stored yet" → check-in.
- **Shopping list without targets:** "Appears once people and period are set" → step 1.
- **Checklists empty:** what they're for → create one.

## 4. The guided mini-screens

Each one is a small full-screen dialog with one question, big buttons, one sentence of "why", and **Next / Back / Later**. Each saves into the same documents the Planning screen uses (`config/household`, `config/planning`), so Admin → Planung always shows the same values and stays the place for fine-tuning.

**Step 1: Who lives here?**
- "Add person" with ready-made choices: **Adult ~2,500 kcal**, **Adult ~2,000 kcal**, **Child 1–3 (~1,100)**, **4–6 (~1,400)**, **7–10 (~1,800)**, **11–14 (~2,200)**, **Own value**. A name is optional ("Person 1").
- Why: "Calories decide how much food you need. These are typical values; you can change them any time."
- Done when at least one person exists.

**Step 2: How long?**
- Big buttons **14 · 30 · 60 · 90 days** and "Own number". Short note: "Authorities recommend supplies for at least 10 days; longer is your choice."
- Water shown alongside: "We plan 3 L per person per day (drinking + basic hygiene)", changeable.
- Done when the period has been chosen in the wizard or changed in Planning (Section 5).

**Step 3: How to eat**
- One big button: **"Use the recommended split: 50 % carbohydrates, 30 % fat, 20 % protein"**, plus "Adjust" (three simple sliders).
- Then **"Here's what that means"**: the resulting targets for 4–5 food categories in kilos (e.g. "Grains & legumes: 39 kg · Fats, oils, nuts: 10 kg · …"), straight from the existing target calculation. Link: "Fine-tune later in Admin → Targets."
- Done when confirmed.

**Step 4: Store your first item**
- Opens the normal check-in with a hint bubble: "Pick something you have at home, e.g. a pack of pasta." Mentions dictation and photo as alternatives.
- Done when the first stock item exists.

## 5. How progress is detected and stored

- **Step 1:** `config/household.members` has at least one person with calories > 0.
- **Step 2 and step 3:** Planning has default values, so "a value exists" is not enough. The wizard records an explicit confirmation on the household: `households/{id}.onboarding = { autonomy: <date>, macros: <date>, dismissed?: <date> }`. Changing those fields in Admin → Planung counts as confirming too. Needs `onboarding` added to the household fields admins may update (firestore.rules).
- **Step 4:** at least one document in `stockItems`.
- **Welcome tour seen:** per person, on `users/{uid}.tourSeen` (the self-update rule already allows such fields).
- **Who sees the checklist:** admins of a household whose onboarding isn't finished. Households that existed before this feature (yours) are marked finished, so nothing changes for you.

## 6. Who sees what

| Who | Welcome tour | Setup checklist | "How it works" card on Overview |
|---|---|---|---|
| Admin who just created a household | yes, first start | yes, until done | while targets are missing; afterwards via the ℹ️ button |
| Someone who joined by invitation | yes, first start | no (planning is the admin's job, and members can't change it) | via the ℹ️ button |
| Existing users (Markus's family) | no, unless reopened from the menu | no | via the ℹ️ button |

The ℹ️ "How it works" button sits in the Overview's header, so the principle stays one tap away for everyone.

## 7. Look and feel

- Same colours and fonts as the app; works on phone and tablet, portrait and landscape.
- Illustrations: Section 9, Q6. Default: simple icon-based graphics built in the page (fast, no extra files, light and dark).
- All text in German and English via the normal dictionaries (de.js/en.js), live language switch included.
- Respect "reduce motion": the card slides only if the device allows animation.
- Tests: harness tours for a brand-new household (tour → steps 1–4 → checklist gone), for an invited member (tour only), and for an existing household (nothing shown); German/English identical in structure; 0 untranslated strings.

## 8. Build stages (one PR each)

1. **Setup checklist + guided steps 1–4** (biggest effect): floating card, the four mini-screens, progress detection, `onboarding` on the household, rules change.
2. **"How it works" card and ℹ️ button on the Overview**, plus the improved empty screens.
3. **Welcome tour** (5 cards, illustrations), reopenable from the account menu.

## 9. Still open

- **Q5 (optional extras in the checklist):** invite family? reminders? crisis checklists? anything else?
- **Q6 (illustrations):** simple icon-based graphics (default), or proper drawings made separately?
- **Q7 (tour content):** anything that must be in the welcome tour, or left out?
- **Child calorie values:** are the age groups in Section 4 fine, or do you have your own?
