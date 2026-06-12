/* ═══════════════════════════════════
   MODELS — Firebase Firestore Data Access Layer
   Replaces Mongoose schemas with Firestore collections.
   Each model exports an object with Mongoose-compatible methods.
═══════════════════════════════════ */

const admin = require('firebase-admin');

let firestoreDb = null;

function initFirestore() {
  if (!firestoreDb) {
    firestoreDb = admin.firestore();
  }
  return firestoreDb;
}

function db() {
  return initFirestore();
}

// ── Helpers ──

function wrapDoc(collectionName, docId, data) {
  if (!data) return null;
  const ref = db().collection(collectionName).doc(docId);
  return {
    ...data,
    id: docId,
    _id: docId,
    save: async () => { await ref.set(data, { merge: true }); },
    toObject: () => ({ ...data })
  };
}

async function getDoc(collectionName, docId) {
  const snap = await db().collection(collectionName).doc(docId).get();
  if (!snap.exists) return null;
  return { id: snap.id, _id: snap.id, ...snap.data() };
}

async function getDocs(collectionName, filters = {}) {
  let query = db().collection(collectionName);
  let sortField = null;
  let sortDir = 'asc';

  if (filters.$sort) {
    const entry = Object.entries(filters.$sort)[0];
    sortField = entry[0];
    sortDir = entry[1] === -1 ? 'desc' : 'asc';
    delete filters.$sort;
  }

  // Remove known Mongoose-specific keys before passing to Firestore
  const cleanFilters = { ...filters };
  delete cleanFilters.$sort;

  for (const [key, value] of Object.entries(cleanFilters)) {
    if (value && typeof value === 'object' && value.$gt) {
      query = query.where(key, '>', value.$gt);
    } else if (value && typeof value === 'object' && value.$gte) {
      query = query.where(key, '>=', value.$gte);
    } else if (value && typeof value === 'object' && value.$lt) {
      query = query.where(key, '<', value.$lt);
    } else if (value && typeof value === 'object' && value.$lte) {
      query = query.where(key, '<=', value.$lte);
    } else if (value && typeof value === 'object' && value.$ne) {
      query = query.where(key, '!=', value.$ne);
    } else if (value === '__deleted__' || key === '_id') {
      // skip
    } else {
      query = query.where(key, '==', value);
    }
  }

  if (sortField) {
    query = query.orderBy(sortField, sortDir);
  }

  const snap = await query.get();
  const results = [];
  snap.forEach(doc => results.push({ id: doc.id, _id: doc.id, ...doc.data() }));
  return results;
}

// ── Models ──

exports.Admin = {
  findOne: async (query = {}) => {
    const docs = await getDocs('admins', query);
    return docs.length ? wrapDoc('admins', docs[0].id, docs[0]) : null;
  },
  countDocuments: async (query = {}) => {
    const docs = await getDocs('admins', query);
    return docs.length;
  },
  create: async (data) => {
    const docRef = db().collection('admins').doc();
    await docRef.set(data);
    return { ...data, id: docRef.id, _id: docRef.id, save: async () => {}, toObject: () => ({ ...data }) };
  }
};

exports.Employee = {
  findOne: async (query = {}) => {
    const docs = await getDocs('employees', query);
    return docs.length ? wrapDoc('employees', docs[0].id, docs[0]) : null;
  },
  find: async (query = {}) => {
    const docs = await getDocs('employees', query);
    const result = docs.map(d => ({ ...d }));
    result.lean = () => docs.map(d => ({ ...d }));
    return result;
  },
  findOneAndDelete: async (query = {}) => {
    const docs = await getDocs('employees', query);
    if (!docs.length) return null;
    const doc = docs[0];
    await db().collection('employees').doc(doc.id).delete();
    return wrapDoc('employees', doc.id, doc);
  },
  create: async (data) => {
    const docRef = db().collection('employees').doc(data.id);
    await docRef.set(data);
    return { ...data, id: data.id, _id: data.id, save: async () => {}, toObject: () => ({ ...data }) };
  },
  updateOne: async (filter, update, options = {}) => {
    const docs = await getDocs('employees', filter);
    if (docs.length) {
      const docId = docs[0].id;
      const ref = db().collection('employees').doc(docId);
      const setData = update.$set || update;
      if (options.upsert) {
        await ref.set(setData, { merge: true });
      } else {
        await ref.set(setData, { merge: true });
      }
      return { modifiedCount: 1 };
    } else if (options.upsert) {
      const setId = filter.id || docs[0]?.id || Date.now().toString();
      const ref = db().collection('employees').doc(setId);
      const setData = update.$set || update;
      await ref.set({ ...filter, ...setData });
      return { modifiedCount: 1, upsertedId: setId };
    }
    return { modifiedCount: 0 };
  }
};

exports.Attendance = {
  findOne: async (query = {}) => {
    const docs = await getDocs('attendance', query);
    if (!docs.length) return null;
    const d = docs[0];
    return { ...d, save: async () => { await db().collection('attendance').doc(d.id).set(d, { merge: true }); } };
  },
  find: async (query = {}) => {
    const docs = await getDocs('attendance', query);
    const result = docs.map(d => ({ ...d }));
    result.lean = () => docs.map(d => ({ ...d }));
    return result;
  },
  create: async (data) => {
    const docId = data.id + '_' + data.date;
    const docRef = db().collection('attendance').doc(docId);
    await docRef.set(data);
    return { ...data, _firestoreId: docRef.id, save: async () => {}, toObject: () => ({ ...data }) };
  }
};

