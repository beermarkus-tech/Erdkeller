import { auth, db } from './firebase-init.js';
import {
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const provider = new GoogleAuthProvider();

const signinBtn = document.getElementById('google-signin-btn');
const signoutBtn = document.getElementById('signout-btn');
const userInfo = document.getElementById('user-info');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const userRole = document.getElementById('user-role');
const authError = document.getElementById('auth-error');

signinBtn.addEventListener('click', () => {
  authError.textContent = '';
  signInWithRedirect(auth, provider).catch((err) => {
    authError.textContent = 'Weiterleitung fehlgeschlagen: ' + err.message;
    console.error(err);
  });
});

signoutBtn.addEventListener('click', () => {
  signOut(auth);
});

getRedirectResult(auth).catch((err) => {
  authError.textContent = 'Anmeldung fehlgeschlagen: ' + err.message;
  console.error(err);
});

async function ensureUserDoc(user) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      name: user.displayName || '',
      role: 'member',
      fcmToken: null,
      createdAt: new Date().toISOString(),
    });
    return { name: user.displayName || '', role: 'member' };
  }
  return snap.data();
}

function renderSignedOut() {
  signinBtn.classList.remove('hidden');
  userInfo.classList.add('hidden');
}

function renderSignedIn(user, userData) {
  signinBtn.classList.add('hidden');
  userInfo.classList.remove('hidden');
  userAvatar.src = user.photoURL || '';
  userName.textContent = userData.name || user.displayName || '';
  userRole.textContent = userData.role === 'admin' ? 'Admin' : 'Mitglied';
  userRole.className = 'user-role ' + (userData.role === 'admin' ? 'role-admin' : 'role-member');
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const userData = await ensureUserDoc(user);
      renderSignedIn(user, userData);
    } catch (err) {
      authError.textContent = 'Nutzerprofil konnte nicht geladen werden: ' + err.message;
      console.error(err);
    }
  } else {
    renderSignedOut();
  }
});
