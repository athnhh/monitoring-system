/* ═══════════════════════════════════
   FIREBASE JS — Client Firestore persistence & realtime sync
   Works on GitHub Pages (static hosting, no Node server required)
═══════════════════════════════════ */

(function () {
  'use strict';

  const STATE_DOC_PATH = 'ems/state';
  let db = null;
  let ready = false;
  let unsubscribe = null;
  let remoteUpdatedAt = 0;
  let localWriteInProgress = false;

  function getConfig() {
    if (typeof window === 'undefined') return null;
    return window.FIREBASE_CONFIG || null;
  }

  function isConfigured() {
    const cfg = getConfig();
    return cfg && cfg.apiKey && cfg.apiKey !== 'YOUR_API_KEY' && cfg.projectId && cfg.projectId !== 'YOUR_PROJECT_ID';
  }

  function init() {
    if (!isConfigured()) {
      console.warn('Firebase: firebase-config.js not configured — using server/local cache fallback.');
      return false;
    }
    if (typeof firebase === 'undefined') {
      console.error('Firebase: SDK not loaded. Add firebase-app-compat and firebase-firestore-compat scripts.');
      return false;
    }
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(getConfig());
      }
      db = firebase.firestore();
      ready = true;
      console.log('Firebase Firestore initialized.');
      return true;
    } catch (e) {
      console.error('Firebase init error:', e.message);
      return false;
    }
  }

  async function loadState() {
    if (!ready || !db) return null;
    try {
      const snap = await db.doc(STATE_DOC_PATH).get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (data.updatedAt && data.updatedAt.toMillis) {
        remoteUpdatedAt = data.updatedAt.toMillis();
      }
      return extractState(data);
    } catch (e) {
      console.error('Firebase load error:', e.message);
      return null;
    }
  }

  function extractState(data) {
    if (!data) return null;
    return {
      adminPassword: data.adminPassword || 'quemah123',
      employees: data.employees || [],
      archivedEmployees: data.archivedEmployees || [],
      attendanceRecords: data.attendanceRecords || [],
      leaveRequests: data.leaveRequests || [],
      announcements: data.announcements || [],
      adminNotifications: data.adminNotifications || [],
      empNotifications: data.empNotifications || [],
      departments: data.departments || ['Engineering', 'HR', 'IT', 'Marketing', 'Finance', 'Operations']
    };
  }

  async function saveState(state) {
    if (!ready || !db) return false;
    localWriteInProgress = true;
    try {
      const payload = {
        adminPassword: state.adminPassword || 'quemah123',
        employees: state.employees || [],
        archivedEmployees: state.archivedEmployees || [],
        attendanceRecords: state.attendanceRecords || [],
        leaveRequests: state.leaveRequests || [],
        announcements: state.announcements || [],
        adminNotifications: state.adminNotifications || [],
        empNotifications: state.empNotifications || [],
        departments: state.departments || [],
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await db.doc(STATE_DOC_PATH).set(payload, { merge: true });
      remoteUpdatedAt = Date.now();
      return true;
    } catch (e) {
      console.error('Firebase save error:', e.message);
      return false;
    } finally {
      setTimeout(() => { localWriteInProgress = false; }, 800);
    }
  }

  function subscribe(callback) {
    if (!ready || !db) return null;
    if (unsubscribe) unsubscribe();
    unsubscribe = db.doc(STATE_DOC_PATH).onSnapshot(
      (snap) => {
        if (localWriteInProgress) return;
        if (!snap.exists) return;
        const data = snap.data();
        const ts = data.updatedAt && data.updatedAt.toMillis ? data.updatedAt.toMillis() : 0;
        if (ts && ts <= remoteUpdatedAt) return;
        remoteUpdatedAt = ts || Date.now();
        callback(extractState(data));
      },
      (err) => console.error('Firebase listener error:', err.message)
    );
    return unsubscribe;
  }

  function stopListening() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  }

  function isReady() {
    return ready;
  }

  const api = {
    init,
    loadState,
    saveState,
    subscribe,
    stopListening,
    isReady,
    isConfigured
  };

  // Browser: expose on window
  if (typeof window !== 'undefined') {
    window.FirebaseDB = api;
  }

  // Node.js: export for require() in server.js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      initFirebase: init,
      isFirebaseReady: isReady,
      readState: loadState,
      writeState: saveState,
      updateState: () => {} // placeholder (not used in server.js)
    };
  }
})();
