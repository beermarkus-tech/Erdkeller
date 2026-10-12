// In-memory stand-in for the Firebase SDK modules the app imports from
// www.gstatic.com, so the signed-in screens can be rendered in a headless
// browser with fixture data (tools/i18n-test/run.cjs routes every
// firebasejs/12.18.0/*.js URL here). One module serves all five SDK entry
// points; each real entry point only imports the names it needs.
//
// Fixtures come from window.__FIXTURES__ ({ 'config/taxonomy': {...},
// 'products/p1': {...}, ... }), injected before the app loads.

const store = new Map(Object.entries(window.__FIXTURES__ || {}).map(([k, v]) => [k, structuredClone(v)]));
const listeners = new Set();
let autoId = 0;

// --- app / auth / functions / messaging ------------------------------------
export const initializeApp = () => ({});
export const getApp = () => ({});
const user = window.__USER__ || { uid: 'u-admin', displayName: 'Test Admin', photoURL: '' };
export const initializeAuth = () => ({ currentUser: user });
export const getAuth = initializeAuth;
export const indexedDBLocalPersistence = {}, browserLocalPersistence = {}, browserSessionPersistence = {};
export const browserPopupRedirectResolver = {};
export class GoogleAuthProvider { setCustomParameters(p) { window.__AUTH_PARAMS__ = p; } }
export function onAuthStateChanged(auth, cb) { window.__AUTH_CB__ = cb; setTimeout(() => cb(user), 0); return () => {}; }
export const signInWithPopup = async () => ({ user });
export const signInWithRedirect = async () => {};
export const getRedirectResult = async () => null;
export const signOut = async () => { if (window.__AUTH_CB__) setTimeout(() => window.__AUTH_CB__(null), 0); };
export const getFunctions = () => ({});
export const httpsCallable = (fns, name) => async (payload) => {
  (window.__CALLS__ ||= []).push({ name, payload });
  const r = (window.__CALLABLES__ || {})[name];
  if (r instanceof Error) throw r;
  return { data: typeof r === 'function' ? await r(payload) : (r || {}) };
};
export const isSupported = async () => false;
export const getMessaging = () => ({});
export const getToken = async () => '';
export const onMessage = () => () => {};

// --- firestore ---------------------------------------------------------------
export const CACHE_SIZE_UNLIMITED = -1;
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export const initializeFirestore = () => ({ __db: true });
export const getFirestore = initializeFirestore;
export const disableNetwork = async () => {};
export const enableNetwork = async () => {};