exports.LeaveRequest = {
  find: async (query = {}) => {
    const docs = await getDocs('leaveRequests', query);
    const result = docs.map(d => ({ ...d }));
    result.lean = () => docs.map(d => ({ ...d }));
    return result;
  },
  findOne: async (query = {}) => {
    const docs = await getDocs('leaveRequests', query);
    return docs.length ? wrapDoc('leaveRequests', docs[0].id, docs[0]) : null;
  },
  create: async (data) => {
    const docRef = db().collection('leaveRequests').doc();
    await docRef.set(data);
    return { ...data, _firestoreId: docRef.id, toObject: () => ({ ...data }) };
  },
  countDocuments: async (query = {}) => {
    const docs = await getDocs('leaveRequests', query);
    return docs.length;
  }
};

exports.Announcement = {
  find: async (query = {}) => {
    const docs = await getDocs('announcements', query);
    const result = docs.map(d => ({ ...d }));
    result.lean = () => docs.map(d => ({ ...d }));
    return result;
  },
  findOne: async (query = {}) => {
    const docs = await getDocs('announcements', query);
    return docs.length ? wrapDoc('announcements', docs[0].id, docs[0]) : null;
  },
  create: async (data) => {
    const docRef = db().collection('announcements').doc();
    await docRef.set(data);
    return { ...data, _firestoreId: docRef.id, toObject: () => ({ ...data }) };
  }
};

exports.Notification = {
  find: async (query = {}) => {
    const filter = { ...query };
    let sortField = null;
    let sortDir = 'asc';
    if (filter.$sort) {
      const entry = Object.entries(filter.$sort)[0];
      sortField = entry[0];
      sortDir = entry[1] === -1 ? 'desc' : 'asc';
      delete filter.$sort;
    }

    // Handle $or queries
    if (filter.$or) {
      delete filter.$or;
      const snap = await db().collection('notifications').get();
      const all = [];
      snap.forEach(doc => all.push({ id: doc.id, ...doc.data() }));
      // Filter by $or is not directly supported; return all and let caller filter
      const result = all.map(d => ({ ...d }));
      result.lean = () => all.map(d => ({ ...d }));
      return result;
    }

    const docs = await getDocs('notifications', filter);
    let results = docs.map(d => ({ ...d }));
    if (sortField) {
      results.sort((a, b) => {
        const aVal = a[sortField] || '';
        const bVal = b[sortField] || '';
        return sortDir === 'desc' ? (bVal > aVal ? 1 : -1) : (aVal > bVal ? 1 : -1);
      });
    }
    results.lean = () => results.map(d => ({ ...d }));
    return results;
  },
  create: async (data) => {
    const docRef = db().collection('notifications').doc();
    await docRef.set(data);
    return { ...data, _firestoreId: docRef.id, toObject: () => ({ ...data }) };
  }
};

exports.PasswordReset = {
  findOne: async (query = {}) => {
    const docs = await getDocs('passwordResets', query);
    return docs.length ? wrapDoc('passwordResets', docs[0].id, docs[0]) : null;
  },
  create: async (data) => {
    const docRef = db().collection('passwordResets').doc();
    await docRef.set(data);
    return { ...data, _firestoreId: docRef.id, toObject: () => ({ ...data }) };
  },
  deleteMany: async (query = {}) => {
    const docs = await getDocs('passwordResets', query);
    const batch = db().batch();
    docs.forEach(d => batch.delete(db().collection('passwordResets').doc(d.id)));
    await batch.commit();
    return { deletedCount: docs.length };
  }
};

exports.Department = {
  find: async (query = {}) => {
    const docs = await getDocs('departments', query);
    const result = docs.map(d => ({ ...d }));
    result.lean = () => docs.map(d => ({ ...d }));
    return result;
  },
  findOne: async (query = {}) => {
    const docs = await getDocs('departments', query);
    return docs.length ? wrapDoc('departments', docs[0].id, docs[0]) : null;
  },
  create: async (data) => {
    const docRef = db().collection('departments').doc();
    await docRef.set(data);
    return { ...data, _firestoreId: docRef.id, toObject: () => ({ ...data }) };
  },
  countDocuments: async (query = {}) => {
    const docs = await getDocs('departments', query);
    return docs.length;
  },
  insertMany: async (dataArray) => {
    const batch = db().batch();
    dataArray.forEach(data => {
      const ref = db().collection('departments').doc();
      batch.set(ref, data);
    });
    await batch.commit();
  },
  deleteMany: async (query = {}) => {
    const docs = await getDocs('departments', query);
    const batch = db().batch();
    docs.forEach(d => batch.delete(db().collection('departments').doc(d.id)));
    await batch.commit();
  },
  deleteOne: async (query = {}) => {
    const docs = await getDocs('departments', query);
    if (docs.length) {
      await db().collection('departments').doc(docs[0].id).delete();
    }
  }
};

exports.ArchivedEmployee = {
  find: async (query = {}) => {
    const docs = await getDocs('archivedEmployees', query);
    const result = docs.map(d => ({ ...d }));
    result.lean = () => docs.map(d => ({ ...d }));
    return result;
  },
  create: async (data) => {
    const docRef = db().collection('archivedEmployees').doc();
    await docRef.set(data);
    return { ...data, _firestoreId: docRef.id, toObject: () => ({ ...data }) };
  }
};

exports.initFirestore = initFirestore;
