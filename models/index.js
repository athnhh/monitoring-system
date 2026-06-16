/**
 * models/index.js — Firebase Firestore wrapper
 *
 * Provides the same API surface as the previous Mongoose models (find, findOne,
 * create, save, toObject, updateOne, deleteOne, countDocuments) so server.js
 * controller code requires minimal changes.
 */

const admin = require('firebase-admin');
const path = require('path');

// ── Initialize Firebase Admin SDK ──
//
// Supports two methods:
//   1. Environment variable FIREBASE_SERVICE_ACCOUNT (raw JSON string) — preferred for Vercel
//   2. File path from FIREBASE_SERVICE_ACCOUNT_PATH env var, or default 'firebase-service-account.json'

function loadServiceAccount() {
  // Method 1: Raw JSON string from env var (Vercel-friendly)
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (rawJson) {
    try {
      return JSON.parse(rawJson);
    } catch (e) {
      console.error('FIREBASE_SERVICE_ACCOUNT env var is not valid JSON:', e.message);
    }
  }

  // Method 2: File path from env var, or default path
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    ? path.resolve(__dirname, '..', process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
    : path.join(__dirname, '..', 'firebase-service-account.json');

  return require(serviceAccountPath);
}

let db = null;
try {
  if (!admin.apps.length) {
    const serviceAccount = loadServiceAccount();
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin SDK initialized successfully');
  }
  db = admin.firestore();
} catch (e) {
  console.error('Firebase Admin SDK init error:', e.message);
  console.error('Set FIREBASE_SERVICE_ACCOUNT as an env var (raw JSON) or place firebase-service-account.json in the project root.');
}

// ── Internal Helpers ──

/** Convert a Firestore QuerySnapshot to an array of plain objects with _ref attached */
function snapToArray(snapshot) {
  const results = [];
  snapshot.forEach(doc => {
    if (doc.exists) {
      const data = doc.data();
      results.push(attachRef(doc.ref, { id: doc.id, ...data }));
    }
  });
  return results;
}

/** Convert a single DocumentSnapshot to a plain object with _ref, or null */
function snapToDoc(snapshot) {
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  return attachRef(snapshot.ref, { ...data });
}

/** Attach _ref and helper methods to a data object.
 *  BE CAREFUL: save() must strip ALL non-Firestore properties (_ref, save, toObject)
 *  before writing back, otherwise Firestore will throw "Cannot encode value: async function".
 */
function attachRef(ref, data) {
  // Start with a clean copy — no functions yet
  const obj = { ...data, _ref: ref };

  obj.save = async function () {
    // Build a clean data object — exclude ALL non-data properties
    const { _ref: r, save: s, toObject: t, ...cleanData } = this;
    await r.set(cleanData);
    return this;
  };

  obj.toObject = function () {
    const { _ref: r, save: s, toObject: t, ...rest } = this;
    return rest;
  };

  return obj;
}

/** Build a Firestore query from a simple filter object.
 *  Supports:
 *    { field: value }          → where('field', '==', value)
 *    { $sort: { field: -1 } }  → orderBy('field', 'desc')
 *    { $sort: { field: 1 } }   → orderBy('field', 'asc')
 */
function buildQuery(collectionRef, filter) {
  let query = collectionRef;
  const sort = (filter && filter.$sort) ? { ...filter.$sort } : null;
  const cleanFilter = {};
  if (filter && typeof filter === 'object') {
    for (const key of Object.keys(filter)) {
      if (key === '$sort') continue;
      cleanFilter[key] = filter[key];
      query = query.where(key, '==', filter[key]);
    }
  }
  if (sort && typeof sort === 'object') {
    const sortKey = Object.keys(sort)[0];
    const sortDir = sort[sortKey] === -1 ? 'desc' : 'asc';
    query = query.orderBy(sortKey, sortDir);
  }
  return query;
}

// ── Factory: create a model-like object for a collection ──

function createModel(collectionName) {
  const colRef = () => db ? db.collection(collectionName) : null;

  const model = {
    /** Find documents matching a filter. Returns array. */
    async find(filter = {}) {
      try {
        let query = buildQuery(colRef(), { ...filter });
        // Remove $sort from the filter passed to buildQuery for iterative call
        // Actually buildQuery already handles this
        const snapshot = await query.get();
        return snapToArray(snapshot);
      } catch (e) {
        console.error(`[${collectionName}] find error:`, e.message);
        // Fallback: get all and filter locally
        try {
          const all = await colRef().get();
          let results = snapToArray(all);
          if (filter && typeof filter === 'object') {
            const { $sort, ...conditions } = filter;
            for (const [key, val] of Object.entries(conditions)) {
              results = results.filter(r => r[key] === val);
            }
            if ($sort) {
              const sortKey = Object.keys($sort)[0];
              const sortDir = $sort[sortKey];
              results.sort((a, b) => {
                const va = a[sortKey] || 0;
                const vb = b[sortKey] || 0;
                return sortDir === -1 ? vb - va : va - vb;
              });
            }
          }
          return results;
        } catch (e2) {
          console.error(`[${collectionName}] find fallback error:`, e2.message);
          return [];
        }
      }
    },

    /** Find a single document matching a filter. Returns object or null. */
    async findOne(filter = {}) {
      try {
        let query = buildQuery(colRef(), { ...filter });
        const snapshot = await query.limit(1).get();
        if (snapshot.empty) return null;
        return snapToDoc(snapshot.docs[0]);
      } catch (e) {
        console.error(`[${collectionName}] findOne error:`, e.message);
        // Fallback: get all and filter locally
        try {
          const results = await model.find(filter);
          return results.length > 0 ? results[0] : null;
        } catch (e2) {
          return null;
        }
      }
    },

    /** Create a new document. */
    async create(data) {
      const docId = data.id || data.username || undefined;
      const ref = docId ? colRef().doc(docId) : colRef().doc();
      await ref.set(data);
      return attachRef(ref, { ...data });
    },

    /** Delete a document matching filter. Returns the deleted doc or null. */
    async findOneAndDelete(filter = {}) {
      try {
        const doc = await model.findOne(filter);
        if (!doc) return null;
        await doc._ref.delete();
        return doc;
      } catch (e) {
        console.error(`[${collectionName}] findOneAndDelete error:`, e.message);
        return null;
      }
    },

    /** Count documents in the collection. */
    async countDocuments(filter = {}) {
      try {
        const snapshot = await colRef().get();
        if (!filter || Object.keys(filter).length === 0) return snapshot.size;
        const results = await model.find(filter);
        return results.length;
      } catch (e) {
        console.error(`[${collectionName}] countDocuments error:`, e.message);
        return 0;
      }
    },

    /** Update a document. filter should have an 'id' or be a simple equality filter.
     *  Supports { upsert: true } via options.
     */
    async updateOne(filter = {}, update = {}, options = {}) {
      try {
        // Determine document ID from filter
        let docId = filter.id || null;
        let doc = null;

        if (docId) {
          const ref = colRef().doc(docId);
          if (options.upsert) {
            // Handle $set operator
            const data = update.$set || update;
            await ref.set(data, { merge: true });
            const snap = await ref.get();
            doc = snap.exists ? attachRef(ref, snap.data()) : null;
          } else {
            await ref.update(update);
            const snap = await ref.get();
            doc = snap.exists ? attachRef(ref, snap.data()) : null;
          }
        } else {
          // Find the document first
          doc = await model.findOne(filter);
          if (doc) {
            const updateData = update.$set || update;
            await doc._ref.update(updateData);
            const snap = await doc._ref.get();
            if (snap.exists) {
              Object.assign(doc, snap.data());
            }
          } else if (options.upsert) {
            // Can't upsert without an ID; create new doc
            const data = update.$set || update;
            const ref = colRef().doc();
            await ref.set(data);
            const snap = await ref.get();
            doc = snap.exists ? attachRef(ref, snap.data()) : null;
          }
        }
        return doc;
      } catch (e) {
        console.error(`[${collectionName}] updateOne error:`, e.message);
        // Fallback: find and update locally
        try {
          let doc = await model.findOne(filter);
          if (doc) {
            const updateData = update.$set || update;
            Object.assign(doc, updateData);
            await doc.save();
          } else if (options.upsert) {
            const data = update.$set || update;
            doc = await model.create(data);
          }
          return doc;
        } catch (e2) {
          return null;
        }
      }
    },

    /** Insert multiple documents. */
    async insertMany(docs) {
      try {
        if (!db) return [];
        const batch = db.batch();
        for (const doc of docs) {
          const ref = colRef()?.doc(doc.name || doc.id || String(Math.random()));
          if (ref) batch.set(ref, doc);
        }
        await batch.commit();
        return docs;
      } catch (e) {
        console.error(`[${collectionName}] insertMany error:`, e.message);
        return [];
      }
    },

    /** Delete a single document by filter. */
    async deleteOne(filter = {}) {
      try {
        const doc = await model.findOne(filter);
        if (doc) {
          await doc._ref.delete();
          return { deletedCount: 1 };
        }
        return { deletedCount: 0 };
      } catch (e) {
        console.error(`[${collectionName}] deleteOne error:`, e.message);
        return { deletedCount: 0 };
      }
    },

    /** Delete all documents matching a filter (or all documents if filter is empty). */
    async deleteMany(filter = {}) {
      try {
        const docs = await model.find(filter);
        if (!db) return { deletedCount: 0 };
        const batch = db.batch();
        for (const doc of docs) {
          if (doc._ref) batch.delete(doc._ref);
        }
        await batch.commit();
        return { deletedCount: docs.length };
      } catch (e) {
        console.error(`[${collectionName}] deleteMany error:`, e.message);
        return { deletedCount: 0 };
      }
    }
  };

  return model;
}

// ── Exported Models ──

const Admin = createModel('admins');
const Employee = createModel('employees');
const Attendance = createModel('attendance');
const LeaveRequest = createModel('leaveRequests');
const Announcement = createModel('announcements');
const Notification = createModel('notifications');
const PasswordReset = createModel('passwordResets');
const Department = createModel('departments');
const ArchivedEmployee = createModel('archivedEmployees');
const SystemConfig = createModel('systemConfig');

// Dummy initFirestore for compatibility
function initFirestore() {
  console.log('Firebase Firestore ready (Admin SDK).');
}

module.exports = {
  Admin,
  Employee,
  Attendance,
  LeaveRequest,
  Announcement,
  Notification,
  PasswordReset,
  Department,
  ArchivedEmployee,
  SystemConfig,
  initFirestore,
  // Expose db for direct access if needed
  db
};