const join = (parts) => parts.filter(Boolean).join('/');
function makeDocRef(path) {
  const id = path.split('/').pop();
  return { type: 'document', path, id };
}
export function doc(base, ...segs) {
  if (base && base.type === 'collection') {
    return makeDocRef(join([base.path, segs.length ? segs.join('/') : `auto${++autoId}`]));
  }
  return makeDocRef(join(segs));
}
export function collection(base, ...segs) {
  const path = base && base.type === 'document' ? join([base.path, ...segs]) : join(segs);
  return { type: 'collection', path, id: path.split('/').pop() };
}
export const where = (field, op, value) => ({ kind: 'where', field, op, value });
export const orderBy = (field, dir = 'asc') => ({ kind: 'orderBy', field, dir });
export const limit = (n) => ({ kind: 'limit', n });
export const query = (coll, ...cs) => ({ type: 'query', path: coll.path, constraints: cs });

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function docSnap(path) {
  const data = store.get(path);
  return {
    id: path.split('/').pop(),
    ref: makeDocRef(path),
    exists: () => data !== undefined,
    data: () => (data === undefined ? undefined : structuredClone(data)),
    get: (f) => get(data, f),
    metadata: { hasPendingWrites: false, fromCache: false },
  };
}
function runQuery(q) {
  const depth = q.path.split('/').length + 1;
  let docs = [...store.keys()]
    .filter((k) => k.startsWith(q.path + '/') && k.split('/').length === depth)
    .map(docSnap);
  for (const c of q.constraints || []) {
    if (c.kind === 'where') {
      docs = docs.filter((d) => {
        const v = get(d.data(), c.field);
        switch (c.op) {
          case '==': return v === c.value;
          case '!=': return v !== c.value;
          case 'in': return c.value.includes(v);
          case 'array-contains': return Array.isArray(v) && v.includes(c.value);
          case '<': return v < c.value; case '<=': return v <= c.value;
          case '>': return v > c.value; case '>=': return v >= c.value;
          default: return true;
        }
      });
    } else if (c.kind === 'orderBy') {
      const s = c.dir === 'desc' ? -1 : 1;
      docs.sort((a, b) => {
        const x = get(a.data(), c.field), y = get(b.data(), c.field);
        return x === y ? 0 : (x > y ? s : -s);
      });
    } else if (c.kind === 'limit') {
      docs = docs.slice(0, c.n);
    }
  }
  return docs;
}
function querySnap(q, prev) {
  const docs = runQuery(q);
  const changes = [];
  const prevMap = prev || new Map();
  docs.forEach((d, i) => {
    const before = prevMap.get(d.id);
    if (!before) changes.push({ type: 'added', doc: d, newIndex: i, oldIndex: -1 });
    else if (JSON.stringify(before) !== JSON.stringify(d.data())) changes.push({ type: 'modified', doc: d, newIndex: i });
  });
  const ids = new Set(docs.map((d) => d.id));
  for (const [id, data] of prevMap) {
    if (!ids.has(id)) changes.push({ type: 'removed', doc: { id, data: () => data, exists: () => false }, oldIndex: 0 });
  }
  return {
    docs, size: docs.length, empty: docs.length === 0,
    forEach: (fn) => docs.forEach(fn),
    docChanges: () => changes,
    metadata: { hasPendingWrites: false, fromCache: false },
    __map: new Map(docs.map((d) => [d.id, d.data()])),
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
export async function getDoc(ref) { await tick(); return docSnap(ref.path); }
export const getDocFromCache = getDoc, getDocFromServer = getDoc;
export async function getDocs(q) { await tick(); return querySnap(q.type === 'query' ? q : { path: q.path, constraints: [] }); }
export const getDocsFromCache = getDocs, getDocsFromServer = getDocs;

export function onSnapshot(target, ...args) {
  const fns = args.filter((a) => typeof a === 'function');
  const obs = args.find((a) => a && typeof a === 'object' && typeof a.next === 'function');
  const next = fns[0] || (obs && obs.next.bind(obs));
  const l = { target, next, prev: null, active: true };
  l.emit = () => {
    if (!l.active) return;
    if (target.type === 'document') return next(docSnap(target.path));
    const q = target.type === 'query' ? target : { path: target.path, constraints: [] };
    const snap = querySnap(q, l.prev);
    l.prev = snap.__map;
    next(snap);
  };
  listeners.add(l);
  setTimeout(l.emit, 0);
  return () => { l.active = false; listeners.delete(l); };
}
function notify() { setTimeout(() => listeners.forEach((l) => l.emit()), 0); }

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  keys.slice(0, -1).forEach((k) => { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k]; });
  if (value && value.__deleteField) delete o[keys.at(-1)];
  else o[keys.at(-1)] = value;
}
function deepMerge(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) {
    if (v && v.__deleteField) delete out[k];
    else out[k] = (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') ? deepMerge(out[k], v) : v;
  }
  return out;
}
function writeSet(ref, data, opts) {
  const clean = structuredClone(data);
  store.set(ref.path, opts && opts.merge ? deepMerge(store.get(ref.path), clean) : clean);
}
function writeUpdate(ref, data) {
  if (!store.has(ref.path)) throw Object.assign(new Error('not-found'), { code: 'not-found' });
  const cur = structuredClone(store.get(ref.path));
  for (const [k, v] of Object.entries(data)) setPath(cur, k, structuredClone(v));
  store.set(ref.path, cur);
}
(window.__WRITES__ ||= []);
export async function setDoc(ref, data, opts) { window.__WRITES__.push(['set', ref.path]); writeSet(ref, data, opts); notify(); }
export async function updateDoc(ref, data) { window.__WRITES__.push(['update', ref.path]); writeUpdate(ref, data); notify(); }
export async function addDoc(coll, data) { const ref = doc(coll); window.__WRITES__.push(['add', ref.path]); writeSet(ref, data); notify(); return ref; }
export async function deleteDoc(ref) { window.__WRITES__.push(['delete', ref.path]); store.delete(ref.path); notify(); }
export function writeBatch() {
  const ops = [];
  return {
    set(ref, data, opts) { ops.push(() => writeSet(ref, data, opts)); return this; },
    update(ref, data) { ops.push(() => writeUpdate(ref, data)); return this; },
    delete(ref) { ops.push(() => store.delete(ref.path)); return this; },
    async commit() { ops.forEach((f) => f()); window.__WRITES__.push(['batch', ops.length]); notify(); },
  };
}
export const deleteField = () => ({ __deleteField: true });
export const serverTimestamp = () => new Date().toISOString();
export const arrayUnion = (...v) => v;
export const increment = (n) => n;
export class Timestamp { static now() { return new Timestamp(); } toDate() { return new Date(); } }
