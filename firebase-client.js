/* ═══════════════════════════════════════
   FIREBASE CLIENT — Direct Firestore access
   Replaces server API for GitHub Pages
═══════════════════════════════════════ */
(function () {
  'use strict';

  let db = null;
  let ready = false;

  function init() {
    if (typeof firebase === 'undefined') {
      console.warn('[FBClient] Firebase SDK not loaded');
      return false;
    }
    if (!window.FIREBASE_CONFIG) {
      console.warn('[FBClient] FIREBASE_CONFIG not found');
      return false;
    }
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(window.FIREBASE_CONFIG);
      }
      db = firebase.firestore();
      ready = true;
      console.log('[FBClient] Initialized');
      return true;
    } catch (e) {
      console.error('[FBClient] Init error:', e.message);
      return false;
    }
  }

  // ── Router: maps API calls to Firestore operations ──

  async function call(method, path, body) {
    if (!ready) return null;
    try {
      const handler = _route(method, path, body);
      if (!handler) return null;
      return await handler();
    } catch (e) {
      console.error('[FBClient] Error:', path, e.message);
      return null;
    }
  }

  function _route(method, path, body) {
    // Auth
    if (path === '/api/auth/login' && method === 'POST')
      return () => _login(body.uid, body.pwd);
    if (path === '/api/auth/logout' && method === 'POST')
      return () => ({ success: true });
    if (path === '/api/auth/password' && method === 'PUT')
      return () => _changePassword(body.userId, body.currentPwd, body.newPwd || body.newPassword);
    if (path === '/api/auth/forgot-password' && method === 'POST')
      return () => _forgotPassword(body.uid);

    // Health / State
    if (path === '/api/health' && method === 'GET')
      return () => ({ status: 'ok', db: 'connected' });
    if (path === '/api/state' && method === 'GET')
      return () => _getState();

    // Employees
    if (path === '/api/employees' && method === 'GET')
      return () => _getAll('employees');
    if (path === '/api/employees' && method === 'POST')
      return () => _createEmployee(body);

    const empMatch = path.match(/^\/api\/employees\/([^/]+)$/);
    if (empMatch) {
      const id = decodeURIComponent(empMatch[1]);
      if (method === 'GET') return () => _getEmployee(id);
      if (method === 'PUT') return () => _updateEmployee(id, body);
      if (method === 'DELETE') return () => _deleteEmployee(id);
    }
    const archiveMatch = path.match(/^\/api\/employees\/([^/]+)\/archive$/);
    if (archiveMatch && method === 'POST')
      return () => _archiveEmployee(decodeURIComponent(archiveMatch[1]));

    // Attendance
    if (path === '/api/attendance' && method === 'GET')
      return () => _getAll('attendance');
    if (path === '/api/attendance' && method === 'POST')
      return () => _saveAttendance(body);

    // Leave requests
    if (path === '/api/leave-requests' && method === 'GET')
      return () => _getAll('leaveRequests');
    if (path === '/api/leave-requests' && method === 'POST')
      return () => _createLeaveRequest(body);
    const lrMatch = path.match(/^\/api\/leave-requests\/([^/]+)$/);
    if (lrMatch && method === 'PUT')
      return () => _updateLeaveRequest(decodeURIComponent(lrMatch[1]), body);

    // Announcements
    if (path === '/api/announcements' && method === 'GET')
      return () => _getAll('announcements');
    if (path === '/api/announcements' && method === 'POST')
      return () => _createAnnouncement(body);

    // Departments
    if (path === '/api/departments' && method === 'GET')
      return () => _getDepartments();
    if (path === '/api/departments' && method === 'POST')
      return () => _addDepartment(body.name);
    const deptMatch = path.match(/^\/api\/departments\/(.+)$/);
    if (deptMatch && method === 'DELETE')
      return () => _removeDepartment(decodeURIComponent(deptMatch[1]));

    // Notifications
    if (path === '/api/notifications' && method === 'POST')
      return () => _addNotification(body);
    const notifMatch = path.match(/^\/api\/notifications\/([^/]+)$/);
    if (notifMatch && method === 'GET')
      return () => _getNotifications(decodeURIComponent(notifMatch[1]));
    if (path === '/api/notifications/mark-read' && method === 'POST')
      return () => _markNotificationsRead(body.userId);
    if (path === '/api/notifications/mark-read' && method === 'POST')
      return () => _markNotificationsRead(body.userId);

    // Calendar (no-op on GitHub Pages)
    if (path.startsWith('/api/calendar') || path.startsWith('/api/calendar-config'))
      return () => ({ success: true, enabled: false });

    // Save
    if (path === '/api/save' && method === 'POST')
      return () => _saveAll(body);

    // Leave accrual
    if (path === '/api/leave-accrual' && method === 'POST')
      return () => _runLeaveAccrual();

    return null;
  }

  // ── Helpers ──

  async function _getAll(col) {
    const snap = await db.collection(col).get();
    const results = [];
    snap.forEach(d => results.push({ id: d.id, ...d.data() }));
    return results;
  }

  function _sanitizeEmp(e) {
    if (!e) return e;
    const { password, ...rest } = e;
    return rest;
  }

  // ── Auth ──

  async function _login(uid, pwd) {
    const normalized = (uid || '').toLowerCase().trim();
    const ADMIN_USERNAME = 'quemahtech';
    const ADMIN_EMAIL = 'atharvashishn@gmail.com';

    // Admin check
    if (normalized === ADMIN_USERNAME || normalized === ADMIN_EMAIL.toLowerCase()) {
      const doc = await db.collection('admins').doc(ADMIN_USERNAME).get();
      if (doc.exists && doc.data().password === pwd)
        return { success: true, role: 'admin', user: { id: ADMIN_USERNAME, name: 'Administrator' } };
      return { success: false, message: 'Incorrect admin password.' };
    }

    // Employee check
    let snap = await db.collection('employees').where('id', '==', normalized).where('active', '==', true).get();
    if (snap.empty) snap = await db.collection('employees').where('email', '==', normalized).where('active', '==', true).get();
    if (!snap.empty) {
      const emp = snap.docs[0].data();
      if (emp.password === pwd) {
        const hr = new Date().getHours();
        return {
          success: true, role: 'employee',
          user: { id: emp.id, name: emp.name, dept: emp.dept, designation: emp.designation, cl: emp.cl, sl: emp.sl, ul: emp.ul || 0 },
          timeBlock: { isHalfDay: hr >= 14 }
        };
      }
    }
    return { success: false, message: 'Invalid credentials.' };
  }

  async function _changePassword(userId, currentPwd, newPwd) {
    if (userId === 'quemahtech') {
      const ref = db.collection('admins').doc('quemahtech');
      const doc = await ref.get();
      if (!doc.exists) return { error: 'Admin not found' };
      if (doc.data().password !== currentPwd) return { error: 'Wrong password' };
      await ref.update({ password: newPwd });
      return { success: true };
    }
    const snap = await db.collection('employees').where('id', '==', userId).get();
    if (snap.empty) return { error: 'User not found' };
    if (snap.docs[0].data().password !== currentPwd) return { error: 'Wrong password' };
    await snap.docs[0].ref.update({ password: newPwd });
    return { success: true };
  }

  async function _forgotPassword(uid) {
    const normalized = (uid || '').toLowerCase().trim();
    if (normalized !== 'quemahtech' && normalized !== 'atharvashishn@gmail.com')
      return { error: 'Unauthorized. Only the system administrator can reset their password.' };
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const tempPassword = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    await db.collection('admins').doc('quemahtech').update({ password: tempPassword });
    return { success: true, message: 'Temporary password generated.', tempPassword: tempPassword };
  }

  // ── State ──

  async function _getState() {
    const [emps, att, lr, anns, depts, archemps, notifs] = await Promise.all([
      _getAll('employees'), _getAll('attendance'), _getAll('leaveRequests'),
      _getAll('announcements'), _getAll('departments'), _getAll('archivedEmployees'), _getAll('notifications')
    ]);
    return {
      employees: emps.map(_sanitizeEmp),
      archivedEmployees: archemps.map(a => ({
        id: a.id || a.originalId, name: a.name, dept: a.dept,
        status: a.status, joining: a.joining, exit: a.exit
      })),
      attendanceRecords: att,
      leaveRequests: lr,
      announcements: anns,
      adminNotifications: notifs.filter(n => n.target === 'admin'),
      empNotifications: notifs.filter(n => n.target === 'emp' || n.userId),
      departments: depts.map(d => d.name)
    };
  }

  // ── Employees ──

  async function _createEmployee(data) {
    const existing = await db.collection('employees').where('id', '==', data.id).get();
    if (!existing.empty) return { error: 'Employee ID already exists' };
    await db.collection('employees').doc(data.id).set({
      ...data, password: data.password || 'emp123', active: true, ul: data.ul || 0
    });
    return { success: true, employee: { ...data } };
  }

  async function _getEmployee(id) {
    const snap = await db.collection('employees').where('id', '==', id).get();
    if (snap.empty) return { error: 'Not found' };
    return _sanitizeEmp(snap.docs[0].data());
  }

  async function _updateEmployee(id, body) {
    const snap = await db.collection('employees').where('id', '==', id).get();
    if (snap.empty) return { error: 'Not found' };
    await snap.docs[0].ref.update(body);
    return { success: true };
  }

  async function _deleteEmployee(id) {
    const snap = await db.collection('employees').where('id', '==', id).get();
    if (snap.empty) return { error: 'Not found' };
    const emp = snap.docs[0].data();
    await snap.docs[0].ref.delete();
    await db.collection('archivedEmployees').doc(id).set({
      originalId: id, id, name: emp.name, dept: emp.dept,
      status: 'Deleted', joining: emp.joining, exit: new Date().toISOString().split('T')[0], employeeData: emp
    });
    return { success: true };
  }

  async function _archiveEmployee(id) {
    const snap = await db.collection('employees').where('id', '==', id).get();
    if (snap.empty) return { error: 'Not found' };
    const emp = snap.docs[0].data();
    await db.collection('archivedEmployees').doc(id).set({
      originalId: id, id, name: emp.name, dept: emp.dept,
      status: 'Archived', joining: emp.joining, exit: new Date().toISOString().split('T')[0], employeeData: emp
    });
    await snap.docs[0].ref.update({ active: false });
    return { success: true };
  }

  // ── Attendance ──

  async function _saveAttendance(body) {
    const { id, date } = body;
    if (!id || !date) return { success: false };
    const existing = await db.collection('attendance').where('id', '==', id).where('date', '==', date).get();
    if (!existing.empty) {
      await existing.docs[0].ref.update(body);
    } else {
      await db.collection('attendance').doc(id + '_' + date).set(body);
    }
    return { success: true };
  }

  // ── Leave Requests ──

  async function _createLeaveRequest(data) {
    const docId = (data.empId || 'emp') + '_' + Date.now();
    await db.collection('leaveRequests').doc(docId).set(data);
    return { success: true, leaveRequest: data };
  }

  async function _updateLeaveRequest(id, body) {
    let snap = await db.collection('leaveRequests').where('id', '==', id).get();
    if (!snap.empty) {
      await snap.docs[0].ref.update(body);
    } else {
      const ref = db.collection('leaveRequests').doc(id);
      const doc = await ref.get();
      if (doc.exists) await ref.update(body);
    }
    return { success: true };
  }

  // ── Announcements ──

  async function _createAnnouncement(data) {
    await db.collection('announcements').doc().set(data);
    return { success: true };
  }

  // ── Departments ──

  async function _getDepartments() {
    const docs = await _getAll('departments');
    return docs.map(d => d.name);
  }

  async function _addDepartment(name) {
    const existing = await db.collection('departments').where('name', '==', name).get();
    if (!existing.empty) return { error: 'Exists' };
    await db.collection('departments').doc(name).set({ name });
    const all = await _getAll('departments');
    return { success: true, departments: all.map(d => d.name) };
  }

  async function _removeDepartment(name) {
    await db.collection('departments').doc(name).delete();
    const all = await _getAll('departments');
    return { success: true, departments: all.map(d => d.name) };
  }

  // ── Notifications ──

  async function _addNotification(data) {
    await db.collection('notifications').doc().set({
      ...data,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      unread: true
    });
    return { success: true };
  }

  async function _getNotifications(userId) {
    const all = await _getAll('notifications');
    const notifs = (!userId || userId === 'quemahtech')
      ? all.filter(n => n.target === 'admin')
      : all.filter(n => n.target === 'emp' || n.userId === userId);
    const unread = notifs.filter(n => n.unread !== false).length;
    return { notifications: notifs, count: unread };
  }

  async function _markNotificationsRead(userId) {
    const all = await _getAll('notifications');
    const target = (!userId || userId === 'quemahtech')
      ? all.filter(n => n.target === 'admin')
      : all.filter(n => n.target === 'emp' || n.userId === userId);
    const batch = db.batch();
    for (const n of target) {
      if (n.unread !== false) {
        const ref = db.collection('notifications').doc(n.id || n._id);
        batch.update(ref, { unread: false });
      }
    }
    await batch.commit();
    return { success: true };
  }

  // ── Save All ──

  async function _saveAll(body) {
    if (body.employees) {
      for (const e of body.employees) {
        await db.collection('employees').doc(e.id).set(e, { merge: true });
      }
    }
    if (body.departments) {
      const existing = await _getAll('departments');
      for (const d of existing) await db.collection('departments').doc(d.name || d.id).delete();
      for (const name of body.departments) await db.collection('departments').doc(name).set({ name });
    }
    if (body.announcements) {
      for (const a of body.announcements) await db.collection('announcements').doc().set(a);
    }
    return { success: true };
  }

  // ── Leave Accrual ──

  async function _runLeaveAccrual() {
    const emps = await _getAll('employees');
    let count = 0;
    for (const emp of emps) {
      if (emp.active !== false) {
        await db.collection('employees').doc(emp.id).update({
          cl: Math.min((parseFloat(emp.cl) || 0) + 1.0, 30),
          sl: Math.min((parseFloat(emp.sl) || 0) + 0.5, 15)
        });
        count++;
      }
    }
    return { success: true, count, message: count + ' employees credited (CL +1.0, SL +0.5)' };
  }

  // ── Public API ──

  const api = { init, call, get ready() { return ready; } };
  window.FirebaseClient = api;

})();
