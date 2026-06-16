/* ═══════════════════════════════════
   FIREBASE JS — Client Firestore persistence & realtime sync
   Works on GitHub Pages (static hosting, no Node server required)
═══════════════════════════════════ */

(function () {
  'use strict';

  const SYNC_DOC_PATH = 'systemConfig/_sync';
  let db = null;
  let ready = false;
  let unsubscribe = null;

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
      console.warn('Firebase: firebase-config.js not configured — using server API.');
      return false;
    }
    if (typeof firebase === 'undefined') {
      console.warn('Firebase: SDK not loaded. Using server API instead.');
      return false;
    }
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(getConfig());
      }
      db = firebase.firestore();
      ready = true;
      console.log('Firebase Firestore initialized (client-side).');
      return true;
    } catch (e) {
      console.error('Firebase init error:', e.message);
      return false;
    }
  }

  function subscribe(callback) {
    if (!ready || !db) return null;
    if (unsubscribe) unsubscribe();
    let lastTimestamp = 0;
    unsubscribe = db.doc(SYNC_DOC_PATH).onSnapshot(
      () => {
        const now = Date.now();
        if (now - lastTimestamp < 2000) return;
        lastTimestamp = now;
        callback({ synced: true, timestamp: now });
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
      updateState: () => {}
    };
  }
})();
