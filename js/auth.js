import { auth, db } from './firebase-init.js?v=177';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  browserPopupRedirectResolver,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const provider = new GoogleAuthProvider();

// Build 169 — js/firebase-init.js now calls initializeAuth() with no
// popupRedirectResolver, specifically to stop Auth loading a gapi iframe
// from apis.google.com as part of its own init on every boot (see that
// file's comment for the full story). This resolver is what restores
// popup/redirect sign-in on demand — passed explicitly to the three calls
// below, so it's only ever fetched when someone actually taps "Anmelden".

const authGate = document.getElementById('auth-gate');
const appShell = document.getElementById('app');
const signinBtn = document.getElementById('google-signin-btn');
const authError = document.getElementById('auth-error');

const signoutButtons = [
  document.getElementById('signout-btn-sidebar'),
  document.getElementById('signout-btn-topbar'),
];
const avatarEls = [
  document.getElementById('user-avatar-sidebar'),
  document.getElementById('user-avatar-topbar'),
];
const nameEls = [
  document.getElementById('user-name-sidebar'),
  document.getElementById('user-name-topbar'),
];
const roleEls = [
  document.getElementById('user-role-sidebar'),
  document.getElementById('user-role-topbar'),
];

const NO_MESSAGE_CODES = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'];
const FALLBACK_TO_REDIRECT_CODES = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'];

// --- Cached identity (SPEC.md Section 13) --------------------------------
//
// The last known signed-in identity, kept locally so the app can render
// IMMEDIATELY on startup instead of waiting for Firebase Auth to resolve.
// This is the standard offline-first pattern: render from the last known
// local identity, verify in the background, and only fall back to the login
// screen when verification actively says "no user".
//
// Why it's needed: three sequential network-dependent gates used to block
// the entire UI on every cold start — (1) Auth's own init, which tries to
// refresh an expired ID token against securetoken.googleapis.com and has to
// wait for that to fail when offline, (2) ensureUserDoc's getDoc, which in
// its default mode tries the server first and only falls back to cache once
// the attempt fails, and (3) the first onSnapshot emission. Offline that
// stacked up to 5-25s, worst on the phone.
//
// It also works around firebase-js-sdk#5813: after roughly an hour offline
// the failed token refresh gets treated as a sign-out, which for a crisis
// app would mean being locked out in exactly the situation the app exists
// for. See the offline branch in onAuthStateChanged below.
//
// The third deliberate localStorage use in this app (after push.js's
// deviceId and the Verbindung toggles): it must be readable synchronously,
// before any async Firebase call, which is the whole point.
//
// Not a security boundary. Firestore rules are enforced server-side, so a
// tampered `role` here only reveals admin UI whose writes the server still
// rejects; and the cached data it renders came from an authenticated
// session on this same device, which anyone holding the unlocked phone
// could already read.
const LAST_USER_KEY = 'erdkeller-last-user';

function readCachedIdentity() {
  try {
    const raw = localStorage.getItem(LAST_USER_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.uid ? parsed : null;
  } catch (err) {
    return null;
  }
}

function writeCachedIdentity(user, userData) {
  try {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify({
      uid: user.uid,
      name: (userData && userData.name) || user.displayName || '',
      photoURL: (userData && userData.photoURL) || user.photoURL || '',
      role: (userData && userData.role) || 'member',
    }));
  } catch (err) {
    // A full or unavailable localStorage must never break sign-in.
  }
}

function clearCachedIdentity() {
  try {
    localStorage.removeItem(LAST_USER_KEY);
  } catch (err) { /* ignore */ }
}

// Set by the sign-out buttons so the offline branch below can tell a
// deliberate sign-out (honour it) from Auth reporting no user because it
// couldn't reach the network (ignore it).
let explicitSignOut = false;

// Set right before signInWithRedirect() and checked at the NEXT boot to
// decide whether getRedirectResult() is even worth calling — see that call
// below for why this matters far more than it looks like it should.
const PENDING_REDIRECT_KEY = 'erdkeller-pending-redirect';

