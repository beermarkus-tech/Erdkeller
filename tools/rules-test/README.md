# Firestore security-rules tests

These dev tools are not part of the app. `rules.test.mjs` runs the repo's `firestore.rules` in the local Firestore emulator, under the demo project `demo-erdkeller`, so it never touches the real project. It checks what each kind of account may read and write:

- a stranger;
- a pending account;
- a removed member;
- a member, including a pre-Build-180 one;
- an admin;
- an anonymous visitor;
- (Build 203) members and admins of two separate households: nobody sees or changes another household's data or people, and a moved account can no longer touch the old root data.

`migrate.test.mjs` runs `functions/migrate.js` (the one-time move of the root data into `/households/{id}`) against the emulator with `firebase-admin`: complete copy, counts verified, nothing deleted, accounts switched last, safe re-run and crash resume.

```
cd tools/rules-test
npm install          # firebase-tools, @firebase/rules-unit-testing, firebase, firebase-admin
npm test             # starts the emulator (needs Java) and runs both test files
```

Run it after every change to `firestore.rules` or `functions/migrate.js`, before deploying with `firebase deploy --only firestore:rules`.
