# Firestore security-rules tests

These dev tools are not part of the app. `rules.test.mjs` runs the repo's `firestore.rules` in the local Firestore emulator, under the demo project `demo-erdkeller`, so it never touches the real project. It checks what each kind of account may read and write:

- a stranger;
- a pending account;
- a removed member;
- a member, including a pre-Build-180 one;
- an admin;
- an anonymous visitor;
- (Build 203) members and admins of two separate households: nobody sees or changes another household's data or people, and a moved account can no longer touch the old root data.

`reminders.test.cjs` (Build 205) runs the real reminder scheduler from `functions/index.js` against the emulator, with push sending replaced by a recorder: recipients are household members, each household on its own timezone, removed members and other households get nothing, "remind again after N days" and "done for this period" hold.

```
cd tools/rules-test
npm install          # firebase-tools, @firebase/rules-unit-testing, firebase, firebase-admin, firebase-functions
npm test             # starts the emulator (needs Java) and runs the tests
```

Run it after every change to `firestore.rules` or the reminder code, before deploying with `firebase deploy --only firestore:rules`.
