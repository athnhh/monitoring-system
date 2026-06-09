/* ═══════════════════════════════════
   FIREBASE JS — Firebase Realtime Database helper
   Uses firebase-admin on server side
═══════════════════════════════════ */

const admin = require('firebase-admin');

let db = null;
let initialized = false;

function initFirebase() {
  if (initialized) return;
  
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  // If Firebase credentials are not configured, skip initialization
  // (app will fall back to local storage / data.json)
  if (!projectId || !clientEmail || !privateKey || !databaseURL) {
    console.log('Firebase not configured — using local file storage.');
    return;
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n'),
      }),
      databaseURL
    });
    db = admin.database();
    initialized = true;
    console.log('Firebase Realtime Database initialized.');
  } catch (e) {
    console.error('Firebase init error:', e.message);
  }
}

function isFirebaseReady() {
  return initialized && db !== null;
}

// ── Read entire state from Firebase ──
async function readState() {
  if (!isFirebaseReady()) return null;
  try {
    const snap = await db.ref('state').once('value');
    return snap.val();
  } catch (e) {
    console.error('Firebase read error:', e.message);
    return null;
  }
}

// ── Write entire state to Firebase ──
async function writeState(state) {
  if (!isFirebaseReady()) return false;
  try {
    await db.ref('state').set(state);
    return true;
  } catch (e) {
    console.error('Firebase write error:', e.message);
    return false;
  }
}

// ── Update specific path in Firebase ──
async function updateState(path, value) {
  if (!isFirebaseReady()) return false;
  try {
    await db.ref('state/' + path).set(value);
    return true;
  } catch (e) {
    console.error('Firebase update error:', e.message);
    return false;
  }
}

// ── Push to a list in Firebase ──
async function pushToList(path, value) {
  if (!isFirebaseReady()) return null;
  try {
    const ref = db.ref('state/' + path);
    const newRef = ref.push();
    await newRef.set(value);
    return newRef.key;
  } catch (e) {
    console.error('Firebase push error:', e.message);
    return null;
  }
}

module.exports = { initFirebase, isFirebaseReady, readState, writeState, updateState, pushToList };