signinBtn.addEventListener('click', async () => {
  authError.textContent = '';
  try {
    // Popup is primary: it completes via a live postMessage channel while
    // the popup stays open, so it isn't affected by Chrome's third-party
    // storage partitioning — unlike signInWithRedirect, which relies on a
    // storage/cookie relay through the authDomain (a different origin than
    // github.io here) to hand the result back after a full page reload.
    // That relay is silently dropped under storage partitioning: no error,
    // the app just never sees a signed-in user. Redirect stays as a
    // fallback for contexts where popups genuinely don't work.
    await signInWithPopup(auth, provider, browserPopupRedirectResolver);
  } catch (err) {
    if (FALLBACK_TO_REDIRECT_CODES.includes(err.code)) {
      try { sessionStorage.setItem(PENDING_REDIRECT_KEY, '1'); } catch (e) { /* ignore */ }
      signInWithRedirect(auth, provider, browserPopupRedirectResolver).catch((err2) => {
        authError.textContent = 'Anmeldung fehlgeschlagen: ' + err2.message;
        console.error(err2);
      });
    } else if (!NO_MESSAGE_CODES.includes(err.code)) {
      authError.textContent = 'Anmeldung fehlgeschlagen: ' + err.message;
      console.error(err);
    }
  }
});

signoutButtons.forEach((btn) => btn.addEventListener('click', () => {
  // Clear the cached identity FIRST: a deliberate sign-out must win even if
  // the signOut() call itself can't reach the network right now, otherwise
  // the offline branch in onAuthStateChanged would helpfully keep the app
  // open for a user who just asked to leave it.
  explicitSignOut = true;
  clearCachedIdentity();
  signOut(auth);
}));

// Only call getRedirectResult() if there is ACTUAL evidence a redirect
// sign-in was just started — not merely "we appear to be online" as Build
// 162 tried. That navigator.onLine guard turned out to be dead code: field
// testing proved this exact device reports navigator.onLine === true even
// with WLAN and Flugmodus both fully off, so the guard never once actually
// skipped this call, and every "offline" boot since Build 162 kept hitting
// the same hang it was meant to prevent.
//
// getRedirectResult() forces Firebase Auth to lazily initialise its
// popup/redirect helper (a gapi iframe from apis.google.com/js/api.js) if
// it hasn't been already — confirmed in the field to hang for 15-45+
// SECONDS when that request can't complete, and this was blocking far more
// than just the redirect check: Firestore's own listeners appear to queue
// behind Auth's internal state settling, so onAuthStateChanged staying
// unresolved this long meant even cached data sat empty on screen the
// whole time, despite the app-level grace-period fallback (js/auth.js's
// boot logic) dispatching erdkeller:signedin promptly on its own schedule.
//
// signInWithPopup is the PRIMARY sign-in method (see the click handler
// above) and never touches this path — getRedirectResult only matters for
// the rare fallback where popup failed and the app fell back to
// signInWithRedirect. So: only call it if that fallback just ran, recorded
// via a sessionStorage flag set immediately before signInWithRedirect() is
// called. Cleared unconditionally after checking, whether or not a result
// was found, so a stale flag can never cause this to fire again on some
// unrelated later boot.
let hadPendingRedirect = false;
try { hadPendingRedirect = sessionStorage.getItem(PENDING_REDIRECT_KEY) === '1'; } catch (e) { /* ignore */ }
if (hadPendingRedirect) {
  try { sessionStorage.removeItem(PENDING_REDIRECT_KEY); } catch (e) { /* ignore */ }
  getRedirectResult(auth, browserPopupRedirectResolver).catch((err) => {
    authError.textContent = 'Anmeldung fehlgeschlagen: ' + err.message;
    console.error(err);
  });
}

