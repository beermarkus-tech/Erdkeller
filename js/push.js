// Push notifications (SPEC.md Step 17) — FCM token registration and device
// management for Checklisten-Erinnerungen. This module owns no DOM of its
// own; js/notifications.js renders the Erinnerungen screen's push section
// and calls into the functions exported here, same split as e.g. the
// checklist boundary math (js/checklists.js) living apart from the screen
// that configures its inputs (js/notifications.js) already does.
import { app, auth, db, functions } from './firebase-init.js?v=171';
import { getMessaging, getToken, isSupported } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging.js";
import {
  collection, doc, getDocs, setDoc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";

// Generated once in the Firebase console (Project Settings → Cloud
// Messaging → Web Push certificates — see SPEC.md Section 18). Public by
// design, exactly like firebase-config.js's own values; not a secret.
const VAPID_KEY = 'BMnY1PjLQAGffg7msPZFVJSKkY_FY8acSpcKw4KHSWWoFaQt7Pb_XeGbwgrVtG5Ar3bwm3DS2ty3_mxM932jYDU';

let messaging = null;
let messagingSupported = null; // null = not checked yet

async function ensureMessaging() {
  if (messaging) return messaging;
  if (messagingSupported === false) return null;
  try {
    messagingSupported = await isSupported();
  } catch (err) {
    messagingSupported = false;
  }
  if (!messagingSupported) return null;
  messaging = getMessaging(app);
  return messaging;
}

function deviceLabel() {
  const ua = navigator.userAgent;
  if (/ipad|tablet(?!.*mobile)/i.test(ua)) return 'Tablet';
  if (/mobile|android|iphone/i.test(ua)) return 'Handy';
  return 'Browser';
}

// A stable per-browser-profile id for this device's own doc under
// /users/{uid}/devices/{deviceId}, so re-registering (e.g. after a token
// refresh on app load) updates the SAME doc instead of creating a new one
// every time — the FCM token itself does rotate, this id doesn't.
//
// The one deliberate use of localStorage anywhere in this app (every other
// screen explicitly avoids it, e.g. Notizen's view-mode toggle "not
// persisted across reloads, no localStorage anywhere in this app") — a
// device's own identity is exactly the kind of per-browser-profile state
// localStorage exists for, unlike transient UI preferences, and there is
// no synchronous alternative (Firestore can't hand back a stable id before
// the first write it would be used in).
function deviceId() {
  const KEY = 'erdkeller-device-id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : 'dev-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function permissionState() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

// Must be called from a real user gesture (a click handler) — browsers
// silently ignore/auto-deny a permission prompt fired any other way, and
// once denied it can never be re-prompted from in-app code again (only the
// browser's own site-settings UI can undo a denial). Also doubles as the
// "refresh this device's token" path — requesting permission when it's
// already 'granted' resolves immediately with no new prompt.
export async function enableOnThisDevice() {
  if (!auth.currentUser) throw new Error('Nicht angemeldet.');
  const messagingInstance = await ensureMessaging();
  if (!messagingInstance) throw new Error('Push-Benachrichtigungen werden von diesem Browser nicht unterstützt.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Erlaubnis verweigert — lässt sich nur in den Website-Einstellungen des Browsers manuell zurücksetzen.'
      : 'Erlaubnis nicht erteilt.');
  }

  const reg = await navigator.serviceWorker.ready;
  const token = await getToken(messagingInstance, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) throw new Error('Kein Token erhalten.');

  const ref = doc(db, 'users', auth.currentUser.uid, 'devices', deviceId());
  await setDoc(ref, {
    token,
    label: deviceLabel(),
    userAgent: navigator.userAgent,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  }, { merge: true });

  return token;
}

// Quietly refreshes this device's token/lastSeenAt on every app load if
// permission was already granted in a previous session — never itself
// prompts (permissionState() !== 'granted' short-circuits before anything
// that could trigger a browser prompt).
export async function refreshIfAlreadyEnabled() {
  if (permissionState() !== 'granted' || !auth.currentUser) return;
  try {
    await enableOnThisDevice();
  } catch (err) {
    console.error('Push-Token-Aktualisierung fehlgeschlagen', err);
  }
}

export async function listMyDevices() {
  if (!auth.currentUser) return [];
  const snap = await getDocs(collection(db, 'users', auth.currentUser.uid, 'devices'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

const sendTestNotificationFn = httpsCallable(functions, 'sendTestNotification');
export async function sendTestNotification() {
  const result = await sendTestNotificationFn();
  return result.data;
}

const previewRemindersFn = httpsCallable(functions, 'previewReminders');
export async function previewReminders() {
  const result = await previewRemindersFn();
  return result.data;
}

// Previously refreshIfAlreadyEnabled() only ran when the user happened to
// open Settings -> Erinnerungen (js/notifications.js's loadPushSection) —
// so a token that FCM invalidated between visits (observed: phone token hit
// messaging/registration-token-not-registered) sat dead until someone
// noticed a missed reminder and manually reopened that screen to "re-sync."
// Wiring this to the same signedin event every other module uses for its
// own post-login load makes the re-registration run on every app open,
// silently, with no dependency on visiting that particular screen.
window.addEventListener('erdkeller:signedin', () => { refreshIfAlreadyEnabled(); });
