/* ═══════════════════════════════════════════════════════════════
   MODELS — Firestore Data Access Layer
   Replaces Mongoose schemas with Firebase Firestore collections.
   Each model exports an object with Mongoose-compatible methods.
═══════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');

let firestoreDb = null;

/** Initialize Firestore DB instance from the Firebase Admin app */
function initFirestore() {
  if (!firestoreDb) {
    firestoreDb = admin.firestore();
    firestoreDb.settings({ ignoreUndefinedProperties: true });
  }
  return firestoreDb;
}

function db() {
  return initFirestore();
}

// ── Helpers ──

/** Wrap a Firestore doc with a .save() method so existing server code works */
function wrapDoc(collectionName, docId, data) {
  if (!data) return null;
  const ref = db().collection(collectionName).doc(docId);
  return {
    ...data,
    id: docId,
    _id: docId,
    save: async () => {
      await ref.set(data, { merge: true });
    },
    toObject: () => ({ ...data })
  };
}

/** Get a Firestore doc by ID */
async function getDoc(collectionName, docId) {
  const snap = await db().collection(collectionName).doc(docId).get();
  if (!snap.exists) return null;
  return { id: snap.id, _id: snap.id, ...snap.data() };
}

/** Get all docs in a collection (optionally filtered & sorted) */
async function getDocs(collectionName, filters = {}) {
  let query = db().collection(collectionName);
  let sortField = null;
  let sortDir = 'asc';
  for (const [field, value] of Object.entries(filters)) {
    if (field === 'orderBy') {
      const [fieldName, dir] = value.split(':');
      sortField = fieldName;
      sortDir = dir || 'asc';
    } else if (field === '$sort') {
      // $sort: { fieldName: -1 }  (desc)  or  { fieldName: 1 }  (asc)
      const entry = Object.entries(value)[0];
      sortField = entry[0];
      sortDir = entry[1] === -1 ? 'desc' : 'asc';
    } else if (field === 'limit') {
      query = query.limit(value);
    } else {
      query = query.where(field, '==', value);
    }
  }
  if (sortField) query = query.orderBy(sortField, sortDir);
  const snap = await query.get();
  const results = [];
  snap.forEach(doc => results.push({ id: doc.id, _id: doc.id, ...doc.data() }));
  return results;
}

// ── Admin ──
exports.Admin = {
  findOne: async (query = {}) => {
    if (query.username) {
      const data = await getDoc('admins', query.username);
      return data ? wrapDoc('admins', query.username, data) : null;
    }
    const docs = await getDocs('admins', query);
    return docs.length ? wrapDoc('admins', docs[0].id, docs[0]) : null;
  },
  create: async (data) => {
    const id = data.username || 'quemahtech';
    await db().collection('admins').doc(id).set(data);
    return wrapDoc('admins', id, data);
  },
  countDocuments: async () => {
    const snap = await db().collection('admins').get();
    return snap.size;
  }
};

// ── Employee ──
exports.Employee = {
  findOne: async (query = {}) => {
    if (query.id) {
      const data = await getDoc('employees', query.id);
      return data ? wrapDoc('employees', query.id, data) : null;
    }
    if (query.active !== undefined || query.name) {
      const docs = await getDocs('employees', query);
      return docs.length ? wrapDoc('employees', docs[0].id, docs[0]) : null;
    }
    const docs = await getDocs('employees');
    return docs.length ? wrapDoc('employees', docs[0].id, docs[0]) : null;
  },
  find: async (query = {}) => {
    const docs = await getDocs('employees', query);
    const result = docs.map(d => ({ ...d, toObject: () => ({ ...d }) }));
    result.lean = () => result;
    return result;
  },
  findOneAndDelete: async (query) => {
    if (query.id) {
      const data = await getDoc('employees', query.id);
      if (data) {
        await db().collection('employees').doc(query.id).delete();
        return data;
      }
    }
    return null;
  },
  create: async (data) => {
    const id = data.id;
    await db().collection('employees').doc(id).set(data);
    return wrapDoc('employees', id, data);
  },
  updateOne: async (query, update) => {
    if (query.id) {
      const ref = db().collection('employees').doc(query.id);
      if (update.$set) {
        await ref.set(update.$set, { merge: true });
      } else {
        await ref.set(update, { merge: true });
      }
      return { modifiedCount: 1, matchedCount: 1 };
    }
    return { modifiedCount: 0, matchedCount: 0 };
  },
  countDocuments: async (query = {}) => {
    const docs = await getDocs('employees', query);
    return docs.length;
  }
};

// ── Attendance ──
exports.Attendance = {
  findOne: async (query = {}) => {
    if (query.id && query.date) {
      const docId = query.id + '_' + query.date;
      const data = await getDoc('attendances', docId);
      if (data) return wrapDoc('attendances', docId, data);
      return null;
    }
    const docs = await getDocs('attendances', query);
    return docs.length ? docs[0] : null;
  },
  find: async (query = {}) => {
    const docs = await getDocs('attendances', query);
    const result = docs.map(d => ({ ...d, toObject: () => ({ ...d }) }));
    result.lean = () => result;
    return result;
  },
  create: async (data) => {
    const docId = data.id + '_' + data.date;
    await db().collection('attendances').doc(docId).set(data);
    return { ...data, _id: docId };
  }
};

