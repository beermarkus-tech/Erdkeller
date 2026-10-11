# Firestore security-rules tests

These dev tools are not part of the app. `rules.test.mjs` runs the repo's `firestore.rules` in the local Firestore emulator, under the demo project `demo-erdkeller`, so it never touches the real project. It checks what each kind of account may read and write:

- a stranger;
- a pending account;
- a removed member;
- a member, including a pre-Build-180 one;
- an admin;
- an anonymous visitor.

```
cd tools/rules-test
npm install          # firebase-tools, @firebase/rules-unit-testing, firebase
npm test             # starts the emulator (needs Java) and runs the tests
```

Run it after every change to `firestore.rules`, before deploying with `firebase deploy --only firestore:rules`.
