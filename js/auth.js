import { auth, db } from './firebase-init.js?v=148';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const provider = new GoogleAuthProvider();

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
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (FALLBACK_TO_REDIRECT_CODES.includes(err.code)) {
      signInWithRedirect(auth, provider).catch((err2) => {
        authError.textContent = 'Anmeldung fehlgeschlagen: ' + err2.message;
        console.error(err2);
      });
    } else if (!NO_MESSAGE_CODES.includes(err.code)) {
      authError.textContent = 'Anmeldung fehlgeschlagen: ' + err.message;
      console.error(err);
    }
  }
});

signoutButtons.forEach((btn) => btn.addEventListener('click', () => signOut(auth)));

getRedirectResult(auth).catch((err) => {
  authError.textContent = 'Anmeldung fehlgeschlagen: ' + err.message;
  console.error(err);
});

// Creates the user doc on first sign-in; on every later sign-in, quietly
// patches name/photoURL back in sync with the live Google profile if
// they've drifted (Settings → Personen, Build 118, needs a real avatar for
// every user — this is what backfills it with no migration step needed,
// including for accounts that signed in before photoURL was captured
// here at all). role is deliberately never touched here — only Settings →
// Personen's own updateDoc (or self-provisioning above) ever writes it.
async function ensureUserDoc(user) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      name: user.displayName || '',
      photoURL: user.photoURL || '',
      role: 'member',
      fcmToken: null,
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

function renderSignedOut() {
  authGate.classList.remove('hidden');
  appShell.classList.add('hidden');
  window.dispatchEvent(new CustomEvent('erdkeller:signedout'));
}

function renderSignedIn(user, userData) {
  authGate.classList.add('hidden');
  appShell.classList.remove('hidden');

  avatarEls.forEach((el) => { el.src = user.photoURL || ''; });
  nameEls.forEach((el) => { el.textContent = userData.name || user.displayName || ''; });
  roleEls.forEach((el) => {
    el.textContent = userData.role === 'admin' ? 'Admin' : 'Mitglied';
  });

  window.dispatchEvent(new CustomEvent('erdkeller:signedin', { detail: { role: userData.role } }));
}

// Live doc listener (Build 118) rather than a one-shot getDoc — otherwise
// an admin flipping this user's role in Settings → Personen would only
// ever reach them on their next reload/sign-in. onAuthStateChanged only
// fires on genuine auth transitions (sign-in/out, or an account switch on
// the same device), so it's the right place to tear the previous listener
// down before attaching a new one — never more than one live at a time.
let unsubscribeUserDoc = null;

onAuthStateChanged(auth, async (user) => {
  if (unsubscribeUserDoc) {
    unsubscribeUserDoc();
    unsubscribeUserDoc = null;
  }
  if (user) {
    try {
      await ensureUserDoc(user);
    } catch (err) {
      authError.textContent = 'Nutzerprofil konnte nicht geladen werden: ' + err.message;
      console.error(err);
      return;
    }
    const ref = doc(db, 'users', user.uid);
    unsubscribeUserDoc = onSnapshot(ref, (snap) => {
      if (snap.exists()) renderSignedIn(user, snap.data());
    }, (err) => {
      authError.textContent = 'Nutzerprofil konnte nicht geladen werden: ' + err.message;
      console.error(err);
    });
  } else {
    renderSignedOut();
  }
});