// Creates the user doc on first sign-in; on every later sign-in, quietly
// patches name/photoURL back in sync with the live Google profile if
// they've drifted (Settings → Personen, Build 118, needs a real avatar for
// every user — this is what backfills it with no migration step needed,
// including for accounts that signed in before photoURL was captured
// here at all). role is deliberately never touched here — only Settings →
// Personen's own updateDoc (or self-provisioning above) ever writes it.
async function ensureUserDoc(user) {
  // Skipped entirely when offline. getDoc's default mode tries the server
  // first and only reads cache once that attempt fails, so offline this is
  // pure waiting — and neither of the two things it does (create the doc on
  // first sign-in, patch a drifted name/photo) is urgent enough to block
  // startup for. The onSnapshot listener below still delivers the profile
  // from cache regardless.
  if (!navigator.onLine) return;
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      name: user.displayName || '',
      photoURL: user.photoURL || '',
      role: 'member',
      createdAt: new Date().toISOString(),
    });
    return;
  }
  const data = snap.data();
  const patch = {};
  if ((user.displayName || '') !== (data.name || '')) patch.name = user.displayName || '';
  if ((user.photoURL || '') !== (data.photoURL || '')) patch.photoURL = user.photoURL || '';
  if (Object.keys(patch).length) await updateDoc(ref, patch);
}

// The role currently reflected in the UI, or null while signed out. Used to
// avoid re-dispatching erdkeller:signedin when the verified identity turns
// out to match the cached one we already rendered from — otherwise every
// screen in the app would reload its data a second time on every startup.
let renderedRole = null;

function renderSignedOut() {
  renderedRole = null;
  authGate.classList.remove('hidden');
  appShell.classList.add('hidden');
  window.dispatchEvent(new CustomEvent('erdkeller:signedout'));
}

// Pure UI, no events. Takes a plain { name, photoURL, role } shape so it can
// paint equally from the locally cached identity (instantly, at boot) and
// from the verified Firestore profile (a moment later).
//
// Kept separate from renderSignedIn because the boot path must NOT fire
// erdkeller:signedin: at that point Firebase Auth hasn't resolved yet, so
// auth.currentUser is still null, and every module that loads data on that
// event would have its Firestore reads rejected with permission-denied —
// exactly the hazard js/taxonomy.js:555-558 documents. Showing the shell
// early is safe; asking the app to fetch data early is not.
function paintSignedIn(identity) {
  authGate.classList.add('hidden');
  appShell.classList.remove('hidden');

  avatarEls.forEach((el) => { el.src = identity.photoURL || ''; });
  nameEls.forEach((el) => { el.textContent = identity.name || ''; });
  roleEls.forEach((el) => {
    el.textContent = identity.role === 'admin' ? 'Admin' : 'Mitglied';
  });
}

function renderSignedIn(identity) {
  paintSignedIn(identity);

  if (renderedRole !== identity.role) {
    renderedRole = identity.role;
    window.dispatchEvent(new CustomEvent('erdkeller:signedin', { detail: { role: identity.role } }));
  }
}

// Live doc listener (Build 118) rather than a one-shot getDoc — otherwise
// an admin flipping this user's role in Settings → Personen would only
// ever reach them on their next reload/sign-in. onAuthStateChanged only
// fires on genuine auth transitions (sign-in/out, or an account switch on
// the same device), so it's the right place to tear the previous listener
// down before attaching a new one — never more than one live at a time.
let unsubscribeUserDoc = null;

// Set the moment onAuthStateChanged fires for the first time, and used by
// the boot grace-period timer below to know whether it still needs to act.
// See that timer's comment for why this can't just check navigator.onLine.
let authSettled = false;
let bootDataTimer = null;

