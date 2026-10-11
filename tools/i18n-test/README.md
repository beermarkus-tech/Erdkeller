# i18n regression harness

These dev tools are not part of the app; nothing in `index.html` loads them. They render the real app in headless Chromium with:
- Firebase replaced by `firebase-mock.js`;
- the sample household from `fixtures.cjs`;
- a fixed clock (2026-10-10 12:00);
- deterministic ids.

Then they walk the click tour in `tour.cjs` (dashboard, stock flows, checklists, info, every Admin panel).

```
# German must be byte-identical between two builds (DOM after every step, plus every confirm/alert text)
node tools/i18n-test/run.cjs <oldDir> <newDir>        # e.g. a `git archive` of the previous build vs .

# Which UI text still bypasses t()? Runs English with a fake en.js ("§" + German)
node tools/i18n-test/run.cjs --leftovers .

# Visible text per step (add --lang en to see English)
node tools/i18n-test/run.cjs --dump . [--lang en] [--only "<step name>"]

# Dictionary consistency: missing/unused keys, en.js placeholders
node tools/i18n-test/check-keys.mjs

# Any mode, with screenshots per step and/or the phone layout
SHOTS=/tmp/shots VIEWPORT=phone node tools/i18n-test/run.cjs --dump . --lang en

# German tour; switch to fake English in place after each step, then back
node tools/i18n-test/run.cjs --live .
```

**Other switches (environment variables):**
- `HARNESS_USER=<uid>` signs in as another account (no cached identity).
- `HARNESS_TOUR=signup` runs `tour-signup.cjs`: a stranger's sign-up, the waiting screen, then approval.
- `HARNESS_HOUSEHOLD=h1` runs in household mode: all fixture data under `households/h1/`, every approved account with `householdId: 'h1'`. The app must find the household from the account itself, so identical screens prove every access goes through `hcol()` / `hdoc()` and the household is set before any screen loads.
- `HARNESS_TOUR=switch` simulates the household move finishing while the app is open: the app must store the new household, reload once, and not loop.
- `--calls` prints the server calls the tour made, plus every Firestore write path.

Playwright is preinstalled in the Claude Code cloud container. If `require('playwright')` fails, set `PW=/opt/node-tools/node_modules/playwright`.

See `I18N.md` for the plan.