// ── LeaveRequest ──
exports.LeaveRequest = {
  findOne: async (query = {}) => {
    if (query.idx !== undefined) {
      const docs = await getDocs('leaveRequests', { idx: query.idx });
      return docs.length ? docs[0] : null;
    }
    const docs = await getDocs('leaveRequests', query);
    return docs.length ? docs[0] : null;
  },
  find: async (query = {}) => {
    const docs = await getDocs('leaveRequests', query);
    const result = docs.map(d => ({ ...d, toObject: () => ({ ...d }) }));
    result.lean = () => result;
    return result;
  },
  findByIdAndUpdate: async (id, update) => {
    const ref = db().collection('leaveRequests').doc(id);
    await ref.set(update, { merge: true });
    return { ...update, _id: id };
  },
  create: async (data) => {
    const docRef = db().collection('leaveRequests').doc();
    await docRef.set(data);
    return { ...data, _firestoreId: docRef.id, toObject: () => ({ ...data }) };
  },
  countDocuments: async () => {
    const snap = await db().collection('leaveRequests').get();
    return snap.size;
  }
};

// ── Announcement ──
exports.Announcement = {
  find: async (query = {}) => {
    const docs = await getDocs('announcements', query);
    const result = docs.map(d => ({ ...d, toObject: () => ({ ...d }) }));
    result.lean = () => result;
    return result;
  },
  create: async (data) => {
    const docRef = db().collection('announcements').doc();
    await docRef.set(data);
    return { ...data, _firestoreId: docRef.id, toObject: () => ({ ...data }) };
  },
  updateOne: async (query, update) => {
    if (query.subject && query.date) {
      const docs = await getDocs('announcements', { subject: query.subject });
      const match = docs.find(d => d.date === query.date);
      if (match) {
        const ref = db().collection('announcements').doc(match.id);
        if (update.$set) {
          await ref.set(update.$set, { merge: true });
        } else {
          await ref.set(update, { merge: true });
        }
        return { modifiedCount: 1 };
      }
    }
    return { modifiedCount: 0 };
  }
};

// ── Notification ──
exports.Notification = {
  create: async (data) => {
    const docRef = db().collection('notifications').doc();
    await docRef.set({
      ...data,
      createdAt: new Date().toISOString()
    });
    return { ...data, _firestoreId: docRef.id, toObject: () => ({ ...data }) };
  },
  find: async (query = {}) => {
    let ref = db().collection('notifications');
    if (query['$or']) {
      const snap = await ref.get();
      const results = [];
      snap.forEach(doc => results.push({ id: doc.id, ...doc.data() }));
      const filtered = results.filter(r => {
        return query['$or'].some(condition => {
          return Object.entries(condition).every(([k, v]) => r[k] === v);
        });
      });
      filtered.lean = () => filtered;
      return filtered;
    }
    const docs = await getDocs('notifications', query);
    const result = docs.map(d => ({ ...d }));
    result.lean = () => result;
    return result;
  }
};

// ── PasswordReset ──
exports.PasswordReset = {
  findOne: async (query = {}) => {
    let ref = db().collection('passwordResets');
    // Handle $gt for dates
    if (query.expiresAt && query.expiresAt.$gt) {
      const snap = await ref.get();
      let results = [];
      snap.forEach(doc => results.push({ id: doc.id, ...doc.data() }));
      const match = results.find(r =>
        r.userId === query.userId &&
        r.otp === query.otp &&
        new Date(r.expiresAt) > new Date(query.expiresAt.$gt)
      );
      return match || null;
    }
    const docs = await getDocs('passwordResets', query);
    return docs.length ? docs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] : null;
  },
  create: async (data) => {
    const docRef = db().collection('passwordResets').doc();
    await docRef.set({
      ...data,
      expiresAt: data.expiresAt.toISOString(),
      createdAt: new Date().toISOString()
    });
    return { ...data, _firestoreId: docRef.id };
  },
  deleteOne: async (query) => {
    if (query._id) {
      await db().collection('passwordResets').doc(query._id).delete();
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  }
};

// ── Department ──
exports.Department = {
  findOne: async (query = {}) => {
    if (query.name) {
      const data = await getDoc('departments', query.name);
      return data || null;
    }
    const docs = await getDocs('departments', query);
    return docs.length ? docs[0] : null;
  },
  find: async (query = {}) => {
    const docs = await getDocs('departments', query);
    const result = docs.map(d => ({ ...d }));
    result.lean = () => result;
    return result;
  },
  create: async (data) => {
    const id = data.name;
    await db().collection('departments').doc(id).set(data);
    return { ...data, _id: id };
  },
  insertMany: async (items) => {
    const batch = db().batch();
    items.forEach(item => {
      const ref = db().collection('departments').doc(item.name);
      batch.set(ref, item);
    });
    await batch.commit();
    return items;
  },
  deleteOne: async (query) => {
    if (query.name) {
      await db().collection('departments').doc(query.name).delete();
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  },
  deleteMany: async () => {
    const snap = await db().collection('departments').get();
    const batch = db().batch();
    snap.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    return { deletedCount: snap.size };
  },
  countDocuments: async () => {
    const snap = await db().collection('departments').get();
    return snap.size;
  }
};

// ── ArchivedEmployee ──
exports.ArchivedEmployee = {
  findOne: async (query = {}) => {
    if (query.originalId) {
      const data = await getDoc('archivedEmployees', query.originalId);
      return data || null;
    }
    const docs = await getDocs('archivedEmployees', query);
    return docs.length ? docs[0] : null;
  },
  find: async (query = {}) => {
    const docs = await getDocs('archivedEmployees', query);
    const result = docs.map(d => ({ ...d }));
    result.lean = () => result;
    return result;
  },
  create: async (data) => {
    const id = data.originalId || data.id;
    await db().collection('archivedEmployees').doc(id).set(data);
    return { ...data, _id: id };
  }
};

// ── Export init function for server.js ──
exports.initFirestore = initFirestore;