onAuthStateChanged(auth, async (user) => {
  authSettled = true;
  if (bootDataTimer) {
    clearTimeout(bootDataTimer);
    bootDataTimer = null;
  }

  if (unsubscribeUserDoc) {
    unsubscribeUserDoc();
    unsubscribeUserDoc = null;
  }

  if (user) {
    // Deliberately NOT awaited, and its failure no longer blocks rendering.
    // Previously an error here returned early, so a single failed profile
    // read left the app stuck on the login screen forever even though the
    // session was perfectly valid.
    ensureUserDoc(user).catch((err) => {
      console.error('Nutzerprofil konnte nicht aktualisiert werden', err);
    });

    // Render straight away from whatever we already know, so the UI never
    // waits on Firestore. The snapshot below refines this the moment it
    // arrives (from cache offline, from the server online).
    const cached = readCachedIdentity();
    if (cached && cached.uid === user.uid) {
      renderSignedIn(cached);
    } else {
      // A different account than the one cached (or none cached). Drop the
      // stale entry and fall back to 'member' rather than inheriting the
      // previous user's role — least privilege, so a member signing in on
      // an admin's device never gets a flash of admin UI before the real
      // profile arrives.
      if (cached) clearCachedIdentity();
      renderSignedIn({
        name: user.displayName || '',
        photoURL: user.photoURL || '',
        role: 'member',
      });
    }

    const ref = doc(db, 'users', user.uid);
    unsubscribeUserDoc = onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      renderSignedIn({
        name: data.name || user.displayName || '',
        photoURL: data.photoURL || user.photoURL || '',
        role: data.role,
      });
      writeCachedIdentity(user, data);
    }, (err) => {
      // Non-fatal: the app is already rendered by this point. Log only —
      // painting an error onto a screen the user isn't even looking at was
      // pure noise.
      console.error('Nutzerprofil-Listener fehlgeschlagen', err);
    });
    return;
  }

  // No user. Offline, that is very often NOT a real sign-out: Firebase
  // treats a token refresh it couldn't perform as a signed-out state
  // (firebase-js-sdk#5813), which after ~1h offline would lock the
  // household out of a crisis app precisely when they need it. So while
  // offline, keep trusting the cached identity and leave the app up; a
  // genuine sign-out sets explicitSignOut and clears the cache first, and
  // anything else is re-verified for real the next time we're online.
  const cached = readCachedIdentity();
  if (!explicitSignOut && !navigator.onLine && cached) {
    renderSignedIn(cached);
    return;
  }

  explicitSignOut = false;
  clearCachedIdentity();
  renderSignedOut();
});

// Boot: before Firebase Auth has resolved anything at all, put the app on
// screen from the cached identity. This is what makes a start from a warm
// cache feel instant instead of a multi-second wait staring at a login
// screen you already passed. With no cached identity (first ever run, or
// after a real sign-out) nothing happens here and the normal login screen
// shows.
const bootIdentity = readCachedIdentity();
if (bootIdentity) {
  // Paint the shell immediately either way. Whether it's also safe to start
  // loading DATA immediately (i.e. dispatch erdkeller:signedin) depends on
  // whether Firestore reads will hit the network unauthenticated — which is
  // NOT reliably predicted by navigator.onLine, as Build 165 assumed.
  //
  // Observed in the field: navigator.onLine reported true (Wi-Fi was up)
  // while auth was actually unreachable, and Firebase Auth's own init hung
  // indefinitely trying to load its popup/redirect iframe helper from
  // apis.google.com — onAuthStateChanged never fired at all, not even after
  // 25+ seconds. The "wait for the real event, it's only a few hundred ms"
  // assumption behind the online branch was therefore wrong exactly when it
  // mattered: the household was online-per-navigator.onLine but staring at
  // empty screens indefinitely.
  //
  // So: paint now, and ALSO start a short grace-period timer. If Auth
  // hasn't settled by the time it fires, start loading data from the cached
  // identity regardless of what navigator.onLine claims — a real
  // onAuthStateChanged that resolves after this still corrects everything
  // via the normal handler above (renderedRole's dedup means a matching
  // role just doesn't re-dispatch; a different one, or no user, does the
  // right thing). In the common case auth resolves in well under 1.5s and
  // this timer never fires at all, so nothing changes for a healthy
  // connection.
  paintSignedIn(bootIdentity);
  bootDataTimer = setTimeout(() => {
    bootDataTimer = null;
    if (!authSettled) renderSignedIn(bootIdentity);
  }, 1500);
}
